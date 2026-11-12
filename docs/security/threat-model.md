# Desktop threat model

Gitru renders local repository data in a Tauri webview and exposes native Git and
filesystem operations through typed commands. Treat repository names, paths,
commit messages, diffs, remotes, and hosted-service responses as untrusted.

## Assets and trust boundaries

- **Credentials and tokens:** Git credentials remain with Git/credential helpers.
  Hosted-service tokens must use the operating-system credential store when that
  integration is added; they must not enter URLs, analytics, or logs.
- **Repository and filesystem data:** command inputs are scoped to an open
  repository context. File operations must preserve the existing service-layer
  path checks and must not accept arbitrary web content as a path.
- **Native commands:** only local application webviews receive IPC access. The
  main webview owns child-webview capabilities. Embedded tab webviews receive
  read-only app-store access and the directory picker, but no opener,
  notification, or webview-management plugin access.
- **Remote content:** external navigation crosses a backend HTTPS-only validator.
  Remote images are limited to the explicitly listed avatar hosts and the CSP
  blocks all other image and network origins.

## Expected attackers

The primary inputs are a malicious repository, crafted Git metadata, a hostile
remote URL, or compromised remote image infrastructure. The security
boundary must also limit the impact of a frontend injection bug. Gitru does not
claim to defend a user whose operating-system account or Git executable is
already compromised.

## Controls and review requirements

1. Keep the CSP deny-by-default. Add a host only for a documented feature and
   constrain it to the narrowest directive.
2. Add plugin permissions to the webview that uses them, never a wildcard
   window capability. New native commands must validate untrusted strings in
   Rust even if the frontend already validates them.
3. Never log repository paths, remotes, commit data, diffs, file contents,
   credentials, tokens, or raw command errors. Operational logs may include the
   command name, duration, and a non-sensitive error category.
4. Security tests must cover rejected URL schemes/credentials and remote-content
   host allowlists. A packaged build must be exercised when CSP sources change.

## Telemetry and updates

This fork ships no analytics and no self-updater. The app makes no network
requests besides Git network operations the user starts, avatar images, and
(once signed in) GitHub API calls made from the Rust backend.
