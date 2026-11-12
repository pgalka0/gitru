# Roadmap: GitHub workflow

Goal: a desktop client where you can browse issues with the same information as
on github.com, comment on and edit them, see them grouped per repository, and
browse, comment on and review pull requests.

Each phase ships something usable on its own.

| Phase | Scope | Status |
|---|---|---|
| 0. Cut from upstream | Remove updater, analytics, release/signing CI, `apps/web`, `apps/api`; own bundle identifier | Done |
| 1. Foundation | `crates/github`: sign-in (Device Flow, GitHub CLI import), OS keychain, GraphQL client, rate limits; account button in the sidebar; Issues screen listing local GitHub repositories with open issue/PR counts | Done |
| 2. Issues: read | Repository column (open counts), list with filters (state, assigned to me, labels, GitHub search syntax), detail with timeline: comments, events, labels, assignees, milestone, reactions, linked PRs | Next |
| 3. Issues: write | Comment (editor + preview), edit/delete, close/reopen with reason, labels, assignees, milestone, title/body, reactions, new issue; optimistic updates | |
| 4. PRs: read | List per repository; Conversation, Commits, Files changed; checks status | |
| 5. PRs: review | Inline comments (multi-line), suggestions, pending review then submit (Approve / Request changes / Comment), replies, resolve threads, mark file viewed | |
| 6. Later | Inbox from GitHub notifications, offline cache, cross-repository search | |

## Architecture decisions

- **GitHub calls live in Rust (`crates/github`).** The webview renders untrusted
  HTML from GitHub users; a token reachable from JavaScript would turn any XSS
  into account takeover. The CSP keeps `connect-src` closed to `api.github.com`.
- **Token storage:** OS credential store via `keyring` (service = bundle
  identifier `com.pgalka0.gitru`, account `github.com`; the E2E build keeps it
  in memory). Never returned by any command, never logged.
- **Sign-in:** OAuth Device Flow needs an OAuth App `client_id` (not a secret),
  read from `GITRU_GITHUB_CLIENT_ID` at runtime, falling back to the value baked
  in at build time. Without it, the UI offers
  only "Use GitHub CLI token" (`gh auth token`). The CLI token is also the easy
  path for organizations that restrict third-party OAuth apps.
- **API:** GraphQL for reads and most mutations (`timelineItems`,
  `reviewThreads`, `resolveReviewThread` and `markFileAsViewed` exist only
  there); REST for PR files/diff and markdown preview.
- **Rendering "like GitHub":** use `bodyHTML` from GraphQL (GitHub-rendered
  markdown), sanitize with DOMPurify, extend CSP `img-src` with
  `camo.githubusercontent.com` and `*.githubusercontent.com` in phase 2.
- **Repositories (phase 2):** start with repositories added locally whose origin
  is on GitHub (`repository_origin` already resolves `owner`/`repo`). Pinning
  remote-only repositories comes later.
- **PR diffs (phase 4):** for cloned repositories, fetch `refs/pull/N/head` and
  diff `merge-base(base, head)..head` with `crates/git` (full context, no API
  truncation); fall back to REST `pulls/{n}/files`.
- **Inline review (phase 5):** `@pierre/diffs` `DiffLineAnnotation { side,
  lineNumber }` maps 1:1 to GitHub review comments `{ side: LEFT|RIGHT, line }`;
  the hook is already used in `features/git/components/diff-area.tsx`.
- **Refresh:** poll about every 60 s while the window is focused; GitHub does not
  push to desktop clients.
