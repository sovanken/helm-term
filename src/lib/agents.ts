// Shared helpers for agent supervision: approvals, tool summaries and usage-limit math.

import { t } from "../i18n";
import { pair, unit } from "./format";
import { ipc } from "./ipc";
import { type Approval, type LimitWindow, type Usage, useStore } from "../state/store";

/** One line describing a tool call, e.g. "npm test" for Bash or the file for Edit. */
export function toolSummary(_tool: string, input: unknown): string {
  const i = (input ?? {}) as Record<string, unknown>;
  const pick = (k: string) => (typeof i[k] === "string" ? (i[k] as string) : undefined);
  const text = pick("command") ?? pick("file_path") ?? pick("notebook_path") ?? pick("url") ?? pick("pattern") ?? pick("query") ?? pick("description") ?? pick("prompt");
  return (text ?? "").split("\n")[0].slice(0, 200);
}

type ToolKind = "command" | "file" | "read" | "web" | "mcp" | "other";

function toolKind(tool: string): ToolKind {
  if (tool === "Bash" || tool === "PowerShell") return "command";
  if (tool === "Edit" || tool === "MultiEdit" || tool === "Write" || tool === "NotebookEdit") return "file";
  if (tool === "Read") return "read";
  if (tool === "WebFetch" || tool === "WebSearch") return "web";
  if (tool.startsWith("mcp__")) return "mcp";
  return "other";
}

/** Tool name to show: the MCP server for MCP tools, otherwise Claude's tool name. */
function toolName(tool: string) {
  return tool.startsWith("mcp__") ? tool.split("__")[1] : tool;
}

/** Friendly verb for a tool, used in "Claude wants to …". */
export function toolVerb(tool: string): string {
  const kind = toolKind(tool);
  const name = toolName(tool);
  if (kind === "mcp" && !name) return t("agentText.verb.mcpUnknown");
  return t(`agentText.verb.${kind}`, { tool: name });
}

/** Whole sentence for a waiting tab, e.g. "Wants to run a command". */
export function toolWants(tool: string): string {
  const kind = toolKind(tool);
  const name = toolName(tool);
  if (kind === "mcp" && !name) return t("agentText.wants.mcpUnknown");
  return t(`agentText.wants.${kind}`, { tool: name });
}

/** Whole sentence for an approval request, e.g. "Claude wants to run a command". */
export function toolAsks(tool: string): string {
  const kind = toolKind(tool);
  const name = toolName(tool);
  if (kind === "mcp" && !name) return t("agentText.claudeWants.mcpUnknown");
  return t(`agentText.claudeWants.${kind}`, { tool: name });
}

export type ApprovalChoice = "allow" | "always" | "deny" | "terminal";

/** Answers a pending permission request and updates the tab's status. */
export async function answerApproval(approval: Approval, choice: ApprovalChoice) {
  const decision =
    choice === "allow"
      ? { behavior: "allow" }
      : choice === "always"
        ? { behavior: "allow", updatedPermissions: approval.suggestions }
        : choice === "deny"
          ? { behavior: "deny", message: "The user denied this in Helm." }
          : null;
  const { set, updatePane } = useStore.getState();
  set({ approvals: useStore.getState().approvals.filter((a) => a.id !== approval.id) });
  await ipc.permissionRespond(approval.id, decision).catch(() => false);
  const stillWaiting = useStore.getState().approvals.some((a) => a.paneId === approval.paneId);
  if (choice !== "terminal" && !stillWaiting) updatePane(approval.paneId, { status: "working", attentionMessage: undefined });
}

/** Human-readable rule list for the "Always allow" button's tooltip. */
export function describeSuggestions(suggestions: unknown[]): string {
  const rules: string[] = [];
  for (const s of suggestions as { type?: string; rules?: { toolName: string; ruleContent?: string }[]; mode?: string; destination?: string }[]) {
    const where = s?.destination === "session" ? "session" : s?.destination === "localSettings" ? "local" : s?.destination === "projectSettings" ? "project" : s?.destination === "userSettings" ? "user" : "none";
    if (s?.rules) for (const r of s.rules) rules.push(r.ruleContent ? t(`agentText.rule.${where}`, { rule: `${r.toolName}(${r.ruleContent})` }) : t(`agentText.allTool.${where}`, { tool: r.toolName }));
    if (s?.mode === "acceptEdits") rules.push(t(`agentText.acceptEdits.${where}`));
    else if (s?.mode) rules.push(t(`agentText.switchMode.${where}`, { mode: s.mode }));
  }
  return rules.join(t("agentText.ruleSeparator"));
}

// ---------- usage ----------

export function formatCountdown(resetsAt?: number): string | null {
  if (!resetsAt) return null;
  const secs = Math.max(0, Math.round(resetsAt - Date.now() / 1000));
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  const m = Math.floor((secs % 3600) / 60);
  return d ? pair(unit.d(d), unit.h(h)) : h ? pair(unit.h(h), unit.m(m)) : unit.m(m);
}

/** Five-hour usage per hour, from the last 30 minutes of readings. */
export function burnRate(usage: Usage | null): number | null {
  const samples = usage?.samples ?? [];
  if (samples.length < 2) return null;
  const recent = samples.filter((s) => s.t > Date.now() - 30 * 60_000);
  if (recent.length < 2) return null;
  const first = recent[0];
  const last = recent[recent.length - 1];
  const hours = (last.t - first.t) / 3_600_000;
  if (hours < 2 / 60) return null;
  return Math.max(0, (last.pct - first.pct) / hours);
}

/** Minutes until the five-hour limit at the current pace, or null if it resets first / no pace. */
export function minutesToLimit(win: LimitWindow | undefined, rate: number | null): number | null {
  if (!win || !rate || rate <= 0) return null;
  const minutes = ((100 - win.pct) / rate) * 60;
  const untilReset = win.resetsAt ? (win.resetsAt - Date.now() / 1000) / 60 : Infinity;
  return minutes < untilReset ? Math.round(minutes) : null;
}

/** "just now", "5m ago", "2h 3m ago" */
export function timeSince(ms?: number): string {
  if (!ms) return "";
  const secs = (Date.now() - ms) / 1000;
  return secs < 45 ? t("agentText.justNow") : t("agentText.ago", { time: formatCountdown(Date.now() / 1000 + secs) });
}

export function limitTone(pct: number) {
  return pct >= 90 ? "bg-danger" : pct >= 70 ? "bg-attention" : "bg-accent";
}
