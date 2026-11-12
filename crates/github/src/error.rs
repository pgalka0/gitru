use std::fmt;

/// Errors surfaced to the UI. Messages are user-facing and must never contain
/// tokens, device codes, or response bodies beyond GitHub's own `message`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GithubError {
    NotSignedIn,
    /// The token was rejected (revoked, expired, or lacks access).
    Unauthorized,
    RateLimited {
        reset_at: Option<u64>,
    },
    Network(String),
    Api {
        status: u16,
        message: String,
    },
    GraphQl(Vec<String>),
    Decode(String),
    InvalidToken,
    InvalidInput(String),
    DeviceFlowNotConfigured,
    DeviceFlowNotStarted,
    DeviceFlowExpired,
    DeviceFlowDenied,
    DeviceFlowCancelled,
    OAuth {
        code: String,
        description: Option<String>,
    },
    CliUnavailable,
    CliTimedOut,
    CliNotSignedIn,
    CredentialStore(String),
}

impl GithubError {
    pub(crate) fn network(error: reqwest::Error) -> Self {
        // `without_url` keeps hosts and query strings out of user-facing text.
        Self::Network(error.without_url().to_string())
    }
}

impl fmt::Display for GithubError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NotSignedIn => write!(f, "You are not signed in to GitHub."),
            Self::Unauthorized => write!(
                f,
                "GitHub rejected the saved token. Sign in again to continue."
            ),
            Self::RateLimited { .. } => write!(
                f,
                "GitHub API rate limit reached. Try again after the limit resets."
            ),
            Self::Network(message) => write!(f, "Could not reach GitHub: {message}"),
            Self::Api { status, message } => write!(f, "GitHub returned {status}: {message}"),
            Self::GraphQl(messages) => write!(f, "GitHub query failed: {}", messages.join("; ")),
            Self::Decode(message) => write!(f, "Unexpected response from GitHub: {message}"),
            Self::InvalidToken => write!(f, "The GitHub token has an invalid format."),
            Self::InvalidInput(message) => write!(f, "{message}"),
            Self::DeviceFlowNotConfigured => write!(
                f,
                "GitHub sign-in is not configured. Set GITRU_GITHUB_CLIENT_ID to your OAuth App client ID, or use the GitHub CLI token."
            ),
            Self::DeviceFlowNotStarted => write!(f, "No GitHub sign-in is in progress."),
            Self::DeviceFlowExpired => {
                write!(f, "The GitHub sign-in code expired. Start again.")
            }
            Self::DeviceFlowDenied => write!(f, "GitHub sign-in was cancelled on github.com."),
            Self::DeviceFlowCancelled => write!(f, "GitHub sign-in was cancelled."),
            Self::OAuth { code, description } => match description {
                Some(description) => write!(f, "GitHub sign-in failed ({code}): {description}"),
                None => write!(f, "GitHub sign-in failed ({code})."),
            },
            Self::CliUnavailable => write!(
                f,
                "GitHub CLI (gh) was not found. Install it from https://cli.github.com and run `gh auth login`."
            ),
            Self::CliTimedOut => write!(f, "GitHub CLI did not respond in time."),
            Self::CliNotSignedIn => write!(
                f,
                "GitHub CLI is not signed in. Run `gh auth login` and try again."
            ),
            Self::CredentialStore(message) => {
                write!(f, "Could not access the system credential store: {message}")
            }
        }
    }
}

impl std::error::Error for GithubError {}

impl From<GithubError> for String {
    fn from(error: GithubError) -> Self {
        error.to_string()
    }
}
