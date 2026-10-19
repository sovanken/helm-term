import { useEffect, useRef } from "react";
import { attach, copySelectionOrPaste, detach, focusTerminal, refit } from "../terminal/terminals";

/** Hosts a pane's terminal. The xterm instance itself lives in the terminals registry. */
export function TerminalView({ paneId, active, visible }: { paneId: string; active: boolean; visible: boolean }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current!;
    attach(paneId, el);
    const ro = new ResizeObserver(() => refit(paneId));
    ro.observe(el);
    return () => {
      ro.disconnect();
      detach(paneId, el);
    };
  }, [paneId]);

  useEffect(() => {
    if (visible) refit(paneId);
    if (visible && active) requestAnimationFrame(() => focusTerminal(paneId));
  }, [visible, active, paneId]);

  return (
    <div
      ref={ref}
      className="absolute inset-0"
      onContextMenu={(e) => {
        // Right-click copies the selection, or pastes when nothing is selected (like Windows Terminal).
        e.preventDefault();
        void copySelectionOrPaste(paneId);
      }}
    />
  );
}
