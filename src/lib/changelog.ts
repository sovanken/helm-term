// User-facing release notes shown in Settings → What's new and after an update.
// Keep CHANGELOG.md in the repo root in sync when adding a release.

export interface Release {
  version: string;
  date: string;
  highlights: { title: string; text: string }[];
}

export const CHANGELOG: Release[] = [
  {
    version: "1.0.0",
    date: "October 2026",
    highlights: [
      { title: "Made for Claude Code", text: "Runs the real claude CLI in fast GPU-rendered tabs and split panes, with every language and emoji rendering correctly." },
      { title: "Approve from anywhere", text: "Background tabs ask for permission in Helm and in a Windows notification with Allow / Deny, plus Always allow for things you trust." },
      { title: "Usage limits", text: "Live 5-hour and weekly meters with reset countdown, your pace, which tab used the most, and warnings at 80% and 95%." },
      { title: "Agents tab", text: "Every Claude session grouped into Needs you, Working and Done, with context, cost and what each one is doing (Ctrl+Shift+A)." },
      { title: "Built-in browser", text: "Open your app beside the terminal, test phone and tablet sizes, and send errors, screenshots or any part of the page to Claude in one click." },
      { title: "Files open in Helm", text: "Code with highlighting, Markdown, images, PDF, video and audio open as Helm tabs instead of other apps." },
      { title: "See background agents", text: "The right panel opens when Claude starts a subagent, showing what it's doing and its final answer. Details lists screenshots, files and web pages used." },
      { title: "Save your usage", text: "Usage history by day and project, a reminder to /compact as context fills, a warning before the cache expires, and big pastes attached as a file." },
      { title: "Prompt improver", text: "Write a prompt, let Claude make it clearer, then send it (Ctrl+Shift+I)." },
      { title: "Status on every tab", text: "Working, needs approval or finished, with notifications for tabs you're not looking at." },
      { title: "History and palette", text: "Search every conversation and continue it in one click. Ctrl+Shift+P for saved prompts, Claude commands, skills and actions." },
      { title: "Review changes", text: "Side-by-side diffs, comments sent to Claude, and undo for a whole file or just one part." },
      { title: "Parallel tasks", text: "Run Claude on several tasks at once, each in its own git worktree and branch, then merge or remove them." },
      { title: "Sessions you don't lose", text: "Tabs reopen the same conversations after a restart, and Ctrl+Alt+Shift+T reopens a closed tab." },
      { title: "Clean status bar", text: "Permission mode, prompt cache timer, effort, git push/pull, pull request, usage, cost, context and model. Right-click to choose." },
      { title: "Make it yours", text: "Accent colors, 10 terminal color schemes, Inter and JetBrains Mono built in, resizable panels, Ctrl + mouse wheel zoom and Windows 11 Mica." },
      { title: "Claude Code settings", text: "Edit permissions, hooks, MCP servers and CLAUDE.md without touching JSON." },
      { title: "Windows done right", text: "PowerShell 7, Windows PowerShell or Git Bash per tab, Windows hints for Claude, and screenshot paste with Ctrl+V." },
      { title: "Private by design", text: "Everything stays on your PC. The only network request is the update check, and you can turn it off." },
    ],
  },
];
