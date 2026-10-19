// One Claude session in detail, like Claude Code's /context and /cost: what fills the context
// window, how it grew, tokens and cache use, activity and the tools Claude used.

import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { ArrowUpRight, FileDown, Layers, Play, RefreshCw, Shrink, X } from "lucide-react";

import { ipc, type SessionInfo, type SessionReport } from "../lib/ipc";
import { paneIds } from "../lib/layout";
import { clock, duration, money, tokens, windowFor } from "../lib/format";
import { cleanTitle, folderName, type Pane, showToast, useStore } from "../state/store";
import { typeCommand } from "../terminal/terminals";
import { exportPdf, pdfName } from "../lib/pdf";
import { SessionPrint } from "./PrintReports";
import { modelLabel } from "./StatusBar";
import { StatusDot } from "./StatusDot";

const SETUP_LABELS = /system|tools|mcp|memory|skills|agents|instructions|output style/i;

export function openPane(paneId: string) {
  const s = useStore.getState();
  const tab = s.tabs.find((t) => paneIds(t.root).includes(paneId));
  if (tab) {
    s.setActiveTab(tab.id);
    s.focusPane(paneId);
  }
}

function Section({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="border-b border-line px-5 py-4 last:border-b-0">
      <div className="mb-3 flex items-center gap-2">
        <h3 className="text-[11px] font-semibold tracking-wide text-faint uppercase">{title}</h3>
        <span className="ml-auto">{aside}</span>
      </div>
      {children}
    </section>
  );
}

function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] text-faint">{label}</div>
      <div className="truncate text-[15px] font-semibold text-fg tabular-nums">{value}</div>
      {sub && <div className="truncate text-[11px] text-faint">{sub}</div>}
    </div>
  );
}

export interface Breakdown {
  used: number;
  window: number;
  setup: number;
  messages: number;
  buffer: number;
  exact: boolean;
  details: { label: string; tokens: number }[];
}

export function breakdown(pane: Pane, r: SessionReport | null): Breakdown | null {
  const window = r?.exact?.window || r?.contextWindow || windowFor(pane.stats?.model);
  const live = pane.stats?.contextPct != null ? Math.round((pane.stats.contextPct / 100) * window) : undefined;
  // Claude's own numbers win while they're current (no newer reply since /context ran).
  if (r?.exact && (!r.last || r.exact.at >= (r.series[r.series.length - 1]?.t ?? 0))) {
    const get = (re: RegExp) => r.exact!.items.filter((i) => re.test(i.label)).reduce((n, i) => n + i.tokens, 0);
    const setup = get(SETUP_LABELS);
    const messages = get(/^messages$/i);
    return {
      used: r.exact.used || setup + messages,
      window,
      setup,
      messages,
      buffer: get(/autocompact|buffer/i),
      exact: true,
      details: r.exact.items.filter((i) => !/free space/i.test(i.label)),
    };
  }
  const used = live ?? r?.contextTokens;
  if (used == null) return null;
  const setup = Math.min(used, r?.setupTokens ?? 0);
  return { used, window, setup, messages: used - setup, buffer: 0, exact: false, details: [] };
}

export function ContextBar({ b }: { b: Breakdown }) {
  const seg = (n: number) => `${Math.max(0, (n / b.window) * 100)}%`;
  return (
    <div>
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-hover" role="img" aria-label={`${tokens(b.used)} of ${tokens(b.window)} tokens used`}>
        <div className="h-full bg-accent/45" style={{ width: seg(b.setup) }} title={`Setup: ${tokens(b.setup)}`} />
        <div className="h-full border-l-2 border-surface bg-accent" style={{ width: seg(b.messages) }} title={`Conversation: ${tokens(b.messages)}`} />
        <div className="flex-1" />
        {b.buffer > 0 && <div className="h-full border-l-2 border-surface bg-[repeating-linear-gradient(135deg,var(--faint)_0_2px,transparent_2px_5px)] opacity-60" style={{ width: seg(b.buffer) }} title={`Reserved for auto-compact: ${tokens(b.buffer)}`} />}
      </div>
      <div className="mt-2.5 grid grid-cols-2 gap-x-4 gap-y-1.5 text-[12px]">
        <Legend swatch="bg-accent/45" label="Setup" title="System prompt, tools, MCP, memory files and skills: sent with every message" value={b.setup} window={b.window} />
        <Legend swatch="bg-accent" label="Conversation" title="Your messages, Claude's replies and tool results" value={b.messages} window={b.window} />
        {b.buffer > 0 && <Legend swatch="bg-faint/60" label="Auto-compact reserve" title="Kept free so Claude can summarise the conversation when it fills up" value={b.buffer} window={b.window} />}
        <Legend swatch="bg-hover border border-line" label="Free" value={Math.max(0, b.window - b.used - b.buffer)} window={b.window} />
      </div>
      <p className="mt-2 text-[11px] text-faint">Setup is the system prompt, tools, MCP, memory files and skills, sent with every message.</p>
    </div>
  );
}

