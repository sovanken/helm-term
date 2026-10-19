import { type ReactNode, useEffect, useMemo, useState } from "react";
import { ArrowUpRight, Bot, FileDown, Coins, Database, LayoutDashboard, Layers, Plus, Sparkles, Timer, FileDiff, FolderOpen, Cpu } from "lucide-react";
import { timeSince as ago } from "../lib/agents";
import { ipc, type UsageTotals } from "../lib/ipc";
import { duration, money, tokens, windowFor } from "../lib/format";
import { type Pane, cleanTitle, folderName, useStore } from "../state/store";
import { ApprovalCard } from "./Approvals";
import { exportPdf, pdfName } from "../lib/pdf";
import { UsagePrint } from "./PrintReports";
import { openPane, SessionDetail } from "./SessionDetail";
import { modelLabel } from "./StatusBar";
import { StatusDot } from "./StatusDot";
import { UsageCockpit } from "./Usage";
import { UsageHistory } from "./UsageHistory";

/** A worktree task lives in a folder named after it inside the repo's worktrees folder. */
function isTask(pane: Pane) {
  return /[\\/](\.claude[\\/]worktrees|[^\\/]+-tasks)[\\/][^\\/]+$/i.test(pane.cwd);
}

function Chip({ children, tone = "", title }: { children: ReactNode; tone?: string; title?: string }) {
  return (
    <span title={title} className={`flex items-center gap-1 rounded-md bg-hover/70 px-1.5 py-0.5 text-[11px] tabular-nums ${tone || "text-muted"}`}>
      {children}
    </span>
  );
}

function AgentCard({ pane, onOpen }: { pane: Pane; onOpen: () => void }) {
  const title = cleanTitle(pane.title);
  const st = pane.stats;
  const pct = st?.contextPct;
  const window = windowFor(st?.model);
  const used = pct != null ? (pct / 100) * window : undefined;
  const cache = st?.cache;
  const cacheLeft = cache?.warm && cache.expiresAt ? Math.round((cache.expiresAt - Date.now() / 1000) / 60) : null;
  const running = pane.bgTasks?.filter((t) => t.status === "running").length ?? 0;
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onOpen())}
      className="group flex w-full cursor-pointer flex-col gap-2.5 rounded-xl border border-line bg-raised p-3.5 text-left hover:border-accent/50 focus-visible:border-accent"
    >
      <div className="flex items-center gap-2">
        <StatusDot status={pane.status} claude />
        <span className="truncate font-medium text-fg">{folderName(pane.cwd)}</span>
        {isTask(pane) && (
          <span className="flex shrink-0 items-center gap-1 rounded bg-accent-soft px-1.5 text-[10px] text-accent">
            <Layers size={10} /> task
          </span>
        )}
        <span className="ml-auto shrink-0 text-[11px] text-faint">{ago(pane.lastActivity)}</span>
        <button
          aria-label="Go to this tab"
          title="Go to this tab"
          onClick={(e) => {
            e.stopPropagation();
            openPane(pane.id);
          }}
          className="flex size-6 shrink-0 items-center justify-center rounded-md text-faint hover:bg-hover hover:text-fg"
        >
          <ArrowUpRight size={13} />
        </button>
      </div>
      <div className="line-clamp-2 min-h-[2.5em] text-[13px] text-muted">{title || "New conversation"}</div>
      <div className="truncate font-mono text-[11px] text-faint" title={pane.doing}>
        {pane.status === "attention" ? (
          <span className="text-attention">{pane.attentionMessage ?? "Waiting for you"}</span>
        ) : pane.status === "working" ? (
          (pane.doing ?? "Working…")
        ) : pane.status === "done" ? (
          "Finished, your turn"
        ) : (
          "Ready"
        )}
      </div>

      {pct != null && (
        <div>
          <div className="mb-1 flex items-baseline justify-between text-[11px]">
            <span className="text-faint">Context</span>
            <span className="text-muted tabular-nums">
              <span className="font-medium text-fg">{tokens(used)}</span> / {tokens(window)} · {Math.round(pct)}%
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-hover">
            <div className={`h-full rounded-full ${pct >= 80 ? "bg-danger" : pct >= 60 ? "bg-attention" : "bg-accent"}`} style={{ width: `${Math.max(pct, 1.5)}%` }} />
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-1.5">
        {st?.model && (
          <Chip>
            {modelLabel(st.model)}
            {st.effort && <span className="text-faint">· {st.effort}</span>}
          </Chip>
        )}
        {cache && (
          <Chip tone={cache.warm ? (cacheLeft != null && cacheLeft <= 1 ? "text-attention" : "text-done") : "text-faint"} title="Prompt cache: replying while it's warm is cheaper">
            <Database size={10} /> {cache.warm ? (cacheLeft != null ? `warm ${Math.max(cacheLeft, 0)}m` : "warm") : "cold"}
          </Chip>
        )}
        {st?.costUsd != null && (
          <Chip>
            <Coins size={10} /> {money(st.costUsd)}
          </Chip>
        )}
        {st?.durationMs != null && (
          <Chip>
            <Timer size={10} /> {duration(st.durationMs)}
          </Chip>
        )}
        {!!(st?.linesAdded || st?.linesRemoved) && (
          <Chip>
            <span className="text-done">+{st?.linesAdded ?? 0}</span>
            <span className="text-danger">−{st?.linesRemoved ?? 0}</span>
          </Chip>
        )}
        {running > 0 && (
          <Chip tone="text-working">
            <Bot size={10} /> {running} running
          </Chip>
        )}
      </div>
    </div>
  );
}

