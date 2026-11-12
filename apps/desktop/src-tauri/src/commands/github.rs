//! Thin Tauri wrappers over `crates/github`. No command returns a token.

use std::sync::Arc;

use github::models::{AuthStatus, DeviceVerification, RepositoryRef, RepositorySummaryResult};
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
