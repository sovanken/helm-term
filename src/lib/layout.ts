// Split-pane layout as a binary tree. Panes are rendered flat from computed rectangles so
// terminals never remount when the tree changes shape.

export type SplitDir = "row" | "column";

export type LayoutNode =
  | { type: "pane"; paneId: string }
  | { type: "split"; id: string; dir: SplitDir; ratio: number; a: LayoutNode; b: LayoutNode };

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PaneRect {
  paneId: string;
  rect: Rect;
}

export interface DividerRect {
  splitId: string;
  dir: SplitDir;
  /** Position of the divider line (fraction of the tab area). */
  rect: Rect;
  /** The split's own area, used to turn a drag position into a ratio. */
  parent: Rect;
}

export function leaf(paneId: string): LayoutNode {
  return { type: "pane", paneId };
}

export function computeRects(
  node: LayoutNode,
  rect: Rect = { x: 0, y: 0, w: 1, h: 1 },
  panes: PaneRect[] = [],
  dividers: DividerRect[] = [],
) {
  if (node.type === "pane") {
    panes.push({ paneId: node.paneId, rect });
  } else if (node.dir === "row") {
    const aw = rect.w * node.ratio;
    computeRects(node.a, { ...rect, w: aw }, panes, dividers);
    computeRects(node.b, { ...rect, x: rect.x + aw, w: rect.w - aw }, panes, dividers);
    dividers.push({ splitId: node.id, dir: "row", rect: { x: rect.x + aw, y: rect.y, w: 0, h: rect.h }, parent: rect });
  } else {
    const ah = rect.h * node.ratio;
    computeRects(node.a, { ...rect, h: ah }, panes, dividers);
    computeRects(node.b, { ...rect, y: rect.y + ah, h: rect.h - ah }, panes, dividers);
    dividers.push({ splitId: node.id, dir: "column", rect: { x: rect.x, y: rect.y + ah, w: rect.w, h: 0 }, parent: rect });
  }
  return { panes, dividers };
}

export function paneIds(node: LayoutNode): string[] {
  return node.type === "pane" ? [node.paneId] : [...paneIds(node.a), ...paneIds(node.b)];
}

export function split(node: LayoutNode, paneId: string, dir: SplitDir, newPaneId: string): LayoutNode {
  if (node.type === "pane") {
    return node.paneId === paneId
      ? { type: "split", id: crypto.randomUUID(), dir, ratio: 0.5, a: node, b: leaf(newPaneId) }
      : node;
  }
  return { ...node, a: split(node.a, paneId, dir, newPaneId), b: split(node.b, paneId, dir, newPaneId) };
}

/** Removes a pane; its sibling takes the parent's place. Returns null when the tree is empty. */
export function remove(node: LayoutNode, paneId: string): LayoutNode | null {
  if (node.type === "pane") return node.paneId === paneId ? null : node;
  const a = remove(node.a, paneId);
  const b = remove(node.b, paneId);
  if (!a) return b;
  if (!b) return a;
  return { ...node, a, b };
}

export function setRatio(node: LayoutNode, splitId: string, ratio: number): LayoutNode {
  if (node.type === "pane") return node;
  if (node.id === splitId) return { ...node, ratio: Math.min(0.85, Math.max(0.15, ratio)) };
  return { ...node, a: setRatio(node.a, splitId, ratio), b: setRatio(node.b, splitId, ratio) };
}

export type Direction = "left" | "right" | "up" | "down";

/** Finds the closest pane in a direction from the given pane. */
export function neighbor(node: LayoutNode, paneId: string, dir: Direction): string | null {
  const { panes } = computeRects(node);
  const from = panes.find((p) => p.paneId === paneId)?.rect;
  if (!from) return null;
  const cx = from.x + from.w / 2;
  const cy = from.y + from.h / 2;
  const eps = 1e-6;
  let best: { id: string; dist: number } | null = null;
  for (const { paneId: id, rect: r } of panes) {
    if (id === paneId) continue;
    const ok =
      (dir === "left" && r.x + r.w <= from.x + eps) ||
      (dir === "right" && r.x >= from.x + from.w - eps) ||
      (dir === "up" && r.y + r.h <= from.y + eps) ||
      (dir === "down" && r.y >= from.y + from.h - eps);
    if (!ok) continue;
    const dist = Math.hypot(r.x + r.w / 2 - cx, r.y + r.h / 2 - cy);
    if (!best || dist < best.dist) best = { id, dist };
  }
  return best?.id ?? null;
}
