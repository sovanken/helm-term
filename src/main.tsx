import ReactDOM from "react-dom/client";
import App from "./App";
import { refreshSessions } from "./components/HistoryList";
import { refreshRecent } from "./components/Sidebar";
import { ipc } from "./lib/ipc";
import { installShortcuts } from "./lib/shortcuts";
import { startUpdateChecks } from "./lib/updater";
import { initEvents } from "./state/events";
import { restore } from "./state/persist";
import { useStore } from "./state/store";
import { initTerminals, readBuffer } from "./terminal/terminals";
import "./styles.css";

async function boot() {
  // A reloaded page can't see terminals started by the previous one; stop them first.
  await ipc.reset().catch(() => {});
  const [homeDir] = await Promise.all([ipc.homeDir(), initTerminals(), initEvents()]);
  useStore.getState().set({ homeDir });
  await restore().catch((err) => console.error("Could not restore session", err));
  installShortcuts();
  void refreshRecent();
  void refreshSessions();
  startUpdateChecks();
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(<App />);
}

// Dev only: state and terminal modules hold live terminals, so a partial hot swap would orphan
// them. Reload the whole page when one of them changes (boot() then cleans up and restores tabs).
import.meta.hot?.on("vite:beforeUpdate", ({ updates }) => {
  if (updates.some((u) => /\/src\/(state|terminal)\//.test(u.path))) location.reload();
});

// Dev only: lets automated UI tests drive the app state.
if (import.meta.env.DEV) Object.assign(window, { __helm: useStore, __helmRead: readBuffer });

void boot();
