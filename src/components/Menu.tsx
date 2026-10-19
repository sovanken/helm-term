import { type CSSProperties, type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export interface MenuItem {
  label: string;
  hint?: string;
  icon?: ReactNode;
  onSelect: () => void;
  separatorBefore?: boolean;
  /** Shows a check mark column; used for on/off options. */
  checked?: boolean;
  /** Keep the menu open after selecting (for toggling several options). */
  keepOpen?: boolean;
  /** Small non-clickable heading shown above this item. */
  heading?: string;
}

/**
 * Small popover menu anchored to the element it is rendered in. The menu itself is portaled to
 * <body> so transformed or scrolling ancestors can neither offset nor clip it.
 */
export function Menu({
  items,
  onClose,
  align = "left",
}: {
  items: MenuItem[];
  onClose: () => void;
  align?: "left" | "right";
}) {
  const marker = useRef<HTMLSpanElement>(null);
  const ref = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<CSSProperties>({ visibility: "hidden" });
  const anchor = () => marker.current?.parentElement ?? null;

  useLayoutEffect(() => {
    const a = anchor()?.getBoundingClientRect();
    const menu = ref.current?.getBoundingClientRect();
    if (!a || !menu) return;
    const left = align === "right" ? a.right - menu.width : a.left;
    const below = a.bottom + 4;
    const top = below + menu.height > window.innerHeight - 8 ? a.top - menu.height - 4 : below;
    setStyle({ left: Math.max(8, Math.min(left, window.innerWidth - menu.width - 8)), top: Math.max(8, top) });
  }, [align]);

  useEffect(() => {
    const down = (e: PointerEvent) => {
      const target = e.target as Node;
      // Clicks on the anchor itself are left to its own toggle handler.
      if (!ref.current?.contains(target) && !anchor()?.contains(target)) onClose();
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    const dismiss = () => onClose();
    window.addEventListener("pointerdown", down, true);
    window.addEventListener("keydown", key, true);
    window.addEventListener("resize", dismiss);
    window.addEventListener("blur", dismiss);
    return () => {
      window.removeEventListener("pointerdown", down, true);
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("resize", dismiss);
      window.removeEventListener("blur", dismiss);
    };
  }, [onClose]);

  return (
    <span ref={marker} hidden>
      {createPortal(
        <div
          ref={ref}
          role="menu"
          style={style}
          className="fixed z-50 min-w-60 rounded-lg border border-line bg-raised p-1 shadow-lg shadow-black/20"
        >
          {items.map((item) => (
            <div key={item.label}>
              {item.separatorBefore && <div className="my-1 h-px bg-line" />}
              {item.heading && <div className="px-2.5 pt-1.5 pb-1 text-[11px] font-semibold tracking-wide text-faint uppercase">{item.heading}</div>}
              <button
                role={item.checked === undefined ? "menuitem" : "menuitemcheckbox"}
                aria-checked={item.checked}
                onClick={() => {
                  if (!item.keepOpen) onClose();
                  item.onSelect();
                }}
                className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-fg hover:bg-hover"
              >
                {item.checked !== undefined && (
                  <span className={`flex size-4 items-center justify-center rounded border ${item.checked ? "border-accent bg-accent text-on-accent" : "border-line"}`}>
                    {item.checked && (
                      <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden>
                        <path d="M2.5 6.5l2.5 2.5 4.5-5" />
                      </svg>
                    )}
                  </span>
                )}
                {(item.icon || item.checked === undefined) && <span className="flex size-4 items-center justify-center text-muted">{item.icon}</span>}
                <span className="flex-1">{item.label}</span>
                {item.hint && <span className="text-[11px] text-faint">{item.hint}</span>}
              </button>
            </div>
          ))}
        </div>,
        document.body,
      )}
    </span>
  );
}
