import { create } from "zustand";
import { type Direction, type LayoutNode, type SplitDir, leaf, neighbor, paneIds, remove, setRatio, split } from "../lib/layout";
import type { SessionInfo } from "../lib/ipc";
import type { ThemeMode } from "../lib/themes";
import { DEFAULT_FONT } from "../lib/themes";

export type PaneKind = "claude" | "shell";

/**
 * idle: nothing running / seen · working: Claude is busy · attention: Claude is waiting on you
 * (usually a permission prompt) · done: Claude finished and you have not looked yet.
 */
export type PaneStatus = "idle" | "working" | "attention" | "done";

export interface Pane {
  id: string;
  /** How the pane was opened. */
  kind: PaneKind;
  cwd: string;
  /** True while a Claude session is running in the pane (reported by hooks). */
  claudeActive: boolean;
  sessionId?: string;
  /** Set when restoring a tab: resume this Claude session on launch. */
  resumeSessionId?: string;
  /** Launch Claude in a new git worktree with this name (parallel task); used once at launch. */
  worktree?: string;
  status: PaneStatus;
  /** Terminal title set by the running program (Claude Code puts its task summary here). */
  title?: string;
  attentionMessage?: string;
  /** Transcript file of the running Claude session (from hook payloads). */
  transcriptPath?: string;
  /** Shell this pane runs ("pwsh", "powershell", "bash"); defaults to the settings choice. */
  shell?: string;
  /** Live numbers from Claude's status line. */
  stats?: PaneStats;
  /** What Claude is doing right now, e.g. "Bash: npm test". */
  doing?: string;
  /** Running subagents. */
  subagents?: number;
  /** Last time Claude reported anything (ms). */
  lastActivity?: number;
}

export interface PaneStats {
  model?: string;
  contextPct?: number;
  costUsd?: number;
  linesAdded?: number;
  linesRemoved?: number;
}

export interface Approval {
  id: string;
  paneId: string;
  tool: string;
  summary: string;
  input: unknown;
  /** Claude's suggested "always allow" rules, used as-is for the Always button. */
  suggestions: unknown[];
  at: number;
}

export interface LimitWindow {
  pct: number;
  /** Unix seconds. */
  resetsAt?: number;
}

export interface Usage {
  fiveHour?: LimitWindow;
  sevenDay?: LimitWindow;
  spend?: LimitWindow & { usedUsd?: number; limitUsd?: number };
  updatedAt: number;
  /** Recent five-hour readings for the burn rate. */
  samples: { t: number; pct: number }[];
}

export interface ClosedTab {
  cwd: string;
  kind: PaneKind;
  sessionId?: string;
  shell?: string;
  title?: string;
  closedAt: number;
}

export type SettingsSection =
  | "appearance"
  | "behavior"
  | "claude-in-helm"
  | "shortcuts"
  | "about"
  | "permissions"
  | "hooks"
  | "mcp"
  | "memory";

export interface Toast {
  id: number;
  text: string;
  kind: "info" | "success" | "error";
  action?: { label: string; run: () => void };
}

export interface AvailableUpdate {
  version: string;
  notes?: string;
  install: () => Promise<void>;
}

export interface SavedPrompt {
  id: string;
  title: string;
  text: string;
}

export interface Tab {
  id: string;
  root: LayoutNode;
  activePaneId: string;
}

export interface Settings {
  theme: ThemeMode;
  fontSize: number;
  /** Primary terminal font name only; fallbacks are added by fontStack(). */
  fontFamily: string;
  notifications: boolean;
  restoreTabs: boolean;
  /** Default shell for new tabs. */
  shell: string;
  /** Answer permission requests from background tabs in Helm. */
  approvals: boolean;
  /** Track usage limits through Claude's status line. */
  usageCockpit: boolean;
  /** Tell Claude it is on Windows and which shell syntax to use. */
  windowsHints: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: "dark",
  fontSize: 14,
  fontFamily: DEFAULT_FONT,
  notifications: true,
  restoreTabs: true,
  shell: "pwsh",
  approvals: true,
  usageCockpit: true,
  windowsHints: true,
};

export interface RecentProject {
  path: string;
  lastUsed: number;
}

interface State {
  tabs: Tab[];
  activeTabId: string | null;
  panes: Record<string, Pane>;
  settings: Settings;
  pinned: string[];
  recent: RecentProject[];
  sessions: SessionInfo[];
  prompts: SavedPrompt[];
  sidebarOpen: boolean;
  sidebarView: "projects" | "history";
  searchOpen: boolean;
  paletteOpen: boolean;
  promptsOpen: boolean;
  changesOpen: boolean;
  /** The Settings tab exists in the tab bar. */
  settingsOpen: boolean;
  /** The Agents tab exists in the tab bar. */
  agentsOpen: boolean;
  /** What the main area shows: the active terminal tab, the Settings tab or the Agents tab. */
  view: "terminal" | "settings" | "agents";
  settingsSection: SettingsSection;
  newTaskOpen: boolean;
  toast: Toast | null;
  update: AvailableUpdate | null;
  /** Bumped whenever Claude does something that may change files or stats. */
  activity: number;
  approvals: Approval[];
  usage: Usage | null;
  /** Approximate share of the five-hour limit each pane used (percentage points). */
  usageByPane: Record<string, number>;
  closedTabs: ClosedTab[];
  homeDir: string;

