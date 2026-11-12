use std::sync::Mutex;

use serde::{Deserialize, Serialize};

use crate::{auth::token::AccessToken, error::GithubError, models::TokenSource};

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct StoredCredential {
    pub token: AccessToken,
    pub source: TokenSource,
}

/// On-disk shape inside the credential store entry.
#[derive(Serialize, Deserialize)]
struct CredentialRecord {
    token: String,
    source: TokenSource,
}

impl StoredCredential {
    fn to_record(&self) -> Result<String, GithubError> {
        serde_json::to_string(&CredentialRecord {
            token: self.token.expose().to_string(),
            source: self.source,
        })
        .map_err(|_| GithubError::CredentialStore("could not encode credential".to_string()))
    }

    fn from_record(raw: &str) -> Option<Self> {
        let record: CredentialRecord = serde_json::from_str(raw).ok()?;
        Some(Self {
            token: AccessToken::parse(&record.token).ok()?,
            source: record.source,
        })
    }
}

/// Persistence for the GitHub credential. Implementations may block (OS keychain
/// calls do), so callers run them on a blocking thread.
pub trait TokenStore: Send + Sync {
    fn load(&self) -> Result<Option<StoredCredential>, GithubError>;
    fn save(&self, credential: &StoredCredential) -> Result<(), GithubError>;
    fn delete(&self) -> Result<(), GithubError>;
}

/// Stores the credential in the OS credential store (macOS Keychain, Windows
/// Credential Manager, Secret Service on Linux).
pub struct KeyringTokenStore {
    service: String,
    account: String,
}

impl KeyringTokenStore {
    pub fn new(service: impl Into<String>, account: impl Into<String>) -> Self {
        Self {
            service: service.into(),
            account: account.into(),
        }
    }

    fn entry(&self) -> Result<keyring::Entry, GithubError> {
        keyring::Entry::new(&self.service, &self.account).map_err(credential_store_error)
    }
}

impl TokenStore for KeyringTokenStore {
    fn load(&self) -> Result<Option<StoredCredential>, GithubError> {
        match self.entry()?.get_password() {
            Ok(raw) => {
                let credential = StoredCredential::from_record(&raw);
                if credential.is_none() {
                    log::warn!(target: "github", "ignoring unreadable GitHub credential entry");
                }
                Ok(credential)
            }
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(error) => Err(credential_store_error(error)),
        }
    }

    fn save(&self, credential: &StoredCredential) -> Result<(), GithubError> {
        self.entry()?
            .set_password(&credential.to_record()?)
            .map_err(credential_store_error)
    }

    fn delete(&self) -> Result<(), GithubError> {
        match self.entry()?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(error) => Err(credential_store_error(error)),
        }
    }
}

fn credential_store_error(error: keyring::Error) -> GithubError {
    GithubError::CredentialStore(error.to_string())
}

/// In-memory store for tests and the isolated E2E build.
#[derive(Default)]
pub struct MemoryTokenStore {
    credential: Mutex<Option<StoredCredential>>,
}

impl MemoryTokenStore {
    pub fn with_credential(credential: StoredCredential) -> Self {
        Self {
            credential: Mutex::new(Some(credential)),
        }
    }
}

impl TokenStore for MemoryTokenStore {
    fn load(&self) -> Result<Option<StoredCredential>, GithubError> {
        Ok(self
            .credential
            .lock()
            .expect("token store poisoned")
            .clone())
    }

    fn save(&self, credential: &StoredCredential) -> Result<(), GithubError> {
        *self.credential.lock().expect("token store poisoned") = Some(credential.clone());
        Ok(())
    }

    fn delete(&self) -> Result<(), GithubError> {
        *self.credential.lock().expect("token store poisoned") = None;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn record_round_trips_token_and_source() {
        let credential = StoredCredential {
            token: AccessToken::parse("gho_round_trip").unwrap(),
            source: TokenSource::GhCli,
        };

        let raw = credential.to_record().unwrap();
        assert_eq!(StoredCredential::from_record(&raw), Some(credential));
    }

    #[test]
    fn unreadable_records_load_as_missing() {
        for raw in [
            "",
            "not json",
            r#"{"token":"","source":"ghCli"}"#,
            r#"{"token":"x"}"#,
        ] {
            assert_eq!(StoredCredential::from_record(raw), None, "{raw:?}");
        }
    }
}
