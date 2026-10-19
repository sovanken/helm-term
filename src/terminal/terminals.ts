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
import { openPath, openUrl } from "@tauri-apps/plugin-opener";
import { ipc, quotePath } from "../lib/ipc";
import { resolveTheme, terminalThemes } from "../lib/themes";
import { type Settings, useStore } from "../state/store";

interface Entry {
  term: Terminal;
  fit: FitAddon;
  search: SearchAddon;
  host: HTMLDivElement;
  opened: boolean;
  launched: boolean;
  resizeTimer?: number;
}

const entries = new Map<string, Entry>();
let windowsBuild = 22621;

export async function initTerminals() {
  windowsBuild = await ipc.osBuild().catch(() => windowsBuild);
}

function terminalOptions(settings: Settings) {
  return {
    fontFamily: settings.fontFamily,
    fontSize: settings.fontSize,
    lineHeight: 1.15,
    theme: terminalThemes[resolveTheme(settings.theme)],
  };
}

function ensure(paneId: string): Entry {
  const existing = entries.get(paneId);
  if (existing) return existing;

  const term = new Terminal({
    ...terminalOptions(useStore.getState().settings),
    allowProposedApi: true,
    cursorBlink: true,
    cursorStyle: "bar",
    scrollback: 10000,
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

function wire(paneId: string, { term }: Entry) {
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
    entry.term.paste(text);
    return;
  }
  // No text: a screenshot becomes a PNG file whose path Claude Code attaches as an image.
  const image = await ipc.pasteImage().catch(() => null);
  if (image) entry.term.paste(quotePath(image) + " ");
}

export function insertText(paneId: string, text: string) {
  entries.get(paneId)?.term.paste(text);
  focusTerminal(paneId);
}

export async function copySelectionOrPaste(paneId: string) {
  const entry = entries.get(paneId);
  if (!entry) return;
  if (entry.term.hasSelection()) {
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
    try {
      const webgl = new WebglAddon();
      webgl.onContextLoss(() => webgl.dispose());
      entry.term.loadAddon(webgl);
    } catch {
      // DOM renderer fallback.
    }
  }
  refit(paneId);
}

export function detach(paneId: string, container: HTMLElement) {
  const entry = entries.get(paneId);
  if (entry && entry.host.parentElement === container) container.removeChild(entry.host);
}

export function refit(paneId: string) {
  const entry = entries.get(paneId);
  if (!entry?.opened || !entry.host.isConnected || entry.host.clientWidth === 0) return;
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

async function launch(paneId: string, entry: Entry) {
  const store = useStore.getState();
  const pane = store.panes[paneId];
  if (!pane) return;

  let { resumeSessionId, sessionId } = pane;
  if (resumeSessionId && !(await ipc.sessionExists(resumeSessionId).catch(() => false))) {
    resumeSessionId = undefined;
    sessionId = crypto.randomUUID();
  }
  store.updatePane(paneId, { resumeSessionId: undefined, sessionId: resumeSessionId ?? sessionId });

  const channel = new Channel<ArrayBuffer | number[]>();
  channel.onmessage = (data) => entry.term.write(data instanceof ArrayBuffer ? new Uint8Array(data) : Uint8Array.from(data));

  try {
    await ipc.launch(
      {
        paneId,
        cwd: pane.cwd,
        kind: pane.kind,
        newSessionId: pane.kind === "claude" && !resumeSessionId ? sessionId : undefined,
        resumeSessionId,
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
  clearTimeout(entry.resizeTimer);
  void ipc.kill(paneId).catch(() => {});
  entry.term.dispose();
  entry.host.remove();
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
      entry.term.options.fontFamily = opts.fontFamily;
      entry.term.options.fontSize = opts.fontSize;
      entry.term.options.theme = opts.theme;
      refit(id);
    }
  }
});

export function applyThemeToAll() {
  const theme = terminalOptions(useStore.getState().settings).theme;
  for (const entry of entries.values()) entry.term.options.theme = theme;
}
