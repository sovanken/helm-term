import type { ITheme } from "@xterm/xterm";

export type ThemeMode = "dark" | "light" | "system";

/** Helm's own terminal palettes; cursor and selection follow the accent color. */
const helm: Record<"dark" | "light", ITheme> = {
  dark: {
    background: "#111214",
    foreground: "#e4e4e7",
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

type Palette = [string, string, string, string, string, string, string, string, string, string, string, string, string, string, string, string];

function scheme(background: string, foreground: string, cursor: string, ansi: Palette): ITheme {
  const [black, red, green, yellow, blue, magenta, cyan, white, brightBlack, brightRed, brightGreen, brightYellow, brightBlue, brightMagenta, brightCyan, brightWhite] = ansi;
  return {
    background, foreground, cursor, cursorAccent: background, selectionBackground: `${cursor}40`,
    black, red, green, yellow, blue, magenta, cyan, white,
    brightBlack, brightRed, brightGreen, brightYellow, brightBlue, brightMagenta, brightCyan, brightWhite,
  };
}

/** Popular terminal color schemes (standard published palettes). */
export const TERMINAL_SCHEMES: { id: string; label: string; dark: boolean; theme: ITheme }[] = [
  { id: "one-dark", label: "One Dark", dark: true, theme: scheme("#282c34", "#dcdfe4", "#dcdfe4", ["#282c34", "#e06c75", "#98c379", "#e5c07b", "#61afef", "#c678dd", "#56b6c2", "#dcdfe4", "#5a6374", "#e06c75", "#98c379", "#e5c07b", "#61afef", "#c678dd", "#56b6c2", "#dcdfe4"]) },
  { id: "dracula", label: "Dracula", dark: true, theme: scheme("#282a36", "#f8f8f2", "#f8f8f2", ["#21222c", "#ff5555", "#50fa7b", "#f1fa8c", "#bd93f9", "#ff79c6", "#8be9fd", "#f8f8f2", "#6272a4", "#ff6e6e", "#69ff94", "#ffffa5", "#d6acff", "#ff92df", "#a4ffff", "#ffffff"]) },
  { id: "tokyo-night", label: "Tokyo Night", dark: true, theme: scheme("#1a1b26", "#c0caf5", "#c0caf5", ["#15161e", "#f7768e", "#9ece6a", "#e0af68", "#7aa2f7", "#bb9af7", "#7dcfff", "#a9b1d6", "#414868", "#f7768e", "#9ece6a", "#e0af68", "#7aa2f7", "#bb9af7", "#7dcfff", "#c0caf5"]) },
  { id: "catppuccin-mocha", label: "Catppuccin Mocha", dark: true, theme: scheme("#1e1e2e", "#cdd6f4", "#f5e0dc", ["#45475a", "#f38ba8", "#a6e3a1", "#f9e2af", "#89b4fa", "#f5c2e7", "#94e2d5", "#bac2de", "#585b70", "#f38ba8", "#a6e3a1", "#f9e2af", "#89b4fa", "#f5c2e7", "#94e2d5", "#a6adc8"]) },
  { id: "nord", label: "Nord", dark: true, theme: scheme("#2e3440", "#d8dee9", "#d8dee9", ["#3b4252", "#bf616a", "#a3be8c", "#ebcb8b", "#81a1c1", "#b48ead", "#88c0d0", "#e5e9f0", "#4c566a", "#bf616a", "#a3be8c", "#ebcb8b", "#81a1c1", "#b48ead", "#8fbcbb", "#eceff4"]) },
  { id: "github-dark", label: "GitHub Dark", dark: true, theme: scheme("#0d1117", "#e6edf3", "#e6edf3", ["#484f58", "#ff7b72", "#3fb950", "#d29922", "#58a6ff", "#bc8cff", "#39c5cf", "#b1bac4", "#6e7681", "#ffa198", "#56d364", "#e3b341", "#79c0ff", "#d2a8ff", "#56d4dd", "#ffffff"]) },
  { id: "solarized-dark", label: "Solarized Dark", dark: true, theme: scheme("#002b36", "#839496", "#93a1a1", ["#073642", "#dc322f", "#859900", "#b58900", "#268bd2", "#d33682", "#2aa198", "#eee8d5", "#586e75", "#cb4b16", "#586e75", "#657b83", "#839496", "#6c71c4", "#93a1a1", "#fdf6e3"]) },
  { id: "catppuccin-latte", label: "Catppuccin Latte", dark: false, theme: scheme("#eff1f5", "#4c4f69", "#dc8a78", ["#5c5f77", "#d20f39", "#40a02b", "#df8e1d", "#1e66f5", "#ea76cb", "#179299", "#acb0be", "#6c6f85", "#d20f39", "#40a02b", "#df8e1d", "#1e66f5", "#ea76cb", "#179299", "#bcc0cc"]) },
  { id: "github-light", label: "GitHub Light", dark: false, theme: scheme("#ffffff", "#1f2328", "#1f2328", ["#24292f", "#cf222e", "#116329", "#4d2d00", "#0969da", "#8250df", "#1b7c83", "#6e7781", "#57606a", "#a40e26", "#1a7f37", "#633c01", "#218bff", "#a475f9", "#3192aa", "#8c959f"]) },
  { id: "solarized-light", label: "Solarized Light", dark: false, theme: scheme("#fdf6e3", "#657b83", "#586e75", ["#073642", "#dc322f", "#859900", "#b58900", "#268bd2", "#d33682", "#2aa198", "#eee8d5", "#586e75", "#cb4b16", "#586e75", "#657b83", "#839496", "#6c71c4", "#93a1a1", "#fdf6e3"]) },
];

/** Accent colors for dark and light themes. */
export const ACCENTS: Record<string, { label: string; dark: string; light: string }> = {
  brass: { label: "Brass", dark: "#e0a458", light: "#b8732e" },
  blue: { label: "Blue", dark: "#6aa6ff", light: "#2563eb" },
  violet: { label: "Violet", dark: "#b49cff", light: "#7c3aed" },
  green: { label: "Green", dark: "#5fd39a", light: "#15803d" },
  rose: { label: "Rose", dark: "#ff8fab", light: "#e11d48" },
  teal: { label: "Teal", dark: "#4fd1c5", light: "#0f766e" },
};

export function resolveTheme(mode: ThemeMode): "dark" | "light" {
  if (mode !== "system") return mode;
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

export function accentColor(accent: string, mode: "dark" | "light") {
  return (ACCENTS[accent] ?? ACCENTS.brass)[mode];
}

/** The xterm theme for the current settings. */
export function terminalTheme(schemeId: string, mode: "dark" | "light", accent: string): ITheme {
  const named = TERMINAL_SCHEMES.find((s) => s.id === schemeId);
  if (named) return named.theme;
  const color = accentColor(accent, mode);
  return { ...helm[mode], cursor: color, cursorAccent: helm[mode].background, selectionBackground: `${color}40`, selectionInactiveBackground: `${color}24` };
}

/**
 * Fonts that ship with Windows, so text in any language renders without installing anything:
 * CJK, Korean, Indic, Southeast Asian, African, Mongolian, Tibetan, Armenian/Georgian,
 * historic scripts, symbols and emoji (Latin, Cyrillic, Greek, Arabic and Hebrew via Segoe UI).
 */
export const SCRIPT_FALLBACK =
  '"Segoe UI", "Microsoft YaHei UI", "Microsoft JhengHei UI", "Yu Gothic UI", "Malgun Gothic", "Nirmala UI", "Leelawadee UI", "Khmer UI", "Myanmar Text", "Ebrima", "Gadugi", "Javanese Text", "Mongolian Baiti", "Microsoft Himalaya", "Sylfaen", "Segoe UI Historic", "Segoe UI Symbol", "Segoe UI Emoji"';

/** Terminal fonts bundled with Helm (display name → CSS family). */
export const BUNDLED_MONO: Record<string, string> = {
  "JetBrains Mono": "JetBrains Mono Variable",
  "Geist Mono": "Geist Mono Variable",
};

export const TERMINAL_FONT_CHOICES = ["JetBrains Mono", "Geist Mono", "Cascadia Mono", "Cascadia Code", "Consolas"];

export const DEFAULT_FONT = "JetBrains Mono";

/** The user's chosen font first, then Windows monospace fonts, then every-script fallbacks. */
export function fontStack(primary: string): string {
  const name = primary.trim().replace(/"/g, "");
  const family = BUNDLED_MONO[name] ? `"${BUNDLED_MONO[name]}", "${name}"` : name ? `"${name}"` : "";
  return `${family ? `${family}, ` : ""}"JetBrains Mono Variable", "Cascadia Mono", Consolas, ${SCRIPT_FALLBACK}, monospace`;
}

export const UI_FONTS: Record<string, { label: string; css: string }> = {
  inter: { label: "Inter", css: '"Inter Variable"' },
  geist: { label: "Geist", css: '"Geist Variable"' },
  system: { label: "Windows (Segoe UI)", css: '"Segoe UI Variable Text", "Segoe UI"' },
};

export function uiFontStack(id: string) {
  return `${(UI_FONTS[id] ?? UI_FONTS.inter).css}, ${SCRIPT_FALLBACK}, system-ui, sans-serif`;
}