function Group({ title, panes, onOpen }: { title: string; panes: Pane[]; onOpen: (id: string) => void }) {
  if (panes.length === 0) return null;
  return (
    <section className="mb-6">
      <h2 className="mb-2.5 text-[11px] font-semibold tracking-wide text-faint uppercase">
        {title} <span className="ml-1 text-muted">{panes.length}</span>
      </h2>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(290px,1fr))] gap-3">
        {panes.map((p) => (
          <AgentCard key={p.id} pane={p} onOpen={() => onOpen(p.id)} />
        ))}
      </div>
    </section>
  );
}

// ---------- totals ----------

function useTotals() {
  const activity = useStore((s) => s.activity);
  const [totals, setTotals] = useState<UsageTotals | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () => void ipc.usageTotals(7).then((t) => alive && setTotals(t), () => {});
    const first = setTimeout(load, 300);
    const every = setInterval(load, 60_000);
    return () => {
      alive = false;
      clearTimeout(first);
      clearInterval(every);
    };
    // Claude's activity changes the numbers; the cache in the backend keeps reloads cheap.
  }, [Math.floor(activity / 20)]);
  return totals;
}

function Tile({ icon, label, value, sub }: { icon: ReactNode; label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="min-w-0 rounded-xl border border-line bg-raised/40 px-3.5 py-3">
      <div className="flex items-center gap-1.5 text-[11.5px] text-faint">
        {icon} {label}
      </div>
      <div className="mt-1 truncate text-[19px] font-semibold text-fg tabular-nums">{value}</div>
      {sub && <div className="mt-0.5 truncate text-[11px] text-faint">{sub}</div>}
    </div>
  );
}

