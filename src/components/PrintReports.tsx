// Printable reports for PDF export (lib/pdf.tsx renders these in light colours on A4).

import type { ReactNode } from "react";
import type { SessionReport, UsageTotals } from "../lib/ipc";
import { clock, duration, money, tokens, windowFor } from "../lib/format";
import { cleanTitle, folderName, type Pane, type Usage } from "../state/store";
import { type Breakdown, ContextBar, GrowthChart } from "./SessionDetail";
import { modelLabel } from "./StatusBar";

function Header({ title, subtitle }: { title: string; subtitle?: ReactNode }) {
  return (
    <header className="mb-6 flex items-end justify-between border-b-2 border-fg pb-3">
      <div>
        <div className="text-[10px] font-semibold tracking-[0.18em] text-accent uppercase">Helm</div>
        <h1 className="text-[20px] leading-tight font-semibold">{title}</h1>
        {subtitle && <div className="mt-0.5 text-[12px] text-muted">{subtitle}</div>}
      </div>
      <div className="text-right text-[10.5px] text-faint">
        Generated
        <br />
        {new Date().toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}
      </div>
    </header>
  );
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-5">
      <h2 className="mb-2 text-[11px] font-semibold tracking-wide text-faint uppercase">{title}</h2>
      {children}
    </section>
  );
}

function Figures({ items }: { items: [string, ReactNode, ReactNode?][] }) {
  return (
    <div className="grid grid-cols-4 gap-3">
      {items.map(([label, value, sub]) => (
        <div key={label} className="rounded-lg border border-line px-3 py-2">
          <div className="text-[10px] text-faint">{label}</div>
          <div className="text-[15px] font-semibold tabular-nums">{value}</div>
          {sub && <div className="text-[10px] text-faint">{sub}</div>}
        </div>
      ))}
    </div>
  );
}

function Footer() {
  return <footer className="mt-5 border-t border-line pt-2 text-[9.5px] text-faint">Numbers come from Claude Code on this PC. Context figures marked "estimate" are approximate; costs are what Claude Code reports.</footer>;
}

