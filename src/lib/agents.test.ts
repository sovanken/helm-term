import { describe, expect, it, vi } from "vitest";
import { burnRate, describeSuggestions, formatCountdown, minutesToLimit, toolSummary, toolVerb } from "./agents";
import { fuzzyScore } from "./fuzzy";

describe("tool descriptions", () => {
  it("summarises the most useful input field", () => {
    expect(toolSummary("Bash", { command: "npm test\nsecond line" })).toBe("npm test");
    expect(toolSummary("Write", { file_path: "C:/repo/a.ts", content: "x" })).toBe("C:/repo/a.ts");
    expect(toolSummary("Unknown", null)).toBe("");
  });

  it("uses plain verbs", () => {
    expect(toolVerb("Bash")).toBe("run a command");
    expect(toolVerb("Edit")).toBe("change a file");
    expect(toolVerb("mcp__github__create_issue")).toBe("use github tool");
  });

  it("describes 'Always allow' suggestions in plain words", () => {
    expect(describeSuggestions([{ type: "setMode", mode: "acceptEdits", destination: "session" }])).toBe("accept file edits for the rest of this session");
    expect(describeSuggestions([{ type: "addRules", rules: [{ toolName: "Bash", ruleContent: "npm test:*" }], behavior: "allow", destination: "localSettings" }])).toBe(
      "Bash(npm test:*) in this project (only you)",
    );
  });
});

describe("usage math", () => {
  it("formats countdowns", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-19T10:00:00Z"));
    const now = Date.now() / 1000;
    expect(formatCountdown(now + 90 * 60)).toBe("1h 30m");
    expect(formatCountdown(now + 3 * 86400 + 2 * 3600)).toBe("3d 2h");
    expect(formatCountdown(undefined)).toBeNull();
    vi.useRealTimers();
  });

  it("computes the burn rate and time to the limit", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-19T10:00:00Z"));
    const t = Date.now();
    const usage = { updatedAt: t, samples: [{ t: t - 20 * 60_000, pct: 40 }, { t, pct: 50 }] };
    expect(burnRate(usage)).toBeCloseTo(30); // 10 points in 20 minutes
    // 50 points left at 30/h = 100 min, and the window resets in 3 h → warn.
    expect(minutesToLimit({ pct: 50, resetsAt: t / 1000 + 3 * 3600 }, 30)).toBe(100);
    // Resets in 1 h, before the limit → no warning.
    expect(minutesToLimit({ pct: 50, resetsAt: t / 1000 + 3600 }, 30)).toBeNull();
    vi.useRealTimers();
  });
});

describe("fuzzy search", () => {
  it("ranks direct and word-start matches first", () => {
    expect(fuzzyScore("split", "Split right")).toBeGreaterThan(fuzzyScore("split", "Show splits"));
    expect(fuzzyScore("nct", "New Claude tab")).toBeGreaterThan(0);
    expect(fuzzyScore("xyz", "New Claude tab")).toBe(-1);
  });
});
