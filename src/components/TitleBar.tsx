import { useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open } from "@tauri-apps/plugin-dialog";
import {
  PanelRight,
  LayoutDashboard,
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
  
  Command,
  Wand2,
  Download,
  
  Settings,
  Sparkles,
  Square,
  SquareTerminal,
  X,
  FileText,
  FilePlus,
  Scissors,
  Timer,
  Images,
  FolderTree,
  Wrench,
  Globe,
  Image as ImageIcon,
  Bug,
  FileJson,
  Info,
  Keyboard,
  Languages,
  Palette,
  RefreshCw,
  SlidersHorizontal,
} from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { checkForUpdate } from "../lib/updater";
import { openSettingsJson } from "../lib/settingsJson";
import { LANGUAGES, t as tr } from "../i18n";
import { useTranslation } from "react-i18next";
import { paneIds } from "../lib/layout";
import { activePane, cleanTitle, defaultFolder, folderName, type FileTab, type PaneStatus, projectColorFor, type Tab, useStore, type Workspace } from "../state/store";
import { Menu, type MenuItem } from "./Menu";
import { useShells } from "../lib/shells";
import { closeFileSafely, closeTabSafely, closeWorkspaceSafely, confirmQuit } from "../lib/actions";
import { pageName } from "../lib/browser";
import { StatusDot } from "./StatusDot";
import { startSnip } from "../snip/snip";
import { MaterialIcon } from "../lib/fileIcons";
import { groupLabel, TOOL_GROUPS, TOOLS, toolById } from "../tools/registry";

const appWindow = getCurrentWindow();

/** The most urgent status among a tab's panes. */
function tabStatus(tab: Tab, panes: ReturnType<typeof useStore.getState>["panes"]): PaneStatus {
  const statuses = paneIds(tab.root).map((id) => panes[id]?.status);
  for (const s of ["attention", "working", "done"] as const) if (statuses.includes(s)) return s;
  return "idle";
}

/** Asks for a folder and opens it as a project workspace tab (file tree + files). */
export async function chooseProject() {
  const dir = await open({ directory: true, multiple: false, title: tr("titleBar.openProjectDialog"), defaultPath: activePane()?.cwd });
  if (typeof dir === "string") useStore.getState().openWorkspace(dir);
}

