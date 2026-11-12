# Desktop privacy

Gitru works with repositories on your computer. Repository content is processed
locally unless you explicitly run a Git network operation such as fetch, pull,
push, or clone.

This fork contains no usage analytics and no automatic update checks.

When you sign in to GitHub, the access token is stored in the operating-system
credential store (Keychain, Windows Credential Manager, or Secret Service) and is
used only by the app's Rust backend to call the GitHub API. The token is never
exposed to the web view, written to logs, or placed in URLs.

Avatar images are requested only from GitHub or Bitbucket for identities already
shown in the interface. External links open in the system browser only after an
HTTPS validation check.
