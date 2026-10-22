import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { AppWindow, Lasso, Monitor, SquareDashed, X } from "lucide-react";

/** Runs in its own full-screen window ("snip"): the frozen screen, dimmed, to pick what to keep. */

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Info {
  originX: number;
  originY: number;
  width: number;
  height: number;
  monitors: Rect[];
  windows: { title: string; rect: Rect }[];
}

export type SnipMode = "area" | "window" | "screen" | "freeform";

/** Labels are translated where shown (snip.overlay.modes.<id>). */
const MODES: { id: SnipMode; icon: React.ReactNode; key: string }[] = [
  { id: "area", icon: <SquareDashed size={16} />, key: "1" },
  { id: "window", icon: <AppWindow size={16} />, key: "2" },
  { id: "screen", icon: <Monitor size={16} />, key: "3" },
  { id: "freeform", icon: <Lasso size={16} />, key: "4" },
];

function savedMode(): SnipMode {
  try {
    const m = localStorage.getItem("helm-snip-mode");
    return MODES.some((x) => x.id === m) ? (m as SnipMode) : "area";
  } catch {
    return "area";
  }
}

const inside = (r: Rect, x: number, y: number) => x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h;

export function SnipOverlay() {
  const { t } = useTranslation();
  const canvas = useRef<HTMLCanvasElement>(null);
  const source = useRef<HTMLCanvasElement | null>(null);
  const [info, setInfo] = useState<Info | null>(null);
  const [mode, setModeState] = useState<SnipMode>(savedMode);
  const [error, setError] = useState<string | null>(null);
  // Pointer, drag start and freeform path, in desktop pixels (relative to the desktop's top-left).
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const path = useRef<{ x: number; y: number }[]>([]);
  const frame = useRef(0);

  const setMode = (m: SnipMode) => {
    setModeState(m);
    drag.current = null;
    path.current = [];
    try {
      localStorage.setItem("helm-snip-mode", m);
    } catch {
      // Remembering the mode is only a convenience.
    }
  };

  const close = () => void invoke("snip_cancel");

  // Load the frozen screen, then show the window.
  useEffect(() => {
    document.getElementById("splash")?.remove();
    (async () => {
      try {
        const i = await invoke<Info>("snip_info");
        const buf = await invoke<ArrayBuffer>("snip_pixels");
        const view = new DataView(buf);
        const w = view.getUint32(0, true);
        const h = view.getUint32(4, true);
        const px = new Uint8ClampedArray(buf, 8, w * h * 4);
        for (let k = 0; k < px.length; k += 4) {
          const b = px[k];
          px[k] = px[k + 2];
          px[k + 2] = b;
          px[k + 3] = 255;
        }
        const c = document.createElement("canvas");
        c.width = w;
        c.height = h;
        c.getContext("2d")!.putImageData(new ImageData(px, w, h), 0, 0);
        source.current = c;
        setInfo(i);
        requestAnimationFrame(() => {
          const win = getCurrentWindow();
          void win.show().then(() => win.setFocus());
        });
      } catch (e) {
        setError(String(e));
        void getCurrentWindow().show();
      }
    })();
  }, []);

  /** Window or monitor under the pointer, in desktop pixels. */
  const hovered = useCallback((): Rect | null => {
    const p = pointer.current;
    if (!info || !p) return null;
    const sx = p.x + info.originX;
    const sy = p.y + info.originY;
    const list = mode === "window" ? info.windows.filter((w) => w.title !== "Helm snip").map((w) => w.rect) : mode === "screen" ? info.monitors : [];
    const hit = list.find((r) => inside(r, sx, sy));
    if (!hit) return null;
    // Clip to the desktop and make it relative to its top-left.
    const x = Math.max(hit.x - info.originX, 0);
    const y = Math.max(hit.y - info.originY, 0);
    return { x, y, w: Math.min(hit.x - info.originX + hit.w, info.width) - x, h: Math.min(hit.y - info.originY + hit.h, info.height) - y };
  }, [info, mode]);

  const selection = useCallback((): Rect | null => {
    const p = pointer.current;
    if (mode === "area" && drag.current && p) {
      const x = Math.min(drag.current.x, p.x);
      const y = Math.min(drag.current.y, p.y);
      return { x, y, w: Math.abs(p.x - drag.current.x) + 1, h: Math.abs(p.y - drag.current.y) + 1 };
    }
    if (mode === "freeform" && path.current.length > 1) {
      const xs = path.current.map((q) => q.x);
      const ys = path.current.map((q) => q.y);
      const x = Math.min(...xs);
      const y = Math.min(...ys);
      return { x, y, w: Math.max(...xs) - x + 1, h: Math.max(...ys) - y + 1 };
    }
    if (mode === "window" || mode === "screen") return hovered();
    return null;
  }, [mode, hovered]);

  // Draw: dimmed screen, the selection clear, its size, and a magnifier at the pointer.
  const draw = useCallback(() => {
    const c = canvas.current;
    const src = source.current;
    if (!c || !src || !info) return;
    const dpr = window.devicePixelRatio || 1;
    if (c.width !== Math.round(innerWidth * dpr)) {
      c.width = Math.round(innerWidth * dpr);
      c.height = Math.round(innerHeight * dpr);
    }
    const ctx = c.getContext("2d")!;
    const k = c.width / info.width; // desktop pixels → canvas pixels
    ctx.imageSmoothingEnabled = k < 1;
    ctx.drawImage(src, 0, 0, c.width, c.height);
    ctx.fillStyle = "rgba(0,0,0,0.45)";
    ctx.fillRect(0, 0, c.width, c.height);

    const sel = selection();
    if (sel) {
      ctx.save();
      ctx.beginPath();
      if (mode === "freeform") {
        path.current.forEach((q, i) => (i ? ctx.lineTo(q.x * k, q.y * k) : ctx.moveTo(q.x * k, q.y * k)));
        if (!drag.current) ctx.closePath();
      } else ctx.rect(sel.x * k, sel.y * k, sel.w * k, sel.h * k);
      ctx.clip();
      ctx.drawImage(src, 0, 0, c.width, c.height);
      ctx.restore();
      ctx.lineWidth = 1.5 * dpr;
      ctx.strokeStyle = "#e7a85a";
      if (mode === "freeform") {
        ctx.beginPath();
        path.current.forEach((q, i) => (i ? ctx.lineTo(q.x * k, q.y * k) : ctx.moveTo(q.x * k, q.y * k)));
        ctx.stroke();
      } else ctx.strokeRect(sel.x * k, sel.y * k, sel.w * k, sel.h * k);
      // Size label above the selection (or inside when at the top edge).
      const label = `${Math.round(sel.w)} × ${Math.round(sel.h)}`;
      ctx.font = `${12 * dpr}px "Segoe UI", sans-serif`;
      const tw = ctx.measureText(label).width + 12 * dpr;
      const lx = sel.x * k;
      const ly = sel.y * k > 26 * dpr ? sel.y * k - 24 * dpr : sel.y * k + 4 * dpr;
      ctx.fillStyle = "#e7a85a";
      ctx.beginPath();
      ctx.roundRect(lx, ly, tw, 20 * dpr, 4 * dpr);
      ctx.fill();
      ctx.fillStyle = "#14110b";
      ctx.fillText(label, lx + 6 * dpr, ly + 14 * dpr);
    }

    // Magnifier for precise area and freeform picks.
    const p = pointer.current;
    if (p && (mode === "area" || mode === "freeform")) {
      const zoom = 8;
      const n = 15;
      const size = n * zoom * dpr;
      let mx = p.x * k + 24 * dpr;
      let my = p.y * k + 24 * dpr;
      if (mx + size > c.width) mx = p.x * k - 24 * dpr - size;
      if (my + size + 22 * dpr > c.height) my = p.y * k - 24 * dpr - size - 22 * dpr;
      ctx.save();
      ctx.imageSmoothingEnabled = false;
      ctx.beginPath();
      ctx.roundRect(mx, my, size, size, 8 * dpr);
      ctx.clip();
      ctx.drawImage(src, Math.round(p.x) - 7, Math.round(p.y) - 7, n, n, mx, my, size, size);
      ctx.strokeStyle = "rgba(231,168,90,0.9)";
      ctx.lineWidth = 1 * dpr;
      ctx.strokeRect(mx + 7 * zoom * dpr, my + 7 * zoom * dpr, zoom * dpr, zoom * dpr);
      ctx.restore();
      ctx.strokeStyle = "rgba(255,255,255,0.8)";
      ctx.lineWidth = 1.5 * dpr;
      ctx.beginPath();
      ctx.roundRect(mx, my, size, size, 8 * dpr);
      ctx.stroke();
      const px = src.getContext("2d")!.getImageData(Math.round(p.x), Math.round(p.y), 1, 1).data;
      const hex = `#${[px[0], px[1], px[2]].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
      ctx.fillStyle = "rgba(20,20,22,0.9)";
      ctx.beginPath();
      ctx.roundRect(mx, my + size + 4 * dpr, size, 18 * dpr, 4 * dpr);
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.font = `${11 * dpr}px "Segoe UI", sans-serif`;
      ctx.fillText(`${Math.round(p.x)}, ${Math.round(p.y)}  ${hex}`, mx + 6 * dpr, my + size + 17 * dpr);
    }
  }, [info, mode, selection]);

  const redraw = useCallback(() => {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(draw);
  }, [draw]);

  useEffect(() => {
    redraw();
    window.addEventListener("resize", redraw);
    return () => window.removeEventListener("resize", redraw);
  }, [redraw]);

  const toDesktop = (e: React.PointerEvent) => {
    const k = info!.width / innerWidth;
    return { x: Math.max(0, Math.min(info!.width - 1, e.clientX * k)), y: Math.max(0, Math.min(info!.height - 1, e.clientY * k)) };
  };

  const finish = async (rect: Rect, freeform?: { x: number; y: number }[]) => {
    const src = source.current;
    if (!src || rect.w < 2 || rect.h < 2) return;
    const out = document.createElement("canvas");
    out.width = Math.round(rect.w);
    out.height = Math.round(rect.h);
    const ctx = out.getContext("2d")!;
    if (freeform) {
      ctx.beginPath();
      freeform.forEach((q, i) => (i ? ctx.lineTo(q.x - rect.x, q.y - rect.y) : ctx.moveTo(q.x - rect.x, q.y - rect.y)));
      ctx.closePath();
      ctx.clip();
    }
    ctx.drawImage(src, Math.round(rect.x), Math.round(rect.y), out.width, out.height, 0, 0, out.width, out.height);
    const blob = await new Promise<Blob>((r) => out.toBlob((b) => r(b!), "image/png"));
    await invoke("snip_finish", new Uint8Array(await blob.arrayBuffer()));
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      const m = MODES.find((x) => x.key === e.key);
      if (m) setMode(m.id);
      // Enter in full-screen mode keeps every screen.
      if (e.key === "Enter" && mode === "screen" && info) void finish({ x: 0, y: 0, w: info.width, h: info.height });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, info]);

  if (error)
    return (
      <div className="flex h-screen items-center justify-center bg-black/70 text-white">
        <div className="rounded-xl bg-neutral-900 p-5 text-center">
          <p className="mb-3 text-[13px]">{t("snip.overlay.captureFailed", { error })}</p>
          <button onClick={close} className="rounded-md bg-white/10 px-3 py-1.5 text-[13px]">
            {t("common.close")}
          </button>
        </div>
      </div>
    );

  return (
    <div className="fixed inset-0 cursor-crosshair select-none" style={{ background: "#000" }}>
      <canvas
        ref={canvas}
        className="absolute inset-0 size-full"
        onPointerDown={(e) => {
          if (!info || e.button !== 0) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          const p = toDesktop(e);
          pointer.current = p;
          if (mode === "area") drag.current = p;
          if (mode === "freeform") {
            drag.current = p;
            path.current = [p];
          }
          redraw();
        }}
        onPointerMove={(e) => {
          if (!info) return;
          const p = toDesktop(e);
          pointer.current = p;
          if (mode === "freeform" && drag.current) path.current.push(p);
          redraw();
        }}
        onPointerUp={() => {
          if (!info) return;
          const sel = selection();
          const free = mode === "freeform" ? [...path.current] : undefined;
          drag.current = null;
          if (sel) void finish(sel, free);
          else redraw();
        }}
        onContextMenu={(e) => (e.preventDefault(), close())}
      />
      {info && (
        <div className="absolute top-4 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-xl border border-white/10 bg-neutral-900/95 p-1 text-white shadow-2xl" style={{ cursor: "default" }}>
          {MODES.map((m) => (
            <button
              key={m.id}
              title={t("snip.withKey", { label: t(`snip.overlay.modes.${m.id}`), key: m.key })}
              onClick={() => setMode(m.id)}
              className={`flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[12.5px] ${mode === m.id ? "bg-white/15" : "text-white/75 hover:bg-white/10"}`}
            >
              {m.icon} {t(`snip.overlay.modes.${m.id}`)}
            </button>
          ))}
          {mode === "screen" && info.monitors.length > 1 && (
            <button onClick={() => void finish({ x: 0, y: 0, w: info.width, h: info.height })} className="h-8 rounded-lg px-2.5 text-[12.5px] text-white/75 hover:bg-white/10">
              {t("snip.overlay.allScreens")}
            </button>
          )}
          <span className="mx-1 h-5 w-px bg-white/15" />
          <button title={t("snip.overlay.cancelTitle")} aria-label={t("common.cancel")} onClick={close} className="flex size-8 items-center justify-center rounded-lg text-white/75 hover:bg-white/10">
            <X size={16} />
          </button>
        </div>
      )}
      {info && (
        <p className="pointer-events-none absolute bottom-5 left-1/2 -translate-x-1/2 rounded-lg bg-neutral-900/85 px-3 py-1.5 text-[12px] text-white/80">
          {t(`snip.overlay.hints.${mode}`)}
        </p>
      )}
    </div>
  );
}
