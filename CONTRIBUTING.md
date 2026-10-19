# Contributing to Helm

Thanks for helping! Bug reports, ideas and pull requests are all welcome.

## Reporting bugs and ideas

Use the [issue templates](https://github.com/sovanken/helm-term/issues/new/choose). For bugs, include your
Helm version (Settings → About), Windows version, and the steps to reproduce. If the window showed
"Something went wrong", paste the copied details.

Security problems: please **don't** open a public issue — see [SECURITY.md](SECURITY.md).

## Development setup

Prerequisites: [Rust](https://rustup.rs) (stable), Node.js 22+, and the
[Tauri prerequisites](https://tauri.app/start/prerequisites/) for Windows (Visual Studio C++ build tools, WebView2).

```powershell
npm install
npm run tauri dev      # run Helm with hot reload
npm test               # TypeScript unit tests (Vitest)
cd src-tauri; cargo test --lib   # Rust unit tests
npm run build          # type-check + production web build
```

## Project layout

| Path | What lives there |
| --- | --- |
| `src/` | React UI (TypeScript, Tailwind CSS 4) |
| `src/terminal/terminals.ts` | xterm.js instances, PTY wiring, links, clipboard |
| `src/state/` | App state (Zustand), backend events, persistence |
| `src/components/` | UI components; `SettingsPage.tsx`, `StatusBar.tsx`, `Sidebar.tsx`… |
| `src-tauri/src/pty.rs` | ConPTY sessions |
| `src-tauri/src/bridge.rs` | Local HTTP bridge for Claude Code hooks, approvals and status line |
| `src-tauri/src/shell.rs` | Shell launch (PowerShell / Git Bash) and the `claude` wrapper |
| `src-tauri/src/git.rs`, `worktrees.rs` | Changes panel and parallel tasks |
| `src-tauri/src/sessions.rs`, `export.rs` | History, status numbers and Markdown export from transcripts |

## Guidelines

- Keep app shortcuts on Ctrl+Shift / Alt+Shift so Claude Code keeps its own keys.
- Use plain, friendly words in the UI (no internal jargon).
- Never write to the user's Claude Code settings except from the Settings screen, and only the
  `permissions` / `hooks` keys.
- Nothing leaves the user's PC except the update check. Don't add telemetry.
- Add or update unit tests for logic you change; CI runs `npm test` and `cargo test`.
- Match the surrounding code style; run `npm run build` before opening a pull request.

## Releasing (maintainers)

1. Bump the version in `package.json`, `src-tauri/Cargo.toml` and `src-tauri/tauri.conf.json`.
2. Add the notes to `CHANGELOG.md` and `src/lib/changelog.ts`.
3. Tag and push: `git tag v1.2.3 && git push origin v1.2.3`. The Release workflow builds and signs the installer and publishes `latest.json` for auto-update.

By contributing you agree that your contributions are licensed under the [MIT License](LICENSE).