export async function chooseFolder(kind: "claude" | "shell") {
  const dir = await open({ directory: true, title: tr("titleBar.chooseFolderDialog") });
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
  const { t } = useTranslation();
  const panes = useStore((s) => s.panes);
  const active = useStore((s) => s.activeTabId === tab.id && s.view === "terminal");
  const { setActiveTab } = useStore.getState();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // After layout, so a just-opened tab that made the strip overflow is fully shown.
    if (active) requestAnimationFrame(() => ref.current?.scrollIntoView({ block: "nearest", inline: "nearest" }));
  }, [active]);
  const colors = useStore((s) => s.settings.projectColors);
  const pane = panes[tab.activePaneId];
  if (!pane) return null;
  const label = pane.kind === "browser" ? undefined : projectColorFor(pane.cwd, colors);
  const claude = pane.claudeActive || pane.kind === "claude";
  const isBrowser = pane.kind === "browser";
  const title = isBrowser ? "" : cleanTitle(pane.title);
  const name = isBrowser ? pageName(pane) : folderName(pane.cwd);
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
      className={`anim-fade group relative flex h-8 w-52 min-w-32 shrink items-center gap-2 rounded-md px-2.5 data-[dragging]:z-10 data-[dragging]:cursor-grabbing data-[dragging]:bg-raised ${
        active ? "border border-line bg-surface text-fg" : "border border-transparent text-muted hover:bg-hover hover:text-fg"
      }`}
    >
      {label && <span aria-hidden className="absolute inset-x-2.5 bottom-0 h-0.5 rounded-full" style={{ background: label }} />}
      <span className="flex size-4 shrink-0 items-center justify-center">
        {tabStatus(tab, panes) !== "idle" ? (
          <StatusDot status={tabStatus(tab, panes)} claude={claude} />
        ) : claude ? (
          <Sparkles size={14} className={active ? "text-accent" : ""} />
        ) : isBrowser ? (
          <Globe size={14} className={active ? "text-accent" : ""} />
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
        aria-label={t("titleBar.closeTab")}
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
  const { t } = useTranslation();
  const count = useNeedsYou();
  const active = useStore((s) => s.view === "agents");
  return (
    <button
      aria-label={t("titleBar.agents")}
      title={t("titleBar.agentsHint")}
      onClick={() => useStore.getState().openAgents()}
      className={`relative flex size-8 items-center justify-center rounded-md hover:bg-hover ${active ? "bg-hover text-fg" : "text-muted hover:text-fg"}`}
    >
      <LayoutDashboard size={16} />
      {count > 0 && (
        <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-attention px-1 text-[10px] font-semibold text-black">{count}</span>
      )}
    </button>
  );
}

function AgentsTab() {
  const { t } = useTranslation();
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
      className={`anim-fade group relative flex h-8 w-52 min-w-32 shrink items-center gap-2 rounded-md px-2.5 ${active ? "border border-line bg-surface text-fg" : "border border-transparent text-muted hover:bg-hover hover:text-fg"}`}
    >
      <LayoutDashboard size={14} className={active ? "text-accent" : ""} />
      <span className="truncate font-medium">{t("titleBar.agents")}</span>
      {count > 0 && <span className="rounded-full bg-attention px-1.5 text-[10px] font-semibold text-black">{count}</span>}
      <button
        aria-label={t("titleBar.closeAgents")}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={closeAgents}
        className={`ml-auto flex size-5 shrink-0 items-center justify-center rounded text-muted hover:bg-hover hover:text-fg ${active ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}
      >
        <X size={13} />
      </button>
    </div>
  );
}

function ToolsTab() {
  const { t } = useTranslation();
  const open = useStore((s) => s.toolsOpen);
  const active = useStore((s) => s.view === "tools");
  const tool = useStore((s) => s.tool);
  if (!open) return null;
  const { openTool, closeTools } = useStore.getState();
  const info = toolById(tool);
  return (
    <div
      role="tab"
      aria-selected={active}
      title={t("titleBar.toolsTitle", { tool: info.label })}
      onPointerDown={(e) => e.button === 0 && openTool()}
      onAuxClick={(e) => e.button === 1 && closeTools()}
      className={`anim-fade group relative flex h-8 w-52 min-w-32 shrink items-center gap-2 rounded-md px-2.5 ${active ? "border border-line bg-surface text-fg" : "border border-transparent text-muted hover:bg-hover hover:text-fg"}`}
    >
      <span className={active ? "text-accent" : ""}>{info.icon(14)}</span>
      <span className="truncate font-medium">{info.label}</span>
      <button
        aria-label={t("titleBar.closeTools")}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={closeTools}
        className={`ml-auto flex size-5 shrink-0 items-center justify-center rounded text-muted hover:bg-hover hover:text-fg ${active ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}
      >
        <X size={13} />
      </button>
    </div>
  );
}

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|ico|svg|avif)$/i;

