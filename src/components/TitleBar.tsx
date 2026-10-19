import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open } from "@tauri-apps/plugin-dialog";
import {
  ChevronDown,
  Copy,
  FolderOpen,
  Minus,
  PanelLeft,
  Plus,
  Rows2,
  Columns2,
  Command,
  FileDiff,
  Settings,
  Sparkles,
  Square,
  SquareTerminal,
  X,
} from "lucide-react";
import { paneIds } from "../lib/layout";
import { activePane, cleanTitle, folderName, type PaneStatus, type Tab, useStore } from "../state/store";
import { Menu, type MenuItem } from "./Menu";
import { StatusDot } from "./StatusDot";

const appWindow = getCurrentWindow();

/** The most urgent status among a tab's panes. */
function tabStatus(tab: Tab, panes: ReturnType<typeof useStore.getState>["panes"]): PaneStatus {
  const statuses = paneIds(tab.root).map((id) => panes[id]?.status);
  for (const s of ["attention", "working", "done"] as const) if (statuses.includes(s)) return s;
  return "idle";
}

export async function chooseFolder(kind: "claude" | "shell") {
  const dir = await open({ directory: true, title: "Choose a project folder" });
  if (typeof dir === "string") useStore.getState().openTab(dir, kind);
}

function TabButton({ tab, index }: { tab: Tab; index: number }) {
  const panes = useStore((s) => s.panes);
  const active = useStore((s) => s.activeTabId === tab.id);
  const { setActiveTab, closeTab } = useStore.getState();
  const pane = panes[tab.activePaneId];
  if (!pane) return null;
  const claude = pane.claudeActive || pane.kind === "claude";
  const title = cleanTitle(pane.title);
  const name = folderName(pane.cwd);
  const count = paneIds(tab.root).length;

  return (
    <div
      role="tab"
      aria-selected={active}
      title={`${pane.cwd}${title ? `\n${title}` : ""}${index < 9 ? `\nCtrl+${index + 1}` : ""}`}
      onPointerDown={(e) => e.button === 0 && setActiveTab(tab.id)}
      onAuxClick={(e) => e.button === 1 && closeTab(tab.id)}
      className={`group relative flex h-8 min-w-28 max-w-60 shrink items-center gap-2 rounded-md px-2.5 ${
        active ? "bg-surface text-fg" : "text-muted hover:bg-hover hover:text-fg"
      }`}
    >
      {active && <span className="absolute inset-x-2.5 -bottom-1 h-0.5 rounded-full bg-accent" />}
      <span className="flex size-4 shrink-0 items-center justify-center">
        {tabStatus(tab, panes) !== "idle" ? (
          <StatusDot status={tabStatus(tab, panes)} claude={claude} />
        ) : claude ? (
          <Sparkles size={14} className={active ? "text-accent" : ""} />
        ) : (
          <SquareTerminal size={14} />
        )}
      </span>
      <span className="truncate">
        <span className="font-medium">{name}</span>
        {title && <span className="text-faint"> · {title}</span>}
      </span>
      {count > 1 && <span className="shrink-0 rounded bg-hover px-1 text-[10px] text-muted">{count}</span>}
      <button
        aria-label="Close tab"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => closeTab(tab.id)}
        className={`ml-auto flex size-5 shrink-0 items-center justify-center rounded text-muted hover:bg-hover hover:text-fg ${
          active ? "opacity-100" : "opacity-0 group-hover:opacity-100"
        }`}
      >
        <X size={13} />
      </button>
    </div>
  );
}

function ChangesToggle() {
  const open = useStore((s) => s.changesOpen);
  return (
    <button
      aria-label="Show changes"
      title="Changes (Ctrl+Shift+G)"
      onClick={() => useStore.getState().set({ changesOpen: !open })}
      className={`flex size-8 items-center justify-center rounded-md hover:bg-hover ${open ? "bg-hover text-fg" : "text-muted hover:text-fg"}`}
    >
      <FileDiff size={15} />
    </button>
  );
}

