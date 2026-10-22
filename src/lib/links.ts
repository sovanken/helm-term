// Web links and local dev servers: open them in a Helm browser tab or the user's own browser.

import { openUrl } from "@tauri-apps/plugin-opener";
import { folderName, showToast, useStore } from "../state/store";
import { t } from "../i18n";

/** Opens a link where the user wants web pages: a Helm browser tab or their own browser. */
export function openLink(url: string, opts?: { beside?: boolean; cwd?: string }) {
  if (useStore.getState().settings.openLinksIn === "browser") void openUrl(url);
  else useStore.getState().openBrowser(url, opts);
}

// Local addresses dev servers print, e.g. "Local: http://localhost:5173/".
const LOCAL_URL = /\bhttps?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(?::\d{2,5})?(?:\/[^\s'"`<>)\]]*)?/g;
// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;

const tails = new Map<string, string>();
const decoders = new Map<string, TextDecoder>();
const offered = new Set<string>();

function normalize(raw: string) {
  const url = raw.replace("0.0.0.0", "localhost").replace(/[.,;:]+$/, "");
  try {
    const u = new URL(url);
    // Helm's own hook bridge and similar API-only addresses aren't pages to open.
    if (u.pathname.startsWith("/hook") || u.pathname.startsWith("/permission") || u.pathname.startsWith("/status")) return null;
    return u.href;
  } catch {
    return null;
  }
}

/** Watches a terminal's output for a dev server address and offers to open it once. */
export function scanForDevServer(paneId: string, data: Uint8Array) {
  let decoder = decoders.get(paneId);
  if (!decoder) decoders.set(paneId, (decoder = new TextDecoder()));
  // Keep a short tail so an address split across two chunks is still found.
  const text = ((tails.get(paneId) ?? "") + decoder.decode(data, { stream: true })).replace(ANSI, "");
  tails.set(paneId, text.slice(-300));
  if (!text.includes("://")) return;
  for (const match of text.matchAll(LOCAL_URL)) {
    const url = normalize(match[0]);
    if (!url) continue;
    const s = useStore.getState();
    if (!s.devServers.includes(url)) s.set({ devServers: [url, ...s.devServers].slice(0, 8) });
    const key = `${paneId}|${url}`;
    if (offered.has(key)) continue;
    offered.add(key);
    // Already showing it in a browser pane? Nothing to offer.
    if (Object.values(s.panes).some((p) => p.kind === "browser" && p.url?.startsWith(url))) continue;
    if (!s.settings.devServerPrompt) continue;
    const pane = s.panes[paneId];
    const where = url.replace(/^https?:\/\//, "").replace(/\/$/, "");
    showToast(pane ? t("links.serving", { name: folderName(pane.cwd), address: where }) : t("links.servingUnknown", { address: where }), "info", {
      label: t("links.openInHelm"),
      run: () => useStore.getState().openBrowser(url, { beside: true, cwd: pane?.cwd }),
    }, { label: t("links.openInBrowser"), run: () => void openUrl(url) });
  }
}

export function forgetPane(paneId: string) {
  tails.delete(paneId);
  decoders.delete(paneId);
}