  openTab: (cwd: string, kind: PaneKind, opts?: { resumeSessionId?: string; worktree?: string; shell?: string }) => string;
  reopenClosedTab: () => void;
  openAgents: () => void;
  closeAgents: () => void;
  /** Focuses the pane already running this session, or opens a tab that resumes it. */
  resumeSession: (session: { id: string; cwd: string }) => void;
  closeTab: (tabId: string) => void;
  closePane: (paneId: string) => void;
  splitActive: (dir: SplitDir, kind: PaneKind) => void;
  focusPane: (paneId: string) => void;
  focusNeighbor: (dir: Direction) => void;
  setActiveTab: (tabId: string) => void;
  openSettings: (section?: SettingsSection) => void;
  closeSettings: () => void;
  cycleTab: (delta: number) => void;
  resizeSplit: (tabId: string, splitId: string, ratio: number) => void;
  updatePane: (paneId: string, patch: Partial<Pane>) => void;
  markSeen: () => void;
  updateSettings: (patch: Partial<Settings>) => void;
  togglePin: (path: string) => void;
  set: (patch: Partial<State>) => void;
}

function newPane(cwd: string, kind: PaneKind, resumeSessionId?: string): Pane {
  return {
    id: crypto.randomUUID(),
    kind,
    cwd,
    claudeActive: false,
    resumeSessionId,
    sessionId: kind === "claude" && !resumeSessionId ? crypto.randomUUID() : undefined,
    status: "idle",
  };
}

