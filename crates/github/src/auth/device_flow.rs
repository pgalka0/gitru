//! OAuth 2.0 Device Authorization Grant, as implemented by GitHub:
//! <https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#device-flow>

use std::fmt;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use reqwest::header::ACCEPT;
use serde::Deserialize;
use tokio::sync::Notify;
use tokio::time::Instant;

use crate::{
    auth::token::AccessToken, endpoints::Endpoints, error::GithubError, models::DeviceVerification,
};

/// `repo` covers issues, pull requests and reviews on private repositories;
/// `read:org` lets GraphQL resolve organization membership and teams.
pub const DEFAULT_SCOPES: &str = "repo read:org";

const GRANT_TYPE: &str = "urn:ietf:params:oauth:grant-type:device_code";
/// RFC 8628 §3.5: on `slow_down` the interval grows by 5 seconds.
const SLOW_DOWN_STEP: Duration = Duration::from_secs(5);

#[derive(Clone)]
pub struct DeviceCode {
    device_code: String,
    pub user_code: String,
    pub verification_uri: String,
    pub expires_in: Duration,
    pub interval: Duration,
}

impl fmt::Debug for DeviceCode {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("DeviceCode")
            .field("device_code", &"<redacted>")
            .field("user_code", &self.user_code)
            .field("verification_uri", &self.verification_uri)
            .field("expires_in", &self.expires_in)
            .field("interval", &self.interval)
            .finish()
    }
}

impl From<&DeviceCode> for DeviceVerification {
    fn from(code: &DeviceCode) -> Self {
        Self {
            user_code: code.user_code.clone(),
            verification_uri: code.verification_uri.clone(),
            expires_in_secs: code.expires_in.as_secs(),
        }
    }
}

#[derive(Debug, PartialEq, Eq)]
pub enum PollOutcome {
    Pending,
    /// GitHub asked us to back off; carries the new interval if it sent one.
    SlowDown(Option<Duration>),
    Authorized(AccessToken),
}

/// Cooperative cancellation shared between the UI command that waits for the
/// token and the command that cancels sign-in.
#[derive(Clone, Default)]
pub struct CancelSignal {
    inner: Arc<(AtomicBool, Notify)>,
}

impl CancelSignal {
    pub fn cancel(&self) {
        self.inner.0.store(true, Ordering::SeqCst);
        self.inner.1.notify_waiters();
    }

    pub fn is_cancelled(&self) -> bool {
        self.inner.0.load(Ordering::SeqCst)
    }

    pub fn same_as(&self, other: &CancelSignal) -> bool {
        Arc::ptr_eq(&self.inner, &other.inner)
    }

    pub async fn cancelled(&self) {
        let notified = self.inner.1.notified();
        tokio::pin!(notified);
        // Register before checking the flag so a concurrent `cancel` cannot slip
        // between the check and the await.
        notified.as_mut().enable();
        if self.is_cancelled() {
            return;
        }
        notified.await;
    }
}

#[derive(Deserialize)]
struct DeviceCodeResponse {
    device_code: Option<String>,
    user_code: Option<String>,
    verification_uri: Option<String>,
    expires_in: Option<u64>,
    interval: Option<u64>,
    error: Option<String>,
    error_description: Option<String>,
}

#[derive(Deserialize)]
struct AccessTokenResponse {
    access_token: Option<String>,
    interval: Option<u64>,
    error: Option<String>,
    error_description: Option<String>,
}

pub async fn request_device_code(
    http: &reqwest::Client,
    endpoints: &Endpoints,
    client_id: &str,
    scopes: &str,
) -> Result<DeviceCode, GithubError> {
    let response = http
        .post(endpoints.device_code_url())
        .header(ACCEPT, "application/json")
        .form(&[("client_id", client_id), ("scope", scopes)])
        .send()
        .await
        .map_err(GithubError::network)?;

    let status = response.status();
    let body: DeviceCodeResponse = response.json().await.map_err(|_| GithubError::Api {
        status: status.as_u16(),
        message: "GitHub returned an unreadable device code response".to_string(),
    })?;

    if let Some(code) = body.error {
        return Err(oauth_error(code, body.error_description));
    }

    match (
        body.device_code,
        body.user_code,
        body.verification_uri,
        body.expires_in,
    ) {
        (Some(device_code), Some(user_code), Some(verification_uri), Some(expires_in)) => {
            Ok(DeviceCode {
                device_code,
                user_code,
                verification_uri,
                expires_in: Duration::from_secs(expires_in),
                interval: Duration::from_secs(body.interval.unwrap_or(5)),
            })
        }
        _ => Err(GithubError::Api {
            status: status.as_u16(),
            message: "GitHub returned an incomplete device code response".to_string(),
        }),
    }
}

