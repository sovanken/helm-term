import ReactDOM from "react-dom/client";
import App from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { refreshSessions } from "./components/HistoryList";
import { refreshRecent } from "./components/Sidebar";
import { ipc } from "./lib/ipc";
import { installShortcuts } from "./lib/shortcuts";
import { startUpdateChecks } from "./lib/updater";
import { initEvents } from "./state/events";
import { restore } from "./state/persist";
import { getVersion } from "@tauri-apps/api/app";
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
    setTimeout(() => showToast(`Helm was updated to ${version}.`, "success", { label: "What's new", run: () => useStore.getState().openSettings("whats-new") }), 1500);
  }
  s.updateSettings({ lastSeenVersion: version });
}

async function boot() {
  // A reloaded page can't see terminals started by the previous one; stop them first.
  await ipc.reset().catch(() => {});
  const [homeDir] = await Promise.all([ipc.homeDir(), initTerminals(), initEvents()]);
  useStore.getState().set({ homeDir });
  await restore().catch((err) => console.error("Could not restore session", err));
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
  void refreshRecent();
  void refreshSessions();
  startUpdateChecks();
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <ErrorBoundary>
      <App />
    </ErrorBoundary>,
  );
}

// Dev only: state and terminal modules hold live terminals, so a partial hot swap would orphan
// them. Reload the whole page when one of them changes (boot() then cleans up and restores tabs).
import.meta.hot?.on("vite:beforeUpdate", ({ updates }) => {
  if (updates.some((u) => /\/src\/(state|terminal)\//.test(u.path))) location.reload();
});

// Dev only: lets automated UI tests drive the app state.
if (import.meta.env.DEV) Object.assign(window, { __helm: useStore, __helmRead: readBuffer });

void boot();
