import { useRef, useState } from "react";
import { beginLiveResize, endLiveResize } from "../terminal/terminals";

/**
 * Vertical drag handle on the edge of a side panel. Drag to resize, double-click to reset.
 * `side` is where the panel sits: a left panel grows to the right, a right panel to the left.
 */
export function ResizeHandle({
  side,
  width,
  min,
  max,
  defaultWidth,
  onChange,
  label,
}: {
  side: "left" | "right";
  width: number;
  min: number;
  max: number;
  defaultWidth: number;
  onChange: (width: number) => void;
  label: string;
}) {
  const [dragging, setDragging] = useState(false);
  const start = useRef({ x: 0, width });

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    start.current = { x: e.clientX, width };
    setDragging(true);
    beginLiveResize();
    document.body.style.cursor = "col-resize";
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    const delta = e.clientX - start.current.x;
    const next = start.current.width + (side === "left" ? delta : -delta);
    onChange(Math.round(Math.min(max, Math.max(min, next))));
  };
  const stop = () => {
    if (dragging) endLiveResize();
    setDragging(false);
    document.body.style.cursor = "";
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={width}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      title="Drag to resize · double-click to reset"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={stop}
      onPointerCancel={stop}
      onDoubleClick={() => onChange(defaultWidth)}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 40 : 10;
        if (e.key === "ArrowLeft") onChange(Math.max(min, Math.min(max, width + (side === "left" ? -step : step))));
        if (e.key === "ArrowRight") onChange(Math.max(min, Math.min(max, width + (side === "left" ? step : -step))));
      }}
      className={`group relative z-20 w-0 shrink-0 cursor-col-resize outline-none`}
    >
      {/* Wide invisible hit area, thin visible line. */}
      <div className="absolute inset-y-0 -left-[3px] w-[6px]" />
      <div
        className={`pointer-events-none absolute inset-y-0 -left-px w-[2px] rounded-full transition-colors ${
          dragging ? "bg-accent" : "bg-transparent group-hover:bg-accent/60 group-focus-visible:bg-accent"
        }`}
      />
    </div>
  );
}
