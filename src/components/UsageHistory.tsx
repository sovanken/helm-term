import { useMemo, useState } from "react";
import { BarChart3, Table2 } from "lucide-react";
import { type UsageDay, useStore } from "../state/store";

const DAYS = 14;

/** The last 14 calendar days, filling days without usage with zero. */
function lastDays(log: UsageDay[]) {
  const byDay = new Map(log.map((d) => [d.day, d]));
  const out: { day: string; label: string; pts: number }[] = [];
  for (let i = DAYS - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = d.toLocaleDateString("en-CA");
    out.push({ day: key, label: d.toLocaleDateString(undefined, { weekday: "short", day: "numeric" }), pts: byDay.get(key)?.weekPts ?? 0 });
  }
  return out;
}

/** Share of the weekly limit used per day, plus which projects used it this week. */
export function UsageHistory() {
  const log = useStore((s) => s.usageLog);
  const [table, setTable] = useState(false);
  const [hover, setHover] = useState<number | null>(null);
  const days = useMemo(() => lastDays(log), [log]);
  const max = Math.max(5, ...days.map((d) => d.pts));
  const week = days.slice(-7);
  const weekTotal = week.reduce((a, d) => a + d.pts, 0);
  const projects = useMemo(() => {
    const keys = new Set(week.map((d) => d.day));
    const totals: Record<string, number> = {};
    for (const entry of log) if (keys.has(entry.day)) for (const [p, v] of Object.entries(entry.byProject)) totals[p] = (totals[p] ?? 0) + v;
    return Object.entries(totals).sort((a, b) => b[1] - a[1]).slice(0, 5);
  }, [log, week]);

  const H = 96;
  return (
    <div className="mt-4 rounded-xl border border-line p-4">
      <div className="mb-1 flex items-center gap-2">
        <BarChart3 size={15} className="text-accent" />
        <span className="font-medium text-fg">Usage history</span>
        <button
          onClick={() => setTable((t) => !t)}
          title={table ? "Show chart" : "Show as table"}
          aria-label={table ? "Show chart" : "Show as table"}
          className="ml-auto flex size-6 items-center justify-center rounded text-faint hover:bg-hover hover:text-fg"
        >
          {table ? <BarChart3 size={13} /> : <Table2 size={13} />}
        </button>
      </div>
      <p className="mb-3 text-[12px] text-faint">Share of your weekly limit used each day · last 7 days: {Math.round(weekTotal)}%</p>

      {log.length === 0 ? (
        <p className="text-[12px] leading-relaxed text-faint">Helm records your usage from now on. Check back after a day of work.</p>
      ) : table ? (
        <table className="w-full text-[12px]">
          <thead>
            <tr className="text-left text-faint">
              <th className="pb-1 font-medium">Day</th>
              <th className="pb-1 text-right font-medium">Weekly limit used</th>
            </tr>
          </thead>
          <tbody>
            {[...days].reverse().map((d) => (
              <tr key={d.day} className="border-t border-line">
                <td className="py-1 text-fg">{d.label}</td>
                <td className="py-1 text-right text-muted tabular-nums">{d.pts.toFixed(1)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="relative">
          <svg viewBox={`0 0 ${DAYS * 20} ${H + 18}`} className="w-full overflow-visible" role="img" aria-label="Daily share of the weekly limit, last 14 days">
            {/* recessive gridline at the top value */}
            <line x1="0" x2={DAYS * 20} y1={H - (max / max) * H} y2={H - (max / max) * H} stroke="var(--border)" strokeDasharray="2 3" />
            <line x1="0" x2={DAYS * 20} y1={H} y2={H} stroke="var(--border)" />
            {days.map((d, i) => {
              const h = (d.pts / max) * H;
              const x = i * 20 + 4;
              return (
                <g key={d.day} onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)}>
                  {/* hit target larger than the mark */}
                  <rect x={i * 20} y={0} width={20} height={H + 18} fill="transparent" />
                  {d.pts > 0 && (
                    <path
                      d={`M${x},${H} L${x},${H - h + 3} Q${x},${H - h} ${x + 3},${H - h} L${x + 9},${H - h} Q${x + 12},${H - h} ${x + 12},${H - h + 3} L${x + 12},${H} Z`}
                      fill="var(--accent)"
                      opacity={hover === null || hover === i ? 1 : 0.45}
                    />
                  )}
                  {(i === 0 || i === DAYS - 1 || i % 7 === 6) && (
                    <text x={x + 6} y={H + 13} textAnchor="middle" fontSize="8" fill="var(--faint)">
                      {d.label.split(" ")[0]}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
          {hover !== null && (
            <div
              className="pointer-events-none absolute -top-2 z-10 -translate-x-1/2 -translate-y-full rounded-md border border-line bg-raised px-2 py-1 text-[11px] whitespace-nowrap text-fg shadow-sm"
              style={{ left: `${((hover * 20 + 10) / (DAYS * 20)) * 100}%` }}
            >
              <span className="font-semibold">{days[hover].pts.toFixed(1)}%</span> <span className="text-muted">of the weekly limit · {days[hover].label}</span>
            </div>
          )}
        </div>
      )}

      {projects.length > 0 && !table && (
        <div className="mt-3 border-t border-line pt-3">
          <div className="mb-2 text-[11px] font-semibold tracking-wide text-faint uppercase">Most used this week</div>
          {projects.map(([name, v]) => (
            <div key={name} className="mb-1.5 flex items-center gap-2 text-[12px]">
              <span className="w-28 truncate text-fg">{name}</span>
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-hover">
                <div className="h-full rounded-full bg-accent" style={{ width: `${(v / projects[0][1]) * 100}%` }} />
              </div>
              <span className="w-11 text-right text-muted tabular-nums">{v.toFixed(1)}%</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