function FileTabButton({ file }: { file: FileTab }) {
  const { t } = useTranslation();
  const active = useStore((s) => s.view === "file" && s.activeFileId === file.id);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // After layout, so a just-opened tab that made the strip overflow is fully shown.
    if (active) requestAnimationFrame(() => ref.current?.scrollIntoView({ block: "nearest", inline: "nearest" }));
  }, [active]);
  const { showFile } = useStore.getState();
  const dirty = file.draft !== undefined;
  const name = file.path.split(/[\\/]/).pop() ?? file.path;
  return (
    <div
      ref={ref}
      role="tab"
      aria-selected={active}
      title={file.path}
      onPointerDown={(e) => e.button === 0 && showFile(file.id)}
      onAuxClick={(e) => e.button === 1 && void closeFileSafely(file.id)}
      className={`anim-fade group relative flex h-8 w-52 min-w-32 shrink items-center gap-2 rounded-md px-2.5 ${active ? "border border-line bg-surface text-fg" : "border border-transparent text-muted hover:bg-hover hover:text-fg"}`}
    >
      <MaterialIcon name={name} size={15} />
      <span className="truncate font-medium">{name}</span>
      <button
        aria-label={dirty ? t("titleBar.closeNamedUnsaved", { name }) : t("titleBar.closeNamed", { name })}
        title={dirty ? t("titleBar.notSaved") : undefined}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => void closeFileSafely(file.id)}
        className={`group/close ml-auto flex size-5 shrink-0 items-center justify-center rounded text-muted hover:bg-hover hover:text-fg ${active || dirty ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}
      >
        {dirty ? (
          <>
            <span className="size-2 rounded-full bg-fg/70 group-hover/close:hidden" />
            <X size={13} className="hidden group-hover/close:block" />
          </>
        ) : (
          <X size={13} />
        )}
      </button>
    </div>
  );
}

function WorkspaceTabButton({ ws }: { ws: Workspace }) {
  const { t } = useTranslation();
  const active = useStore((s) => s.view === "workspace" && s.activeWorkspaceId === ws.id);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (active) requestAnimationFrame(() => ref.current?.scrollIntoView({ block: "nearest", inline: "nearest" }));
  }, [active]);
  const { showWorkspace } = useStore.getState();
  const dirty = ws.files.some((f) => f.draft !== undefined);
  return (
    <div
      ref={ref}
      role="tab"
      aria-selected={active}
      title={ws.root}
      onPointerDown={(e) => e.button === 0 && showWorkspace(ws.id)}
      onAuxClick={(e) => e.button === 1 && void closeWorkspaceSafely(ws.id)}
      className={`anim-fade group relative flex h-8 w-52 min-w-32 shrink items-center gap-2 rounded-md px-2.5 ${active ? "border border-line bg-surface text-fg" : "border border-transparent text-muted hover:bg-hover hover:text-fg"}`}
    >
      <FolderTree size={14} className={active ? "text-accent" : ""} />
      <span className="truncate font-medium">{folderName(ws.root)}</span>
      <button
        aria-label={t("titleBar.closeNamed", { name: folderName(ws.root) })}
        title={dirty ? t("titleBar.unsavedFiles") : undefined}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => void closeWorkspaceSafely(ws.id)}
        className={`group/close ml-auto flex size-5 shrink-0 items-center justify-center rounded text-muted hover:bg-hover hover:text-fg ${active || dirty ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}
      >
        {dirty ? (
          <>
            <span className="size-2 rounded-full bg-fg/70 group-hover/close:hidden" />
            <X size={13} className="hidden group-hover/close:block" />
          </>
        ) : (
          <X size={13} />
        )}
      </button>
    </div>
  );
}

