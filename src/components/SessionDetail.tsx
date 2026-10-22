// One Claude session in detail: what happened (prompts and the steps Claude took), the files it
// changed, what fills the context window (like /context) and its cost and tokens (like /cost).

import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { ArrowUpRight, Bot, FileDown, FilePlus, FileText, Globe, Layers, Lightbulb, ListChecks, MessageSquare, Pencil, Play, RefreshCw, Search, Shrink, SquareTerminal, Wrench, X } from "lucide-react";
import { MaterialIcon } from "../lib/fileIcons";

import { ipc, type SessionInfo, type SessionReport } from "../lib/ipc";
import { paneIds } from "../lib/layout";
import { clock, duration, money, tokens, windowFor } from "../lib/format";
import { cleanTitle, folderName, type Pane, showToast, useStore } from "../state/store";
import { locale } from "../i18n";
import { typeCommand } from "../terminal/terminals";
import { exportPdf, pdfName } from "../lib/pdf";
import { SessionPrint } from "./PrintReports";
import { modelLabel } from "./StatusBar";
import { StatusDot } from "./StatusDot";
import { ShimmerRows } from "./Shimmer";

const SETUP_LABELS = /system|tools|mcp|memory|skills|agents|instructions|output style/i;

export function openPane(paneId: string) {
  const s = useStore.getState();
  const tab = s.tabs.find((tb) => paneIds(tb.root).includes(paneId));
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
  const { t } = useTranslation();
  const seg = (n: number) => `${Math.max(0, (n / b.window) * 100)}%`;
  return (
    <div>
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-hover" role="img" aria-label={t("sessionDetail.context.usedAria", { used: tokens(b.used), window: tokens(b.window) })}>
        <div className="h-full bg-accent/45" style={{ width: seg(b.setup) }} title={t("sessionDetail.context.setupTitle", { tokens: tokens(b.setup) })} />
        <div className="h-full border-l-2 border-surface bg-accent" style={{ width: seg(b.messages) }} title={t("sessionDetail.context.conversationTitle", { tokens: tokens(b.messages) })} />
        <div className="flex-1" />
        {b.buffer > 0 && <div className="h-full border-l-2 border-surface bg-[repeating-linear-gradient(135deg,var(--faint)_0_2px,transparent_2px_5px)] opacity-60" style={{ width: seg(b.buffer) }} title={t("sessionDetail.context.reserveTitle", { tokens: tokens(b.buffer) })} />}
      </div>
      <div className="mt-2.5 grid grid-cols-2 gap-x-4 gap-y-1.5 text-[12px]">
        <Legend swatch="bg-accent/45" label={t("sessionDetail.context.setup")} title={t("sessionDetail.context.setupHint")} value={b.setup} window={b.window} />
        <Legend swatch="bg-accent" label={t("sessionDetail.context.conversation")} title={t("sessionDetail.context.conversationHint")} value={b.messages} window={b.window} />
        {b.buffer > 0 && <Legend swatch="bg-faint/60" label={t("sessionDetail.context.reserve")} title={t("sessionDetail.context.reserveHint")} value={b.buffer} window={b.window} />}
        <Legend swatch="bg-hover border border-line" label={t("sessionDetail.context.free")} value={Math.max(0, b.window - b.used - b.buffer)} window={b.window} />
      </div>
      <p className="mt-2 text-[11px] text-faint">{t("sessionDetail.context.setupNote")}</p>
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
  const { t } = useTranslation();
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
        <span>{t("sessionDetail.growth.peak", { tokens: tokens(max) })}</span>
        <span>{clock(series[series.length - 1]?.t)}</span>
      </div>
      {p && hover != null && (
        <div
          className="pointer-events-none absolute -top-2 z-10 -translate-x-1/2 -translate-y-full rounded-md border border-line bg-raised px-2 py-1 text-[11px] whitespace-nowrap text-fg shadow-sm"
          style={{ left: `${(x(hover) / W) * 100}%` }}
        >
          <Trans i18nKey="sessionDetail.growth.tooltip" values={{ n: hover + 1, tokens: tokens(p.context), time: clock(p.t) }} components={[<span className="font-semibold tabular-nums" />]} />
        </div>
      )}
    </div>
  );
}

