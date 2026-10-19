import { type ReactNode, useEffect, useMemo, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  LayoutDashboard, Globe,
  ArrowDown,
  ArrowUp,
  
  Brain,
  Cpu,
  Database,
  Folder,
  Gauge,
  GitBranch,
  GitPullRequest,
  Layers,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  SquareTerminal,
} from "lucide-react";
import { formatCountdown, limitTone } from "../lib/agents";
import { ipc, type SessionStats } from "../lib/ipc";
import { shellLabel, useShells } from "../lib/shells";
import { activePane, folderName, useStore } from "../state/store";
import { readBuffer, typeCommand } from "../terminal/terminals";
import { Menu, type MenuItem } from "./Menu";

/** "claude-opus-5-5" → "Opus 5.5" */
export function modelLabel(model?: string) {
  if (!model) return null;
  const m = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-|\[|$)/.exec(model);
  if (!m) return model;
  return `${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}${m[3] ? `.${m[3]}` : ""}`;
}

function formatTokens(n: number) {
  return n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n);
}

/** Every status bar item, in display order, with the label used in the right-click menu. */
export const STATUS_ITEMS = [
  { id: "state", label: "Claude state", side: "left" },
  { id: "folder", label: "Folder", side: "left" },
  { id: "git", label: "Git branch, changes, push/pull", side: "left" },
  { id: "pr", label: "Pull request", side: "left" },
  { id: "task", label: "Parallel task", side: "left" },
  { id: "mode", label: "Permission mode", side: "left" },
  { id: "agents", label: "Other tabs", side: "right" },
  { id: "cache", label: "Prompt cache timer", side: "right" },
  { id: "effort", label: "Effort level", side: "right" },
  { id: "usage", label: "Usage limits", side: "right" },
  { id: "cost", label: "Cost and lines changed", side: "right" },
  { id: "context", label: "Context used", side: "right" },
  { id: "model", label: "Model", side: "right" },
] as const;

type ItemId = (typeof STATUS_ITEMS)[number]["id"];

const STATE_TEXT = { working: "Working", attention: "Needs you", done: "Finished", idle: "Ready" } as const;

const MODES: Record<string, { label: string; tone: string; danger?: boolean }> = {
  default: { label: "Ask first", tone: "text-muted" },
  manual: { label: "Ask first", tone: "text-muted" },
  acceptEdits: { label: "Accept edits", tone: "text-working" },
  plan: { label: "Plan only", tone: "text-done" },
  auto: { label: "Auto", tone: "text-accent" },
  dontAsk: { label: "Don't ask", tone: "text-attention" },
  bypassPermissions: { label: "Bypass", tone: "text-danger", danger: true },
};

/** Claude's footer shows the mode right after a Shift+Tab, before any hook reports it. */
function modeFromScreen(text: string): string | undefined {
  const tail = text.split("\n").slice(-8).join("\n").toLowerCase();
  if (tail.includes("bypass permissions on")) return "bypassPermissions";
  if (tail.includes("accept edits on")) return "acceptEdits";
  if (tail.includes("plan mode on")) return "plan";
  if (tail.includes("auto mode on")) return "auto";
  if (tail.includes("manual mode on") || tail.includes("? for shortcuts")) return "default";
  return undefined;
}

function useTick(ms: number) {
  const [, set] = useState(0);
  useEffect(() => {
    const t = setInterval(() => set((n) => n + 1), ms);
    return () => clearInterval(t);
  }, [ms]);
}

/** One chip: thin border, small icon, bold label, muted hint. */
function Chip({
  icon,
  children,
  hint,
  title,
  onClick,
  tone = "",
  strong = true,
}: {
  icon?: ReactNode;
  children: ReactNode;
  hint?: ReactNode;
  title?: string;
  onClick?: () => void;
  tone?: string;
  strong?: boolean;
}) {
  const cls = `flex h-[22px] shrink-0 items-center gap-1.5 rounded-md border border-line bg-surface px-2 text-[12px] leading-none whitespace-nowrap ${
    onClick ? "cursor-pointer hover:border-faint hover:bg-raised" : "cursor-default"
  }`;
  const body = (
    <>
      {icon && <span className={`flex items-center ${tone || "text-muted"}`}>{icon}</span>}
      <span className={`${strong ? "font-semibold" : ""} text-fg`}>{children}</span>
      {hint && <span className="text-faint">{hint}</span>}
    </>
  );
  return onClick ? (
    <button title={title} onClick={onClick} className={cls}>
      {body}
    </button>
  ) : (
    <span title={title} className={cls}>
      {body}
    </span>
  );
}

