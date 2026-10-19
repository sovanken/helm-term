// Turns `git diff` unified output into side-by-side rows.

export interface Cell {
  no: number;
  text: string;
  kind: "context" | "del" | "add";
}

export type Row = { type: "hunk"; header: string } | { type: "line"; left?: Cell; right?: Cell };

export function parseUnified(diff: string): { rows: Row[]; binary: boolean } {
  const rows: Row[] = [];
  if (/^Binary files .* differ$/m.test(diff)) return { rows, binary: true };

  let oldNo = 0;
  let newNo = 0;
  let dels: Cell[] = [];
  let adds: Cell[] = [];
  const flush = () => {
    for (let i = 0; i < Math.max(dels.length, adds.length); i++) rows.push({ type: "line", left: dels[i], right: adds[i] });
    dels = [];
    adds = [];
  };

  let inHunk = false;
  for (const line of diff.split("\n")) {
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/.exec(line);
    if (hunk) {
      flush();
      oldNo = Number(hunk[1]);
      newNo = Number(hunk[2]);
      rows.push({ type: "hunk", header: hunk[3].trim() });
      inHunk = true;
      continue;
    }
    if (!inHunk || line.startsWith("\\")) continue; // "\ No newline at end of file"
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
