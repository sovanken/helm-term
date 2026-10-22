// Small number formatters shared by the usage views.

import { locale, t } from "../i18n";

/** 52300 → "52.3k", 1_000_000 → "1M", 950 → "950". */
export function tokens(n: number | undefined): string {
  if (n == null) return "–";
  if (n >= 1_000_000_000) return t("format.billion", { n: trim(n / 1_000_000_000) });
  if (n >= 1_000_000) return t("format.million", { n: trim(n / 1_000_000) });
  if (n >= 1_000) return t("format.thousand", { n: trim(n / 1_000) });
  return num(Math.round(n));
}

function trim(x: number) {
  // 2 decimals below 10, 1 below 100, none above; trailing zeros dropped ("2.50" → "2.5").
  return new Intl.NumberFormat(locale(), { maximumFractionDigits: x >= 100 ? 0 : x >= 10 ? 1 : 2, useGrouping: false }).format(x);
}

/** A whole number in the interface language's digits and separators. */
export function num(n: number): string {
  return new Intl.NumberFormat(locale(), { maximumFractionDigits: 0, useGrouping: false }).format(n);
}

/** Short duration units ("3d", "1h", "21m", "35s"), translated. */
export const unit = {
  d: (n: number) => t("format.days", { n: num(n) }),
  h: (n: number) => t("format.hours", { n: num(n) }),
  m: (n: number) => t("format.minutes", { n: num(n) }),
  s: (n: number) => t("format.seconds", { n: num(n) }),
};

/** Two short units side by side, e.g. "1h 21m". */
export function pair(a: string, b: string): string {
  return t("format.pair", { a, b });
}

/** 4_903_967 ms → "1h 21m", 95_000 → "1m 35s". */
export function duration(ms: number | undefined): string {
  if (!ms || ms < 1000) return unit.m(0);
  const s = Math.round(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h) return pair(unit.h(h), unit.m(m));
  if (m) return s % 60 && m < 10 ? pair(unit.m(m), unit.s(s % 60)) : unit.m(m);
  return unit.s(s);
}

export function money(usd: number | undefined): string {
  if (usd == null) return "–";
  const digits = usd >= 100 ? 0 : 2;
  return new Intl.NumberFormat(locale(), { style: "currency", currency: "USD", minimumFractionDigits: digits, maximumFractionDigits: digits, useGrouping: false }).format(usd);
}

/** Clock time for a Unix-seconds or -milliseconds timestamp, with the weekday if it isn't today. */
export function clock(ts: number | undefined): string {
  if (!ts) return "";
  const d = new Date(ts < 1e12 ? ts * 1000 : ts);
  const time = d.toLocaleTimeString(locale(), { hour: "numeric", minute: "2-digit" });
  return d.toDateString() === new Date().toDateString() ? time : t("format.dayAndTime", { day: d.toLocaleDateString(locale(), { weekday: "short" }), time });
}

/** Context window size for a model id ("…[1m]" means one million tokens). */
export function windowFor(model: string | undefined): number {
  return model?.includes("[1m]") ? 1_000_000 : 200_000;
}