function Meter({ pct, className = "w-10" }: { pct: number; className?: string }) {
  return (
    <span className={`relative h-1.5 overflow-hidden rounded-full bg-hover ${className}`}>
      <span className={`absolute inset-y-0 left-0 rounded-full ${limitTone(pct)}`} style={{ width: `${Math.max(Math.min(pct, 100), 2)}%` }} />
    </span>
  );
}

export function StatusBar() {
  useTick(15_000);
  const activeTabId = useStore((s) => s.activeTabId);
  const panes = useStore((s) => s.panes);
  const activity = useStore((s) => s.activity);
  const usage = useStore((s) => s.usage);
  const approvals = useStore((s) => s.approvals);
  const hidden = useStore((s) => s.settings.hiddenStatusItems);
  const pane = useMemo(() => activePane(), [activeTabId, panes]);
  const [stats, setStats] = useState<SessionStats | null>(null);
  const [git, setGit] = useState<{ branch?: string; changed: number; ahead?: number; behind?: number } | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const shells = useShells();

  const claude = !!pane && (pane.claudeActive || pane.kind === "claude");
  const cwd = pane?.cwd;
  const sessionKey = pane ? `${pane.transcriptPath ?? ""}|${pane.sessionId ?? ""}` : "";

  useEffect(() => {
    if (!cwd) return setGit(null);
    let alive = true;
    const load = () => void ipc.gitSummary(cwd).then((g) => alive && setGit(g)).catch(() => {});
    load();
    const t = setInterval(() => document.hasFocus() && load(), 6000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [cwd, activity]);

  // Transcript fallback for sessions whose status line Helm doesn't receive.
  useEffect(() => {
    if (!pane || !claude || (!pane.transcriptPath && !pane.sessionId)) return setStats(null);
    let alive = true;
    const t = setTimeout(() => {
      void ipc.sessionStats(pane.transcriptPath, pane.sessionId).then((s) => alive && setStats(s)).catch(() => {});
    }, 400);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [sessionKey, claude, activity]);

  const show = (id: ItemId) => !hidden.includes(id);
  const toggle = (id: string) => {
    const s = useStore.getState();
    const list = s.settings.hiddenStatusItems;
    s.updateSettings({ hiddenStatusItems: list.includes(id) ? list.filter((x) => x !== id) : [...list, id] });
  };
  const menuItems: MenuItem[] = STATUS_ITEMS.map((it, i) => ({
    label: it.label,
    checked: !hidden.includes(it.id),
    keepOpen: true,
    heading: i === 0 ? "Show in status bar" : undefined,
    onSelect: () => toggle(it.id),
  }));

  const footer = "flex h-[30px] shrink-0 items-center gap-1 bg-bg px-2 text-[12px] text-muted";
  if (!pane) return <footer className={footer} />;

  const live = pane.stats;
  const pct =
    live?.contextPct != null
      ? Math.round(live.contextPct)
      : stats && stats.contextWindow
        ? Math.min(100, Math.round((stats.contextTokens / stats.contextWindow) * 100))
        : undefined;
  const cost = live?.costUsd ?? stats?.costUsd;
  const added = live?.linesAdded ?? stats?.linesAdded;
  const removed = live?.linesRemoved ?? stats?.linesRemoved;
  const model = live?.model ?? stats?.model;
  const oneM = (model ?? "").includes("[1m]") || (stats?.contextWindow ?? 0) >= 1_000_000;

  // Other Claude tabs (not this one).
  const others = Object.values(panes).filter((p) => p.id !== pane.id && (p.claudeActive || p.kind === "claude"));
  const othersWaiting = others.filter((p) => p.status === "attention" || approvals.some((a) => a.paneId === p.id)).length;
  const othersWorking = others.filter((p) => p.status === "working").length;

  const mode = pane.permissionMode ? (MODES[pane.permissionMode] ?? { label: pane.permissionMode, tone: "text-muted" }) : null;
  const cycleMode = () => {
    void ipc.write(pane.id, "\x1b[Z"); // Shift+Tab
    setTimeout(() => {
      const next = modeFromScreen(readBuffer(pane.id, 30));
      if (next) useStore.getState().updatePane(pane.id, { permissionMode: next });
    }, 450);
  };

  const cache = live?.cache;
  const cacheSecs = cache?.warm && cache.expiresAt ? Math.round(cache.expiresAt - Date.now() / 1000) : null;

  const reviewTone: Record<string, string> = { approved: "text-done", changes_requested: "text-danger", pending: "text-attention", draft: "text-faint" };

  return (
    <footer
      className={footer}
      onContextMenu={(e) => {
        e.preventDefault();
        setMenu({ x: e.clientX, y: e.clientY });
      }}
    >
      {/* ---- left: where you are ---- */}
      {show("state") &&
        (claude ? (
          <Chip
            icon={<Sparkles size={12} />}
            tone={pane.status === "attention" ? "text-attention" : pane.status === "working" ? "text-working" : "text-accent"}
            title="Claude in this tab"
          >
            {STATE_TEXT[pane.status]}
          </Chip>
        ) : pane.kind === "browser" ? (
          <Chip icon={<Globe size={12} />} tone={pane.page?.loading ? "text-working" : undefined}>
            {pane.page?.loading ? "Loading" : "Browser"}
          </Chip>
        ) : (
          <Chip icon={<SquareTerminal size={12} />}>{shellLabel(pane.shell ?? useStore.getState().settings.shell, shells)}</Chip>
        ))}
      {show("folder") && (
        <Chip icon={<Folder size={12} />} title={cwd} strong={false}>
          {folderName(cwd ?? "")}
        </Chip>
      )}
      {show("git") && git?.branch && (
        <Chip
          icon={<GitBranch size={12} />}
          title={`Branch ${git.branch}${git.changed ? ` · ${git.changed} uncommitted ${git.changed === 1 ? "file" : "files"}` : ""}${git.ahead ? ` · ${git.ahead} to push` : ""}${git.behind ? ` · ${git.behind} to pull` : ""}. Click for changes (Ctrl+Shift+G).`}
          onClick={() => useStore.getState().set({ changesOpen: !useStore.getState().changesOpen })}
          hint={
            git.changed || git.ahead || git.behind ? (
              <span className="flex items-center gap-1.5">
                {!!git.changed && <span className="text-attention">{git.changed} changed</span>}
                {!!git.ahead && (
                  <span className="flex items-center">
                    <ArrowUp size={11} />
                    {git.ahead}
                  </span>
                )}
                {!!git.behind && (
                  <span className="flex items-center">
                    <ArrowDown size={11} />
                    {git.behind}
                  </span>
                )}
              </span>
            ) : undefined
          }
        >
          {git.branch}
        </Chip>
      )}
      {show("pr") && live?.pr && (
        <Chip
          icon={<GitPullRequest size={12} />}
          tone={reviewTone[live.pr.reviewState ?? ""] ?? "text-muted"}
          title={live.pr.url ? `Open ${live.pr.kind === "mr" ? "merge request" : "pull request"} #${live.pr.number}` : undefined}
          onClick={live.pr.url ? () => void openUrl(live.pr!.url!) : undefined}
          hint={live.pr.reviewState?.replace("_", " ")}
        >
          {live.pr.kind === "mr" ? "MR" : "PR"} #{live.pr.number}
        </Chip>
      )}
      {show("task") && live?.task && (
        <Chip icon={<Layers size={12} />} tone="text-accent" title="This tab works in a parallel task (its own branch and folder)" hint="task">
          {live.task}
        </Chip>
      )}
      {show("mode") && claude && mode && (
        <Chip
          icon={mode.danger ? <ShieldAlert size={12} /> : <ShieldCheck size={12} />}
          tone={mode.tone}
          title="What Claude may do without asking. Click to switch mode (same as Shift+Tab in Claude)."
          onClick={cycleMode}
          hint="Shift+Tab"
        >
          {mode.label}
        </Chip>
      )}

      <div className="min-w-2 flex-1" />

      {/* ---- right: Claude numbers ---- */}
      {show("agents") && others.length > 0 && (
        <Chip
          icon={<LayoutDashboard size={12} />}
          tone={othersWaiting ? "text-attention" : othersWorking ? "text-working" : "text-muted"}
          title="Other Claude tabs. Click to open Agents (Ctrl+Shift+A)."
          onClick={() => useStore.getState().openAgents()}
          hint={othersWaiting ? undefined : `${others.length} other${others.length === 1 ? "" : "s"}`}
        >
          {othersWaiting ? `${othersWaiting} need${othersWaiting === 1 ? "s" : ""} you` : othersWorking ? `${othersWorking} working` : "All idle"}
        </Chip>
      )}
      {show("cache") && claude && cache?.observed && (
        <Chip
          icon={<Database size={12} />}
          tone={cacheSecs === null ? "text-faint" : cacheSecs < 90 ? "text-attention" : "text-done"}
          title={`Claude reuses this conversation cheaply while the cache is warm${cache.ttl ? ` (lasts ${cache.ttl} after each message)` : ""}. Continuing before it goes cold saves usage.${cache.hitRatio != null ? ` Cache hit rate: ${Math.round(cache.hitRatio * 100)}%.` : ""}`}
          hint={cacheSecs !== null ? `${formatCountdown(Date.now() / 1000 + Math.max(cacheSecs, 0))} left` : undefined}
          strong={false}
        >
          {cacheSecs === null ? "Cache cold" : "Cache warm"}
        </Chip>
      )}
      {show("effort") && claude && live?.effort && (
        <Chip icon={<Brain size={12} />} title="How hard Claude thinks. Click to change (/effort)." onClick={() => typeCommand(pane.id, "/effort", true)} hint="effort" strong={false}>
          {live.effort}
        </Chip>
      )}
      {show("usage") && (usage?.fiveHour || usage?.spend) && (
        <Chip
          icon={<Gauge size={12} />}
          title={`${usage.fiveHour ? `5-hour limit ${Math.round(usage.fiveHour.pct)}%${usage.fiveHour.resetsAt ? `, resets in ${formatCountdown(usage.fiveHour.resetsAt)}` : ""}` : ""}${usage.sevenDay ? ` · weekly ${Math.round(usage.sevenDay.pct)}%${usage.sevenDay.resetsAt ? `, resets in ${formatCountdown(usage.sevenDay.resetsAt)}` : ""}` : ""}. Click for details.`}
          onClick={() => useStore.getState().openAgents()}
          hint={usage.sevenDay ? `wk ${Math.round(usage.sevenDay.pct)}%` : undefined}
        >
          <span className="flex items-center gap-1.5">
            <Meter pct={(usage.fiveHour ?? usage.spend)!.pct} />
            {usage.fiveHour ? "5h" : "spend"} {Math.round((usage.fiveHour ?? usage.spend)!.pct)}%
          </span>
        </Chip>
      )}
      {show("cost") && claude && cost != null && (
        <Chip
          title="Session cost at API prices, and lines Claude added / removed"
          hint={
            added || removed ? (
              <span>
                <span className="text-done">+{added ?? 0}</span> <span className="text-danger">−{removed ?? 0}</span>
              </span>
            ) : undefined
          }
        >
          ${cost.toFixed(2)}
        </Chip>
      )}
      {show("context") && claude && pct != null && pct > 0 && (
        <Chip
          title={stats ? `${formatTokens(stats.contextTokens)} of ${formatTokens(stats.contextWindow)} tokens. Click to see what's using it (/context).` : `${pct}% of the context window used. Click to see what's using it (/context).`}
          onClick={() => typeCommand(pane.id, "/context", true)}
          hint="context"
        >
          <span className="flex items-center gap-1.5">
            <Meter pct={pct} className="w-12" />
            {pct}%
          </span>
        </Chip>
      )}
      {show("model") && claude && model && (
        <Chip icon={<Cpu size={12} />} title="Switch model (/model)" onClick={() => typeCommand(pane.id, "/model", true)} hint={[oneM ? "1M" : "", live?.fastMode ? "fast" : ""].filter(Boolean).join(" · ") || undefined}>
          {modelLabel(model.replace(/\[1m\]$/, ""))}
        </Chip>
      )}

      {menu && (
        <div className="fixed" style={{ left: menu.x, top: menu.y }}>
          <Menu items={menuItems} onClose={() => setMenu(null)} />
        </div>
      )}
    </footer>
  );
}
