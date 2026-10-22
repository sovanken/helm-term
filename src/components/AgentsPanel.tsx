// The Agents tab of the right panel: the subagents and background commands each Claude tab has
// started, grouped by tab. Each one is a card with what it's doing right now, its activity and
// its answer (rendered as Markdown).

import { type ReactNode, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowUpRight, Bot, Check, ChevronDown, Copy, Eraser, FileOutput, FilePen, FileText, Globe, Search, SquareTerminal, Wrench, X } from "lucide-react";

import { paneIds } from "../lib/layout";
import { MarkdownBlock } from "../lib/markdown";
import { activePane, type BgTask, cleanTitle, folderName, type Pane, useStore } from "../state/store";
import { t } from "../i18n";

function useTick(ms: number) {
  const [, set] = useState(0);
  useEffect(() => {
    const t = setInterval(() => set((n) => n + 1), ms);
    return () => clearInterval(t);
  }, [ms]);
}

function duration(ms: number) {
  const secs = Math.max(0, Math.round(ms / 1000));
  if (secs < 60) return t("background.duration.seconds", { s: secs });
  if (secs < 3600) return t("background.duration.minutesSeconds", { m: Math.floor(secs / 60), s: secs % 60 });
  return t("background.duration.hoursMinutes", { h: Math.floor(secs / 3600), m: Math.floor((secs % 3600) / 60) });
}

/** "+1:05" from the start of the task. */
function offset(ms: number) {
  const secs = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = String(secs % 60).padStart(2, "0");
  return h ? `+${h}:${String(m).padStart(2, "0")}:${s}` : `+${m}:${s}`;
}

const taskEnd = (task: BgTask) => task.endedAt ?? Date.now();

export function Empty({ icon, title, text }: { icon: ReactNode; title: string; text: string }) {
  return (
    <div className="mx-3 mt-3 flex flex-col items-center gap-2 rounded-xl border border-dashed border-line px-4 py-8 text-center">
      <span className="text-faint">{icon}</span>
      <div className="text-[13px] font-medium text-fg">{title}</div>
      <p className="text-[12px] leading-relaxed text-faint">{text}</p>
    </div>
  );
}

type State = "running" | "done" | "failed" | "stopped";

function stateOf(task: BgTask): State {
  if (task.status === "running") return "running";
  if (task.outcome === "failed") return "failed";
  if (task.outcome === "killed") return "stopped";
  return "done";
}

/** Translation keys. */
const STATE_LABEL: Record<State, string> = { running: "background.state.running", done: "background.state.done", failed: "background.state.failed", stopped: "background.state.stopped" };
const STATE_TEXT: Record<State, string> = { running: "text-working", done: "text-done", failed: "text-danger", stopped: "text-muted" };
const STATE_TILE: Record<State, string> = {
  running: "bg-working/12 text-working",
  done: "bg-done/12 text-done",
  failed: "bg-danger/12 text-danger",
  stopped: "bg-hover text-muted",
};

/** The kind of work in a tile, with a small status mark in its corner. */
function Tile({ task, state }: { task: BgTask; state: State }) {
  return (
    <span className={`relative flex size-8 shrink-0 items-center justify-center rounded-lg ${STATE_TILE[state]}`}>
      {task.kind === "agent" ? <Bot size={16} /> : <SquareTerminal size={16} />}
      <span className="absolute -right-1 -bottom-1 flex size-3.5 items-center justify-center rounded-full bg-raised">
        {state === "running" ? (
          <span className="status-working size-2.5 rounded-full border-[1.5px] border-working border-t-transparent" />
        ) : state === "done" ? (
          <Check size={10} strokeWidth={3} className="text-done" />
        ) : (
          <X size={10} strokeWidth={3} className={STATE_TEXT[state]} />
        )}
      </span>
    </span>
  );
}

/** Icon for a tool call line such as "Grep: TODO". */
function toolIcon(what: string) {
  const tool = what.split(":")[0];
  if (/^(Read|NotebookRead)$/.test(tool)) return <FileText size={12} />;
  if (/^(Edit|Write|MultiEdit|NotebookEdit)$/.test(tool)) return <FilePen size={12} />;
  if (/^(Grep|Glob|ToolSearch)$/.test(tool)) return <Search size={12} />;
  if (/^(Bash|PowerShell)$/.test(tool)) return <SquareTerminal size={12} />;
  if (/^Web/.test(tool)) return <Globe size={12} />;
  if (/^(Agent|Task)$/.test(tool)) return <Bot size={12} />;
  return <Wrench size={12} />;
}

function CopyButton({ text, label }: { text: string; label?: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        void navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      }}
      className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-faint hover:bg-hover hover:text-fg"
    >
      {copied ? <Check size={11} className="text-done" /> : <Copy size={11} />}
      {copied ? t("common.copied") : (label ?? t("common.copy"))}
    </button>
  );
}

