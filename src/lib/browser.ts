// Built-in browser: commands for the page views, page events from the backend, and "send to
// Claude" for errors, screenshots and picked elements.

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import { paneIds } from "./layout";
import { quotePath } from "./ipc";
import { deviceById, screenSize } from "./devices";
import { type Pane, type PageProblem, showToast, useStore } from "../state/store";
import { insertText } from "../terminal/terminals";
import { t } from "../i18n";

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PickedElement {
  selector: string;
  tag: string;
  text: string;
  html: string;
  size: string;
  page: string;
}

export const browser = {
  open: (paneId: string, url: string, b: Bounds) => invoke<void>("browser_open", { paneId, url, ...b }),
  bounds: (paneId: string, b: Bounds) => invoke<void>("browser_bounds", { paneId, ...b }),
  visible: (paneId: string, visible: boolean) => invoke<void>("browser_visible", { paneId, visible }),
  navigate: (paneId: string, url: string) => invoke<string>("browser_navigate", { paneId, url }),
  go: (paneId: string, action: "back" | "forward" | "reload" | "stop") => invoke<void>("browser_go", { paneId, action }),
  close: (paneId: string) => invoke<void>("browser_close", { paneId }),
  /** Closes page views whose pane no longer exists (e.g. after a reload). */
  keepOnly: (paneIds: string[]) => invoke<void>("browser_keep_only", { paneIds }),
  devtools: (paneId: string) => invoke<void>("browser_devtools", { paneId }),
  emulate: (paneId: string, device: { width: number; height: number; scaleFactor: number; mobile: boolean; touch: boolean; userAgent?: string; fit: number } | null) =>
    invoke<void>("browser_emulate", { paneId, device }),
  screenshot: (paneId: string) => invoke<string>("browser_screenshot", { paneId }),
  pick: (paneId: string, on: boolean) => invoke<void>("browser_pick", { paneId, on }),
};

