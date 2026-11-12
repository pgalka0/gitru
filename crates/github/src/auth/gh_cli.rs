//! Reuse the token of an already signed-in GitHub CLI (`gh auth token`).
//!
//! Handy for personal use and for organizations that block third-party OAuth
//! apps: the CLI's own OAuth app is usually already approved.

use std::ffi::OsStr;
use std::path::Path;
use std::process::Stdio;
use std::time::Duration;

use tokio::process::Command;
use tokio::time::timeout;

use crate::{auth::token::AccessToken, error::GithubError};

const CLI_TIMEOUT: Duration = Duration::from_secs(10);

/// Run `gh auth token --hostname <host>`.
///
/// `path_env` is passed explicitly because GUI apps on macOS do not inherit the
/// login shell `PATH`, and `gh` may call credential helpers found on it.
pub async fn read_token(
    gh_path: &Path,
    path_env: &OsStr,
    host: &str,
) -> Result<AccessToken, GithubError> {
    let mut command = Command::new(gh_path);
    command
        .args(["auth", "token", "--hostname", host])
        .env("PATH", path_env)
        .env("GH_PROMPT_DISABLED", "1")
        .env("NO_COLOR", "1")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true);

    #[cfg(windows)]
    {
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }

    let output = timeout(CLI_TIMEOUT, command.output())
        .await
        .map_err(|_| GithubError::CliTimedOut)?
        .map_err(|_| GithubError::CliUnavailable)?;

    if !output.status.success() {
        return Err(GithubError::CliNotSignedIn);
    }

    let stdout = String::from_utf8(output.stdout).map_err(|_| GithubError::InvalidToken)?;
    AccessToken::parse(&stdout)
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;
    use std::path::PathBuf;

    fn fake_gh(dir: &Path, script_body: &str) -> PathBuf {
        let path = dir.join("gh");
        std::fs::write(&path, format!("#!/bin/sh\n{script_body}\n")).unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
        path
    }

    fn path_env() -> std::ffi::OsString {
        std::env::var_os("PATH").unwrap_or_default()
    }

    #[tokio::test]
    async fn reads_token_for_requested_host() {
        let dir = tempfile::tempdir().unwrap();
        let gh = fake_gh(
            dir.path(),
            r#"[ "$1 $2 $3 $4" = "auth token --hostname github.com" ] || exit 9
echo "gho_from_cli""#,
        );

        let token = read_token(&gh, &path_env(), "github.com").await.unwrap();
        assert_eq!(token.expose(), "gho_from_cli");
    }

    #[tokio::test]
    async fn reports_signed_out_cli() {
        let dir = tempfile::tempdir().unwrap();
        let gh = fake_gh(dir.path(), "echo 'no oauth token' >&2; exit 1");

        let error = read_token(&gh, &path_env(), "github.com")
            .await
            .unwrap_err();
        assert_eq!(error, GithubError::CliNotSignedIn);
    }

    #[tokio::test]
    async fn reports_missing_binary() {
        let dir = tempfile::tempdir().unwrap();
        let error = read_token(&dir.path().join("gh"), &path_env(), "github.com")
            .await
            .unwrap_err();
        assert_eq!(error, GithubError::CliUnavailable);
    }

    #[tokio::test]
    async fn rejects_garbage_output() {
        let dir = tempfile::tempdir().unwrap();
        let gh = fake_gh(dir.path(), "echo 'not a token'");

        let error = read_token(&gh, &path_env(), "github.com")
            .await
            .unwrap_err();
        assert_eq!(error, GithubError::InvalidToken);
    }
}
