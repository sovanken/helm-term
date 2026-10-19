import ReactDOM from "react-dom/client";
import App from "./App";
import { refreshRecent } from "./components/Sidebar";
import { ipc } from "./lib/ipc";
import { installShortcuts } from "./lib/shortcuts";
import { initEvents } from "./state/events";
import { restore } from "./state/persist";
import { useStore } from "./state/store";
import { initTerminals } from "./terminal/terminals";
import "./styles.css";

async function boot() {
  const [homeDir] = await Promise.all([ipc.homeDir(), initTerminals(), initEvents()]);
  useStore.getState().set({ homeDir });
  await restore().catch((err) => console.error("Could not restore session", err));
  installShortcuts();
  void refreshRecent();
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(<App />);
}

void boot();
