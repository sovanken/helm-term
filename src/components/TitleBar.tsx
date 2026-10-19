import { useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open } from "@tauri-apps/plugin-dialog";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  Copy,
  FolderOpen,
  Minus,
  PanelLeft,
  Plus,
  Rows2,
  Columns2,
  Bot,
  Command,
  Wand2,
  Download,
  FileDiff,
  Settings,
  Sparkles,
  Square,
  SquareTerminal,
  X,
  FileText,
  Image as ImageIcon,
} from "lucide-react";
import { paneIds } from "../lib/layout";
import { activePane, cleanTitle, defaultFolder, folderName, type FileTab, type PaneStatus, type Tab, useStore } from "../state/store";
import { Menu, type MenuItem } from "./Menu";
import { useShells } from "../lib/shells";
import { closeTabSafely, confirmClosePanes } from "../lib/actions";
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

/** Drag a tab sideways to reorder it; a short click just selects it. */
function startTabDrag(e: React.PointerEvent<HTMLDivElement>, tabId: string) {
  const nav = e.currentTarget.parentElement;
  if (!nav) return;
  const startX = e.clientX;
  let dragging = false;
  const el = e.currentTarget;
  const move = (ev: PointerEvent) => {
    if (!dragging && Math.abs(ev.clientX - startX) < 6) return;
    dragging = true;
    el.dataset.dragging = "";
    const s = useStore.getState();
    const from = s.tabs.findIndex((t) => t.id === tabId);
    const rects = [...nav.querySelectorAll<HTMLElement>("[data-tab-id]")].map((n) => ({ id: n.dataset.tabId!, r: n.getBoundingClientRect() }));
    const to = rects.findIndex(({ r }) => ev.clientX >= r.left && ev.clientX <= r.right);
    if (to >= 0 && to !== from) {
      const target = rects[to].r;
      // Only swap once the pointer passes the neighbour's middle, so tabs don't flicker.
      const passed = to > from ? ev.clientX > target.left + target.width / 2 : ev.clientX < target.right - target.width / 2;
      if (passed) s.moveTab(from, to);
    }
  };
  const up = () => {
    delete el.dataset.dragging;
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
}

function TabButton({ tab, index }: { tab: Tab; index: number }) {
  const panes = useStore((s) => s.panes);
  const active = useStore((s) => s.activeTabId === tab.id && s.view === "terminal");
  const { setActiveTab } = useStore.getState();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // After layout, so a just-opened tab that made the strip overflow is fully shown.
    if (active) requestAnimationFrame(() => ref.current?.scrollIntoView({ block: "nearest", inline: "nearest" }));
  }, [active]);
  const pane = panes[tab.activePaneId];
  if (!pane) return null;
  const claude = pane.claudeActive || pane.kind === "claude";
  const title = cleanTitle(pane.title);
  const name = folderName(pane.cwd);
  const count = paneIds(tab.root).length;

  return (
    <div
      ref={ref}
      role="tab"
      data-tab-id={tab.id}
      aria-selected={active}
      title={`${pane.cwd}${title ? `\n${title}` : ""}${index < 9 ? `\nCtrl+${index + 1}` : ""}`}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        setActiveTab(tab.id);
        startTabDrag(e, tab.id);
      }}
      onAuxClick={(e) => e.button === 1 && void closeTabSafely(tab.id)}
      className={`anim-fade group relative flex h-8 w-60 min-w-32 shrink items-center gap-2 rounded-md px-2.5 data-[dragging]:z-10 data-[dragging]:cursor-grabbing data-[dragging]:bg-raised ${
        active ? "border border-line bg-surface text-fg" : "border border-transparent text-muted hover:bg-hover hover:text-fg"
      }`}
    >
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
        onClick={() => void closeTabSafely(tab.id)}
        className={`ml-auto flex size-5 shrink-0 items-center justify-center rounded text-muted hover:bg-hover hover:text-fg ${
          active ? "opacity-100" : "opacity-0 group-hover:opacity-100"
        }`}
      >
        <X size={13} />
      </button>
    </div>
  );
}

