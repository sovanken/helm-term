// settings.json: Helm's settings as a file you can edit, like VS Code. The file holds only the
// settings you changed from the defaults (comments allowed). Saving it applies the changes; a
// mistake is reported with its line and never wipes your settings. Changes made on the Settings
// page are written back into the file, keeping your comments and layout.

import { appDataDir, join } from "@tauri-apps/api/path";
import { type Completion, type CompletionContext, autocompletion } from "@codemirror/autocomplete";
import { json } from "@codemirror/lang-json";
import { type Diagnostic, linter } from "@codemirror/lint";
import type { Extension } from "@codemirror/state";
import { hoverTooltip } from "@codemirror/view";
import { applyEdits, getLocation, modify, type ParseError, parse, printParseErrorCode } from "jsonc-parser";

import { DEFAULT_SETTINGS, type Settings, showToast, useStore } from "../state/store";
import { ACCENTS, TERMINAL_SCHEMES, UI_FONTS } from "./themes";
import { LANGUAGES, t } from "../i18n";
import { ipc } from "./ipc";

type Kind = { type: "boolean" } | { type: "number"; min?: number; max?: number } | { type: "string" } | { type: "enum"; values: string[] } | { type: "string[]" };

/** The description shown in the editor is the translation `settingsJson.descriptions.<key>`. */
export interface SettingInfo {
  kind: Kind;
}

const bool = (): SettingInfo => ({ kind: { type: "boolean" } });
const num = (min?: number, max?: number): SettingInfo => ({ kind: { type: "number", min, max } });
const str = (): SettingInfo => ({ kind: { type: "string" } });
const oneOf = (values: string[]): SettingInfo => ({ kind: { type: "enum", values } });

/**
 * Every setting a person may change in settings.json. Helm's own records (renamed chats, project
 * colours, removed projects, version markers) live elsewhere and are left out on purpose.
 */
export const SETTINGS_SCHEMA: Partial<Record<keyof Settings, SettingInfo>> = {
  // Appearance
  language: oneOf(["auto", ...LANGUAGES.map((l) => l.code)]),
  theme: oneOf(["dark", "light", "system"]),
  accent: oneOf(Object.keys(ACCENTS)),
  uiFont: oneOf(Object.keys(UI_FONTS)),
  uiScale: num(0.8, 1.5),
  mica: bool(),
  terminalScheme: oneOf(["helm", ...TERMINAL_SCHEMES.map((s) => s.id)]),
  fontFamily: str(),
  fontSize: num(8, 32),
  lineHeight: num(1, 2),
  cursorStyle: oneOf(["bar", "block", "underline"]),
  cursorBlink: bool(),
  sidebarWidth: num(180, 600),
  changesWidth: num(240, 900),
  // General
  restoreTabs: bool(),
  shell: str(),
  startFolder: str(),
  confirmClose: bool(),
  openLinksIn: oneOf(["helm", "browser"]),
  devServerPrompt: bool(),
  deviceFrame: bool(),
  projectSort: oneOf(["recent", "name", "chats"]),
  privacyBlur: bool(),
  snipShortcut: str(),
  snipAutoCopy: bool(),
  voiceMic: str(),
  voiceHoldKey: oneOf(["", "Ctrl+Space", "Ctrl+Shift+Space", "Alt+Shift+Space", "F8", "F9", "F10"]),
  voiceButton: bool(),
  // Terminal
  scrollback: num(1000, 200000),
  copyOnSelect: bool(),
  rightClick: oneOf(["smart", "paste"]),
  bell: oneOf(["none", "flash", "sound"]),
  pasteWarning: bool(),
  gpu: bool(),
  // Claude in Helm
  approvals: bool(),
  usageCockpit: bool(),
  windowsHints: bool(),
  autoOpenAgents: bool(),
  usageTips: bool(),
  hiddenStatusItems: { kind: { type: "string[]" } },
  // Notifications
  notifications: bool(),
  notifyFinished: bool(),
  notifyApproval: bool(),
  notifyUsage: bool(),
  notifySound: bool(),
  // Advanced
  autoUpdate: bool(),
  extraClaudeArgs: str(),
  extraEnv: str(),
};

let cachedPath: string | null = null;
export async function settingsFilePath() {
  cachedPath ??= await join(await appDataDir(), "settings.json");
  return cachedPath;
}

export function isSettingsFile(path: string) {
  return !!cachedPath && path.toLowerCase() === cachedPath.toLowerCase();
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Only what differs from the defaults (and is editable). */
function changed(settings: Settings): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(SETTINGS_SCHEMA) as (keyof Settings)[]) {
    if (!same(settings[key], DEFAULT_SETTINGS[key])) out[key] = settings[key];
  }
  return out;
}

const header = () => `${t("settingsJson.header")}\n`;

