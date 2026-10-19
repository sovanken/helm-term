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
    scrollbarSliderBackground: "#ffffff1a",
    scrollbarSliderHoverBackground: "#ffffff30",
    scrollbarSliderActiveBackground: "#ffffff40",
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
    scrollbarSliderBackground: "#0000001a",
    scrollbarSliderHoverBackground: "#0000002e",
    scrollbarSliderActiveBackground: "#0000003d",
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

/** Cascadia ships with Windows 11; Khmer UI / Leelawadee UI cover Khmer script. */
export const DEFAULT_FONT =
  '"Cascadia Mono", "Cascadia Code", Consolas, "Khmer UI", "Leelawadee UI", "Segoe UI Emoji", monospace';
