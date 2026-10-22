/** Colour parsing and conversion (sRGB, HSL, OKLCH) and WCAG contrast. Channels are 0–255, alpha 0–1. */
export interface RGBA {
  r: number;
  g: number;
  b: number;
  a: number;
}

const clamp = (v: number, lo = 0, hi = 255) => Math.min(hi, Math.max(lo, v));
const round = (v: number, d = 0) => Math.round(v * 10 ** d) / 10 ** d;

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  s /= 100;
  l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0) * 255, f(8) * 255, f(4) * 255];
}

export function rgbToHsl({ r, g, b }: RGBA): [number, number, number] {
  const [rr, gg, bb] = [r / 255, g / 255, b / 255];
  const max = Math.max(rr, gg, bb);
  const min = Math.min(rr, gg, bb);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l * 100];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === rr ? (gg - bb) / d + (gg < bb ? 6 : 0) : max === gg ? (bb - rr) / d + 2 : (rr - gg) / d + 4;
  return [h * 60, s * 100, l * 100];
}

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const fromLinear = (c: number) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);

export function rgbToOklch({ r, g, b }: RGBA): [number, number, number] {
  const [lr, lg, lb] = [r, g, b].map((c) => toLinear(c / 255));
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const C = Math.hypot(A, B);
  const H = C < 1e-4 ? 0 : ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360;
  return [L, C, H];
}

function oklchToRgb(L: number, C: number, H: number): [number, number, number] {
  const A = C * Math.cos((H * Math.PI) / 180);
  const B = C * Math.sin((H * Math.PI) / 180);
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  const lin = [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
  return lin.map((c) => fromLinear(c) * 255) as [number, number, number];
}

const num = (s: string, scale = 1) => (s.endsWith("%") ? (parseFloat(s) / 100) * scale : parseFloat(s));

/** Reads #rgb, #rrggbb(aa), rgb(), hsl(), oklch() or a CSS colour name. */
export function parseColor(input: string): RGBA | null {
  const s = input.trim().toLowerCase();
  if (!s) return null;
  let m = s.match(/^#?([0-9a-f]{3,8})$/);
  if (m && [3, 4, 6, 8].includes(m[1].length)) {
    let h = m[1];
    if (h.length <= 4) h = [...h].map((c) => c + c).join("");
    const n = (i: number) => parseInt(h.slice(i, i + 2), 16);
    return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? round(n(6) / 255, 3) : 1 };
  }
  m = s.match(/^(rgba?|hsla?|oklch)\((.+)\)$/);
  if (m) {
    const parts = m[2].replace(/[,/]/g, " ").split(/\s+/).filter(Boolean);
    if (parts.length < 3) return null;
    const a = parts[3] !== undefined ? clamp(num(parts[3], 1), 0, 1) : 1;
    let rgb: [number, number, number];
    if (m[1].startsWith("rgb")) rgb = [num(parts[0], 255), num(parts[1], 255), num(parts[2], 255)];
    else if (m[1].startsWith("hsl")) rgb = hslToRgb(parseFloat(parts[0]), parseFloat(parts[1]), parseFloat(parts[2]));
    else rgb = oklchToRgb(num(parts[0], 1), num(parts[1], 0.4), parseFloat(parts[2]));
    if (rgb.some((v) => Number.isNaN(v))) return null;
    const [r, g, b] = rgb.map((v) => Math.round(clamp(v)));
    return { r, g, b, a };
  }
  // CSS names ("rebeccapurple"): let the browser resolve them.
  if (/^[a-z]+$/.test(s)) {
    const ctx = document.createElement("canvas").getContext("2d");
    if (!ctx) return null;
    ctx.fillStyle = "#010203";
    ctx.fillStyle = s;
    if (ctx.fillStyle === "#010203" && s !== "#010203") return null;
    return parseColor(ctx.fillStyle);
  }
  return null;
}

const hex2 = (v: number) => Math.round(v).toString(16).padStart(2, "0");

export function toHex(c: RGBA, alpha = c.a < 1) {
  return `#${hex2(c.r)}${hex2(c.g)}${hex2(c.b)}${alpha ? hex2(c.a * 255) : ""}`;
}

/** The ways a colour can be copied. */
export function formats(c: RGBA): { label: string; value: string }[] {
  const [h, s, l] = rgbToHsl(c);
  const [L, C, H] = rgbToOklch(c);
  const alpha = c.a < 1 ? ` / ${round(c.a, 2)}` : "";
  const argb = `${hex2(c.a * 255)}${hex2(c.r)}${hex2(c.g)}${hex2(c.b)}`.toUpperCase();
  return [
    { label: "HEX", value: toHex(c) },
    { label: "RGB", value: `rgb(${c.r} ${c.g} ${c.b}${alpha})` },
    { label: "HSL", value: `hsl(${round(h)} ${round(s)}% ${round(l)}%${alpha})` },
    { label: "OKLCH", value: `oklch(${round(L * 100, 1)}% ${round(C, 3)} ${round(H, 1)}${alpha})` },
    { label: "Tailwind", value: `bg-[${toHex(c)}]` },
    { label: "Flutter", value: `Color(0x${argb})` },
    { label: "Android", value: `#${argb}` },
    { label: "SwiftUI", value: `Color(red: ${round(c.r / 255, 3)}, green: ${round(c.g / 255, 3)}, blue: ${round(c.b / 255, 3)}${c.a < 1 ? `, opacity: ${round(c.a, 2)}` : ""})` },
  ];
}

function luminance({ r, g, b }: RGBA) {
  const [lr, lg, lb] = [r, g, b].map((v) => toLinear(v / 255));
  return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
}

/** WCAG 2 contrast ratio, 1–21. */
export function contrast(a: RGBA, b: RGBA) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
