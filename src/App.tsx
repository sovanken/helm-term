import { useEffect } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { quotePath } from "./lib/ipc";
import { resolveTheme } from "./lib/themes";
import { activePane, useStore } from "./state/store";
import { applyThemeToAll, insertText } from "./terminal/terminals";
import { AgentsPage } from "./components/AgentsPage";
import { ApprovalBar } from "./components/Approvals";
import { ChangesPanel } from "./components/ChangesPanel";
import { NewTaskDialog } from "./components/Tasks";
import { ToastView } from "./components/Toast";
import { CommandPalette } from "./components/CommandPalette";
import { PromptsDialog } from "./components/PromptsDialog";
import { SettingsPage } from "./components/SettingsPage";
import { StatusBar } from "./components/StatusBar";
import { Sidebar } from "./components/Sidebar";
import { TabView } from "./components/TabView";
import { TitleBar } from "./components/TitleBar";
import { Welcome } from "./components/Welcome";

function useTheme() {
  const mode = useStore((s) => s.settings.theme);
  useEffect(() => {
    const apply = () => {
      document.documentElement.dataset.theme = resolveTheme(mode);
      applyThemeToAll();
    };
    apply();
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [mode]);
}

/** Dropping files inserts their paths into the active terminal. */
function useFileDrop() {
  useEffect(() => {
    const un = getCurrentWebview().onDragDropEvent((e) => {
      if (e.payload.type !== "drop") return;
      const pane = activePane();
      if (pane && e.payload.paths.length) insertText(pane.id, e.payload.paths.map(quotePath).join(" ") + " ");
    });
    return () => void un.then((f) => f());
  }, []);
}

export default function App() {
  const tabs = useStore((s) => s.tabs);
  const activeTabId = useStore((s) => s.activeTabId);
  const sidebarOpen = useStore((s) => s.sidebarOpen);
  const view = useStore((s) => s.view);
  const paletteOpen = useStore((s) => s.paletteOpen);
  const promptsOpen = useStore((s) => s.promptsOpen);
  const changesOpen = useStore((s) => s.changesOpen);
  const newTaskOpen = useStore((s) => s.newTaskOpen);
  useTheme();
  useFileDrop();

  return (
    <div className="flex h-full flex-col">
      <TitleBar />
      <div className="flex min-h-0 flex-1">
        {sidebarOpen && view === "terminal" && <Sidebar />}
        <main
          id="main-area"
          className={`relative min-w-0 flex-1 overflow-hidden border-line bg-surface ${sidebarOpen && view === "terminal" ? "rounded-tl-lg border-t border-l" : "border-t"} ${changesOpen && view === "terminal" ? "rounded-tr-lg border-r" : ""}`}
        >
          {tabs.map((t) => (
            <TabView key={t.id} tab={t} visible={view === "terminal" && t.id === activeTabId} />
          ))}
          {tabs.length === 0 && view === "terminal" && <Welcome />}
          {view === "settings" && (
            <div className="absolute inset-0 z-20 bg-surface">
              <SettingsPage />
            </div>
          )}
          {view === "agents" && (
            <div className="absolute inset-0 z-20 bg-surface">
              <AgentsPage />
            </div>
          )}
          <ApprovalBar />
        </main>
        {changesOpen && view === "terminal" && <ChangesPanel />}
      </div>
      <StatusBar />
      {paletteOpen && <CommandPalette />}
      {promptsOpen && <PromptsDialog />}
      {newTaskOpen && <NewTaskDialog />}
      <ToastView />
    </div>
  );
}
