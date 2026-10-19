import { useEffect, useMemo, useState } from "react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { Copy, FileDown, MessageSquare, MoreHorizontal, Play, SquareTerminal } from "lucide-react";
import { ipc, type SearchHit, type SessionInfo } from "../lib/ipc";
import { fuzzyScore, timeAgo } from "../lib/fuzzy";
import { activePane, folderName, useStore } from "../state/store";
import { exportConversation } from "../lib/actions";
import { Menu } from "./Menu";
import { ItemIcon, SidebarSearch } from "./Sidebar";

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
        className="flex w-full items-start gap-2.5 rounded-lg px-2 py-2 text-left hover:bg-hover"
      >
        <ItemIcon kind="conversation" size={24} active={open} />
        <span className="min-w-0 flex-1">
          <span className={`block truncate pr-6 text-[13px] ${open ? "font-medium text-fg" : "text-fg"}`}>{session.title}</span>
          {snippet && <span className="mt-0.5 line-clamp-2 block rounded bg-accent-soft px-1.5 py-0.5 text-[11px] text-muted">{snippet}</span>}
          <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-faint">
            <span className="truncate">{folderName(session.cwd)}</span>
            <span className="shrink-0">· {timeAgo(session.lastUsed)}</span>
            <span className="flex shrink-0 items-center gap-0.5" title={`${session.prompts} messages from you`}>
              · <MessageSquare size={10} /> {session.prompts}
            </span>
          </span>
        </span>
      </button>
      <div className={`absolute top-1.5 right-1.5 ${menu ? "block" : "hidden group-hover:block"}`}>
        <button
          aria-label="More actions"
          onClick={() => setMenu((m) => !m)}
          className="flex size-6 items-center justify-center rounded-md bg-raised text-muted hover:text-fg"
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
              { label: "Export to Markdown…", icon: <FileDown size={14} />, onSelect: () => void exportConversation(session), separatorBefore: true },
              { label: "Copy session ID", icon: <Copy size={14} />, onSelect: () => void writeText(session.id) },
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
      <SidebarSearch value={query} onChange={setQuery} placeholder="Search conversations" busy={searching} />
      {projectCwd && (
        <div className="mx-2 mt-1 mb-1 flex gap-1">
          {[false, true].map((only) => (
            <button
              key={String(only)}
              onClick={() => setThisProject(only)}
              className={`max-w-full truncate rounded-full border px-2.5 py-0.5 text-[11px] ${thisProject === only ? "border-accent bg-accent-soft text-accent" : "border-line text-muted hover:text-fg"}`}
            >
              {only ? folderName(projectCwd) : "All projects"}
            </button>
          ))}
        </div>
      )}

      <div className="scroll-thin flex-1 overflow-y-auto px-1.5 pb-3">
        {groups.map((g) => (
          <section key={g.label} className="mb-1">
            <h2 className="sticky top-0 z-10 bg-bg px-2 pt-2 pb-1 text-[11px] font-semibold tracking-wide text-faint uppercase">
              {g.label} <span className="font-normal normal-case">{g.rows.length}</span>
            </h2>
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