export function SessionPrint({ pane, report: r, b }: { pane: Pane; report: SessionReport | null; b: Breakdown | null }) {
  const cacheTotal = r ? r.inputTokens + r.cacheReadTokens + r.cacheWriteTokens : 0;
  const hit = r && cacheTotal ? Math.round((r.cacheReadTokens / cacheTotal) * 100) : null;
  const model = pane.stats?.model ?? r?.models[0];
  return (
    <div className="print-page">
      <Header
        title={`${folderName(pane.cwd)} · session report`}
        subtitle={
          <>
            {cleanTitle(pane.title) || "Conversation"} · {model ? modelLabel(model) : "Claude"}
            {pane.stats?.effort && ` · ${pane.stats.effort} effort`}
            {r?.started && ` · ${new Date(r.started).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })} – ${clock(r.last)}`}
          </>
        }
      />
      {b && (
        <Block title={`Context window · ${b.exact ? "exact" : "estimate"}`}>
          <div className="mb-2 text-[13px]">
            <span className="text-[18px] font-semibold">{tokens(b.used)}</span> of {tokens(b.window)} tokens ({((b.used / b.window) * 100).toFixed(1)}%)
          </div>
          <ContextBar b={b} />
          {b.exact && b.details.length > 0 && (
            <table className="mt-3">
              <thead>
                <tr>
                  <th>Category</th>
                  <th className="num">Tokens</th>
                  <th className="num">Of window</th>
                </tr>
              </thead>
              <tbody>
                {b.details.map((d) => (
                  <tr key={d.label}>
                    <td>{d.label}</td>
                    <td className="num">{tokens(d.tokens)}</td>
                    <td className="num">{((d.tokens / b.window) * 100).toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Block>
      )}
      {r && r.series.length > 1 && (
        <Block title={`How the context grew${r.compactions ? ` · compacted ${r.compactions}×` : ""}`}>
          <GrowthChart series={r.series} height={64} />
        </Block>
      )}
      {r && (
        <Block title="Tokens">
          <Figures
            items={[
              ["Sent (new)", tokens(r.inputTokens)],
              ["From cache", tokens(r.cacheReadTokens), hit != null ? `${hit}% cache hits` : undefined],
              ["Written to cache", tokens(r.cacheWriteTokens)],
              ["Claude wrote", tokens(r.outputTokens)],
            ]}
          />
        </Block>
      )}
      <Block title="Activity">
        <Figures
          items={[
            ["Your messages", r?.prompts ?? "–", r ? `${r.replies} replies` : undefined],
            ["Tool calls", r?.toolCalls ?? "–"],
            ["Time working", duration(r?.activeMs)],
            ["Cost", money(pane.stats?.costUsd ?? r?.costUsd), `+${pane.stats?.linesAdded ?? r?.linesAdded ?? 0} −${pane.stats?.linesRemoved ?? r?.linesRemoved ?? 0} lines`],
          ]}
        />
      </Block>
      {r && r.tools.length > 0 && (
        <Block title="Tools Claude used">
          <table>
            <tbody>
              {r.tools.map((t) => (
                <tr key={t.name}>
                  <td className="font-mono">{t.name}</td>
                  <td className="num">{t.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Block>
      )}
      <Footer />
    </div>
  );
}

const windowName = (key: string) => (key.startsWith("five_hour") ? "5-hour" : key.startsWith("seven_day") ? "Weekly" : key.replace(/_/g, " "));

export function UsagePrint({ usage, totals, sessions }: { usage: Usage | null; totals: UsageTotals | null; sessions: Pane[] }) {
  const limits: [string, Usage["fiveHour"]][] = usage
    ? ([
        ["5-hour limit", usage.fiveHour],
        ["Weekly limit (all models)", usage.sevenDay],
        ...Object.entries(usage.other ?? {}).map(([k, w]) => [`${windowName(k)} · ${k.replace(/^(five_hour|seven_day)_?/, "")}`, w] as [string, Usage["fiveHour"]]),
        ["Spend limit", usage.spend],
      ] as [string, Usage["fiveHour"]][]).filter(([, w]) => w)
    : [];
  const days = totals?.days ?? [];
  const sum = (k: keyof (typeof days)[number]) => days.reduce((n, d) => n + (d[k] as number), 0);
  return (
    <div className="print-page">
      <Header title="Claude usage report" subtitle="Last 7 days on this PC" />
      {limits.length > 0 && (
        <Block title="Usage limits">
          <table>
            <thead>
              <tr>
                <th>Limit</th>
                <th className="num">Used</th>
                <th>Resets</th>
              </tr>
            </thead>
            <tbody>
              {limits.map(([label, w]) => (
                <tr key={label}>
                  <td>{label}</td>
                  <td className="num">{Math.round(w!.pct)}%</td>
                  <td>{w!.idle ? "Starts with the next message" : w!.resetsAt ? new Date(w!.resetsAt * 1000).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" }) : "–"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Block>
      )}
      <Block title="Totals">
        <Figures
          items={[
            ["Cost", money(sum("costUsd"))],
            ["Tokens", tokens(sum("inputTokens") + sum("cacheWriteTokens") + sum("outputTokens")), `${tokens(sum("cacheReadTokens"))} from cache`],
            ["Time working", duration(sum("activeMs")), `${sum("replies")} replies`],
            ["Lines changed", `+${sum("linesAdded")} −${sum("linesRemoved")}`],
          ]}
        />
      </Block>
      {days.length > 0 && (
        <Block title="By day">
          <table>
            <thead>
              <tr>
                <th>Day</th>
                <th className="num">Cost</th>
                <th className="num">Tokens</th>
                <th className="num">From cache</th>
                <th className="num">Time</th>
                <th className="num">Lines</th>
                <th className="num">Sessions</th>
              </tr>
            </thead>
            <tbody>
              {days.map((d) => (
                <tr key={d.day}>
                  <td>{new Date(`${d.day}T12:00:00`).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })}</td>
                  <td className="num">{money(d.costUsd)}</td>
                  <td className="num">{tokens(d.inputTokens + d.cacheWriteTokens + d.outputTokens)}</td>
                  <td className="num">{tokens(d.cacheReadTokens)}</td>
                  <td className="num">{duration(d.activeMs)}</td>
                  <td className="num">
                    +{d.linesAdded} −{d.linesRemoved}
                  </td>
                  <td className="num">{d.sessions}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Block>
      )}
      {totals && totals.byProject.length > 0 && (
        <div className="grid grid-cols-2 gap-6">
          <Block title="By project">
            <table>
              <tbody>
                {totals.byProject.slice(0, 12).map((g) => (
                  <tr key={g.key}>
                    <td>{folderName(g.key)}</td>
                    <td className="num">{money(g.costUsd)}</td>
                    <td className="num">{tokens(g.tokens)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Block>
          <Block title="By model">
            <table>
              <tbody>
                {totals.byModel.map((g) => (
                  <tr key={g.key}>
                    <td>{modelLabel(g.key) ?? g.key}</td>
                    <td className="num">{money(g.costUsd)}</td>
                    <td className="num">{tokens(g.tokens)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Block>
        </div>
      )}
      {sessions.length > 0 && (
        <Block title="Open Claude sessions">
          <table>
            <thead>
              <tr>
                <th>Project</th>
                <th>Conversation</th>
                <th>Model</th>
                <th className="num">Context</th>
                <th className="num">Cost</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((p) => (
                <tr key={p.id}>
                  <td>{folderName(p.cwd)}</td>
                  <td>{cleanTitle(p.title) || "–"}</td>
                  <td>{p.stats?.model ? modelLabel(p.stats.model) : "–"}</td>
                  <td className="num">{p.stats?.contextPct != null ? `${tokens((p.stats.contextPct / 100) * windowFor(p.stats.model))} · ${Math.round(p.stats.contextPct)}%` : "–"}</td>
                  <td className="num">{money(p.stats?.costUsd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Block>
      )}
      <Footer />
    </div>
  );
}
