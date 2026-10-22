// PDF file tabs, drawn page by page with pdf.js (the window's own PDF viewer can't be embedded).

import { useEffect, useRef, useState } from "react";
import { Minus, Plus } from "lucide-react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { useTranslation } from "react-i18next";
import { locale } from "../i18n";
import { ShimmerBlock } from "./Shimmer";

const ZOOMS = [0.5, 0.67, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3];

async function loadPdf(data: ArrayBuffer) {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  return pdfjs.getDocument({
    data: new Uint8Array(data),
    standardFontDataUrl: "/pdfjs/standard_fonts/",
    cMapUrl: "/pdfjs/cmaps/",
    wasmUrl: "/pdfjs/wasm/",
  });
}

/** One page: sized right away, drawn only once it scrolls near the view. */
function Page({ doc, number, scale, baseWidth, onVisible }: { doc: PDFDocumentProxy; number: number; scale: number; baseWidth: number; onVisible: (n: number) => void }) {
  const holder = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [near, setNear] = useState(number <= 2);
  const { t } = useTranslation();

  useEffect(() => {
    let alive = true;
    void doc.getPage(number).then((page) => {
      const vp = page.getViewport({ scale: 1 });
      if (alive) setSize({ w: vp.width, h: vp.height });
    });
    return () => {
      alive = false;
    };
  }, [doc, number]);

  useEffect(() => {
    const el = holder.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) setNear(true);
          if (e.intersectionRatio > 0.5) onVisible(number);
        }
      },
      { rootMargin: "600px 0px", threshold: [0, 0.5] },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [number, onVisible]);

  // Fit the page to the panel width at 100%, then apply the zoom.
  const fit = size ? (baseWidth / size.w) * scale : scale;
  useEffect(() => {
    if (!near || !size || !canvas.current) return;
    let task: { cancel: () => void } | null = null;
    let alive = true;
    void doc.getPage(number).then((page) => {
      if (!alive || !canvas.current) return;
      const dpr = window.devicePixelRatio || 1;
      const vp = page.getViewport({ scale: fit * dpr });
      const c = canvas.current;
      c.width = Math.floor(vp.width);
      c.height = Math.floor(vp.height);
      const render = page.render({ canvas: c, viewport: vp });
      task = render;
      render.promise.catch(() => {});
    });
    return () => {
      alive = false;
      task?.cancel();
    };
  }, [doc, number, near, size, fit]);

  const w = size ? size.w * fit : baseWidth * scale;
  const h = size ? size.h * fit : w * 1.3;
  return (
    <div ref={holder} className="mx-auto rounded-sm bg-white" style={{ width: w, height: h }} aria-label={t("pdf.page", { number })}>
      <canvas ref={canvas} style={{ width: w, height: h }} className="block" />
    </div>
  );
}

export function PdfView({ data }: { data: ArrayBuffer }) {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [failed, setFailed] = useState(false);
  const [zoom, setZoom] = useState(4); // index into ZOOMS (100%)
  const [current, setCurrent] = useState(1);
  const [width, setWidth] = useState(800);
  const scroller = useRef<HTMLDivElement>(null);
  const { t } = useTranslation();

  useEffect(() => {
    let alive = true;
    let task: Awaited<ReturnType<typeof loadPdf>> | null = null;
    setFailed(false);
    // pdf.js takes ownership of the buffer it's given, so hand it a copy.
    void loadPdf(data.slice(0)).then((t) => {
      task = t;
      if (!alive) return void t.destroy();
      t.promise.then(
        (d) => alive && setDoc(d),
        () => alive && setFailed(true),
      );
    }, () => alive && setFailed(true));
    return () => {
      alive = false;
      void task?.destroy();
    };
  }, [data]);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(Math.min(el.clientWidth - 48, 1000)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Ctrl + mouse wheel zooms the PDF instead of the whole window.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      e.stopPropagation();
      setZoom((z) => Math.max(0, Math.min(ZOOMS.length - 1, z + (e.deltaY < 0 ? 1 : -1))));
    };
    el.addEventListener("wheel", onWheel, { passive: false, capture: true });
    return () => el.removeEventListener("wheel", onWheel, { capture: true });
  }, []);

  if (failed) return <p className="p-6 text-center text-[13px] text-muted">{t("pdf.failed")}</p>;

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div ref={scroller} data-own-zoom className="scroll-thin min-h-0 flex-1 overflow-auto bg-hover/60 py-6">
        {!doc ? (
          <ShimmerBlock className="mx-auto aspect-[1/1.414] w-full max-w-2xl" />
        ) : (
          <div className="flex flex-col gap-4 px-6">
            {Array.from({ length: doc.numPages }, (_, i) => (
              <Page key={i} doc={doc} number={i + 1} scale={ZOOMS[zoom]} baseWidth={width} onVisible={setCurrent} />
            ))}
          </div>
        )}
      </div>
      {doc && (
        <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-lg border border-line bg-raised px-1.5 py-1 text-[12px] text-muted">
          <span className="px-1.5 tabular-nums">
            {t("pdf.pageOf", { current, total: doc.numPages })}
          </span>
          <span className="h-4 w-px bg-line" />
          <button aria-label={t("pdf.zoomOut")} onClick={() => setZoom((z) => Math.max(0, z - 1))} className="flex size-6 items-center justify-center rounded hover:bg-hover hover:text-fg">
            <Minus size={13} />
          </button>
          <button onClick={() => setZoom(4)} title={t("pdf.fitWidth")} className="w-11 rounded py-0.5 text-center tabular-nums hover:bg-hover hover:text-fg">
            {new Intl.NumberFormat(locale(), { style: "percent" }).format(ZOOMS[zoom])}
          </button>
          <button aria-label={t("pdf.zoomIn")} onClick={() => setZoom((z) => Math.min(ZOOMS.length - 1, z + 1))} className="flex size-6 items-center justify-center rounded hover:bg-hover hover:text-fg">
            <Plus size={13} />
          </button>
        </div>
      )}
    </div>
  );
}
