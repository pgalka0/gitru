use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use reqwest::StatusCode;
use reqwest::header::{ACCEPT, HeaderMap};
use serde::Deserialize;
use serde::de::DeserializeOwned;
use serde_json::{Value, json};

use crate::{
    auth::token::AccessToken, endpoints::Endpoints, error::GithubError, models::RateLimit,
};

const USER_AGENT: &str = "gitru-desktop";
const API_VERSION: &str = "2022-11-28";

pub fn build_http_client() -> Result<reqwest::Client, GithubError> {
    reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(GithubError::network)
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
pub struct GraphQlErrorItem {
    pub message: String,
    #[serde(rename = "type")]
    pub kind: Option<String>,
    #[serde(default)]
    pub path: Vec<Value>,
}

#[derive(Deserialize)]
struct Envelope<T> {
    data: Option<T>,
    #[serde(default)]
    errors: Vec<GraphQlErrorItem>,
}

/// A GraphQL reply that may carry partial data alongside errors (for example
/// one aliased repository is missing while the others resolve).
pub struct GraphQlResponse<T> {
    pub data: Option<T>,
    pub errors: Vec<GraphQlErrorItem>,
    pub scopes: Option<Vec<String>>,
}

pub struct GithubClient {
    http: reqwest::Client,
    endpoints: Endpoints,
    token: AccessToken,
    rate_limit: Mutex<Option<RateLimit>>,
}

impl GithubClient {
    pub fn new(http: reqwest::Client, endpoints: Endpoints, token: AccessToken) -> Self {
        Self {
            http,
            endpoints,
            token,
            rate_limit: Mutex::new(None),
        }
    }

    pub fn rate_limit(&self) -> Option<RateLimit> {
        self.rate_limit.lock().expect("rate limit poisoned").clone()
    }

    /// Run a GraphQL operation and keep partial data.
    pub async fn execute<T: DeserializeOwned>(
        &self,
        query: &str,
        variables: Value,
    ) -> Result<GraphQlResponse<T>, GithubError> {
        let response = self
            .http
            .post(self.endpoints.graphql_url())
            .bearer_auth(self.token.expose())
            .header(ACCEPT, "application/vnd.github+json")
            .header("X-GitHub-Api-Version", API_VERSION)
            .json(&json!({ "query": query, "variables": variables }))
            .send()
            .await
            .map_err(GithubError::network)?;

        let status = response.status();
        let headers = response.headers().clone();
        let rate_limit = parse_rate_limit(&headers);
        if let Some(rate_limit) = rate_limit.clone() {
            *self.rate_limit.lock().expect("rate limit poisoned") = Some(rate_limit);
        }

        let body = response.bytes().await.map_err(GithubError::network)?;
        if !status.is_success() {
            return Err(classify_http_error(status, &headers, &body));
        }

        let envelope: Envelope<T> = serde_json::from_slice(&body)
            .map_err(|error| GithubError::Decode(error.to_string()))?;

        if envelope
            .errors
            .iter()
            .any(|error| error.kind.as_deref() == Some("RATE_LIMITED"))
        {
            return Err(GithubError::RateLimited {
                reset_at: rate_limit.map(|limit| limit.reset_at),
            });
        }

        Ok(GraphQlResponse {
            data: envelope.data,
            errors: envelope.errors,
            scopes: parse_scopes(&headers),
        })
    }

    /// Run a GraphQL operation where any error fails the whole call.
    pub async fn query<T: DeserializeOwned>(
        &self,
        query: &str,
        variables: Value,
    ) -> Result<(T, Option<Vec<String>>), GithubError> {
        let response = self.execute::<T>(query, variables).await?;
        match (response.data, response.errors.is_empty()) {
            (Some(data), true) => Ok((data, response.scopes)),
            (_, false) => Err(GithubError::GraphQl(
                response.errors.into_iter().map(|e| e.message).collect(),
            )),
            (None, true) => Err(GithubError::Decode("response has no data".to_string())),
        }
    }
}

pub(crate) fn parse_rate_limit(headers: &HeaderMap) -> Option<RateLimit> {
    let number = |name: &str| headers.get(name)?.to_str().ok()?.trim().parse::<u64>().ok();

    Some(RateLimit {
        limit: u32::try_from(number("x-ratelimit-limit")?).ok()?,
        remaining: u32::try_from(number("x-ratelimit-remaining")?).ok()?,
        reset_at: number("x-ratelimit-reset")?,
        resource: headers
            .get("x-ratelimit-resource")
            .and_then(|value| value.to_str().ok())
            .unwrap_or("core")
            .to_string(),
    })
}

/// `X-OAuth-Scopes: repo, read:org`. Absent for fine-grained tokens.
pub(crate) fn parse_scopes(headers: &HeaderMap) -> Option<Vec<String>> {
    let raw = headers.get("x-oauth-scopes")?.to_str().ok()?;
    Some(
        raw.split(',')
            .map(str::trim)
            .filter(|scope| !scope.is_empty())
            .map(str::to_string)
            .collect(),
    )
}

pub(crate) fn classify_http_error(
    status: StatusCode,
    headers: &HeaderMap,
    body: &[u8],
) -> GithubError {
    if status == StatusCode::UNAUTHORIZED {
        return GithubError::Unauthorized;
    }

    let header = |name: &str| headers.get(name).and_then(|value| value.to_str().ok());
    let exhausted = header("x-ratelimit-remaining") == Some("0");
    let retry_after = header("retry-after").and_then(|value| value.trim().parse::<u64>().ok());

    if matches!(
        status,
        StatusCode::FORBIDDEN | StatusCode::TOO_MANY_REQUESTS
    ) && (exhausted || retry_after.is_some())
    {
        let reset_at = header("x-ratelimit-reset")
            .and_then(|value| value.trim().parse::<u64>().ok())
            .or_else(|| retry_after.map(|seconds| unix_now() + seconds));
        return GithubError::RateLimited { reset_at };
    }

    #[derive(Deserialize)]
    struct ErrorBody {
        message: Option<String>,
    }

    let message = serde_json::from_slice::<ErrorBody>(body)
        .ok()
        .and_then(|body| body.message)
        .unwrap_or_else(|| {
            status
                .canonical_reason()
                .unwrap_or("Unknown error")
                .to_string()
        });

    GithubError::Api {
        status: status.as_u16(),
        message,
    }
}

fn unix_now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use reqwest::header::{HeaderName, HeaderValue};

    fn headers(pairs: &[(&str, &str)]) -> HeaderMap {
        let mut map = HeaderMap::new();
        for (name, value) in pairs {
            map.insert(
                HeaderName::from_bytes(name.as_bytes()).unwrap(),
                HeaderValue::from_str(value).unwrap(),
            );
        }
        map
    }

    #[test]
    fn parses_rate_limit_headers() {
        let parsed = parse_rate_limit(&headers(&[
            ("x-ratelimit-limit", "5000"),
            ("x-ratelimit-remaining", "4990"),
            ("x-ratelimit-reset", "1794480000"),
            ("x-ratelimit-resource", "graphql"),
        ]));

        assert_eq!(
            parsed,
            Some(RateLimit {
                limit: 5000,
                remaining: 4990,
                reset_at: 1_794_480_000,
                resource: "graphql".to_string(),
            })
        );
    }

    #[test]
    fn missing_rate_limit_headers_yield_none() {
        assert_eq!(
            parse_rate_limit(&headers(&[("x-ratelimit-limit", "5000")])),
            None
        );
    }

    #[test]
    fn parses_classic_scopes_and_ignores_blanks() {
        assert_eq!(
            parse_scopes(&headers(&[("x-oauth-scopes", "repo, read:org, ")])),
            Some(vec!["repo".to_string(), "read:org".to_string()])
        );
        assert_eq!(parse_scopes(&HeaderMap::new()), None);
    }

    #[test]
    fn classifies_unauthorized() {
        assert_eq!(
            classify_http_error(StatusCode::UNAUTHORIZED, &HeaderMap::new(), b"{}"),
            GithubError::Unauthorized
        );
    }

    #[test]
    fn classifies_primary_and_secondary_rate_limits() {
        assert_eq!(
            classify_http_error(
                StatusCode::FORBIDDEN,
                &headers(&[("x-ratelimit-remaining", "0"), ("x-ratelimit-reset", "42")]),
                b"{}"
            ),
            GithubError::RateLimited { reset_at: Some(42) }
        );

        let secondary = classify_http_error(
            StatusCode::TOO_MANY_REQUESTS,
            &headers(&[("retry-after", "60")]),
            b"{}",
        );
        assert!(matches!(
            secondary,
            GithubError::RateLimited { reset_at: Some(_) }
        ));
    }

    #[test]
    fn plain_forbidden_keeps_github_message() {
        assert_eq!(
            classify_http_error(
                StatusCode::FORBIDDEN,
                &HeaderMap::new(),
                br#"{"message":"Resource not accessible by integration"}"#
            ),
            GithubError::Api {
                status: 403,
                message: "Resource not accessible by integration".to_string()
            }
        );
    }
}
