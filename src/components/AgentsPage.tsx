import { type ReactNode, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowUpRight, Bot, Coins, Database, FileDiff, FileDown, Layers, LayoutDashboard, Plus, Sparkles, Timer } from "lucide-react";
import { timeSince as ago } from "../lib/agents";
import { ipc, type UsageTotals } from "../lib/ipc";
import { duration, money, tokens, windowFor } from "../lib/format";
import { type Pane, cleanTitle, folderName, useStore } from "../state/store";
import { locale } from "../i18n";
import { ApprovalCard } from "./Approvals";
import { exportPdf, pdfName } from "../lib/pdf";
import { UsagePrint } from "./PrintReports";
import { openPane, SessionDetail } from "./SessionDetail";
import { modelLabel } from "./StatusBar";
import { StatusDot } from "./StatusDot";
import { UsageCockpit } from "./Usage";
import { BarChart, RankList } from "./Charts";

/** A worktree task lives in a folder named after it inside the repo's worktrees folder. */
function isTask(pane: Pane) {
  return /[\\/](\.claude[\\/]worktrees|[^\\/]+-tasks)[\\/][^\\/]+$/i.test(pane.cwd);
}

const localDay = (d: Date) => d.toLocaleDateString("en-CA");

// Claude Code keeps conversations for 30 days, so there's nothing to show beyond that.
const RANGES = [7, 14, 30] as const;
type Range = (typeof RANGES)[number];

function useTotals(days: number) {
  const activity = useStore((s) => s.activity);
  const [loaded, setLoaded] = useState<{ days: number; totals: UsageTotals } | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () => void ipc.usageTotals(days).then((t) => alive && setLoaded({ days, totals: t }), () => {});
    const first = setTimeout(load, 200);
    const every = setInterval(load, 60_000);
    return () => {
      alive = false;
      clearTimeout(first);
      clearInterval(every);
    };
    // Claude's activity changes the numbers; the backend's cache keeps reloads cheap.
  }, [days, Math.floor(activity / 20)]);
  // Never show another range's numbers while this one loads.
  return loaded?.days === days ? loaded.totals : null;
}

/** A shimmering placeholder while numbers load. */
function Shimmer({ className = "", style }: { className?: string; style?: React.CSSProperties }) {
  return <span className={`shimmer block rounded-md ${className}`} style={style} aria-hidden />;
}

