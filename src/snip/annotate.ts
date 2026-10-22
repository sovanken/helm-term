/** Screenshot annotations: shapes in image pixels, drawn onto a canvas (for display and export). */

export type Tool = "arrow" | "rect" | "ellipse" | "line" | "pen" | "highlight" | "text" | "step" | "blur" | "redact" | "crop";

export interface Pt {
  x: number;
  y: number;
}

export type Shape =
  | { kind: "arrow" | "rect" | "ellipse" | "line" | "blur" | "redact"; a: Pt; b: Pt; color: string; width: number }
  | { kind: "pen" | "highlight"; points: Pt[]; color: string; width: number }
  | { kind: "text"; at: Pt; text: string; color: string; size: number }
  | { kind: "step"; at: Pt; n: number; color: string; size: number };

export interface Crop {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const COLORS = ["#ef4444", "#f59e0b", "#22c55e", "#3b82f6", "#a855f7", "#111827", "#ffffff"];

/** Normalised rectangle from two corners. */
export function box(a: Pt, b: Pt) {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
}

function arrow(ctx: CanvasRenderingContext2D, a: Pt, b: Pt, width: number) {
  const angle = Math.atan2(b.y - a.y, b.x - a.x);
  const head = Math.max(10, width * 4);
  // Stop the line short of the tip so the head stays sharp.
  const end = { x: b.x - Math.cos(angle) * head * 0.6, y: b.y - Math.sin(angle) * head * 0.6 };
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(end.x, end.y);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(b.x, b.y);
  ctx.lineTo(b.x - head * Math.cos(angle - Math.PI / 7), b.y - head * Math.sin(angle - Math.PI / 7));
  ctx.lineTo(b.x - head * Math.cos(angle + Math.PI / 7), b.y - head * Math.sin(angle + Math.PI / 7));
  ctx.closePath();
  ctx.fill();
}

/** Pixelates a part of what's already drawn (from `image`, so earlier blurs don't stack oddly). */
function pixelate(ctx: CanvasRenderingContext2D, image: CanvasImageSource, r: ReturnType<typeof box>, scale: number) {
  if (r.w < 2 || r.h < 2) return;
  const block = Math.max(6, Math.round(10 * scale));
  const small = document.createElement("canvas");
  small.width = Math.max(1, Math.ceil(r.w / block));
  small.height = Math.max(1, Math.ceil(r.h / block));
  small.getContext("2d")!.drawImage(image, r.x, r.y, r.w, r.h, 0, 0, small.width, small.height);
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(small, 0, 0, small.width, small.height, r.x, r.y, r.w, r.h);
  ctx.restore();
}

/** Draws the image and every shape, in image pixels (the caller sets any scale on `ctx`). */
export function render(ctx: CanvasRenderingContext2D, image: HTMLImageElement | HTMLCanvasElement, shapes: Shape[], scale: number) {
  ctx.drawImage(image, 0, 0);
  for (const s of shapes) {
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    if (s.kind === "blur") pixelate(ctx, image, box(s.a, s.b), scale);
    else if (s.kind === "redact") {
      const r = box(s.a, s.b);
      ctx.fillStyle = "#000";
      ctx.fillRect(r.x, r.y, r.w, r.h);
    } else if (s.kind === "text") {
      ctx.font = `600 ${s.size}px "Inter Variable", "Segoe UI", sans-serif`;
      ctx.textBaseline = "top";
      // A thin outline keeps text readable on any background.
      ctx.lineWidth = Math.max(2, s.size / 7);
      ctx.strokeStyle = s.color === "#ffffff" ? "rgba(0,0,0,0.75)" : "rgba(255,255,255,0.85)";
      s.text.split("\n").forEach((line, i) => {
        ctx.strokeText(line, s.at.x, s.at.y + i * s.size * 1.25);
        ctx.fillStyle = s.color;
        ctx.fillText(line, s.at.x, s.at.y + i * s.size * 1.25);
      });
    } else if (s.kind === "step") {
      const r = s.size;
      ctx.beginPath();
      ctx.arc(s.at.x, s.at.y, r, 0, Math.PI * 2);
      ctx.fillStyle = s.color;
      ctx.fill();
      ctx.lineWidth = Math.max(2, r / 6);
      ctx.strokeStyle = "#fff";
      ctx.stroke();
      ctx.fillStyle = s.color === "#ffffff" ? "#111827" : "#fff";
      ctx.font = `700 ${r * 1.15}px "Inter Variable", "Segoe UI", sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(s.n), s.at.x, s.at.y + r * 0.05);
    } else if (s.kind === "pen" || s.kind === "highlight") {
      ctx.strokeStyle = s.color;
      ctx.lineWidth = s.kind === "highlight" ? s.width * 4 : s.width;
      if (s.kind === "highlight") ctx.globalAlpha = 0.35;
      ctx.beginPath();
      s.points.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.stroke();
    } else if ("a" in s) {
      ctx.strokeStyle = s.color;
      ctx.fillStyle = s.color;
      ctx.lineWidth = s.width;
      const r = box(s.a, s.b);
      if (s.kind === "rect") {
        ctx.beginPath();
        ctx.roundRect(r.x, r.y, r.w, r.h, s.width);
        ctx.stroke();
      } else if (s.kind === "ellipse") {
        ctx.beginPath();
        ctx.ellipse(r.x + r.w / 2, r.y + r.h / 2, r.w / 2, r.h / 2, 0, 0, Math.PI * 2);
        ctx.stroke();
      } else if (s.kind === "line") {
        ctx.beginPath();
        ctx.moveTo(s.a.x, s.a.y);
        ctx.lineTo(s.b.x, s.b.y);
        ctx.stroke();
      } else if (s.kind === "arrow") arrow(ctx, s.a, s.b, s.width);
    }
    ctx.restore();
  }
}

/** The finished picture (crop applied) as a PNG blob. */
export async function exportPng(image: HTMLImageElement, shapes: Shape[], crop: Crop | null, scale: number): Promise<Blob> {
  const full = document.createElement("canvas");
  full.width = image.naturalWidth;
  full.height = image.naturalHeight;
  render(full.getContext("2d")!, image, shapes, scale);
  const c = crop ?? { x: 0, y: 0, w: full.width, h: full.height };
  const out = document.createElement("canvas");
  out.width = Math.max(1, Math.round(c.w));
  out.height = Math.max(1, Math.round(c.h));
  out.getContext("2d")!.drawImage(full, Math.round(c.x), Math.round(c.y), out.width, out.height, 0, 0, out.width, out.height);
  return new Promise((resolve) => out.toBlob((b) => resolve(b!), "image/png"));
}
