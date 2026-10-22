# Helm

[![CI](https://github.com/sovanken/helm-term/actions/workflows/ci.yml/badge.svg)](https://github.com/sovanken/helm-term/actions/workflows/ci.yml)
[![Latest release](https://img.shields.io/github/v/release/sovanken/helm-term?label=download)](https://github.com/sovanken/helm-term/releases/latest)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Windows 10 / 11](https://img.shields.io/badge/platform-Windows%2010%20%7C%2011-informational)

**A terminal made for Claude Code.** Helm runs the real `claude` CLI and adds what a terminal built
around Claude should have: status on every tab, approvals from anywhere, usage limits, conversation
history, a changes panel, parallel tasks, and tabs that reopen the same conversation. Plus voice input,
screenshots, developer tools and a project file browser, in 11 languages.

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
- **See every agent at once.** The Agents page shows every Claude conversation grouped into *Needs you*, *Working* and *Finished*, with what each is doing right now, context used and cost, plus a Usage tab for the last 7, 14 or 30 days by project and model.
- **Talk instead of typing.** Hold Ctrl+Space (or click the mic) and speak. Speech becomes text on your own PC, with nothing sent anywhere, and lands in Claude's prompt for you to check and send.
- **Review like a pull request.** Comment on lines in the diff and send all comments to Claude in one go, and undo a single part of a file instead of the whole file.
- **Sessions you can't lose.** Tabs come back after a crash or restart and resume in the right folder; reopen closed tabs with Ctrl+Alt+Shift+T.
- **Windows done right.** PowerShell 7, Windows PowerShell or Git Bash per tab, and Helm tells Claude which shell syntax to use so it stops mixing them up.

## Features

**Working with Claude**
- **Project launcher**: your recent Claude Code projects are found automatically; one click starts Claude there.
- **Status on every tab**: working, needs your approval, or finished, reported by Claude Code hooks (no screen scraping), with Windows notifications.
- **Paste screenshots** with Ctrl+V, **drop files** to insert their paths, and **click file paths** like `src/app.ts:42` to open that line in VS Code.
- **Status bar**: Claude's state, permission mode (click to switch), prompt cache timer, effort, git branch with push/pull counts, pull request, usage limits, cost, context and model. Right-click to choose what shows.

**Projects and files**
- **Sidebar** with your projects and their conversations: search, sort, collapse all, color labels, and a privacy blur for screen sharing. Each conversation can be continued, branched off, renamed, pinned, exported or deleted.
- **Project menu**: open files, Claude Code settings (CLAUDE.md, settings.json), usage, export all conversations, delete old ones, open on GitHub, and a safe **rename** or **delete to the Recycle Bin** that checks the folder isn't protected or in use first, and keeps your conversations with a renamed folder.
- **Project files**: browse a project like VS Code's explorer, with quick open (Ctrl+P), search in files (Ctrl+Shift+F), git colors and file operations. Files open in Helm with an editor for text and Markdown, previews for images, PDF, video and audio.

**Finding and reusing**
- **Conversation search** with full text; click one to continue it, or export it to Markdown.
- **Command palette (Ctrl+Shift+P)**: saved prompts, Claude slash commands (built-in, yours and skills), actions, projects and conversations.
- **Saved prompts**: a library for prompts you type often; inserted into the prompt, never sent without you.

**Changes and parallel work**
- **Side panel (Ctrl+Shift+G)**: **Changes** (every file changed since the last commit, side-by-side diff, review comments, undo per file or per part), **Background** (subagents and background commands, what they're doing now and their answers, formatted) and **Details** (files, links and screenshots used in the conversation).
- **Parallel tasks**: start Claude on another task in its own copy of the project on its own branch; merge or delete it from the sidebar.

**Tools**
- **Screenshots (Ctrl+Alt+S, from any app)**: area, window, freeform or full screen, with a delay. Mark up with arrows, boxes, text, pen, numbered steps and blur, then copy, save or send to Claude.
- **Developer tools**: color picker, image tools, screen ruler, JSON tools, encode and decode, regex tester, compare text, UUID / password / hash generators, time converter, placeholder text, ports in use, API tester, environment variables and a scratchpad.
- **Phones for testing**: a connected Android phone appears in the status bar, where you can mirror its screen, read your app's logs, take a screenshot or see its details.

**Settings**
- **Settings tab (Ctrl+,)** with search: General, Appearance, Terminal, Notifications, Claude in Helm, Keyboard shortcuts, Privacy, Advanced, What's new and About. Changed settings are marked and can be reset one by one.
- **settings.json (Ctrl+Shift+,)**: edit Helm's settings as a file, like VS Code, with suggestions, descriptions on hover and mistakes underlined. Comments are allowed.
- **11 languages**: English, Français, Deutsch, हिन्दी, Bahasa Indonesia, Italiano, 日本語, 한국어, Português (Brasil), Español (Latinoamérica) and Español (España). Helm follows your Windows language by default.
- **Claude Code settings** without JSON: permissions (allow / ask / deny), hooks, MCP servers and CLAUDE.md, for all projects, this project, or only you.
- **Appearance**: dark / light / system, accent colors, 10 terminal color schemes, Inter and JetBrains Mono built in, line height, cursor style, interface size and Windows 11 Mica.

**Terminal**
- Tabs (drag to reorder) and split panes, resizable panels, Ctrl + mouse wheel zoom, find in output, and text in any language plus emoji.
- App shortcuts use Ctrl+Shift / Alt+Shift, so Ctrl+T, Ctrl+B, Ctrl+R, Ctrl+O, Ctrl+K and friends still reach Claude.

| Shortcut | Action |
| --- | --- |
| Ctrl+Shift+T / Ctrl+Shift+N | New Claude tab / new terminal tab |
| Ctrl+Shift+W | Close pane |
| Alt+Shift+= / Alt+Shift+- | Split right / down |
| Alt+Arrow | Move between panes |
| Ctrl+Tab, Ctrl+1…9 | Switch tabs |
| Ctrl+Alt+Shift+T | Reopen closed tab |
| Ctrl+Shift+P | Command palette |
| Ctrl+Shift+A | Agents: conversations, approvals and usage limits |
| Ctrl+Shift+H | Search projects and conversations |
| Ctrl+Shift+G | Side panel: changes, background work and details |
| Ctrl+Alt+S | Take a screenshot (works from any app) |
| Ctrl+Space (hold) | Voice input in a Claude tab |
| Ctrl+Shift+F | Find in output |
| Ctrl+C / Ctrl+V | Copy selection / paste text or screenshot |
| Shift+Enter | New line in Claude's prompt |
| Ctrl + mouse wheel | Terminal text size (over a terminal) or interface size |
| Ctrl+, / Ctrl+Shift+, | Settings / settings.json |

## Privacy

Everything stays on your PC. Helm has no account, no server and no analytics. On its own, Helm only
goes online to check GitHub Releases for updates, which you can turn off in Settings → Privacy.
Anything else happens only when you start it: downloading the voice model (from the sherpa-onnx
releases on GitHub), requests you send from the API tester, and pages you open in a Helm browser tab.
Voice input runs entirely on your PC.
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
- **Text looks wrong or blurry.** Turn off Settings → Terminal → Hardware acceleration.
- **Voice input hears nothing.** Check Settings → General → Voice input → Microphone (Test shows the level), and that Windows allows apps to use the microphone (Windows Settings → Privacy & security → Microphone).
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

## Translations

Helm's text lives in `src/i18n/locales/<language>/`. The translations were written carefully but
haven't all been checked by native speakers yet, so corrections are very welcome: see
[src/i18n/TRANSLATING.md](src/i18n/TRANSLATING.md).

## Contributing and security

Contributions are welcome: see [CONTRIBUTING.md](CONTRIBUTING.md) and the
[code of conduct](CODE_OF_CONDUCT.md). Please report security problems privately as described in
[SECURITY.md](SECURITY.md). Release notes are in [CHANGELOG.md](CHANGELOG.md).

## License

[MIT](LICENSE). Bundled fonts (Inter, Geist, JetBrains Mono) are under the SIL Open Font License 1.1. File and folder icons are from [Material Icon Theme](https://github.com/material-extensions/vscode-material-icon-theme) (MIT).

Voice input uses [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) (Apache-2.0) with ONNX Runtime
(MIT), [Silero VAD](https://github.com/snakers4/silero-vad) (MIT) and NVIDIA's
[Parakeet TDT 0.6B v2](https://huggingface.co/nvidia/parakeet-tdt-0.6b-v2) speech model
(CC-BY-4.0), downloaded on first use.
