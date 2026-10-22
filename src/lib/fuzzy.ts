import { locale, t } from "../i18n";
import { unit } from "./format";

/**
 * Scores how well `query` matches `text`: contiguous and word-start matches rank highest.
 * Returns -1 when the query's characters do not all appear in order.
 */
export function fuzzyScore(query: string, text: string): number {
  const q = query.toLowerCase().trim();
  if (!q) return 0;
  const t = text.toLowerCase();
  const direct = t.indexOf(q);
  if (direct >= 0) return 1000 - direct + (direct === 0 || /[\s/:_-]/.test(t[direct - 1]) ? 200 : 0);

  let score = 0;
  let ti = 0;
  let prev = -2;
  for (const ch of q) {
    if (ch === " ") continue;
    const found = t.indexOf(ch, ti);
    if (found < 0) return -1;
    score += found === prev + 1 ? 8 : 1;
    if (found === 0 || /[\s/:_-]/.test(t[found - 1])) score += 6;
    prev = found;
    ti = found + 1;
  }
  return score;
}

export function timeAgo(ms: number) {
  const mins = Math.round((Date.now() - ms) / 60000);
  if (mins < 1) return t("agentText.justNow");
  const rel = new Intl.RelativeTimeFormat(locale(), { style: "narrow" });
  if (mins < 60) return rel.format(-mins, "minute");
  const hours = Math.round(mins / 60);
  if (hours < 24) return rel.format(-hours, "hour");
  const days = Math.round(hours / 24);
  return days < 30 ? rel.format(-days, "day") : new Date(ms).toLocaleDateString(locale());
}

/** timeAgo without "ago", for tight spaces: "now", "5m", "2h", "3d". */
export function timeAgoShort(ms: number) {
  const mins = Math.round((Date.now() - ms) / 60000);
  if (mins < 1) return t("agentText.now");
  if (mins < 60) return unit.m(mins);
  const hours = Math.round(mins / 60);
  if (hours < 24) return unit.h(hours);
  const days = Math.round(hours / 24);
  return days < 30 ? unit.d(days) : new Date(ms).toLocaleDateString(locale());
}
