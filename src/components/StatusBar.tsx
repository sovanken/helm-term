import { useEffect, useMemo, useState } from "react";
import { Cpu, FileDiff, GitBranch, Sparkles, SquareTerminal } from "lucide-react";
import { ipc, type SessionStats } from "../lib/ipc";
import { activePane, folderName, useStore } from "../state/store";
import { typeCommand } from "../terminal/terminals";

/** "claude-opus-5-5" → "Opus 5.5" */
export function modelLabel(model?: string) {
  if (!model) return null;
  const m = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-|$)/.exec(model);
  if (!m) return model;
  return `${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}${m[3] ? `.${m[3]}` : ""}`;
}

function formatTokens(n: number) {
  return n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n);
}

const STATUS_TEXT = { working: "Working", attention: "Needs your approval", done: "Finished", idle: "Ready" } as const;

export function StatusBar() {
  const activeTabId = useStore((s) => s.activeTabId);
  const panes = useStore((s) => s.panes);
  const activity = useStore((s) => s.activity);
  const changesOpen = useStore((s) => s.changesOpen);
  const pane = useMemo(() => activePane(), [activeTabId, panes]);
  const [stats, setStats] = useState<SessionStats | null>(null);
  const [branch, setBranch] = useState<string | null>(null);

  const claude = !!pane && (pane.claudeActive || pane.kind === "claude");
  const cwd = pane?.cwd;
  const sessionKey = pane ? `${pane.transcriptPath ?? ""}|${pane.sessionId ?? ""}` : "";

  useEffect(() => {
    if (!cwd) return setBranch(null);
    let alive = true;
    const load = () => void ipc.gitBranch(cwd).then((b) => alive && setBranch(b)).catch(() => {});
    load();
    const t = setInterval(load, 8000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [cwd]);

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

  if (!pane) return <footer className="h-6 shrink-0 bg-bg" />;

  const pct = stats && stats.contextWindow ? Math.min(100, Math.round((stats.contextTokens / stats.contextWindow) * 100)) : 0;
  const meterColor = pct >= 85 ? "bg-danger" : pct >= 65 ? "bg-attention" : "bg-accent";
  const item = "flex h-full items-center gap-1.5 px-2 rounded hover:bg-hover hover:text-fg";

  return (
    <footer className="flex h-6 shrink-0 items-center gap-0.5 bg-bg px-1.5 text-[11.5px] text-muted">
      {claude ? (
        <span className={`${item} hover:bg-transparent`}>
          <Sparkles size={12} className={pane.status === "attention" ? "text-attention" : pane.status === "working" ? "text-working" : "text-accent"} />
          {STATUS_TEXT[pane.status]}
        </span>
      ) : (
        <span className={`${item} hover:bg-transparent`}>
          <SquareTerminal size={12} /> PowerShell
        </span>
      )}
      <span className={`${item} hover:bg-transparent`} title={cwd}>
        {folderName(cwd ?? "")}
      </span>
      {branch && (
        <button className={item} title="Show changes (Ctrl+Shift+G)" onClick={() => useStore.getState().set({ changesOpen: !changesOpen })}>
          <GitBranch size={12} /> {branch}
          <FileDiff size={11} className="ml-0.5 opacity-60" />
        </button>
      )}

      <div className="flex-1" />

      {claude && stats && (
        <>
          {!!(stats.linesAdded || stats.linesRemoved) && (
            <span className={`${item} hover:bg-transparent`} title="Lines Claude added and removed this session">
              <span className="text-done">+{stats.linesAdded ?? 0}</span>
              <span className="text-danger">−{stats.linesRemoved ?? 0}</span>
            </span>
          )}
          {stats.costUsd !== undefined && (
            <span className={`${item} hover:bg-transparent`} title="Session cost at API prices (as last recorded by Claude Code)">
              ${stats.costUsd.toFixed(2)}
            </span>
          )}
          {stats.contextTokens > 0 && (
            <button
              className={item}
              title={`${formatTokens(stats.contextTokens)} of ${formatTokens(stats.contextWindow)} tokens used. Click to see what's using it (/context).`}
              onClick={() => typeCommand(pane.id, "/context", true)}
            >
              <span className="relative h-1.5 w-14 overflow-hidden rounded-full bg-hover">
                <span className={`absolute inset-y-0 left-0 rounded-full ${meterColor}`} style={{ width: `${Math.max(pct, 2)}%` }} />
              </span>
              {pct}% context
            </button>
          )}
          {stats.model && (
            <button className={item} title="Switch model (/model)" onClick={() => typeCommand(pane.id, "/model", true)}>
              <Cpu size={12} /> {modelLabel(stats.model)}
              {stats.contextWindow >= 1_000_000 && <span className="text-faint">1M</span>}
            </button>
          )}
        </>
      )}
    </footer>
  );
}
