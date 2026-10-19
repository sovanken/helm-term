import { create } from "zustand";
import { type Direction, type LayoutNode, type SplitDir, leaf, neighbor, paneIds, remove, setRatio, split } from "../lib/layout";
import type { SessionInfo } from "../lib/ipc";
import type { ThemeMode } from "../lib/themes";
import { DEFAULT_FONT } from "../lib/themes";

export type PaneKind = "claude" | "shell" | "browser";

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
  /** Browser panes: the address it shows. */
  url?: string;
  /** Browser panes: live page state. */
  page?: PageState;
  /** Claude's permission mode (default, acceptEdits, plan, auto, bypassPermissions, dontAsk). */
  permissionMode?: string;
  /** Subagents and background commands Claude started in this tab. */
  bgTasks?: BgTask[];
  /** Last time Claude reported anything (ms). */
  lastActivity?: number;
}

/** An error or warning the page reported (console, uncaught exception, failed request). */
export interface PageProblem {
  level: "error" | "warning";
  source: "console" | "exception" | "network" | "browser";
  text: string;
  at?: string;
  time: number;
}

export interface PageState {
  title?: string;
  loading?: boolean;
  canBack?: boolean;
  canForward?: boolean;
  problems?: PageProblem[];
  /** Device being emulated (see lib/devices). */
  device?: string;
  rotated?: boolean;
  picking?: boolean;
}

export interface FileTab {
  id: string;
  path: string;
  /** Project folder it was opened from, to show a shorter path. */
  cwd?: string;
}

export interface BgTask {
  id: string;
  kind: "agent" | "command";
  /** What it's doing, e.g. the subagent's task description or the command. */
  label: string;
  /** Subagent type (Explore, Plan, general-purpose…). */
  type?: string;
  agentId?: string;
  startedAt: number;
  endedAt?: number;
  status: "running" | "done";
  /** The subagent's final answer. */
  summary?: string;
  /** What the subagent is doing right now, e.g. "Grep: TODO". */
  doing?: string;
  /** Tool calls the subagent has made. */
  steps?: number;
  /** Its most recent tool calls, oldest first (capped). */
  recent?: { at: number; what: string }[];
  /** Runs in the background (Claude keeps working meanwhile). */
  background?: boolean;
  /** Created from SubagentStart before Claude's own description arrived. */
  placeholder?: boolean;
}

/** One day of usage: share of the weekly limit used, and how it split across projects. */
export interface UsageDay {
  day: string;
  weekPts: number;
  byProject: Record<string, number>;
}

export interface PaneStats {
  model?: string;
  contextPct?: number;
  costUsd?: number;
  linesAdded?: number;
  linesRemoved?: number;
  effort?: string;
  thinking?: boolean;
  fastMode?: boolean;
  cache?: { warm: boolean; observed: boolean; expiresAt?: number; ttl?: string; hitRatio?: number };
  pr?: { number: number; url?: string; reviewState?: string; kind?: string };
  /** Worktree / parallel task name. */
  task?: string;
  durationMs?: number;
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
  url?: string;
  sessionId?: string;
  shell?: string;
  title?: string;
  closedAt: number;
}

export type SettingsSection =
  | "general"
  | "appearance"
  | "terminal"
  | "notifications"
  | "advanced"
  | "privacy"
  | "whats-new"
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
  /** A second, less prominent button. */
  secondary?: { label: string; run: () => void };
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
  /** Status bar items the user switched off (right-click the status bar). */
  hiddenStatusItems: string[];
  /** Open the right panel on Agents when Claude starts a background agent. */
  autoOpenAgents: boolean;
  /** Usage-saving hints (cache expiring, compact, large paste, idle sessions). */
  usageTips: boolean;
  /** Where web links and dev servers open: a Helm browser tab or the system browser. */
  openLinksIn: "helm" | "browser";
  /** Offer to open a dev server when a terminal prints its address. */
  devServerPrompt: boolean;
  /** Draw a phone, tablet or laptop outline around emulated pages. */
  deviceFrame: boolean;

  // ---- appearance ----
  accent: AccentId;
  /** "helm" follows the app theme; otherwise a named terminal color scheme. */
  terminalScheme: string;
  uiFont: "inter" | "geist" | "system";
  /** Interface zoom, 0.8–1.5 (Ctrl + mouse wheel outside the terminal). */
  uiScale: number;
  lineHeight: number;
  cursorStyle: "bar" | "block" | "underline";
  cursorBlink: boolean;
  /** Windows 11 Mica see-through window background. */
  mica: boolean;
  sidebarWidth: number;
  changesWidth: number;

  // ---- general ----
  /** Folder for new tabs when no tab is open: "home", "last" or a custom path. */
  startFolder: string;
  lastFolder?: string;
  confirmClose: boolean;

  // ---- terminal ----
  scrollback: number;
  copyOnSelect: boolean;
  /** Right-click: copy the selection or paste ("smart"), or always paste. */
  rightClick: "smart" | "paste";
  bell: "none" | "flash" | "sound";
  pasteWarning: boolean;
  gpu: boolean;

  // ---- notifications ----
  notifyFinished: boolean;
  notifyApproval: boolean;
  notifyUsage: boolean;
  notifySound: boolean;

  // ---- updates / advanced ----
  autoUpdate: boolean;
  extraClaudeArgs: string;
  /** KEY=value lines added to every new tab's environment. */
  extraEnv: string;
  settingsVersion: number;
  /** Last Helm version whose "What's new" the user was told about. */
  lastSeenVersion?: string;
}

