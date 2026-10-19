import { describe, expect, it } from "vitest";
import { computeRects, leaf, neighbor, paneIds, remove, setRatio, split, type LayoutNode } from "./layout";

describe("layout tree", () => {
  it("splits a pane and lists panes in order", () => {
    const root = split(leaf("a"), "a", "row", "b");
    expect(paneIds(root)).toEqual(["a", "b"]);
    const nested = split(root, "b", "column", "c");
    expect(paneIds(nested)).toEqual(["a", "b", "c"]);
  });

  it("removing a pane lets its sibling take the space", () => {
    const root = split(split(leaf("a"), "a", "row", "b"), "b", "column", "c");
    const after = remove(root, "b")!;
    expect(paneIds(after)).toEqual(["a", "c"]);
    expect(remove(leaf("a"), "a")).toBeNull();
  });

  it("computes rectangles that tile the whole area", () => {
    const root = split(leaf("a"), "a", "row", "b");
    const { panes, dividers } = computeRects(root);
    expect(panes.map((p) => p.rect)).toEqual([
      { x: 0, y: 0, w: 0.5, h: 1 },
      { x: 0.5, y: 0, w: 0.5, h: 1 },
    ]);
    expect(dividers).toHaveLength(1);
    expect(dividers[0].rect.x).toBe(0.5);
  });

  it("clamps split ratios so panes never disappear", () => {
    const root = split(leaf("a"), "a", "row", "b") as Extract<LayoutNode, { type: "split" }>;
    expect((setRatio(root, root.id, 0.01) as typeof root).ratio).toBe(0.15);
    expect((setRatio(root, root.id, 0.99) as typeof root).ratio).toBe(0.85);
  });

  it("finds the neighbour in a direction", () => {
    const root = split(split(leaf("a"), "a", "row", "b"), "b", "column", "c");
    expect(neighbor(root, "a", "right")).toBe("b");
    expect(neighbor(root, "b", "down")).toBe("c");
    expect(neighbor(root, "c", "up")).toBe("b");
    expect(neighbor(root, "a", "left")).toBeNull();
  });
});