function Legend({ swatch, label, title, value, window }: { swatch: string; label: string; title?: string; value: number; window: number }) {
  return (
    <div className="flex min-w-0 items-center gap-2" title={title}>
      <span className={`size-2.5 shrink-0 rounded-sm ${swatch}`} />
      <span className="min-w-0 flex-1 truncate text-muted">{label}</span>
      <span className="shrink-0 text-fg tabular-nums">{tokens(value)}</span>
      <span className="w-10 shrink-0 text-right text-faint tabular-nums">{((value / window) * 100).toFixed(1)}%</span>
    </div>
  );
}

/** Context size after each reply: an area line with a hover readout. Drops are compactions. */
export function GrowthChart({ series, height = 110 }: { series: SessionReport["series"]; height?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const box = useRef<SVGSVGElement>(null);
  const W = 440;
  const H = height;
  const max = Math.max(...series.map((p) => p.context), 1);
  const x = (i: number) => (series.length === 1 ? W / 2 : (i / (series.length - 1)) * W);
  const y = (v: number) => H - 6 - (v / max) * (H - 14);
  const line = series.map((p, i) => `${x(i).toFixed(1)},${y(p.context).toFixed(1)}`).join(" ");
  const p = hover != null ? series[hover] : null;
  return (
    <div className="relative">
      <svg
        ref={box}
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="w-full overflow-visible"
        style={{ height }}
        onMouseMove={(e) => {
          const r = box.current!.getBoundingClientRect();
          const i = Math.round(((e.clientX - r.left) / r.width) * (series.length - 1));
          setHover(Math.max(0, Math.min(series.length - 1, i)));
        }}
        onMouseLeave={() => setHover(null)}
      >
        <line x1="0" x2={W} y1={y(max)} y2={y(max)} stroke="var(--border)" strokeDasharray="3 4" vectorEffect="non-scaling-stroke" />
        <line x1="0" x2={W} y1={H - 6} y2={H - 6} stroke="var(--border)" vectorEffect="non-scaling-stroke" />
        <polygon points={`0,${H - 6} ${line} ${W},${H - 6}`} fill="var(--accent)" opacity="0.14" />
        <polyline points={line} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        {p && hover != null && (
          <>
            <line x1={x(hover)} x2={x(hover)} y1="0" y2={H - 6} stroke="var(--faint)" vectorEffect="non-scaling-stroke" />
            <circle cx={x(hover)} cy={y(p.context)} r="4" fill="var(--accent)" stroke="var(--surface)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
          </>
        )}
      </svg>
      <div className="mt-1 flex justify-between text-[10.5px] text-faint tabular-nums">
        <span>{clock(series[0]?.t)}</span>
        <span>peak {tokens(max)}</span>
        <span>{clock(series[series.length - 1]?.t)}</span>
      </div>
      {p && hover != null && (
        <div
          className="pointer-events-none absolute -top-2 z-10 -translate-x-1/2 -translate-y-full rounded-md border border-line bg-raised px-2 py-1 text-[11px] whitespace-nowrap text-fg shadow-sm"
          style={{ left: `${(x(hover) / W) * 100}%` }}
        >
          Reply {hover + 1} · <span className="font-semibold tabular-nums">{tokens(p.context)}</span> context · {clock(p.t)}
        </div>
      )}
    </div>
  );
}

/**
 * Details for a session open in a tab (`paneId`), or for any past conversation from History
 * (`session`); a past one that's open in a tab uses that tab's live numbers.
 */
export function SessionDetail({ paneId, session, onClose }: { paneId?: string; session?: SessionInfo; onClose: () => void }) {
  const livePane = useStore((s) =>
    paneId
      ? s.panes[paneId]
      : session
        ? Object.values(s.panes).find((p) => p.kind !== "browser" && (p.sessionId === session.id || p.resumeSessionId === session.id))
        : undefined,
  );
  const pastPane = useMemo<Pane | undefined>(
    () => (session ? { id: "", kind: "claude", cwd: session.cwd, title: session.title, sessionId: session.id, claudeActive: false, status: "idle" } : undefined),
    [session],
  );
  const pane = livePane ?? pastPane;
  const open = !!livePane;
  const activity = useStore((s) => s.activity);
  const [report, setReport] = useState<SessionReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [askedExact, setAskedExact] = useState(0);

  const load = () => {
    if (!pane) return;
    void ipc.sessionReport(pane.transcriptPath, pane.sessionId).then((r) => {
      setReport(r);
      setLoading(false);
    });
  };
  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paneId, session?.id, activity]);
  // After asking for exact numbers, look for the new /context output for a few seconds.
  useEffect(() => {
    if (!askedExact) return;
    const timers = [1500, 3000, 5000].map((ms) => setTimeout(load, ms));
    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [askedExact]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onClose]);

  const b = useMemo(() => (pane ? breakdown(pane, report) : null), [pane, report]);
  if (!pane) return null;
  const busy = pane.status === "working";
  const title = cleanTitle(pane.title);
  const r = report;
  const cacheTotal = r ? r.inputTokens + r.cacheReadTokens + r.cacheWriteTokens : 0;
  const hit = r && cacheTotal ? Math.round((r.cacheReadTokens / cacheTotal) * 100) : null;
  const cost = pane.stats?.costUsd ?? r?.costUsd;
  const maxTool = Math.max(1, ...(r?.tools.map((t) => t.count) ?? [1]));

  const runInTab = (cmd: string, what: string) => {
    if (busy) return showToast(`Claude is working in this tab. Try ${what} when it's done.`, "info");
    typeCommand(pane.id, cmd, true);
    if (cmd === "/context") setAskedExact(Date.now());
    showToast(cmd === "/context" ? "Asked Claude for exact numbers. They appear here in a moment." : `Sent ${cmd} to this tab.`, "success");
  };

  return (
    <>
      <div className="anim-fade absolute inset-0 z-30 bg-black/20" onClick={onClose} />
      <aside role="dialog" aria-label="Session details" className="anim-slide-in absolute inset-y-0 right-0 z-40 flex w-[min(540px,100%)] flex-col border-l border-line bg-surface shadow-2xl shadow-black/20">
        <header className="flex items-start gap-3 border-b border-line px-5 py-4">
          <StatusDot status={pane.status} claude />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[15px] font-semibold text-fg">{folderName(pane.cwd)}</div>
            <div className="truncate text-[12.5px] text-muted">{title || "New conversation"}</div>
            <div className="mt-1 text-[11.5px] text-faint">
              {pane.stats?.model ? modelLabel(pane.stats.model) : r?.models[0] ? modelLabel(r.models[0]) : "Claude"}
              {pane.stats?.effort && ` · ${pane.stats.effort} effort`}
              {r?.started && ` · started ${clock(r.started)}`}
            </div>
          </div>
          <button
            onClick={() => void exportPdf(pdfName("helm-session", folderName(pane.cwd), new Date().toLocaleDateString("en-CA")), <SessionPrint pane={pane} report={report} b={b} />)}
            title="Save this report as a PDF"
            className="flex h-7 items-center gap-1 rounded-md border border-line px-2 text-[12px] text-fg hover:bg-hover"
          >
            <FileDown size={12} /> PDF
          </button>
          {open ? (
            <button onClick={() => openPane(pane.id)} title="Go to this tab" className="flex h-7 items-center gap-1 rounded-md border border-line px-2 text-[12px] text-fg hover:bg-hover">
              Open tab <ArrowUpRight size={12} />
            </button>
          ) : (
            session && (
              <button
                onClick={() => {
                  useStore.getState().resumeSession(session);
                  onClose();
                }}
                title="Continue this conversation in a tab"
                className="flex h-7 items-center gap-1 rounded-md border border-line px-2 text-[12px] text-fg hover:bg-hover"
              >
                <Play size={11} /> Continue
              </button>
            )
          )}
          <button aria-label="Close" onClick={onClose} className="flex size-7 items-center justify-center rounded-md text-faint hover:bg-hover hover:text-fg">
            <X size={14} />
          </button>
        </header>

        <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
          <Section
            title="Context window"
            aside={
              open && <span className="flex gap-1">
                <button
                  onClick={() => runInTab("/context", "again")}
                  disabled={busy}
                  title="Runs /context in this tab (free) and reads Claude's exact numbers"
                  className="flex items-center gap-1 rounded-md px-2 py-0.5 text-[11.5px] text-muted hover:bg-hover hover:text-fg disabled:opacity-40"
                >
                  <RefreshCw size={11} /> {b?.exact ? "Refresh exact" : "Get exact numbers"}
                </button>
                <button
                  onClick={() => runInTab("/compact", "compacting")}
                  disabled={busy}
                  title="Summarise the conversation so every next message uses less"
                  className="flex items-center gap-1 rounded-md px-2 py-0.5 text-[11.5px] text-muted hover:bg-hover hover:text-fg disabled:opacity-40"
                >
                  <Shrink size={11} /> Compact
                </button>
              </span>
            }
          >
            {!b ? (
              <p className="text-[12px] text-faint">{loading ? "Reading the conversation…" : "Appears after Claude's first reply."}</p>
            ) : (
              <>
                <div className="mb-3 flex items-baseline gap-2">
                  <span className="text-[22px] font-semibold text-fg tabular-nums">{tokens(b.used)}</span>
                  <span className="text-[13px] text-muted">of {tokens(b.window)} tokens · {((b.used / b.window) * 100).toFixed(1)}%</span>
                  <span className={`ml-auto rounded px-1.5 py-px text-[10.5px] font-medium ${b.exact ? "bg-done/15 text-done" : "bg-hover text-muted"}`}>
                    {b.exact ? `Exact · ${clock(r?.exact?.at)}` : "Estimate"}
                  </span>
                </div>
                <ContextBar b={b} />
                {b.exact && b.details.length > 0 && (
                  <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 rounded-lg bg-hover/50 px-3 py-2 text-[11.5px]">
                    {b.details.map((d) => (
                      <div key={d.label} className="flex justify-between gap-2">
                        <span className="truncate text-muted">{d.label}</span>
                        <span className="text-fg tabular-nums">{tokens(d.tokens)}</span>
                      </div>
                    ))}
                  </div>
                )}
                {!b.exact && (
                  <p className="mt-2.5 text-[11.5px] leading-relaxed text-faint">
                    {open
                      ? `Estimated from the conversation. "Get exact numbers" runs Claude's free /context command in this tab.`
                      : "Estimated from the conversation. Continue it in a tab to get Claude's exact /context numbers."}
                  </p>
                )}
              </>
            )}
          </Section>

          {r && r.series.length > 1 && (
            <Section title="How the context grew" aside={r.compactions > 0 && <span className="flex items-center gap-1 text-[11px] text-faint"><Layers size={11} /> compacted {r.compactions}×</span>}>
              <GrowthChart series={r.series} />
            </Section>
          )}

          {r && (
            <Section title="Tokens">
              <div className="grid grid-cols-4 gap-3">
                <Stat label="Sent (new)" value={tokens(r.inputTokens)} />
                <Stat label="From cache" value={tokens(r.cacheReadTokens)} sub={hit != null ? `${hit}% cache hits` : undefined} />
                <Stat label="Written to cache" value={tokens(r.cacheWriteTokens)} />
                <Stat label="Claude wrote" value={tokens(r.outputTokens)} />
              </div>
              {pane.stats?.cache && (
                <p className="mt-3 text-[11.5px] text-faint">
                  {pane.stats.cache.warm
                    ? `The cache is warm${pane.stats.cache.expiresAt ? ` until ${clock(pane.stats.cache.expiresAt)}` : ""}: replying before then is cheaper.`
                    : "The cache has gone cold; the next message re-reads the whole conversation."}
                </p>
              )}
            </Section>
          )}

          <Section title="Activity">
            <div className="grid grid-cols-4 gap-3">
              <Stat label="Your messages" value={r?.prompts ?? "–"} sub={r ? `${r.replies} replies` : undefined} />
              <Stat label="Tool calls" value={r?.toolCalls ?? "–"} />
              <Stat label="Time working" value={duration(r?.activeMs)} sub={pane.stats?.durationMs ? `${duration(pane.stats.durationMs)} open` : undefined} />
              <Stat label="Cost" value={money(cost)} sub={pane.stats?.linesAdded != null || r?.linesAdded != null ? <><span className="text-done">+{pane.stats?.linesAdded ?? r?.linesAdded ?? 0}</span> <span className="text-danger">−{pane.stats?.linesRemoved ?? r?.linesRemoved ?? 0}</span> lines</> : undefined} />
            </div>
          </Section>

          {r && r.tools.length > 0 && (
            <Section title="Tools Claude used">
              <div className="space-y-1.5">
                {r.tools.map((t) => (
                  <div key={t.name} className="flex items-center gap-2 text-[12px]">
                    <span className="w-28 shrink-0 truncate font-mono text-[11.5px] text-fg">{t.name}</span>
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-hover">
                      <div className="h-full rounded-full bg-accent/70" style={{ width: `${(t.count / maxTool) * 100}%` }} />
                    </div>
                    <span className="w-8 text-right text-muted tabular-nums">{t.count}</span>
                  </div>
                ))}
              </div>
            </Section>
          )}
        </div>
      </aside>
    </>
  );
}
