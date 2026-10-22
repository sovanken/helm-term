import { describe, expect, it } from "vitest";
import { parseSettings } from "./settingsJson";

describe("settings.json", () => {
  it("reads settings with comments and trailing commas", () => {
    const r = parseSettings('// mine\n{\n  "theme": "light", // brighter\n  "fontSize": 16,\n}\n');
    expect(r.broken).toBe(false);
    expect(r.values).toEqual({ theme: "light", fontSize: 16 });
    expect(r.problems).toEqual([]);
  });

  it("keeps good settings and marks bad ones", () => {
    const text = '{ "theme": "purple", "fontSize": 16, "nope": 1, "gpu": "yes" }';
    const r = parseSettings(text);
    expect(r.values).toEqual({ fontSize: 16 });
    expect(r.problems.map((p) => p.message)).toEqual([
      '"theme" must be one of: "dark", "light", "system".',
      "\"nope\" isn't a Helm setting.",
      '"gpu" must be true or false.',
    ]);
    expect(text.slice(r.problems[0].from, r.problems[0].to)).toBe('"theme"');
  });

  it("checks number ranges", () => {
    expect(parseSettings('{ "uiScale": 3 }').problems[0].message).toBe('"uiScale" must be between 0.8 and 1.5.');
  });

  it("reports a broken file without applying anything", () => {
    const r = parseSettings('{ "theme": "light" "fontSize": 16 }');
    expect(r.broken).toBe(true);
    expect(r.values).toEqual({});
    expect(r.problems[0].message).toBe("A comma is missing here.");
  });
});
