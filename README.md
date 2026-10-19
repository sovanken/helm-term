# Helm

**A terminal made for Claude Code.** Helm runs the real `claude` CLI and adds what a terminal
built around Claude should have: project launcher, per-tab status, notifications, conversation
history, a command palette, a changes panel, parallel tasks, and tabs that reopen the same conversation.

Free and open source (MIT). Windows first.

> Helm is an independent community project and is not affiliated with or endorsed by Anthropic.

## Install

Download **Helm_x.y.z_x64-setup.exe** from the [latest release](https://github.com/sovanken/helm-term/releases/latest)
and run it. Helm keeps itself up to date after that.

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
- **Project launcher** – your recent Claude Code projects are found automatically; one click starts Claude there.
- **Status on every tab** – working, needs your approval, or finished, reported by Claude Code hooks (no screen scraping).
- **Notifications** – a desktop alert when Claude finishes or needs approval in a tab you're not looking at.
- **Tabs reopen the same conversation** – Claude tabs resume their session after a restart.
- **Paste screenshots** – Ctrl+V with an image saves it and inserts the path, so Claude sees the picture.
- **Drop files** to insert their paths, and **click file paths** like `src/app.ts:42` to open that line in VS Code.
- **Live status bar** – Claude's state, folder, git branch, lines changed, session cost, context used (click for `/context`) and model (click for `/model`).

**Finding and reusing**
- **Conversation history** – every Claude Code conversation, grouped by date, with full-text search. Click one to continue it.
- **Command palette (Ctrl+Shift+P)** – saved prompts, Claude slash commands (built-in, your own commands and skills), actions, projects and recent conversations in one search.
- **Saved prompts** – a library for prompts you type often; inserted into the prompt, never sent without you.
- **Export to Markdown** – save any conversation as a readable document (History → ⋯ → Export).

**Changes and parallel work**
- **Changes panel (Ctrl+Shift+G)** – every file changed since the last commit, side-by-side diff, and undo per file.
- **Parallel tasks** – start Claude on a second task in its own git worktree and branch, so several tasks run at once without touching each other. Merge or remove each task from the sidebar.

**Settings**
- **Settings tab (Ctrl+,)** – appearance, behavior and shortcuts, plus Claude Code's own settings: permissions (allow / ask / deny), hooks, MCP servers and CLAUDE.md, for all projects, this project, or only you.
- **Automatic updates** from GitHub Releases.

**Terminal**
- Tabs and split panes, find in output, dark/light/system themes, and text in any language plus emoji renders correctly.
- Shortcuts that don't fight Claude Code: app shortcuts use Ctrl+Shift / Alt+Shift, so Ctrl+T, Ctrl+B, Ctrl+R, Ctrl+O, Ctrl+K and friends still reach Claude.

| Shortcut | Action |
| --- | --- |
| Ctrl+Shift+T / Ctrl+Shift+N | New Claude tab / new PowerShell tab |
| Ctrl+Shift+W | Close pane |
| Alt+Shift+= / Alt+Shift+- | Split right / down |
| Alt+Arrow | Move between panes |
| Ctrl+Tab, Ctrl+1…9 | Switch tabs |
| Ctrl+Shift+P | Command palette |
| Ctrl+Shift+H | Conversation history |
| Ctrl+Shift+A | Agents: sessions, approvals and usage |
| Ctrl+Alt+Shift+T | Reopen closed tab |
| Ctrl+Shift+G | Changes panel |
| Ctrl+Shift+F | Find in output |
| Ctrl+C / Ctrl+V | Copy selection / paste text or screenshot |
| Shift+Enter | New line in Claude's prompt |
| Ctrl+, | Settings |

## How it works

Every pane is PowerShell running in a ConPTY pseudo-terminal, rendered with xterm.js (WebGL).
Helm wraps the `claude` command in each pane so it starts with `--settings <file>` that adds
status hooks for that pane only. The hooks send small JSON events to a local, key-protected
HTTP endpoint on `127.0.0.1`, which drives the tab status and notifications. Permission
requests from background tabs use an `http` `PermissionRequest` hook that Helm answers (or hands
back to the terminal prompt if you don't), and the usage meters come from Claude's status-line
data. Helm only adds its status line when you haven't configured your own.

History, export and the status bar read the transcripts Claude Code already keeps in
`~/.claude/projects`. The changes panel and parallel tasks use plain git (parallel tasks are
created with Claude Code's own `--worktree` option). Your Claude Code settings files are only
changed when you edit them in the Settings tab; Helm then touches only the `permissions` and
`hooks` keys and keeps a one-time `.helm-backup` copy. MCP servers are managed through `claude mcp`.

## Requirements

- Windows 10 (1809+) or Windows 11
- [Claude Code](https://claude.com/claude-code) installed and on your `PATH`
- Git, for the changes panel and parallel tasks
- Optional: VS Code (`code` on `PATH`) for clickable file paths

## Build from source

Prerequisites: [Rust](https://rustup.rs), Node.js 22+, and the
[Tauri prerequisites](https://tauri.app/start/prerequisites/) (Visual Studio C++ build tools, WebView2).

```powershell
npm install
npm run tauri dev     # run in development
npm run tauri build   # build the installer (src-tauri/target/release/bundle/nsis)
```

Built with Tauri 2, React 19, TypeScript 7, Tailwind CSS 4 and xterm.js 6.

## Releasing

Bump the version in `package.json`, `src-tauri/Cargo.toml` and `src-tauri/tauri.conf.json`,
then push a matching tag:

```powershell
git tag v0.4.0
git push origin v0.4.0
```

The **Release** workflow builds the installer, signs the update with the
`TAURI_SIGNING_PRIVATE_KEY` repository secret, and publishes the release with `latest.json`,
which installed copies of Helm check for updates.

## License

[MIT](LICENSE)