/** The answer, rendered. Long answers are clipped until "Show all". */
function Answer({ task }: { task: BgTask }) {
  const { t } = useTranslation();
  const [full, setFull] = useState(false);
  const text = task.summary!.trim();
  const long = text.length > 600 || text.split("\n").length > 12;
  return (
    <div className="rounded-lg border border-line bg-surface">
      <div className="flex items-center gap-1 border-b border-line py-1 pr-1 pl-2.5">
        <span className="flex-1 text-[11px] font-medium text-muted">{task.kind === "agent" ? t("background.answer") : t("background.result")}</span>
        {task.outputFile && (
          <button
            onClick={() => useStore.getState().openFile(task.outputFile!)}
            title={task.outputFile}
            className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-faint hover:bg-hover hover:text-fg"
          >
            <FileOutput size={11} /> {t("background.fullOutput")}
          </button>
        )}
        <CopyButton text={text} />
      </div>
      <div className={`scroll-thin px-3 py-2 ${full ? "max-h-[28rem] overflow-y-auto" : long ? "fade-bottom max-h-40 overflow-hidden" : ""}`}>
        <MarkdownBlock text={text} />
      </div>
      {long && (
        <button onClick={() => setFull((f) => !f)} className="w-full border-t border-line py-1 text-[11px] font-medium text-muted hover:bg-hover hover:text-fg">
          {full ? t("common.showLess") : t("common.showAll")}
        </button>
      )}
    </div>
  );
}

/** Tool calls the agent made, newest last, as a thin timeline. */
function Activity({ task }: { task: BgTask }) {
  const { t } = useTranslation();
  const recent = task.recent ?? [];
  const hidden = (task.steps ?? 0) - recent.length;
  const running = task.status === "running";
  return (
    <ol className="relative ml-[7px] border-l border-line pl-3">
      {hidden > 0 && <li className="py-0.5 text-[11px] text-faint">{t("background.earlierSteps", { count: hidden })}</li>}
      {recent.map((r, i) => {
        const live = running && i === recent.length - 1;
        return (
          <li key={i} className="relative flex items-center gap-1.5 py-[3px] text-[11.5px]">
            <span className={`absolute top-1/2 -left-[16.5px] size-[7px] -translate-y-1/2 rounded-full border border-bg ${live ? "bg-working" : "bg-line"}`} />
            <span className={live ? "text-working" : "text-faint"}>{toolIcon(r.what)}</span>
            <span className={`min-w-0 flex-1 truncate font-mono ${live ? "text-fg" : "text-muted"}`} title={r.what}>
              {r.what}
            </span>
            <span className="shrink-0 text-[10.5px] text-faint tabular-nums">{offset(r.at - task.startedAt)}</span>
          </li>
        );
      })}
    </ol>
  );
}

