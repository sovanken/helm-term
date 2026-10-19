# Changelog

All notable changes to Helm are listed here. Helm follows [Semantic Versioning](https://semver.org).
The same notes appear in the app under **Settings → What's new** (`src/lib/changelog.ts`).

## 1.0.0 — October 2026

First public release.

### Working with Claude
- Runs the real `claude` CLI in GPU-rendered tabs and split panes; every language and emoji renders correctly.
- Status on every tab (working, needs approval, finished) from Claude Code hooks, with Windows notifications.
- **Approve from anywhere:** background tabs ask for permission in Helm and in a Windows notification with Allow / Deny / Always allow.
- **Usage limits:** live 5-hour and weekly meters, reset countdown, pace, per-tab share, warnings at 80% and 95%.
- **Agents tab:** every session grouped into Needs you / Working / Done.
- Tabs reopen the same conversations after a restart; Ctrl+Alt+Shift+T reopens a closed tab.
- Screenshot paste with Ctrl+V, file drop, clickable `file:line` links that open in VS Code.

### Finding, reviewing and parallel work
- Conversation history with full-text search; export to Markdown.
- Command palette (Ctrl+Shift+P) with saved prompts, Claude commands and skills.
- Changes panel with side-by-side diffs, review comments sent to Claude, and undo per file or per part.
- Parallel tasks in their own git worktrees, with merge and remove.

### Settings and polish
- Settings tab with search: General, Appearance, Terminal, Notifications, Claude in Helm, Keyboard shortcuts, Privacy, Advanced, What's new, About.
- Claude Code settings: permissions, hooks, MCP servers and CLAUDE.md per scope.
- Accent colors, 10 terminal color schemes, bundled Inter and JetBrains Mono, line height, cursor style, interface size, Windows 11 Mica.
- Resizable panels, Ctrl + mouse wheel zoom, draggable tabs, clean chip status bar (right-click to customise).
- PowerShell 7, Windows PowerShell or Git Bash per tab; Windows hints for Claude.
- Signed automatic updates from GitHub Releases. No telemetry.
