import { VoiceSetupDialog } from "./components/Voice";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { Effect, getCurrentWindow } from "@tauri-apps/api/window";
import { quotePath } from "./lib/ipc";
import { accentColor, resolveTheme, uiFontStack } from "./lib/themes";
import { activePane, DEFAULT_SETTINGS, useStore } from "./state/store";
import { applyThemeToAll, currentTerminalTheme, insertText, windowsBuildNumber } from "./terminal/terminals";
import { AgentsPage } from "./components/AgentsPage";
import { ToolsPage } from "./tools/ToolsPage";
import { SnipsPage } from "./snip/SnipsPage";
import { WorkspaceView } from "./components/WorkspaceView";
import { PartBoundary } from "./components/ErrorBoundary";
import { ApprovalBar } from "./components/Approvals";
import { Inspector } from "./components/Inspector";
import { FileView } from "./components/FileView";
import { SessionDetail } from "./components/SessionDetail";
import { NewTaskDialog } from "./components/Tasks";
import { NewFileDialog } from "./components/NewFileDialog";
import { ToastView } from "./components/Toast";
import { CommandPalette } from "./components/CommandPalette";
import { PromptComposer } from "./components/PromptComposer";
import { PromptsDialog } from "./components/PromptsDialog";
import { ResizeHandle } from "./components/ResizeHandle";
import { SettingsPage } from "./components/SettingsPage";
import { StatusBar } from "./components/StatusBar";
import { Sidebar } from "./components/Sidebar";
import { TabView } from "./components/TabView";
import { TitleBar } from "./components/TitleBar";
import { Welcome } from "./components/Welcome";

