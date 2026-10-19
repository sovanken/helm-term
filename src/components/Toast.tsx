import { CheckCircle2, Info, TriangleAlert, X } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import { useStore } from "../state/store";

/**
 * Browser pages are native views drawn above Helm's UI, so a toast must not sit on one. Returns
 * the centre of the widest free gap at the toast's height, or null when there's no room (the
 * page then pauses while the toast shows, via data-overlay).
 */
function freeSpot(el: HTMLElement): { x: number; max: number } | null | undefined {
  const t = el.getBoundingClientRect();
  const pages = [...document.querySelectorAll("[data-browser-frame]")]
    // Pages on hidden tabs keep their layout box but aren't drawn.
    .filter((f) => f.checkVisibility({ visibilityProperty: true }))
    .map((f) => f.getBoundingClientRect())
    .filter((r) => r.width > 2 && r.top < t.bottom + 8 && r.bottom > t.top - 8);
  if (!pages.length) return undefined;
  const W = window.innerWidth;
  const cuts = pages.map((r) => [Math.max(0, r.left), Math.min(W, r.right)]).sort((a, b) => a[0] - b[0]);
  let best: [number, number] = [0, 0];
  let x = 0;
  for (const [l, r] of cuts) {
    if (l - x > best[1] - best[0]) best = [x, l];
    x = Math.max(x, r);
  }
  if (W - x > best[1] - best[0]) best = [x, W];
  const gap = best[1] - best[0];
  // Narrower gaps get a narrower (wrapping) toast; below ~300px there's no good place for it.
  return gap >= 300 ? { x: (best[0] + best[1]) / 2, max: Math.min(560, gap - 24) } : null;
}

export function ToastView() {
  const toast = useStore((s) => s.toast);
  const ref = useRef<HTMLDivElement>(null);
  const [spot, setSpot] = useState<{ x: number; max: number } | null | undefined>(undefined);
  useLayoutEffect(() => {
    if (!toast) return;
    const place = () => ref.current && setSpot(freeSpot(ref.current));
    setSpot(undefined);
    requestAnimationFrame(place);
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [toast]);
  if (!toast) return null;
  const icon =
    toast.kind === "success" ? (
      <CheckCircle2 size={15} className="shrink-0 text-done" />
    ) : toast.kind === "error" ? (
      <TriangleAlert size={15} className="shrink-0 text-danger" />
    ) : (
      <Info size={15} className="shrink-0 text-working" />
    );
  return (
    <div
      key={toast.id}
      ref={ref}
      role="status"
      data-overlay={spot === null ? "" : undefined}
      style={spot ? { left: spot.x, maxWidth: spot.max } : undefined}
      className="anim-rise fixed bottom-10 left-1/2 z-50 flex max-w-[min(560px,calc(100vw-32px))] -translate-x-1/2 items-center gap-2.5 rounded-lg border border-line bg-raised py-2 pr-2 pl-3 text-fg shadow-lg shadow-black/20">
      {icon}
      <span className="min-w-0 flex-1 text-[13px] leading-snug">{toast.text}</span>
      {toast.secondary && (
        <button
          onClick={() => {
            toast.secondary!.run();
            useStore.getState().set({ toast: null });
          }}
          className="shrink-0 rounded-md px-2 py-1 text-muted hover:bg-hover hover:text-fg"
        >
          {toast.secondary.label}
        </button>
      )}
      {toast.action && (
        <button
          onClick={() => {
            toast.action!.run();
            useStore.getState().set({ toast: null });
          }}
          className="shrink-0 rounded-md px-2 py-1 font-medium text-accent hover:bg-hover"
        >
          {toast.action.label}
        </button>
      )}
      <button aria-label="Dismiss" onClick={() => useStore.getState().set({ toast: null })} className="shrink-0 rounded p-1 text-faint hover:bg-hover hover:text-fg">
        <X size={13} />
      </button>
    </div>
  );
}
