# Helm

[![CI](https://github.com/sovanken/helm-term/actions/workflows/ci.yml/badge.svg)](https://github.com/sovanken/helm-term/actions/workflows/ci.yml)
[![Latest release](https://img.shields.io/github/v/release/sovanken/helm-term?label=download)](https://github.com/sovanken/helm-term/releases/latest)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Windows 10 / 11](https://img.shields.io/badge/platform-Windows%2010%20%7C%2011-informational)

**A terminal made for Claude Code.** Helm runs the real `claude` CLI and adds what a terminal built
around Claude should have: status on every tab, approvals from anywhere, usage limits, conversation
history, a changes panel, parallel tasks, and tabs that reopen the same conversation.

Free and open source (MIT). Windows first. No account, no telemetry.

> Helm is an independent community project and is not affiliated with or endorsed by Anthropic.

## Install

1. Install [Claude Code](https://claude.com/claude-code) if you haven't already.
2. Download **Helm_x.y.z_x64-setup.exe** from the [latest release](https://github.com/sovanken/helm-term/releases/latest) and run it.
   No administrator rights are needed.
3. Helm keeps itself up to date after that.

Windows may show a SmartScreen warning because the installer isn't code-signed yet: click
**More info → Run anyway**. Updates themselves are cryptographically signed and verified.

## Why switch

- **Approve from anywhere.** When a Claude tab you're not looking at needs permission, answer it from a Windows notification (Allow / Deny) or Helm's approval inbox, with "Always allow" for things you trust. No more hunting for the tab that's been waiting.
- **Never get surprised by usage limits.** Live 5-hour and weekly limit meters, reset countdown, your current pace, which tab is using the most, and a warning at 80% and 95%.
- **See every agent at once.** The Agents tab shows every Claude session grouped into *Needs you*, *Working* and *Done*, with what each is doing right now, context used and cost.
- **Review like a pull request.** Comment on lines in the diff and send all comments to Claude in one go, and undo a single part of a file instead of the whole file.
- **Sessions you can't lose.** Tabs come back after a crash or restart and resume in the right folder; reopen closed tabs with Ctrl+Alt+Shift+T.
- **Windows done right.** PowerShell 7, Windows PowerShell or Git Bash per tab, and Helm tells Claude which shell syntax to use so it stops mixing them up.

## Features

**Working with Claude**
- **Project launcher**: your recent Claude Code projects are found automatically; one click starts Claude there.
- **Status on every tab**: working, needs your approval, or finished, reported by Claude Code hooks (no screen scraping), with Windows notifications.
- **Paste screenshots** with Ctrl+V, **drop files** to insert their paths, and **click file paths** like `src/app.ts:42` to open that line in VS Code.
- **Status bar**: Claude's state, permission mode (click to switch), prompt cache timer, effort, git branch with push/pull counts, pull request, usage limits, cost, context and model. Right-click to choose what shows.

**Finding and reusing**
- **Conversation history** with full-text search; click one to continue it, or export it to Markdown.
- **Command palette (Ctrl+Shift+P)**: saved prompts, Claude slash commands (built-in, yours and skills), actions, projects and conversations.
- **Saved prompts**: a library for prompts you type often; inserted into the prompt, never sent without you.

**Changes and parallel work**
- **Changes panel (Ctrl+Shift+G)**: every file changed since the last commit, side-by-side diff, review comments, and undo per file or per part.
- **Parallel tasks**: start Claude on another task in its own git worktree and branch; merge or remove it from the sidebar.

**Settings**
- **Settings tab (Ctrl+,)** with search: General, Appearance, Terminal, Notifications, Claude in Helm, Keyboard shortcuts, Privacy, Advanced, What's new and About.
- **Claude Code settings** without JSON: permissions (allow / ask / deny), hooks, MCP servers and CLAUDE.md, for all projects, this project, or only you.
- **Appearance**: dark / light / system, accent colors, 10 terminal color schemes, Inter and JetBrains Mono built in, line height, cursor style, interface size and Windows 11 Mica.

**Terminal**
- Tabs (drag to reorder) and split panes, resizable panels, Ctrl + mouse wheel zoom, find in output, and text in any language plus emoji.
- App shortcuts use Ctrl+Shift / Alt+Shift, so Ctrl+T, Ctrl+B, Ctrl+R, Ctrl+O, Ctrl+K and friends still reach Claude.

| Shortcut | Action |
| --- | --- |
| Ctrl+Shift+T / Ctrl+Shift+N | New Claude tab / new shell tab |
| Ctrl+Shift+W | Close pane |
| Alt+Shift+= / Alt+Shift+- | Split right / down |
| Alt+Arrow | Move between panes |
| Ctrl+Tab, Ctrl+1…9 | Switch tabs |
| Ctrl+Alt+Shift+T | Reopen closed tab |
| Ctrl+Shift+P | Command palette |
| Ctrl+Shift+A | Agents: sessions, approvals and usage |
| Ctrl+Shift+H | Conversation history |
| Ctrl+Shift+G | Changes panel |
| Ctrl+Shift+F | Find in output |
| Ctrl+C / Ctrl+V | Copy selection / paste text or screenshot |
| Shift+Enter | New line in Claude's prompt |
| Ctrl + mouse wheel | Terminal text size (over a terminal) or interface size |
| Ctrl+, | Settings |

## Privacy

Everything stays on your PC. Helm has no account, no server and no analytics. The only network
request is the update check against GitHub Releases, which you can turn off in Settings → Privacy.
Helm reads the conversation files Claude Code already keeps on your computer to show history, usage
and cost, and never uploads them. Claude Code itself talks to Anthropic under
[Anthropic's privacy policy](https://www.anthropic.com/legal/privacy).

## How it works

Every pane is a shell (PowerShell or Git Bash) running in a ConPTY pseudo-terminal, rendered with
xterm.js (WebGL). Helm wraps the `claude` command in each pane so it starts with `--settings <file>`
that adds status hooks for that pane only. The hooks send small JSON events to a local, key-protected
HTTP endpoint on `127.0.0.1`, which drives the tab status and notifications. Permission requests from
background tabs use an `http` `PermissionRequest` hook that Helm answers (or hands back to the terminal
prompt if you don't), and the usage meters come from Claude's status-line data. Helm only adds its
status line when you haven't configured your own.

History, export and the status bar read the transcripts Claude Code already keeps in
`~/.claude/projects`. The changes panel and parallel tasks use plain git (parallel tasks are created
with Claude Code's own `--worktree` option). Your Claude Code settings files are only changed when you
edit them in the Settings tab; Helm then touches only the `permissions` and `hooks` keys and keeps a
one-time `.helm-backup` copy. MCP servers are managed through `claude mcp`.

## Requirements

- Windows 10 (1809+) or Windows 11
- [Claude Code](https://claude.com/claude-code) installed and on your `PATH`
- Git, for the changes panel and parallel tasks
- Optional: VS Code (`code` on `PATH`) for clickable file paths; Git for Windows for Git Bash tabs

## Troubleshooting

- **Tabs don't show Claude's status.** Start Claude inside a Helm tab (not from another terminal), and make sure `curl.exe` exists (it ships with Windows 10 and 11).
- **No usage limits shown.** Limits appear after Claude's first reply, for Claude Pro and Max plans or team spend limits. If you set up your own Claude status line, Helm leaves it alone and can't show limits.
- **Text looks wrong or blurry.** Turn off Settings → Terminal → GPU rendering.
- **Something went wrong screen.** Click *Copy details* and [open an issue](https://github.com/sovanken/helm-term/issues/new/choose).

## Build from source

Prerequisites: [Rust](https://rustup.rs), Node.js 22+, and the
[Tauri prerequisites](https://tauri.app/start/prerequisites/) (Visual Studio C++ build tools, WebView2).

```powershell
npm install
npm run tauri dev     # run in development
npm test              # TypeScript tests
cd src-tauri; cargo test --lib   # Rust tests
npm run tauri build   # build the installer (src-tauri/target/release/bundle/nsis)
```

Built with Tauri 2, React 19, TypeScript 7, Tailwind CSS 4 and xterm.js 6. See
[CONTRIBUTING.md](CONTRIBUTING.md) for the project layout and guidelines.

## Releasing

Bump the version in `package.json`, `src-tauri/Cargo.toml` and `src-tauri/tauri.conf.json`, add notes
to `CHANGELOG.md` and `src/lib/changelog.ts`, then push a matching tag:

```powershell
git tag v1.0.0
git push origin v1.0.0
```

The **Release** workflow builds the installer, signs the update with the `TAURI_SIGNING_PRIVATE_KEY`
repository secret, and publishes the release with `latest.json`, which installed copies of Helm check
for updates.

## Contributing and security

Contributions are welcome: see [CONTRIBUTING.md](CONTRIBUTING.md) and the
[code of conduct](CODE_OF_CONDUCT.md). Please report security problems privately as described in
[SECURITY.md](SECURITY.md). Release notes are in [CHANGELOG.md](CHANGELOG.md).

## License

[MIT](LICENSE). Bundled fonts (Inter, Geist, JetBrains Mono) are under the SIL Open Font License 1.1.
