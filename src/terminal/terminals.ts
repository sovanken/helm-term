// Owns one xterm.js instance + PTY per pane. Instances live outside React so they survive
// re-renders and layout changes; a pane is disposed when it disappears from the store.

import { Terminal, type ILink } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { WebglAddon } from "@xterm/addon-webgl";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { UnicodeGraphemesAddon } from "@xterm/addon-unicode-graphemes";
import { Channel } from "@tauri-apps/api/core";
import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
import { ask } from "@tauri-apps/plugin-dialog";
import { openPath, openUrl } from "@tauri-apps/plugin-opener";
import { ipc, quotePath } from "../lib/ipc";
import { fontStack, resolveTheme, terminalTheme } from "../lib/themes";
import { type Settings, useStore } from "../state/store";

interface Entry {
  term: Terminal;
  fit: FitAddon;
  search: SearchAddon;
  host: HTMLDivElement;
  opened: boolean;
  launched: boolean;
  resizeTimer?: number;
  webgl?: WebglAddon;
}

const entries = new Map<string, Entry>();
/** Current launch per pane; hook events from older launches (e.g. a process being stopped) are ignored. */
const launchIds = new Map<string, string>();

export function isCurrentLaunch(paneId: string, launchId?: string | null) {
  return !launchId || launchIds.get(paneId) === launchId;
}
let windowsBuild = 22621;

export function windowsBuildNumber() {
  return windowsBuild;
}

export async function initTerminals() {
  windowsBuild = await ipc.osBuild().catch(() => windowsBuild);
}

export function currentTerminalTheme(settings: Settings) {
  return terminalTheme(settings.terminalScheme, resolveTheme(settings.theme), settings.accent);
}

function terminalOptions(settings: Settings) {
  return {
    fontFamily: fontStack(settings.fontFamily),
    fontSize: settings.fontSize,
    lineHeight: settings.lineHeight,
    theme: currentTerminalTheme(settings),
    cursorStyle: settings.cursorStyle,
    cursorBlink: settings.cursorBlink,
    scrollback: settings.scrollback,
  };
}

function loadWebgl(entry: Entry) {
  if (entry.webgl || !useStore.getState().settings.gpu) return;
  try {
    const webgl = new WebglAddon();
    webgl.onContextLoss(() => {
      webgl.dispose();
      entry.webgl = undefined;
    });
    entry.term.loadAddon(webgl);
    entry.webgl = webgl;
  } catch {
    // DOM renderer fallback.
  }
}

/** Short visual "bell" flash on the pane, or the system sound, per settings. */
function ring(entry: Entry) {
  const bell = useStore.getState().settings.bell;
  if (bell === "flash") {
    entry.host.classList.remove("term-bell");
    void entry.host.offsetWidth; // restart the animation
    entry.host.classList.add("term-bell");
  } else if (bell === "sound") {
    audio ??= new AudioContext();
    const ctx = audio;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.08, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.15);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.16);
  }
}

let audio: AudioContext | undefined;

function ensure(paneId: string): Entry {
  const existing = entries.get(paneId);
  if (existing) return existing;

  const term = new Terminal({
    ...terminalOptions(useStore.getState().settings),
    allowProposedApi: true,
    smoothScrollDuration: 80,
    rescaleOverlappingGlyphs: true,
    windowsPty: { backend: "conpty", buildNumber: windowsBuild },
  });
  const fit = new FitAddon();
  const search = new SearchAddon();
  term.loadAddon(fit);
  term.loadAddon(search);
  term.loadAddon(new UnicodeGraphemesAddon());
  term.unicode.activeVersion = "15-graphemes";
  term.loadAddon(new WebLinksAddon((_e, uri) => void openUrl(uri)));

  const host = document.createElement("div");
  host.className = "term-host";

  const entry: Entry = { term, fit, search, host, opened: false, launched: false };
  entries.set(paneId, entry);
  wire(paneId, entry);
  return entry;
}

