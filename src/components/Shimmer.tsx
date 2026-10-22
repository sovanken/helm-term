// Loading placeholders: a soft band sweeping across grey shapes (the .shimmer rule in styles.css).
// Use these instead of "Loading…" text, so a screen keeps its shape while its content arrives.

import type { CSSProperties } from "react";

import { t } from "../i18n";

const WIDTHS = [0.92, 0.7, 0.84, 0.55, 0.76, 0.62, 0.88, 0.48];

/** One grey block. */
export function Shimmer({ className = "", style }: { className?: string; style?: CSSProperties }) {
  return <span aria-hidden className={`shimmer block rounded-md ${className}`} style={style} />;
}

/** Lines of text, like a paragraph or a file. */
export function ShimmerLines({ lines = 6, className = "" }: { lines?: number; className?: string }) {
  return (
    <div role="status" aria-label={t("common.loading")} className={`flex flex-col gap-2.5 ${className}`}>
      {Array.from({ length: lines }, (_, i) => (
        <Shimmer key={i} className="h-3" style={{ width: `${WIDTHS[i % WIDTHS.length] * 100}%` }} />
      ))}
    </div>
  );
}

/** List rows with an icon, like files or conversations. */
export function ShimmerRows({ rows = 5, icon = true, className = "", indent = 0 }: { rows?: number; icon?: boolean; className?: string; indent?: number }) {
  return (
    <div role="status" aria-label={t("common.loading")} className={`flex flex-col gap-2 py-1 ${className}`} style={indent ? { paddingLeft: indent } : undefined}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex h-5 items-center gap-2">
          {icon && <Shimmer className="size-4 shrink-0 rounded" />}
          <Shimmer className="h-3" style={{ width: `${WIDTHS[(i + 2) % WIDTHS.length] * 70}%` }} />
        </div>
      ))}
    </div>
  );
}

/** A big block, like an image or a page. */
export function ShimmerBlock({ className = "" }: { className?: string }) {
  return (
    <div role="status" aria-label={t("common.loading")} className={className}>
      <Shimmer className="size-full rounded-lg" />
    </div>
  );
}
