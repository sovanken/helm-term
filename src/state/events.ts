// Backend events: Claude Code hook reports, permission requests, status-line data, terminal exits.

import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow, UserAttentionType } from "@tauri-apps/api/window";
import { toolSummary, toolVerb } from "../lib/agents";
import { ipc } from "../lib/ipc";
import { paneIds } from "../lib/layout";
import { isCurrentLaunch } from "../terminal/terminals";
import { type Approval, cleanTitle, folderName, type LimitWindow, type Pane, showToast, useStore } from "./store";

interface HookEvent {
  paneId: string;
  launchId?: string | null;
  event: string;
  data: Record<string, unknown> | null;
}

interface PermissionEvent {
  id: string;
  paneId: string;
  launchId?: string | null;
  data: Record<string, unknown> | null;
}

/** True when the user can currently see this pane. */
function isVisible(paneId: string) {
  const s = useStore.getState();
  const tab = s.tabs.find((t) => t.id === s.activeTabId);
  return document.hasFocus() && s.view === "terminal" && !!tab && paneIds(tab.root).includes(paneId);
}

type NotifyKind = "finished" | "approval" | "usage";

function notifyEnabled(kind: NotifyKind) {
  const s = useStore.getState().settings;
  if (!s.notifications) return false;
  return kind === "finished" ? s.notifyFinished : kind === "approval" ? s.notifyApproval : s.notifyUsage;
}

/** Windows notification through Helm's own toast (so the sound setting is honoured). */
async function systemNotify(kind: NotifyKind, title: string, body: string) {
  if (!notifyEnabled(kind)) return;
  const silent = !useStore.getState().settings.notifySound;
  await ipc.showToast(title, body, silent).catch(() => {});
}

async function notify(kind: NotifyKind, pane: Pane, title: string, body: string) {
  if (isVisible(pane.id)) return;
  await systemNotify(kind, title, body);
  if (!document.hasFocus()) void getCurrentWindow().requestUserAttention(UserAttentionType.Informational);
}

const str = (v: unknown) => (typeof v === "string" ? v : undefined);

function onHook({ paneId, launchId, event, data }: HookEvent) {
  const { panes, updatePane } = useStore.getState();
  const pane = panes[paneId];
  if (!pane || !isCurrentLaunch(paneId, launchId)) return;
  const cwd = str(data?.cwd);
  const transcriptPath = str(data?.transcript_path);
  if (transcriptPath && transcriptPath !== pane.transcriptPath) updatePane(paneId, { transcriptPath });
  if (event === "PostToolUse" || event === "Stop" || event === "SessionStart" || event === "UserPromptSubmit") {
    useStore.setState((s) => ({ activity: s.activity + 1 }));
  }
  const where = folderName(cwd ?? pane.cwd);
  const now = Date.now();
  const mode = str(data?.permission_mode);
  if (mode && mode !== pane.permissionMode) updatePane(paneId, { permissionMode: mode });

  switch (event) {
    case "SessionStart":
      updatePane(paneId, {
        claudeActive: true,
        status: "idle",
        sessionId: str(data?.session_id) ?? pane.sessionId,
        lastActivity: now,
        subagents: 0,
        ...(cwd ? { cwd } : {}),
      });
      break;
    case "SessionEnd":
      // Claude was closed in this pane, so a restored tab should not reopen it.
      updatePane(paneId, { kind: "shell", claudeActive: false, status: "idle", attentionMessage: undefined, doing: undefined, subagents: 0 });
      break;
    case "UserPromptSubmit":
      updatePane(paneId, { claudeActive: true, status: "working", attentionMessage: undefined, doing: "Thinking", lastActivity: now });
      break;
    case "PreToolUse": {
      const tool = str(data?.tool_name) ?? "a tool";
      const summary = toolSummary(tool, data?.tool_input);
      updatePane(paneId, { claudeActive: true, status: "working", attentionMessage: undefined, doing: summary ? `${tool}: ${summary}` : tool, lastActivity: now });
      break;
    }
    case "PostToolUse":
      updatePane(paneId, { claudeActive: true, status: pane.status === "attention" ? "working" : pane.status === "done" ? "done" : "working", lastActivity: now });
      break;
    case "SubagentStart":
      updatePane(paneId, { subagents: (pane.subagents ?? 0) + 1, lastActivity: now });
      break;
    case "SubagentStop":
      updatePane(paneId, { subagents: Math.max(0, (pane.subagents ?? 1) - 1), lastActivity: now });
      break;
    case "Notification": {
      const message = str(data?.message) ?? "Claude is waiting for you";
      const type = str(data?.notification_type) ?? "";
      // The idle reminder repeats "waiting for your input" after a finished turn; that is not new.
      if (type === "idle_prompt" || /waiting for your input/i.test(message)) break;
      // Permission prompts that Helm already holds are shown in the approval inbox instead.
      if (type === "permission_prompt" && useStore.getState().approvals.some((a) => a.paneId === paneId)) break;
      updatePane(paneId, { status: "attention", attentionMessage: message, lastActivity: now });
      void notify("approval", pane, `Claude needs you · ${where}`, message);
      break;
    }
    case "Stop": {
      const seen = isVisible(paneId);
      updatePane(paneId, { status: seen ? "idle" : "done", attentionMessage: undefined, doing: undefined, lastActivity: now });
      void notify("finished", pane, `Claude finished · ${where}`, cleanTitle(pane.title) || "Ready for your next message");
      break;
    }
    case "StopFailure": {
      const reason = str(data?.error_type) ?? str(data?.reason) ?? "an error";
      const message = reason === "rate_limit" ? "Usage limit reached" : `Stopped: ${reason.replace(/_/g, " ")}`;
      updatePane(paneId, { status: "attention", attentionMessage: message, doing: undefined, lastActivity: now });
      void notify("finished", pane, `Claude stopped · ${where}`, message);
      break;
    }
  }
}

