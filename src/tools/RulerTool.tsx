import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Camera, Minus, Plus } from "lucide-react";
import { ipc } from "../lib/ipc";
import { showToast } from "../state/store";
import { Button, CopyButton, Hint } from "./ui";

interface Shot {
  w: number;
  h: number;
  data: ImageData;
  url: string;
}

interface Pt {
  x: number;
  y: number;
}

const hex = (d: ImageData, p: Pt) => {
  const i = (Math.floor(p.y) * d.width + Math.floor(p.x)) * 4;
  return `#${[d.data[i], d.data[i + 1], d.data[i + 2]].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
};

/** Hides Helm, captures every screen, and shows Helm again. */
async function capture(): Promise<Shot> {
  const win = getCurrentWindow();
  await win.hide();
  await new Promise((r) => setTimeout(r, 300));
  let buf: ArrayBuffer;
  try {
    buf = await ipc.captureScreen();
  } finally {
    await win.show();
    await win.setFocus();
  }
  const view = new DataView(buf);
  const w = view.getUint32(0, true);
  const h = view.getUint32(4, true);
  const px = new Uint8ClampedArray(buf, 8, w * h * 4);
  // Windows gives blue-green-red; the canvas wants red-green-blue, fully opaque.
  for (let i = 0; i < px.length; i += 4) {
    const b = px[i];
    px[i] = px[i + 2];
    px[i + 2] = b;
    px[i + 3] = 255;
  }
  const data = new ImageData(px, w, h);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  canvas.getContext("2d")!.putImageData(data, 0, 0);
  const blob = await new Promise<Blob>((r) => canvas.toBlob((b) => r(b!), "image/png"));
  return { w, h, data, url: URL.createObjectURL(blob) };
}

function Loupe({ shot, at }: { shot: Shot; at: Pt }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const ctx = ref.current?.getContext("2d");
    if (!ctx) return;
    const n = 15;
    const size = 135;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, size, size);
    const tmp = document.createElement("canvas");
    tmp.width = n;
    tmp.height = n;
    const sx = Math.floor(at.x) - 7;
    const sy = Math.floor(at.y) - 7;
    tmp.getContext("2d")!.putImageData(shot.data, -sx, -sy, sx, sy, n, n);
    ctx.drawImage(tmp, 0, 0, size, size);
    ctx.strokeStyle = "#e7a85a";
    ctx.lineWidth = 2;
    ctx.strokeRect(7 * 9, 7 * 9, 9, 9);
  }, [shot, at]);
  return <canvas ref={ref} width={135} height={135} className="rounded-md border border-line" />;
}

export default function RulerTool() {
  const { t } = useTranslation();
  const [shot, setShot] = useState<Shot | null>(null);
  const [busy, setBusy] = useState(false);
  const [zoom, setZoom] = useState(0);
  const [hover, setHover] = useState<Pt | null>(null);
  const [start, setStart] = useState<Pt | null>(null);
  const [end, setEnd] = useState<Pt | null>(null);
  const [dragging, setDragging] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(1);

  useEffect(() => () => void (shot && URL.revokeObjectURL(shot.url)), [shot]);

  useEffect(() => {
    if (!shot || !box.current) return;
    const r = box.current.getBoundingClientRect();
    setFit(Math.min(1, (r.width - 24) / shot.w, (r.height - 24) / shot.h));
  }, [shot]);

  const scale = zoom === 0 ? fit : zoom;

  const take = async () => {
    setBusy(true);
    try {
      setShot(await capture());
      setStart(null);
      setEnd(null);
      setZoom(0);
    } catch (e) {
      showToast(String(e), "error");
    } finally {
      setBusy(false);
    }
  };

  const toImage = (e: React.PointerEvent<HTMLElement>): Pt => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = Math.min(shot!.w - 1, Math.max(0, ((e.clientX - r.left) / r.width) * shot!.w));
    const y = Math.min(shot!.h - 1, Math.max(0, ((e.clientY - r.top) / r.height) * shot!.h));
    return { x: Math.floor(x), y: Math.floor(y) };
  };

  if (!shot)
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-5 text-center">
        <Camera size={28} className="text-faint" />
        <p className="max-w-md text-[13px] text-muted">{t("tools.ruler.intro")}</p>
        <Button primary onClick={() => void take()} disabled={busy}>
          <Camera size={13} /> {t("tools.ruler.capture")}
        </Button>
      </div>
    );

  const w = start && end ? Math.abs(end.x - start.x) + 1 : 0;
  const h = start && end ? Math.abs(end.y - start.y) + 1 : 0;
  const dpr = window.devicePixelRatio || 1;
  const rect = start && end ? { x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), w, h } : null;

  return (
    <div className="flex h-full">
      <div ref={box} className="scroll-thin min-w-0 flex-1 overflow-auto bg-black/40 p-3">
        <div
          className="relative cursor-crosshair touch-none"
          style={{ width: shot.w * scale, height: shot.h * scale }}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            const p = toImage(e);
            setStart(p);
            setEnd(p);
            setDragging(true);
          }}
          onPointerMove={(e) => {
            const p = toImage(e);
            setHover(p);
            if (dragging) setEnd(p);
          }}
          onPointerUp={() => setDragging(false)}
          onPointerLeave={() => setHover(null)}
        >
          <img src={shot.url} alt={t("tools.ruler.captureAlt")} draggable={false} className="absolute inset-0 size-full select-none" style={{ imageRendering: scale >= 2 ? "pixelated" : "auto" }} />
          {rect && (
            <div
              className="pointer-events-none absolute border border-accent bg-accent/15"
              style={{ left: rect.x * scale, top: rect.y * scale, width: rect.w * scale, height: rect.h * scale }}
            >
              {(w > 1 || h > 1) && (
                <span className="absolute -top-6 left-0 rounded bg-accent px-1.5 py-0.5 font-mono text-[11px] whitespace-nowrap text-on-accent">
                  {w} × {h}
                </span>
              )}
            </div>
          )}
        </div>
      </div>
      <aside className="flex w-64 shrink-0 flex-col gap-4 border-l border-line p-4">
        <div className="flex items-center gap-2">
          <Button onClick={() => void take()} disabled={busy}>
            <Camera size={13} /> {t("tools.ruler.newCapture")}
          </Button>
          <span className="flex-1" />
          <button aria-label={t("tools.ruler.zoomOut")} onClick={() => setZoom(Math.max(0.1, scale / 1.5))} className="flex size-7 items-center justify-center rounded-md text-muted hover:bg-hover hover:text-fg">
            <Minus size={14} />
          </button>
          <button onClick={() => setZoom(zoom === 0 ? 1 : 0)} className="w-11 text-center text-[12px] text-muted tabular-nums hover:text-fg" title={t("tools.ruler.fitTitle")}>
            {Math.round(scale * 100)}%
          </button>
          <button aria-label={t("tools.ruler.zoomIn")} onClick={() => setZoom(Math.min(8, scale * 1.5))} className="flex size-7 items-center justify-center rounded-md text-muted hover:bg-hover hover:text-fg">
            <Plus size={14} />
          </button>
        </div>
        <div>
          <p className="mb-1 text-[12px] font-medium text-muted">{t("tools.ruler.measured")}</p>
          {w > 1 || h > 1 ? (
            <>
              <div className="flex items-center gap-2">
                <span className="flex-1 font-mono text-[20px] font-semibold text-fg">
                  {w} × {h}
                </span>
                <CopyButton text={`${w} × ${h}`} small />
              </div>
              <p className="text-[12px] text-faint">{t("tools.ruler.screenPixels", { diagonal: Math.round(Math.hypot(w, h)) })}</p>
              {dpr !== 1 && (
                <p className="mt-1 text-[12px] text-muted">
                  {t("tools.ruler.cssPixels", { w: Math.round(w / dpr), h: Math.round(h / dpr), scaling: Math.round(dpr * 100) })}
                </p>
              )}
            </>
          ) : (
            <Hint>{t("tools.ruler.dragHint")}</Hint>
          )}
        </div>
        {(hover ?? end) && (
          <div>
            <p className="mb-1.5 text-[12px] font-medium text-muted">{hover ? t("tools.ruler.underPointer") : t("tools.ruler.lastPoint")}</p>
            <Loupe shot={shot} at={(hover ?? end)!} />
            <div className="mt-2 flex items-center gap-2">
              <span className="size-5 rounded border border-line" style={{ background: hex(shot.data, (hover ?? end)!) }} />
              <code className="flex-1 font-mono text-[12.5px] text-fg">{hex(shot.data, (hover ?? end)!)}</code>
              <CopyButton text={hex(shot.data, (end ?? hover)!)} small label={t("tools.ruler.copyLastColor")} />
            </div>
            <p className="mt-1 font-mono text-[11px] text-faint">
              x {(hover ?? end)!.x}, y {(hover ?? end)!.y}
            </p>
          </div>
        )}
        <span className="flex-1" />
        <Hint>{t("tools.ruler.footer")}</Hint>
      </aside>
    </div>
  );
}
