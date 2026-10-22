import { setLanguage, t } from "./i18n";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { refreshSessions } from "./components/HistoryList";
import { refreshRecent } from "./components/Sidebar";
import { ipc } from "./lib/ipc";
import { installShortcuts } from "./lib/shortcuts";
import { initSnips } from "./snip/snip";
import { initVoice } from "./lib/voice";
import { initSettingsJson } from "./lib/settingsJson";
import { startUpdateChecks } from "./lib/updater";
import { initEvents } from "./state/events";
import { initBrowserEvents } from "./lib/browser";
import { restore } from "./state/persist";
import { getVersion } from "@tauri-apps/api/app";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { showToast, useStore } from "./state/store";
import { initTerminals, readBuffer, remeasureAll } from "./terminal/terminals";
import "@fontsource-variable/inter";
import "@fontsource-variable/geist";
import "@fontsource-variable/jetbrains-mono";
import "@fontsource-variable/geist-mono";
import "./styles.css";

/** After an update, tell the user once what changed. A fresh install just records the version. */
async function announceUpdate() {
  const version = await getVersion().catch(() => "");
  const s = useStore.getState();
  if (!version || s.settings.lastSeenVersion === version) return;
  if (s.settings.lastSeenVersion) {
    setTimeout(() => showToast(t("app.updated", { version }), "success", { label: t("app.whatsNew"), run: () => useStore.getState().openSettings("whats-new") }), 1500);
  }
  s.updateSettings({ lastSeenVersion: version });
}

/**
 * Fades the splash screen (index.html) out once the app has drawn, and, when a terminal tab is
 * showing, once its shell has printed something (so there's no blank terminal). Never waits
 * more than 1.5 s for the shell.
 */
async function hideSplash() {
  const splash = document.getElementById("splash");
  if (!splash) return;
  const s = useStore.getState();
  const paneId = s.view === "terminal" ? s.tabs.find((t) => t.id === s.activeTabId)?.activePaneId : undefined;
  if (paneId && s.panes[paneId]?.kind !== "browser") {
    const until = Date.now() + 1500;
    while (Date.now() < until && !readBuffer(paneId).trim()) await new Promise((r) => setTimeout(r, 40));
  }
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      splash.classList.add("done");
      splash.addEventListener("transitionend", () => splash.remove(), { once: true });
      setTimeout(() => splash.remove(), 600);
    }),
  );
}

async function boot() {
  // A reloaded page can't see terminals started by the previous one; stop them first.
  await ipc.reset().catch(() => {});
  initBrowserEvents();
  const [homeDir] = await Promise.all([ipc.homeDir(), initTerminals(), initEvents()]);
  useStore.getState().set({ homeDir });
  await restore().catch((err) => console.error("Could not restore session", err));
  await setLanguage(useStore.getState().settings.language).catch(() => {});
  useStore.subscribe((s, prev) => s.settings.language !== prev.settings.language && void setLanguage(s.settings.language));
  // Terminals measure their cell size from the font, so load the bundled fonts first.
  await Promise.race([
    Promise.all(
      ["Inter Variable", "Geist Variable", "JetBrains Mono Variable", "Geist Mono Variable"].map((f) => document.fonts.load(`14px "${f}"`)),
    ),
    new Promise((r) => setTimeout(r, 1500)),
  ]).catch(() => {});
  document.fonts.addEventListener("loadingdone", () => remeasureAll());
  void announceUpdate();
  installShortcuts();
  initSnips();
  initVoice();
  initSettingsJson();
  void refreshRecent();
  void refreshSessions();
  startUpdateChecks();
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <ErrorBoundary>
      <App />
    </ErrorBoundary>,
  );
  void hideSplash();
}

// Dev only: state and terminal modules hold live terminals, so a partial hot swap would orphan
// them. Reload the whole page when one of them changes (boot() then cleans up and restores tabs).
import.meta.hot?.on("vite:beforeUpdate", ({ updates }) => {
  if (updates.some((u) => /\/src\/(state|terminal)\//.test(u.path))) location.reload();
});

// Dev only: lets automated UI tests drive the app state.
if (import.meta.env.DEV) Object.assign(window, { __helm: useStore, __helmRead: readBuffer });

// The window starts hidden, so nothing see-through shows while Helm loads; show it as soon as the
// splash screen has painted. (Rust shows it anyway after a few seconds if this never runs.)
// The snip overlay shows itself once its screen image is ready.
if (location.hash !== "#snip") requestAnimationFrame(() => requestAnimationFrame(() => void getCurrentWindow().show().catch(() => {})));

if (location.hash === "#snip") {
  // The full-screen snip overlay window runs only the overlay, not the app.
  void import("./snip/SnipOverlay").then(({ SnipOverlay }) => {
    document.documentElement.dataset.theme = "dark";
    ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(<SnipOverlay />);
  });
} else {
  void boot().catch((err) => {
    console.error("Helm couldn't start", err);
    void hideSplash();
  });
}
