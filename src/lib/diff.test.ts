import { describe, expect, it } from "vitest";
import { parseUnified, singleHunkPatch } from "./diff";

const DIFF = [
  "diff --git a/app.py b/app.py",
  "index 1111111..2222222 100644",
  "--- a/app.py",
  "+++ b/app.py",
  "@@ -1,3 +1,3 @@ header one",
  " keep",
  "-old top",
  "+new top",
  " keep",
  "@@ -20,2 +20,3 @@",
  " context",
  "+added",
  " context",
  "",
].join("\n");

describe("parseUnified", () => {
  it("pairs removed and added lines side by side with line numbers", () => {
    const { rows, binary } = parseUnified(DIFF);
    expect(binary).toBe(false);
    const hunks = rows.filter((r) => r.type === "hunk");
    expect(hunks).toHaveLength(2);
    const changed = rows.find((r) => r.type === "line" && r.left?.kind === "del");
    expect(changed).toMatchObject({ left: { no: 2, text: "old top" }, right: { no: 2, text: "new top", kind: "add" } });
    const added = rows.find((r) => r.type === "line" && !r.left && r.right?.kind === "add");
    expect(added).toMatchObject({ right: { no: 21, text: "added" } });
  });

  it("detects binary files", () => {
    expect(parseUnified("Binary files a/x.png and b/x.png differ\n").binary).toBe(true);
  });

  it("strips Windows line endings from displayed text", () => {
    const { rows } = parseUnified("@@ -1 +1 @@\r\n-a\r\n+b\r\n");
    expect(rows[1]).toMatchObject({ left: { text: "a" }, right: { text: "b" } });
  });
});

describe("singleHunkPatch", () => {
  it("keeps the file header and only the chosen hunk", () => {
    const patch = singleHunkPatch(DIFF, 1)!;
    expect(patch.startsWith("diff --git a/app.py b/app.py\n")).toBe(true);
    expect(patch).toContain("@@ -20,2 +20,3 @@");
    expect(patch).not.toContain("old top");
    expect(patch.endsWith(" context\n")).toBe(true);
  });

  it("returns null for a hunk that doesn't exist", () => {
    expect(singleHunkPatch(DIFF, 5)).toBeNull();
    expect(singleHunkPatch("no hunks here", 0)).toBeNull();
  });
});
