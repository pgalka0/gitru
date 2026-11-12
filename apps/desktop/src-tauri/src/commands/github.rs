//! Thin Tauri wrappers over `crates/github`. No command returns a token.

use std::sync::Arc;

use github::models::{
    AddCommentRequest, AssignableUsersRequest, AuthStatus, ChangeAssigneesRequest,
    ChangeLabelsRequest, CloseIssueRequest, CreateIssueRequest, CreatedIssue, DeviceVerification,
    EditCommentRequest, EditIssueRequest, IssueContent, IssueDetail, IssueDetailRequest,
    IssueListRequest, IssuePage, IssueStateUpdate, Label, MilestoneUpdate, ReactionGroup,
    RenderMarkdownRequest, RepositoryIssueMetadata, RepositoryRef, RepositorySummaryResult,
    SetMilestoneRequest, SetReactionRequest, TimelineItem, User,
};
use github::GithubService;
use tauri::{AppHandle, Emitter};

/// Broadcast to every webview (each workspace tab is its own webview with its
/// own query cache) whenever the signed-in account changes.
pub const AUTH_CHANGED_EVENT: &str = "github://auth-changed";

/// OAuth App client ID for the Device Flow. A runtime value wins so it can be
/// set without rebuilding (`GITRU_GITHUB_CLIENT_ID=... make dev`).
pub fn configured_client_id() -> Option<String> {
    std::env::var("GITRU_GITHUB_CLIENT_ID")
        .ok()
        .or_else(|| option_env!("GITRU_GITHUB_CLIENT_ID").map(str::to_string))
        .filter(|id| !id.trim().is_empty())
}

fn broadcast(app: &AppHandle, status: &AuthStatus) {
    if let Err(error) = app.emit(AUTH_CHANGED_EVENT, status) {
        log::warn!(target: "github", "failed to broadcast auth change: {error}");
    }
}

#[tauri::command]
pub async fn github_auth_status(
    github: tauri::State<'_, Arc<GithubService>>,
) -> Result<AuthStatus, String> {
    Ok(github.status().await)
}

#[tauri::command]
pub async fn github_start_device_flow(
    github: tauri::State<'_, Arc<GithubService>>,
) -> Result<DeviceVerification, String> {
    github.start_device_flow().await.map_err(String::from)
}

#[tauri::command]
pub async fn github_complete_device_flow(
    app: AppHandle,
    github: tauri::State<'_, Arc<GithubService>>,
) -> Result<AuthStatus, String> {
    let status = github.complete_device_flow().await.map_err(String::from)?;
    broadcast(&app, &status);
    Ok(status)
}

#[tauri::command]
pub fn github_cancel_device_flow(
    github: tauri::State<'_, Arc<GithubService>>,
) -> Result<(), String> {
    github.cancel_device_flow();
    Ok(())
}

#[tauri::command]
pub async fn github_import_cli_token(
    app: AppHandle,
    github: tauri::State<'_, Arc<GithubService>>,
) -> Result<AuthStatus, String> {
    let gh_path = git::runner::resolve_tool_path("gh")
        .map_err(|_| github::GithubError::CliUnavailable.to_string())?;
    let path_env = git::runner::tool_path_env()?;

    let status = github
        .import_gh_cli_token(&gh_path, &path_env)
        .await
        .map_err(String::from)?;
    broadcast(&app, &status);
    Ok(status)
}

#[tauri::command]
pub async fn github_sign_out(
    app: AppHandle,
    github: tauri::State<'_, Arc<GithubService>>,
) -> Result<AuthStatus, String> {
    let status = github.sign_out().await.map_err(String::from)?;
    broadcast(&app, &status);
    Ok(status)
}

#[tauri::command]
pub async fn github_repository_summaries(
    repositories: Vec<RepositoryRef>,
    github: tauri::State<'_, Arc<GithubService>>,
) -> Result<Vec<RepositorySummaryResult>, String> {
    github
        .repository_summaries(repositories)
        .await
        .map_err(String::from)
}

#[tauri::command]
pub async fn github_list_issues(
    request: IssueListRequest,
    github: tauri::State<'_, Arc<GithubService>>,
) -> Result<IssuePage, String> {
    github.list_issues(request).await.map_err(String::from)
}