/** Address shown for a page: host and path, without the scheme. */
export function displayUrl(url?: string) {
  if (!url || url === "about:blank") return "";
  return url.replace(/^https?:\/\//, "").replace(/\/$/, "");
}

export function pageName(pane: Pane) {
  const host = (() => {
    try {
      return new URL(pane.url ?? "").host;
    } catch {
      return "";
    }
  })();
  return pane.page?.title?.trim() || host || t("browser.newPage");
}

// ---------- page events ----------

const MAX_PROBLEMS = 200;

/** Closes a pane's page view when the pane goes away, however it was closed. */
function closeWithPanes() {
  const ids = () => Object.values(useStore.getState().panes).filter((p) => p.kind === "browser").map((p) => p.id);
  let known = new Set(ids());
  void browser.keepOnly([...known]).catch(() => {});
  useStore.subscribe((s, prev) => {
    if (s.panes === prev.panes) return;
    const now = new Set(ids());
    for (const id of known) if (!now.has(id)) void browser.close(id).catch(() => {});
    known = now;
  });
}

export function initBrowserEvents() {
  closeWithPanes();
  void listen<Record<string, unknown> & { kind: string; pane: string }>("browser", ({ payload: e }) => {
    const s = useStore.getState();
    const pane = s.panes[e.pane];
    if (!pane) return;
    switch (e.kind) {
      case "load":
        // A new page drops its errors, and any picker that was running in the old one.
        if (e.loading) s.updatePage(e.pane, { loading: true, problems: [], picking: false });
        else s.updatePage(e.pane, { loading: false });
        if (typeof e.url === "string" && e.url !== pane.url) s.updatePane(e.pane, { url: e.url });
        break;
      case "url":
        s.updatePage(e.pane, { canBack: !!e.canBack, canForward: !!e.canForward });
        if (typeof e.url === "string" && e.url && e.url !== pane.url) s.updatePane(e.pane, { url: e.url });
        break;
      case "title":
        s.updatePage(e.pane, { title: String(e.title ?? "") });
        break;
      case "problem": {
        const p = e.problem as Omit<PageProblem, "time">;
        const problems = [...(pane.page?.problems ?? []), { ...p, time: Date.now() }].slice(-MAX_PROBLEMS);
        s.updatePage(e.pane, { problems });
        break;
      }
      case "picked":
        if (!pane.page?.picking) break; // only when the user turned picking on
        s.updatePage(e.pane, { picking: false });
        sendElementToClaude(pane, e.element as PickedElement);
        break;
      case "pickCancelled":
        s.updatePage(e.pane, { picking: false });
        break;
      case "pickFailed":
        s.updatePage(e.pane, { picking: false });
        showToast(t("browser.pickFailed"), "error");
        break;
      case "newWindow":
        if (typeof e.url === "string") s.openBrowser(e.url, { cwd: pane.cwd });
        break;
      case "blocked":
        showToast(t("browser.blocked"), "error");
        break;
    }
  });
}

// ---------- send to Claude ----------

/** The Claude pane a browser pane belongs to: same tab first, then same project, then the latest one. */
function claudeFor(browserPane: Pane): Pane | undefined {
  const s = useStore.getState();
  const isClaude = (p?: Pane) => !!p && p.kind !== "browser" && (p.claudeActive || p.kind === "claude");
  const tab = s.tabs.find((t) => paneIds(t.root).includes(browserPane.id));
  if (tab) {
    const ids = paneIds(tab.root);
    const inTab = ids.map((id) => s.panes[id]).filter(isClaude);
    if (inTab.length) return inTab.find((p) => p.id === tab.activePaneId) ?? inTab[0];
  }
  const all = Object.values(s.panes).filter(isClaude);
  const sameProject = all.filter((p) => p.cwd.toLowerCase() === browserPane.cwd.toLowerCase());
  const byRecent = (list: Pane[]) => [...list].sort((a, b) => (b.lastActivity ?? 0) - (a.lastActivity ?? 0))[0];
  return byRecent(sameProject) ?? byRecent(all);
}

/**
 * `text` may be several pieces, pasted one after another (an image path must be its own paste to attach).
 * `done` is the (translated) message shown once it is in Claude's prompt.
 */
function sendToClaude(browserPane: Pane, text: string | string[], done: string) {
  const s = useStore.getState();
  const target = claudeFor(browserPane);
  if (!target) {
    showToast(t("browser.needClaude"), "error", {
      label: t("common.newClaudeTab"),
      run: () => s.openTab(browserPane.cwd, "claude"),
    });
    return;
  }
  const tab = s.tabs.find((t) => paneIds(t.root).includes(target.id));
  if (tab && tab.id !== s.activeTabId) s.setActiveTab(tab.id);
  s.focusPane(target.id);
  for (const part of Array.isArray(text) ? text : [text]) insertText(target.id, part);
  showToast(done, "success");
}

function problemLine(p: PageProblem) {
  const where = p.at ? ` (${p.at})` : "";
  const kind = p.source === "network" ? "Request failed" : p.source === "exception" ? "Uncaught error" : p.level === "warning" ? "Warning" : "Error";
  return `- ${kind}: ${p.text.replace(/\s+/g, " ").trim()}${where}`;
}

export function sendProblemsToClaude(pane: Pane, problems: PageProblem[]) {
  const lines: string[] = [];
  let size = 0;
  for (const p of problems.slice(-40)) {
    const line = problemLine(p);
    if (size + line.length > 6000) break;
    lines.push(line);
    size += line.length;
  }
  const text = `The page ${pane.url ?? ""} shows these problems:\n${lines.join("\n")}\n\nPlease find the cause and fix it. `;
  sendToClaude(pane, text, problems.length === 1 ? t("browser.sent.error") : t("browser.sent.problems", { count: problems.length }));
}

export async function sendScreenshotToClaude(pane: Pane) {
  try {
    const path = await browser.screenshot(pane.id);
    const device = deviceById(pane.page?.device);
    const size = device ? screenSize(device, pane.page?.rotated) : null;
    const where = device && size ? ` on ${device.label} (${size.width}×${size.height})` : "";
    sendToClaude(pane, [quotePath(path), ` This is how ${pane.url ?? "the page"} looks${where}. `], t("browser.sent.screenshot"));
  } catch (e) {
    showToast(t("browser.captureFailed", { error: String(e) }), "error");
  }
}

function sendElementToClaude(pane: Pane, el: PickedElement) {
  const text = [
    `On ${el.page}, this element:`,
    `- selector: ${el.selector}`,
    el.text ? `- text: "${el.text}"` : "",
    `- size: ${el.size}`,
    "```html",
    el.html,
    "```",
    "",
  ]
    .filter((l, i) => l !== "" || i > 5)
    .join("\n");
  sendToClaude(pane, text, t("browser.sent.element"));
}
