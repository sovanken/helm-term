# Helm

**A terminal made for Claude Code.** Helm runs the real `claude` CLI and adds what a terminal
built around Claude should have: project launcher, per-tab status, notifications, screenshot
paste, clickable file paths and tabs that reopen the same conversation.

Free and open source (MIT). Windows first.

> Helm is an independent community project and is not affiliated with or endorsed by Anthropic.

## Features

- **Project launcher** – your recent Claude Code projects are found automatically; one click starts Claude there.
- **Status on every tab** – working, needs your approval, or finished, reported by Claude Code hooks (no screen scraping).
- **Notifications** – a desktop alert when Claude finishes or needs approval in a tab you're not looking at.
- **Tabs reopen the same conversation** – Claude tabs resume their session after a restart.
- **Paste screenshots** – Ctrl+V with an image saves it and inserts the path, so Claude sees the picture.
- **Drop files** to insert their paths.
- **Clickable file paths** – `src/app.ts:42` in Claude's output opens that line in VS Code.
- **Tabs and split panes**, find in output, dark/light themes, Khmer and emoji rendering.
- **Shortcuts that don't fight Claude Code** – app shortcuts use Ctrl+Shift / Alt+Shift, so Ctrl+T, Ctrl+B, Ctrl+R, Ctrl+O and friends still reach Claude.

| Shortcut | Action |
| --- | --- |
| Ctrl+Shift+T / Ctrl+Shift+N | New Claude tab / new PowerShell tab |
| Ctrl+Shift+W | Close pane |
| Alt+Shift+= / Alt+Shift+- | Split right / down |
| Alt+Arrow | Move between panes |
| Ctrl+Tab, Ctrl+1…9 | Switch tabs |
| Ctrl+Shift+F | Find in output |
| Ctrl+C / Ctrl+V | Copy selection / paste text or screenshot |
| Shift+Enter | New line in Claude's prompt |
| Ctrl+, | Settings |

## How it works

Every pane is PowerShell running in a ConPTY pseudo-terminal, rendered with xterm.js (WebGL).
Helm wraps the `claude` command in each pane so it starts with `--settings <file>` that adds
hooks for that pane only. Your own `~/.claude/settings.json` is never modified. The hooks
send small JSON events to a local, key-protected HTTP endpoint on `127.0.0.1`, which drives
the tab status and notifications.

## Requirements

- Windows 10 (1809+) or Windows 11
- [Claude Code](https://claude.com/claude-code) installed and on your `PATH`
- Optional: VS Code (`code` on `PATH`) for clickable file paths

## Build from source

Prerequisites: [Rust](https://rustup.rs), Node.js 22+, and the
[Tauri prerequisites](https://tauri.app/start/prerequisites/) (Visual Studio C++ build tools, WebView2).

```powershell
npm install
npm run tauri dev     # run in development
npm run tauri build   # build the installer (src-tauri/target/release/bundle/nsis)
```

Built with Tauri 2, React 19, TypeScript, Tailwind CSS 4 and xterm.js 6.

## Roadmap

- Session history sidebar with search and resume
- Command palette and saved prompts
- Changes panel: see and undo what Claude changed (git)
- Live status bar: model, context, cost, branch
- Parallel tasks in git worktrees
- Settings screen for permissions, hooks, MCP servers and CLAUDE.md
- Export a session to Markdown
- Automatic updates

## License

[MIT](LICENSE)