// ---------- approvals ----------

function onPermission({ id, paneId, launchId, data }: PermissionEvent) {
  const s = useStore.getState();
  const pane = s.panes[paneId];
  // Requests from the tab you're looking at stay in the terminal, exactly like plain Claude Code.
  if (!pane || !isCurrentLaunch(paneId, launchId) || !s.settings.approvals || isVisible(paneId)) {
    void ipc.permissionRespond(id, null);
    return;
  }
  const tool = str(data?.tool_name) ?? "a tool";
  const approval: Approval = {
    id,
    paneId,
    tool,
    summary: toolSummary(tool, data?.tool_input),
    input: data?.tool_input,
    suggestions: Array.isArray(data?.permission_suggestions) ? (data!.permission_suggestions as unknown[]) : [],
    at: Date.now(),
  };
  s.set({ approvals: [...s.approvals, approval] });
  const where = folderName(pane.cwd);
  s.updatePane(paneId, { status: "attention", attentionMessage: `Wants to ${toolVerb(tool)}`, lastActivity: Date.now() });

  if (!document.hasFocus()) {
    void getCurrentWindow().requestUserAttention(UserAttentionType.Critical);
    if (notifyEnabled("approval")) {
      ipc
        .showApprovalToast(id, `Claude wants to ${toolVerb(tool)}`, `${where}${cleanTitle(pane.title) ? ` · ${cleanTitle(pane.title)}` : ""}`, approval.summary || tool, !s.settings.notifySound)
        .catch(() => void systemNotify("approval", `Claude needs approval · ${where}`, approval.summary || tool));
    }
  }
}

function onPermissionResolved(id: string) {
  const s = useStore.getState();
  const approval = s.approvals.find((a) => a.id === id);
  if (!approval) return;
  // Answered from the Windows notification, or timed out (Claude then asks in the terminal).
  s.set({ approvals: s.approvals.filter((a) => a.id !== id) });
  if (!s.approvals.some((a) => a.id !== id && a.paneId === approval.paneId)) {
    s.updatePane(approval.paneId, { status: "working", attentionMessage: undefined });
  }
}

// ---------- usage (status line) ----------

const warned = new Set<string>();

function readWindow(v: unknown): LimitWindow | undefined {
  const w = v as { used_percentage?: number; resets_at?: number } | undefined;
  return typeof w?.used_percentage === "number" ? { pct: w.used_percentage, resetsAt: w.resets_at } : undefined;
}

