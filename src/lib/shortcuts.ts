// App shortcuts use Ctrl+Shift / Alt+Shift so they never steal keys Claude Code uses
// (Ctrl+T, Ctrl+B, Ctrl+R, Ctrl+O, Ctrl+L, …).

import { activePane, useStore } from "../state/store";
import { clearTerminal, focusTerminal } from "../terminal/terminals";

export interface Shortcut {
  keys: string;
  label: string;
}

export const SHORTCUTS: Shortcut[] = [
  { keys: "Ctrl+Shift+T", label: "New Claude tab in this folder" },
  { keys: "Ctrl+Shift+N", label: "New PowerShell tab" },
  { keys: "Ctrl+Shift+W", label: "Close pane" },
  { keys: "Alt+Shift+=", label: "Split right" },
  { keys: "Alt+Shift+-", label: "Split down" },
  { keys: "Alt+Arrow", label: "Move between panes" },
  { keys: "Ctrl+Tab", label: "Next tab" },
  { keys: "Ctrl+1…9", label: "Go to tab" },
  { keys: "Ctrl+Shift+F", label: "Find in output" },
  { keys: "Ctrl+Shift+B", label: "Show or hide projects" },
  { keys: "Ctrl+Shift+K", label: "Clear scrollback" },
  { keys: "Ctrl+= / Ctrl+- / Ctrl+0", label: "Text size" },
  { keys: "Ctrl+,", label: "Settings" },
  { keys: "Ctrl+C / Ctrl+V", label: "Copy selection / paste text or screenshot" },
  { keys: "Shift+Enter", label: "New line in Claude's prompt" },
];

function run(e: KeyboardEvent): boolean {
  const s = useStore.getState();
  const key = e.key.toLowerCase();
  const pane = activePane();
  const cwd = pane?.cwd ?? s.homeDir;

  if (e.ctrlKey && e.shiftKey && !e.altKey) {
    switch (e.code) {
      case "KeyT": s.openTab(cwd, "claude"); return true;
      case "KeyN": s.openTab(cwd, "shell"); return true;
      case "KeyW": if (pane) s.closePane(pane.id); return true;
      case "KeyF": if (pane) s.set({ searchOpen: true }); return true;
      case "KeyB": s.set({ sidebarOpen: !s.sidebarOpen }); return true;
      case "KeyK": if (pane) clearTerminal(pane.id); return true;
      case "Tab": s.cycleTab(-1); return true;
    }
  }
  if (e.altKey && e.shiftKey && !e.ctrlKey) {
    if (e.code === "Equal") { s.splitActive("row", "shell"); return true; }
    if (e.code === "Minus") { s.splitActive("column", "shell"); return true; }
  }
  if (e.altKey && !e.ctrlKey && !e.shiftKey) {
    const dir = ({ ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down" } as const)[
      e.key as "ArrowLeft"
    ];
    if (dir) { s.focusNeighbor(dir); return true; }
  }
  if (e.ctrlKey && !e.shiftKey && !e.altKey) {
    if (e.key === "Tab") { s.cycleTab(1); return true; }
    if (/^[1-9]$/.test(key)) {
      const tab = key === "9" ? s.tabs[s.tabs.length - 1] : s.tabs[Number(key) - 1];
      if (tab) s.setActiveTab(tab.id);
      return true;
    }
    const size = s.settings.fontSize;
    if (key === "=" || key === "+") { s.updateSettings({ fontSize: Math.min(28, size + 1) }); return true; }
    if (key === "-") { s.updateSettings({ fontSize: Math.max(9, size - 1) }); return true; }
    if (key === "0") { s.updateSettings({ fontSize: 14 }); return true; }
    if (key === ",") { s.set({ settingsOpen: true }); return true; }
  }
  return false;
}

export function installShortcuts() {
  // Capture phase so app shortcuts are handled before the terminal sees them.
  window.addEventListener(
    "keydown",
    (e) => {
      if (run(e)) {
        e.preventDefault();
        e.stopPropagation();
        const pane = activePane();
        if (pane && !useStore.getState().searchOpen && !useStore.getState().settingsOpen) {
          requestAnimationFrame(() => focusTerminal(pane.id));
        }
      }
    },
    true,
  );
}