function wire(paneId: string, entry: Entry) {
  const { term } = entry;
  term.onBell(() => ring(entry));
  term.onSelectionChange(() => {
    if (useStore.getState().settings.copyOnSelect && term.hasSelection()) void writeText(term.getSelection());
  });
  term.onData((data) => void ipc.write(paneId, data).catch(() => {}));
  term.onBinary((data) => void ipc.write(paneId, data).catch(() => {}));
  term.onTitleChange((title) => useStore.getState().updatePane(paneId, { title }));

  // OSC 9;9 "<path>" — current folder reported by the shell prompt.
  term.parser.registerOscHandler(9, (data) => {
    if (!data.startsWith("9;")) return false;
    const cwd = data.slice(2).replace(/^"|"$/g, "");
    if (cwd) useStore.getState().updatePane(paneId, { cwd });
    return true;
  });

  term.attachCustomKeyEventHandler((e) => {
    const ctrl = e.ctrlKey && !e.altKey && !e.metaKey;
    const key = e.key.toLowerCase();

    // Ctrl+C copies when text is selected, otherwise it stays an interrupt.
    if (ctrl && key === "c" && (e.shiftKey || term.hasSelection())) {
      if (e.type === "keydown" && term.hasSelection()) {
        void writeText(term.getSelection());
        term.clearSelection();
      }
      e.preventDefault();
      return false;
    }
    if (ctrl && key === "v") {
      e.preventDefault();
      if (e.type === "keydown") void pasteInto(paneId);
      return false;
    }
    // Shift+Enter inserts a newline in Claude Code's prompt (sent as Alt+Enter).
    if (e.key === "Enter" && e.shiftKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      if (e.type === "keydown") void ipc.write(paneId, "\x1b\r");
      return false;
    }
    return true;
  });

  term.registerLinkProvider({ provideLinks: (y, cb) => void provideFileLinks(paneId, term, y).then(cb) });
}

// ---------- file links ----------

// Windows absolute paths, or relative paths with a file extension, optionally followed by :line[:col].
const PATH_RE =
  /(?:[A-Za-z]:[\\/]|\.{1,2}[\\/]|~[\\/])?(?:[\w.@-]+[\\/])*[\w@-][\w.@-]*\.[A-Za-z][A-Za-z0-9]{0,9}(?::(\d+)(?::(\d+))?)?/g;
const resolveCache = new Map<string, Promise<string | null>>();

function resolveCached(cwd: string, path: string) {
  const key = `${cwd}|${path}`;
  let hit = resolveCache.get(key);
  if (!hit) {
    hit = ipc.resolvePath(cwd, path).catch(() => null);
    resolveCache.set(key, hit);
    if (resolveCache.size > 2000) resolveCache.delete(resolveCache.keys().next().value!);
  }
  return hit;
}

async function provideFileLinks(paneId: string, term: Terminal, y: number): Promise<ILink[] | undefined> {
  const line = term.buffer.active.getLine(y - 1)?.translateToString(true);
  const cwd = useStore.getState().panes[paneId]?.cwd;
  if (!line || !cwd) return undefined;

  const candidates = [...line.matchAll(PATH_RE)].filter((m) => !/^\d+(\.\d+)+$/.test(m[0].split(":")[0]));
  const links = await Promise.all(
    candidates.map(async (m) => {
      const text = m[0];
      const file = text.replace(/:\d+(?::\d+)?$/, "");
      const resolved = await resolveCached(cwd, file);
      if (!resolved) return null;
      const lineNo = m[1] ? Number(m[1]) : undefined;
      const col = m[2] ? Number(m[2]) : undefined;
      const start = m.index! + 1;
      return {
        range: { start: { x: start, y }, end: { x: start + text.length - 1, y } },
        text,
        decorations: { underline: true, pointerCursor: true },
        activate: () => {
          void ipc.openInEditor(resolved, lineNo, col).then((ok) => {
            if (!ok) void openPath(resolved);
          });
        },
      } satisfies ILink;
    }),
  );
  const found = links.filter((l) => l !== null);
  return found.length ? found : undefined;
}

// ---------- clipboard ----------

