import { useEffect, useMemo, useState } from "react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { Copy, FileDown, Gauge, MoreHorizontal, Play, SquareTerminal } from "lucide-react";
import { ipc, type SearchHit, type SessionInfo } from "../lib/ipc";
import { fuzzyScore, timeAgo } from "../lib/fuzzy";
import { folderName, useStore } from "../state/store";
import { exportConversation } from "../lib/actions";
import { Menu } from "./Menu";
import { SidebarSearch } from "./Sidebar";

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
        title={`${session.title}
${session.cwd}

Click to continue this conversation`}
        className={`flex w-full flex-col gap-0.5 rounded-lg py-1.5 pr-2 pl-3 text-left hover:bg-hover ${open ? "bg-hover/60" : ""}`}
      >
        <span className="flex items-center gap-2">
          <span className={`min-w-0 flex-1 truncate text-[13px] ${open ? "font-medium text-fg" : "text-fg/90"}`}>{session.title}</span>
          <span className="shrink-0 text-[11px] text-faint tabular-nums group-hover:invisible">{timeAgo(session.lastUsed).replace(/ ago$/, "").replace("just now", "now")}</span>
        </span>
        <span className="flex items-center gap-1.5 text-[11.5px] text-faint">
          {open && <span className="size-1.5 shrink-0 rounded-full bg-accent" title="Open in a tab" />}
          <span className="truncate">{folderName(session.cwd)}</span>
        </span>
        {snippet && <span className="mt-0.5 line-clamp-2 rounded bg-accent-soft px-1.5 py-0.5 text-[11px] text-muted">{snippet}</span>}
      </button>
      <div className={`absolute top-1 right-1 ${menu ? "block" : "hidden group-hover:block"}`}>
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
              { label: "Usage & context details", icon: <Gauge size={14} />, onSelect: () => useStore.getState().set({ historyDetail: session }) },
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
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);

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
    const list = sessions;
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
  }, [sessions, query, hits]);

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

      <div className="scroll-thin flex-1 overflow-y-auto px-1.5 pb-3">
        {groups.map((g) => (
          <section key={g.label} className="mb-1">
            <h2 className="sticky top-0 z-10 bg-bg px-3 pt-3 pb-1 text-[11.5px] font-medium text-faint">{g.label}</h2>
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
