import { useEffect, useMemo, useState } from "react";
import { Bot, Layers, Plus, Sparkles } from "lucide-react";
import { timeSince as ago } from "../lib/agents";
import { paneIds } from "../lib/layout";
import { type Pane, cleanTitle, folderName, useStore } from "../state/store";
import { ApprovalCard } from "./Approvals";
import { modelLabel } from "./StatusBar";
import { StatusDot } from "./StatusDot";
import { UsageCockpit } from "./Usage";

function openPane(paneId: string) {
  const s = useStore.getState();
  const tab = s.tabs.find((t) => paneIds(t.root).includes(paneId));
  if (tab) {
    s.setActiveTab(tab.id);
    s.focusPane(paneId);
  }
}

/** A worktree task lives in a folder named after it inside the repo's worktrees folder. */
function isTask(pane: Pane) {
  return /[\\/](\.claude[\\/]worktrees|[^\\/]+-tasks)[\\/][^\\/]+$/i.test(pane.cwd);
}

function AgentCard({ pane }: { pane: Pane }) {
  const title = cleanTitle(pane.title);
  const pct = pane.stats?.contextPct;
  return (
    <button onClick={() => openPane(pane.id)} className="group flex w-full flex-col gap-2 rounded-xl border border-line bg-raised p-3.5 text-left hover:border-accent/50">
      <div className="flex items-center gap-2">
        <StatusDot status={pane.status} claude />
        <span className="truncate font-medium text-fg">{folderName(pane.cwd)}</span>
        {isTask(pane) && (
          <span className="flex shrink-0 items-center gap-1 rounded bg-accent-soft px-1.5 text-[10px] text-accent">
            <Layers size={10} /> task
          </span>
        )}
        <span className="ml-auto shrink-0 text-[11px] text-faint">{ago(pane.lastActivity)}</span>
      </div>
      <div className="line-clamp-2 min-h-[2.5em] text-[13px] text-muted">{title || "New conversation"}</div>
      <div className="truncate font-mono text-[11px] text-faint" title={pane.doing}>
        {pane.status === "attention"
          ? <span className="text-attention">{pane.attentionMessage ?? "Waiting for you"}</span>
          : pane.status === "working"
            ? pane.doing ?? "Working…"
            : pane.status === "done"
              ? "Finished — your turn"
              : "Ready"}
        {!!pane.subagents && <span className="ml-2 text-working">+{pane.subagents} subagent{pane.subagents > 1 ? "s" : ""}</span>}
      </div>
      <div className="flex items-center gap-3 border-t border-line pt-2 text-[11px] text-faint">
        {pane.stats?.model && <span>{modelLabel(pane.stats.model)}</span>}
        {pct !== undefined && (
          <span className="flex items-center gap-1.5">
            <span className="relative h-1 w-10 overflow-hidden rounded-full bg-hover">
              <span className={`absolute inset-y-0 left-0 rounded-full ${pct >= 85 ? "bg-danger" : pct >= 65 ? "bg-attention" : "bg-accent"}`} style={{ width: `${Math.max(pct, 2)}%` }} />
            </span>
            {Math.round(pct)}% context
          </span>
        )}
        {pane.stats?.costUsd !== undefined && <span>${pane.stats.costUsd.toFixed(2)}</span>}
        {!!(pane.stats?.linesAdded || pane.stats?.linesRemoved) && (
          <span>
            <span className="text-done">+{pane.stats?.linesAdded ?? 0}</span> <span className="text-danger">−{pane.stats?.linesRemoved ?? 0}</span>
          </span>
        )}
      </div>
    </button>
  );
}

function Group({ title, panes, empty }: { title: string; panes: Pane[]; empty?: string }) {
  if (panes.length === 0 && !empty) return null;
  return (
    <section className="mb-6">
      <h2 className="mb-2.5 text-[11px] font-semibold tracking-wide text-faint uppercase">
        {title} <span className="ml-1 text-muted">{panes.length}</span>
      </h2>
      {panes.length === 0 ? (
        <p className="text-[12px] text-faint">{empty}</p>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-3">
          {panes.map((p) => (
            <AgentCard key={p.id} pane={p} />
          ))}
        </div>
      )}
    </section>
  );
}

export function AgentsPage() {
  const panes = useStore((s) => s.panes);
  const approvals = useStore((s) => s.approvals);
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 15_000);
    return () => clearInterval(t);
  }, []);

  const claude = useMemo(() => Object.values(panes).filter((p) => p.claudeActive || p.kind === "claude"), [panes]);
  // Tabs with a pending approval already have a card above, so they aren't listed twice.
  const needsYou = claude.filter((p) => p.status === "attention" && !approvals.some((a) => a.paneId === p.id));
  const working = claude.filter((p) => p.status === "working");
  const rest = claude.filter((p) => p.status === "done" || p.status === "idle");
  const { openTab, set, homeDir } = useStore.getState();

  return (
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

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="min-w-0">
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
                <Bot size={28} className="text-faint" />
                <p className="max-w-sm text-muted">Start Claude in a few tabs or parallel tasks. Every session shows up here with what it's doing and whether it needs you.</p>
                <button onClick={() => openTab(homeDir, "claude")} className="flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-fg hover:bg-hover">
                  <Sparkles size={14} /> Start Claude
                </button>
              </div>
            ) : (
              <>
                <Group title="Needs you" panes={needsYou} />
                <Group title="Working" panes={working} />
                <Group title="Done & idle" panes={rest} />
              </>
            )}
          </div>
          <aside className="min-w-0">
            <UsageCockpit />
          </aside>
        </div>
      </div>
    </div>
  );
}
