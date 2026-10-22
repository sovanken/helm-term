// Background work per tab (subagents and background commands), daily usage log and
// usage-saving hints. Fed by Claude Code hook and status-line events.

import { folderName, showToast, type BgTask, type Pane, type UsageDay, useStore } from "./store";
import { typeCommand } from "../terminal/terminals";
import { paneIds } from "../lib/layout";
import { toolSummary } from "../lib/agents";
import { ipc } from "../lib/ipc";
import { t } from "../i18n";

function toolSummaryLine(tool: string, input: unknown) {
  const s = toolSummary(tool, input);
  return s ? `${tool}: ${s}` : tool;
}

const str = (v: unknown) => (typeof v === "string" ? v : undefined);
const MAX_TASKS = 30;

function setTasks(paneId: string, update: (tasks: BgTask[]) => BgTask[]) {
  const s = useStore.getState();
  const pane = s.panes[paneId];
  if (pane) s.updatePane(paneId, { bgTasks: update(pane.bgTasks ?? []).slice(-MAX_TASKS) });
}

/** Opens the right panel on Agents, unless it's already open (never pull the user off a diff). */
function autoOpenAgents() {
  const s = useStore.getState();
  if (!s.settings.autoOpenAgents || s.changesOpen) return;
  s.set({ changesOpen: true, inspectorTab: "agents" });
}

/** Text of a finished (non-background) Agent/Task tool result. */
function resultText(resp: unknown): string | undefined {
  if (typeof resp === "string") return resp;
  const r = resp as { content?: unknown; result?: unknown } | null;
  if (typeof r?.result === "string") return r.result;
  if (Array.isArray(r?.content)) {
    const text = (r.content as { type?: string; text?: string }[]).filter((c) => c.type === "text" && c.text).map((c) => c.text).join("\n");
    return text || undefined;
  }
  return undefined;
}

/**
 * Subagent lifecycle as Claude Code reports it:
 *   PreToolUse(Agent) → SubagentStart (either order) → PostToolUse(Agent) "async_launched" for
 *   background agents → the subagent's own tool calls (tagged with agent_id) → SubagentStop with
 *   its final message. Synchronous agents instead return their result in PostToolUse.
 */
