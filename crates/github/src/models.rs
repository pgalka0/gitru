//! Types returned to Tauri commands. Fields stay snake_case to match the rest of
//! `@gitru/commands`; GraphQL DTOs (camelCase) live in `graphql.rs`.

use serde::{Deserialize, Serialize};

use crate::error::GithubError;

/// camelCase because `tauri-typegen` honours it for enums (snake_case is ignored).
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum TokenSource {
    DeviceFlow,
    GhCli,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct Viewer {
    pub login: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    pub avatar_url: String,
    pub html_url: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct RateLimit {
    pub limit: u32,
    pub remaining: u32,
    /// Unix timestamp (seconds) when the window resets.
    pub reset_at: u64,
    pub resource: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct AuthStatus {
    pub signed_in: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub viewer: Option<Viewer>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<TokenSource>,
    /// Classic OAuth scopes of the token; `None` for fine-grained tokens.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scopes: Option<Vec<String>>,
    pub device_flow_available: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rate_limit: Option<RateLimit>,
    /// Last non-fatal problem, e.g. GitHub unreachable while restoring a session.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// What the user needs to finish the Device Flow on github.com.
/// The secret `device_code` stays in Rust.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct DeviceVerification {
    pub user_code: String,
    pub verification_uri: String,
    pub expires_in_secs: u64,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq, Hash)]
pub struct RepositoryRef {
    pub owner: String,
    pub name: String,
}

impl RepositoryRef {
    /// GitHub owners and repository names are ASCII letters, digits, `-`, `_`, `.`.
    pub fn validate(&self) -> Result<(), GithubError> {
        let valid = |value: &str, max: usize| {
            !value.is_empty()
                && value.len() <= max
                && value
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
        };

        if valid(&self.owner, 39) && valid(&self.name, 100) {
            Ok(())
        } else {
            Err(GithubError::InvalidInput(format!(
                "Invalid GitHub repository: {}/{}",
                self.owner, self.name
            )))
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct RepositorySummary {
    pub owner: String,
    pub name: String,
    pub url: String,
    pub is_private: bool,
    /// ADMIN, MAINTAIN, WRITE, TRIAGE or READ.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub viewer_permission: Option<String>,
    pub open_issues: u32,
    pub open_pull_requests: u32,
}

/// Per-repository result: one inaccessible repository must not hide the others.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct RepositorySummaryResult {
    pub owner: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub summary: Option<RepositorySummary>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn repo(owner: &str, name: &str) -> RepositoryRef {
        RepositoryRef {
            owner: owner.to_string(),
            name: name.to_string(),
        }
    }

    #[test]
    fn accepts_real_world_repository_names() {
        for (owner, name) in [
            ("ruru-m07", "gitru"),
            ("tauri-apps", "tauri"),
            ("rust-lang", "rust.vim"),
            ("a", "my_repo-2"),
        ] {
            assert!(repo(owner, name).validate().is_ok(), "{owner}/{name}");
        }
    }

    #[test]
    fn rejects_names_that_could_escape_a_path_or_query() {
        for (owner, name) in [
            ("", "gitru"),
            ("owner", ""),
            ("own er", "gitru"),
            ("owner", "gitru/../x"),
            ("owner", "gitru?x=1"),
            (&"o".repeat(40), "gitru"),
        ] {
            assert!(repo(owner, name).validate().is_err(), "{owner}/{name}");
        }
    }

    #[test]
    fn absent_optional_fields_are_omitted_to_match_generated_types() {
        let status = AuthStatus {
            signed_in: false,
            viewer: None,
            source: None,
            scopes: None,
            device_flow_available: false,
            rate_limit: None,
            error: None,
        };
        assert_eq!(
            serde_json::to_value(&status).unwrap(),
            serde_json::json!({ "signed_in": false, "device_flow_available": false })
        );
    }

    #[test]
    fn token_source_serializes_like_the_generated_typescript_enum() {
        assert_eq!(
            serde_json::to_string(&TokenSource::GhCli).unwrap(),
            "\"ghCli\""
        );
        assert_eq!(
            serde_json::to_string(&TokenSource::DeviceFlow).unwrap(),
            "\"deviceFlow\""
        );
    }
}