export const useStore = create<State>((set, get) => ({
  tabs: [],
  activeTabId: null,
  panes: {},
  settings: DEFAULT_SETTINGS,
  pinned: [],
  recent: [],
  sessions: [],
  prompts: [],
  sidebarOpen: true,
  sidebarView: "projects",
  searchOpen: false,
  settingsOpen: false,
  paletteOpen: false,
  promptsOpen: false,
  changesOpen: false,
  agentsOpen: false,
  view: "terminal",
  settingsSection: "appearance",
  newTaskOpen: false,
  toast: null,
  update: null,
  activity: 0,
  approvals: [],
  usage: null,
  usageByPane: {},
  closedTabs: [],
  homeDir: "",

  openTab: (cwd, kind, opts) => {
    const pane = { ...newPane(cwd, kind, opts?.resumeSessionId), worktree: opts?.worktree, shell: opts?.shell };
    const tab: Tab = { id: crypto.randomUUID(), root: leaf(pane.id), activePaneId: pane.id };
    set((s) => ({ tabs: [...s.tabs, tab], activeTabId: tab.id, view: "terminal", panes: { ...s.panes, [pane.id]: pane } }));
    return tab.id;
  },

  reopenClosedTab: () => {
    const [last, ...rest] = get().closedTabs;
    if (!last) return;
    set({ closedTabs: rest });
    const resume = last.kind === "claude" && last.sessionId ? last.sessionId : undefined;
    get().openTab(last.cwd, resume ? "claude" : "shell", { resumeSessionId: resume, shell: last.shell });
  },

  openAgents: () => set({ agentsOpen: true, view: "agents" }),

  closeAgents: () => set((s) => ({ agentsOpen: false, view: s.view === "agents" ? "terminal" : s.view })),

  resumeSession: ({ id, cwd }) => {
    const s = get();
    const pane = Object.values(s.panes).find((p) => p.sessionId === id || p.resumeSessionId === id);
    const tab = pane && s.tabs.find((t) => paneIds(t.root).includes(pane.id));
    if (pane && tab) {
      s.setActiveTab(tab.id);
      s.focusPane(pane.id);
    } else {
      s.openTab(cwd || s.homeDir, "claude", { resumeSessionId: id });
    }
  },

  closeTab: (tabId) => {
    const tab = get().tabs.find((t) => t.id === tabId);
    if (!tab) return;
    for (const id of paneIds(tab.root)) get().closePane(id);
  },

  closePane: (paneId) => {
    set((s) => {
      const tab = s.tabs.find((t) => paneIds(t.root).includes(paneId));
      const { [paneId]: removed, ...panes } = s.panes;
      // Remember closed panes so they can be reopened (Claude ones resume their conversation).
      const claude = removed && (removed.claudeActive || removed.kind === "claude") && removed.sessionId;
      const closedTabs = removed
        ? [
            {
              cwd: removed.cwd,
              kind: claude ? ("claude" as const) : ("shell" as const),
              sessionId: claude ? removed.sessionId : undefined,
              shell: removed.shell,
              title: cleanTitle(removed.title),
              closedAt: Date.now(),
            },
            ...s.closedTabs,
          ].slice(0, 20)
        : s.closedTabs;
      const approvals = s.approvals.filter((a) => a.paneId !== paneId);
      if (!tab) return { panes, closedTabs, approvals };
      const root = remove(tab.root, paneId);
      if (!root) {
        const idx = s.tabs.indexOf(tab);
        const tabs = s.tabs.filter((t) => t.id !== tab.id);
        const activeTabId =
          s.activeTabId === tab.id ? (tabs[Math.min(idx, tabs.length - 1)]?.id ?? null) : s.activeTabId;
        return { panes, tabs, activeTabId, closedTabs, approvals };
      }
      const activePaneId = tab.activePaneId === paneId ? paneIds(root)[0] : tab.activePaneId;
      return { panes, closedTabs, approvals, tabs: s.tabs.map((t) => (t.id === tab.id ? { ...t, root, activePaneId } : t)) };
    });
  },

  splitActive: (dir, kind) => {
    const s = get();
    const tab = s.tabs.find((t) => t.id === s.activeTabId);
    if (!tab) return;
    const current = s.panes[tab.activePaneId];
    const pane = { ...newPane(current?.cwd ?? s.homeDir, kind), shell: current?.shell };
    set({
      panes: { ...s.panes, [pane.id]: pane },
      tabs: s.tabs.map((t) =>
        t.id === tab.id ? { ...t, root: split(t.root, t.activePaneId, dir, pane.id), activePaneId: pane.id } : t,
      ),
    });
  },

  focusPane: (paneId) => {
    set((s) => ({
      tabs: s.tabs.map((t) => (paneIds(t.root).includes(paneId) ? { ...t, activePaneId: paneId } : t)),
    }));
    get().markSeen();
  },

  focusNeighbor: (dir) => {
    const s = get();
    const tab = s.tabs.find((t) => t.id === s.activeTabId);
    if (!tab) return;
    const next = neighbor(tab.root, tab.activePaneId, dir);
    if (next) get().focusPane(next);
  },

  setActiveTab: (tabId) => {
    set({ activeTabId: tabId, view: "terminal" });
    get().markSeen();
  },

  openSettings: (section) =>
    set((s) => ({ settingsOpen: true, view: "settings", settingsSection: section ?? s.settingsSection })),

  closeSettings: () => set({ settingsOpen: false, view: "terminal" }),

  cycleTab: (delta) => {
    const { tabs, activeTabId } = get();
    if (tabs.length < 2) return;
    const idx = tabs.findIndex((t) => t.id === activeTabId);
    get().setActiveTab(tabs[(idx + delta + tabs.length) % tabs.length].id);
  },

  resizeSplit: (tabId, splitId, ratio) =>
    set((s) => ({ tabs: s.tabs.map((t) => (t.id === tabId ? { ...t, root: setRatio(t.root, splitId, ratio) } : t)) })),

  updatePane: (paneId, patch) =>
    set((s) => (s.panes[paneId] ? { panes: { ...s.panes, [paneId]: { ...s.panes[paneId], ...patch } } } : {})),

  /** "done" turns back to idle once the user is looking at the pane. */
  markSeen: () => {
    if (!document.hasFocus()) return;
    const s = get();
    const tab = s.tabs.find((t) => t.id === s.activeTabId);
    if (!tab) return;
    const pane = s.panes[tab.activePaneId];
    if (pane?.status === "done") get().updatePane(pane.id, { status: "idle" });
  },

  updateSettings: (patch) => set((s) => ({ settings: { ...s.settings, ...patch } })),

  togglePin: (path) =>
    set((s) => ({
      pinned: s.pinned.some((p) => p.toLowerCase() === path.toLowerCase())
        ? s.pinned.filter((p) => p.toLowerCase() !== path.toLowerCase())
        : [...s.pinned, path],
    })),

  set: (patch) => set(patch),
}));

export function activePane(): Pane | undefined {
  const s = useStore.getState();
  const tab = s.tabs.find((t) => t.id === s.activeTabId);
  return tab ? s.panes[tab.activePaneId] : undefined;
}

export function folderName(path: string): string {
  const parts = path.replace(/[\\/]+$/, "").split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

/** Strips the spinner/status glyphs Claude Code puts in front of its terminal title. */
export function cleanTitle(title?: string): string {
  const t = (title ?? "").trim();
  // Shells set the title to their own program path ("C:\WINDOWS\...\powershell.exe"); that's noise.
  if (/\.exe$/i.test(t) || /^(Windows )?PowerShell$/i.test(t) || /^MINGW(32|64):/.test(t)) return "";
  return t.replace(/^[^\p{L}\p{N}]+/u, "").trim();
}

let toastTimer: number | undefined;

/** Shows a short message at the bottom of the window. Errors stay a little longer. */
export function showToast(text: string, kind: Toast["kind"] = "info", action?: Toast["action"]) {
  clearTimeout(toastTimer);
  useStore.setState({ toast: { id: Date.now(), text, kind, action } });
  toastTimer = window.setTimeout(() => useStore.setState({ toast: null }), kind === "error" ? 8000 : 4500);
}
