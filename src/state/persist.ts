// Saves settings, pinned projects and open tabs; restores them on the next launch.

import { load, type Store } from "@tauri-apps/plugin-store";
import type { LayoutNode } from "../lib/layout";
import { type ClosedTab, type UsageDay, DEFAULT_SETTINGS, type Pane, type PaneKind, type SavedPrompt, type Settings, useStore } from "./store";

/** A few useful prompts so the library isn't empty on first run; users can edit or delete them. */
const STARTER_PROMPTS: SavedPrompt[] = [
  { id: "starter-review", title: "Review my changes", text: "Review the uncommitted changes in this repo for bugs, edge cases and anything I missed. List issues by severity." },
  { id: "starter-explain", title: "Explain this project", text: "Give me a short tour of this codebase: what it does, how it is structured, and where the main entry points are." },
  { id: "starter-tests", title: "Write tests", text: "Write tests for the code we just changed. Follow the existing test style and run them." },
  { id: "starter-commit", title: "Commit message", text: "Write a clear commit message for the current changes and commit them." },
];

interface SavedPane {
  kind: PaneKind;
  cwd: string;
  sessionId?: string;
  shell?: string;
}

interface SavedSession {
  tabs: { root: LayoutNode; activePaneId: string }[];
  activeIndex: number;
  panes: Record<string, SavedPane>;
}

let store: Store | null = null;

export async function restore() {
  store = await load("helm.json", { autoSave: 400, defaults: {} });
  const settings = { ...DEFAULT_SETTINGS, ...((await store.get<Partial<Settings>>("settings")) ?? {}) };
  // Early versions saved the whole font stack; keep only the chosen font's name.
  settings.fontFamily = settings.fontFamily.split(",")[0].replace(/"/g, "").trim() || DEFAULT_SETTINGS.fontFamily;
  // v2: the bundled JetBrains Mono replaces the old default (Cascadia Mono) for people who never changed it.
  if ((settings.settingsVersion ?? 1) < 2) {
    if (settings.fontFamily === "Cascadia Mono") settings.fontFamily = DEFAULT_SETTINGS.fontFamily;
    settings.settingsVersion = 2;
  }
  const pinned = (await store.get<string[]>("pinned")) ?? [];
  const sidebarOpen = (await store.get<boolean>("sidebarOpen")) ?? true;
  const sidebarView = (await store.get<"projects" | "history">("sidebarView")) ?? "projects";
  const prompts = (await store.get<SavedPrompt[]>("prompts")) ?? STARTER_PROMPTS;
  const closedTabs = (await store.get<ClosedTab[]>("closedTabs")) ?? [];
  const usageLog = (await store.get<UsageDay[]>("usageLog")) ?? [];
  useStore.getState().set({ settings, pinned, sidebarOpen, sidebarView, prompts, closedTabs, usageLog });

  const session = settings.restoreTabs ? await store.get<SavedSession>("session") : undefined;
  if (session?.tabs?.length) {
    const panes: Record<string, Pane> = {};
    for (const [id, p] of Object.entries(session.panes)) {
      // A pane that had a Claude session reopens it; everything else reopens as a shell.
      const resume = p.kind === "claude" && p.sessionId;
      panes[id] = {
        id,
        kind: resume ? "claude" : "shell",
        cwd: p.cwd,
        claudeActive: false,
        resumeSessionId: resume ? p.sessionId : undefined,
        shell: p.shell,
        status: "idle",
      };
    }
    const tabs = session.tabs.map((t) => ({ ...t, id: crypto.randomUUID() }));
    useStore.getState().set({ panes, tabs, activeTabId: tabs[session.activeIndex]?.id ?? tabs[0].id });
  }

  useStore.subscribe((s, prev) => {
    if (!store) return;
    if (s.settings !== prev.settings) void store.set("settings", s.settings);
    if (s.pinned !== prev.pinned) void store.set("pinned", s.pinned);
    if (s.sidebarOpen !== prev.sidebarOpen) void store.set("sidebarOpen", s.sidebarOpen);
    if (s.sidebarView !== prev.sidebarView) void store.set("sidebarView", s.sidebarView);
    if (s.prompts !== prev.prompts) void store.set("prompts", s.prompts);
    if (s.closedTabs !== prev.closedTabs) void store.set("closedTabs", s.closedTabs);
    if (s.usageLog !== prev.usageLog) void store.set("usageLog", s.usageLog);
    if (s.tabs !== prev.tabs || s.panes !== prev.panes || s.activeTabId !== prev.activeTabId) {
      void store.set("session", snapshot());
    }
  });
}

function snapshot(): SavedSession {
  const s = useStore.getState();
  const panes: Record<string, SavedPane> = {};
  for (const p of Object.values(s.panes)) {
    const claude = p.claudeActive || (p.kind === "claude" && !!p.sessionId);
    panes[p.id] = { kind: claude ? "claude" : "shell", cwd: p.cwd, sessionId: claude ? p.sessionId : undefined, shell: p.shell };
  }
  return {
    tabs: s.tabs.map(({ root, activePaneId }) => ({ root, activePaneId })),
    activeIndex: Math.max(0, s.tabs.findIndex((t) => t.id === s.activeTabId)),
    panes,
  };
}
