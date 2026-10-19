import { type ReactNode, useMemo, useState } from "react";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import {
  ChevronRight,
  Folder,
  MessageSquareText,
  Code2,
  FolderOpen,
  FolderPlus,
  FolderSearch,
  History,
  MoreHorizontal,
  Pin,
  PinOff,
  RefreshCw,
  Search,
  Sparkles,
  SquareTerminal,
  X,
} from "lucide-react";
import { ipc } from "../lib/ipc";
import { fuzzyScore, timeAgo } from "../lib/fuzzy";
import { HistoryList } from "./HistoryList";
import { TasksSection } from "./Tasks";
import { folderName, useStore } from "../state/store";
import { Menu } from "./Menu";
import { chooseFolder } from "./TitleBar";

export async function refreshRecent() {
  const recent = await ipc.recentProjects().catch(() => []);
  useStore.getState().set({ recent });
}

/**
 * Leading icon in a quiet neutral square: a folder for projects, a chat bubble for conversations.
 * Only items with an open tab get a soft accent tint, so the list stays calm to scan.
 */
export function ItemIcon({ kind = "project", size = 28, active = false }: { kind?: "project" | "conversation"; size?: number; active?: boolean }) {
  const icon = Math.round(size * 0.5);
  return (
    <span
      className={`flex shrink-0 items-center justify-center rounded-lg border ${active ? "border-transparent bg-accent-soft text-accent" : "border-line bg-surface text-muted"}`}
      style={{ width: size, height: size }}
      aria-hidden
    >
      {kind === "conversation" ? <MessageSquareText size={icon} strokeWidth={1.75} /> : active ? <FolderOpen size={icon} strokeWidth={1.75} /> : <Folder size={icon} strokeWidth={1.75} />}
    </span>
  );
}

/** "C:\Users\KEN\work\app" → "~\work\app" (parent folder only, shortened). */
function shortParent(path: string, home: string) {
  const parent = path.replace(/[\\/][^\\/]+[\\/]?$/, "");
  return home && parent.toLowerCase().startsWith(home.toLowerCase()) ? `~${parent.slice(home.length)}` || "~" : parent;
}