function SnipsTab() {
  const { t } = useTranslation();
  const open = useStore((s) => s.snipsOpen);
  const active = useStore((s) => s.view === "snips");
  if (!open) return null;
  const { openSnips, closeSnips } = useStore.getState();
  return (
    <div
      role="tab"
      aria-selected={active}
      onPointerDown={(e) => e.button === 0 && openSnips()}
      onAuxClick={(e) => e.button === 1 && closeSnips()}
      className={`anim-fade group relative flex h-8 w-52 min-w-32 shrink items-center gap-2 rounded-md px-2.5 ${active ? "border border-line bg-surface text-fg" : "border border-transparent text-muted hover:bg-hover hover:text-fg"}`}
    >
      <Scissors size={14} className={active ? "text-accent" : ""} />
      <span className="truncate font-medium">{t("titleBar.screenshots")}</span>
      <button
        aria-label={t("titleBar.closeScreenshots")}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={closeSnips}
        className={`ml-auto flex size-5 shrink-0 items-center justify-center rounded text-muted hover:bg-hover hover:text-fg ${active ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}
      >
        <X size={13} />
      </button>
    </div>
  );
}

/** Title bar button: snip now, with a delay, or open past screenshots. */
function SnipButton() {
  const { t } = useTranslation();
  const [menu, setMenu] = useState(false);
  const keys = useStore((s) => s.settings.snipShortcut);
  return (
    <div className="relative">
      <button
        aria-label={t("titleBar.snip")}
        title={keys ? t("titleBar.snipHint", { keys }) : t("titleBar.snip")}
        onClick={() => setMenu((m) => !m)}
        className={`flex size-8 items-center justify-center rounded-md hover:bg-hover hover:text-fg ${menu ? "bg-hover text-fg" : "text-muted"}`}
      >
        <Scissors size={16} />
      </button>
      {menu && (
        <Menu
          align="right"
          onClose={() => setMenu(false)}
          items={[
            { label: t("titleBar.snipNow"), hint: keys || undefined, icon: <Scissors size={14} />, onSelect: () => startSnip(0) },
            { label: t("titleBar.snipIn", { count: 3 }), icon: <Timer size={14} />, onSelect: () => startSnip(3) },
            { label: t("titleBar.snipIn", { count: 5 }), icon: <Timer size={14} />, onSelect: () => startSnip(5) },
            { label: t("titleBar.snipIn", { count: 10 }), icon: <Timer size={14} />, onSelect: () => startSnip(10) },
            { label: t("titleBar.screenshots"), icon: <Images size={14} />, onSelect: () => useStore.getState().openSnips(), separatorBefore: true },
          ]}
        />
      )}
    </div>
  );
}

/** The gear: a menu of settings, appearance, help and updates (like VS Code's Manage menu). */
function ManageMenu() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const theme = useStore((st) => st.settings.theme);
  const language = useStore((st) => st.settings.language);
  const s = useStore.getState();
  const items: MenuItem[] = [
    { label: t("titleBar.manage.palette"), hint: "Ctrl+Shift+P", icon: <Command size={14} />, onSelect: () => s.set({ paletteOpen: true }) },
    { label: t("titleBar.settings"), hint: "Ctrl+,", icon: <Settings size={14} />, onSelect: () => s.openSettings(), separatorBefore: true },
    { label: t("shortcuts.openSettingsJson"), hint: "Ctrl+Shift+,", icon: <FileJson size={14} />, onSelect: () => void openSettingsJson() },
    { label: t("titleBar.manage.shortcuts"), icon: <Keyboard size={14} />, onSelect: () => s.openSettings("shortcuts") },
    {
      label: t("titleBar.manage.theme"),
      icon: <Palette size={14} />,
      separatorBefore: true,
      onSelect: () => {},
      submenu: ([["dark", "titleBar.manage.themeDark"], ["light", "titleBar.manage.themeLight"], ["system", "titleBar.manage.sameAsWindows"]] as const).map(([id, key]) => ({
        label: t(key),
        checked: theme === id,
        onSelect: () => s.updateSettings({ theme: id }),
      })),
    },
    {
      label: t("titleBar.manage.language"),
      icon: <Languages size={14} />,
      onSelect: () => {},
      submenu: [
        { label: t("titleBar.manage.sameAsWindows"), checked: language === "auto", onSelect: () => s.updateSettings({ language: "auto" }) },
        ...LANGUAGES.map((l, i) => ({ label: l.name, checked: language === l.code, separatorBefore: i === 0, onSelect: () => s.updateSettings({ language: l.code }) })),
      ],
    },
    {
      label: t("titleBar.manage.claudeSettings"),
      icon: <SlidersHorizontal size={14} />,
      onSelect: () => {},
      submenu: [
        { label: t("titleBar.manage.permissions"), onSelect: () => s.openSettings("permissions") },
        { label: t("titleBar.manage.hooks"), onSelect: () => s.openSettings("hooks") },
        { label: t("titleBar.manage.mcpServers"), onSelect: () => s.openSettings("mcp") },
        { label: "CLAUDE.md", onSelect: () => s.openSettings("memory") },
      ],
    },
    { label: t("app.whatsNew"), icon: <Sparkles size={14} />, onSelect: () => s.openSettings("whats-new"), separatorBefore: true },
    { label: t("titleBar.manage.checkUpdates"), icon: <RefreshCw size={14} />, onSelect: () => void checkForUpdate(true) },
    { label: t("titleBar.manage.report"), icon: <Bug size={14} />, onSelect: () => void openUrl("https://github.com/sovanken/helm-term/issues/new") },
    { label: t("titleBar.manage.about"), icon: <Info size={14} />, onSelect: () => s.openSettings("about") },
  ];
  return (
    <div className="relative">
      <button
        aria-label={t("titleBar.manage.label")}
        aria-expanded={open}
        title={t("titleBar.manage.hint")}
        onClick={() => setOpen((o) => !o)}
        className={`flex size-8 items-center justify-center rounded-md hover:bg-hover hover:text-fg ${open ? "bg-hover text-fg" : "text-muted"}`}
      >
        <Settings size={15} />
      </button>
      {open && <Menu align="right" onClose={() => setOpen(false)} items={items} />}
    </div>
  );
}

function SettingsTab() {
  const { t } = useTranslation();
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
      className={`anim-fade group relative flex h-8 w-52 min-w-32 shrink items-center gap-2 rounded-md px-2.5 ${active ? "border border-line bg-surface text-fg" : "border border-transparent text-muted hover:bg-hover hover:text-fg"}`}
    >
      <Settings size={14} className={active ? "text-accent" : ""} />
      <span className="truncate font-medium">{t("titleBar.settings")}</span>
      <button
        aria-label={t("titleBar.closeSettings")}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={closeSettings}
        className={`ml-auto flex size-5 shrink-0 items-center justify-center rounded text-muted hover:bg-hover hover:text-fg ${active ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}
      >
        <X size={13} />
      </button>
    </div>
  );
}

function UpdateButton() {
  const { t } = useTranslation();
  const update = useStore((s) => s.update);
  const [busy, setBusy] = useState(false);
  if (!update) return null;
  return (
    <button
      title={update.notes || t("titleBar.updateAvailable", { version: update.version })}
      disabled={busy}
      onClick={() => {
        setBusy(true);
        void update.install().catch(() => setBusy(false));
      }}
      className="flex h-8 items-center gap-1.5 rounded-md bg-accent-soft px-2.5 text-[12px] font-medium text-accent hover:bg-accent hover:text-on-accent disabled:opacity-60"
    >
      <Download size={13} /> {busy ? t("titleBar.updating") : t("titleBar.updateTo", { version: update.version })}
    </button>
  );
}

function ChangesToggle() {
  const { t } = useTranslation();
  const open = useStore((s) => s.changesOpen);
  return (
    <button
      aria-label={t("titleBar.sidePanel")}
      title={t("titleBar.sidePanelHint")}
      onClick={() => useStore.getState().set({ changesOpen: !open })}
      className={`flex size-8 items-center justify-center rounded-md hover:bg-hover ${open ? "bg-hover text-fg" : "text-muted hover:text-fg"}`}
    >
      <PanelRight size={16} />
    </button>
  );
}

/** Every open tab, for the "all tabs" list when they don't fit. */
function AllTabsMenu({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const s = useStore();
  const items: MenuItem[] = s.tabs.map((tab, i) => {
    const pane = s.panes[tab.activePaneId];
    const claude = !!pane && (pane.claudeActive || pane.kind === "claude");
    const title = pane ? cleanTitle(pane.title) : "";
    return {
      label: pane?.kind === "browser" ? pageName(pane) : `${pane ? folderName(pane.cwd) : t("titleBar.tab")}${title ? ` · ${title}` : ""}`,
      hint: i < 9 ? `Ctrl+${i + 1}` : undefined,
      icon: pane?.kind === "browser" ? <Globe size={14} /> : claude ? <Sparkles size={14} /> : <SquareTerminal size={14} />,
      current: s.view === "terminal" && s.activeTabId === tab.id,
      onSelect: () => s.setActiveTab(tab.id),
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
  s.workspaces.forEach((w, i) =>
    items.push({
      label: folderName(w.root),
      icon: <FolderTree size={14} />,
      current: s.view === "workspace" && s.activeWorkspaceId === w.id,
      onSelect: () => s.showWorkspace(w.id),
      separatorBefore: i === 0 && items.length > 0,
    }),
  );
  if (s.snipsOpen) items.push({ label: t("titleBar.screenshots"), icon: <Scissors size={14} />, current: s.view === "snips", onSelect: () => s.openSnips(), separatorBefore: true });
  if (s.toolsOpen) items.push({ label: toolById(s.tool).label, icon: <Wrench size={14} />, current: s.view === "tools", onSelect: () => s.openTool(), separatorBefore: true });
  if (s.agentsOpen) items.push({ label: t("titleBar.agents"), icon: <LayoutDashboard size={14} />, current: s.view === "agents", onSelect: s.openAgents, separatorBefore: true });
  if (s.settingsOpen) items.push({ label: t("titleBar.settings"), icon: <Settings size={14} />, current: s.view === "settings", onSelect: () => s.openSettings(), separatorBefore: !s.agentsOpen });
  return <Menu items={items} onClose={onClose} align="right" />;
}

/**
 * The tab strip. Tabs shrink first; when they still don't fit, arrows scroll the strip and a
 * list shows every tab.
 */
function TabStrip({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
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
        <button aria-label={t("titleBar.scrollTabsLeft")} title={t("titleBar.scrollLeft")} disabled={!edges.left} onClick={() => scrollBy(-1)} className={arrow}>
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
          <button aria-label={t("titleBar.scrollTabsRight")} title={t("titleBar.scrollRight")} disabled={!edges.right} onClick={() => scrollBy(1)} className={arrow}>
            <ChevronRight size={15} />
          </button>
          <div className="relative flex shrink-0">
            <button aria-label={t("titleBar.allTabs")} title={t("titleBar.allTabs")} onClick={() => setList((l) => !l)} className={`${arrow} w-7 ${list ? "bg-hover text-fg" : ""}`}>
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
  const { t } = useTranslation();
  const tabs = useStore((s) => s.tabs);
  const fileTabs = useStore((s) => s.fileTabs);
  const workspaces = useStore((s) => s.workspaces);
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
    { label: t("common.newClaudeTab"), hint: "Ctrl+Shift+T", icon: <Sparkles size={14} />, onSelect: () => s.openTab(cwd(), "claude") },
    ...shells.map((sh, i) => ({
      label: t("titleBar.newShellTab", { shell: sh.label }),
      hint: sh.id === s.settings.shell ? "Ctrl+Shift+N" : undefined,
      icon: <SquareTerminal size={14} />,
      onSelect: () => s.openTab(cwd(), "shell", { shell: sh.id }),
      separatorBefore: i === 0,
    })),
    ...(shells.length > 1
      ? shells
          .filter((sh) => sh.id !== s.settings.shell)
          .map((sh) => ({ label: t("titleBar.newClaudeTabIn", { shell: sh.label }), icon: <Sparkles size={14} />, onSelect: () => s.openTab(cwd(), "claude", { shell: sh.id }) }))
      : []),
    { label: t("welcome.openFolder"), icon: <FolderOpen size={14} />, onSelect: () => void chooseFolder("claude") },
    { label: t("titleBar.openProject"), icon: <FolderTree size={14} />, onSelect: () => void chooseProject() },
    { label: t("titleBar.newMarkdown"), icon: <FilePlus size={14} />, onSelect: () => s.set({ newFile: { ext: "md", dir: cwd() } }), separatorBefore: true },
    { label: t("titleBar.newText"), icon: <FilePlus size={14} />, onSelect: () => s.set({ newFile: { ext: "txt", dir: cwd() } }) },
    {
      label: t("titleBar.devTools"),
      icon: <Wrench size={14} />,
      onSelect: () => s.openTool(),
      submenu: TOOL_GROUPS.flatMap((group) =>
        TOOLS.filter((tool) => tool.group === group).map((tool, i) => ({ label: tool.label, icon: tool.icon(14), heading: i === 0 ? groupLabel(group) : undefined, separatorBefore: i === 0 && group !== "Design", onSelect: () => s.openTool(tool.id) })),
      ),
    },
    { label: t("titleBar.newBrowserTab"), icon: <Globe size={14} />, onSelect: () => s.openBrowser("about:blank"), separatorBefore: true },
    ...(tabs.length ? [{ label: t("titleBar.browserBeside"), icon: <Columns2 size={14} />, onSelect: () => s.openBrowser("about:blank", { beside: true }) }] : []),
    ...(tabs.length
      ? [
          { label: t("shortcuts.splitRight"), hint: "Alt+Shift+=", icon: <Columns2 size={14} />, onSelect: () => s.splitActive("row", "shell"), separatorBefore: true },
          { label: t("shortcuts.splitDown"), hint: "Alt+Shift+-", icon: <Rows2 size={14} />, onSelect: () => s.splitActive("column", "shell") },
          { label: t("titleBar.splitRightClaude"), icon: <Sparkles size={14} />, onSelect: () => s.splitActive("row", "claude") },
        ]
      : []),
  ];

  return (
    <header data-tauri-drag-region className="flex h-11 shrink-0 items-center gap-1 bg-bg pl-2">
      <button
        aria-label={t("shortcuts.toggleSidebar")}
        title={t("titleBar.sidebarHint")}
        onClick={() => s.set({ sidebarOpen: !sidebarOpen })}
        className={`flex size-8 items-center justify-center rounded-md hover:bg-hover ${sidebarOpen ? "text-fg" : "text-muted"}`}
      >
        <PanelLeft size={16} />
      </button>

      <TabStrip>
        {tabs.map((tab, i) => (
          <TabButton key={tab.id} tab={tab} index={i} />
        ))}
        {workspaces.map((w) => (
          <WorkspaceTabButton key={w.id} ws={w} />
        ))}
        {fileTabs.map((f) => (
          <FileTabButton key={f.id} file={f} />
        ))}
        <SnipsTab />
        <ToolsTab />
        <AgentsTab />
        <SettingsTab />
      </TabStrip>

      <div className="relative flex shrink-0 items-center">
        <button
          aria-label={t("common.newClaudeTab")}
          title={t("titleBar.newClaudeTabHint")}
          onClick={() => s.openTab(cwd(), "claude")}
          className="flex size-8 items-center justify-center rounded-l-md text-muted hover:bg-hover hover:text-fg"
        >
          <Plus size={16} />
        </button>
        <button
          aria-label={t("titleBar.moreNewTab")}
          onClick={() => setMenu((m) => !m)}
          className="flex h-8 w-5 items-center justify-center rounded-r-md text-muted hover:bg-hover hover:text-fg"
        >
          <ChevronDown size={13} />
        </button>
        {menu && <Menu items={items} onClose={() => setMenu(false)} />}
      </div>

      <div data-tauri-drag-region className="h-full min-w-8 flex-1" />

      <button
        aria-label={t("titleBar.composer")}
        title={t("titleBar.composerHint")}
        onClick={() => useStore.getState().set({ composerOpen: true })}
        className="flex size-8 items-center justify-center rounded-md text-muted hover:bg-hover hover:text-fg"
      >
        <Wand2 size={16} />
      </button>
      <SnipButton />
      <UpdateButton />
      <AgentsButton />
      <ChangesToggle />
      <ManageMenu />

      <div className="ml-1 flex h-full">
        <button aria-label={t("titleBar.minimize")} onClick={() => void appWindow.minimize()} className="flex h-full w-11 items-center justify-center text-muted hover:bg-hover hover:text-fg">
          <Minus size={15} />
        </button>
        <button aria-label={maximized ? t("titleBar.restore") : t("titleBar.maximize")} onClick={() => void appWindow.toggleMaximize()} className="flex h-full w-11 items-center justify-center text-muted hover:bg-hover hover:text-fg">
          {maximized ? <Copy size={12} className="-scale-x-100" /> : <Square size={12} />}
        </button>
        <button
          aria-label={t("common.close")}
          onClick={async () => {
            if (await confirmQuit()) void appWindow.close();
          }} className="flex h-full w-11 items-center justify-center text-muted hover:bg-[#c42b1c] hover:text-white">
          <X size={16} />
        </button>
      </div>
    </header>
  );
}