/** Number of sessions that need the user: pending approvals plus tabs waiting for input. */
function useNeedsYou() {
  const approvals = useStore((s) => s.approvals.length);
  const waiting = useStore((s) => Object.values(s.panes).filter((p) => p.status === "attention").length);
  return Math.max(approvals, waiting);
}

function AgentsButton() {
  const count = useNeedsYou();
  const active = useStore((s) => s.view === "agents");
  return (
    <button
      aria-label="Agents"
      title="Agents: every Claude session and your usage limits (Ctrl+Shift+A)"
      onClick={() => useStore.getState().openAgents()}
      className={`relative flex size-8 items-center justify-center rounded-md hover:bg-hover ${active ? "bg-hover text-fg" : "text-muted hover:text-fg"}`}
    >
      <Bot size={16} />
      {count > 0 && (
        <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-attention px-1 text-[10px] font-semibold text-black">{count}</span>
      )}
    </button>
  );
}

function AgentsTab() {
  const open = useStore((s) => s.agentsOpen);
  const active = useStore((s) => s.view === "agents");
  const count = useNeedsYou();
  if (!open) return null;
  const { openAgents, closeAgents } = useStore.getState();
  return (
    <div
      role="tab"
      aria-selected={active}
      onPointerDown={(e) => e.button === 0 && openAgents()}
      onAuxClick={(e) => e.button === 1 && closeAgents()}
      className={`group relative flex h-8 shrink-0 items-center gap-2 rounded-md px-2.5 ${active ? "border border-line bg-surface text-fg" : "border border-transparent text-muted hover:bg-hover hover:text-fg"}`}
    >
      <Bot size={14} className={active ? "text-accent" : ""} />
      <span className="font-medium">Agents</span>
      {count > 0 && <span className="rounded-full bg-attention px-1.5 text-[10px] font-semibold text-black">{count}</span>}
      <button
        aria-label="Close agents"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={closeAgents}
        className="flex size-5 items-center justify-center rounded text-muted hover:bg-hover hover:text-fg"
      >
        <X size={13} />
      </button>
    </div>
  );
}

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|ico|svg|avif)$/i;