function ProjectRow({ path, lastUsed, pinned }: { path: string; lastUsed?: number; pinned: boolean }) {
  const [menu, setMenu] = useState(false);
  const { openTab, togglePin } = useStore.getState();
  const home = useStore((s) => s.homeDir);
  const panes = useStore((s) => s.panes);
  const here = Object.values(panes).filter((p) => p.cwd.toLowerCase() === path.toLowerCase() || p.cwd.toLowerCase().startsWith(`${path.toLowerCase()}\\`));
  const waiting = here.some((p) => p.status === "attention");
  const working = here.some((p) => p.status === "working");

  return (
    <div className="group relative">
      <button
        onClick={() => openTab(path, "claude")}
        title={`${path}\nClick to start Claude here`}
        className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-hover"
      >
        <span className="relative">
          <ItemIcon active={here.length > 0} />
          {(waiting || working) && (
            <span className={`absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full ring-2 ring-[var(--bg)] ${waiting ? "status-attention bg-attention" : "bg-working"}`} />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="truncate text-[13px] font-medium text-fg">{folderName(path)}</span>
            {here.length > 0 && (
              <span className="shrink-0 rounded-full bg-accent-soft px-1.5 text-[10px] font-semibold text-accent" title={`${here.length} open ${here.length === 1 ? "tab" : "tabs"}`}>
                {here.length}
              </span>
            )}
          </span>
          <span className="block truncate text-[11px] text-faint">{shortParent(path, home)}</span>
        </span>
        {lastUsed && <span className="shrink-0 text-[11px] text-faint group-hover:invisible">{timeAgo(lastUsed).replace(" ago", "")}</span>}
      </button>
      <div className={`absolute top-1/2 right-1.5 flex -translate-y-1/2 items-center gap-0.5 ${menu ? "flex" : "hidden group-hover:flex"}`}>
        <button
          aria-label={pinned ? "Unpin" : "Pin to top"}
          title={pinned ? "Unpin" : "Pin to top"}
          onClick={() => togglePin(path)}
          className="flex size-6 items-center justify-center rounded-md text-muted hover:bg-raised hover:text-fg"
        >
          {pinned ? <PinOff size={13} /> : <Pin size={13} />}
        </button>
        <button
          aria-label="Open a shell here"
          title="Open a shell here"
          onClick={() => openTab(path, "shell")}
          className="flex size-6 items-center justify-center rounded-md text-muted hover:bg-raised hover:text-fg"
        >
          <SquareTerminal size={13} />
        </button>
        <div className="relative">
          <button aria-label="More actions" onClick={() => setMenu((m) => !m)} className="flex size-6 items-center justify-center rounded-md text-muted hover:bg-raised hover:text-fg">
            <MoreHorizontal size={14} />
          </button>
          {menu && (
            <Menu
              align="right"
              onClose={() => setMenu(false)}
              items={[
                { label: "Start Claude", icon: <Sparkles size={14} />, onSelect: () => openTab(path, "claude") },
                { label: "Open a shell", icon: <SquareTerminal size={14} />, onSelect: () => openTab(path, "shell") },
                { label: pinned ? "Unpin" : "Pin to top", icon: pinned ? <PinOff size={14} /> : <Pin size={14} />, onSelect: () => togglePin(path), separatorBefore: true },
                { label: "Open in VS Code", icon: <Code2 size={14} />, onSelect: () => void ipc.openInEditor(path) },
                { label: "Show in File Explorer", icon: <FolderSearch size={14} />, onSelect: () => void revealItemInDir(path) },
              ]}
            />
          )}
        </div>
      </div>
    </div>
  );
}

/** Collapsible group with a small heading and optional actions. */
export function Section({ title, count, actions, children, defaultOpen = true }: { title: string; count?: number; actions?: ReactNode; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="mb-2">
      <div className="group/section flex items-center gap-1 px-1 pt-2 pb-1">
        <button onClick={() => setOpen((o) => !o)} className="flex min-w-0 flex-1 items-center gap-1 rounded px-1 py-0.5 text-left text-[11px] font-semibold tracking-wide text-faint uppercase hover:text-muted">
          <ChevronRight size={12} className={`shrink-0 transition-transform duration-150 ${open ? "rotate-90" : ""}`} />
          <span className="truncate">{title}</span>
          {count !== undefined && <span className="font-normal normal-case text-faint">{count}</span>}
        </button>
        {actions && <div className="flex items-center opacity-70 group-hover/section:opacity-100">{actions}</div>}
      </div>
      {open && <div className="anim-fade">{children}</div>}
    </section>
  );
}

export function SidebarSearch({ value, onChange, placeholder, busy }: { value: string; onChange: (v: string) => void; placeholder: string; busy?: boolean }) {
  return (
    <div className="mx-2 mb-1 flex items-center gap-2 rounded-lg border border-line bg-surface px-2.5 transition-colors focus-within:border-accent">
      <Search size={13} className="shrink-0 text-faint" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && onChange("")}
        placeholder={placeholder}
        className="min-w-0 flex-1 bg-transparent py-1.5 text-[13px] text-fg outline-none placeholder:text-faint"
      />
      {busy && <span className="status-working size-3 shrink-0 rounded-full border border-faint border-t-transparent" />}
      {value && !busy && (
        <button aria-label="Clear" onClick={() => onChange("")} className="text-faint hover:text-fg">
          <X size={12} />
        </button>
      )}
    </div>
  );
}

export function Sidebar() {
  const view = useStore((s) => s.sidebarView);
  const set = useStore.getState().set;
  const tab = (id: "projects" | "history", label: string, icon: ReactNode, hint: string) => (
    <button
      role="tab"
      aria-selected={view === id}
      title={hint}
      onClick={() => set({ sidebarView: id })}
      className={`flex flex-1 items-center justify-center gap-1.5 rounded-md py-1 text-[12px] font-medium ${view === id ? "bg-raised text-fg shadow-sm" : "text-muted hover:text-fg"}`}
    >
      {icon}
      {label}
    </button>
  );

  return (
    <aside className="flex w-full min-w-0 flex-col bg-bg">
      <div className="flex items-center gap-1.5 px-2 pt-1 pb-2">
        <div role="tablist" className="flex flex-1 rounded-lg border border-line bg-bg p-0.5">
          {tab("projects", "Projects", <FolderOpen size={13} />, "Projects")}
          {tab("history", "History", <History size={13} />, "Conversation history (Ctrl+Shift+H)")}
        </div>
        <button
          aria-label="Open folder with Claude"
          title="Open folder with Claude"
          onClick={() => void chooseFolder("claude")}
          className="flex size-7 shrink-0 items-center justify-center rounded-lg border border-line text-muted hover:border-accent hover:text-accent"
        >
          <FolderPlus size={14} />
        </button>
      </div>
      <div key={view} className="anim-fade flex min-h-0 flex-1 flex-col">
        {view === "projects" ? <ProjectList /> : <HistoryList />}
      </div>
    </aside>
  );
}

function ProjectList() {
  const pinned = useStore((s) => s.pinned);
  const recent = useStore((s) => s.recent);
  const [spinning, setSpinning] = useState(false);
  const [query, setQuery] = useState("");
  const isPinned = (p: string) => pinned.some((x) => x.toLowerCase() === p.toLowerCase());

  const match = (p: string) => !query.trim() || fuzzyScore(query, folderName(p)) >= 0 || p.toLowerCase().includes(query.toLowerCase());
  const pinnedRows = useMemo(() => pinned.filter(match), [pinned, query]);
  const recentRows = useMemo(() => recent.filter((r) => !isPinned(r.path) && match(r.path)), [recent, pinned, query]);

  return (
    <>
      <SidebarSearch value={query} onChange={setQuery} placeholder="Filter projects" />
      <div className="scroll-thin flex-1 overflow-y-auto px-1.5 pb-3">
        {!query && <TasksSection />}
        {pinnedRows.length > 0 && (
          <Section title="Pinned" count={pinnedRows.length}>
            {pinnedRows.map((p) => (
              <ProjectRow key={p} path={p} pinned lastUsed={recent.find((r) => r.path.toLowerCase() === p.toLowerCase())?.lastUsed} />
            ))}
          </Section>
        )}
        <Section
          title="Recent"
          count={recentRows.length}
          actions={
            <button
              aria-label="Refresh"
              title="Refresh"
              onClick={() => {
                setSpinning(true);
                void refreshRecent().finally(() => setSpinning(false));
              }}
              className="flex size-5 items-center justify-center rounded text-faint hover:text-fg"
            >
              <RefreshCw size={11} className={spinning ? "status-working" : ""} />
            </button>
          }
        >
          {recentRows.map((r) => (
            <ProjectRow key={r.path} path={r.path} lastUsed={r.lastUsed} pinned={false} />
          ))}
          {recentRows.length === 0 && (
            <div className="mx-1 mt-1 flex flex-col items-center gap-2 rounded-lg border border-dashed border-line px-3 py-5 text-center">
              <FolderOpen size={18} className="text-faint" />
              <p className="text-[12px] leading-relaxed text-faint">
                {query ? `No project matches “${query}”.` : "Projects you use with Claude Code show up here automatically."}
              </p>
              {!query && (
                <button onClick={() => void chooseFolder("claude")} className="rounded-md px-2 py-1 text-[12px] font-medium text-accent hover:bg-hover">
                  Open a folder
                </button>
              )}
            </div>
          )}
        </Section>
      </div>
    </>
  );
}