function TaskCard({ task }: { task: BgTask }) {
  const { t } = useTranslation();
  const state = stateOf(task);
  const running = state === "running";
  const hasAnswer = !!task.summary?.trim();
  // The answer is what people come for: shown. Activity stays folded until asked for.
  const [open, setOpen] = useState(true);
  const [showActivity, setShowActivity] = useState(false);
  const meta = [task.kind === "agent" ? (task.type ?? t("background.subagent")) : t("background.command"), task.background && t("background.inBackground"), task.steps ? t("background.steps", { count: task.steps }) : null].filter(Boolean);
  return (
    <article className={`rounded-xl border bg-raised ${running ? "border-working/35" : "border-line"}`}>
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-start gap-2.5 px-3 pt-2.5 pb-2 text-left">
        <Tile task={task} state={state} />
        <span className="min-w-0 flex-1">
          <span className="line-clamp-2 text-[13px] leading-snug font-medium text-fg">{task.label}</span>
          <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[11px] text-faint">
            <span className={`font-medium ${STATE_TEXT[state]}`}>{t(STATE_LABEL[state])}</span>
            {meta.map((m) => (
              <span key={String(m)}>· {m}</span>
            ))}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-1 pt-0.5">
          <span className={`text-[11.5px] tabular-nums ${running ? "text-fg" : "text-faint"}`}>{duration(taskEnd(task) - task.startedAt)}</span>
          <ChevronDown size={13} className={`text-faint transition-transform duration-150 ${open ? "" : "-rotate-90"}`} />
        </span>
      </button>

      {open && (
        <div className="anim-fade flex flex-col gap-2 px-3 pb-3">
          {running && (
            <div className="flex items-center gap-2 rounded-lg bg-working/8 px-2.5 py-1.5 text-[11.5px]">
              <span className="status-attention size-1.5 shrink-0 rounded-full bg-working" />
              <span className="min-w-0 flex-1 truncate font-mono text-fg" title={task.doing}>
                {task.doing ?? (task.kind === "command" ? t("background.running") : t("background.gettingStarted"))}
              </span>
            </div>
          )}
          {hasAnswer && <Answer task={task} />}
          {!running && !hasAnswer && <p className="text-[11.5px] text-faint">{task.kind === "agent" ? t("background.finishedNoAnswer") : t("background.finishedCommand")}</p>}
          {!!task.recent?.length && (
            <div>
              <button onClick={() => setShowActivity((s) => !s)} className="flex items-center gap-1 rounded-md py-0.5 text-[11px] font-medium text-muted hover:text-fg">
                <ChevronDown size={12} className={`transition-transform duration-150 ${showActivity ? "" : "-rotate-90"}`} />
                {t("background.activity")}
                <span className="font-normal text-faint">{task.steps ?? task.recent.length}</span>
              </button>
              {showActivity && (
                <div className="anim-fade mt-1">
                  <Activity task={task} />
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </article>
  );
}

function TabGroup({ pane, tasks, current }: { pane: Pane; tasks: BgTask[]; current: boolean }) {
  const { t } = useTranslation();
  const running = tasks.filter((task) => task.status === "running").length;
  const title = cleanTitle(pane.title);
  const goTo = () => {
    const s = useStore.getState();
    const tab = s.tabs.find((tb) => paneIds(tb.root).includes(pane.id));
    if (tab) {
      s.setActiveTab(tab.id);
      s.focusPane(pane.id);
    }
  };
  return (
    <section className="mb-4">
      <header className="mb-1.5 flex items-center gap-1.5 px-1">
        <span className={`size-1.5 shrink-0 rounded-full ${running ? "bg-working" : "bg-done"}`} />
        <button onClick={goTo} title={t("background.goToTab")} className="group flex min-w-0 items-baseline gap-1.5 text-left">
          <span className="shrink-0 text-[12px] font-semibold text-fg group-hover:underline">{folderName(pane.cwd)}</span>
          {title && <span className="min-w-0 truncate text-[11.5px] text-faint">{title}</span>}
          <ArrowUpRight size={11} className="shrink-0 self-center text-faint opacity-0 group-hover:opacity-100" />
        </button>
        <span className="ml-auto shrink-0 pl-2 text-[11px] text-faint">{current ? t("background.thisTab") : running ? t("background.workingCount", { count: running }) : ""}</span>
      </header>
      <div className="flex flex-col gap-2">
        {tasks.map((task) => (
          <TaskCard key={task.id} task={task} />
        ))}
      </div>
    </section>
  );
}

type TaskFilter = "all" | "running" | "done";

export function AgentsTab() {
  const { t } = useTranslation();
  useTick(1000);
  const panes = useStore((s) => s.panes);
  const activeTabId = useStore((s) => s.activeTabId);
  const current = useMemo(() => activePane(), [activeTabId, panes]);
  const [filter, setFilter] = useState<TaskFilter>("all");
  const withTasks = Object.values(panes).filter((p) => p.bgTasks?.length);
  const all = withTasks.flatMap((p) => p.bgTasks ?? []);
  const runningCount = all.filter((task) => task.status === "running").length;
  const doneCount = all.length - runningCount;

  if (withTasks.length === 0) {
    return (
      <Empty
        icon={<Bot size={20} />}
        title={t("background.empty.title")}
        text={t("background.empty.text")}
      />
    );
  }

  const clearFinished = () => {
    const s = useStore.getState();
    for (const p of withTasks) s.updatePane(p.id, { bgTasks: (p.bgTasks ?? []).filter((task) => task.status === "running") });
  };
  const ordered = [...withTasks].sort((a, b) => (a.id === current?.id ? -1 : b.id === current?.id ? 1 : 0));
  const filters: { id: TaskFilter; label: string; count: number }[] = [
    { id: "all", label: t("background.filter.all"), count: all.length },
    { id: "running", label: t("background.state.running"), count: runningCount },
    { id: "done", label: t("background.state.done"), count: doneCount },
  ];
  const shown = (task: BgTask) => filter === "all" || (filter === "running" ? task.status === "running" : task.status === "done");

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 px-2.5 pt-0.5 pb-2.5">
        <div className="flex gap-1">
          {filters.map((f) => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className={`flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11.5px] font-medium ${filter === f.id ? "border-line bg-raised text-fg" : "border-transparent text-faint hover:text-muted"}`}
            >
              {f.id === "running" && f.count > 0 && <span className="size-1.5 rounded-full bg-working" />}
              {f.label}
              <span className="tabular-nums opacity-70">{f.count}</span>
            </button>
          ))}
        </div>
        {doneCount > 0 && (
          <button
            onClick={clearFinished}
            title={t("background.clearFinishedTitle")}
            className="ml-auto flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[11.5px] whitespace-nowrap text-faint hover:bg-hover hover:text-muted"
          >
            <Eraser size={12} /> {t("background.clearFinished")}
          </button>
        )}
      </div>
      <div className="scroll-thin flex-1 overflow-y-auto px-2.5 pb-3">
        {ordered.map((p) => {
          // Working first, then newest first.
          const tasks = [...(p.bgTasks ?? [])]
            .reverse()
            .filter(shown)
            .sort((a, b) => (a.status === b.status ? 0 : a.status === "running" ? -1 : 1));
          return tasks.length ? <TabGroup key={p.id} pane={p} tasks={tasks} current={p.id === current?.id} /> : null;
        })}
        {filter !== "all" && !all.some(shown) && (
          <p className="px-2 py-6 text-center text-[12px] text-faint">{filter === "running" ? t("background.nothingWorking") : t("background.nothingFinished")}</p>
        )}
      </div>
    </div>
  );
}
