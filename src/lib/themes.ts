import type { ITheme } from "@xterm/xterm";

export type ThemeMode = "dark" | "light" | "system";

export const terminalThemes: Record<"dark" | "light", ITheme> = {
  dark: {
    background: "#111214",
    foreground: "#e4e4e7",
    cursor: "#e0a458",
    cursorAccent: "#111214",
    selectionBackground: "#e0a45840",
    selectionInactiveBackground: "#e0a45424",
    scrollbarSliderBackground: "#ffffff26",
    scrollbarSliderHoverBackground: "#ffffff40",
    scrollbarSliderActiveBackground: "#ffffff55",
    black: "#1c1d21",
    red: "#f0717a",
    green: "#7fd29a",
    yellow: "#e8c46a",
    blue: "#78a9ff",
    magenta: "#c49bf2",
    cyan: "#6fd0d8",
    white: "#d4d4d8",
    brightBlack: "#5c5f68",
    brightRed: "#ff8f97",
    brightGreen: "#9be6b2",
    brightYellow: "#f5d688",
    brightBlue: "#9cc1ff",
    brightMagenta: "#d8b8ff",
    brightCyan: "#92e3ea",
    brightWhite: "#fafafa",
  },
  light: {
    background: "#fbfbfa",
    foreground: "#24252a",
    cursor: "#b8732e",
    cursorAccent: "#fbfbfa",
    selectionBackground: "#b8732e33",
    selectionInactiveBackground: "#b8732e1f",
    scrollbarSliderBackground: "#00000029",
    scrollbarSliderHoverBackground: "#00000040",
    scrollbarSliderActiveBackground: "#00000052",
    black: "#24252a",
    red: "#c8323f",
    green: "#2b8a4b",
    yellow: "#9a6b00",
    blue: "#2c63d6",
    magenta: "#8a45c7",
    cyan: "#137f8a",
    white: "#8a8c93",
    brightBlack: "#6b6d75",
    brightRed: "#e0454f",
    brightGreen: "#36a35b",
    brightYellow: "#b88200",
    brightBlue: "#3f78ee",
    brightMagenta: "#a15ae0",
    brightCyan: "#1a98a5",
    brightWhite: "#3a3b40",
  },
};

export function resolveTheme(mode: ThemeMode): "dark" | "light" {
  if (mode !== "system") return mode;
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

/**
 * Fonts that ship with Windows, so text in any language renders without installing anything:
 * CJK, Korean, Indic, Southeast Asian, African, Mongolian, Tibetan, Armenian/Georgian,
 * historic scripts, symbols and emoji (Latin, Cyrillic, Greek, Arabic and Hebrew via Segoe UI).
 */
export const SCRIPT_FALLBACK =
  '"Segoe UI", "Microsoft YaHei UI", "Microsoft JhengHei UI", "Yu Gothic UI", "Malgun Gothic", "Nirmala UI", "Leelawadee UI", "Khmer UI", "Myanmar Text", "Ebrima", "Gadugi", "Javanese Text", "Mongolian Baiti", "Microsoft Himalaya", "Sylfaen", "Segoe UI Historic", "Segoe UI Symbol", "Segoe UI Emoji"';

/** Cascadia ships with Windows 11; Consolas covers older systems. */
export const DEFAULT_FONT = "Cascadia Mono";

/** The user's chosen font first, then Windows monospace fonts, then every-script fallbacks. */
export function fontStack(primary: string): string {
  const name = primary.trim().replace(/"/g, "");
  return `${name ? `"${name}", ` : ""}"Cascadia Mono", "Cascadia Code", Consolas, ${SCRIPT_FALLBACK}, monospace`;
}