function Totals({ totals }: { totals: UsageTotals | null }) {
  const [range, setRange] = useState<"today" | "week">("today");
  const today = new Date().toLocaleDateString("en-CA");
  const days = (totals?.days ?? []).filter((d) => range === "week" || d.day === today);
  const sum = (k: keyof (typeof days)[number]) => days.reduce((n, d) => n + (d[k] as number), 0);
  const tokIn = sum("inputTokens") + sum("cacheWriteTokens");
  const tokRead = sum("cacheReadTokens");
  return (
    <section className="mb-6">
      <div className="mb-2.5 flex items-center gap-2">
        <h2 className="text-[11px] font-semibold tracking-wide text-faint uppercase">Your Claude use</h2>
        <div className="ml-auto flex rounded-md border border-line p-0.5 text-[11.5px]">
          {(["today", "week"] as const).map((r) => (
            <button key={r} onClick={() => setRange(r)} className={`rounded px-2 py-0.5 ${range === r ? "bg-hover font-medium text-fg" : "text-faint hover:text-muted"}`}>
              {r === "today" ? "Today" : "Last 7 days"}
            </button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
        <Tile icon={<Coins size={12} />} label="Cost" value={totals ? money(sum("costUsd")) : "…"} sub="as Claude reports it" />
        <Tile icon={<Database size={12} />} label="Tokens" value={totals ? tokens(tokIn + sum("outputTokens")) : "…"} sub={totals ? `+ ${tokens(tokRead)} from cache` : undefined} />
        <Tile icon={<Timer size={12} />} label="Time working" value={totals ? duration(sum("activeMs")) : "…"} sub={totals ? `${sum("replies")} replies` : undefined} />
        <Tile
          icon={<FileDiff size={12} />}
          label="Lines changed"
          value={totals ? <><span className="text-done">+{sum("linesAdded")}</span> <span className="text-danger">−{sum("linesRemoved")}</span></> : "…"}
        />
        <Tile icon={<Sparkles size={12} />} label="Sessions" value={totals ? sum("sessions") : "…"} sub={range === "week" ? "counted per day" : undefined} />
      </div>
    </section>
  );
}

function Breakdown({ totals }: { totals: UsageTotals | null }) {
  if (!totals || (totals.byProject.length === 0 && totals.byModel.length === 0)) return null;
  const rows = (list: UsageTotals["byProject"], name: (k: string) => string) => {
    const max = Math.max(...list.map((g) => g.costUsd || g.tokens / 1e6), 0.0001);
    return list.slice(0, 6).map((g) => (
      <div key={g.key} className="flex items-center gap-2 py-1 text-[12px]" title={g.key}>
        <span className="w-32 shrink-0 truncate text-fg">{name(g.key)}</span>
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-hover">
          <div className="h-full rounded-full bg-accent" style={{ width: `${((g.costUsd || g.tokens / 1e6) / max) * 100}%` }} />
        </div>
        <span className="w-14 shrink-0 text-right text-fg tabular-nums">{money(g.costUsd)}</span>
        <span className="w-12 shrink-0 text-right text-faint tabular-nums">{tokens(g.tokens)}</span>
      </div>
    ));
  };
  return (
    <div className="mt-4 rounded-xl border border-line bg-raised/40 p-4">
      <div className="mb-1 flex items-center gap-2 font-medium text-fg">
        <FolderOpen size={15} className="text-accent" /> Last 7 days by project
      </div>
      <div className="mb-3 text-[11px] text-faint">Cost and tokens, from every Claude session on this PC</div>
      {rows(totals.byProject, folderName)}
      {totals.byModel.length > 0 && (
        <>
          <div className="mt-4 mb-1 flex items-center gap-2 font-medium text-fg">
            <Cpu size={15} className="text-accent" /> By model
          </div>
          {rows(totals.byModel, (k) => modelLabel(k) ?? k)}
        </>
      )}
    </div>
  );
}

export function AgentsPage() {
  const panes = useStore((s) => s.panes);
  const approvals = useStore((s) => s.approvals);
  const [detail, setDetail] = useState<string | null>(null);
  const [, tick] = useState(0);
  const totals = useTotals();
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 15_000);
    return () => clearInterval(t);
  }, []);

  const claude = useMemo(() => Object.values(panes).filter((p) => p.kind !== "browser" && (p.claudeActive || p.kind === "claude")), [panes]);
  // Tabs with a pending approval already have a card above, so they aren't listed twice.
  const needsYou = claude.filter((p) => p.status === "attention" && !approvals.some((a) => a.paneId === p.id));
  const working = claude.filter((p) => p.status === "working");
  const rest = claude.filter((p) => p.status === "done" || p.status === "idle");
  const { openTab, set, homeDir } = useStore.getState();

  return (
    <div className="relative h-full">
      <div className="scroll-thin h-full overflow-y-auto">
        <div className="mx-auto max-w-6xl px-8 py-7">
          <div className="mb-6 flex flex-wrap items-center gap-3">
            <div className="flex-1">
              <h1 className="text-[18px] font-semibold text-fg">Agents</h1>
              <p className="text-muted">
                {claude.length === 0
                  ? "No Claude sessions are running."
                  : `${claude.length} Claude ${claude.length === 1 ? "session" : "sessions"} · ${working.length} working · ${needsYou.length + new Set(approvals.map((a) => a.paneId)).size} waiting for you`}
              </p>
            </div>
            <button
              onClick={async () => {
                // The first scan of every conversation can take a few seconds; wait for it.
                const t = totals ?? (await ipc.usageTotals(7).catch(() => null));
                void exportPdf(pdfName("helm-usage", new Date().toLocaleDateString("en-CA")), <UsagePrint usage={useStore.getState().usage} totals={t} sessions={claude} />);
              }}
              title="Save limits, totals, projects and sessions as a PDF"
              className="flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-fg hover:bg-hover"
            >
              <FileDown size={14} /> Export PDF
            </button>
            <button onClick={() => set({ newTaskOpen: true })} className="flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-fg hover:bg-hover">
              <Layers size={14} /> New parallel task
            </button>
            <button
              onClick={() => {
                const s = useStore.getState();
                const tab = s.tabs.find((t) => t.id === s.activeTabId);
                openTab((tab && s.panes[tab.activePaneId]?.cwd) || homeDir, "claude");
              }}
              className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 font-medium text-on-accent hover:opacity-90"
            >
              <Plus size={14} /> New Claude tab
            </button>
          </div>

          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
            <div className="min-w-0">
              <Totals totals={totals} />
              {approvals.length > 0 && (
                <section className="mb-6">
                  <h2 className="mb-2.5 text-[11px] font-semibold tracking-wide text-attention uppercase">
                    Waiting for approval <span className="ml-1">{approvals.length}</span>
                  </h2>
                  <div className="grid gap-3 md:grid-cols-2">
                    {approvals.map((a) => (
                      <ApprovalCard key={a.id} approval={a} />
                    ))}
                  </div>
                </section>
              )}
              {claude.length === 0 ? (
                <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-line px-6 py-14 text-center">
                  <LayoutDashboard size={28} className="text-faint" />
                  <p className="max-w-sm text-muted">Start Claude in a few tabs or parallel tasks. Every session shows up here with what it's doing and whether it needs you.</p>
                  <button onClick={() => openTab(homeDir, "claude")} className="flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-fg hover:bg-hover">
                    <Sparkles size={14} /> Start Claude
                  </button>
                </div>
              ) : (
                <>
                  <Group title="Needs you" panes={needsYou} onOpen={setDetail} />
                  <Group title="Working" panes={working} onOpen={setDetail} />
                  <Group title="Done & idle" panes={rest} onOpen={setDetail} />
                  <p className="text-[11.5px] text-faint">Click a session for its context, tokens and tools.</p>
                </>
              )}
            </div>
            <aside className="min-w-0">
              <UsageCockpit />
              <UsageHistory />
              <Breakdown totals={totals} />
            </aside>
          </div>
        </div>
      </div>
      {detail && panes[detail] && <SessionDetail paneId={detail} onClose={() => setDetail(null)} />}
    </div>
  );
}
