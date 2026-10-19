// User-facing release notes shown in Settings → What's new and after an update.

export interface Release {
  version: string;
  date: string;
  highlights: { title: string; text: string }[];
}

export const CHANGELOG: Release[] = [
  {
    version: "0.4.0",
    date: "October 2026",
    highlights: [
      { title: "Approve from anywhere", text: "Background tabs ask for permission in Helm and in a Windows notification with Allow / Deny, and Always allow for things you trust." },
      { title: "Usage limits", text: "Live 5-hour and weekly meters with reset countdown, your pace, which tab used the most, and warnings at 80% and 95%." },
      { title: "Agents tab", text: "Every Claude session grouped into Needs you, Working and Done (Ctrl+Shift+A)." },
      { title: "Review like a pull request", text: "Comment on lines in the diff, send all comments to Claude, and undo one part of a file." },
      { title: "New status bar", text: "Clean chips with permission mode, cache timer, effort, git push/pull, pull request and more. Right-click to choose items." },
      { title: "Appearance", text: "Accent colors, 10 terminal color schemes, Inter and JetBrains Mono built in, line height, cursor style, interface size and Windows 11 Mica." },
      { title: "Resizable panels and zoom", text: "Drag the sidebar and changes panel edges. Ctrl + mouse wheel zooms the terminal text, or the interface outside a terminal." },
      { title: "Production settings", text: "Start with Windows, starting folder, scrollback, copy on select, bell, paste warning, notification types, backup and reset." },
      { title: "Shells and sessions", text: "PowerShell 7, Windows PowerShell or Git Bash per tab, Windows hints for Claude, and Ctrl+Alt+Shift+T to reopen a closed tab." },
    ],
  },
  {
    version: "0.3.0",
    date: "October 2026",
    highlights: [
      { title: "Parallel tasks", text: "Run Claude on several tasks at once, each in its own git worktree and branch." },
      { title: "Claude Code settings", text: "Edit permissions, hooks, MCP servers and CLAUDE.md without touching JSON." },
      { title: "Export and updates", text: "Save conversations as Markdown. Helm updates itself." },
    ],
  },
  {
    version: "0.2.0",
    date: "October 2026",
    highlights: [
      { title: "History, palette and changes", text: "Search every conversation, Ctrl+Shift+P for prompts and commands, and a changes panel with side-by-side diffs." },
    ],
  },
];
