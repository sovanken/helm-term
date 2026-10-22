import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";

/**
 * Small single-series bar charts for the Usage tab: one accent hue, thin bars with rounded tops,
 * a recessive baseline and a hover readout (the title names the series, so no legend).
 */
export function BarChart({
  values,
  labels,
  format,
  tooltip,
  height = 140,
  highlight,
  ticks,
}: {
  values: number[];
  /** Under each bar (pass "" to skip some). */
  labels: string[];
  format: (v: number) => string;
  tooltip?: (i: number) => ReactNode;
  height?: number;
  /** A bar to show in full accent (e.g. today); the rest are softer. */
  highlight?: number;
  /** Show only every n-th label. */
  ticks?: number;
}) {
  const { t } = useTranslation();
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(...values, 0);
  const n = values.length;
  return (
    <div className="relative select-none" onMouseLeave={() => setHover(null)}>
      <div className="flex items-end gap-[2px]" style={{ height }} role="img" aria-label={t("charts.barChartLabel", { max: format(max) })}>
        {values.map((v, i) => {
          const h = max > 0 ? Math.max(v > 0 ? 3 : 0, (v / max) * (height - 4)) : 0;
          const strong = highlight === undefined || highlight === i || hover === i;
          return (
            <div key={i} className="flex h-full min-w-0 flex-1 cursor-default items-end" onMouseEnter={() => setHover(i)}>
              <div
                className={`w-full rounded-t-[4px] ${strong ? "bg-accent" : "bg-accent/45"} ${hover === i ? "opacity-100" : ""}`}
                style={{ height: h }}
              />
            </div>
          );
        })}
      </div>
      <div className="mt-1 h-px bg-line" />
      {/* Labels sit centred under their bar but may be wider than it (no cutting off). */}
      <div className="relative mt-1 h-4 text-[10.5px] text-faint tabular-nums">
        {labels.map((l, i) =>
          l && (!ticks || i % ticks === 0) ? (
            <span
              key={i}
              className={`absolute whitespace-nowrap ${i === 0 ? "" : i === n - 1 ? "-translate-x-full" : "-translate-x-1/2"}`}
              style={{ left: i === 0 ? 0 : i === n - 1 ? "100%" : `${((i + 0.5) / n) * 100}%` }}
            >
              {l}
            </span>
          ) : null,
        )}
      </div>
      {hover !== null && (
        <div
          className="pointer-events-none absolute -top-2 z-10 -translate-x-1/2 -translate-y-full rounded-md border border-line bg-raised px-2 py-1 text-[11.5px] whitespace-nowrap text-fg shadow-sm"
          style={{ left: `${((hover + 0.5) / n) * 100}%` }}
        >
          {tooltip ? tooltip(hover) : `${labels[hover]} · ${format(values[hover])}`}
        </div>
      )}
    </div>
  );
}

/** Horizontal ranked bars with a value column (projects, models). */
export function RankList({ rows, format, sub }: { rows: { key: string; label: string; value: number; title?: string }[]; format: (v: number) => string; sub?: (key: string) => ReactNode }) {
  const max = Math.max(...rows.map((r) => r.value), 0.000001);
  return (
    <div className="flex flex-col gap-2">
      {rows.map((r) => (
        <div key={r.key} title={r.title} className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)_auto] items-center gap-3 text-[12.5px]">
          <span className="truncate text-fg">{r.label}</span>
          <div className="h-2 overflow-hidden rounded-full bg-hover">
            <div className="h-full rounded-full bg-accent" style={{ width: `${Math.max(1.5, (r.value / max) * 100)}%` }} />
          </div>
          <span className="text-right text-fg tabular-nums">
            {format(r.value)}
            {sub && <span className="ml-2 text-faint">{sub(r.key)}</span>}
          </span>
        </div>
      ))}
    </div>
  );
}
