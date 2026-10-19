// Small number formatters shared by the usage views.

/** 52300 → "52.3k", 1_000_000 → "1M", 950 → "950". */
export function tokens(n: number | undefined): string {
  if (n == null) return "–";
  if (n >= 1_000_000) return `${trim(n / 1_000_000)}M`;
  if (n >= 1_000) return `${trim(n / 1_000)}k`;
  return String(Math.round(n));
}

function trim(x: number) {
  return (x >= 100 ? x.toFixed(0) : x >= 10 ? x.toFixed(1) : x.toFixed(2)).replace(/\.?0+$/, "");
}

/** 4_903_967 ms → "1h 21m", 95_000 → "1m 35s". */
export function duration(ms: number | undefined): string {
  if (!ms || ms < 1000) return "0m";
  const s = Math.round(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m${s % 60 && m < 10 ? ` ${s % 60}s` : ""}`;
  return `${s}s`;
}

export function money(usd: number | undefined): string {
  if (usd == null) return "–";
  return usd >= 100 ? `$${usd.toFixed(0)}` : `$${usd.toFixed(2)}`;
}

/** Clock time for a Unix-seconds or -milliseconds timestamp, with the weekday if it isn't today. */
export function clock(t: number | undefined): string {
  if (!t) return "";
  const d = new Date(t < 1e12 ? t * 1000 : t);
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return d.toDateString() === new Date().toDateString() ? time : `${d.toLocaleDateString([], { weekday: "short" })} ${time}`;
}

/** Context window size for a model id ("…[1m]" means one million tokens). */
export function windowFor(model: string | undefined): number {
  return model?.includes("[1m]") ? 1_000_000 : 200_000;
}
