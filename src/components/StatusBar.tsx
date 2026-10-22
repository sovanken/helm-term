import { DeviceChip } from "./DeviceChip";
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
import { useTranslation } from "react-i18next";
import { locale } from "../i18n";

/** "claude-opus-5-5" → "Opus 5.5" */
export function modelLabel(model?: string) {
  if (!model) return null;
  const m = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-|\[|$)/.exec(model);
  if (!m) return model;
  return `${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}${m[3] ? `.${m[3]}` : ""}`;
}

function formatTokens(n: number) {
  const num = (v: number, digits = 0) => v.toLocaleString(locale(), { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return n >= 1_000_000 ? `${num(n / 1_000_000, 1)}M` : n >= 1000 ? `${num(Math.round(n / 1000))}k` : num(n);
}

/** Every status bar item, in display order, with the label (translation key) used in the right-click menu. */
export const STATUS_ITEMS = [
  { id: "state", label: "statusBar.items.state", side: "left" },
  { id: "folder", label: "statusBar.items.folder", side: "left" },
  { id: "device", label: "statusBar.items.device", side: "left" },
  { id: "git", label: "statusBar.items.git", side: "left" },
  { id: "pr", label: "statusBar.items.pr", side: "left" },
  { id: "task", label: "statusBar.items.task", side: "left" },
  { id: "mode", label: "statusBar.items.mode", side: "left" },
  { id: "agents", label: "statusBar.items.agents", side: "right" },
  { id: "cache", label: "statusBar.items.cache", side: "right" },
  { id: "effort", label: "statusBar.items.effort", side: "right" },
  { id: "usage", label: "statusBar.items.usage", side: "right" },
  { id: "cost", label: "statusBar.items.cost", side: "right" },
  { id: "context", label: "statusBar.items.context", side: "right" },
  { id: "model", label: "statusBar.items.model", side: "right" },
] as const;

type ItemId = (typeof STATUS_ITEMS)[number]["id"];

const STATE_TEXT = { working: "statusBar.state.working", attention: "statusBar.state.attention", done: "statusBar.state.done", idle: "statusBar.state.idle" } as const;

/** `label` is a translation key. */
const MODES: Record<string, { label: string; tone: string; danger?: boolean }> = {
  default: { label: "statusBar.mode.askFirst", tone: "text-muted" },
  manual: { label: "statusBar.mode.askFirst", tone: "text-muted" },
  acceptEdits: { label: "statusBar.mode.acceptEdits", tone: "text-working" },
  plan: { label: "statusBar.mode.plan", tone: "text-done" },
  auto: { label: "statusBar.mode.auto", tone: "text-accent" },
  dontAsk: { label: "statusBar.mode.dontAsk", tone: "text-attention" },
  bypassPermissions: { label: "statusBar.mode.bypass", tone: "text-danger", danger: true },
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
  const { t } = useTranslation();
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
    const timer = setInterval(() => document.hasFocus() && load(), 6000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [cwd, activity]);

  // Transcript fallback for sessions whose status line Helm doesn't receive.
  useEffect(() => {
    if (!pane || !claude || (!pane.transcriptPath && !pane.sessionId)) return setStats(null);
    let alive = true;
    const timer = setTimeout(() => {
      void ipc.sessionStats(pane.transcriptPath, pane.sessionId).then((s) => alive && setStats(s)).catch(() => {});
    }, 400);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [sessionKey, claude, activity]);

  const show = (id: ItemId) => !hidden.includes(id);
  const toggle = (id: string) => {
    const s = useStore.getState();
    const list = s.settings.hiddenStatusItems;
    s.updateSettings({ hiddenStatusItems: list.includes(id) ? list.filter((x) => x !== id) : [...list, id] });
  };
  const menuItems: MenuItem[] = STATUS_ITEMS.map((it, i) => ({
    label: t(it.label),
    checked: !hidden.includes(it.id),
    keepOpen: true,
    heading: i === 0 ? t("statusBar.menuHeading") : undefined,
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

  const known = pane.permissionMode ? MODES[pane.permissionMode] : undefined;
  const mode = pane.permissionMode ? (known ? { ...known, label: t(known.label) } : { label: pane.permissionMode, tone: "text-muted" }) : null;
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
            title={t("statusBar.claudeHere")}
          >
            {t(STATE_TEXT[pane.status])}
          </Chip>
        ) : pane.kind === "browser" ? (
          <Chip icon={<Globe size={12} />} tone={pane.page?.loading ? "text-working" : undefined}>
            {pane.page?.loading ? t("common.loading") : t("statusBar.browser")}
          </Chip>
        ) : (
          <Chip icon={<SquareTerminal size={12} />}>{shellLabel(pane.shell ?? useStore.getState().settings.shell, shells)}</Chip>
        ))}
      {show("folder") && (
        <Chip icon={<Folder size={12} />} title={cwd} strong={false}>
          {folderName(cwd ?? "")}
        </Chip>
      )}
      {show("device") && <DeviceChip />}
      {show("git") && git?.branch && (
        <Chip
          icon={<GitBranch size={12} />}
          title={t("statusBar.git.title", {
            details: [
              t("statusBar.git.branch", { branch: git.branch }),
              git.changed ? t("statusBar.git.uncommitted", { count: git.changed }) : "",
              git.ahead ? t("statusBar.git.toPush", { count: git.ahead }) : "",
              git.behind ? t("statusBar.git.toPull", { count: git.behind }) : "",
            ]
              .filter(Boolean)
              .join(" · "),
          })}
          onClick={() => useStore.getState().set({ changesOpen: !useStore.getState().changesOpen })}
          hint={
            git.changed || git.ahead || git.behind ? (
              <span className="flex items-center gap-1.5">
                {!!git.changed && <span className="text-attention">{t("statusBar.git.changed", { count: git.changed })}</span>}
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
          title={live.pr.url ? (live.pr.kind === "mr" ? t("statusBar.pr.openMr", { number: live.pr.number }) : t("statusBar.pr.openPr", { number: live.pr.number })) : undefined}
          onClick={live.pr.url ? () => void openUrl(live.pr!.url!) : undefined}
          hint={live.pr.reviewState ? t(`statusBar.pr.review.${live.pr.reviewState}`, { defaultValue: live.pr.reviewState.replace("_", " ") }) : undefined}
        >
          {live.pr.kind === "mr" ? t("statusBar.pr.mr", { number: live.pr.number }) : t("statusBar.pr.pr", { number: live.pr.number })}
        </Chip>
      )}
      {show("task") && live?.task && (
        <Chip icon={<Layers size={12} />} tone="text-accent" title={t("statusBar.task.title")} hint={t("statusBar.task.hint")}>
          {live.task}
        </Chip>
      )}
      {show("mode") && claude && mode && (
        <Chip
          icon={mode.danger ? <ShieldAlert size={12} /> : <ShieldCheck size={12} />}
          tone={mode.tone}
          title={t("statusBar.mode.title")}
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
          title={t("statusBar.agents.title")}
          onClick={() => useStore.getState().openAgents()}
          hint={othersWaiting ? undefined : t("statusBar.agents.others", { count: others.length })}
        >
          {othersWaiting ? t("statusBar.agents.needYou", { count: othersWaiting }) : othersWorking ? t("statusBar.agents.working", { count: othersWorking }) : t("statusBar.agents.allIdle")}
        </Chip>
      )}
      {show("cache") && claude && cache?.observed && (
        <Chip
          icon={<Database size={12} />}
          tone={cacheSecs === null ? "text-faint" : cacheSecs < 90 ? "text-attention" : "text-done"}
          title={`${cache.ttl ? t("statusBar.cache.titleTtl", { ttl: cache.ttl }) : t("statusBar.cache.title")}${cache.hitRatio != null ? ` ${t("statusBar.cache.hitRate", { pct: Math.round(cache.hitRatio * 100) })}` : ""}`}
          hint={cacheSecs !== null ? t("statusBar.cache.left", { time: formatCountdown(Date.now() / 1000 + Math.max(cacheSecs, 0)) }) : undefined}
          strong={false}
        >
          {cacheSecs === null ? t("statusBar.cache.cold") : t("statusBar.cache.warm")}
        </Chip>
      )}
      {show("effort") && claude && live?.effort && (
        <Chip icon={<Brain size={12} />} title={t("statusBar.effort.title")} onClick={() => typeCommand(pane.id, "/effort", true)} hint={t("statusBar.effort.hint")} strong={false}>
          {live.effort}
        </Chip>
      )}
      {show("usage") && (usage?.fiveHour || usage?.spend) && (
        <Chip
          icon={<Gauge size={12} />}
          title={t("statusBar.usage.title", {
            details: [
              usage.fiveHour
                ? usage.fiveHour.resetsAt
                  ? t("statusBar.usage.fiveHourResets", { pct: Math.round(usage.fiveHour.pct), time: formatCountdown(usage.fiveHour.resetsAt) })
                  : t("statusBar.usage.fiveHour", { pct: Math.round(usage.fiveHour.pct) })
                : "",
              usage.sevenDay
                ? usage.sevenDay.resetsAt
                  ? t("statusBar.usage.weeklyResets", { pct: Math.round(usage.sevenDay.pct), time: formatCountdown(usage.sevenDay.resetsAt) })
                  : t("statusBar.usage.weekly", { pct: Math.round(usage.sevenDay.pct) })
                : "",
            ]
              .filter(Boolean)
              .join(" · "),
          })}
          onClick={() => useStore.getState().openAgents()}
          hint={usage.sevenDay ? t("statusBar.usage.week", { pct: Math.round(usage.sevenDay.pct) }) : undefined}
        >
          <span className="flex items-center gap-1.5">
            <Meter pct={(usage.fiveHour ?? usage.spend)!.pct} />
            {t(usage.fiveHour ? "statusBar.usage.fiveHourShort" : "statusBar.usage.spendShort", { pct: Math.round((usage.fiveHour ?? usage.spend)!.pct) })}
          </span>
        </Chip>
      )}
      {show("cost") && claude && cost != null && (
        <Chip
          title={t("statusBar.cost.title")}
          hint={
            added || removed ? (
              <span>
                <span className="text-done">+{added ?? 0}</span> <span className="text-danger">−{removed ?? 0}</span>
              </span>
            ) : undefined
          }
        >
          {cost.toLocaleString(locale(), { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </Chip>
      )}
      {show("context") && claude && pct != null && pct > 0 && (
        <Chip
          title={stats ? t("statusBar.context.titleTokens", { used: formatTokens(stats.contextTokens), total: formatTokens(stats.contextWindow) }) : t("statusBar.context.titlePct", { pct })}
          onClick={() => typeCommand(pane.id, "/context", true)}
          hint={t("statusBar.context.hint")}
        >
          <span className="flex items-center gap-1.5">
            <Meter pct={pct} className="w-12" />
            {pct}%
          </span>
        </Chip>
      )}
      {show("model") && claude && model && (
        <Chip icon={<Cpu size={12} />} title={t("statusBar.model.title")} onClick={() => typeCommand(pane.id, "/model", true)} hint={[oneM ? "1M" : "", live?.fastMode ? t("statusBar.model.fast") : ""].filter(Boolean).join(" · ") || undefined}>
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
