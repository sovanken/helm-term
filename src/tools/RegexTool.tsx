import { Fragment, type ReactNode, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { t } from "../i18n";
import { Card, CodeArea, CopyButton, Hint, Input, Label } from "./ui";

const FLAGS = [
  { flag: "g", key: "allMatches" },
  { flag: "i", key: "ignoreCase" },
  { flag: "m", key: "perLine" },
  { flag: "s", key: "dotAll" },
  { flag: "u", key: "unicode" },
];

/** Escape letter → key under tools.regex.escapes. */
const ESCAPES: Record<string, string> = {
  d: "digit",
  D: "notDigit",
  w: "word",
  W: "notWord",
  s: "space",
  S: "notSpace",
  b: "boundary",
  B: "notBoundary",
  n: "newline",
  t: "tab",
  r: "carriageReturn",
};

function quantifier(q: string) {
  const lazy = q.endsWith("?") && q.length > 1 ? "Lazy" : "";
  const base = lazy ? q.slice(0, -1) : q;
  if (base === "*") return t(`tools.regex.zeroOrMore${lazy}`);
  if (base === "+") return t(`tools.regex.oneOrMore${lazy}`);
  if (base === "?") return t("tools.regex.optional");
  const m = base.match(/^\{(\d+)(,?)(\d*)\}$/);
  if (!m) return base;
  if (!m[2]) return t("tools.regex.exactly", { count: Number(m[1]) });
  return m[3] ? t(`tools.regex.range${lazy}`, { min: m[1], max: m[3] }) : t(`tools.regex.atLeast${lazy}`, { min: m[1] });
}

/** A plain-language reading of the pattern, one line per piece. */
function explain(src: string): { token: string; text: string; depth: number }[] {
  const out: { token: string; text: string; depth: number }[] = [];
  let depth = 0;
  let i = 0;
  const push = (token: string, text: string) => out.push({ token, text, depth });
  while (i < src.length) {
    const c = src[i];
    let token = c;
    let text = "";
    if (c === "\\") {
      token = src.slice(i, i + 2);
      const e = src[i + 1] ?? "";
      if (/\d/.test(e)) text = t("tools.regex.backref", { n: e });
      else text = ESCAPES[e] ? t(`tools.regex.escapes.${ESCAPES[e]}`) : t("tools.regex.char", { char: e });
      i += 2;
    } else if (c === "[") {
      const end = src.indexOf("]", i + 2);
      token = src.slice(i, end < 0 ? undefined : end + 1);
      text = token.startsWith("[^") ? t("tools.regex.notOneOf", { chars: token.slice(2, -1) }) : t("tools.regex.oneOf", { chars: token.slice(1, -1) });
      i += token.length;
    } else if (c === "(") {
      if (src.startsWith("(?:", i)) (token = "(?:"), (text = t("tools.regex.groupNotCaptured"));
      else if (src.startsWith("(?=", i)) (token = "(?="), (text = t("tools.regex.followedBy"));
      else if (src.startsWith("(?!", i)) (token = "(?!"), (text = t("tools.regex.notFollowedBy"));
      else if (src.startsWith("(?<=", i)) (token = "(?<="), (text = t("tools.regex.precededBy"));
      else if (src.startsWith("(?<!", i)) (token = "(?<!"), (text = t("tools.regex.notPrecededBy"));
      else if (src.startsWith("(?<", i)) {
        const end = src.indexOf(">", i);
        token = src.slice(i, end + 1);
        text = t("tools.regex.namedGroup", { name: token.slice(3, -1) });
      } else text = t("tools.regex.group");
      push(token, text);
      depth++;
      i += token.length;
      continue;
    } else if (c === ")") {
      depth = Math.max(0, depth - 1);
      text = t("tools.regex.groupEnd");
      i++;
    } else if (c === "^") (text = t("tools.regex.start")), i++;
    else if (c === "$") (text = t("tools.regex.end")), i++;
    else if (c === ".") (text = t("tools.regex.any")), i++;
    else if (c === "|") (text = t("tools.regex.or")), i++;
    else {
      const q = src.slice(i).match(/^(\*\??|\+\??|\?\??|\{\d+,?\d*\}\??)/);
      if (q) {
        token = q[0];
        text = quantifier(q[0]);
        i += token.length;
      } else {
        // Run of plain characters.
        const run = src.slice(i).match(/^[^\\[\]().^$|*+?{}]+/)?.[0] ?? c;
        token = run;
        text = t("tools.regex.literal", { text: run });
        i += run.length;
      }
    }
    push(token, text);
  }
  return out;
}

export default function RegexTool() {
  const { t } = useTranslation();
  const [pattern, setPattern] = useState("(\\w+)@([\\w.]+)");
  const [flags, setFlags] = useState("g");
  const [text, setText] = useState("Write to ada@example.com or grace@navy.mil.\nNot an email: @nobody");

  const { regex, error } = useMemo(() => {
    try {
      return { regex: new RegExp(pattern, flags), error: null };
    } catch (e) {
      return { regex: null, error: e instanceof Error ? e.message.replace(/^Invalid regular expression: /, "") : String(e) };
    }
  }, [pattern, flags]);

  const matches = useMemo(() => {
    if (!regex || !pattern) return [];
    const r = new RegExp(regex.source, regex.flags.includes("g") ? regex.flags : regex.flags + "g");
    const list: RegExpExecArray[] = [];
    for (const m of text.matchAll(r)) {
      list.push(m as RegExpExecArray);
      if (!regex.flags.includes("g") || list.length >= 1000) break;
    }
    return list;
  }, [regex, pattern, text]);

  const highlighted = useMemo(() => {
    const parts: ReactNode[] = [];
    let at = 0;
    matches.forEach((m, i) => {
      const start = m.index ?? 0;
      if (start > at) parts.push(text.slice(at, start));
      parts.push(
        <mark key={i} className="rounded-sm bg-accent/30 text-fg">
          {m[0] || "​"}
        </mark>,
      );
      at = start + m[0].length;
    });
    parts.push(text.slice(at));
    return parts;
  }, [matches, text]);

  // `t` changes with the language, so the reading is redone then too.
  const steps = useMemo(() => (pattern && !error ? explain(pattern) : []), [pattern, error, t]);

  return (
    <div className="scroll-thin h-full overflow-y-auto p-5">
      <div className="mx-auto flex max-w-5xl flex-col gap-4">
        <div>
          <Label right={<CopyButton text={`/${pattern}/${flags}`} label={t("common.copy")} />}>{t("tools.regex.pattern")}</Label>
          <div className="flex items-center gap-1 rounded-md border border-line bg-bg pl-3 font-mono text-[13px] focus-within:border-accent">
            <span className="text-faint">/</span>
            <Input mono value={pattern} onChange={(e) => setPattern(e.target.value)} className="flex-1 border-none px-1 focus:border-none" aria-label={t("tools.regex.pattern")} />
            <span className="pr-3 text-faint">/{flags}</span>
          </div>
          <div className="mt-2 flex flex-wrap gap-3">
            {FLAGS.map((f) => (
              <label key={f.flag} className="flex items-center gap-1.5 text-[12px] text-muted">
                <input
                  type="checkbox"
                  checked={flags.includes(f.flag)}
                  onChange={(e) => setFlags((cur) => (e.target.checked ? cur + f.flag : cur.replace(f.flag, "")).split("").sort().join(""))}
                  className="accent-[var(--accent)]"
                />
                <code className="text-fg">{f.flag}</code> {t(`tools.regex.flags.${f.key}`)}
              </label>
            ))}
          </div>
          {error && (
            <div className="mt-2">
              <Hint error>{error}</Hint>
            </div>
          )}
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <div className="flex flex-col">
            <Label>{t("tools.regex.testText")}</Label>
            <CodeArea value={text} onChange={(e) => setText(e.target.value)} rows={8} className="flex-none" />
          </div>
          <div className="flex flex-col">
            <Label>{t("tools.regex.matches", { count: matches.length })}</Label>
            <pre className="scroll-thin min-h-[180px] flex-1 overflow-auto rounded-md border border-line bg-bg p-3 font-mono text-[12.5px] leading-relaxed whitespace-pre-wrap text-muted select-text">
              {highlighted}
            </pre>
          </div>
        </div>

        {matches.length > 0 && (
          <Card className="p-0">
            <table className="w-full text-left text-[12.5px]">
              <thead className="border-b border-line text-[11px] text-faint uppercase">
                <tr>
                  <th className="px-4 py-2 font-semibold">#</th>
                  <th className="px-4 py-2 font-semibold">{t("tools.regex.match")}</th>
                  <th className="px-4 py-2 font-semibold">{t("tools.regex.position")}</th>
                  <th className="px-4 py-2 font-semibold">{t("tools.regex.groups")}</th>
                </tr>
              </thead>
              <tbody>
                {matches.slice(0, 200).map((m, i) => (
                  <tr key={i} className="border-b border-line last:border-b-0">
                    <td className="px-4 py-1.5 text-faint">{i + 1}</td>
                    <td className="px-4 py-1.5 font-mono text-fg select-text">{m[0]}</td>
                    <td className="px-4 py-1.5 text-muted tabular-nums">{m.index}</td>
                    <td className="px-4 py-1.5 font-mono text-muted select-text">
                      {m.slice(1).map((g, j) => (
                        <Fragment key={j}>
                          {j > 0 && <span className="text-faint"> · </span>}
                          <span className="text-faint">{Object.entries(m.groups ?? {}).find(([, v]) => v === g)?.[0] ?? j + 1}:</span> {g ?? "—"}
                        </Fragment>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}

        {steps.length > 0 && (
          <Card>
            <Label>{t("tools.regex.meaning")}</Label>
            <ul className="flex flex-col gap-1">
              {steps.map((s, i) => (
                <li key={i} className="flex items-baseline gap-3 text-[12.5px]" style={{ paddingLeft: s.depth * 16 }}>
                  <code className="min-w-16 shrink-0 rounded bg-hover px-1.5 font-mono text-fg">{s.token}</code>
                  <span className="text-muted">{s.text}</span>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </div>
  );
}