/** Is this value allowed for the setting? Returns a reason when not. */
function check(key: string, value: unknown): string | null {
  const info = SETTINGS_SCHEMA[key as keyof Settings];
  if (!info) return t("settingsJson.problems.unknown", { key });
  const k = info.kind;
  if (k.type === "boolean" && typeof value !== "boolean") return t("settingsJson.problems.boolean", { key });
  if (k.type === "string" && typeof value !== "string") return t("settingsJson.problems.string", { key });
  if (k.type === "string[]" && !(Array.isArray(value) && value.every((v) => typeof v === "string"))) return t("settingsJson.problems.stringList", { key });
  if (k.type === "enum" && !k.values.includes(value as string)) return t("settingsJson.problems.enum", { key, values: k.values.map((v) => JSON.stringify(v)).join(", ") });
  if (k.type === "number") {
    if (typeof value !== "number" || Number.isNaN(value)) return t("settingsJson.problems.number", { key });
    if ((k.min !== undefined && value < k.min) || (k.max !== undefined && value > k.max)) return t("settingsJson.problems.range", { key, min: k.min, max: k.max });
  }
  return null;
}

export interface ParsedSettings {
  values: Record<string, unknown>;
  /** Problems with their position in the file. */
  problems: { from: number; to: number; message: string }[];
  /** The file isn't valid JSON at all. */
  broken: boolean;
}

export function parseSettings(text: string): ParsedSettings {
  const errors: ParseError[] = [];
  const raw = parse(text, errors, { allowTrailingComma: true, disallowComments: false });
  const problems = errors.map((e) => ({ from: e.offset, to: e.offset + Math.max(1, e.length), message: friendlyError(printParseErrorCode(e.error)) }));
  if (errors.length || raw === undefined || typeof raw !== "object" || Array.isArray(raw) || raw === null) {
    if (!errors.length) problems.push({ from: 0, to: Math.min(1, text.length), message: t("settingsJson.problems.notObject") });
    return { values: {}, problems, broken: true };
  }
  const values: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const why = check(key, value);
    if (why) {
      const at = text.indexOf(`"${key}"`);
      problems.push({ from: Math.max(0, at), to: Math.max(0, at) + key.length + 2, message: why });
    } else values[key] = value;
  }
  return { values, problems, broken: false };
}

function friendlyError(code: string) {
  const map: Record<string, string> = {
    CommaExpected: "commaExpected",
    ColonExpected: "colonExpected",
    PropertyNameExpected: "propertyNameExpected",
    ValueExpected: "valueExpected",
    CloseBraceExpected: "closeBraceExpected",
    CloseBracketExpected: "closeBracketExpected",
    EndOfFileExpected: "endOfFileExpected",
    InvalidSymbol: "invalidSymbol",
    UnexpectedEndOfString: "unexpectedEndOfString",
  };
  return map[code] ? t(`settingsJson.parseErrors.${map[code]}`) : t("settingsJson.parseErrors.other", { code });
}

/** Applies the file: listed settings take their value, everything else goes back to default. */
function apply(values: Record<string, unknown>) {
  const s = useStore.getState().settings;
  const next = { ...s };
  for (const key of Object.keys(SETTINGS_SCHEMA) as (keyof Settings)[]) {
    (next as Record<string, unknown>)[key] = key in values ? values[key] : DEFAULT_SETTINGS[key];
  }
  applying = true;
  useStore.getState().updateSettings(next);
  applying = false;
  lastWritten = JSON.stringify(changed(next));
}

let applying = false;
/** What the file says, to skip writing it back unchanged. */
let lastWritten = "";
let fileModified = 0;

/** Called after Helm's editor saves a file: if it's settings.json, apply it. */
export function onFileSaved(path: string, text: string) {
  if (!isSettingsFile(path)) return;
  const parsed = parseSettings(text);
  if (parsed.broken) return showToast(t("settingsJson.toasts.broken"), "error");
  apply(parsed.values);
  if (parsed.problems.length) showToast(t("settingsJson.toasts.partial", { count: parsed.problems.length }), "info");
}

/** Opens settings.json in an editor tab, writing it first from the current settings if needed. */
export async function openSettingsJson() {
  const path = await settingsFilePath();
  const exists = await ipc.readTextFile(path).then(
    () => true,
    () => false,
  );
  if (!exists) {
    const body = JSON.stringify(changed(useStore.getState().settings), null, 2);
    fileModified = await ipc.saveFile(path, `${header()}${body}\n`, 0, true);
    lastWritten = JSON.stringify(changed(useStore.getState().settings));
  }
  useStore.getState().openFile(path, undefined, { edit: true });
}

