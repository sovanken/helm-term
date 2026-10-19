// The device drawn around an emulated page: a phone, tablet or laptop body. The page is a native,
// square view, so the rounded screen corners live in strips Helm draws itself (status bar on top,
// home indicator below; on the sides when rotated) and the page sits squarely between them.

import type { CSSProperties, ReactNode } from "react";
import type { DeviceSpec } from "../lib/devices";

const BODY = "#121214";
const RIM = "#7c7c82";
const BUTTON = "#5d5d63";

export interface Bezel {
  /** Total space around the page on each side (bezel + screen strips). */
  top: number;
  right: number;
  bottom: number;
  left: number;
  /** Extra height under the body (a laptop's base). */
  base: number;
}

interface Layout {
  pad: number;
  /** Outer corner radius of the body. */
  radius: number;
  /** Corner radius of the screen: never larger than the strips that cover its corners, so the
   * square page never pokes out past a rounded corner. */
  screen: number;
  strips: { top: number; bottom: number; left: number; right: number };
  base: number;
}

function rounded(l: Omit<Layout, "screen" | "radius">, wanted: number, landscape: boolean): Layout {
  const cover = landscape ? Math.min(l.strips.left, l.strips.right) : Math.min(l.strips.top, l.strips.bottom);
  const screen = Math.max(0, Math.min(wanted, cover));
  return { ...l, screen, radius: screen + l.pad };
}

function layoutFor(device: DeviceSpec, rotated: boolean, scale: number): Layout {
  const s = Math.min(1, Math.max(0.4, scale));
  const px = (n: number, min: number) => Math.max(min, n * s);
  if (device.group === "Phones") {
    const ios = !!device.userAgent?.includes("iPhone");
    const bar = px(ios ? 50 : 32, ios ? 24 : 16);
    const home = px(ios ? 34 : 28, 14);
    const pad = px(11, 6);
    const want = px(ios ? 47 : 36, 18);
    return rotated
      ? rounded({ pad, base: 0, strips: { top: 0, bottom: home, left: bar, right: bar } }, want, true)
      : rounded({ pad, base: 0, strips: { top: bar, bottom: home, left: 0, right: 0 } }, want, false);
  }
  if (device.group === "Tablets") {
    const pad = px(20, 10);
    return rounded({ pad, base: 0, strips: { top: px(26, 14), bottom: px(22, 12), left: 0, right: 0 } }, px(18, 10), false);
  }
  // Laptops and monitors: a square screen in a slightly rounded bezel.
  const pad = px(14, 8);
  return { pad, radius: px(14, 8), screen: 0, base: rotated ? 0 : px(16, 9), strips: { top: px(4, 3), bottom: 0, left: 0, right: 0 } };
}

/** Space the frame adds around a page at the given on-screen scale. */
export function bezelFor(device: DeviceSpec, rotated: boolean, scale: number): Bezel {
  const l = layoutFor(device, rotated, scale);
  return { top: l.pad + l.strips.top, bottom: l.pad + l.strips.bottom, left: l.pad + l.strips.left, right: l.pad + l.strips.right, base: l.base };
}

function StatusIcons({ size }: { size: number }) {
  const h = size;
  return (
    <span className="flex items-center" style={{ gap: h * 0.3 }}>
      {/* signal */}
      <svg width={h * 1.25} height={h} viewBox="0 0 20 16" fill="currentColor" aria-hidden>
        <rect x="0" y="10" width="3.5" height="6" rx="1" />
        <rect x="5.5" y="7" width="3.5" height="9" rx="1" />
        <rect x="11" y="3.5" width="3.5" height="12.5" rx="1" />
        <rect x="16.5" y="0" width="3.5" height="16" rx="1" />
      </svg>
      {/* wi-fi */}
      <svg width={h * 1.2} height={h} viewBox="0 0 20 16" fill="currentColor" aria-hidden>
        <path d="M10 15.5 7.2 12.6a4 4 0 0 1 5.6 0Z" />
        <path d="M4.4 9.8a8 8 0 0 1 11.2 0l-1.6 1.6a5.7 5.7 0 0 0-8 0Z" />
        <path d="M1.5 6.9a12 12 0 0 1 17 0l-1.6 1.6a9.7 9.7 0 0 0-13.8 0Z" />
      </svg>
      {/* battery */}
      <svg width={h * 1.8} height={h} viewBox="0 0 28 16" fill="none" aria-hidden>
        <rect x="0.75" y="1.75" width="23.5" height="12.5" rx="3.5" stroke="currentColor" strokeOpacity="0.45" strokeWidth="1.5" />
        <rect x="3" y="4" width="19" height="8" rx="2" fill="currentColor" />
        <path d="M26 6v4a2 2 0 0 0 0-4Z" fill="currentColor" fillOpacity="0.45" />
      </svg>
    </span>
  );
}

