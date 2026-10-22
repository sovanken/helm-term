// Printable reports for PDF export (lib/pdf.tsx renders these in light colours on A4).

import type { ReactNode } from "react";
import { Trans } from "react-i18next";
import { locale, t } from "../i18n";
import type { SessionReport, UsageTotals } from "../lib/ipc";
import { duration, money, tokens, windowFor } from "../lib/format";
import { cleanTitle, folderName, type Pane, type Usage } from "../state/store";
import { type Breakdown, ContextBar, GrowthChart } from "./SessionDetail";
import { modelLabel } from "./StatusBar";

/** "Oct 19, 2026, 3:48 – 8:18 PM" on one day, else both dates in full. */
function timeRange(start: number, end?: number) {
  const day = (t: number) => new Date(t).toLocaleDateString(locale(), { dateStyle: "medium" });
  const time = (t: number) => new Date(t).toLocaleTimeString(locale(), { timeStyle: "short" });
  if (!end || end <= start) return `${day(start)}, ${time(start)}`;
  if (day(start) === day(end)) return `${day(start)}, ${time(start)} – ${time(end)}`;
  return `${day(start)}, ${time(start)} – ${day(end)}, ${time(end)}`;
}

function Header({ title, subtitle }: { title: string; subtitle?: ReactNode }) {
  return (
    <header className="mb-6 flex items-end justify-between border-b-2 border-fg pb-3">
      <div className="min-w-0">
        <div className="text-[10px] font-semibold tracking-[0.18em] text-accent uppercase">Helm</div>
        <h1 className="text-[20px] leading-tight font-semibold">{title}</h1>
        {subtitle && <div className="mt-0.5 text-[12px] text-muted">{subtitle}</div>}
      </div>
      <div className="shrink-0 pl-6 text-right text-[10.5px] whitespace-nowrap text-faint">
        {t("reports.generated")}
        <br />
        {new Date().toLocaleString(locale(), { dateStyle: "medium", timeStyle: "short" })}
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
  return <footer className="mt-5 border-t border-line pt-2 text-[9.5px] text-faint">{t("reports.footer")}</footer>;
}

export function SessionPrint({ pane, report: r, b }: { pane: Pane; report: SessionReport | null; b: Breakdown | null }) {
  const cacheTotal = r ? r.inputTokens + r.cacheReadTokens + r.cacheWriteTokens : 0;
  const hit = r && cacheTotal ? Math.round((r.cacheReadTokens / cacheTotal) * 100) : null;
  const model = pane.stats?.model ?? r?.models[0];
  return (
    <div className="print-page">
      <Header
        title={t("reports.session.title", { project: folderName(pane.cwd) })}
        subtitle={
          <>
            {cleanTitle(pane.title) || t("reports.session.conversation")} · {model ? modelLabel(model) : "Claude"}
            {pane.stats?.effort && ` · ${t("reports.session.effort", { effort: pane.stats.effort })}`}
            {r?.started && <div>{timeRange(r.started, r.last)}</div>}
          </>
        }
      />
      {b && (
        <Block title={b.exact ? t("reports.session.contextExact") : t("reports.session.contextEstimate")}>
          <div className="mb-2 text-[13px]">
            <Trans
              i18nKey="reports.session.usedOf"
              values={{ used: tokens(b.used), window: tokens(b.window), pct: ((b.used / b.window) * 100).toFixed(1) }}
              components={[<span className="text-[18px] font-semibold" />]}
            />
          </div>
          <ContextBar b={b} />
          {b.exact && b.details.length > 0 && (
            <table className="mt-3">
              <thead>
                <tr>
                  <th>{t("reports.session.category")}</th>
                  <th className="num">{t("reports.session.tokens")}</th>
                  <th className="num">{t("reports.session.ofWindow")}</th>
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
        <Block title={r.compactions ? t("reports.session.grewCompacted", { count: r.compactions }) : t("reports.session.grew")}>
          <GrowthChart series={r.series} height={64} />
        </Block>
      )}
      {r && (
        <Block title={t("reports.session.tokens")}>
          <Figures
            items={[
              [t("reports.session.sent"), tokens(r.inputTokens)],
              [t("reports.session.fromCache"), tokens(r.cacheReadTokens), hit != null ? t("reports.session.cacheHits", { pct: hit }) : undefined],
              [t("reports.session.writtenToCache"), tokens(r.cacheWriteTokens)],
              [t("reports.session.claudeWrote"), tokens(r.outputTokens)],
            ]}
          />
        </Block>
      )}
      <Block title={t("reports.session.activity")}>
        <Figures
          items={[
            [t("reports.session.yourMessages"), r?.prompts ?? "–", r ? t("reports.replies", { count: r.replies }) : undefined],
            [t("reports.session.toolCalls"), r?.toolCalls ?? "–"],
            [t("reports.timeWorking"), duration(r?.activeMs)],
            [t("reports.cost"), money(pane.stats?.costUsd ?? r?.costUsd), t("reports.session.lines", { added: pane.stats?.linesAdded ?? r?.linesAdded ?? 0, removed: pane.stats?.linesRemoved ?? r?.linesRemoved ?? 0 })],
          ]}
        />
      </Block>
      {r && r.tools.length > 0 && (
        <Block title={t("reports.session.toolsUsed")}>
          <table>
            <tbody>
              {r.tools.map((tool) => (
                <tr key={tool.name}>
                  <td className="font-mono">{tool.name}</td>
                  <td className="num">{tool.count}</td>
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

const windowName = (key: string) => (key.startsWith("five_hour") ? t("usage.window.fiveHour") : key.startsWith("seven_day") ? t("usage.window.weekly") : key.replace(/_/g, " "));

export function UsagePrint({ usage, totals, sessions, rangeDays = 7, homeDir = "" }: { usage: Usage | null; totals: UsageTotals | null; sessions: Pane[]; rangeDays?: number; homeDir?: string }) {
  const limits: [string, Usage["fiveHour"]][] = usage
    ? ([
        [t("reports.usage.fiveHourLimit"), usage.fiveHour],
        [t("reports.usage.weeklyLimit"), usage.sevenDay],
        ...Object.entries(usage.other ?? {}).map(([k, w]) => [`${windowName(k)} · ${k.replace(/^(five_hour|seven_day)_?/, "")}`, w] as [string, Usage["fiveHour"]]),
        [t("reports.usage.spendLimit"), usage.spend],
      ] as [string, Usage["fiveHour"]][]).filter(([, w]) => w)
    : [];
  // Only days inside the chosen range, oldest first.
  const first = new Date();
  first.setDate(first.getDate() - (rangeDays - 1));
  const from = first.toLocaleDateString("en-CA");
  const days = (totals?.days ?? []).filter((d) => d.day >= from);
  const sum = (k: keyof (typeof days)[number]) => days.reduce((n, d) => n + (d[k] as number), 0);
  const span = `${first.toLocaleDateString(locale(), { month: "short", day: "numeric" })} – ${new Date().toLocaleDateString(locale(), { month: "short", day: "numeric", year: "numeric" })}`;
  const project = (key: string) => (homeDir && key.toLowerCase() === homeDir.toLowerCase() ? t("reports.usage.noProject", { name: folderName(key) }) : folderName(key));
  return (
    <div className="print-page">
      <Header title={t("reports.usage.title")} subtitle={t("reports.usage.subtitle", { count: rangeDays, span })} />
      {limits.length > 0 && (
        <Block title={t("reports.usage.limits")}>
          <table>
            <thead>
              <tr>
                <th>{t("reports.usage.limit")}</th>
                <th className="num">{t("reports.usage.used")}</th>
                <th>{t("reports.usage.resets")}</th>
              </tr>
            </thead>
            <tbody>
              {limits.map(([label, w]) => (
                <tr key={label}>
                  <td>{label}</td>
                  <td className="num">{Math.round(w!.pct)}%</td>
                  <td>{w!.idle ? t("reports.usage.startsNext") : w!.resetsAt ? new Date(w!.resetsAt * 1000).toLocaleString(locale(), { weekday: "short", hour: "numeric", minute: "2-digit" }) : "–"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Block>
      )}
      <Block title={t("reports.usage.totals")}>
        <Figures
          items={[
            [t("reports.cost"), money(sum("costUsd"))],
            [t("reports.usage.tokens"), tokens(sum("inputTokens") + sum("cacheWriteTokens") + sum("outputTokens")), t("reports.usage.fromCacheSub", { tokens: tokens(sum("cacheReadTokens")) })],
            [t("reports.timeWorking"), duration(sum("activeMs")), t("reports.replies", { count: sum("replies") })],
            [t("reports.usage.linesChanged"), `+${sum("linesAdded")} −${sum("linesRemoved")}`],
          ]}
        />
      </Block>
      {days.length > 0 && (
        <Block title={t("reports.usage.byDay")}>
          <table>
            <thead>
              <tr>
                <th>{t("reports.usage.col.day")}</th>
                <th className="num">{t("reports.cost")}</th>
                <th className="num">{t("reports.usage.tokens")}</th>
                <th className="num">{t("reports.usage.col.fromCache")}</th>
                <th className="num">{t("reports.usage.col.time")}</th>
                <th className="num">{t("reports.usage.col.lines")}</th>
                <th className="num">{t("reports.usage.col.conversations")}</th>
              </tr>
            </thead>
            <tbody>
              {days.map((d) => (
                <tr key={d.day}>
                  <td>{new Date(`${d.day}T12:00:00`).toLocaleDateString(locale(), { weekday: "short", month: "short", day: "numeric" })}</td>
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
          <Block title={t("reports.usage.byProject")}>
            <table>
              <tbody>
                {totals.byProject.slice(0, 12).map((g) => (
                  <tr key={g.key}>
                    <td>{project(g.key)}</td>
                    <td className="num">{money(g.costUsd)}</td>
                    <td className="num">{tokens(g.tokens)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Block>
          <Block title={t("reports.usage.byModel")}>
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
        <Block title={t("reports.usage.openConversations")}>
          <table>
            <thead>
              <tr>
                <th>{t("reports.usage.col.project")}</th>
                <th>{t("reports.usage.col.conversation")}</th>
                <th>{t("reports.usage.col.model")}</th>
                <th className="num">{t("reports.usage.col.context")}</th>
                <th className="num">{t("reports.cost")}</th>
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
