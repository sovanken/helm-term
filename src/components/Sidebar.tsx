import { useState } from "react";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { Code2, FolderOpen, FolderSearch, MoreHorizontal, Pin, PinOff, RefreshCw, Sparkles, SquareTerminal } from "lucide-react";
import { ipc } from "../lib/ipc";
import { timeAgo } from "../lib/fuzzy";
import { HistoryList } from "./HistoryList";
import { folderName, useStore } from "../state/store";
import { Menu } from "./Menu";
import { chooseFolder } from "./TitleBar";

export async function refreshRecent() {
  const recent = await ipc.recentProjects().catch(() => []);
  useStore.getState().set({ recent });
}

function parentPath(path: string) {
  return path.replace(/[\\/][^\\/]+[\\/]?$/, "");
}

function ProjectRow({ path, lastUsed, pinned }: { path: string; lastUsed?: number; pinned: boolean }) {
  const [menu, setMenu] = useState(false);
  const { openTab, togglePin } = useStore.getState();
  const open = useStore((s) =>
    Object.values(s.panes).some((p) => p.cwd.toLowerCase() === path.toLowerCase()),
  );

  return (
    <div className="group relative">
      <button
        onClick={() => openTab(path, "claude")}
        title={`Start Claude in ${path}`}
        className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left hover:bg-hover"
      >
        <span className={`flex size-6 shrink-0 items-center justify-center rounded-md ${open ? "bg-accent-soft text-accent" : "bg-hover text-muted"}`}>
          <Sparkles size={13} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium text-fg">{folderName(path)}</span>
          <span className="block truncate text-[11px] text-faint">
            {lastUsed ? timeAgo(lastUsed) : parentPath(path)}
          </span>
        </span>
      </button>
      <div className={`absolute top-1/2 right-1 flex -translate-y-1/2 items-center gap-0.5 rounded-md bg-hover ${menu ? "flex" : "hidden group-hover:flex"}`}>
        <button
          aria-label="Open PowerShell here"
          title="Open PowerShell here"
          onClick={() => openTab(path, "shell")}
          className="flex size-6 items-center justify-center rounded text-muted hover:text-fg"
        >
          <SquareTerminal size={13} />
        </button>
        <div className="relative">
          <button
            aria-label="More actions"
            onClick={() => setMenu((m) => !m)}
            className="flex size-6 items-center justify-center rounded text-muted hover:text-fg"
          >
            <MoreHorizontal size={14} />
          </button>
          {menu && (
            <Menu
              align="right"
              onClose={() => setMenu(false)}
              items={[
                { label: "Start Claude", icon: <Sparkles size={14} />, onSelect: () => openTab(path, "claude") },
                { label: "Open PowerShell", icon: <SquareTerminal size={14} />, onSelect: () => openTab(path, "shell") },
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

export function Sidebar() {
  const view = useStore((s) => s.sidebarView);
  return (
    <aside className="flex w-64 shrink-0 flex-col bg-bg">
      <div className="px-2 pb-2">
        <button
          onClick={() => void chooseFolder("claude")}
          className="flex w-full items-center justify-center gap-2 rounded-md bg-accent px-3 py-2 font-medium text-on-accent hover:opacity-90"
        >
          <FolderOpen size={15} /> Open folder with Claude
        </button>
      </div>
      <div role="tablist" className="mx-2 mb-2 grid grid-cols-2 rounded-md border border-line p-0.5">
        {(["projects", "history"] as const).map((v) => (
          <button
            key={v}
            role="tab"
            aria-selected={view === v}
            title={v === "history" ? "Conversation history (Ctrl+Shift+H)" : "Projects"}
            onClick={() => useStore.getState().set({ sidebarView: v })}
            className={`rounded px-2 py-1 text-[12px] font-medium capitalize ${view === v ? "bg-hover text-fg" : "text-muted hover:text-fg"}`}
          >
            {v}
          </button>
        ))}
      </div>
      {view === "projects" ? <ProjectList /> : <HistoryList />}
    </aside>
  );
}

function ProjectList() {
  const pinned = useStore((s) => s.pinned);
  const recent = useStore((s) => s.recent);
  const [spinning, setSpinning] = useState(false);
  const isPinned = (p: string) => pinned.some((x) => x.toLowerCase() === p.toLowerCase());
  const others = recent.filter((r) => !isPinned(r.path));

  return (
    <>
      <div className="scroll-thin flex-1 overflow-y-auto px-2 pb-3">
        {pinned.length > 0 && (
          <section className="mb-3">
            <h2 className="px-2 pt-2 pb-1 text-[11px] font-semibold tracking-wide text-faint uppercase">Pinned</h2>
            {pinned.map((p) => (
              <ProjectRow key={p} path={p} pinned lastUsed={recent.find((r) => r.path.toLowerCase() === p.toLowerCase())?.lastUsed} />
            ))}
          </section>
        )}
        <section>
          <div className="flex items-center px-2 pt-2 pb-1">
            <h2 className="flex-1 text-[11px] font-semibold tracking-wide text-faint uppercase">Recent with Claude</h2>
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
          </div>
          {others.map((r) => (
            <ProjectRow key={r.path} path={r.path} lastUsed={r.lastUsed} pinned={false} />
          ))}
          {others.length === 0 && (
            <p className="px-2 py-3 text-[12px] leading-relaxed text-faint">
              Projects you use with Claude Code show up here automatically.
            </p>
          )}
        </section>
      </div>
    </>
  );
}
