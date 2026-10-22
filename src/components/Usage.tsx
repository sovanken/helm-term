import { useEffect, useState } from "react";
import { Gauge } from "lucide-react";
import { useTranslation } from "react-i18next";
import { locale, t } from "../i18n";
import { burnRate, formatCountdown, limitTone, minutesToLimit, timeSince } from "../lib/agents";
import { clock } from "../lib/format";
import { type LimitWindow, cleanTitle, folderName, useStore } from "../state/store";

/** Re-render every 30 s so countdowns stay current. */
function useTick() {
  const [, set] = useState(0);
  useEffect(() => {
    const t = setInterval(() => set((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);
}

const WEEK = 7 * 24 * 3600;

/** "seven_day_opus" → "Weekly · Opus" */
function windowLabel(key: string) {
  const model = key.replace(/^(five_hour|seven_day)_?/, "").replace(/_/g, " ");
  const base = key.startsWith("five_hour") ? t("usage.window.fiveHour") : key.startsWith("seven_day") ? t("usage.window.weekly") : key.replace(/_/g, " ");
  return model && model !== key ? `${base} · ${model.charAt(0).toUpperCase()}${model.slice(1)}` : base;
}

function Meter({ label, sub, win, hint }: { label: string; sub?: string; win?: LimitWindow; hint?: string }) {
  const { t } = useTranslation();
  if (!win) return null;
  const pct = Math.min(100, Math.max(0, win.pct));
  const reset = formatCountdown(win.resetsAt);
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <span className="min-w-0">
          <span className="font-medium text-fg">{label}</span>
          {sub && <span className="ml-1.5 text-[11.5px] text-faint">{sub}</span>}
        </span>
        <span className="shrink-0 text-[15px] font-semibold text-fg tabular-nums">{Math.round(pct)}%</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-hover">
        <div className={`h-full rounded-full ${limitTone(pct)}`} style={{ width: `${Math.max(pct, win.idle ? 0 : 1.5)}%` }} />
      </div>
      <div className="mt-1.5 flex flex-wrap justify-between gap-x-3 text-[11.5px] text-faint">
        <span>{win.idle ? t("usage.startsWithNextMessage") : hint}</span>
        {reset && !win.idle && (
          <span className="tabular-nums" title={new Date((win.resetsAt ?? 0) * 1000).toLocaleString(locale())}>
            {t("usage.resetsIn", { time: reset, clock: clock(win.resetsAt) })}
          </span>
        )}
      </div>
    </div>
  );
}

/** Weekly pace: how much was used compared with an even spread over the week. */
function weeklyHint(win?: LimitWindow) {
  if (!win?.resetsAt || win.idle) return undefined;
  const elapsed = Math.min(1, Math.max(0, 1 - (win.resetsAt - Date.now() / 1000) / WEEK));
  if (elapsed < 0.02) return t("usage.pace.weekJustStarted");
  const even = elapsed * 100;
  const diff = win.pct - even;
  if (Math.abs(diff) < 5) return t("usage.pace.even", { pct: Math.round(even) });
  return diff > 0 ? t("usage.pace.ahead", { count: Math.round(diff) }) : t("usage.pace.under", { count: Math.round(-diff) });
}

/** Full usage card, like Claude Code's /usage: every limit, reset times, pace and who used it. */
export function UsageCockpit() {
  const { t } = useTranslation();
  useTick();
  const usage = useStore((s) => s.usage);
  const byPane = useStore((s) => s.usageByPane);
  const panes = useStore((s) => s.panes);
  const enabled = useStore((s) => s.settings.usageCockpit);

  if (!usage) {
    return (
      <div className="rounded-xl border border-line p-4">
        <div className="mb-1 flex items-center gap-2 font-medium text-fg">
          <Gauge size={15} className="text-accent" /> {t("usage.title")}
        </div>
        <p className="text-[12px] leading-relaxed text-faint">
          {enabled
            ? t("usage.notYet")
            : t("usage.turnedOff")}
        </p>
      </div>
    );
  }

  const rate = burnRate(usage);
  const eta = minutesToLimit(usage.fiveHour, rate);
  const fiveHint =
    rate === null
      ? t("usage.pace.soon")
      : eta !== null
        ? t("usage.pace.eta", { time: eta >= 60 ? t("usage.duration.hoursMinutes", { h: Math.floor(eta / 60), m: eta % 60 }) : t("usage.duration.minutes", { m: eta }) })
        : t("usage.pace.perHour", { rate: rate.toFixed(0) });
  const shares = Object.entries(byPane)
    .filter(([id, v]) => panes[id] && v > 0.05)
    .sort((a, b) => b[1] - a[1]);
  const total = shares.reduce((sum, [, v]) => sum + v, 0);

  return (
    <div className="rounded-xl border border-line bg-raised/40 p-4">
      <div className="mb-4 flex items-center gap-2 font-medium text-fg">
        <Gauge size={15} className="text-accent" /> {t("usage.title")}
        <span className="ml-auto text-[11px] font-normal text-faint">{t("usage.updated", { ago: timeSince(usage.updatedAt) })}</span>
      </div>
      <div className="space-y-4">
        <Meter label={t("usage.fiveHourLimit")} sub={t("usage.currentSession")} win={usage.fiveHour} hint={fiveHint} />
        <Meter label={t("usage.weeklyLimit")} sub={t("usage.allModels")} win={usage.sevenDay} hint={weeklyHint(usage.sevenDay)} />
        {Object.entries(usage.other ?? {}).map(([key, win]) => (
          <Meter key={key} label={windowLabel(key)} win={win} hint={key.startsWith("seven_day") ? weeklyHint(win) : undefined} />
        ))}
        {usage.spend && (
          <Meter
            label={t("usage.spendLimit")}
            win={usage.spend}
            hint={usage.spend.usedUsd != null && usage.spend.limitUsd != null ? t("usage.spendOf", { used: usage.spend.usedUsd.toFixed(2), limit: usage.spend.limitUsd.toFixed(2) }) : undefined}
          />
        )}
      </div>
      {shares.length > 0 && (
        <div className="mt-4 border-t border-line pt-3">
          <div className="mb-2 text-[11px] font-semibold tracking-wide text-faint uppercase">{t("usage.byTab")}</div>
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
