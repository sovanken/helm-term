import { useEffect } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { quotePath } from "./lib/ipc";
import { resolveTheme } from "./lib/themes";
import { activePane, useStore } from "./state/store";
import { applyThemeToAll, insertText } from "./terminal/terminals";
import { ChangesPanel } from "./components/ChangesPanel";
import { CommandPalette } from "./components/CommandPalette";
import { PromptsDialog } from "./components/PromptsDialog";
import { SettingsDialog } from "./components/SettingsDialog";
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
  const settingsOpen = useStore((s) => s.settingsOpen);
  const paletteOpen = useStore((s) => s.paletteOpen);
  const promptsOpen = useStore((s) => s.promptsOpen);
  const changesOpen = useStore((s) => s.changesOpen);
  useTheme();
  useFileDrop();

  return (
    <div className="flex h-full flex-col">
      <TitleBar />
      <div className="flex min-h-0 flex-1">
        {sidebarOpen && <Sidebar />}
        <main
          id="main-area"
          className={`relative min-w-0 flex-1 overflow-hidden border-line bg-surface ${sidebarOpen ? "rounded-tl-lg border-t border-l" : "border-t"} ${changesOpen ? "rounded-tr-lg border-r" : ""}`}
        >
          {tabs.map((t) => (
            <TabView key={t.id} tab={t} visible={t.id === activeTabId} />
          ))}
          {tabs.length === 0 && <Welcome />}
        </main>
        {changesOpen && <ChangesPanel />}
      </div>
      <StatusBar />
      {settingsOpen && <SettingsDialog />}
      {paletteOpen && <CommandPalette />}
      {promptsOpen && <PromptsDialog />}
    </div>
  );
}