function onStatus({ paneId, launchId, data }: HookEvent) {
  const s = useStore.getState();
  const pane = s.panes[paneId];
  if (!pane || !data || !isCurrentLaunch(paneId, launchId)) return;
  const d = data as Record<string, any>;
  s.updatePane(paneId, {
    stats: {
      model: str(d.model?.id) ?? str(d.model?.display_name),
      contextPct: typeof d.context_window?.used_percentage === "number" ? d.context_window.used_percentage : pane.stats?.contextPct,
      costUsd: typeof d.cost?.total_cost_usd === "number" ? d.cost.total_cost_usd : undefined,
      linesAdded: d.cost?.total_lines_added,
      linesRemoved: d.cost?.total_lines_removed,
      effort: str(d.effort?.level),
      thinking: typeof d.thinking?.enabled === "boolean" ? d.thinking.enabled : undefined,
      fastMode: typeof d.fast_mode === "boolean" ? d.fast_mode : undefined,
      cache: d.prompt_cache
        ? {
            warm: !!d.prompt_cache.warm,
            observed: !!d.prompt_cache.caching_observed,
            expiresAt: typeof d.prompt_cache.expires_at === "number" ? d.prompt_cache.expires_at : undefined,
            ttl: str(d.prompt_cache.ttl),
            hitRatio: typeof d.prompt_cache.hit_ratio === "number" ? d.prompt_cache.hit_ratio : undefined,
          }
        : pane.stats?.cache,
      pr: typeof d.pr?.number === "number" ? { number: d.pr.number, url: str(d.pr.url), reviewState: str(d.pr.review_state), kind: str(d.pr.kind) } : undefined,
      task: str(d.worktree?.name) ?? str(d.workspace?.git_worktree),
      durationMs: typeof d.cost?.total_duration_ms === "number" ? d.cost.total_duration_ms : undefined,
    },
  });

  const fiveHour = readWindow(d.rate_limits?.five_hour);
  const sevenDay = readWindow(d.rate_limits?.seven_day);
  const spendRaw = d.rate_limits?.spend_limit;
  const spend = readWindow(spendRaw);
  if (!fiveHour && !sevenDay && !spend) return;

  const prev = s.usage;
  const sameWindow = prev?.fiveHour?.resetsAt === fiveHour?.resetsAt;
  // Attribute five-hour increases to the tab that reported them (approximate per-tab share).
  let usageByPane = sameWindow ? s.usageByPane : {};
  if (fiveHour && prev?.fiveHour && sameWindow && fiveHour.pct > prev.fiveHour.pct) {
    usageByPane = { ...usageByPane, [paneId]: (usageByPane[paneId] ?? 0) + (fiveHour.pct - prev.fiveHour.pct) };
  }
  const samples = [...(sameWindow ? (prev?.samples ?? []) : []), ...(fiveHour ? [{ t: Date.now(), pct: fiveHour.pct }] : [])]
    .filter((x) => x.t > Date.now() - 60 * 60_000)
    .slice(-120);
  s.set({
    usage: {
      fiveHour,
      sevenDay,
      spend: spend ? { ...spend, usedUsd: spendRaw?.used_usd, limitUsd: spendRaw?.limit_usd } : undefined,
      updatedAt: Date.now(),
      samples,
    },
    usageByPane,
  });

  // Warn once per window before the limit is reached.
  for (const [label, win] of [["5-hour", fiveHour], ["weekly", sevenDay]] as const) {
    if (!win) continue;
    for (const level of [80, 95]) {
      const key = `${label}-${level}-${win.resetsAt ?? ""}`;
      if (win.pct >= level && !warned.has(key)) {
        warned.add(key);
        const text = `You've used ${Math.round(win.pct)}% of your ${label} Claude limit.`;
        showToast(text, level >= 95 ? "error" : "info", { label: "Details", run: () => useStore.getState().openAgents() });
        void systemNotify("usage", "Claude usage limit", text);
      }
    }
  }
}

export async function initEvents() {
  await listen<HookEvent>("claude-hook", (e) => onHook(e.payload));
  await listen<PermissionEvent>("permission-request", (e) => onPermission(e.payload));
  await listen<{ id: string }>("permission-resolved", (e) => onPermissionResolved(e.payload.id));
  await listen<HookEvent>("claude-status", (e) => onStatus(e.payload));
  await listen<{ paneId: string }>("pty-exit", (e) => useStore.getState().closePane(e.payload.paneId));
  window.addEventListener("focus", () => useStore.getState().markSeen());
}