function FileTabButton({ file }: { file: FileTab }) {
  const active = useStore((s) => s.view === "file" && s.activeFileId === file.id);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // After layout, so a just-opened tab that made the strip overflow is fully shown.
    if (active) requestAnimationFrame(() => ref.current?.scrollIntoView({ block: "nearest", inline: "nearest" }));
  }, [active]);
  const { showFile, closeFile } = useStore.getState();
  const name = file.path.split(/[\\/]/).pop() ?? file.path;
  const Icon = IMAGE_EXT.test(name) ? ImageIcon : FileText;
  return (
    <div
      ref={ref}
      role="tab"
      aria-selected={active}
      title={file.path}
      onPointerDown={(e) => e.button === 0 && showFile(file.id)}
      onAuxClick={(e) => e.button === 1 && closeFile(file.id)}
      className={`anim-fade group relative flex h-8 w-48 min-w-32 shrink items-center gap-2 rounded-md px-2.5 ${active ? "border border-line bg-surface text-fg" : "border border-transparent text-muted hover:bg-hover hover:text-fg"}`}
    >
      <Icon size={14} className={active ? "text-accent" : ""} />
      <span className="truncate font-medium">{name}</span>
      <button
        aria-label={`Close ${name}`}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => closeFile(file.id)}
        className={`ml-auto flex size-5 shrink-0 items-center justify-center rounded text-muted hover:bg-hover hover:text-fg ${active ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}
      >
        <X size={13} />
      </button>
    </div>
  );
}

function SettingsTab() {
  const open = useStore((s) => s.settingsOpen);
  const active = useStore((s) => s.view === "settings");
  if (!open) return null;
  const { openSettings, closeSettings } = useStore.getState();
  return (
    <div
      role="tab"
      aria-selected={active}
      onPointerDown={(e) => e.button === 0 && openSettings()}
      onAuxClick={(e) => e.button === 1 && closeSettings()}
      className={`group relative flex h-8 shrink-0 items-center gap-2 rounded-md px-2.5 ${active ? "border border-line bg-surface text-fg" : "border border-transparent text-muted hover:bg-hover hover:text-fg"}`}
    >
      <Settings size={14} className={active ? "text-accent" : ""} />
      <span className="font-medium">Settings</span>
      <button
        aria-label="Close settings"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={closeSettings}
        className="flex size-5 items-center justify-center rounded text-muted hover:bg-hover hover:text-fg"
      >
        <X size={13} />
      </button>
    </div>
  );
}

function UpdateButton() {
  const update = useStore((s) => s.update);
  const [busy, setBusy] = useState(false);
  if (!update) return null;
  return (
    <button
      title={update.notes || `Helm ${update.version} is available`}
      disabled={busy}
      onClick={() => {
        setBusy(true);
        void update.install().catch(() => setBusy(false));
      }}
      className="flex h-8 items-center gap-1.5 rounded-md bg-accent-soft px-2.5 text-[12px] font-medium text-accent hover:bg-accent hover:text-on-accent disabled:opacity-60"
    >
      <Download size={13} /> {busy ? "Updating…" : `Update to ${update.version}`}
    </button>
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

/** Every open tab, for the "all tabs" list when they don't fit. */
function AllTabsMenu({ onClose }: { onClose: () => void }) {
  const s = useStore();
  const items: MenuItem[] = s.tabs.map((t, i) => {
    const pane = s.panes[t.activePaneId];
    const claude = !!pane && (pane.claudeActive || pane.kind === "claude");
    const title = pane ? cleanTitle(pane.title) : "";
    return {
      label: `${pane ? folderName(pane.cwd) : "Tab"}${title ? ` · ${title}` : ""}`,
      hint: i < 9 ? `Ctrl+${i + 1}` : undefined,
      icon: claude ? <Sparkles size={14} /> : <SquareTerminal size={14} />,
      current: s.view === "terminal" && s.activeTabId === t.id,
      onSelect: () => s.setActiveTab(t.id),
    };
  });
  s.fileTabs.forEach((f, i) =>
    items.push({
      label: f.path.split(/[\\/]/).pop() ?? f.path,
      icon: IMAGE_EXT.test(f.path) ? <ImageIcon size={14} /> : <FileText size={14} />,
      current: s.view === "file" && s.activeFileId === f.id,
      onSelect: () => s.showFile(f.id),
      separatorBefore: i === 0 && items.length > 0,
    }),
  );
  if (s.agentsOpen) items.push({ label: "Agents", icon: <Bot size={14} />, current: s.view === "agents", onSelect: s.openAgents, separatorBefore: true });
  if (s.settingsOpen) items.push({ label: "Settings", icon: <Settings size={14} />, current: s.view === "settings", onSelect: () => s.openSettings(), separatorBefore: !s.agentsOpen });
  return <Menu items={items} onClose={onClose} align="right" />;
}

/**
 * The tab strip. Tabs shrink first; when they still don't fit, arrows scroll the strip and a
 * list shows every tab.
 */
function TabStrip({ children }: { children: React.ReactNode }) {
  const nav = useRef<HTMLElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });
  const [list, setList] = useState(false);

  useEffect(() => {
    const el = nav.current;
    if (!el) return;
    const update = () => setEdges({ left: el.scrollLeft > 1, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 1 });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    const mo = new MutationObserver(update);
    mo.observe(el, { childList: true, subtree: true });
    el.addEventListener("scroll", update, { passive: true });
    return () => {
      ro.disconnect();
      mo.disconnect();
      el.removeEventListener("scroll", update);
    };
  }, []);

  const scrollBy = (dir: -1 | 1) => nav.current?.scrollBy({ left: dir * nav.current.clientWidth * 0.7, behavior: "smooth" });
  const overflowing = edges.left || edges.right;
  const arrow = "flex h-8 w-6 shrink-0 items-center justify-center rounded-md text-muted hover:bg-hover hover:text-fg disabled:opacity-30 disabled:hover:bg-transparent";

  return (
    <>
      {overflowing && (
        <button aria-label="Scroll tabs left" title="Earlier tabs" disabled={!edges.left} onClick={() => scrollBy(-1)} className={arrow}>
          <ChevronLeft size={15} />
        </button>
      )}
      <nav
        ref={nav}
        role="tablist"
        data-tauri-drag-region
        onWheel={(e) => {
          // Scroll the tab strip sideways with the mouse wheel when tabs overflow.
          if (!e.ctrlKey && Math.abs(e.deltaY) > Math.abs(e.deltaX)) e.currentTarget.scrollLeft += e.deltaY;
        }}
        className={`no-scrollbar flex min-w-0 scroll-px-8 items-center gap-0.5 overflow-x-auto py-1 ${edges.left ? "fade-left" : ""} ${edges.right ? "fade-right" : ""}`}
      >
        {children}
      </nav>
      {overflowing && (
        <>
          <button aria-label="Scroll tabs right" title="Later tabs" disabled={!edges.right} onClick={() => scrollBy(1)} className={arrow}>
            <ChevronRight size={15} />
          </button>
          <div className="relative flex shrink-0">
            <button aria-label="All tabs" title="All tabs" onClick={() => setList((l) => !l)} className={`${arrow} w-7 ${list ? "bg-hover text-fg" : ""}`}>
              <ChevronsUpDown size={14} />
            </button>
            {list && <AllTabsMenu onClose={() => setList(false)} />}
          </div>
        </>
      )}
    </>
  );
}

export function TitleBar() {
  const tabs = useStore((s) => s.tabs);
  const fileTabs = useStore((s) => s.fileTabs);
  const sidebarOpen = useStore((s) => s.sidebarOpen);
  const [maximized, setMaximized] = useState(false);
  const [menu, setMenu] = useState(false);
  const shells = useShells();

  useEffect(() => {
    void appWindow.isMaximized().then(setMaximized);
    const un = appWindow.onResized(() => void appWindow.isMaximized().then(setMaximized));
    return () => void un.then((f) => f());
  }, []);

  const s = useStore.getState();
  const cwd = () => activePane()?.cwd ?? defaultFolder();
  const items: MenuItem[] = [
    { label: "New Claude tab", hint: "Ctrl+Shift+T", icon: <Sparkles size={14} />, onSelect: () => s.openTab(cwd(), "claude") },
    ...shells.map((sh, i) => ({
      label: `New ${sh.label} tab`,
      hint: sh.id === s.settings.shell ? "Ctrl+Shift+N" : undefined,
      icon: <SquareTerminal size={14} />,
      onSelect: () => s.openTab(cwd(), "shell", { shell: sh.id }),
      separatorBefore: i === 0,
    })),
    ...(shells.length > 1
      ? shells
          .filter((sh) => sh.id !== s.settings.shell)
          .map((sh) => ({ label: `New Claude tab in ${sh.label}`, icon: <Sparkles size={14} />, onSelect: () => s.openTab(cwd(), "claude", { shell: sh.id }) }))
      : []),
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

      <TabStrip>
        {tabs.map((t, i) => (
          <TabButton key={t.id} tab={t} index={i} />
        ))}
        {fileTabs.map((f) => (
          <FileTabButton key={f.id} file={f} />
        ))}
        <AgentsTab />
        <SettingsTab />
      </TabStrip>

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
      <button
        aria-label="Write a prompt"
        title="Write and improve a prompt (Ctrl+Shift+I)"
        onClick={() => useStore.getState().set({ composerOpen: true })}
        className="flex size-8 items-center justify-center rounded-md text-muted hover:bg-hover hover:text-fg"
      >
        <Wand2 size={15} />
      </button>
      <UpdateButton />
      <AgentsButton />
      <ChangesToggle />
      <button
        aria-label="Settings"
        title="Settings (Ctrl+,)"
        onClick={() => s.openSettings()}
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
        <button
          aria-label="Close"
          onClick={async () => {
            if (await confirmClosePanes(Object.keys(useStore.getState().panes), "one or more tabs")) void appWindow.close();
          }} className="flex h-full w-11 items-center justify-center text-muted hover:bg-[#c42b1c] hover:text-white">
          <X size={16} />
        </button>
      </div>
    </header>
  );
}
