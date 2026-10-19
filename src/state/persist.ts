// Saves settings, pinned projects and open tabs; restores them on the next launch.

import { load, type Store } from "@tauri-apps/plugin-store";
import type { LayoutNode } from "../lib/layout";
import { DEFAULT_SETTINGS, type Pane, type PaneKind, type Settings, useStore } from "./store";

interface SavedPane {
  kind: PaneKind;
  cwd: string;
  sessionId?: string;
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
  const pinned = (await store.get<string[]>("pinned")) ?? [];
  const sidebarOpen = (await store.get<boolean>("sidebarOpen")) ?? true;
  useStore.getState().set({ settings, pinned, sidebarOpen });

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
    panes[p.id] = { kind: claude ? "claude" : "shell", cwd: p.cwd, sessionId: claude ? p.sessionId : undefined };
  }
  return {
    tabs: s.tabs.map(({ root, activePaneId }) => ({ root, activePaneId })),
    activeIndex: Math.max(0, s.tabs.findIndex((t) => t.id === s.activeTabId)),
    panes,
  };
}