/** Keeps the file in step with the Settings page, editing only the keys that changed. */
async function writeBack(settings: Settings) {
  const now = changed(settings);
  const nowText = JSON.stringify(now);
  if (nowText === lastWritten) return;
  const path = await settingsFilePath();
  let text: string;
  try {
    text = await ipc.readTextFile(path);
  } catch {
    return; // no file yet: it's written when first opened
  }
  const parsed = parseSettings(text);
  if (parsed.broken) return; // never overwrite a file someone is fixing
  let out = text;
  const keys = new Set([...Object.keys(now), ...Object.keys(parsed.values)]);
  for (const key of keys) {
    const value = key in now ? now[key] : undefined;
    if (same(parsed.values[key], value)) continue;
    out = applyEdits(out, modify(out, [key], value, { formattingOptions: { insertSpaces: true, tabSize: 2 } }));
  }
  if (out !== text) fileModified = await ipc.saveFile(path, out, 0, true);
  lastWritten = nowText;
}

/** Reads the file again if it changed outside Helm (checked when the window gets focus). */
async function reloadIfChanged() {
  const path = await settingsFilePath();
  const p = await ipc.previewFile(path).catch(() => null);
  if (!p || p.kind !== "text" || p.modified === fileModified) return;
  fileModified = p.modified;
  const parsed = parseSettings(p.text);
  if (parsed.broken) return showToast(t("settingsJson.toasts.changedOutside"), "error");
  if (JSON.stringify(parsed.values) !== lastWritten) apply(parsed.values);
}

export function initSettingsJson() {
  void settingsFilePath().then(async (path) => {
    const p = await ipc.previewFile(path).catch(() => null);
    if (p?.kind === "text") {
      fileModified = p.modified;
      // The file wins at start-up: it may have been edited while Helm was closed.
      const parsed = parseSettings(p.text);
      if (!parsed.broken && JSON.stringify(parsed.values) !== JSON.stringify(changed(useStore.getState().settings))) apply(parsed.values);
      else lastWritten = JSON.stringify(changed(useStore.getState().settings));
    }
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  useStore.subscribe((s, prev) => {
    if (s.settings === prev.settings || applying) return;
    clearTimeout(timer);
    timer = setTimeout(() => void writeBack(useStore.getState().settings), 400);
  });
  window.addEventListener("focus", () => void reloadIfChanged());
}

// ---------- editor help: suggestions, descriptions on hover, mistakes underlined ----------

function describe(key: string) {
  const info = SETTINGS_SCHEMA[key as keyof Settings];
  if (!info) return null;
  const def = JSON.stringify(DEFAULT_SETTINGS[key as keyof Settings]);
  const k = info.kind;
  const allowed =
    k.type === "enum"
      ? `\n${t("settingsJson.hover.allowed", { values: k.values.map((v) => JSON.stringify(v)).join(", ") })}`
      : k.type === "number" && k.min !== undefined
        ? `\n${t("settingsJson.hover.range", { min: k.min, max: k.max })}`
        : "";
  return `${t(`settingsJson.descriptions.${key}`)}${allowed}\n${t("settingsJson.hover.default", { value: def })}`;
}

function complete(ctx: CompletionContext) {
  const text = ctx.state.doc.toString();
  const loc = getLocation(text, ctx.pos);
  const word = ctx.matchBefore(/"?[\w+-]*"?/);
  if (!word && !ctx.explicit) return null;
  const from = word ? word.from : ctx.pos;
  if (loc.isAtPropertyKey || (loc.path.length <= 1 && !loc.previousNode)) {
    const used = parseSettings(text).values;
    const options: Completion[] = (Object.keys(SETTINGS_SCHEMA) as (keyof Settings)[])
      .filter((key) => !(key in used))
      .map((key) => ({
        label: `"${key}"`,
        type: "property",
        info: describe(key) ?? undefined,
        apply: `"${key}": ${JSON.stringify(DEFAULT_SETTINGS[key])}`,
      }));
    return { from, options, validFor: /^"?[\w+-]*"?$/ };
  }
  const key = loc.path[0];
  const info = typeof key === "string" ? SETTINGS_SCHEMA[key as keyof Settings] : undefined;
  if (!info) return null;
  const values = info.kind.type === "boolean" ? ["true", "false"] : info.kind.type === "enum" ? info.kind.values.map((v) => JSON.stringify(v)) : [];
  if (!values.length) return null;
  return { from, options: values.map((v) => ({ label: v, type: "constant" })), validFor: /^"?[\w+-]*"?$/ };
}

/** Extensions for settings.json in Helm's editor. */
export function settingsEditorExtensions(): Extension[] {
  return [
    json(),
    autocompletion({ override: [complete], activateOnTyping: true }),
    linter((view) => parseSettings(view.state.doc.toString()).problems.map((p): Diagnostic => ({ ...p, severity: "error" })), { delay: 300 }),
    hoverTooltip((view, pos) => {
      const text = view.state.doc.toString();
      const loc = getLocation(text, pos);
      const key = loc.path[0];
      const info = typeof key === "string" ? describe(key) : null;
      if (!info) return null;
      return {
        pos,
        above: true,
        create: () => {
          const dom = document.createElement("div");
          dom.className = "cm-settings-hover";
          dom.textContent = `${key}\n${info}`;
          return { dom };
        },
      };
    }),
  ];
}