function Card({ title, aside, children, className = "" }: { title?: ReactNode; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-line bg-raised/40 p-4 ${className}`}>
      {(title || aside) && (
        <div className="mb-3 flex items-center gap-2">
          <h2 className="text-[13px] font-semibold text-fg">{title}</h2>
          <div className="ml-auto">{aside}</div>
        </div>
      )}
      {children}
    </section>
  );
}

// ---------- Live ----------

function SessionRow({ pane, onOpen }: { pane: Pane; onOpen: () => void }) {
  const { t } = useTranslation();
  const title = cleanTitle(pane.title) || t("agents.live.newConversation");
  const st = pane.stats;
  const pct = st?.contextPct;
  const running = pane.bgTasks?.filter((task) => task.status === "running").length ?? 0;
  const doing =
    pane.status === "attention"
      ? (pane.attentionMessage ?? t("agents.live.waitingForYou"))
      : pane.status === "working"
        ? (pane.doing ?? t("agents.live.workingNow"))
        : pane.status === "done"
          ? t("agents.live.finishedYourTurn")
          : t("agents.live.ready");
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onOpen())}
      className="group grid cursor-pointer grid-cols-[auto_minmax(0,1.3fr)_minmax(0,1fr)_7rem_4.5rem_4rem_auto] items-center gap-3 border-b border-line px-4 py-2.5 last:border-b-0 hover:bg-hover/60"
    >
      <StatusDot status={pane.status} claude />
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-[13px] font-medium text-fg">{folderName(pane.cwd)}</span>
          {isTask(pane) && (
            <span className="flex shrink-0 items-center gap-1 rounded bg-accent-soft px-1.5 text-[10px] text-accent">
              <Layers size={10} /> {t("agents.live.task")}
            </span>
          )}
        </div>
        <div className="truncate text-[12px] text-muted" title={title}>
          {title}
        </div>
      </div>
      <div className={`truncate font-mono text-[11.5px] ${pane.status === "attention" ? "text-attention" : pane.status === "working" ? "text-working" : "text-faint"}`} title={doing}>
        {doing}
        {running > 0 && (
          <span className="ml-2 inline-flex items-center gap-1 font-sans text-working">
            <Bot size={11} /> {running}
          </span>
        )}
      </div>
      <div title={pct != null ? t("agents.live.contextTitle", { pct: Math.round(pct), window: tokens(windowFor(st?.model)) }) : t("agents.live.contextPending")}>
        {pct != null ? (
          <div className="flex items-center gap-2">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-hover">
              <div className={`h-full rounded-full ${pct >= 80 ? "bg-danger" : pct >= 60 ? "bg-attention" : "bg-accent"}`} style={{ width: `${Math.max(pct, 2)}%` }} />
            </div>
            <span className="w-8 text-right text-[11.5px] text-muted tabular-nums">{Math.round(pct)}%</span>
          </div>
        ) : (
          <span className="text-[11.5px] text-faint">–</span>
        )}
      </div>
      <span className="text-right text-[12px] text-fg tabular-nums">{st?.costUsd != null ? money(st.costUsd) : "–"}</span>
      <span className="text-right text-[11.5px] text-faint">{ago(pane.lastActivity)}</span>
      <button
        aria-label={t("agents.live.goToTab")}
        title={t("agents.live.goToTab")}
        onClick={(e) => {
          e.stopPropagation();
          openPane(pane.id);
        }}
        className="flex size-7 items-center justify-center rounded-md text-faint hover:bg-hover hover:text-fg"
      >
        <ArrowUpRight size={14} />
      </button>
    </div>
  );
}

function Sessions({ groups, onOpen }: { groups: { title: string; tone?: string; panes: Pane[] }[]; onOpen: (id: string) => void }) {
  const { t } = useTranslation();
  return (
    <div className="overflow-hidden rounded-xl border border-line bg-raised/40">
      <div className="grid grid-cols-[auto_minmax(0,1.3fr)_minmax(0,1fr)_7rem_4.5rem_4rem_auto] gap-3 border-b border-line px-4 py-2 text-[11px] font-medium text-faint">
        <span className="w-2.5" />
        <span>{t("agents.live.column.conversation")}</span>
        <span>{t("agents.live.column.doingNow")}</span>
        <span>{t("agents.live.column.context")}</span>
        <span className="text-right">{t("agents.live.column.cost")}</span>
        <span className="text-right">{t("agents.live.column.lastActive")}</span>
        <span className="w-7" />
      </div>
      {groups
        .filter((g) => g.panes.length)
        .map((g) => (
          <div key={g.title}>
            <div className={`border-b border-line bg-hover/30 px-4 py-1.5 text-[11px] font-semibold tracking-wide uppercase ${g.tone ?? "text-faint"}`}>
              {g.title} <span className="ml-1 font-normal">{g.panes.length}</span>
            </div>
            {g.panes.map((p) => (
              <SessionRow key={p.id} pane={p} onOpen={() => onOpen(p.id)} />
            ))}
          </div>
        ))}
    </div>
  );
}

/** When Claude worked today, in 15-minute slots from midnight. */
function TodayStrip({ slots }: { slots: number[] | undefined }) {
  const { t } = useTranslation();
  const loading = !slots;
  const now = new Date();
  const nowSlot = Math.floor((now.getHours() * 60 + now.getMinutes()) / 15);
  const values = slots ?? new Array(96).fill(0);
  const replies = values.reduce((n, v) => n + v, 0);
  // An hour label every 3 hours (12 slots), in the user's clock style.
  const labels = values.map((_, i) => (i % 12 === 0 ? new Date(2000, 0, 1, i / 4).toLocaleTimeString(locale(), { hour: "numeric" }) : ""));
  return (
    <Card
      title={t("agents.today.title")}
      aside={
        <span className="text-[11.5px] text-faint">
          {loading ? <Shimmer className="h-3 w-40" /> : replies ? t("agents.today.repliesSoFar", { count: replies, n: replies.toLocaleString(locale()) }) : t("agents.today.noWork")}
        </span>
      }
    >
      <BarChart
        values={values.slice(0, Math.max(nowSlot + 1, 1))}
        labels={labels.slice(0, Math.max(nowSlot + 1, 1))}
        ticks={12}
        height={56}
        format={(v) => t("agents.replies", { count: v, n: v.toLocaleString(locale()) })}
        tooltip={(i) => {
          const h = Math.floor(i / 4);
          const m = (i % 4) * 15;
          const time = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m).toLocaleTimeString(locale(), { hour: "numeric", minute: "2-digit" });
          return t("agents.today.tooltip", { time, count: values[i], n: values[i].toLocaleString(locale()) });
        }}
      />
      <p className="mt-1 text-[11px] text-faint">{t("agents.today.note")}</p>
    </Card>
  );
}

function Live({ claude, onOpen, totals }: { claude: Pane[]; onOpen: (id: string) => void; totals: UsageTotals | null }) {
  const { t } = useTranslation();
  const approvals = useStore((s) => s.approvals);
  const { openTab, homeDir } = useStore.getState();
  // Tabs with a pending approval already have a card above, so they aren't listed twice.
  const groups = [
    { title: t("agents.live.group.needsYou"), tone: "text-attention", panes: claude.filter((p) => p.status === "attention" && !approvals.some((a) => a.paneId === p.id)) },
    { title: t("agents.live.group.working"), tone: "text-working", panes: claude.filter((p) => p.status === "working") },
    { title: t("agents.live.group.finished"), panes: claude.filter((p) => p.status === "done") },
    { title: t("agents.live.group.ready"), panes: claude.filter((p) => p.status === "idle") },
  ];
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="flex min-w-0 flex-col gap-5">
        {approvals.length > 0 && (
          <section>
            <h2 className="mb-2.5 text-[11px] font-semibold tracking-wide text-attention uppercase">
              {t("agents.live.waitingApproval")} <span className="ml-1">{approvals.length}</span>
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
            <p className="max-w-sm text-muted">{t("agents.live.empty")}</p>
            <button onClick={() => openTab(homeDir, "claude")} className="flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-fg hover:bg-hover">
              <Sparkles size={14} /> {t("agents.live.startClaude")}
            </button>
          </div>
        ) : (
          <>
            <Sessions groups={groups} onOpen={onOpen} />
            <p className="-mt-2 text-[11.5px] text-faint">{t("agents.live.clickHint")}</p>
          </>
        )}
        <TodayStrip slots={totals?.today} />
      </div>
      <aside className="min-w-0">
        <UsageCockpit />
      </aside>
    </div>
  );
}

// ---------- Usage ----------

/** A key number; `null` value or sub means still loading (shimmer). */
function Kpi({ icon, label, value, sub }: { icon: ReactNode; label: string; value: ReactNode | null; sub?: ReactNode | null }) {
  return (
    <div className="min-w-0 rounded-xl border border-line bg-raised/40 px-4 py-3">
      <div className="flex items-center gap-1.5 text-[11.5px] text-faint">
        {icon} {label}
      </div>
      <div className="mt-1 text-[20px] leading-tight font-semibold break-words text-fg tabular-nums">{value ?? <Shimmer className="mt-1 h-6 w-24" />}</div>
      {sub === null ? <Shimmer className="mt-1.5 h-3 w-36" /> : sub && <div className="mt-0.5 text-[11.5px] leading-snug text-faint">{sub}</div>}
    </div>
  );
}

function ListShimmer() {
  return (
    <div className="flex flex-col gap-3 py-1">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="grid grid-cols-[9rem_minmax(0,1fr)_4rem] items-center gap-3">
          <Shimmer className="h-3 w-24" />
          <Shimmer className="h-2" />
          <Shimmer className="h-3" />
        </div>
      ))}
    </div>
  );
}

/** Placeholder bars (varied heights) while a chart loads. */
function ChartShimmer({ height = 140, bars = 14 }: { height?: number; bars?: number }) {
  return (
    <div>
      <div className="flex items-end gap-[3px]" style={{ height }}>
        {Array.from({ length: bars }, (_, i) => (
          <Shimmer key={i} className="flex-1 rounded-b-none" style={{ height: `${25 + ((i * 37) % 60)}%` }} />
        ))}
      </div>
      <div className="mt-1 h-px bg-line" />
      <Shimmer className="mt-2 h-3 w-full opacity-60" />
    </div>
  );
}

function Usage({ totals, range, setRange }: { totals: UsageTotals | null; range: Range; setRange: (r: Range) => void }) {
  const { t } = useTranslation();
  const [metric, setMetric] = useState<"cost" | "tokens" | "time">("cost");
  const home = useStore((s) => s.homeDir);
  // Every day of the period, including days without work.
  const days = useMemo(() => {
    const map = new Map((totals?.days ?? []).map((d) => [d.day, d]));
    const out = [];
    for (let i = range - 1; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const key = localDay(date);
      out.push({ key, date, d: map.get(key) });
    }
    return out;
  }, [totals, range]);
  const sum = (f: (d: NonNullable<(typeof days)[number]["d"]>) => number) => days.reduce((n, x) => n + (x.d ? f(x.d) : 0), 0);
  const cost = sum((d) => d.costUsd);
  const fresh = sum((d) => d.inputTokens + d.cacheWriteTokens + d.outputTokens);
  const cached = sum((d) => d.cacheReadTokens);
  const inputAll = sum((d) => d.inputTokens + d.cacheWriteTokens + d.cacheReadTokens);
  const hit = inputAll ? Math.round((cached / inputAll) * 100) : null;
  const value = (x: (typeof days)[number]) => (!x.d ? 0 : metric === "cost" ? x.d.costUsd : metric === "tokens" ? x.d.inputTokens + x.d.cacheWriteTokens + x.d.outputTokens : x.d.activeMs);
  const fmt = (v: number) => (metric === "cost" ? money(v) : metric === "tokens" ? tokens(v) : duration(v));
  const busiest = totals?.hours ? totals.hours.indexOf(Math.max(...totals.hours)) : -1;
  const hourLabel = (h: number) => new Date(2000, 0, 1, h).toLocaleTimeString(locale(), { hour: "numeric" });

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-2">
        <div className="flex rounded-md border border-line p-0.5 text-[12px]">
          {RANGES.map((r) => (
            <button key={r} onClick={() => setRange(r)} className={`rounded px-2.5 py-0.5 ${range === r ? "bg-hover font-medium text-fg" : "text-faint hover:text-muted"}`}>
              {t("agents.usage.lastDays", { count: r })}
            </button>
          ))}
        </div>
        <span className="text-[11.5px] text-faint">{t("agents.usage.source")}</span>
      </div>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Kpi icon={<Coins size={12} />} label={t("agents.usage.kpi.cost")} value={totals ? money(cost) : null} sub={totals ? t("agents.usage.kpi.costPerDay", { amount: money(cost / range) }) : null} />
        <Kpi icon={<Database size={12} />} label={t("agents.usage.kpi.tokens")} value={totals ? tokens(fresh) : null} sub={totals ? (hit != null ? t("agents.usage.kpi.cachedWithHit", { tokens: tokens(cached), pct: hit }) : t("agents.usage.kpi.cached", { tokens: tokens(cached) })) : null} />
        <Kpi icon={<Timer size={12} />} label={t("agents.usage.kpi.time")} value={totals ? duration(sum((d) => d.activeMs)) : null} sub={totals ? t("agents.replies", { count: sum((d) => d.replies), n: sum((d) => d.replies).toLocaleString(locale()) }) : null} />
        <Kpi
          icon={<FileDiff size={12} />}
          label={t("agents.usage.kpi.lines")}
          value={
            totals ? (
              <span className="flex flex-wrap gap-x-2">
                <span className="text-done">+{sum((d) => d.linesAdded).toLocaleString(locale())}</span>
                <span className="text-danger">−{sum((d) => d.linesRemoved).toLocaleString(locale())}</span>
              </span>
            ) : null
          }
        />
      </div>

      <Card
        title={metric === "cost" ? t("agents.usage.chart.costPerDay") : metric === "tokens" ? t("agents.usage.chart.tokensPerDay") : t("agents.usage.chart.timePerDay")}
        aside={
          <div className="flex rounded-md border border-line p-0.5 text-[11.5px]">
            {(
              [
                ["cost", t("agents.usage.metric.cost")],
                ["tokens", t("agents.usage.metric.tokens")],
                ["time", t("agents.usage.metric.time")],
              ] as const
            ).map(([k, l]) => (
              <button key={k} onClick={() => setMetric(k)} className={`rounded px-2 py-0.5 ${metric === k ? "bg-hover font-medium text-fg" : "text-faint hover:text-muted"}`}>
                {l}
              </button>
            ))}
          </div>
        }
      >
        {!totals ? (
          <ChartShimmer bars={Math.min(range, 30)} />
        ) : (
        <BarChart
          values={days.map(value)}
          labels={days.map((x) =>
            range === 7 ? x.date.toLocaleDateString(locale(), { weekday: "short" }) : x.date.toLocaleDateString(locale(), { month: "short", day: "numeric" }),
          )}
          ticks={range === 7 ? undefined : range === 14 ? 2 : 5}
          highlight={days.length - 1}
          format={fmt}
          tooltip={(i) => {
            const x = days[i];
            return (
              <>
                <span className="font-medium">{x.date.toLocaleDateString(locale(), { weekday: "short", month: "short", day: "numeric" })}</span> · {fmt(value(x))}
                {x.d && metric !== "time" && <span className="text-faint"> · {t("agents.replies", { count: x.d.replies, n: x.d.replies.toLocaleString(locale()) })}</span>}
              </>
            );
          }}
        />
        )}
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title={t("agents.usage.byProject")} aside={<span className="text-[11.5px] text-faint">{t("agents.usage.byProjectNote")}</span>}>
          {totals?.byProject.length ? (
            <RankList
              rows={totals.byProject.slice(0, 10).map((g) => ({
                key: g.key,
                label: g.key.toLowerCase() === home.toLowerCase() ? t("agents.usage.noProject", { name: folderName(g.key) }) : folderName(g.key),
                value: g.costUsd || g.tokens / 1e6,
                title: g.key.toLowerCase() === home.toLowerCase() ? `${g.key}
${t("agents.usage.homeFolderTitle")}` : g.key,
              }))}
              format={(v) => (totals.byProject.some((g) => g.costUsd > 0) ? money(v) : tokens(v * 1e6))}
              sub={(k) => tokens(totals.byProject.find((g) => g.key === k)?.tokens)}
            />
          ) : (
            totals ? <p className="text-[12px] text-faint">{t("agents.usage.noWork")}</p> : <ListShimmer />
          )}
        </Card>
        <Card title={t("agents.usage.byModel")}>
          {totals?.byModel.length ? (
            <RankList
              rows={totals.byModel.map((g) => ({ key: g.key, label: modelLabel(g.key) ?? g.key, value: g.costUsd || g.tokens / 1e6 }))}
              format={(v) => (totals.byModel.some((g) => g.costUsd > 0) ? money(v) : tokens(v * 1e6))}
              sub={(k) => tokens(totals.byModel.find((g) => g.key === k)?.tokens)}
            />
          ) : (
            totals ? <p className="text-[12px] text-faint">{t("agents.usage.noWork")}</p> : <ListShimmer />
          )}
        </Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Card title={t("agents.usage.whenYouWork")} aside={busiest >= 0 && totals?.hours[busiest] ? <span className="text-[11.5px] text-faint">{t("agents.usage.busiest", { hour: hourLabel(busiest) })}</span> : null}>
          {!totals ? (
            <ChartShimmer height={90} bars={24} />
          ) : (
          <BarChart
            values={totals.hours}
            labels={new Array(24).fill(0).map((_, h) => hourLabel(h))}
            ticks={6}
            height={90}
            format={(v) => t("agents.replies", { count: v, n: v.toLocaleString(locale()) })}
            tooltip={(h) => t("agents.usage.hourTooltip", { from: hourLabel(h), to: hourLabel((h + 1) % 24), count: totals?.hours[h] ?? 0, n: (totals?.hours[h] ?? 0).toLocaleString(locale()) })}
          />
          )}
        </Card>
        <UsageCockpit />
      </div>
    </div>
  );
}

export function AgentsPage() {
  const { t } = useTranslation();
  const panes = useStore((s) => s.panes);
  const approvals = useStore((s) => s.approvals);
  const [detail, setDetail] = useState<string | null>(null);
  const tab = useStore((s) => s.agentsTab);
  const setTab = (agentsTab: "live" | "usage") => useStore.getState().set({ agentsTab });
  const [range, setRange] = useState<Range>(7);
  const [, tick] = useState(0);
  const totals = useTotals(tab === "usage" ? range : 7);
  useEffect(() => {
    const timer = setInterval(() => tick((n) => n + 1), 15_000);
    return () => clearInterval(timer);
  }, []);

  const claude = useMemo(() => Object.values(panes).filter((p) => p.kind !== "browser" && (p.claudeActive || p.kind === "claude")), [panes]);
  const working = claude.filter((p) => p.status === "working").length;
  const waiting = claude.filter((p) => p.status === "attention").length + new Set(approvals.map((a) => a.paneId)).size;
  const { openTab, set, homeDir } = useStore.getState();

  return (
    <div className="relative h-full">
      <div className="scroll-thin h-full overflow-y-auto">
        <div className="mx-auto max-w-6xl px-8 py-6">
          <div className="mb-5 flex flex-wrap items-center gap-3">
            <div className="min-w-0 flex-1">
              <h1 className="text-[18px] font-semibold text-fg">{t("agents.title")}</h1>
              <p className="text-muted">
                {claude.length === 0
                  ? t("agents.noTabs")
                  : t("agents.summary", { count: claude.length, working, waiting })}
              </p>
            </div>
            <div role="tablist" className="flex rounded-lg border border-line p-0.5">
              {(
                [
                  ["live", t("agents.tabs.live")],
                  ["usage", t("agents.tabs.usage")],
                ] as const
              ).map(([k, l]) => (
                <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`rounded-md px-3.5 py-1 text-[13px] ${tab === k ? "bg-hover font-medium text-fg" : "text-muted hover:text-fg"}`}>
                  {l}
                  {k === "live" && waiting > 0 && <span className="ml-1.5 rounded-full bg-attention px-1.5 text-[10.5px] font-semibold text-black">{waiting}</span>}
                </button>
              ))}
            </div>
            {tab === "usage" ? (
              <button
                onClick={async () => {
                  // The selected range; if it's still loading, wait for it.
                  const data = totals ?? (await ipc.usageTotals(range).catch(() => null));
                  void exportPdf(
                    pdfName("helm-usage", `last-${range}-days`, localDay(new Date())),
                    <UsagePrint usage={useStore.getState().usage} totals={data} sessions={claude} rangeDays={range} homeDir={homeDir} />,
                  );
                }}
                title={t("agents.exportTitle", { count: range })}
                className="flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-fg hover:bg-hover"
              >
                <FileDown size={14} /> {t("agents.exportPdf")}
              </button>
            ) : (
              <button onClick={() => set({ newTaskOpen: true })} className="flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-fg hover:bg-hover">
                <Layers size={14} /> {t("agents.newParallelTask")}
              </button>
            )}
            <button
              onClick={() => {
                const s = useStore.getState();
                const cur = s.tabs.find((x) => x.id === s.activeTabId);
                openTab((cur && s.panes[cur.activePaneId]?.cwd) || homeDir, "claude");
              }}
              className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 font-medium text-on-accent hover:opacity-90"
            >
              <Plus size={14} /> {t("common.newClaudeTab")}
            </button>
          </div>

          {tab === "live" ? <Live claude={claude} onOpen={setDetail} totals={totals} /> : <Usage totals={totals} range={range} setRange={setRange} />}
        </div>
      </div>
      {detail && panes[detail] && <SessionDetail paneId={detail} onClose={() => setDetail(null)} />}
    </div>
  );
}
