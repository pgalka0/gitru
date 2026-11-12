# Gitru — Agent Guide

Gitru is a desktop Git client with a native GitHub workflow (issues and pull request review). This repository is an independent hard fork of `ruru-m07/gitru` (GPL-3.0); it does not track upstream. The monorepo contains the Tauri desktop app, shared TS packages, and Rust crates for Git, IPC and the GitHub API.

Use this file for orientation. Prefer reading the relevant package/crate when implementing — do not treat this as an API reference. The feature plan lives in [`docs/roadmap.md`](docs/roadmap.md).

## Monorepo layout

```
apps/
  desktop/   # The product (Tauri + React)
packages/    # Shared TypeScript libraries
crates/      # Shared Rust libraries
```

- **Package manager:** Bun workspaces + Turbo
- **Rust workspace:** `apps/desktop/src-tauri`, `crates/git`, `crates/github`, `crates/ipc`, `crates/logger`
- **Formatting / lint (TS):** Biome
- **Common make targets:** `make setup`, `make dev`, `make typegen`, `make test`, `make format`

## Architecture (high level)

```
┌─────────────────────┐     invoke / events      ┌──────────────────────┐
│  apps/desktop (UI)  │ ◄──────────────────────► │  src-tauri (Tauri)   │
│  React + TanStack   │   @gitru/commands types  │  wires git + ipc     │
└─────────────────────┘                          └──────────┬───────────┘
                                                            │
                          ┌─────────────────────────────────┼───────────────────────┐
                          ▼                                 ▼                       ▼
                   crates/git                        crates/github             crates/ipc
               (git CLI + parsers)               (GitHub API: auth,      (repos, sessions,
                mostly not libgit2)               keychain, GraphQL)       non-git state)
```

**Git strategy:** Prefer invoking the `git` CLI (parsed in Rust) for speed and familiarity. Use `git2` / libgit2 only when you need finer control over long-running or stateful operations (e.g. live clone progress; later things like interactive rebase UI where reliability matters more than raw speed).

---

## `packages/*` (shared TypeScript)

| Package | Role |
|--------|------|
| `@gitru/commands` | Auto-generated type-safe wrappers for Tauri commands (Zod-validated). |
| `@gitru/ui` | Design system built on [coss/ui](https://coss.com/ui/llms.txt) (Base UI). |
| `@gitru/icon` | Custom icons; prefer Lucide for everything else. |
| `@gitru/mascot` | Mascot component, expressions, and animations. |

### Critical: `@gitru/commands`

- **Never hand-edit** anything under `packages/commands/`.
- After changing Tauri command signatures in Rust, regenerate with:

```bash
make typegen
```

That runs `scripts/typegen.sh` → `cargo tauri-typegen generate` into `packages/commands/src`.

### UI

- Import components from `@gitru/ui/components/...`.
- For coss patterns, imports, and pitfalls, use the local skill: `.agents/skills/coss/`.
- Docs map for agents: https://coss.com/ui/llms.txt

---

## `crates/*` (shared Rust)

### `crates/git`

Core Git logic used by the desktop backend.

Typical layout:

- **`runner`** — runs `git` subprocesses (timeouts, options)
- **`parsers/`** — parse CLI output (status, history, branches, stash, graph, …)
- **`models/`** — structured types returned to callers
- **`service/`** — higher-level operations (branch, commit, history, stash, diff, actions, …)
- **`core` / `context` / `cache`** — per-repo service wiring and caching

`AppState` holds a map of repo path → `RepoServices`. Services are created per open repo context.

### `crates/ipc`

Kept **separate from git logic** on purpose: IPC/app concerns should stay independent of Git parsing/services.

Owns things like:

- Repository list / persistence (store)
- Clone / init / add-local flows and progress-oriented work
- Session navigation history (back/forward)
- Other managed state that is not “run git and parse”

Tauri registers many handlers from `ipc::*` and many from `apps/desktop/src-tauri/src/commands/*` (thin wrappers into `crates/git`).

### `crates/github`

GitHub API client. Kept separate from `crates/git`: it talks HTTPS to GitHub, never runs `git`.

- **`auth`** — OAuth Device Flow, import from the GitHub CLI (`gh auth token`), token storage in the OS credential store (`keyring`)
- **`client`** — HTTP client, GraphQL requests, rate-limit tracking, error mapping
- **`models`** — serializable types returned to Tauri commands

Hard rules: the token never leaves Rust (no command returns it to the webview), never enters URLs or logs, and every GitHub call goes through this crate. The webview renders untrusted user content from GitHub, so it must not hold credentials.

### `crates/logger`

Small internal logging helper.

---

## `apps/desktop`

Primary product. **Tauri 2** shell + **Vite** + **React 19**.

### Frontend stack

- **Routing:** TanStack Router (`src/routes/`)
- **Server/async state:** TanStack Query
- **Lists / history graph:** TanStack Virtual
- **UI:** `@gitru/ui` + Lucide / `@gitru/icon`
- **Diff:** Monaco / Pierre diffs, plus custom image-diff views

### Notable frontend areas

| Area | Path | Notes |
|------|------|--------|
| Routes | `src/routes/` | App shell under `/app` (git, inbox, pulls, issues); auth/onboarding |
| Repo state | `src/state/` | Per-repo `RepositoryState` via `RepositoryManager`; Query-backed |
| History graph | `src/components/historyGraph/` | Commit graph / virtualized table |
| Diff | `src/components/diff/` | Text + image diffs |
| Action panel | `src/components/actionPannel/` | Command-palette style flows (clone, branch, checkout, …) |
| Sidebar / chrome | `src/components/sidebar/`, title bar, status bar | App chrome |

### Backend (`src-tauri/`)

- `src/lib.rs` — app setup, plugins, `invoke_handler` registration
- `src/commands/` — Tauri commands that call into `crates/git` (branch, commit, history, stash, diff, actions, …) and `crates/github` (`github.rs`)
- Clone/repo/session commands mostly live in `crates/ipc` and are registered from `lib.rs`

Frontend should call git/IPC/GitHub through **`@gitru/commands`**, not ad-hoc `invoke` string APIs, so types stay in sync after `make typegen` (needs `cargo install tauri-typegen --version 0.4.2 --locked`).

---

## Agent skills (local)

Under `.agents/skills/`:

- **`coss`** — building UI with coss/`@gitru/ui`
- **`emil-design-eng`** — polish / motion / interaction design judgment
- **`react-useeffect`** — when (not) to use Effects

Use these when the task matches; don’t reinvent coss patterns from memory.

---

## Practical rules of thumb

1. **Data path:** UI → `@gitru/commands` → Tauri command → `crates/git`, `crates/github` or `crates/ipc`.
2. **New Tauri commands:** implement in Rust → register in `src-tauri` → `make typegen` → use generated TS API.
3. **Don’t invent a parallel Git layer in TypeScript** that re-parses CLI output; keep parsing in Rust.
4. **UI work:** compose `@gitru/ui` / coss first; custom chrome only when the design system doesn’t cover it.
5. **Scope changes tightly** to the app/package/crate you’re touching; this is a monorepo with clear boundaries.