export function TitleBar() {
  const tabs = useStore((s) => s.tabs);
  const sidebarOpen = useStore((s) => s.sidebarOpen);
  const [maximized, setMaximized] = useState(false);
  const [menu, setMenu] = useState(false);

  useEffect(() => {
    void appWindow.isMaximized().then(setMaximized);
    const un = appWindow.onResized(() => void appWindow.isMaximized().then(setMaximized));
    return () => void un.then((f) => f());
  }, []);

  const s = useStore.getState();
  const cwd = () => activePane()?.cwd ?? s.homeDir;
  const items: MenuItem[] = [
    { label: "New Claude tab", hint: "Ctrl+Shift+T", icon: <Sparkles size={14} />, onSelect: () => s.openTab(cwd(), "claude") },
    { label: "New PowerShell tab", hint: "Ctrl+Shift+N", icon: <SquareTerminal size={14} />, onSelect: () => s.openTab(cwd(), "shell") },
    { label: "Open folder with Claude…", icon: <FolderOpen size={14} />, onSelect: () => void chooseFolder("claude") },
    ...(tabs.length
      ? [
          { label: "Split right", hint: "Alt+Shift+=", icon: <Columns2 size={14} />, onSelect: () => s.splitActive("row", "shell"), separatorBefore: true },
          { label: "Split down", hint: "Alt+Shift+-", icon: <Rows2 size={14} />, onSelect: () => s.splitActive("column", "shell") },
          { label: "Split right with Claude", icon: <Sparkles size={14} />, onSelect: () => s.splitActive("row", "claude") },
        ]
      : []),
  ];

  return (
    <header data-tauri-drag-region className="flex h-11 shrink-0 items-center gap-1 bg-bg pl-2">
      <button
        aria-label="Toggle projects"
        title="Projects (Ctrl+Shift+B)"
        onClick={() => s.set({ sidebarOpen: !sidebarOpen })}
        className={`flex size-8 items-center justify-center rounded-md hover:bg-hover ${sidebarOpen ? "text-fg" : "text-muted"}`}
      >
        <PanelLeft size={16} />
      </button>

      <nav role="tablist" data-tauri-drag-region className="flex min-w-0 items-center gap-0.5 overflow-hidden">
        {tabs.map((t, i) => (
          <TabButton key={t.id} tab={t} index={i} />
        ))}
      </nav>

      <div className="relative flex shrink-0 items-center">
        <button
          aria-label="New Claude tab"
          title="New Claude tab (Ctrl+Shift+T)"
          onClick={() => s.openTab(cwd(), "claude")}
          className="flex size-8 items-center justify-center rounded-l-md text-muted hover:bg-hover hover:text-fg"
        >
          <Plus size={16} />
        </button>
        <button
          aria-label="More new tab options"
          onClick={() => setMenu((m) => !m)}
          className="flex h-8 w-5 items-center justify-center rounded-r-md text-muted hover:bg-hover hover:text-fg"
        >
          <ChevronDown size={13} />
        </button>
        {menu && <Menu items={items} onClose={() => setMenu(false)} />}
      </div>

      <div data-tauri-drag-region className="h-full min-w-8 flex-1" />

      <button
        aria-label="Command palette"
        title="Command palette (Ctrl+Shift+P)"
        onClick={() => s.set({ paletteOpen: true })}
        className="flex h-8 items-center gap-2 rounded-md border border-line px-2.5 text-muted hover:bg-hover hover:text-fg"
      >
        <Command size={13} />
        <span className="text-[12px]">Commands</span>
        <kbd className="font-sans text-[10px] text-faint">Ctrl+Shift+P</kbd>
      </button>
      <ChangesToggle />
      <button
        aria-label="Settings"
        title="Settings (Ctrl+,)"
        onClick={() => s.set({ settingsOpen: true })}
        className="flex size-8 items-center justify-center rounded-md text-muted hover:bg-hover hover:text-fg"
      >
        <Settings size={15} />
      </button>

      <div className="ml-1 flex h-full">
        <button aria-label="Minimize" onClick={() => void appWindow.minimize()} className="flex h-full w-11 items-center justify-center text-muted hover:bg-hover hover:text-fg">
          <Minus size={15} />
        </button>
        <button aria-label={maximized ? "Restore" : "Maximize"} onClick={() => void appWindow.toggleMaximize()} className="flex h-full w-11 items-center justify-center text-muted hover:bg-hover hover:text-fg">
          {maximized ? <Copy size={12} className="-scale-x-100" /> : <Square size={12} />}
        </button>
        <button aria-label="Close" onClick={() => void appWindow.close()} className="flex h-full w-11 items-center justify-center text-muted hover:bg-[#c42b1c] hover:text-white">
          <X size={16} />
        </button>
      </div>
    </header>
  );
}
