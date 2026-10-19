import { useEffect, useMemo, useState } from "react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { Copy, MessageSquare, MoreHorizontal, Play, Search, SquareTerminal, X } from "lucide-react";
import { ipc, type SearchHit, type SessionInfo } from "../lib/ipc";
import { fuzzyScore, timeAgo } from "../lib/fuzzy";
import { activePane, folderName, useStore } from "../state/store";
import { Menu } from "./Menu";

let refreshing: Promise<void> | null = null;

export function refreshSessions() {
  refreshing ??= ipc
    .listSessions()
    .then((sessions) => useStore.getState().set({ sessions }))
    .catch(() => {})
    .finally(() => (refreshing = null));
  return refreshing;
}

function groupLabel(ms: number) {
  const day = 86400000;
  const startOfToday = new Date().setHours(0, 0, 0, 0);
  if (ms >= startOfToday) return "Today";
  if (ms >= startOfToday - day) return "Yesterday";
  if (ms >= startOfToday - 6 * day) return "This week";
  if (ms >= startOfToday - 29 * day) return "This month";
  return "Older";
}

function SessionRow({ session, snippet, open }: { session: SessionInfo; snippet?: string; open: boolean }) {
  const [menu, setMenu] = useState(false);
  const { resumeSession, openTab } = useStore.getState();
  return (
    <div className="group relative">
      <button
        onClick={() => resumeSession(session)}
        title={`${session.title}\n${session.cwd}\n\nClick to continue this conversation`}
        className="flex w-full flex-col gap-0.5 rounded-md px-2 py-1.5 text-left hover:bg-hover"
      >
        <span className="flex w-full items-center gap-1.5">
          {open && <span className="size-1.5 shrink-0 rounded-full bg-accent" title="Open in a tab" />}
          <span className="truncate pr-6 text-fg">{session.title}</span>
        </span>
        {snippet && <span className="line-clamp-2 text-[11px] text-muted">{snippet}</span>}
        <span className="flex items-center gap-1.5 text-[11px] text-faint">
          <span className="truncate">{folderName(session.cwd)}</span>
          <span>·</span>
          <span className="shrink-0">{timeAgo(session.lastUsed)}</span>
          <span className="flex shrink-0 items-center gap-0.5" title={`${session.prompts} messages from you`}>
            · <MessageSquare size={10} /> {session.prompts}
          </span>
        </span>
      </button>
      <div className={`absolute top-1.5 right-1 ${menu ? "block" : "hidden group-hover:block"}`}>
        <button
          aria-label="More actions"
          onClick={() => setMenu((m) => !m)}
          className="flex size-6 items-center justify-center rounded bg-hover text-muted hover:text-fg"
        >
          <MoreHorizontal size={14} />
        </button>
        {menu && (
          <Menu
            align="right"
            onClose={() => setMenu(false)}
            items={[
              { label: "Continue conversation", icon: <Play size={14} />, onSelect: () => resumeSession(session) },
              { label: "Open PowerShell in its folder", icon: <SquareTerminal size={14} />, onSelect: () => openTab(session.cwd, "shell") },
              { label: "Copy session ID", icon: <Copy size={14} />, onSelect: () => void writeText(session.id), separatorBefore: true },
            ]}
          />
        )}
      </div>
    </div>
  );
}

export function HistoryList() {
  const sessions = useStore((s) => s.sessions);
  const activity = useStore((s) => s.activity);
  const panes = useStore((s) => s.panes);
  const openIds = useMemo(() => new Set(Object.values(panes).flatMap((p) => [p.sessionId, p.resumeSessionId])), [panes]);
  const [query, setQuery] = useState("");
  const [thisProject, setThisProject] = useState(false);
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const projectCwd = activePane()?.cwd;

  useEffect(() => {
    const t = setTimeout(() => void refreshSessions(), activity ? 1500 : 0);
    return () => clearTimeout(t);
  }, [activity]);

  // Full-text search through conversations, debounced.
  useEffect(() => {
    setHits([]);
    if (query.trim().length < 3) return;
    setSearching(true);
    const t = setTimeout(() => {
      void ipc
        .searchSessions(query)
        .then(setHits)
        .finally(() => setSearching(false));
    }, 300);
    return () => clearTimeout(t);
  }, [query]);

  const visible = useMemo(() => {
    let list = sessions;
    if (thisProject && projectCwd) list = list.filter((s) => s.cwd.toLowerCase() === projectCwd.toLowerCase());
    if (!query.trim()) return list.map((s) => ({ session: s, snippet: undefined as string | undefined }));
    const hitMap = new Map(hits.map((h) => [h.sessionId, h.snippet]));
    return list
      .map((s) => {
        const score = Math.max(fuzzyScore(query, s.title), fuzzyScore(query, folderName(s.cwd)) - 50, fuzzyScore(query, s.firstPrompt) - 100);
        const snippet = hitMap.get(s.id);
        return { session: s, snippet, score: snippet ? Math.max(score, 500) : score };
      })
      .filter((r) => r.score >= 0)
      .sort((a, b) => b.score - a.score);
  }, [sessions, query, hits, thisProject, projectCwd]);

  const groups = useMemo(() => {
    if (query.trim()) return [{ label: "Results", rows: visible }];
    const out: { label: string; rows: typeof visible }[] = [];
    for (const row of visible) {
      const label = groupLabel(row.session.lastUsed);
      if (out[out.length - 1]?.label !== label) out.push({ label, rows: [] });
      out[out.length - 1].rows.push(row);
    }
    return out;
  }, [visible, query]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="px-2 pb-2">
        <div className="flex items-center gap-1.5 rounded-md border border-line bg-surface px-2 focus-within:border-accent">
          <Search size={13} className="shrink-0 text-faint" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setQuery("")}
            placeholder="Search conversations"
            className="min-w-0 flex-1 bg-transparent py-1.5 text-fg outline-none placeholder:text-faint"
          />
          {searching && <span className="status-working size-3 shrink-0 rounded-full border border-faint border-t-transparent" />}
          {query && !searching && (
            <button aria-label="Clear search" onClick={() => setQuery("")} className="text-faint hover:text-fg">
              <X size={13} />
            </button>
          )}
        </div>
        {projectCwd && (
          <label className="mt-2 flex cursor-pointer items-center gap-2 px-0.5 text-[12px] text-muted">
            <input type="checkbox" checked={thisProject} onChange={(e) => setThisProject(e.target.checked)} className="accent-[var(--accent)]" />
            Only {folderName(projectCwd)}
          </label>
        )}
      </div>

      <div className="scroll-thin flex-1 overflow-y-auto px-2 pb-3">
        {groups.map((g) => (
          <section key={g.label} className="mb-2">
            <h2 className="px-2 pt-1 pb-1 text-[11px] font-semibold tracking-wide text-faint uppercase">{g.label}</h2>
            {g.rows.map(({ session, snippet }) => (
              <SessionRow key={session.id} session={session} snippet={snippet} open={openIds.has(session.id)} />
            ))}
          </section>
        ))}
        {visible.length === 0 && (
          <p className="px-2 py-3 text-[12px] leading-relaxed text-faint">
            {query ? "No conversations match." : "Your Claude Code conversations will show up here."}
          </p>
        )}
      </div>
    </div>
  );
}
