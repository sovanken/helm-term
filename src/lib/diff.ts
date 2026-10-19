// Turns `git diff` unified output into side-by-side rows, and single-hunk patches for undo.

export interface Cell {
  no: number;
  text: string;
  kind: "context" | "del" | "add";
}

export type Row = { type: "hunk"; header: string; index: number } | { type: "line"; left?: Cell; right?: Cell };

const HUNK_RE = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/;

export function parseUnified(diff: string): { rows: Row[]; binary: boolean } {
  const rows: Row[] = [];
  if (/^Binary files .* differ$/m.test(diff)) return { rows, binary: true };

  let oldNo = 0;
  let newNo = 0;
  let dels: Cell[] = [];
  let adds: Cell[] = [];
  let index = -1;
  const flush = () => {
    for (let i = 0; i < Math.max(dels.length, adds.length); i++) rows.push({ type: "line", left: dels[i], right: adds[i] });
    dels = [];
    adds = [];
  };

  for (const line of diff.split("\n")) {
    const hunk = HUNK_RE.exec(line.replace(/\r$/, ""));
    if (hunk) {
      flush();
      oldNo = Number(hunk[1]);
      newNo = Number(hunk[2]);
      rows.push({ type: "hunk", header: hunk[3].trim(), index: ++index });
      continue;
    }
    if (index < 0 || line.startsWith("\\")) continue; // "\ No newline at end of file"
    const text = line.slice(1).replace(/\r$/, "");
    if (line.startsWith("-")) dels.push({ no: oldNo++, text, kind: "del" });
    else if (line.startsWith("+")) adds.push({ no: newNo++, text, kind: "add" });
    else if (line.startsWith(" ")) {
      flush();
      rows.push({ type: "line", left: { no: oldNo++, text, kind: "context" }, right: { no: newNo++, text, kind: "context" } });
    }
  }
  flush();
  return { rows, binary: false };
}

/** The file's diff header plus only hunk `index`, kept byte-exact so `git apply` accepts it. */
export function singleHunkPatch(diff: string, index: number): string | null {
  const lines = diff.split("\n");
  const first = lines.findIndex((l) => HUNK_RE.test(l.replace(/\r$/, "")));
  if (first < 0) return null;
  const header = lines.slice(0, first);
  const starts = lines.map((l, i) => (HUNK_RE.test(l.replace(/\r$/, "")) ? i : -1)).filter((i) => i >= 0);
  const start = starts[index];
  if (start === undefined) return null;
  const end = starts[index + 1] ?? lines.length;
  const body = lines.slice(start, end);
  while (body.length && body[body.length - 1] === "") body.pop();
  return [...header, ...body].join("\n") + "\n";
}