/** Applies theme, accent, fonts, interface size and Mica from settings. */
function useAppearance() {
  const s = useStore((st) => st.settings);
  useEffect(() => {
    const root = document.documentElement;
    const apply = () => {
      const mode = resolveTheme(s.theme);
      root.dataset.theme = mode;
      const accent = accentColor(s.accent, mode);
      root.style.setProperty("--accent", accent);
      root.style.setProperty("--accent-soft", `${accent}1f`);
      root.style.setProperty("--on-accent", mode === "dark" ? "#14110b" : "#ffffff");
      root.style.setProperty("--ui-font", uiFontStack(s.uiFont));
      root.style.setProperty("--term-bg", String(currentTerminalTheme(s).background));
      applyThemeToAll();
      // The splash screen (public/boot.js) reads this before the app loads, to open in the same theme.
      try {
        localStorage.setItem("helm-boot", JSON.stringify({ theme: mode, accent }));
      } catch {
        // Storage can be unavailable; the splash then follows the system theme.
      }
    };
    apply();
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [s.theme, s.accent, s.uiFont, s.terminalScheme]);

  useEffect(() => {
    void getCurrentWebview().setZoom(s.uiScale).catch(() => {});
  }, [s.uiScale]);

  useEffect(() => {
    const win = getCurrentWindow();
    // Mica needs Windows 11 (build 22000+); elsewhere the window stays opaque.
    const on = s.mica && windowsBuildNumber() >= 22000;
    if (on) {
      document.documentElement.dataset.mica = "";
      void win.setEffects({ effects: [Effect.Mica] }).catch(() => {});
    } else {
      delete document.documentElement.dataset.mica;
      void win.clearEffects().catch(() => {});
    }
  }, [s.mica]);
}

/**
 * Ctrl + mouse wheel: over a terminal it changes the text size, anywhere else the interface size.
 * (WebView2's own page zoom is turned off in tauri.conf.json.)
 */
function useWheelZoom() {
  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      // Parts with their own zoom (PDF tabs) handle it themselves.
      if ((e.target as HTMLElement | null)?.closest?.("[data-own-zoom]")) return;
      e.preventDefault();
      e.stopPropagation();
      const s = useStore.getState();
      const up = e.deltaY < 0;
      if ((e.target as HTMLElement | null)?.closest?.(".term-host")) {
        const size = Math.min(32, Math.max(8, s.settings.fontSize + (up ? 1 : -1)));
        if (size !== s.settings.fontSize) s.updateSettings({ fontSize: size });
      } else {
        const scale = Math.round(Math.min(1.5, Math.max(0.8, s.settings.uiScale + (up ? 0.05 : -0.05))) * 100) / 100;
        if (scale !== s.settings.uiScale) s.updateSettings({ uiScale: scale });
      }
    };
    window.addEventListener("wheel", onWheel, { passive: false, capture: true });
    return () => window.removeEventListener("wheel", onWheel, { capture: true });
  }, []);
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
  const { t } = useTranslation();
  const tabs = useStore((s) => s.tabs);
  const activeTabId = useStore((s) => s.activeTabId);
  const sidebarOpen = useStore((s) => s.sidebarOpen);
  const view = useStore((s) => s.view);
  const paletteOpen = useStore((s) => s.paletteOpen);
  const promptsOpen = useStore((s) => s.promptsOpen);
  const changesOpen = useStore((s) => s.changesOpen);
  const newTaskOpen = useStore((s) => s.newTaskOpen);
  const newFile = useStore((s) => s.newFile);
  const composerOpen = useStore((s) => s.composerOpen);
  const historyDetail = useStore((s) => s.historyDetail);
  const sidebarWidth = useStore((s) => s.settings.sidebarWidth);
  const changesWidth = useStore((s) => s.settings.changesWidth);
  const { updateSettings } = useStore.getState();
  useAppearance();
  useWheelZoom();
  useFileDrop();

  // File tabs keep the side panels, so you can click through the files listed in Details.
  const showSidebar = sidebarOpen && (view === "terminal" || view === "file");
  const showChanges = changesOpen && (view === "terminal" || view === "file");

  return (
    <div className="flex h-full flex-col">
      <TitleBar />
      <div className="flex min-h-0 flex-1">
        {showSidebar && (
          <>
            <div className="flex shrink-0" style={{ width: sidebarWidth }}>
              <PartBoundary name="sidebar" message={t("errors.part.sidebar")} className="w-full">
                <Sidebar />
              </PartBoundary>
            </div>
            <ResizeHandle
              side="left"
              label={t("app.resizeSidebar")}
              width={sidebarWidth}
              min={200}
              max={480}
              defaultWidth={DEFAULT_SETTINGS.sidebarWidth}
              onChange={(w) => updateSettings({ sidebarWidth: w })}
            />
          </>
        )}
        <main
          id="main-area"
          className={`relative min-w-0 flex-1 overflow-hidden border-line ${view === "terminal" && tabs.length ? "bg-[var(--term-bg)]" : "bg-surface"} rounded-lg border ${showSidebar ? "" : "ml-2"} ${showChanges ? "" : "mr-2"}`}
        >
          {tabs.map((tab) => (
            <TabView key={tab.id} tab={tab} visible={view === "terminal" && tab.id === activeTabId} />
          ))}
          {tabs.length === 0 && view === "terminal" && <Welcome />}
          {view === "settings" && (
            <div className="anim-fade absolute inset-0 z-20 bg-surface">
              <PartBoundary name="settings" message={t("errors.part.settings")}>
                <SettingsPage />
              </PartBoundary>
            </div>
          )}
          {view === "file" && (
            <div className="anim-fade absolute inset-0 z-20 bg-surface">
              <PartBoundary name="file" message={t("errors.part.file")}>
                <FileView />
              </PartBoundary>
            </div>
          )}
          {view === "workspace" && (
            <div className="anim-fade absolute inset-0 z-20 bg-surface">
              <PartBoundary name="project" message={t("errors.part.project")}>
                <WorkspaceView />
              </PartBoundary>
            </div>
          )}
          {view === "snips" && (
            <div className="anim-fade absolute inset-0 z-20 bg-surface">
              <PartBoundary name="screenshots" message={t("errors.part.screenshots")}>
                <SnipsPage />
              </PartBoundary>
            </div>
          )}
          {view === "tools" && (
            <div className="anim-fade absolute inset-0 z-20 bg-surface">
              <PartBoundary name="tools" message={t("errors.part.tools")}>
                <ToolsPage />
              </PartBoundary>
            </div>
          )}
          {view === "agents" && (
            <div className="anim-fade absolute inset-0 z-20 bg-surface">
              <PartBoundary name="agents view" message={t("errors.part.agentsView")}>
                <AgentsPage />
              </PartBoundary>
            </div>
          )}
          {historyDetail && (
            <PartBoundary name="session details" message={t("errors.part.sessionDetails")}>
              <SessionDetail session={historyDetail} onClose={() => useStore.getState().set({ historyDetail: null })} />
            </PartBoundary>
          )}
          <PartBoundary name="approval cards" message={t("errors.part.approvalCards")}>
            <ApprovalBar />
          </PartBoundary>
        </main>
        {showChanges && (
          <>
            <ResizeHandle
              side="right"
              label={t("app.resizeChanges")}
              width={changesWidth}
              min={260}
              max={640}
              defaultWidth={DEFAULT_SETTINGS.changesWidth}
              onChange={(w) => updateSettings({ changesWidth: w })}
            />
            <div className="flex shrink-0" style={{ width: changesWidth }}>
              <PartBoundary name="right panel" message={t("errors.part.rightPanel")} className="w-full">
                <Inspector />
              </PartBoundary>
            </div>
          </>
        )}
      </div>
      <PartBoundary name="status bar" message={t("errors.part.statusBar")} className="h-[30px] shrink-0 bg-bg">
        <StatusBar />
      </PartBoundary>
      {paletteOpen && <CommandPalette />}
      {promptsOpen && <PromptsDialog />}
      {newTaskOpen && <NewTaskDialog />}
      <VoiceSetupDialog />
      {newFile && <NewFileDialog key={newFile.ext + newFile.dir} ext={newFile.ext} dir={newFile.dir} />}
      {composerOpen && <PromptComposer />}
      <ToastView />
    </div>
  );
}