const TOOL_ICON: Record<string, ReactNode> = {
  Edit: <Pencil size={12} />,
  MultiEdit: <Pencil size={12} />,
  Write: <FilePlus size={12} />,
  NotebookEdit: <Pencil size={12} />,
  Read: <FileText size={12} />,
  Bash: <SquareTerminal size={12} />,
  PowerShell: <SquareTerminal size={12} />,
  Grep: <Search size={12} />,
  Glob: <Search size={12} />,
  WebFetch: <Globe size={12} />,
  WebSearch: <Globe size={12} />,
  Agent: <Bot size={12} />,
  Task: <Bot size={12} />,
  TodoWrite: <ListChecks size={12} />,
};

/** Path relative to the project when inside it. */
function rel(path: string, cwd: string) {
  const p = path.replace(/\//g, "\\");
  const c = cwd.replace(/\//g, "\\").replace(/\\$/, "");
  return p.toLowerCase().startsWith(`${c.toLowerCase()}\\`) ? p.slice(c.length + 1) : path;
}

type Timeline = SessionReport["timeline"];

/** Prompts with the steps Claude took for each, newest at the bottom. */
function WhatHappened({ items, cwd }: { items: Timeline; cwd: string }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState<Set<number>>(new Set());
  const end = useRef<HTMLDivElement>(null);
  const turns = useMemo(() => {
    const out: { prompt?: Timeline[number]; steps: Timeline }[] = [];
    for (const e of items) {
      if (e.kind === "prompt" || !out.length) out.push({ prompt: e.kind === "prompt" ? e : undefined, steps: [] });
      if (e.kind !== "prompt") out[out.length - 1].steps.push(e);
    }
    return out;
  }, [items]);
  // Braces matter: newer WebView2 returns a promise from scrollIntoView, and an effect must not return one.
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [items.length]);
  if (!items.length) return <p className="px-5 py-6 text-[12px] text-faint">{t("sessionDetail.happened.empty")}</p>;
  const SHOWN = 6;
  return (
    <div className="px-5 py-4">
      {turns.map((turn, i) => {
        const expanded = open.has(i) || turn.steps.length <= SHOWN + 1;
        const steps = expanded ? turn.steps : turn.steps.slice(-SHOWN);
        return (
          <div key={i} className="relative pb-4 pl-6 last:pb-0">
            <span className="absolute top-1 bottom-0 left-[7px] w-px bg-line" />
            {turn.prompt && (
              <div className="relative mb-2">
                <span className="absolute top-1 -left-6 flex size-[15px] items-center justify-center rounded-full bg-accent text-on-accent">
                  <MessageSquare size={8} />
                </span>
                <div className="flex items-baseline gap-2">
                  <span className="text-[11px] font-medium text-faint">{t("sessionDetail.happened.you", { time: clock(turn.prompt.t) })}</span>
                </div>
                <p className="mt-0.5 rounded-lg bg-accent-soft px-2.5 py-1.5 text-[12.5px] leading-relaxed text-fg select-text">{turn.prompt.text}</p>
              </div>
            )}
            {!expanded && (
              <button onClick={() => setOpen(new Set(open).add(i))} className="mb-1 text-[11.5px] text-muted hover:text-fg">
                {t("sessionDetail.happened.showEarlier", { count: turn.steps.length - SHOWN })}
              </button>
            )}
            {steps.map((s, j) =>
              s.kind === "compact" ? (
                <div key={j} className="my-1.5 flex items-center gap-2 text-[11.5px] text-attention">
                  <Shrink size={12} /> {s.text} · {clock(s.t)}
                </div>
              ) : (
                <div key={j} className="flex items-center gap-2 py-[3px] text-[12px]" title={`${s.tool} · ${clock(s.t)}`}>
                  <span className="flex w-4 shrink-0 justify-center text-faint">{TOOL_ICON[s.tool ?? ""] ?? <Wrench size={12} />}</span>
                  <span className="w-[4.5rem] shrink-0 truncate font-mono text-[11px] text-muted">{s.tool}</span>
                  {s.path ? (
                    <button onClick={() => useStore.getState().openFile(s.path!, cwd)} className="min-w-0 truncate text-left text-fg hover:text-accent hover:underline">
                      {rel(s.path, cwd)}
                    </button>
                  ) : (
                    <span className="min-w-0 truncate text-fg/85">{s.text}</span>
                  )}
                </div>
              ),
            )}
          </div>
        );
      })}
      <div ref={end} />
    </div>
  );
}

function FilesChanged({ files, cwd }: { files: SessionReport["files"]; cwd: string }) {
  const { t } = useTranslation();
  if (!files.length) return <p className="px-5 py-6 text-[12px] text-faint">{t("sessionDetail.files.empty")}</p>;
  const added = files.reduce((n, f) => n + f.added, 0);
  const removed = files.reduce((n, f) => n + f.removed, 0);
  return (
    <div className="px-5 py-4">
      <p className="mb-3 text-[12px] text-muted">
        <Trans
          i18nKey="sessionDetail.files.summary"
          count={files.length}
          values={{ count: files.length, added: added.toLocaleString(locale()), removed: removed.toLocaleString(locale()) }}
          components={[<span className="text-done" />, <span className="text-danger" />]}
        />
      </p>
      <div className="overflow-hidden rounded-lg border border-line">
        {files.map((f) => (
          <button
            key={f.path}
            onClick={() => useStore.getState().openFile(f.path, cwd)}
            title={`${f.path}\n${t("sessionDetail.files.clickToOpen")}`}
            className="flex w-full items-center gap-2.5 border-b border-line px-3 py-2 text-left last:border-b-0 hover:bg-hover"
          >
            <MaterialIcon name={f.path} size={15} />
            <span className="min-w-0 flex-1 truncate text-[12.5px] text-fg">{rel(f.path, cwd)}</span>
            {f.created && <span className="rounded bg-done/15 px-1.5 text-[10.5px] text-done">{t("sessionDetail.files.new")}</span>}
            <span className="w-14 shrink-0 text-right font-mono text-[11.5px] text-done">+{f.added}</span>
            <span className="w-12 shrink-0 text-right font-mono text-[11.5px] text-danger">−{f.removed}</span>
            <span className="w-14 shrink-0 text-right text-[11px] text-faint">{t("sessionDetail.files.edits", { count: f.edits })}</span>
          </button>
        ))}
      </div>
      <p className="mt-2 text-[11px] text-faint">{t("sessionDetail.files.note")}</p>
    </div>
  );
}

/**
 * Details for a session open in a tab (`paneId`), or for any past conversation from History
 * (`session`); a past one that's open in a tab uses that tab's live numbers.
 */
export function SessionDetail({ paneId, session, onClose }: { paneId?: string; session?: SessionInfo; onClose: () => void }) {
  const { t } = useTranslation();
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
  const [tab, setTab] = useState<"happened" | "files" | "context" | "cost">("happened");

  const load = () => {
    if (!pane) return;
    void ipc.sessionReport(pane.transcriptPath, pane.sessionId).then((r) => {
      setReport(r);
      setLoading(false);
    });
  };
  useEffect(() => {
    const timer = setTimeout(load, 250);
    return () => clearTimeout(timer);
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
  const maxTool = Math.max(1, ...(r?.tools.map((tool) => tool.count) ?? [1]));
  const pct = b ? (b.used / b.window) * 100 : null;

  /** `busyMessage` is shown instead while Claude is working. */
  const runInTab = (cmd: string, busyMessage: string) => {
    if (busy) return showToast(busyMessage, "info");
    typeCommand(pane.id, cmd, true);
    if (cmd === "/context") setAskedExact(Date.now());
    showToast(cmd === "/context" ? t("sessionDetail.toast.askedExact") : t("sessionDetail.toast.sentCommand", { cmd }), "success");
  };

  const tabs = [
    ["happened", t("sessionDetail.tabs.happened"), r ? r.prompts : null],
    ["files", t("sessionDetail.tabs.files"), r ? r.files.length : null],
    ["context", t("sessionDetail.tabs.context"), pct != null ? `${Math.round(pct)}%` : null],
    ["cost", t("sessionDetail.tabs.cost"), null],
  ] as const;

  return (
    <>
      <div className="anim-fade absolute inset-0 z-30 bg-black/20" onClick={onClose} />
      <aside role="dialog" aria-label={t("sessionDetail.dialogLabel")} className="anim-slide-in absolute inset-y-0 right-0 z-40 flex w-[min(640px,100%)] flex-col border-l border-line bg-surface shadow-2xl shadow-black/20">
        <header className="border-b border-line px-5 pt-4">
          <div className="flex items-start gap-3">
            <span className="mt-1.5">
              <StatusDot status={pane.status} claude />
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[15px] font-semibold text-fg">{title || t("sessionDetail.newConversation")}</div>
              <div className="truncate text-[12px] text-muted">
                {folderName(pane.cwd)} · {pane.stats?.model ? modelLabel(pane.stats.model) : r?.models[0] ? modelLabel(r.models[0]) : "Claude"}
                {pane.stats?.effort && ` · ${t("sessionDetail.effort", { effort: pane.stats.effort })}`}
                {r?.started && ` · ${t("sessionDetail.started", { time: clock(r.started) })}`}
              </div>
            </div>
            <button
              onClick={() => void exportPdf(pdfName("helm-session", folderName(pane.cwd), new Date().toLocaleDateString("en-CA")), <SessionPrint pane={pane} report={report} b={b} />)}
              title={t("sessionDetail.savePdfTitle")}
              aria-label={t("sessionDetail.savePdf")}
              className="flex size-7 items-center justify-center rounded-md text-muted hover:bg-hover hover:text-fg"
            >
              <FileDown size={14} />
            </button>
            {open ? (
              <button onClick={() => openPane(pane.id)} title={t("sessionDetail.goToTab")} className="flex h-7 items-center gap-1 rounded-md border border-line px-2 text-[12px] text-fg hover:bg-hover">
                {t("sessionDetail.openTab")} <ArrowUpRight size={12} />
              </button>
            ) : (
              session && (
                <button
                  onClick={() => {
                    useStore.getState().resumeSession(session);
                    onClose();
                  }}
                  title={t("sessionDetail.continueTitle")}
                  className="flex h-7 items-center gap-1 rounded-md border border-line px-2 text-[12px] text-fg hover:bg-hover"
                >
                  <Play size={11} /> {t("sessionDetail.continue")}
                </button>
              )
            )}
            <button aria-label={t("common.close")} onClick={onClose} className="flex size-7 items-center justify-center rounded-md text-faint hover:bg-hover hover:text-fg">
              <X size={14} />
            </button>
          </div>

          {/* The four numbers people ask first. */}
          <div className="mt-3 grid grid-cols-4 gap-3">
            <Stat label={t("sessionDetail.stat.cost")} value={money(cost)} />
            <Stat label={t("sessionDetail.stat.worked")} value={duration(r?.activeMs)} />
            <Stat label={t("sessionDetail.stat.messages")} value={r ? `${r.prompts} → ${r.replies}` : "–"} sub={t("sessionDetail.stat.messagesSub")} />
            <Stat
              label={t("sessionDetail.stat.filesChanged")}
              value={r ? r.files.length : "–"}
              sub={
                r?.files.length ? (
                  <>
                    <span className="text-done">+{r.files.reduce((n, f) => n + f.added, 0)}</span> <span className="text-danger">−{r.files.reduce((n, f) => n + f.removed, 0)}</span>
                  </>
                ) : undefined
              }
            />
          </div>

          <div role="tablist" className="mt-3 -mb-px flex gap-1">
            {tabs.map(([k, l, n]) => (
              <button
                key={k}
                role="tab"
                aria-selected={tab === k}
                onClick={() => setTab(k)}
                className={`border-b-2 px-2.5 pb-2 text-[12.5px] ${tab === k ? "border-accent font-medium text-fg" : "border-transparent text-muted hover:text-fg"}`}
              >
                {l}
                {n != null && <span className="ml-1.5 text-faint">{n}</span>}
              </button>
            ))}
          </div>
        </header>

        <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
          {!r && (loading ? <ShimmerRows rows={7} className="px-5 py-5" /> : <p className="px-5 py-6 text-[12px] text-faint">{t("sessionDetail.noTranscript")}</p>)}

          {r && tab === "happened" && <WhatHappened items={r.timeline} cwd={pane.cwd} />}
          {r && tab === "files" && <FilesChanged files={r.files} cwd={pane.cwd} />}

          {r && tab === "context" && (
            <>
              <Section
                title={t("sessionDetail.context.title")}
                aside={
                  open && (
                    <span className="flex gap-1">
                      <button
                        onClick={() => runInTab("/context", t("sessionDetail.toast.busyRetry"))}
                        disabled={busy}
                        title={t("sessionDetail.context.exactTitle")}
                        className="flex items-center gap-1 rounded-md px-2 py-0.5 text-[11.5px] text-muted hover:bg-hover hover:text-fg disabled:opacity-40"
                      >
                        <RefreshCw size={11} /> {b?.exact ? t("sessionDetail.context.refreshExact") : t("sessionDetail.context.getExact")}
                      </button>
                    </span>
                  )
                }
              >
                {!b ? (
                  <p className="text-[12px] text-faint">{t("sessionDetail.context.pending")}</p>
                ) : (
                  <>
                    <div className="mb-3 flex items-baseline gap-2">
                      <span className="text-[24px] font-semibold text-fg tabular-nums">{Math.round(pct!)}%</span>
                      <span className="text-[13px] text-muted">
                        {t("sessionDetail.context.usedOf", { used: tokens(b.used), window: tokens(b.window) })}
                      </span>
                      <span className={`ml-auto rounded px-1.5 py-px text-[10.5px] font-medium ${b.exact ? "bg-done/15 text-done" : "bg-hover text-muted"}`}>{b.exact ? t("sessionDetail.context.exact", { time: clock(r.exact?.at) }) : t("sessionDetail.context.estimate")}</span>
                    </div>
                    <ContextBar b={b} />
                    {/* Plain advice for how full it is. */}
                    <div
                      className={`mt-3 flex items-start gap-2.5 rounded-lg px-3 py-2.5 text-[12px] leading-relaxed ${pct! >= 80 ? "bg-danger/10 text-fg" : pct! >= 60 ? "bg-attention/10 text-fg" : "bg-hover/60 text-muted"}`}
                    >
                      <Lightbulb size={14} className={`mt-0.5 shrink-0 ${pct! >= 80 ? "text-danger" : pct! >= 60 ? "text-attention" : "text-faint"}`} />
                      <div className="flex-1">
                        {pct! >= 80
                          ? t("sessionDetail.context.adviceFull")
                          : pct! >= 60
                            ? t("sessionDetail.context.adviceHalf")
                            : t("sessionDetail.context.adviceRoom")}
                        {open && pct! >= 60 && (
                          <div className="mt-2 flex gap-2">
                            <button onClick={() => runInTab("/compact", t("sessionDetail.toast.busyCompact"))} disabled={busy} className="flex items-center gap-1 rounded-md bg-accent px-2.5 py-1 text-[12px] font-medium text-on-accent hover:opacity-90 disabled:opacity-40">
                              <Shrink size={12} /> {t("sessionDetail.context.compactNow")}
                            </button>
                            <button onClick={() => useStore.getState().openTab(pane.cwd, "claude")} className="rounded-md border border-line px-2.5 py-1 text-[12px] text-fg hover:bg-hover">
                              {t("sessionDetail.context.newConversation")}
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
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
                        {open ? t("sessionDetail.context.estimatedOpen") : t("sessionDetail.context.estimatedPast")}
                      </p>
                    )}
                  </>
                )}
              </Section>
              {r.series.length > 1 && (
                <Section
                  title={t("sessionDetail.growth.title")}
                  aside={
                    r.compactions > 0 && (
                      <span className="flex items-center gap-1 text-[11px] text-faint">
                        <Layers size={11} /> {t("sessionDetail.growth.compacted", { count: r.compactions })}
                      </span>
                    )
                  }
                >
                  <GrowthChart series={r.series} />
                </Section>
              )}
            </>
          )}

          {r && tab === "cost" && (
            <>
              <Section title={t("sessionDetail.cost.title")}>
                <div className="grid grid-cols-3 gap-3">
                  <Stat label={t("sessionDetail.cost.thisConversation")} value={money(cost)} sub={t("sessionDetail.cost.asReported")} />
                  <Stat label={t("sessionDetail.cost.perMessage")} value={r.prompts && cost != null ? money(cost / r.prompts) : "–"} sub={t("sessionDetail.cost.onAverage")} />
                  <Stat label={t("sessionDetail.cost.linesChanged")} value={<><span className="text-done">+{pane.stats?.linesAdded ?? r.linesAdded ?? 0}</span> <span className="text-danger">−{pane.stats?.linesRemoved ?? r.linesRemoved ?? 0}</span></>} />
                </div>
              </Section>
              <Section title={t("sessionDetail.tokens.title")}>
                <div className="grid grid-cols-4 gap-3">
                  <Stat label={t("sessionDetail.tokens.sent")} value={tokens(r.inputTokens)} />
                  <Stat label={t("sessionDetail.tokens.cacheRead")} value={tokens(r.cacheReadTokens)} />
                  <Stat label={t("sessionDetail.tokens.cacheWrite")} value={tokens(r.cacheWriteTokens)} />
                  <Stat label={t("sessionDetail.tokens.output")} value={tokens(r.outputTokens)} />
                </div>
                {hit != null && (
                  <div className="mt-3">
                    <div className="mb-1 flex justify-between text-[11.5px]">
                      <span className="text-muted">{t("sessionDetail.tokens.cacheHits")}</span>
                      <span className="text-fg tabular-nums">{t("sessionDetail.tokens.hitPct", { pct: hit })}</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-hover">
                      <div className="h-full rounded-full bg-done" style={{ width: `${hit}%` }} />
                    </div>
                    <p className="mt-1.5 text-[11.5px] text-faint">{t("sessionDetail.tokens.cacheNote")}</p>
                  </div>
                )}
                {pane.stats?.cache && (
                  <p className="mt-2 text-[11.5px] text-faint">
                    {pane.stats.cache.warm
                      ? pane.stats.cache.expiresAt
                        ? t("sessionDetail.tokens.warmUntil", { time: clock(pane.stats.cache.expiresAt) })
                        : t("sessionDetail.tokens.warm")
                      : t("sessionDetail.tokens.cold")}
                  </p>
                )}
              </Section>
              {r.tools.length > 0 && (
                <Section title={t("sessionDetail.tools.title", { count: r.toolCalls })}>
                  <div className="space-y-1.5">
                    {r.tools.map((tool) => (
                      <div key={tool.name} className="flex items-center gap-2 text-[12px]">
                        <span className="flex w-4 justify-center text-faint">{TOOL_ICON[tool.name] ?? <Wrench size={12} />}</span>
                        <span className="w-24 shrink-0 truncate font-mono text-[11.5px] text-fg">{tool.name}</span>
                        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-hover">
                          <div className="h-full rounded-full bg-accent/70" style={{ width: `${(tool.count / maxTool) * 100}%` }} />
                        </div>
                        <span className="w-8 text-right text-muted tabular-nums">{tool.count}</span>
                      </div>
                    ))}
                  </div>
                </Section>
              )}
            </>
          )}
        </div>
      </aside>
    </>
  );
}
