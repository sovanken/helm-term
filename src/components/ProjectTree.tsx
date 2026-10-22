import { useEffect, useMemo, useRef, useState } from "react";
import { ask } from "@tauri-apps/plugin-dialog";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { openPath, openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";
import {
  ArrowDownUp,
  BookOpen,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Code2,
  Columns2,
  BarChart3,
  Clock,
  Copy,
  EyeOff as Forget,
  FileCog,
  Globe,
  Link,
  Palette,
  Eye,
  EyeOff,
  FileDown,
  FilePen,
  FolderOpen,
  FolderPlus,
  FolderSearch,
  FolderTree,
  Gauge,
  GitFork,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  Play,
  Plus,
  Search,
  SquareTerminal,
  Trash2,
  X,
} from "lucide-react";
import { ipc, type SessionInfo } from "../lib/ipc";
import { fuzzyScore, timeAgoShort as short } from "../lib/fuzzy";
import { useTranslation } from "react-i18next";
import { t } from "../i18n";
import { exportConversation } from "../lib/actions";
import { paneIds } from "../lib/layout";
import { cleanTitle, folderName, type Pane, PROJECT_COLORS, type ProjectColor, showToast, useStore } from "../state/store";
import { refreshSessions } from "./HistoryList";
import { Menu, type MenuItem } from "./Menu";
import { NewProjectDialog } from "./NewProjectDialog";
import { exportProjectChats, openClaudeFile, ProjectDialog, type ProjectDialogKind, removeFromList } from "./ProjectActions";
import { SidebarSearch } from "./Sidebar";
import { StatusDot } from "./StatusDot";
import { TasksSection } from "./Tasks";
import { chooseFolder } from "./TitleBar";
import { ShimmerRows } from "./Shimmer";

const CHATS_SHOWN = 5;
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
/** A conversation belongs to a project when it ran in that folder or inside it (worktrees). */
const inProject = (cwd: string, project: string) => same(cwd, project) || cwd.toLowerCase().startsWith(`${project.toLowerCase()}\\`);

/** Which projects are expanded is a per-viewer convenience, kept in localStorage. */
function loadExpanded(): Set<string> | null {
  try {
    const raw = localStorage.getItem("helm-expanded");
    return raw ? new Set(JSON.parse(raw) as string[]) : null;
  } catch {
    return null;
  }
}
function saveExpanded(set: Set<string>) {
  try {
    localStorage.setItem("helm-expanded", JSON.stringify([...set]));
  } catch {
    // Not important if it can't be saved.
  }
}

function useOpenPanes() {
  const panes = useStore((s) => s.panes);
  return useMemo(() => {
    const bySession = new Map<string, Pane>();
    for (const p of Object.values(panes)) {
      if (p.sessionId) bySession.set(p.sessionId, p);
      if (p.resumeSessionId) bySession.set(p.resumeSessionId, p);
    }
    return bySession;
  }, [panes]);
}

function focusPane(pane: Pane) {
  const s = useStore.getState();
  const tab = s.tabs.find((t) => paneIds(t.root).includes(pane.id));
  if (tab) s.setActiveTab(tab.id);
  s.focusPane(pane.id);
}

/** Lists the files Claude edited or created in a conversation; each opens in a Helm tab. */
function FilesDialog({ session, onClose }: { session: SessionInfo; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [files, setFiles] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { t } = useTranslation();
  useEffect(() => {
    ref.current?.showModal();
    ipc.sessionFiles(session.id).then(setFiles, (e) => setError(String(e)));
  }, [session.id]);
  const rel = (f: string) => (inProject(f, session.cwd) ? f.slice(session.cwd.length).replace(/^[\\/]/, "") : f);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      className="m-auto w-[520px] max-w-[calc(100vw-32px)] rounded-xl border border-line bg-surface p-0 text-fg shadow-2xl shadow-black/30 backdrop:bg-black/40"
    >
      <div className="flex items-start gap-3 border-b border-line px-5 py-3.5">
        <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
          <FilePen size={15} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-[15px] font-semibold">{t("sidebar.filesDialog.title")}</h2>
          <p className="truncate text-[12px] text-muted">{session.title}</p>
        </div>
        <button aria-label={t("common.close")} onClick={onClose} className="flex size-7 items-center justify-center rounded-md text-muted hover:bg-hover hover:text-fg">
          <X size={15} />
        </button>
      </div>
      <div className="scroll-thin max-h-[60vh] overflow-y-auto p-2">
        {error && <p className="p-3 text-[12px] text-danger">{error}</p>}
        {!files && !error && <ShimmerRows rows={6} className="p-3" />}
        {files?.length === 0 && <p className="p-3 text-[12px] text-faint">{t("sidebar.filesDialog.none")}</p>}
        {files?.map((f) => (
          <button
            key={f}
            title={f}
            onClick={() => {
              useStore.getState().openFile(f, session.cwd);
              onClose();
            }}
            className="flex w-full items-center gap-2.5 rounded-md px-3 py-1.5 text-left hover:bg-hover"
          >
            <FilePen size={13} className="shrink-0 text-faint" />
            <span className="truncate font-mono text-[12px] text-fg">{rel(f)}</span>
          </button>
        ))}
      </div>
      {files && files.length > 0 && <p className="border-t border-line px-5 py-2.5 text-[12px] text-faint">{t("sidebar.filesDialog.footer", { count: files.length })}</p>}
    </dialog>
  );
}

function ConversationRow({ session, showProject, open }: { session: SessionInfo; showProject?: boolean; open?: Pane }) {
  const [menu, setMenu] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [files, setFiles] = useState(false);
  const meta = useStore((s) => s.settings.sessionMeta?.[session.id]);
  const s = useStore.getState();
  const title = meta?.title || session.title;
  const { t } = useTranslation();

  const items: MenuItem[] = [
    { label: open ? t("sidebar.conversation.goToTab") : t("sidebar.conversation.continue"), icon: <Play size={14} />, onSelect: () => s.resumeSession(session) },
    ...(!open && s.tabs.length
      ? [{ label: t("sidebar.conversation.continueBeside"), icon: <Columns2 size={14} />, onSelect: () => (s.set({ view: "terminal" }), s.splitActive("row", "claude", { resumeSessionId: session.id, cwd: session.cwd })) }]
      : []),
    { label: t("sidebar.conversation.branch"), icon: <GitFork size={14} />, onSelect: () => s.openTab(session.cwd, "claude", { resumeSessionId: session.id, fork: true }) },
    {
      label: t("sidebar.conversation.read"),
      icon: <BookOpen size={14} />,
      onSelect: () =>
        void ipc.sessionMarkdown(session.id, title).then(
          (path) => useStore.getState().openFile(path, session.cwd),
          (e) => showToast(String(e), "error"),
        ),
    },
    { label: t("sidebar.conversation.usage"), icon: <Gauge size={14} />, onSelect: () => s.set({ historyDetail: session }), separatorBefore: true },
    { label: t("sidebar.filesDialog.title"), icon: <FilePen size={14} />, onSelect: () => setFiles(true) },
    { label: t("sidebar.conversation.rename"), icon: <Pencil size={14} />, onSelect: () => setRenaming(true), separatorBefore: true },
    { label: meta?.pinned ? t("sidebar.unpin") : t("sidebar.pin"), icon: meta?.pinned ? <PinOff size={14} /> : <Pin size={14} />, onSelect: () => s.updateSessionMeta(session.id, { pinned: !meta?.pinned }) },
    { label: meta?.hidden ? t("sidebar.conversation.showAgain") : t("sidebar.conversation.hide"), icon: meta?.hidden ? <Eye size={14} /> : <EyeOff size={14} />, onSelect: () => s.updateSessionMeta(session.id, { hidden: !meta?.hidden }) },
    {
      label: t("sidebar.conversation.openProjectIn"),
      icon: <FolderOpen size={14} />,
      separatorBefore: true,
      onSelect: () => {},
      submenu: [
        { label: t("sidebar.conversation.helmFiles"), icon: <FolderTree size={14} />, onSelect: () => s.openWorkspace(session.cwd) },
        { label: "File Explorer", icon: <FolderSearch size={14} />, onSelect: () => void openPath(session.cwd).catch((e) => showToast(String(e), "error")) },
        { label: t("sidebar.conversation.editor"), icon: <Code2 size={14} />, onSelect: () => void ipc.openInEditor(session.cwd).then((ok) => !ok && showToast(t("sidebar.conversation.editorFailed"), "error")) },
        { label: t("sidebar.conversation.terminal"), icon: <SquareTerminal size={14} />, onSelect: () => s.openTab(session.cwd, "shell") },
      ],
    },
    {
      label: t("common.copy"),
      icon: <Copy size={14} />,
      onSelect: () => {},
      submenu: [
        { label: t("sidebar.conversation.resumeCommand"), hint: "claude --resume …", icon: <SquareTerminal size={14} />, onSelect: () => void writeText(`claude --resume ${session.id}`) },
        { label: t("sidebar.conversation.conversationId"), icon: <Copy size={14} />, onSelect: () => void writeText(session.id) },
      ],
    },
    { label: t("sidebar.conversation.exportMarkdown"), icon: <FileDown size={14} />, onSelect: () => void exportConversation(session) },
    {
      label: t("common.delete"),
      icon: <Trash2 size={14} />,
      danger: true,
      separatorBefore: true,
      onSelect: async () => {
        if (open) return showToast(t("sidebar.conversation.closeFirst"), "error");
        const yes = await ask(t("sidebar.conversation.deleteMessage", { title }), {
          title: t("sidebar.conversation.deleteTitle"),
          kind: "warning",
          okLabel: t("common.delete"),
          cancelLabel: t("common.cancel"),
        });
        if (!yes) return;
        try {
          await ipc.sessionDelete(session.id);
          useStore.getState().updateSessionMeta(session.id, { title: undefined, pinned: false, hidden: false });
          await refreshSessions();
          showToast(t("sidebar.conversation.deleted"), "success");
        } catch (e) {
          showToast(String(e), "error");
        }
      },
    },
  ];

  return (
    <div className="group/chat relative">
      {renaming ? (
        <form
          className="flex items-center gap-1.5 py-1 pr-1 pl-7"
          onSubmit={(e) => {
            e.preventDefault();
            const value = new FormData(e.currentTarget).get("title")?.toString().trim() ?? "";
            s.updateSessionMeta(session.id, { title: value && value !== session.title ? value : undefined });
            setRenaming(false);
          }}
        >
          <input
            name="title"
            autoFocus
            defaultValue={title}
            onFocus={(e) => e.currentTarget.select()}
            onKeyDown={(e) => e.key === "Escape" && setRenaming(false)}
            onBlur={(e) => e.currentTarget.form?.requestSubmit()}
            aria-label={t("sidebar.conversation.newTitle")}
            className="min-w-0 flex-1 rounded-md border border-accent bg-bg px-2 py-1 text-[12.5px] text-fg outline-none"
          />
        </form>
      ) : (
        <button
          onClick={() => s.resumeSession(session)}
          title={`${title}\n${session.cwd}\n\n${open ? t("sidebar.conversation.tooltipOpen") : t("sidebar.conversation.tooltipContinue")}`}
          className={`flex w-full items-center gap-2 rounded-md py-1.5 pr-2 text-left hover:bg-hover ${showProject ? "pl-2.5" : "pl-7"} ${open ? "text-fg" : "text-fg/85"}`}
        >
          {open ? <StatusDot status={open.status} claude /> : meta?.pinned ? <Pin size={11} className="shrink-0 text-faint" /> : null}
          <span className="min-w-0 flex-1">
            <span data-private className={`block truncate text-[12.5px] ${open ? "font-medium" : ""}`}>{title}</span>
            {showProject && <span data-private className="block truncate text-[11px] text-faint">{folderName(session.cwd)}</span>}
          </span>
          <span className={`shrink-0 text-[11px] text-faint tabular-nums ${menu ? "invisible" : "group-hover/chat:invisible"}`}>
            {meta?.hidden ? t("sidebar.conversation.hidden") : short(session.lastUsed)}
          </span>
        </button>
      )}
      {!renaming && (
        <div className={`absolute top-1/2 right-1 -translate-y-1/2 ${menu ? "block" : "hidden group-hover/chat:block"}`}>
          <button aria-label={t("sidebar.conversation.actions")} onClick={() => setMenu((m) => !m)} className="flex size-6 items-center justify-center rounded-md bg-raised text-muted hover:text-fg">
            <MoreHorizontal size={14} />
          </button>
          {menu && <Menu align="right" onClose={() => setMenu(false)} items={items} />}
        </div>
      )}
      {files && <FilesDialog session={session} onClose={() => setFiles(false)} />}
    </div>
  );
}

/** Copies, then confirms with `done` (already translated). */
function copy(text: string, done: string) {
  void writeText(text).then(() => showToast(done, "success"));
}

/** The project ⋯ menu: open, organise, copy, Claude files, chats, then the folder itself. */
function projectMenu(path: string, pinned: boolean, color: ProjectColor | undefined, remote: { web?: string; clone: string } | null, open: (d: ProjectDialogKind) => void): MenuItem[] {
  const { openTab, togglePin, updateSettings } = useStore.getState();
  const setColor = (c: ProjectColor | null) => {
    const { [path.toLowerCase()]: _, ...rest } = useStore.getState().settings.projectColors;
    updateSettings({ projectColors: c ? { ...rest, [path.toLowerCase()]: c } : rest });
  };
  const host = remote?.web ? new URL(remote.web).hostname.replace(/^www\./, "") : "";
  const hostName = host === "github.com" ? "GitHub" : host === "gitlab.com" ? "GitLab" : host === "bitbucket.org" ? "Bitbucket" : host;
  const items: MenuItem[] = [
    { label: t("sidebar.project.openFiles"), icon: <FolderTree size={14} />, onSelect: () => useStore.getState().openWorkspace(path) },
    { label: t("common.newClaudeTab"), icon: <Plus size={14} />, onSelect: () => openTab(path, "claude") },
    { label: t("common.newTerminalTab"), icon: <SquareTerminal size={14} />, onSelect: () => openTab(path, "shell") },
    { label: pinned ? t("sidebar.unpin") : t("sidebar.pin"), icon: pinned ? <PinOff size={14} /> : <Pin size={14} />, onSelect: () => togglePin(path), separatorBefore: true },
    {
      label: t("sidebar.projectMenu.colorLabel"),
      icon: <Palette size={14} />,
      onSelect: () => {},
      submenu: [
        ...(Object.keys(PROJECT_COLORS) as ProjectColor[]).map((c) => ({
          label: t(`sidebar.colors.${c}`),
          icon: <span className="size-3 rounded-full" style={{ background: PROJECT_COLORS[c].hex }} />,
          checked: color === c,
          onSelect: () => setColor(c),
        })),
        { label: t("sidebar.projectMenu.noColor"), checked: !color, onSelect: () => setColor(null), separatorBefore: true },
      ],
    },
    {
      label: t("common.copyPath"),
      icon: <Copy size={14} />,
      separatorBefore: true,
      onSelect: () => {},
      submenu: [
        { label: t("sidebar.projectMenu.fullPath"), hint: path.length > 34 ? `…${path.slice(-32)}` : path, onSelect: () => copy(path, t("sidebar.projectMenu.copiedPath")) },
        { label: t("sidebar.projectMenu.folderName"), hint: folderName(path), onSelect: () => copy(folderName(path), t("sidebar.projectMenu.copiedFolderName")) },
      ],
    },
    { label: t("common.openInEditor"), icon: <Code2 size={14} />, onSelect: () => void ipc.openInEditor(path) },
    { label: t("common.showInExplorer"), icon: <FolderSearch size={14} />, onSelect: () => void revealItemInDir(path) },
  ];
  if (remote?.web) items.push({ label: t("sidebar.projectMenu.openOn", { host: hostName }), icon: <Globe size={14} />, onSelect: () => void openUrl(remote.web!) });
  if (remote) items.push({ label: t("sidebar.projectMenu.copyCloneUrl"), icon: <Link size={14} />, onSelect: () => copy(remote.clone, t("sidebar.projectMenu.copiedCloneUrl")) });
  items.push(
    {
      label: t("sidebar.projectMenu.claudeSettings"),
      icon: <FileCog size={14} />,
      separatorBefore: true,
      onSelect: () => {},
      submenu: [
        { label: t("sidebar.projectMenu.projectNotes"), hint: "CLAUDE.md", onSelect: () => void openClaudeFile(path, "memory") },
        { label: t("sidebar.projectMenu.sharedSettings"), hint: ".claude/settings.json", onSelect: () => void openClaudeFile(path, "shared") },
        { label: t("sidebar.projectMenu.localSettings"), hint: ".claude/settings.local.json", onSelect: () => void openClaudeFile(path, "local") },
      ],
    },
    { label: t("sidebar.projectMenu.usage"), icon: <BarChart3 size={14} />, onSelect: () => open("usage") },
    { label: t("sidebar.projectMenu.exportAll"), icon: <FileDown size={14} />, onSelect: () => void exportProjectChats(path) },
    { label: t("sidebar.projectMenu.deleteOld"), icon: <Clock size={14} />, onSelect: () => open("old-chats") },
    { label: t("sidebar.projectMenu.renameFolder"), icon: <Pencil size={14} />, onSelect: () => open("rename"), separatorBefore: true },
    { label: t("sidebar.projectMenu.removeFromList"), icon: <Forget size={14} />, onSelect: () => removeFromList(path) },
    { label: t("sidebar.projectMenu.deleteFolder"), icon: <Trash2 size={14} />, danger: true, onSelect: () => open("delete") },
  );
  return items;
}

function ProjectGroup({
  path,
  pinned,
  chats,
  lastUsed,
  expanded,
  onToggle,
  openBySession,
}: {
  path: string;
  pinned: boolean;
  chats: SessionInfo[];
  lastUsed?: number;
  expanded: boolean;
  onToggle: () => void;
  openBySession: Map<string, Pane>;
}) {
  const [menu, setMenu] = useState(false);
  const [all, setAll] = useState(false);
  const [dialog, setDialog] = useState<ProjectDialogKind | null>(null);
  const [remote, setRemote] = useState<{ web?: string; clone: string } | null>(null);
  const { t } = useTranslation();
  const panes = useStore((s) => s.panes);
  const color = useStore((s) => s.settings.projectColors[path.toLowerCase()]);
  const { openTab } = useStore.getState();
  const here = Object.values(panes).filter((p) => p.kind !== "browser" && inProject(p.cwd, path));
  const waiting = here.some((p) => p.status === "attention");
  const working = here.some((p) => p.status === "working");
  const shown = all ? chats : chats.slice(0, CHATS_SHOWN);

  return (
    <div className="mb-0.5">
      <div className="group/project relative">
        <button
          onClick={onToggle}
          aria-expanded={expanded}
          title={path}
          className="flex w-full items-center gap-1.5 rounded-md py-1.5 pr-2 pl-1 text-left hover:bg-hover"
        >
          <ChevronRight size={13} className={`shrink-0 text-faint transition-transform duration-150 ${expanded ? "rotate-90" : ""}`} />
          <span className={`relative flex size-5 shrink-0 items-center justify-center rounded ${here.length ? "text-accent" : "text-muted"}`} style={color ? { color: PROJECT_COLORS[color].hex } : undefined}>
            <FolderOpen size={14} strokeWidth={1.8} />
            {(waiting || working) && <span className={`absolute -top-0.5 -right-0.5 size-2 rounded-full ring-2 ring-[var(--bg)] ${waiting ? "status-attention bg-attention" : "bg-working"}`} />}
          </span>
          <span data-private className="min-w-0 flex-1 truncate text-[13px] font-medium text-fg">{folderName(path)}</span>
          {here.length > 0 && (
            <span className="shrink-0 rounded-full bg-accent-soft px-1.5 text-[10px] font-semibold text-accent group-hover/project:invisible" title={t("sidebar.project.openTabs", { count: here.length })}>
              {t("sidebar.project.openBadge", { count: here.length })}
            </span>
          )}
          {!here.length && lastUsed && <span className="shrink-0 text-[11px] text-faint tabular-nums group-hover/project:invisible">{short(lastUsed)}</span>}
        </button>
        <div className={`absolute top-1/2 right-1 flex -translate-y-1/2 items-center gap-0.5 ${menu ? "flex" : "hidden group-hover/project:flex"}`}>
          <button aria-label={t("sidebar.project.openFiles")} title={t("sidebar.project.openFiles")} onClick={() => useStore.getState().openWorkspace(path)} className="flex size-6 items-center justify-center rounded-md bg-raised text-muted hover:text-fg">
            <FolderTree size={14} />
          </button>
          <button aria-label={t("sidebar.newClaudeTabHere")} title={t("sidebar.newClaudeTabHere")} onClick={() => openTab(path, "claude")} className="flex size-6 items-center justify-center rounded-md bg-raised text-muted hover:text-fg">
            <Plus size={14} />
          </button>
          <div className="relative">
            <button
              aria-label={t("sidebar.project.actions")}
              onClick={() => {
                if (!menu) void ipc.projectRemote(path).then(setRemote, () => setRemote(null));
                setMenu((m) => !m);
              }} className="flex size-6 items-center justify-center rounded-md bg-raised text-muted hover:text-fg">
              <MoreHorizontal size={14} />
            </button>
            {menu && (
              <Menu
                align="right"
                onClose={() => setMenu(false)}
                items={projectMenu(path, pinned, color, remote, setDialog)}
              />
            )}
          </div>
        </div>
      </div>
      {dialog && <ProjectDialog kind={dialog} path={path} onClose={() => setDialog(null)} />}
      {expanded && (
        <div className="anim-fade">
          {shown.map((c) => (
            <ConversationRow key={c.id} session={c} open={openBySession.get(c.id)} />
          ))}
          {chats.length === 0 && <p className="py-1 pl-7 text-[12px] text-faint">{t("sidebar.project.noChats")}</p>}
          {chats.length > CHATS_SHOWN && (
            <button onClick={() => setAll(!all)} className="rounded-md py-1 pl-7 text-left text-[12px] text-muted hover:text-fg">
              {all ? t("common.showLess") : t("sidebar.project.showAll", { count: chats.length })}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** Claude sessions that are working, waiting on you, or finished and not seen yet. */
function RunningNow() {
  const panes = useStore((s) => s.panes);
  const sessions = useStore((s) => s.sessions);
  const metas = useStore((s) => s.settings.sessionMeta);
  const { t } = useTranslation();
  const live =Object.values(panes).filter((p) => p.kind !== "browser" && (p.claudeActive || p.kind === "claude") && p.status !== "idle");
  if (!live.length) return null;
  const order = { attention: 0, working: 1, done: 2, idle: 3 };
  live.sort((a, b) => order[a.status] - order[b.status]);
  return (
    <section className="mb-2">
      <h2 className="px-2.5 pt-2 pb-1 text-[11px] font-semibold tracking-wide text-faint uppercase">{t("sidebar.running.title")}</h2>
      {live.map((p) => {
        const session = sessions.find((x) => x.id === p.sessionId);
        const title = (p.sessionId && metas?.[p.sessionId]?.title) || cleanTitle(p.title) || session?.title || t("sidebar.running.newConversation");
        const state = p.status === "attention" ? p.attentionMessage || t("sidebar.running.needsYou") : p.status === "working" ? p.doing || t("sidebar.running.working") : t("sidebar.running.finished");
        return (
          <button key={p.id} onClick={() => focusPane(p)} title={`${title}\n${p.cwd}`} className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left hover:bg-hover">
            <StatusDot status={p.status} claude />
            <span className="min-w-0 flex-1">
              <span data-private className="block truncate text-[12.5px] font-medium text-fg">{title}</span>
              <span data-private className={`block truncate text-[11px] ${p.status === "attention" ? "text-attention" : "text-faint"}`}>
                {state} · {folderName(p.cwd)}
              </span>
            </span>
          </button>
        );
      })}
    </section>
  );
}

/** The sidebar: running sessions, then pinned and recent projects, each expanding to its chats. */
export function ProjectTree() {
  const sessionsLoaded = useStore((s) => s.sessionsLoaded);
  const sessions = useStore((s) => s.sessions);
  const recent = useStore((s) => s.recent);
  const pinned = useStore((s) => s.pinned);
  const metas = useStore((s) => s.settings.sessionMeta);
  const activity = useStore((s) => s.activity);
  const openBySession = useOpenPanes();
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Map<string, string>>(new Map());
  const [searching, setSearching] = useState(false);
  const [showHidden, setShowHidden] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [sortMenu, setSortMenu] = useState(false);
  const [newProject, setNewProject] = useState(false);
  const sort = useStore((s) => s.settings.projectSort);
  const hiddenProjects = useStore((s) => s.settings.hiddenProjects);
  const blur = useStore((s) => s.settings.privacyBlur);
  const home = useStore((s) => s.homeDir);
  const { t } = useTranslation();

  useEffect(() => {
    const open = () => {
      setSearchOpen(true);
      requestAnimationFrame(() => document.getElementById("sidebar-search")?.focus());
    };
    window.addEventListener("helm:sidebar-search", open);
    return () => window.removeEventListener("helm:sidebar-search", open);
  }, []);
  const [expanded, setExpanded] = useState<Set<string>>(() => loadExpanded() ?? new Set());

  useEffect(() => {
    const t = setTimeout(() => void refreshSessions(), activity ? 1500 : 0);
    return () => clearTimeout(t);
  }, [activity]);

  // Full-text search through conversations, debounced.
  useEffect(() => {
    setHits(new Map());
    if (query.trim().length < 3) return;
    setSearching(true);
    const t = setTimeout(() => {
      void ipc
        .searchSessions(query)
        .then((list) => setHits(new Map(list.map((h) => [h.sessionId, h.snippet]))))
        .finally(() => setSearching(false));
    }, 300);
    return () => clearTimeout(t);
  }, [query]);

  const hiddenCount = useMemo(() => sessions.filter((s) => metas?.[s.id]?.hidden).length, [sessions, metas]);
  const visible = useMemo(() => sessions.filter((s) => showHidden || !metas?.[s.id]?.hidden), [sessions, metas, showHidden]);
  const pinnedChats = useMemo(() => visible.filter((s) => metas?.[s.id]?.pinned), [visible, metas]);

  // Projects: pinned first, then every folder seen in recent projects or conversations.
  const projects = useMemo(() => {
    const map = new Map<string, { path: string; lastUsed: number }>();
    const add = (path: string, lastUsed = 0) => {
      const key = path.toLowerCase();
      const cur = map.get(key);
      if (!cur) map.set(key, { path, lastUsed });
      else cur.lastUsed = Math.max(cur.lastUsed, lastUsed);
    };
    for (const r of recent) add(r.path, r.lastUsed);
    for (const s of sessions) {
      const owner = [...map.values()].find((p) => inProject(s.cwd, p.path));
      if (owner) owner.lastUsed = Math.max(owner.lastUsed, s.lastUsed);
      else add(s.cwd, s.lastUsed);
    }
    const isPinned = (p: string) => pinned.some((x) => same(x, p));
    // Removed from the list, unless used again since.
    for (const [key, at] of Object.entries(hiddenProjects)) {
      const p = map.get(key);
      if (p && p.lastUsed <= at) map.delete(key);
    }
    const chatCount = (path: string) => sessions.filter((s) => inProject(s.cwd, path)).length;
    const list = [...map.values()].sort((a, b) =>
      sort === "name" ? folderName(a.path).localeCompare(folderName(b.path), undefined, { sensitivity: "base" }) : sort === "chats" ? chatCount(b.path) - chatCount(a.path) || b.lastUsed - a.lastUsed : b.lastUsed - a.lastUsed,
    );
    return {
      pinned: pinned.map((p) => map.get(p.toLowerCase()) ?? { path: p, lastUsed: 0 }),
      recent: list.filter((p) => !isPinned(p.path)),
    };
  }, [recent, sessions, pinned, sort, hiddenProjects]);

  const chatsFor = (path: string) => visible.filter((s) => inProject(s.cwd, path) && !metas?.[s.id]?.pinned);

  // Projects with an open tab start expanded the first time.
  const isOpen = (path: string) => expanded.has(path.toLowerCase()) || (!loadExpanded() && [...openBySession.values()].some((p) => inProject(p.cwd, path)));
  const toggle = (path: string) => {
    const next = new Set(expanded);
    const key = path.toLowerCase();
    if (isOpen(path)) next.delete(key);
    else next.add(key);
    // First toggle: remember what was showing, so other projects don't jump closed.
    if (!loadExpanded()) for (const p of [...projects.pinned, ...projects.recent]) if (p.path.toLowerCase() !== key && isOpen(p.path)) next.add(p.path.toLowerCase());
    setExpanded(next);
    saveExpanded(next);
  };

  const allProjects = [...projects.pinned, ...projects.recent];
  const anyOpen = allProjects.some((p) => isOpen(p.path));
  const setAllOpen = (open: boolean) => {
    const next = new Set(open ? allProjects.map((p) => p.path.toLowerCase()) : []);
    setExpanded(next);
    saveExpanded(next);
  };
  const openSearch = () => {
    setSearchOpen(true);
    requestAnimationFrame(() => document.getElementById("sidebar-search")?.focus());
  };
  // New projects go next to the most recent one by default.
  const newProjectParent = (() => {
    const last = projects.recent[0]?.path ?? projects.pinned[0]?.path;
    const cut = last ? Math.max(last.lastIndexOf(String.fromCharCode(92)), last.lastIndexOf("/")) : -1;
    return cut > 2 && last && !same(last, home) ? last.slice(0, cut) : home;
  })();
  const SORTS: { id: typeof sort; label: string }[] = [
    { id: "recent", label: t("sidebar.sorts.recent") },
    { id: "name", label: t("sidebar.sorts.name") },
    { id: "chats", label: t("sidebar.sorts.chats") },
  ];
  const iconBtn = "flex size-6 items-center justify-center rounded-md text-faint hover:bg-hover hover:text-fg";

  const q = query.trim();
  const results = useMemo(() => {
    if (!q) return null;
    const projectHits = [...projects.pinned, ...projects.recent].filter((p) => fuzzyScore(q, folderName(p.path)) >= 0 || p.path.toLowerCase().includes(q.toLowerCase()));
    const chatHits = visible
      .map((s) => {
        const title = metas?.[s.id]?.title || s.title;
        const score = Math.max(fuzzyScore(q, title), fuzzyScore(q, folderName(s.cwd)) - 50, fuzzyScore(q, s.firstPrompt) - 100, hits.has(s.id) ? 500 : -1);
        return { s, score };
      })
      .filter((r) => r.score >= 0)
      .sort((a, b) => b.score - a.score)
      .map((r) => r.s);
    return { projectHits, chatHits };
  }, [q, projects, visible, metas, hits]);

  const group = (p: { path: string; lastUsed: number }, isPinned: boolean) => (
    <ProjectGroup
      key={p.path}
      path={p.path}
      pinned={isPinned}
      lastUsed={p.lastUsed || undefined}
      chats={chatsFor(p.path)}
      expanded={isOpen(p.path)}
      onToggle={() => toggle(p.path)}
      openBySession={openBySession}
    />
  );

  return (
    <div className={`flex min-h-0 flex-1 flex-col ${blur ? "privacy" : ""}`}>
      <div className="flex items-center gap-0.5 pr-2 pb-1 pl-4">
        <h2 className="flex-1 text-[11px] font-semibold tracking-wide text-faint uppercase">{t("sidebar.projects")}</h2>
        <button aria-label={t("common.search")} title={t("sidebar.searchTitle")} onClick={() => (searchOpen ? (setQuery(""), setSearchOpen(false)) : openSearch())} className={`${iconBtn} ${searchOpen ? "bg-hover text-fg" : ""}`}>
          <Search size={14} />
        </button>
        <div className="relative">
          <button aria-label={t("sidebar.sortProjects")} title={t("sidebar.sortProjects")} onClick={() => setSortMenu((m) => !m)} className={`${iconBtn} ${sortMenu ? "bg-hover text-fg" : ""}`}>
            <ArrowDownUp size={14} />
          </button>
          {sortMenu && (
            <Menu
              align="right"
              onClose={() => setSortMenu(false)}
              items={SORTS.map((o, i) => ({ label: o.label, heading: i === 0 ? t("sidebar.sortBy") : undefined, checked: sort === o.id, onSelect: () => useStore.getState().updateSettings({ projectSort: o.id }) }))}
            />
          )}
        </div>
        <button aria-label={anyOpen ? t("sidebar.collapseAll") : t("sidebar.expandAll")} title={anyOpen ? t("sidebar.collapseAllProjects") : t("sidebar.expandAllProjects")} onClick={() => setAllOpen(!anyOpen)} className={iconBtn}>
          {anyOpen ? <ChevronsDownUp size={14} /> : <ChevronsUpDown size={14} />}
        </button>
        <button
          aria-label={t("sidebar.blurNames")}
          aria-pressed={blur}
          title={blur ? t("sidebar.blurOff") : t("sidebar.blurOn")}
          onClick={() => useStore.getState().updateSettings({ privacyBlur: !blur })}
          className={`${iconBtn} ${blur ? "bg-accent-soft text-accent hover:bg-accent-soft hover:text-accent" : ""}`}
        >
          {blur ? <EyeOff size={14} /> : <Eye size={14} />}
        </button>
        <button aria-label={t("sidebar.newProject")} title={t("sidebar.newProject")} onClick={() => setNewProject(true)} className={iconBtn}>
          <FolderPlus size={14} />
        </button>
      </div>
      {newProject && <NewProjectDialog parent={newProjectParent} onClose={() => setNewProject(false)} />}
      {/* Search only shows while in use (Ctrl+Shift+H); an empty box closes again when you leave it. */}
      {searchOpen && (
        <div
          onBlur={(e) => !query && !e.currentTarget.contains(e.relatedTarget as Node | null) && setSearchOpen(false)}
          onKeyDown={(e) => e.key === "Escape" && !query && setSearchOpen(false)}
        >
          <SidebarSearch value={query} onChange={setQuery} placeholder={t("sidebar.searchPlaceholder")} busy={searching} />
        </div>
      )}

      <div className="scroll-thin flex-1 overflow-y-auto px-1.5 pb-3">
        {results ? (
          <>
            {results.projectHits.length > 0 && (
              <section className="mb-2">
                <h2 className="px-2.5 pt-2 pb-1 text-[11px] font-semibold tracking-wide text-faint uppercase">{t("sidebar.projects")}</h2>
                {results.projectHits.map((p) => group(p, pinned.some((x) => same(x, p.path))))}
              </section>
            )}
            <section>
              <h2 className="px-2.5 pt-2 pb-1 text-[11px] font-semibold tracking-wide text-faint uppercase">{t("sidebar.conversations")}</h2>
              {results.chatHits.map((s) => (
                <div key={s.id}>
                  <ConversationRow session={s} showProject open={openBySession.get(s.id)} />
                  {hits.get(s.id) && <p data-private className="mx-2.5 mb-1 line-clamp-2 rounded bg-accent-soft px-1.5 py-0.5 text-[11px] text-muted">{hits.get(s.id)}</p>}
                </div>
              ))}
              {results.chatHits.length === 0 && (searching ? <ShimmerRows rows={3} icon={false} className="px-2.5" /> : <p className="px-2.5 py-1 text-[12px] text-faint">{t("sidebar.noMatch")}</p>)}
            </section>
          </>
        ) : (
          <>
            <RunningNow />
            {(pinnedChats.length > 0 || projects.pinned.length > 0) && (
              <section className="mb-2">
                <h2 className="px-2.5 pt-2 pb-1 text-[11px] font-semibold tracking-wide text-faint uppercase">{t("sidebar.pinned")}</h2>
                {pinnedChats.map((s) => (
                  <ConversationRow key={s.id} session={s} showProject open={openBySession.get(s.id)} />
                ))}
                {projects.pinned.map((p) => group(p, true))}
              </section>
            )}
            <section className="mb-2">
              <h2 className="px-2.5 pt-2 pb-1 text-[11px] font-semibold tracking-wide text-faint uppercase">{t("sidebar.recent")}</h2>
              {projects.recent.map((p) => group(p, false))}
              {projects.recent.length === 0 && projects.pinned.length === 0 && !sessionsLoaded && <ShimmerRows rows={4} className="px-2.5" />}
              {projects.recent.length === 0 && projects.pinned.length === 0 && sessionsLoaded && (
                <div className="mx-1 mt-1 flex flex-col items-center gap-2 rounded-lg border border-dashed border-line px-3 py-5 text-center">
                  <FolderOpen size={18} className="text-faint" />
                  <p className="text-[12px] leading-relaxed text-faint">{t("sidebar.empty")}</p>
                  <button onClick={() => void chooseFolder("claude")} className="rounded-md px-2 py-1 text-[12px] font-medium text-accent hover:bg-hover">
                    {t("sidebar.openFolder")}
                  </button>
                </div>
              )}
            </section>
            <TasksSection />
            {hiddenCount > 0 && (
              <button onClick={() => setShowHidden(!showHidden)} className="mt-1 flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[12px] text-faint hover:text-fg">
                {showHidden ? <EyeOff size={12} /> : <Eye size={12} />}
                {showHidden ? t("sidebar.hideHidden") : t("sidebar.showHidden", { count: hiddenCount })}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