#[tauri::command]
pub async fn github_issue(
    request: IssueDetailRequest,
    github: tauri::State<'_, Arc<GithubService>>,
) -> Result<IssueDetail, String> {
    github.issue(request).await.map_err(String::from)
}

#[tauri::command]
pub async fn github_repository_labels(
    repository: RepositoryRef,
    github: tauri::State<'_, Arc<GithubService>>,
) -> Result<Vec<Label>, String> {
    github
        .repository_labels(repository)
        .await
        .map_err(String::from)
}

// Issue changes. Each wrapper validates nothing itself: `crates/github` checks
// every ID and text before a request is built.

#[tauri::command]
pub async fn github_add_comment(
    request: AddCommentRequest,
    github: tauri::State<'_, Arc<GithubService>>,
) -> Result<TimelineItem, String> {
    github.add_comment(request).await.map_err(String::from)
}

#[tauri::command]
pub async fn github_edit_comment(
    request: EditCommentRequest,
    github: tauri::State<'_, Arc<GithubService>>,
) -> Result<TimelineItem, String> {
    github.edit_comment(request).await.map_err(String::from)
}

#[tauri::command]
pub async fn github_delete_comment(
    comment_id: String,
    github: tauri::State<'_, Arc<GithubService>>,
) -> Result<(), String> {
    github
        .delete_comment(&comment_id)
        .await
        .map_err(String::from)
}

#[tauri::command]
pub async fn github_edit_issue(
    request: EditIssueRequest,
    github: tauri::State<'_, Arc<GithubService>>,
) -> Result<IssueContent, String> {
    github.edit_issue(request).await.map_err(String::from)
}

#[tauri::command]
pub async fn github_close_issue(
    request: CloseIssueRequest,
    github: tauri::State<'_, Arc<GithubService>>,
) -> Result<IssueStateUpdate, String> {
    github.close_issue(request).await.map_err(String::from)
}

#[tauri::command]
pub async fn github_reopen_issue(
    issue_id: String,
    github: tauri::State<'_, Arc<GithubService>>,
) -> Result<IssueStateUpdate, String> {
    github.reopen_issue(&issue_id).await.map_err(String::from)
}

#[tauri::command]
pub async fn github_change_labels(
    request: ChangeLabelsRequest,
    github: tauri::State<'_, Arc<GithubService>>,
) -> Result<Vec<Label>, String> {
    github.change_labels(request).await.map_err(String::from)
}

#[tauri::command]
pub async fn github_change_assignees(
    request: ChangeAssigneesRequest,
    github: tauri::State<'_, Arc<GithubService>>,
) -> Result<Vec<User>, String> {
    github.change_assignees(request).await.map_err(String::from)
}

#[tauri::command]
pub async fn github_set_milestone(
    request: SetMilestoneRequest,
    github: tauri::State<'_, Arc<GithubService>>,
) -> Result<MilestoneUpdate, String> {
    github.set_milestone(request).await.map_err(String::from)
}

#[tauri::command]
pub async fn github_set_reaction(
    request: SetReactionRequest,
    github: tauri::State<'_, Arc<GithubService>>,
) -> Result<Vec<ReactionGroup>, String> {
    github.set_reaction(request).await.map_err(String::from)
}

#[tauri::command]
pub async fn github_create_issue(
    request: CreateIssueRequest,
    github: tauri::State<'_, Arc<GithubService>>,
) -> Result<CreatedIssue, String> {
    github.create_issue(request).await.map_err(String::from)
}

#[tauri::command]
pub async fn github_repository_issue_metadata(
    repository: RepositoryRef,
    github: tauri::State<'_, Arc<GithubService>>,
) -> Result<RepositoryIssueMetadata, String> {
    github
        .repository_issue_metadata(repository)
        .await
        .map_err(String::from)
}

#[tauri::command]
pub async fn github_assignable_users(
    request: AssignableUsersRequest,
    github: tauri::State<'_, Arc<GithubService>>,
) -> Result<Vec<User>, String> {
    github.assignable_users(request).await.map_err(String::from)
}

/// GitHub-rendered HTML for a draft. Untrusted: the UI sanitizes it like any
/// other `bodyHTML`.
#[tauri::command]
pub async fn github_render_markdown(
    request: RenderMarkdownRequest,
    github: tauri::State<'_, Arc<GithubService>>,
) -> Result<String, String> {
    github.render_markdown(request).await.map_err(String::from)
}
