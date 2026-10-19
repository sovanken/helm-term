import { useEffect, useState } from "react";
import { Gauge } from "lucide-react";
import { burnRate, formatCountdown, limitTone, minutesToLimit, timeSince } from "../lib/agents";
import { type LimitWindow, cleanTitle, folderName, useStore } from "../state/store";

/** Re-render every 30 s so countdowns stay current. */
function useTick() {
  const [, set] = useState(0);
  useEffect(() => {
    const t = setInterval(() => set((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);
}

function Meter({ label, win, hint }: { label: string; win?: LimitWindow; hint?: string }) {
  if (!win) return null;
  const pct = Math.min(100, Math.max(0, win.pct));
  const reset = formatCountdown(win.resetsAt);
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <span className="font-medium text-fg">{label}</span>
        <span className="text-[12px] text-muted tabular-nums">
          <span className="text-[15px] font-semibold text-fg">{Math.round(pct)}%</span> used{reset ? ` · resets in ${reset}` : ""}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-hover">
        <div className={`h-full rounded-full ${limitTone(pct)}`} style={{ width: `${Math.max(pct, 1.5)}%` }} />
      </div>
      {hint && <div className="mt-1.5 text-[12px] text-faint">{hint}</div>}
    </div>
  );
}

/** Full usage card: limits, pace and which tabs used it. */
export function UsageCockpit() {
  useTick();
  const usage = useStore((s) => s.usage);
  const byPane = useStore((s) => s.usageByPane);
  const panes = useStore((s) => s.panes);
  const enabled = useStore((s) => s.settings.usageCockpit);

  if (!usage) {
    return (
      <div className="rounded-xl border border-line p-4">
        <div className="mb-1 flex items-center gap-2 font-medium text-fg">
          <Gauge size={15} className="text-accent" /> Usage limits
        </div>
        <p className="text-[12px] leading-relaxed text-faint">
          {enabled
            ? "Appears after Claude's next reply in any tab. Limits are shown for Claude Pro and Max plans (and team spend limits). If you set up your own Claude status line, Helm leaves it alone and can't show limits."
            : "Turned off in Settings → Claude in Helm."}
        </p>
      </div>
    );
  }

  const rate = burnRate(usage);
  const eta = minutesToLimit(usage.fiveHour, rate);
  const paceHint =
    rate === null
      ? "Pace appears after a few minutes of work."
      : eta !== null
        ? `At this pace you'll reach the limit in about ${eta >= 60 ? `${Math.floor(eta / 60)}h ${eta % 60}m` : `${eta}m`}, before it resets.`
        : `Using about ${rate.toFixed(0)}% per hour; you won't run out before it resets.`;
  const shares = Object.entries(byPane)
    .filter(([id, v]) => panes[id] && v > 0.05)
    .sort((a, b) => b[1] - a[1]);
  const total = shares.reduce((sum, [, v]) => sum + v, 0);

  return (
    <div className="rounded-xl border border-line p-4">
      <div className="mb-4 flex items-center gap-2 font-medium text-fg">
        <Gauge size={15} className="text-accent" /> Usage limits
        <span className="ml-auto text-[11px] font-normal text-faint">updated {timeSince(usage.updatedAt)}</span>
      </div>
      <div className="space-y-4">
        <Meter label="5-hour limit" win={usage.fiveHour} hint={paceHint} />
        <Meter label="Weekly limit" win={usage.sevenDay} />
        {usage.spend && (
          <Meter
            label="Spend limit"
            win={usage.spend}
            hint={usage.spend.usedUsd !== undefined && usage.spend.limitUsd !== undefined ? `$${usage.spend.usedUsd.toFixed(2)} of $${usage.spend.limitUsd.toFixed(2)}` : undefined}
          />
        )}
      </div>
      {shares.length > 0 && (
        <div className="mt-4 border-t border-line pt-3">
          <div className="mb-2 text-[11px] font-semibold tracking-wide text-faint uppercase">Used in this 5-hour window (approx.)</div>
          {shares.map(([id, v]) => (
            <div key={id} className="mb-1.5 flex items-center gap-2 text-[12px]">
              <span className="w-40 truncate text-fg">
                {folderName(panes[id].cwd)}
                {cleanTitle(panes[id].title) ? <span className="text-faint"> · {cleanTitle(panes[id].title)}</span> : null}
              </span>
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-hover">
                <div className="h-full rounded-full bg-accent" style={{ width: `${(v / total) * 100}%` }} />
              </div>
              <span className="w-12 text-right text-muted tabular-nums">{v.toFixed(1)}%</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Compact five-hour meter for the status bar. */
export function UsageMini() {
  useTick();
  const usage = useStore((s) => s.usage);
  const win = usage?.fiveHour ?? usage?.spend;
  if (!win) return null;
  const label = usage?.fiveHour ? "5h" : "spend";
  const reset = formatCountdown(win.resetsAt);
  return (
    <button
      onClick={() => useStore.getState().openAgents()}
      title={`${Math.round(win.pct)}% of your ${label === "5h" ? "5-hour" : "spend"} limit used${reset ? `, resets in ${reset}` : ""}${usage?.sevenDay ? ` · weekly ${Math.round(usage.sevenDay.pct)}%` : ""}. Click for details.`}
      className="flex h-full items-center gap-1.5 rounded px-2 hover:bg-hover hover:text-fg"
    >
      <Gauge size={12} />
      <span className="relative h-1.5 w-10 overflow-hidden rounded-full bg-hover">
        <span className={`absolute inset-y-0 left-0 rounded-full ${limitTone(win.pct)}`} style={{ width: `${Math.max(win.pct, 2)}%` }} />
      </span>
      {label} {Math.round(win.pct)}%
    </button>
  );
}
