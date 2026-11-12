use std::fmt;

use crate::error::GithubError;

const MAX_TOKEN_LENGTH: usize = 512;

/// A GitHub access token. Deliberately has no `Serialize` impl and a redacted
/// `Debug`, so it cannot leak into IPC payloads or logs by accident.
#[derive(Clone, PartialEq, Eq)]
pub struct AccessToken(String);

impl AccessToken {
    pub fn parse(raw: &str) -> Result<Self, GithubError> {
        let token = raw.trim();
        let well_formed = !token.is_empty()
            && token.len() <= MAX_TOKEN_LENGTH
            && token.chars().all(|c| c.is_ascii_graphic());

        if well_formed {
            Ok(Self(token.to_string()))
        } else {
            Err(GithubError::InvalidToken)
        }
    }

    pub(crate) fn expose(&self) -> &str {
        &self.0
    }
}

impl fmt::Debug for AccessToken {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("AccessToken(<redacted>)")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn trims_surrounding_whitespace() {
        let token = AccessToken::parse("  gho_abc123\n").unwrap();
        assert_eq!(token.expose(), "gho_abc123");
    }

    #[test]
    fn rejects_empty_or_malformed_tokens() {
        for raw in [
            "",
            "   ",
            "gho abc",
            "gho_\u{e9}",
            &"a".repeat(MAX_TOKEN_LENGTH + 1),
        ] {
            assert_eq!(
                AccessToken::parse(raw),
                Err(GithubError::InvalidToken),
                "{raw:?}"
            );
        }
    }

    #[test]
    fn debug_output_is_redacted() {
        let token = AccessToken::parse("gho_secret").unwrap();
        assert_eq!(format!("{token:?}"), "AccessToken(<redacted>)");
    }
}
