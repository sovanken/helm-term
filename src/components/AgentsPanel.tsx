// The Agents tab of the right panel, laid out like a CI run page: each Claude tab is a run,
// each subagent or background command a job, and each tool call it makes a step.

import { type ReactNode, useEffect, useMemo, useState } from "react";
import { ArrowUpRight, Bot, Check, ChevronRight, Copy, Eraser, SquareTerminal } from "lucide-react";

import { paneIds } from "../lib/layout";
import { activePane, type BgTask, cleanTitle, folderName, type Pane, useStore } from "../state/store";

function useTick(ms: number) {
  const [, set] = useState(0);
  useEffect(() => {
    const t = setInterval(() => set((n) => n + 1), ms);
    return () => clearInterval(t);
  }, [ms]);
}

function duration(ms: number) {
  const secs = Math.max(0, Math.round(ms / 1000));
  if (secs < 60) return `${secs}s`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ${secs % 60}s`;
  return `${Math.floor(secs / 3600)}h ${Math.floor((secs % 3600) / 60)}m`;
}

const taskEnd = (t: BgTask) => t.endedAt ?? Date.now();

export function Empty({ icon, title, text }: { icon: ReactNode; title: string; text: string }) {
  return (
    <div className="mx-3 mt-3 flex flex-col items-center gap-2 rounded-xl border border-dashed border-line px-4 py-8 text-center">
      <span className="text-faint">{icon}</span>
      <div className="text-[13px] font-medium text-fg">{title}</div>
      <p className="text-[12px] leading-relaxed text-faint">{text}</p>
    </div>
  );
}

/** Running: a spinning ring. Done: a filled check. */
function StatusIcon({ running, size = 16 }: { running: boolean; size?: number }) {
  if (running) {
    return (
      <span
        aria-label="Running"
        style={{ width: size, height: size }}
        className="status-working inline-block shrink-0 rounded-full border-2 border-attention border-t-transparent"
      />
    );
  }
  return (
    <span aria-label="Finished" style={{ width: size, height: size }} className="flex shrink-0 items-center justify-center rounded-full bg-done text-white">
      <Check size={size * 0.62} strokeWidth={3} />
    </span>
  );
}

interface Step {
  key: string;
  name: ReactNode;
  running: boolean;
  ms?: number;
  log?: string;
}

function stepsOf(task: BgTask): Step[] {
  const running = task.status === "running";
  const recent = task.recent ?? [];
  const hidden = (task.steps ?? 0) - recent.length;
  const steps: Step[] = [
    {
      key: "start",
      name: task.kind === "agent" ? `Start ${task.type ?? "subagent"}` : "Start command",
      running: false,
      // Unknown once the first steps have scrolled out of the kept history.
      ms: hidden > 0 ? undefined : (recent[0]?.at ?? (running ? task.startedAt : taskEnd(task))) - task.startedAt,
    },
  ];
  if (hidden > 0) steps.push({ key: "hidden", name: <span className="text-faint">{hidden} earlier {hidden === 1 ? "step" : "steps"}</span>, running: false });
  recent.forEach((r, i) => {
    const last = i === recent.length - 1;
    steps.push({ key: `s${i}`, name: r.what, running: running && last, ms: (last ? taskEnd(task) : recent[i + 1].at) - r.at });
  });
  if (running && recent.length === 0 && task.kind === "command") steps.push({ key: "cmd", name: task.label, running: true, ms: Date.now() - task.startedAt });
  if (!running) steps.push({ key: "answer", name: task.kind === "agent" ? "Answer" : "Finished", running: false, log: task.summary });
  return steps;
}

/** A step's output, shown like a CI log: numbered, monospaced lines. */
function LogBox({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const lines = text.replace(/\n+$/, "").split("\n");
  return (
    <div className="group relative mx-2 mb-2 rounded-md border border-line bg-bg">
      <button
        aria-label="Copy"
        title={copied ? "Copied" : "Copy"}
        onClick={() => {
          void navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        }}
        className="absolute top-1.5 right-1.5 flex size-6 items-center justify-center rounded-md bg-raised text-faint opacity-0 group-hover:opacity-100 hover:text-fg"
      >
        {copied ? <Check size={12} className="text-done" /> : <Copy size={12} />}
      </button>
      <div className="scroll-thin max-h-72 overflow-y-auto py-1.5 font-mono text-[11.5px] leading-[1.65] select-text">
        {lines.map((l, i) => (
          <div key={i} className="flex hover:bg-hover">
            <span className="w-9 shrink-0 pr-2.5 text-right text-faint select-none">{i + 1}</span>
            <span className="min-w-0 flex-1 pr-3 break-words whitespace-pre-wrap text-fg">{l || " "}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function StepRow({ step }: { step: Step }) {
  const [open, setOpen] = useState(step.key === "answer");
  const expandable = !!step.log;
  return (
    <div>
      <button
        onClick={() => expandable && setOpen((o) => !o)}
        className={`flex h-7 w-full items-center gap-2 rounded-md px-1.5 text-left text-[12px] ${expandable ? "hover:bg-hover" : "cursor-default"}`}
      >
        <ChevronRight size={12} className={`shrink-0 text-faint transition-transform duration-150 ${expandable ? "" : "invisible"} ${open ? "rotate-90" : ""}`} />
        {step.key === "hidden" ? <span className="size-3.5 shrink-0" /> : <StatusIcon running={step.running} size={14} />}
        <span className={`min-w-0 flex-1 truncate ${step.key.startsWith("s") || step.key === "cmd" ? "font-mono text-[11.5px]" : ""} ${step.running ? "text-fg" : "text-muted"}`} title={typeof step.name === "string" ? step.name : undefined}>
          {step.name}
        </span>
        {step.ms !== undefined && <span className="shrink-0 text-[11px] text-faint tabular-nums">{duration(step.ms)}</span>}
      </button>
      {open && step.log && <LogBox text={step.log} />}
    </div>
  );
}

function JobRow({ task }: { task: BgTask }) {
  const running = task.status === "running";
  const [open, setOpen] = useState(running);
  // Open a job while it runs; leave it as the user set it afterwards.
  useEffect(() => {
    if (running) setOpen(true);
  }, [running]);
  const steps = open ? stepsOf(task) : [];
  return (
    <div className={open ? "bg-surface/50" : ""}>
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-start gap-2 px-2.5 py-2 text-left hover:bg-hover">
        <ChevronRight size={13} className={`mt-[3px] shrink-0 text-faint transition-transform duration-150 ${open ? "rotate-90" : ""}`} />
        <span className="mt-px">
          <StatusIcon running={running} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="line-clamp-2 text-[13px] leading-snug font-medium text-fg">{task.label}</span>
          <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[11px] text-faint">
            {task.kind === "agent" ? <Bot size={11} /> : <SquareTerminal size={11} />}
            {task.kind === "agent" ? (task.type ?? "Subagent") : "Command"}
            {task.background && <span>· background</span>}
            {!!task.steps && <span>· {task.steps} {task.steps === 1 ? "step" : "steps"}</span>}
          </span>
        </span>
        <span className={`shrink-0 pt-px text-[11.5px] tabular-nums ${running ? "text-fg" : "text-faint"}`}>{duration(taskEnd(task) - task.startedAt)}</span>
      </button>
      {open && (
        <div className="anim-fade pr-1 pb-1.5 pl-5">
          {steps.map((s) => (
            <StepRow key={s.key} step={s} />
          ))}
        </div>
      )}
    </div>
  );
}

function RunCard({ pane, tasks, current }: { pane: Pane; tasks: BgTask[]; current: boolean }) {
  const runningCount = tasks.filter((t) => t.status === "running").length;
  const start = Math.min(...tasks.map((t) => t.startedAt));
  const end = Math.max(...tasks.map(taskEnd));
  const title = cleanTitle(pane.title);
  const goTo = () => {
    const s = useStore.getState();
    const tab = s.tabs.find((t) => paneIds(t.root).includes(pane.id));
    if (tab) s.setActiveTab(tab.id);
  };
  return (
    <section className="mb-3 overflow-hidden rounded-xl border border-line bg-raised">
      <header className="flex items-center gap-2.5 border-b border-line px-3 py-2.5">
        <StatusIcon running={runningCount > 0} size={18} />
        <div className="min-w-0 flex-1">
          <button onClick={goTo} title="Go to this tab" className="group flex max-w-full items-center gap-1 text-left">
            <span className="truncate text-[13px] font-semibold text-fg group-hover:underline">{folderName(pane.cwd)}</span>
            <ArrowUpRight size={12} className="shrink-0 text-faint opacity-0 group-hover:opacity-100" />
          </button>
          <div className="truncate text-[11px] text-faint">
            {runningCount > 0 ? `${runningCount} running` : "All finished"} · {tasks.length} {tasks.length === 1 ? "job" : "jobs"} · {duration(end - start)}
            {title && ` · ${title}`}
          </div>
        </div>
        {current && <span className="shrink-0 rounded-full border border-line px-1.5 text-[10px] text-faint">this tab</span>}
      </header>
      <div className="divide-y divide-line">
        {tasks.map((t) => (
          <JobRow key={t.id} task={t} />
        ))}
      </div>
    </section>
  );
}

type TaskFilter = "all" | "running" | "done";

export function AgentsTab() {
  useTick(1000);
  const panes = useStore((s) => s.panes);
  const activeTabId = useStore((s) => s.activeTabId);
  const current = useMemo(() => activePane(), [activeTabId, panes]);
  const [filter, setFilter] = useState<TaskFilter>("all");
  const withTasks = Object.values(panes).filter((p) => p.bgTasks?.length);
  const all = withTasks.flatMap((p) => p.bgTasks ?? []);
  const runningCount = all.filter((t) => t.status === "running").length;
  const doneCount = all.length - runningCount;

  if (withTasks.length === 0) {
    return (
      <Empty
        icon={<Bot size={20} />}
        title="No background agents yet"
        text="When Claude starts a subagent or a background command, it shows up here with each step it takes, how long it ran, and its answer."
      />
    );
  }

  const clearFinished = () => {
    const s = useStore.getState();
    for (const p of withTasks) s.updatePane(p.id, { bgTasks: (p.bgTasks ?? []).filter((t) => t.status === "running") });
  };
  const ordered = [...withTasks].sort((a, b) => (a.id === current?.id ? -1 : b.id === current?.id ? 1 : 0));
  const filters: { id: TaskFilter; label: string; count: number }[] = [
    { id: "all", label: "All", count: all.length },
    { id: "running", label: "Running", count: runningCount },
    { id: "done", label: "Finished", count: doneCount },
  ];
  const shown = (t: BgTask) => filter === "all" || (filter === "running" ? t.status === "running" : t.status === "done");

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 px-2.5 pt-0.5 pb-2">
        <div className="flex gap-0.5">
          {filters.map((f) => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className={`flex items-center gap-1 rounded-md px-2 py-0.5 text-[11.5px] font-medium ${filter === f.id ? "bg-hover text-fg" : "text-faint hover:text-muted"}`}
            >
              {f.label}
              <span className="tabular-nums opacity-70">{f.count}</span>
            </button>
          ))}
        </div>
        {doneCount > 0 && (
          <button
            onClick={clearFinished}
            title="Remove finished jobs"
            className="ml-auto flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[11.5px] whitespace-nowrap text-faint hover:bg-hover hover:text-muted"
          >
            <Eraser size={12} /> Clear
          </button>
        )}
      </div>
      <div className="scroll-thin flex-1 overflow-y-auto px-2.5 pb-3">
        {ordered.map((p) => {
          // Running jobs first, then newest first.
          const tasks = [...(p.bgTasks ?? [])]
            .reverse()
            .filter(shown)
            .sort((a, b) => (a.status === b.status ? 0 : a.status === "running" ? -1 : 1));
          return tasks.length ? <RunCard key={p.id} pane={p} tasks={tasks} current={p.id === current?.id} /> : null;
        })}
        {filter !== "all" && !all.some(shown) && (
          <p className="px-2 py-6 text-center text-[12px] text-faint">{filter === "running" ? "Nothing running right now." : "Nothing finished yet."}</p>
        )}
      </div>
    </div>
  );
}