export function trackTaskEvent(paneId: string, event: string, data: Record<string, unknown> | null) {
  const tool = str(data?.tool_name);
  const input = (data?.tool_input ?? {}) as Record<string, unknown>;
  const toolUseId = str(data?.tool_use_id);
  const eventAgentId = str(data?.agent_id);
  const now = Date.now();
  const isAgentTool = tool === "Task" || tool === "Agent";

  // A subagent's own tool calls: show what it's doing right now.
  if (eventAgentId && event === "PreToolUse" && tool) {
    const what = toolSummaryLine(tool, input);
    setTasks(paneId, (tasks) =>
      tasks.map((t) => (t.agentId === eventAgentId ? { ...t, doing: what, steps: (t.steps ?? 0) + 1, recent: [...(t.recent ?? []), { at: now, what }].slice(-40) } : t)),
    );
    return;
  }
  if (eventAgentId && event === "PostToolUse") return;

  if (event === "PreToolUse" && isAgentTool) {
    const label = str(input.description) ?? str(input.prompt)?.split("\n")[0]?.slice(0, 120) ?? t("taskHints.subagent");
    const type = str(input.subagent_type) ?? "general-purpose";
    setTasks(paneId, (tasks) => {
      // SubagentStart may have arrived first and created a placeholder for this agent.
      const i = tasks.findIndex((t) => t.placeholder && t.type === type && now - t.startedAt < 10_000);
      if (i >= 0) return tasks.map((t, j) => (j === i ? { ...t, id: toolUseId ?? t.id, label, placeholder: false } : t));
      return [...tasks, { id: toolUseId ?? crypto.randomUUID(), kind: "agent", label, type, startedAt: now, status: "running" }];
    });
    autoOpenAgents();
  } else if (event === "PreToolUse" && (tool === "Bash" || tool === "PowerShell") && input.run_in_background === true) {
    const label = str(input.description) ?? str(input.command)?.split("\n")[0]?.slice(0, 120) ?? t("taskHints.backgroundCommand");
    setTasks(paneId, (tasks) => [...tasks, { id: toolUseId ?? crypto.randomUUID(), kind: "command", label, startedAt: now, status: "running" }]);
    autoOpenAgents();
  } else if (event === "SubagentStart") {
    const type = str(data?.agent_type);
    setTasks(paneId, (tasks) => {
      if (eventAgentId && tasks.some((t) => t.agentId === eventAgentId)) return tasks;
      const i = tasks.findIndex((t) => t.kind === "agent" && t.status === "running" && !t.agentId && (!type || t.type === type));
      if (i >= 0) return tasks.map((t, j) => (j === i ? { ...t, agentId: eventAgentId } : t));
      return [...tasks, { id: eventAgentId ?? crypto.randomUUID(), kind: "agent", label: type ?? t("taskHints.subagent"), type, agentId: eventAgentId, startedAt: now, status: "running", placeholder: true }];
    });
    autoOpenAgents();
  } else if (event === "PostToolUse" && isAgentTool && toolUseId) {
    const resp = data?.tool_response as { status?: string; agentId?: string } | undefined;
    if (resp?.status === "async_launched") {
      // Background agent: still running. Link it to its agent id (dropping any duplicate placeholder).
      const agentId = resp.agentId;
      setTasks(paneId, (tasks) => tasks.filter((t) => !(t.placeholder && t.agentId === agentId)).map((t) => (t.id === toolUseId ? { ...t, agentId: agentId ?? t.agentId, background: true } : t)));
      return;
    }
    const summary = resultText(data?.tool_response);
    setTasks(paneId, (tasks) => tasks.map((t) => (t.id === toolUseId && t.status === "running" ? { ...t, status: "done", endedAt: now, doing: undefined, summary: summary ?? t.summary } : t)));
  } else if (event === "SubagentStop") {
    // Claude also runs small internal agents (no type); only stop the card this agent belongs to.
    const type = str(data?.agent_type);
    const summary = str(data?.last_assistant_message);
    const transcript = str(data?.agent_transcript_path);
    let matchedId: string | undefined;
    setTasks(paneId, (tasks) => {
      let i = tasks.findIndex((t) => eventAgentId && t.agentId === eventAgentId);
      if (i < 0 && type) i = tasks.findIndex((t) => t.kind === "agent" && t.status === "running" && t.type === type && !t.agentId);
      if (i < 0) return tasks;
      matchedId = tasks[i].id;
      return tasks.map((t, j) => (j === i ? { ...t, status: "done", endedAt: now, doing: undefined, summary: summary ?? t.summary } : t));
    });
    // The final answer lives in the subagent's own transcript.
    if (matchedId && !summary && transcript) {
      const id = matchedId;
      const fetchAnswer = (retry: boolean) =>
        void ipc.subagentResult(transcript).then((text) => {
          if (text) setTasks(paneId, (tasks) => tasks.map((t) => (t.id === id ? { ...t, summary: text } : t)));
          else if (retry) setTimeout(() => fetchAnswer(false), 2000); // transcript may still be flushing
        });
      fetchAnswer(true);
    }
  } else if (event === "SessionEnd") {
    setTasks(paneId, (tasks) => tasks.map((t) => (t.status === "running" ? { ...t, status: "done", endedAt: now } : t)));
  }
}

/**
 * Background commands (and background agents) end without a hook event: Claude Code only writes a
 * finish notice into the transcript. Every few seconds, read the new part of each transcript that
 * still has background work running and mark what has finished.
 */