export async function pasteInto(paneId: string) {
  const entry = entries.get(paneId);
  if (!entry) return;
  const text = await readText().catch(() => "");
  if (text) {
    // In a plain shell every pasted line runs as a command; Claude's prompt pastes safely.
    const s = useStore.getState();
    const pane = s.panes[paneId];
    const claude = pane && (pane.claudeActive || pane.kind === "claude");
    const lines = text.replace(/\r?\n$/, "").split(/\r?\n/).length;
    if (lines > 1 && !claude && s.settings.pasteWarning) {
      const ok = await ask(`You're pasting ${lines} lines into a shell. Each line runs as its own command.\n\n${text.slice(0, 300)}${text.length > 300 ? "…" : ""}`, {
        title: "Paste multiple lines?",
        kind: "warning",
        okLabel: "Paste",
        cancelLabel: "Cancel",
      });
      if (!ok) return focusTerminal(paneId);
    }
    // A huge paste stays in the conversation and is re-sent with every message; a file is read once.
    if (claude && text.length > 20_000 && s.settings.usageTips) {
      const asFile = await ask(
        `This paste is ${Math.round(text.length / 1000)}k characters. Pasted text is re-sent with every later message. Saving it as a file and attaching the path lets Claude read it only when needed, which saves usage.`,
        { title: "Attach as a file?", okLabel: "Attach as file", cancelLabel: "Paste text" },
      );
      if (asFile) {
        const path = await ipc.savePaste(text).catch(() => null);
        if (path) {
          entry.term.paste(`${quotePath(path)} `);
          return;
        }
      }
    }
    entry.term.paste(text);
    return;
  }
  // No text: a screenshot becomes a PNG file whose path Claude Code attaches as an image.
  const image = await ipc.pasteImage().catch(() => null);
  if (image) entry.term.paste(quotePath(image) + " ");
}

/** Types a slash command into Claude's prompt, optionally submitting it. */
export function typeCommand(paneId: string, text: string, submit: boolean) {
  void ipc.write(paneId, text).then(() => {
    // A short pause lets Claude's autocomplete settle before Enter.
    if (submit) setTimeout(() => void ipc.write(paneId, "\r"), 120);
  });
  focusTerminal(paneId);
}

export function insertText(paneId: string, text: string) {
  entries.get(paneId)?.term.paste(text);
  focusTerminal(paneId);
}

export async function copySelectionOrPaste(paneId: string) {
  const entry = entries.get(paneId);
  if (!entry) return;
  if (entry.term.hasSelection() && useStore.getState().settings.rightClick === "smart") {
    await writeText(entry.term.getSelection());
    entry.term.clearSelection();
  } else {
    await pasteInto(paneId);
  }
}

// ---------- lifecycle ----------

export function attach(paneId: string, container: HTMLElement) {
  const entry = ensure(paneId);
  container.appendChild(entry.host);
  if (!entry.opened) {
    entry.term.open(entry.host);
    entry.opened = true;
    loadWebgl(entry);
  }
  refit(paneId);
}

export function detach(paneId: string, container: HTMLElement) {
  const entry = entries.get(paneId);
  if (entry && entry.host.parentElement === container) container.removeChild(entry.host);
}

/**
 * While a panel edge or split divider is being dragged, terminals keep their size and re-fit once
 * at the end. Re-wrapping the text on every pixel of the drag is what makes terminals jump.
 */
let liveResize = false;

export function beginLiveResize() {
  liveResize = true;
  document.documentElement.dataset.resizing = "";
}

export function endLiveResize() {
  liveResize = false;
  delete document.documentElement.dataset.resizing;
  requestAnimationFrame(() => {
    for (const id of entries.keys()) refit(id);
  });
}

export function refit(paneId: string) {
  const entry = entries.get(paneId);
  if (!entry?.opened || !entry.host.isConnected || entry.host.clientWidth === 0) return;
  if (liveResize && entry.launched) return;
  const dims = entry.fit.proposeDimensions();
  if (!dims || !Number.isFinite(dims.cols) || dims.cols < 2) return;
  if (dims.cols !== entry.term.cols || dims.rows !== entry.term.rows) entry.term.resize(dims.cols, dims.rows);

  if (!entry.launched) {
    entry.launched = true;
    void launch(paneId, entry);
    return;
  }
  clearTimeout(entry.resizeTimer);
  entry.resizeTimer = window.setTimeout(() => {
    void ipc.resize(paneId, entry.term.cols, entry.term.rows).catch(() => {});
  }, 60);
}

/** "NAME=value" lines → pairs (blank lines and # comments ignored). */
function parseEnv(text: string): [string, string][] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1)] as [string, string]);
}

