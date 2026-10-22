// App shortcuts use Ctrl+Shift / Alt+Shift so they never steal keys Claude Code uses
// (Ctrl+T, Ctrl+B, Ctrl+R, Ctrl+O, Ctrl+L, …).

import { openSettingsJson } from "./settingsJson";
import { activePane, defaultFolder, useStore } from "../state/store";
import { clearTerminal, focusTerminal } from "../terminal/terminals";
import { closeFileSafely, closePaneSafely, closeWorkspaceSafely } from "./actions";
import { focusSidebarSearch } from "../components/HistoryList";
import { t } from "../i18n";

export interface Shortcut {
  keys: string;
  label: string;
}

/** `label` is translated each time it is read, in the current language. */
const sc = (keys: string, labelKey: string): Shortcut => ({
  keys,
  get label() {
    return t(labelKey);
  },
});

export const SHORTCUTS: Shortcut[] = [
  sc("Ctrl+Shift+T", "shortcuts.newClaudeTab"),
  sc("Ctrl+Shift+N", "shortcuts.newTerminalTab"),
  sc("Ctrl+Shift+W", "shortcuts.closePane"),
  sc("Alt+Shift+=", "shortcuts.splitRight"),
  sc("Alt+Shift+-", "shortcuts.splitDown"),
  sc("Alt+Arrow keys", "shortcuts.movePanes"),
  sc("Ctrl+Tab", "shortcuts.nextTab"),
  sc("Ctrl+1…9", "shortcuts.goToTab"),
  sc("Ctrl+Shift+P", "shortcuts.palette"),
  sc("Ctrl+Shift+H", "shortcuts.search"),
  sc("Ctrl+Shift+A", "shortcuts.agents"),
  sc("Ctrl+Alt+Shift+T", "shortcuts.reopenTab"),
  sc("Ctrl+Shift+G", "shortcuts.sidePanel"),
  sc("Ctrl+Shift+I", "shortcuts.composer"),
  sc("Ctrl+Shift+F", "shortcuts.find"),
  sc("Ctrl+Shift+B", "shortcuts.toggleSidebar"),
  sc("Ctrl+Shift+K", "shortcuts.clearScrollback"),
  sc("Ctrl+= / Ctrl+- / Ctrl+0", "shortcuts.textSize"),
  sc("Ctrl+,", "shortcuts.settings"),
  sc("Ctrl+Shift+,", "shortcuts.openSettingsJson"),
  sc("Ctrl+C / Ctrl+V", "shortcuts.copyPaste"),
  sc("Shift+Enter", "shortcuts.newLine"),
];

function run(e: KeyboardEvent): boolean {
  const s = useStore.getState();
  const key = e.key.toLowerCase();
  const pane = activePane();
  const cwd = pane?.cwd ?? defaultFolder();

  if (e.ctrlKey && e.shiftKey && !e.altKey) {
    switch (e.code) {
      case "KeyT": s.openTab(cwd, "claude"); return true;
      case "KeyN": s.openTab(cwd, "shell"); return true;
      case "KeyW":
        if (s.view === "settings") s.closeSettings();
        else if (s.view === "agents") s.closeAgents();
        else if (s.view === "tools") s.closeTools();
        else if (s.view === "snips") s.closeSnips();
        else if (s.view === "workspace") {
          // Closes the open file first, then the project itself.
          const ws = s.workspaces.find((w) => w.id === s.activeWorkspaceId);
          const file = ws?.files.find((f) => f.id === ws.activeFileId);
          if (ws && file) {
            if (file.draft === undefined) s.closeWorkspaceFile(ws.id, file.id);
          } else if (ws) void closeWorkspaceSafely(ws.id);
        }
        else if (s.view === "file") { if (s.activeFileId) void closeFileSafely(s.activeFileId); }
        else if (pane) void closePaneSafely(pane.id);
        return true;
      case "KeyF": if (pane) s.set({ searchOpen: true }); return true;
      case "KeyB": s.set({ sidebarOpen: !s.sidebarOpen }); return true;
      case "KeyP": s.set({ paletteOpen: !s.paletteOpen }); return true;
      case "KeyA": if (s.view === "agents") s.closeAgents(); else s.openAgents(); return true;
      case "KeyG": s.set({ changesOpen: !s.changesOpen }); return true;
      case "KeyI": s.set({ composerOpen: !s.composerOpen }); return true;
      case "KeyH":
        focusSidebarSearch();
        return true;
      case "KeyK": if (pane) clearTerminal(pane.id); return true;
      case "Tab": s.cycleTab(-1); return true;
    }
  }
  if (e.ctrlKey && e.altKey && e.shiftKey && e.code === "KeyT") {
    s.reopenClosedTab();
    return true;
  }
  if (e.altKey && e.shiftKey && !e.ctrlKey) {
    if (e.code === "Equal") { s.splitActive("row", "shell"); return true; }
    if (e.code === "Minus") { s.splitActive("column", "shell"); return true; }
  }
  if (e.altKey && !e.ctrlKey && !e.shiftKey && s.view === "terminal") {
    const dir = ({ ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down" } as const)[
      e.key as "ArrowLeft"
    ];
    if (dir) { s.focusNeighbor(dir); return true; }
  }
  if (e.ctrlKey && e.shiftKey && !e.altKey && e.code === "Comma") { void openSettingsJson(); return true; }
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
    if (key === ",") { s.openSettings(); return true; }
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
        const st = useStore.getState();
        if (pane && st.view === "terminal" && !st.searchOpen && !st.paletteOpen && !st.promptsOpen && !st.composerOpen) {
          requestAnimationFrame(() => focusTerminal(pane.id));
        }
      }
    },
    true,
  );
}