pub async fn poll_access_token(
    http: &reqwest::Client,
    endpoints: &Endpoints,
    client_id: &str,
    code: &DeviceCode,
) -> Result<PollOutcome, GithubError> {
    let response = http
        .post(endpoints.access_token_url())
        .header(ACCEPT, "application/json")
        .form(&[
            ("client_id", client_id),
            ("device_code", code.device_code.as_str()),
            ("grant_type", GRANT_TYPE),
        ])
        .send()
        .await
        .map_err(GithubError::network)?;

    let status = response.status();
    let body: AccessTokenResponse = response.json().await.map_err(|_| GithubError::Api {
        status: status.as_u16(),
        message: "GitHub returned an unreadable token response".to_string(),
    })?;

    if let Some(token) = body.access_token {
        return AccessToken::parse(&token).map(PollOutcome::Authorized);
    }

    match body.error.as_deref() {
        Some("authorization_pending") => Ok(PollOutcome::Pending),
        Some("slow_down") => Ok(PollOutcome::SlowDown(
            body.interval.map(Duration::from_secs),
        )),
        Some(_) => Err(oauth_error(
            body.error.unwrap_or_default(),
            body.error_description,
        )),
        None => Err(GithubError::Api {
            status: status.as_u16(),
            message: "GitHub returned neither a token nor an error".to_string(),
        }),
    }
}

/// Poll until the user authorizes on github.com, the code expires, GitHub
/// rejects the request, or `cancel` fires.
pub async fn wait_for_token(
    http: &reqwest::Client,
    endpoints: &Endpoints,
    client_id: &str,
    code: &DeviceCode,
    cancel: &CancelSignal,
) -> Result<AccessToken, GithubError> {
    let deadline = Instant::now() + code.expires_in;
    let mut interval = code.interval;

    loop {
        tokio::select! {
            _ = tokio::time::sleep(interval) => {}
            _ = cancel.cancelled() => return Err(GithubError::DeviceFlowCancelled),
        }

        if cancel.is_cancelled() {
            return Err(GithubError::DeviceFlowCancelled);
        }
        if Instant::now() >= deadline {
            return Err(GithubError::DeviceFlowExpired);
        }

        match poll_access_token(http, endpoints, client_id, code).await? {
            PollOutcome::Pending => {}
            PollOutcome::SlowDown(next) => interval = next.unwrap_or(interval + SLOW_DOWN_STEP),
            PollOutcome::Authorized(token) => return Ok(token),
        }
    }
}

fn oauth_error(code: String, description: Option<String>) -> GithubError {
    match code.as_str() {
        "expired_token" => GithubError::DeviceFlowExpired,
        "access_denied" => GithubError::DeviceFlowDenied,
        _ => GithubError::OAuth { code, description },
    }
}

#[cfg(test)]
impl DeviceCode {
    pub(crate) fn for_tests(interval: Duration, expires_in: Duration) -> Self {
        Self {
            device_code: "device-code".to_string(),
            user_code: "ABCD-1234".to_string(),
            verification_uri: "https://github.com/login/device".to_string(),
            expires_in,
            interval,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn debug_output_hides_device_code() {
        let code = DeviceCode::for_tests(Duration::ZERO, Duration::from_secs(900));
        let debug = format!("{code:?}");
        assert!(!debug.contains("device-code"), "{debug}");
        assert!(debug.contains("ABCD-1234"));
    }

    #[test]
    fn maps_terminal_oauth_errors() {
        assert_eq!(
            oauth_error("expired_token".into(), None),
            GithubError::DeviceFlowExpired
        );
        assert_eq!(
            oauth_error("access_denied".into(), None),
            GithubError::DeviceFlowDenied
        );
        assert_eq!(
            oauth_error("device_flow_disabled".into(), Some("off".into())),
            GithubError::OAuth {
                code: "device_flow_disabled".into(),
                description: Some("off".into())
            }
        );
    }

    #[tokio::test]
    async fn cancel_wakes_a_waiter_registered_before_cancel() {
        let signal = CancelSignal::default();
        let waiter = {
            let signal = signal.clone();
            tokio::spawn(async move { signal.cancelled().await })
        };
        tokio::task::yield_now().await;
        signal.cancel();
        tokio::time::timeout(Duration::from_secs(1), waiter)
            .await
            .expect("waiter should wake")
            .unwrap();
    }

    #[tokio::test]
    async fn cancelled_returns_immediately_when_already_cancelled() {
        let signal = CancelSignal::default();
        signal.cancel();
        tokio::time::timeout(Duration::from_millis(100), signal.cancelled())
            .await
            .expect("should not wait");
    }
}
