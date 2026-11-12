<div align="center">
  <img width="128" height="128" alt="Gitru" src="https://github.com/user-attachments/assets/aaa17f7b-f1ff-41c1-8601-a125155bb7d7" />
</div>

# Gitru (fork)

A desktop Git client built with Tauri, React and Rust, extended with a native
GitHub workflow: issues grouped per repository, comments and edits, and pull
request review.

This is an independent hard fork of [ruru-m07/gitru](https://github.com/ruru-m07/gitru),
licensed under the [GNU GPL v3](LICENSE) like the original. It ships no
analytics and no self-updater.

- Roadmap: [docs/roadmap.md](docs/roadmap.md)
- Agent and contributor guide: [AGENTS.md](AGENTS.md)
- Security model: [docs/security/threat-model.md](docs/security/threat-model.md)

## Development

```bash
make setup   # bun install + cargo build
make dev     # run the desktop app with Tauri
make test    # frontend + Rust tests
```

## Security

See [SECURITY.md](SECURITY.md).