/** Wraps the page (`children`, sized to the emulated screen) in the device. */
export function DeviceFrame({ device, rotated, scale, children }: { device: DeviceSpec; rotated: boolean; scale: number; children: ReactNode }) {
  const l = layoutFor(device, rotated, scale);
  const s = Math.min(1, Math.max(0.4, scale));
  const ios = !!device.userAgent?.includes("iPhone");
  const phone = device.group === "Phones";
  const computer = device.group === "Computers";

  const body: CSSProperties = {
    padding: l.pad,
    borderRadius: l.radius,
    background: BODY,
    boxShadow: computer ? `0 0 0 1px #2c2c2e` : `0 0 0 ${Math.max(1, 1.6 * s)}px ${RIM}, 0 0 0 ${Math.max(2, 3 * s)}px #3a3a3e`,
  };
  const screenRadius = l.screen;
  const text = Math.max(8, 15 * s);

  const statusBar = (
    <div className="flex items-center justify-between bg-white text-black" style={{ height: l.strips.top, padding: `0 ${Math.max(10, 30 * s)}px`, fontSize: text, fontWeight: 600 }}>
      <span style={{ minWidth: text * 3 }}>9:41</span>
      {phone && ios && <span className="rounded-full bg-black" style={{ width: Math.max(44, 122 * s), height: Math.max(13, 35 * s) }} />}
      {phone && !ios && <span className="rounded-full bg-black" style={{ width: Math.max(8, 22 * s), height: Math.max(8, 22 * s) }} />}
      <StatusIcons size={Math.max(7, 12 * s)} />
    </div>
  );
  const homeBar = (vertical = false) => (
    <span className="rounded-full bg-black/80" style={vertical ? { width: Math.max(3, 5 * s), height: Math.max(40, 134 * s) } : { width: Math.max(40, 134 * s), height: Math.max(3, 5 * s) }} />
  );

  return (
    <div className="relative" style={{ paddingBottom: l.base }}>
      <div className="relative" style={body}>
        {computer && <span className="absolute left-1/2 rounded-full -translate-x-1/2" style={{ top: l.pad / 2 - 2, width: 4, height: 4, background: "#2a2a2c" }} />}
        {device.group === "Tablets" && (
          <span className="absolute rounded-full" style={{ ...(rotated ? { left: l.pad / 2, top: "50%" } : { top: l.pad / 2, left: "50%" }), transform: "translate(-50%, -50%)", width: Math.max(4, 7 * s), height: Math.max(4, 7 * s), background: "#26262a" }} />
        )}
        <div className="overflow-hidden bg-white" style={{ borderRadius: screenRadius }}>
          {phone && rotated ? (
            <div className="flex">
              {/* Landscape phone: camera side on the left, a matching strip on the right, home bar below. */}
              <div className="flex items-center justify-center bg-white" style={{ width: l.strips.left }}>
                <span className="rounded-full bg-black" style={ios ? { width: Math.max(13, 35 * s), height: Math.max(44, 122 * s) } : { width: Math.max(8, 22 * s), height: Math.max(8, 22 * s) }} />
              </div>
              <div className="flex flex-col">
                {children}
                <div className="flex items-center justify-center bg-white" style={{ height: l.strips.bottom }}>{homeBar()}</div>
              </div>
              <div className="bg-white" style={{ width: l.strips.right }} />
            </div>
          ) : (
            <div className="flex flex-col">
              {l.strips.top > 0 && (computer ? <div style={{ height: l.strips.top, background: BODY }} /> : statusBar)}
              {children}
              {l.strips.bottom > 0 && <div className="flex items-center justify-center bg-white" style={{ height: l.strips.bottom }}>{homeBar()}</div>}
            </div>
          )}
        </div>
      </div>

      {/* Side buttons: action and volume on one edge, power on the other. */}
      {phone &&
        (rotated ? (
          <>
            {[0.16, 0.25, 0.34].map((at, i) => (
              <span key={i} className="absolute rounded-t-sm" style={{ top: -Math.max(2, 3.5 * s), right: `${at * 100}%`, width: (i === 0 ? 28 : 50) * s, height: Math.max(2, 3.5 * s), background: BUTTON }} />
            ))}
            <span className="absolute rounded-b-sm" style={{ bottom: -Math.max(2, 3.5 * s), right: "28%", width: 80 * s, height: Math.max(2, 3.5 * s), background: BUTTON }} />
          </>
        ) : (
          <>
            {[0.16, 0.25, 0.34].map((at, i) => (
              <span key={i} className="absolute rounded-l-sm" style={{ left: -Math.max(2, 3.5 * s), top: `${at * 100}%`, width: Math.max(2, 3.5 * s), height: (i === 0 ? 28 : 50) * s, background: BUTTON }} />
            ))}
            <span className="absolute rounded-r-sm" style={{ right: -Math.max(2, 3.5 * s), top: "28%", width: Math.max(2, 3.5 * s), height: 80 * s, background: BUTTON }} />
          </>
        ))}

      {/* A laptop's base, slightly wider than the screen. */}
      {l.base > 0 && (
        <div className="absolute bottom-0 left-[-7%] right-[-7%]" style={{ height: l.base }}>
          <div className="absolute inset-0" style={{ background: "linear-gradient(#4a4a4d, #2a2a2c 70%, #1c1c1e)", borderRadius: `2px 2px ${l.base}px ${l.base}px / 2px 2px ${l.base * 0.8}px ${l.base * 0.8}px` }} />
          <div className="absolute top-0 left-1/2 -translate-x-1/2" style={{ width: "14%", height: l.base * 0.35, background: "#1a1a1b", borderRadius: `0 0 ${l.base * 0.4}px ${l.base * 0.4}px` }} />
        </div>
      )}
    </div>
  );
}