export function startBackgroundWatch() {
  let busy = false;
  setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      const panes = Object.values(useStore.getState().panes).filter((p) => p.transcriptPath && p.bgTasks?.some((t) => t.status === "running" && (t.kind === "command" || t.background)));
      for (const pane of panes) {
        const finished = await ipc.backgroundFinished(pane.transcriptPath!).catch(() => []);
        if (!finished.length) continue;
        const byId = new Map(finished.map((f) => [f.toolUseId, f]));
        const now = Date.now();
        setTasks(pane.id, (tasks) =>
          tasks.map((t) => {
            const f = t.status === "running" ? byId.get(t.id) : undefined;
            if (!f) return t;
            const outcome = f.status === "failed" || f.status === "killed" ? f.status : "completed";
            // An agent's own answer (from SubagentStop) beats the one-line notice.
            return { ...t, status: "done", endedAt: now, doing: undefined, outcome, outputFile: f.outputFile, summary: t.summary ?? (t.kind === "command" ? f.summary : undefined) };
          }),
        );
      }
    } finally {
      busy = false;
    }
  }, 3000);
}

// ---------- usage log ----------

const today = () => new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD

/** Adds a weekly-limit increase to today's entry, attributed to the tab's project. */
export function logUsage(pane: Pane, weekDelta: number) {
  if (weekDelta <= 0) return;
  const s = useStore.getState();
  const day = today();
  const project = folderName(pane.cwd);
  const log = [...s.usageLog];
  const last = log[log.length - 1];
  const entry: UsageDay = last?.day === day ? { ...last, byProject: { ...last.byProject } } : { day, weekPts: 0, byProject: {} };
  entry.weekPts += weekDelta;
  entry.byProject[project] = (entry.byProject[project] ?? 0) + weekDelta;
  if (last?.day === day) log[log.length - 1] = entry;
  else log.push(entry);
  s.set({ usageLog: log.slice(-60) });
}

// ---------- usage-saving hints ----------

const hinted = new Set<string>();

function once(key: string, show: () => void) {
  if (hinted.has(key)) return;
  hinted.add(key);
  show();
}

function openPane(paneId: string) {
  const s = useStore.getState();
  const tab = s.tabs.find((t) => paneIds(t.root).includes(paneId));
  if (tab) {
    s.setActiveTab(tab.id);
    s.focusPane(paneId);
  }
}

/** Suggests /compact as a conversation fills its context window. */
export function contextHint(pane: Pane, pct: number | undefined) {
  if (!useStore.getState().settings.usageTips || pct === undefined) return;
  for (const level of [60, 80]) {
    if (pct >= level) {
      once(`compact-${pane.sessionId ?? pane.id}-${level}`, () =>
        showToast(t("taskHints.compactHint", { project: folderName(pane.cwd), pct: Math.round(pct) }), "info", {
          label: t("taskHints.compactNow"),
          run: () => {
            openPane(pane.id);
            typeCommand(pane.id, "/compact", true);
          },
        }),
      );
    }
  }
}

/** Every 20 s: warn before a warm prompt cache expires, and nudge large idle conversations. */
export function startUsageHints() {
  setInterval(() => {
    const s = useStore.getState();
    if (!s.settings.usageTips) return;
    const nowSec = Date.now() / 1000;
    for (const pane of Object.values(s.panes)) {
      if (!(pane.claudeActive || pane.kind === "claude") || pane.status === "working") continue;
      const cache = pane.stats?.cache;
      const ctx = pane.stats?.contextPct ?? 0;
      if (cache?.warm && cache.expiresAt && ctx >= 10) {
        const left = cache.expiresAt - nowSec;
        if (left > 30 && left <= 75) {
          once(`cache-${pane.id}-${cache.expiresAt}`, () =>
            showToast(t("taskHints.cacheExpiring", { project: folderName(pane.cwd) }), "info", {
              label: t("common.goToTab"),
              run: () => openPane(pane.id),
            }),
          );
        }
      }
      const idleMin = pane.lastActivity ? (Date.now() - pane.lastActivity) / 60000 : 0;
      if (ctx >= 40 && idleMin >= 60) {
        once(`idle-${pane.id}-${today()}`, () =>
          showToast(t("taskHints.idleConversation", { project: folderName(pane.cwd) }), "info", {
            label: t("common.goToTab"),
            run: () => openPane(pane.id),
          }),
        );
      }
    }
  }, 20_000);
}
