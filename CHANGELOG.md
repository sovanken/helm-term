# Changelog

All notable changes to Helm are listed here. Helm follows [Semantic Versioning](https://semver.org).
The same notes appear in the app under **Settings → What's new** (`src/lib/changelog.ts`).

## 1.0.2 — October 2026

### New
- **11 languages:** English, Français, Deutsch, हिन्दी, Bahasa Indonesia, Italiano, 日本語, 한국어, Português (Brasil), Español (Latinoamérica) and Español (España), the same languages Claude offers. Helm follows the Windows language by default; change it in the gear menu or Settings → Appearance.
- **Voice input:** hold Ctrl+Space or click the mic on a Claude tab and speak. Speech becomes text on your PC with NVIDIA Parakeet (English) through sherpa-onnx; nothing is sent anywhere. Words are typed into the prompt as you pause, and you press Enter to send. One-time model download (about 460 MB) on first use.
- **Screenshots:** area, window, freeform or full screen, with a delay or Ctrl+Alt+S from any app. Mark up with arrows, boxes, text, pen, numbered steps and blur; copy, save or send to Claude; history of recent screenshots.
- **Developer tools:** color picker, image tools, screen ruler, JSON tools, encode/decode, regex tester, compare text, UUID/password/hash generators, time converter, placeholder text, ports in use, API tester, environment variables and a scratchpad.
- **Project files:** browse a project like VS Code's explorer, with quick open, search in files, git colors and file operations, and a built-in editor for text and Markdown.
- **Phones for testing:** a connected Android phone shows in the status bar: mirror its screen, read your app's logs, take a screenshot, see details, switch to Wi-Fi.
- **settings.json:** edit Helm's settings as a file (Ctrl+Shift+,), with suggestions, descriptions and checks; comments allowed. Changed settings are marked on the Settings page and can be reset one by one.
- **Gear menu:** command palette, settings, settings.json, keyboard shortcuts, theme, language, Claude Code settings, What's new, check for updates, report a problem and About.
- **New file menu:** create Markdown or text notes in the current folder from the + menu.

### Improved
- **Sidebar:** one list of projects with their conversations, a Running now group, and a toolbar with search, sort, collapse all, privacy blur and new project.
- **Project menu:** rename the folder (its conversations move with it) or move it to the Recycle Bin, with checks for protected folders, permission and folders in use; remove from list, color labels, copy path, Claude settings files, usage, export all conversations, delete old conversations, open on GitHub and copy clone URL.
- **Conversation menu:** branch off, continue beside, read in a tab, rename, pin, hide, delete, files it changed and copy the resume command.
- **Agents page:** Live and Usage tabs (last 7, 14 or 30 days, split by real project), and a details view with what happened, files, context and cost.
- **Side panel:** the Agents tab is now **Background**, with a cleaner card design and answers shown as formatted Markdown. Details shows file icons, counts and quick copy.
- **Loading:** screens show a shimmer while they load instead of "Loading…" text or a brief empty state.
- **Startup:** a splash screen instead of a see-through window for the first moments.
- **Wording:** one word per idea across the app (conversation, side panel, Recycle Bin, Show in File Explorer…).

### Fixed
- Background commands no longer stay "running" after they finish.
- Links opened from Helm (Open on GitHub, Report a problem, Open in default browser) were blocked; they open in your browser again.
- "New PowerShell tab" items now say "New terminal tab", since they open your default shell.
- Very large conversations are no longer cut off when counting usage.

## 1.0.1 — October 2026

- **History:** every conversation's ⋯ menu has "Usage & context details": its context window (exact or estimated), how it grew, tokens and cache, cost, time and tools, with PDF export and Continue.

## 1.0.0 — October 2026

First public release.

### Working with Claude
- Runs the real `claude` CLI in GPU-rendered tabs and split panes; every language and emoji renders correctly.
- Status on every tab (working, needs approval, finished) from Claude Code hooks, with Windows notifications.
- **Approve from anywhere:** background tabs ask for permission in Helm and in a Windows notification with Allow / Deny / Always allow.
- **Usage limits:** live 5-hour and weekly meters, reset countdown, pace, per-tab share, warnings at 80% and 95%.
- **Agents tab:** every session grouped into Needs you / Working / Done.
- **Right panel** with Changes, Agents and Details: background subagents open it automatically and show what they're doing and their final answer; Details lists screenshots, attached and changed files, web pages and MCP tools for the conversation.
- **Save usage:** 14-day usage history by project, /compact suggestions as context fills, a warning before the prompt cache expires, and big pastes attached as a file.
- **Agents page, like /usage and /context:** every usage limit with reset times and your pace, today and 7-day totals (cost, tokens, time, lines), cost by project and model, and a detail view per session: what fills the context (exact via /context, or an estimate), how it grew, tokens and cache, tools used. Export the page or a session as a PDF.
- **New logo:** two stacked terminal panes, replacing the wheel.
- **Built-in browser:** open your app in a Helm tab or beside the terminal (Helm offers it when a dev server starts), test phone, tablet and laptop sizes, and send console errors, failed requests, screenshots or any picked element to Claude. "My browser" is always one click away.
- **Files open in Helm:** code with highlighting, Markdown preview, images, PDF, video and audio, straight from the Details panel.
- **Prompt improver** (Ctrl+Shift+I): write a prompt, let Claude make it clearer, then send it.
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
