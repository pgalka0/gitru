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

// ---------------------------------------------------------------------------
// Issues
//
// Enums use camelCase on the wire (what `tauri-typegen` understands). GitHub's
// SCREAMING_CASE values are accepted through `alias` when decoding responses.
// Timeline items are one flat struct with optional fields rather than a
// data-carrying enum, which keeps the generated TypeScript simple.
// ---------------------------------------------------------------------------

/// A user, bot, mannequin or organization shown next to content.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct Actor {
    pub login: String,
    pub avatar_url: String,
    pub html_url: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct Label {
    pub name: String,
    /// Hex colour without `#`, e.g. `d73a4a`.
    pub color: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum IssueState {
    #[serde(alias = "OPEN")]
    Open,
    #[serde(alias = "CLOSED")]
    Closed,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum IssueStateReason {
    #[serde(alias = "COMPLETED")]
    Completed,
    #[serde(alias = "NOT_PLANNED")]
    NotPlanned,
    #[serde(alias = "REOPENED")]
    Reopened,
    #[serde(alias = "DUPLICATE")]
    Duplicate,
    /// A reason added by GitHub after this build.
    #[serde(other)]
    Other,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum IssueStateFilter {
    Open,
    Closed,
    All,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum IssueSort {
    Newest,
    Oldest,
    RecentlyUpdated,
    MostCommented,
}

/// One page of a repository's issues, filtered like the github.com issue list.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct IssueListRequest {
    pub repository: RepositoryRef,
    pub state: IssueStateFilter,
    #[serde(default)]
    pub assigned_to_me: bool,
    /// Issues must carry every one of these labels.
    #[serde(default)]
    pub labels: Vec<String>,
    /// Extra GitHub search syntax, e.g. `author:octocat crash`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub query: Option<String>,
    pub sort: IssueSort,
    /// `end_cursor` of the previous page.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub after: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct IssueSummary {
    pub number: u32,
    pub title: String,
    pub html_url: String,
    pub state: IssueState,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub state_reason: Option<IssueStateReason>,
    /// `None` when the account was deleted ("ghost").
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub author: Option<Actor>,
    /// RFC 3339 timestamps, as returned by GitHub.
    pub created_at: String,
    pub updated_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub closed_at: Option<String>,
    pub comments: u32,
    pub labels: Vec<Label>,
    pub assignees: Vec<Actor>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub milestone: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct IssuePage {
    pub issues: Vec<IssueSummary>,
    /// Matches for the whole search, not just this page.
    pub total_count: u32,
    pub has_next_page: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub end_cursor: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct IssueDetailRequest {
    pub repository: RepositoryRef,
    pub number: u32,
    /// `end_cursor` of the previous timeline page.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub timeline_after: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct Milestone {
    pub title: String,
    pub html_url: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub due_on: Option<String>,
}

/// Only reactions that someone used.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct ReactionGroup {
    /// GitHub's `ReactionContent`, e.g. `THUMBS_UP`, `HEART`, `ROCKET`.
    pub content: String,
    pub count: u32,
    pub viewer_has_reacted: bool,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ReferenceKind {
    Issue,
    PullRequest,
    Commit,
}

/// An issue, pull request or commit mentioned by or linked to an issue.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct Reference {
    pub kind: ReferenceKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub number: Option<u32>,
    /// Issue/PR title or the commit's first message line.
    pub title: String,
    pub html_url: String,
    /// `open`, `closed` or `merged`; absent for commits.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub state: Option<String>,
    #[serde(default)]
    pub is_draft: bool,
    /// `owner/name` of the repository the reference lives in.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub repository: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub abbreviated_oid: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum TimelineItemKind {
    Comment,
    Labeled,
    Unlabeled,
    Assigned,
    Unassigned,
    Closed,
    Reopened,
    Renamed,
    Milestoned,
    Demilestoned,
    CrossReferenced,
    Referenced,
    Connected,
    Disconnected,
    Locked,
    Unlocked,
    Pinned,
    Unpinned,
    Transferred,
    MarkedAsDuplicate,
}

/// A comment or event on an issue. Which optional fields are set depends on
/// `kind`; `actor` is the comment author for comments.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct TimelineItem {
    pub id: String,
    pub kind: TimelineItemKind,
    pub created_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub actor: Option<Actor>,
    /// Comment body rendered by GitHub. Untrusted: sanitize before display.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub body_html: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub author_association: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_edited_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub html_url: Option<String>,
    #[serde(default)]
    pub reactions: Vec<ReactionGroup>,
    /// Set when the comment is hidden, e.g. `off-topic` or `outdated`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub minimized_reason: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<Label>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub assignee: Option<Actor>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub previous_title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub current_title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub milestone_title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub state_reason: Option<IssueStateReason>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub lock_reason: Option<String>,
    /// Closer, cross-reference source, connected subject, referencing commit
    /// or duplicate target.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reference: Option<Reference>,
    /// For cross-references: merging the source will close this issue.
    #[serde(default)]
    pub will_close: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub from_repository: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct TimelinePage {
    pub items: Vec<TimelineItem>,
    pub total_count: u32,
    pub has_next_page: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub end_cursor: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct IssueDetail {
    pub number: u32,
    pub title: String,
    pub html_url: String,
    pub state: IssueState,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub state_reason: Option<IssueStateReason>,
    /// Issue body rendered by GitHub. Untrusted: sanitize before display.
    pub body_html: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub author: Option<Actor>,
    /// OWNER, MEMBER, COLLABORATOR, CONTRIBUTOR, FIRST_TIME_CONTRIBUTOR, NONE, …
    pub author_association: String,
    pub created_at: String,
    pub updated_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub closed_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_edited_at: Option<String>,
    pub locked: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub active_lock_reason: Option<String>,
    pub comments: u32,
    pub labels: Vec<Label>,
    pub assignees: Vec<Actor>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub milestone: Option<Milestone>,
    pub participants: Vec<Actor>,
    pub participant_count: u32,
    pub reactions: Vec<ReactionGroup>,
    /// Pull requests that will close (or closed) this issue.
    pub linked_pull_requests: Vec<Reference>,
    /// The page selected by `IssueDetailRequest::timeline_after`.
    pub timeline: TimelinePage,
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
