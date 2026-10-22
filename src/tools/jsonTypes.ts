/** TypeScript interfaces from a JSON sample. Objects in arrays are merged; keys missing from some become optional. */
import { t } from "../i18n";

const pascal = (s: string) =>
  s
    .replace(/[^a-zA-Z0-9]+(.)?/g, (_, c: string | undefined) => (c ? c.toUpperCase() : ""))
    .replace(/^[a-z]/, (c) => c.toUpperCase())
    .replace(/^(\d)/, "_$1") || "Item";

const singular = (s: string) => (s.endsWith("ies") ? `${s.slice(0, -3)}y` : s.endsWith("s") && !s.endsWith("ss") ? s.slice(0, -1) : s);

const safeKey = (k: string) => (/^[A-Za-z_$][\w$]*$/.test(k) ? k : JSON.stringify(k));

export function jsonToTypes(value: unknown, rootName = "Root"): string {
  const out: string[] = [];
  const used = new Set<string>();

  const uniqueName = (base: string) => {
    let name = pascal(base);
    for (let i = 2; used.has(name); i++) name = `${pascal(base)}${i}`;
    used.add(name);
    return name;
  };

  function typeOf(v: unknown, name: string): string {
    if (v === null) return "null";
    if (Array.isArray(v)) return arrayType(v, name);
    if (typeof v === "object") return objectType([v as Record<string, unknown>], name);
    return typeof v;
  }

  function arrayType(items: unknown[], name: string): string {
    if (!items.length) return "unknown[]";
    const objects = items.filter((x): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x));
    const others = items.filter((x) => !(x && typeof x === "object" && !Array.isArray(x)));
    const types = new Set(others.map((x) => typeOf(x, singular(name))));
    if (objects.length) types.add(objectType(objects, singular(name)));
    const union = [...types].join(" | ");
    return types.size > 1 ? `(${union})[]` : `${union}[]`;
  }

  function objectType(samples: Record<string, unknown>[], name: string): string {
    const typeName = uniqueName(name);
    const keys = [...new Set(samples.flatMap((s) => Object.keys(s)))];
    const lines = keys.map((k) => {
      const present = samples.filter((s) => k in s);
      const optional = present.length < samples.length;
      const values = present.map((s) => s[k]);
      const objs = values.filter((x): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x));
      const types = new Set(values.filter((x) => !(x && typeof x === "object" && !Array.isArray(x))).map((x) => typeOf(x, k)));
      if (objs.length) types.add(objectType(objs, k));
      return `  ${safeKey(k)}${optional ? "?" : ""}: ${[...types].join(" | ")};`;
    });
    out.push(`export interface ${typeName} {\n${lines.join("\n")}\n}`);
    return typeName;
  }

  const root = typeOf(value, rootName);
  if (!out.length || root !== pascal(rootName)) out.push(`export type ${uniqueName(rootName)} = ${root};`);
  // Nested types are pushed before their parents; show the root first.
  return out.reverse().join("\n\n");
}

/** Line and column (1-based) of a character position. */
export function lineCol(text: string, pos: number) {
  const before = text.slice(0, pos).split("\n");
  return { line: before.length, col: before[before.length - 1].length + 1 };
}

/** Finds where JSON text first goes wrong (the browser's own message often has no position). */
export function jsonErrorAt(text: string): { pos: number; message: string } | null {
  let i = 0;
  const fail = (message: string): never => {
    throw { pos: i, message };
  };
  const space = () => {
    while (i < text.length && " \t\n\r".includes(text[i])) i++;
  };
  const found = () => (i >= text.length ? t("tools.json.errors.endsEarly") : JSON.stringify(text[i]));
  const describe = () => (i >= text.length ? t("tools.json.errors.endsEarly") : t("tools.json.errors.unexpected", { char: JSON.stringify(text[i]) }));
  const literal = (word: string) => (text.startsWith(word, i) ? (i += word.length) : fail(describe()));
  const string = () => {
    i++;
    while (i < text.length && text[i] !== '"') {
      if (text[i] === "\\") {
        i++;
        if (text[i] === "u") {
          if (!/^[0-9a-fA-F]{4}$/.test(text.slice(i + 1, i + 5))) fail(t("tools.json.errors.badUnicodeEscape"));
          i += 4;
        } else if (!'"\\/bfnrt'.includes(text[i] ?? "")) fail(t("tools.json.errors.badEscape"));
      } else if (text.charCodeAt(i) < 0x20) fail(t("tools.json.errors.controlChar"));
      i++;
    }
    if (i >= text.length) fail(t("tools.json.errors.unclosedString"));
    i++;
  };
  const number = () => {
    const m = text.slice(i).match(/^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/);
    if (!m) fail(describe());
    i += m![0].length;
  };
  const value = (): void => {
    space();
    const c = text[i];
    if (c === "{") {
      i++;
      space();
      if (text[i] === "}") return void i++;
      for (;;) {
        space();
        if (text[i] !== '"') fail(text[i] === "}" ? t("tools.json.errors.extraCommaObject") : t("tools.json.errors.expectedKey", { found: found() }));
        string();
        space();
        if (text[i] !== ":") fail(t("tools.json.errors.expectedColon"));
        i++;
        value();
        space();
        if (text[i] === ",") i++;
        else if (text[i] === "}") return void i++;
        else fail(t("tools.json.errors.expectedCommaObject", { problem: describe() }));
      }
    }
    if (c === "[") {
      i++;
      space();
      if (text[i] === "]") return void i++;
      for (;;) {
        space();
        if (text[i] === "]") fail(t("tools.json.errors.extraCommaArray"));
        value();
        space();
        if (text[i] === ",") i++;
        else if (text[i] === "]") return void i++;
        else fail(t("tools.json.errors.expectedCommaArray", { problem: describe() }));
      }
    }
    if (c === '"') return string();
    if (c === "t") return void literal("true");
    if (c === "f") return void literal("false");
    if (c === "n") return void literal("null");
    if (c === "'") fail(t("tools.json.errors.singleQuotes"));
    return number();
  };
  try {
    value();
    space();
    if (i < text.length) fail(t("tools.json.errors.trailing"));
    return null;
  } catch (e) {
    return e as { pos: number; message: string };
  }
}
