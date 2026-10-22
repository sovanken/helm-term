import { type ReactNode, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { diffArrays, diffWordsWithSpace } from "diff";
import { ArrowLeftRight } from "lucide-react";
import { CodeArea, Hint, Label } from "./ui";

interface Row {
  left?: { n: number; text: ReactNode };
  right?: { n: number; text: ReactNode };
  kind: "same" | "changed" | "removed" | "added";
}

const split = (value: string) => value.replace(/\n$/, "").split("\n");

/** Word-level highlights inside a changed line pair. */
function words(a: string, b: string): [ReactNode, ReactNode] {
  const parts = diffWordsWithSpace(a, b);
  return [
    parts.filter((p) => !p.added).map((p, i) => (p.removed ? <mark key={i} className="rounded-sm bg-danger/35 text-fg">{p.value}</mark> : p.value)),
    parts.filter((p) => !p.removed).map((p, i) => (p.added ? <mark key={i} className="rounded-sm bg-done/35 text-fg">{p.value}</mark> : p.value)),
  ];
}

function buildRows(a: string, b: string, ignoreSpace: boolean, ignoreCase: boolean): Row[] {
  const before = split(a);
  const after = split(b);
  const norm = (t: string) => {
    let x = ignoreSpace ? t.replace(/\s+/g, " ").trim() : t;
    if (ignoreCase) x = x.toLowerCase();
    return x;
  };
  const parts = diffArrays(before, after, { comparator: (x, y) => norm(x) === norm(y) });
  const rows: Row[] = [];
  let ln = 1;
  let rn = 1;
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (!p.added && !p.removed) {
      // Lines that only differ in ignored ways show as they are on each side.
      for (let j = 0; j < p.count; j++) rows.push({ kind: "same", left: { n: ln, text: before[ln++ - 1] }, right: { n: rn, text: after[rn++ - 1] } });
      continue;
    }
    if (p.removed && parts[i + 1]?.added) {
      const left = p.value;
      const right = parts[i + 1].value;
      for (let j = 0; j < Math.max(left.length, right.length); j++) {
        const l = left[j];
        const r = right[j];
        if (l !== undefined && r !== undefined) {
          const [lt, rt] = words(l, r);
          rows.push({ kind: "changed", left: { n: ln++, text: lt }, right: { n: rn++, text: rt } });
        } else if (l !== undefined) rows.push({ kind: "removed", left: { n: ln++, text: l } });
        else rows.push({ kind: "added", right: { n: rn++, text: r } });
      }
      i++;
      continue;
    }
    for (const t of p.value) rows.push(p.removed ? { kind: "removed", left: { n: ln++, text: t } } : { kind: "added", right: { n: rn++, text: t } });
  }
  return rows;
}

function Cell({ side, row }: { side: "left" | "right"; row: Row }) {
  const cell = row[side];
  const tint = !cell ? "bg-hover/50" : row.kind === "same" ? "" : side === "left" ? "bg-danger/10" : "bg-done/10";
  return (
    <div className={`flex min-w-0 ${tint}`}>
      <span className="w-10 shrink-0 pr-2 text-right text-faint select-none">{cell?.n ?? ""}</span>
      <span className="min-w-0 flex-1 pr-3 break-words whitespace-pre-wrap text-fg">{cell?.text ?? ""}</span>
    </div>
  );
}

export default function DiffTool() {
  const { t } = useTranslation();
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const [ignoreSpace, setIgnoreSpace] = useState(false);
  const [ignoreCase, setIgnoreCase] = useState(false);
  const rows = useMemo(() => (a || b ? buildRows(a, b, ignoreSpace, ignoreCase) : []), [a, b, ignoreSpace, ignoreCase]);
  const changes = rows.filter((r) => r.kind !== "same").length;

  return (
    <div className="flex h-full flex-col gap-3 p-5">
      <div className="grid h-[38%] min-h-32 grid-cols-[1fr_auto_1fr] gap-2">
        <div className="flex min-h-0 flex-col">
          <Label>{t("tools.diff.before")}</Label>
          <CodeArea value={a} onChange={(e) => setA(e.target.value)} placeholder={t("tools.diff.beforePlaceholder")} />
        </div>
        <button
          aria-label={t("tools.diff.swapLabel")}
          title={t("tools.shared.swap")}
          onClick={() => (setA(b), setB(a))}
          className="mt-9 flex size-8 items-center justify-center self-start rounded-md border border-line text-muted hover:bg-hover hover:text-fg"
        >
          <ArrowLeftRight size={14} />
        </button>
        <div className="flex min-h-0 flex-col">
          <Label>{t("tools.diff.after")}</Label>
          <CodeArea value={b} onChange={(e) => setB(e.target.value)} placeholder={t("tools.diff.afterPlaceholder")} />
        </div>
      </div>
      <div className="flex items-center gap-4">
        <span className="flex-1 text-[12px] font-medium text-muted">
          {!a && !b ? t("tools.diff.differences") : changes === 0 ? t("tools.diff.noDifferences") : t("tools.diff.changedLines", { count: changes })}
        </span>
        <label className="flex items-center gap-1.5 text-[12px] text-muted">
          <input type="checkbox" checked={ignoreSpace} onChange={(e) => setIgnoreSpace(e.target.checked)} className="accent-[var(--accent)]" /> {t("tools.diff.ignoreSpaces")}
        </label>
        <label className="flex items-center gap-1.5 text-[12px] text-muted">
          <input type="checkbox" checked={ignoreCase} onChange={(e) => setIgnoreCase(e.target.checked)} className="accent-[var(--accent)]" /> {t("tools.diff.ignoreCase")}
        </label>
      </div>
      <div className="scroll-thin min-h-0 flex-1 overflow-auto rounded-md border border-line bg-bg py-2 font-mono text-[12.5px] leading-relaxed select-text">
        {rows.length ? (
          rows.map((row, i) => (
            <div key={i} className="grid grid-cols-2 divide-x divide-line">
              <Cell side="left" row={row} />
              <Cell side="right" row={row} />
            </div>
          ))
        ) : (
          <div className="px-4">
            <Hint>{t("tools.diff.empty")}</Hint>
          </div>
        )}
      </div>
    </div>
  );
}
