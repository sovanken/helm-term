import { describe, expect, it } from "vitest";
import { contrast, formats, parseColor } from "./color";
import { jsonErrorAt, jsonToTypes, lineCol } from "./jsonTypes";

describe("colour tools", () => {
  it("reads the common ways of writing a colour", () => {
    expect(parseColor("#f63")).toEqual({ r: 255, g: 102, b: 51, a: 1 });
    expect(parseColor("rgb(255 99 71 / 50%)")).toEqual({ r: 255, g: 99, b: 71, a: 0.5 });
    expect(parseColor("hsl(9 100% 64%)")).toMatchObject({ r: 255, g: 99, b: 71 });
    expect(parseColor("nope(1,2,3)")).toBeNull();
  });
  it("round-trips through OKLCH", () => {
    const tomato = parseColor("#ff6347")!;
    const oklch = formats(tomato).find((f) => f.label === "OKLCH")!.value;
    expect(parseColor(oklch)).toMatchObject({ r: 255, g: 99, b: 71 });
  });
  it("gives WCAG contrast ratios", () => {
    expect(contrast(parseColor("#000")!, parseColor("#fff")!)).toBeCloseTo(21, 5);
    expect(contrast(parseColor("#777")!, parseColor("#fff")!)).toBeCloseTo(4.48, 2);
  });
  it("copies as Flutter with alpha first", () => {
    expect(formats(parseColor("#ff634780")!).find((f) => f.label === "Flutter")!.value).toBe("Color(0x80FF6347)");
  });
});

describe("JSON tools", () => {
  it("points at the line and column of a mistake", () => {
    const text = '{"a": 1,\n  "b": }';
    const err = jsonErrorAt(text)!;
    expect(lineCol(text, err.pos)).toEqual({ line: 2, col: 8 });
    expect(jsonErrorAt('{"a": [1, 2,]}')!.message).toBe("extra comma before ]");
    expect(jsonErrorAt("{'a': 1}")!.message).toContain("quoted");
    expect(jsonErrorAt('{"a": [1, {"b": null}], "c": "\u00e9"}')).toBeNull();
  });
  it("writes TypeScript types, merging array items", () => {
    const ts = jsonToTypes({ users: [{ id: 1, name: "A" }, { id: 2, email: null }] });
    expect(ts).toContain("export interface Root {\n  users: User[];\n}");
    expect(ts).toContain("  id: number;\n  name?: string;\n  email?: null;");
  });
});

import { tokens } from "../lib/format";
describe("number formatting", () => {
  it("keeps whole numbers whole", () => {
    expect(tokens(100_000)).toBe("100k");
    expect(tokens(3_000_000_000)).toBe("3B");
    expect(tokens(300_000_000)).toBe("300M");
    expect(tokens(2_500_000)).toBe("2.5M");
    expect(tokens(12_340)).toBe("12.3k");
    expect(tokens(999)).toBe("999");
  });
});
