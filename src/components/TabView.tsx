import { useRef } from "react";
import { Sparkles, SquareTerminal, X } from "lucide-react";
import { computeRects, type DividerRect, type Rect } from "../lib/layout";
import { cleanTitle, folderName, type Tab, useStore } from "../state/store";
import { SearchBar } from "./SearchBar";
import { StatusDot } from "./StatusDot";
import { beginLiveResize, endLiveResize } from "../terminal/terminals";
import { TerminalView } from "./TerminalView";

const pct = (n: number) => `${n * 100}%`;
const HEADER = 28;

function PaneHeader({ paneId, active }: { paneId: string; active: boolean }) {
  const pane = useStore((s) => s.panes[paneId]);
  if (!pane) return null;
  const claude = pane.claudeActive || pane.kind === "claude";
  const title = cleanTitle(pane.title);
  return (
    <div
      className={`flex shrink-0 items-center gap-2 border-b px-2.5 text-[12px] ${
        active ? "border-accent/40 text-fg" : "border-line text-muted"
      }`}
      style={{ height: HEADER }}
    >
      {claude ? <Sparkles size={12} className={active ? "text-accent" : ""} /> : <SquareTerminal size={12} />}
      <span className="truncate">
        <span className="font-medium">{folderName(pane.cwd)}</span>
        {title && <span className="text-faint"> · {title}</span>}
      </span>
      <StatusDot status={pane.status} claude={false} />
      {pane.status === "attention" && pane.attentionMessage && (
        <span className="truncate text-attention">{pane.attentionMessage}</span>
      )}
      <button
        aria-label="Close pane"
        title="Close pane (Ctrl+Shift+W)"
        onClick={() => useStore.getState().closePane(paneId)}
        className="ml-auto flex size-5 shrink-0 items-center justify-center rounded text-muted hover:bg-hover hover:text-fg"
      >
        <X size={12} />
      </button>
    </div>
  );
}

function Divider({ tabId, d }: { tabId: string; d: DividerRect }) {
  const row = d.dir === "row";
  const ref = useRef<HTMLDivElement>(null);

  const onPointerDown = (e: React.PointerEvent) => {
    const area = ref.current?.parentElement?.getBoundingClientRect();
    if (!area) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    beginLiveResize();
    const move = (ev: PointerEvent) => {
      const p = d.parent;
      const ratio = row
        ? ((ev.clientX - area.left) / area.width - p.x) / p.w
        : ((ev.clientY - area.top) / area.height - p.y) / p.h;
      useStore.getState().resizeSplit(tabId, d.splitId, ratio);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      endLiveResize();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <div
      ref={ref}
      onPointerDown={onPointerDown}
      className={`group absolute z-10 flex items-center justify-center ${row ? "cursor-col-resize" : "cursor-row-resize"}`}
      style={
        row
          ? { left: `calc(${pct(d.rect.x)} - 3px)`, top: pct(d.rect.y), width: 6, height: pct(d.rect.h) }
          : { top: `calc(${pct(d.rect.y)} - 3px)`, left: pct(d.rect.x), height: 6, width: pct(d.rect.w) }
      }
    >
      <div className={`bg-line group-hover:bg-accent ${row ? "h-full w-px" : "h-px w-full"}`} />
    </div>
  );
}

export function TabView({ tab, visible }: { tab: Tab; visible: boolean }) {
  const searchOpen = useStore((s) => s.searchOpen);
  const { panes, dividers } = computeRects(tab.root);
  const isSplit = panes.length > 1;

  const box = (r: Rect) => ({ left: pct(r.x), top: pct(r.y), width: pct(r.w), height: pct(r.h) });

  return (
    <div className="absolute inset-0" style={{ visibility: visible ? "visible" : "hidden" }}>
      {panes.map(({ paneId, rect }) => {
        const active = paneId === tab.activePaneId;
        return (
          <div
            key={paneId}
            className="absolute flex flex-col"
            style={box(rect)}
            onPointerDownCapture={() => !active && useStore.getState().focusPane(paneId)}
          >
            {isSplit && <PaneHeader paneId={paneId} active={active} />}
            <div className="relative min-h-0 flex-1">
              <TerminalView paneId={paneId} active={active} visible={visible} />
              {visible && active && searchOpen && <SearchBar paneId={paneId} />}
            </div>
          </div>
        );
      })}
      {dividers.map((d) => (
        <Divider key={d.splitId} tabId={tab.id} d={d} />
      ))}
    </div>
  );
}