async function launch(paneId: string, entry: Entry) {
  const store = useStore.getState();
  const pane = store.panes[paneId];
  if (!pane) return;

  let { resumeSessionId, sessionId } = pane;
  let cwd = pane.cwd;
  if (resumeSessionId) {
    if (!(await ipc.sessionExists(resumeSessionId).catch(() => false))) {
      resumeSessionId = undefined;
      sessionId = crypto.randomUUID();
    } else {
      // Claude only resumes a conversation from the folder it started in (or its worktree).
      const original = await ipc.sessionCwd(resumeSessionId).catch(() => null);
      if (original && original.toLowerCase() !== cwd.toLowerCase() && !cwd.toLowerCase().startsWith(original.toLowerCase())) {
        cwd = original;
        store.updatePane(paneId, { cwd });
      }
    }
  }
  store.updatePane(paneId, { resumeSessionId: undefined, worktree: undefined, sessionId: resumeSessionId ?? sessionId });

  const launchId = crypto.randomUUID();
  launchIds.set(paneId, launchId);
  const channel = new Channel<ArrayBuffer | number[]>();
  channel.onmessage = (data) => entry.term.write(data instanceof ArrayBuffer ? new Uint8Array(data) : Uint8Array.from(data));

  try {
    await ipc.launch(
      {
        paneId,
        cwd,
        kind: pane.kind,
        shell: pane.shell ?? store.settings.shell,
        windowsHints: store.settings.windowsHints,
        approvals: store.settings.approvals,
        usage: store.settings.usageCockpit,
        extraArgs: store.settings.extraClaudeArgs,
        env: parseEnv(store.settings.extraEnv),
        newSessionId: pane.kind === "claude" && !resumeSessionId ? sessionId : undefined,
        resumeSessionId,
        worktree: resumeSessionId ? undefined : pane.worktree,
        launchId,
        cols: entry.term.cols,
        rows: entry.term.rows,
      },
      channel as Channel<ArrayBuffer>,
    );
  } catch (err) {
    entry.term.write(`\r\n\x1b[31mHelm could not start this terminal: ${String(err)}\x1b[0m\r\n`);
  }
}

function dispose(paneId: string) {
  const entry = entries.get(paneId);
  if (!entry) return;
  entries.delete(paneId);
  launchIds.delete(paneId);
  clearTimeout(entry.resizeTimer);
  void ipc.kill(paneId).catch(() => {});
  entry.term.dispose();
  entry.host.remove();
}

/** Dev/test helper: the last `lines` lines of a pane's terminal as text. */
export function readBuffer(paneId: string, lines = 40): string {
  const buf = entries.get(paneId)?.term.buffer.active;
  if (!buf) return "";
  const out: string[] = [];
  for (let i = Math.max(0, buf.length - lines); i < buf.length; i++) out.push(buf.getLine(i)?.translateToString(true) ?? "");
  return out.join("\n");
}

export function focusTerminal(paneId: string) {
  entries.get(paneId)?.term.focus();
}

export function getSearch(paneId: string) {
  return entries.get(paneId)?.search;
}

export function clearTerminal(paneId: string) {
  entries.get(paneId)?.term.clear();
}

// Keep terminals in sync with the store: dispose removed panes, apply settings changes.
useStore.subscribe((state, prev) => {
  if (state.panes !== prev.panes) {
    for (const id of entries.keys()) if (!state.panes[id]) dispose(id);
  }
  if (state.settings !== prev.settings) {
    const opts = terminalOptions(state.settings);
    for (const [id, entry] of entries) {
      const o = entry.term.options;
      if (o.fontFamily !== opts.fontFamily) o.fontFamily = opts.fontFamily;
      if (o.fontSize !== opts.fontSize) o.fontSize = opts.fontSize;
      if (o.lineHeight !== opts.lineHeight) o.lineHeight = opts.lineHeight;
      if (o.cursorStyle !== opts.cursorStyle) o.cursorStyle = opts.cursorStyle;
      if (o.cursorBlink !== opts.cursorBlink) o.cursorBlink = opts.cursorBlink;
      if (o.scrollback !== opts.scrollback) o.scrollback = opts.scrollback;
      o.theme = opts.theme;
      if (state.settings.gpu !== prev.settings.gpu) {
        if (state.settings.gpu) loadWebgl(entry);
        else {
          entry.webgl?.dispose();
          entry.webgl = undefined;
        }
      }
      refit(id);
    }
  }
});

export function applyThemeToAll() {
  const theme = currentTerminalTheme(useStore.getState().settings);
  for (const entry of entries.values()) entry.term.options.theme = theme;
}

/** Re-measures every terminal after web fonts finish loading. */
export function remeasureAll() {
  for (const [id, entry] of entries) {
    const family = entry.term.options.fontFamily;
    entry.term.options.fontFamily = `${family} `; // forces xterm to re-measure the cell size
    entry.term.options.fontFamily = family;
    refit(id);
  }
}