export type AccentId = "brass" | "blue" | "violet" | "green" | "rose" | "teal";

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
  hiddenStatusItems: [],
  autoOpenAgents: true,
  usageTips: true,
  openLinksIn: "helm",
  devServerPrompt: true,
  deviceFrame: true,
  accent: "brass",
  terminalScheme: "helm",
  uiFont: "inter",
  uiScale: 1,
  lineHeight: 1.2,
  cursorStyle: "bar",
  cursorBlink: true,
  mica: false,
  sidebarWidth: 256,
  changesWidth: 320,
  startFolder: "home",
  confirmClose: true,
  scrollback: 10000,
  copyOnSelect: false,
  rightClick: "smart",
  bell: "flash",
  pasteWarning: true,
  gpu: true,
  notifyFinished: true,
  notifyApproval: true,
  notifyUsage: true,
  notifySound: true,
  autoUpdate: true,
  extraClaudeArgs: "",
  extraEnv: "",
  settingsVersion: 2,
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
  /** The right panel is open (Changes · Agents · Details). */
  changesOpen: boolean;
  inspectorTab: "changes" | "agents" | "details";
  composerOpen: boolean;
  usageLog: UsageDay[];
  /** The Settings tab exists in the tab bar. */
  settingsOpen: boolean;
  /** The Agents tab exists in the tab bar. */
  agentsOpen: boolean;
  /** Local dev servers seen in terminal output (newest first). */
  devServers: string[];
  /** Files opened from the right panel, shown as tabs inside Helm. */
  fileTabs: FileTab[];
  activeFileId: string | null;
  /** What the main area shows: the active terminal tab, Settings, Agents or a file tab. */
  view: "terminal" | "settings" | "agents" | "file";
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

  openTab: (cwd: string, kind: PaneKind, opts?: { resumeSessionId?: string; worktree?: string; shell?: string; url?: string }) => string;
  /** Opens a web page in a browser tab, or next to the current pane with `beside`. */
  openBrowser: (url: string, opts?: { beside?: boolean; cwd?: string }) => void;
  updatePage: (paneId: string, patch: Partial<PageState>) => void;
  reopenClosedTab: () => void;
  moveTab: (from: number, to: number) => void;
  openAgents: () => void;
  closeAgents: () => void;
  /** Opens a file in a Helm tab (or switches to it if it's already open). */
  openFile: (path: string, cwd?: string) => void;
  showFile: (id: string) => void;
  closeFile: (id: string) => void;
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
  inspectorTab: "changes",
  composerOpen: false,
  usageLog: [],
  agentsOpen: false,
  fileTabs: [],
  activeFileId: null,
  devServers: [],
  view: "terminal",
  settingsSection: "general",
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
    const pane = { ...newPane(cwd, kind, opts?.resumeSessionId), worktree: opts?.worktree, shell: opts?.shell, url: opts?.url };
    const tab: Tab = { id: crypto.randomUUID(), root: leaf(pane.id), activePaneId: pane.id };
    if (cwd && cwd !== get().settings.lastFolder) get().updateSettings({ lastFolder: cwd });
    set((s) => ({ tabs: [...s.tabs, tab], activeTabId: tab.id, view: "terminal", panes: { ...s.panes, [pane.id]: pane } }));
    return tab.id;
  },

  openBrowser: (url, opts) => {
    const s = get();
    const cwd = opts?.cwd ?? activePane()?.cwd ?? s.homeDir;
    const tab = s.tabs.find((t) => t.id === s.activeTabId);
    if (opts?.beside && tab && s.view === "terminal") {
      const pane = { ...newPane(cwd, "browser"), url };
      set({
        panes: { ...s.panes, [pane.id]: pane },
        tabs: s.tabs.map((t) => (t.id === tab.id ? { ...t, root: split(t.root, t.activePaneId, "row", pane.id), activePaneId: pane.id } : t)),
      });
      return;
    }
    s.openTab(cwd, "browser", { url });
  },

  updatePage: (paneId, patch) =>
    set((s) => {
      const pane = s.panes[paneId];
      if (!pane) return {};
      return { panes: { ...s.panes, [paneId]: { ...pane, page: { ...pane.page, ...patch } } } };
    }),

  reopenClosedTab: () => {
    const [last, ...rest] = get().closedTabs;
    if (!last) return;
    set({ closedTabs: rest });
    if (last.kind === "browser" && last.url) {
      get().openTab(last.cwd, "browser", { url: last.url });
      return;
    }
    const resume = last.kind === "claude" && last.sessionId ? last.sessionId : undefined;
    get().openTab(last.cwd, resume ? "claude" : "shell", { resumeSessionId: resume, shell: last.shell });
  },

  moveTab: (from, to) =>
    set((s) => {
      if (from === to || from < 0 || to < 0 || from >= s.tabs.length || to >= s.tabs.length) return {};
      const tabs = [...s.tabs];
      const [tab] = tabs.splice(from, 1);
      tabs.splice(to, 0, tab);
      return { tabs };
    }),

  openAgents: () => set({ agentsOpen: true, view: "agents" }),

  closeAgents: () => set((s) => ({ agentsOpen: false, view: s.view === "agents" ? "terminal" : s.view })),

  openFile: (raw, cwd) => {
    // One tab per file, however the path was written (C:/a/b.txt and c:\a\b.txt are the same file).
    const path = raw.replace(/\//g, "\\").replace(/^([a-z]):/, (_, d: string) => `${d.toUpperCase()}:`);
    const existing = get().fileTabs.find((f) => f.path.toLowerCase() === path.toLowerCase());
    if (existing) return set({ activeFileId: existing.id, view: "file" });
    const tab: FileTab = { id: crypto.randomUUID(), path, cwd: cwd?.replace(/\//g, "\\") };
    set((s) => ({ fileTabs: [...s.fileTabs, tab].slice(-20), activeFileId: tab.id, view: "file" }));
  },

  showFile: (id) => set({ activeFileId: id, view: "file" }),

  closeFile: (id) =>
    set((s) => {
      const i = s.fileTabs.findIndex((f) => f.id === id);
      const fileTabs = s.fileTabs.filter((f) => f.id !== id);
      if (s.activeFileId !== id) return { fileTabs };
      const next = fileTabs[Math.min(i, fileTabs.length - 1)];
      // Closing the file you're looking at shows the neighbouring file, or goes back to the terminal.
      return next ? { fileTabs, activeFileId: next.id } : { fileTabs, activeFileId: null, view: s.view === "file" ? "terminal" : s.view };
    }),

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
      const browser = removed?.kind === "browser";
      const closedTabs = removed
        ? [
            {
              cwd: removed.cwd,
              kind: browser ? ("browser" as const) : claude ? ("claude" as const) : ("shell" as const),
              url: browser ? removed.url : undefined,
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
export function showToast(text: string, kind: Toast["kind"] = "info", action?: Toast["action"], secondary?: Toast["secondary"]) {
  clearTimeout(toastTimer);
  useStore.setState({ toast: { id: Date.now(), text, kind, action, secondary } });
  toastTimer = window.setTimeout(() => useStore.setState({ toast: null }), kind === "error" ? 8000 : 4500);
}

/** Folder for a new tab when there's no active tab to copy it from (Settings → General). */
export function defaultFolder(): string {
  const s = useStore.getState();
  const start = s.settings.startFolder;
  if (start === "last") return s.settings.lastFolder || s.homeDir;
  if (start && start !== "home") return start;
  return s.homeDir;
}
