import { ask, save } from "@tauri-apps/plugin-dialog";
import { paneIds } from "./layout";
import { openPath } from "@tauri-apps/plugin-opener";
import { ipc } from "./ipc";
import { activePane, cleanTitle, folderName, showToast, useStore } from "../state/store";
import { t } from "../i18n";

/** True when any of these panes has Claude working or waiting on the user. */
function busy(paneIdsToCheck: string[]) {
  const s = useStore.getState();
  return paneIdsToCheck.some((id) => {
    const p = s.panes[id];
    return p && (p.status === "working" || p.status === "attention");
  });
}

/** Asks before closing panes where Claude is still working (Settings → General). */
export async function confirmClosePanes(ids: string[], what: "tab" | "pane" | "many"): Promise<boolean> {
  if (!useStore.getState().settings.confirmClose || !busy(ids)) return true;
  return ask(t(`actions.closeWorking.${what}`), {
    title: t("actions.closeWorking.title"),
    kind: "warning",
    okLabel: t("common.close"),
    cancelLabel: t("actions.keepOpen"),
  });
}

export async function closeTabSafely(tabId: string) {
  const s = useStore.getState();
  const tab = s.tabs.find((t) => t.id === tabId);
  if (tab && (await confirmClosePanes(paneIds(tab.root), "tab"))) useStore.getState().closeTab(tabId);
}

export async function closePaneSafely(paneId: string) {
  if (await confirmClosePanes([paneId], "pane")) useStore.getState().closePane(paneId);
}

export function fileSafe(text: string) {
  return text.replace(/[<>:"/\\|?*\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) || "conversation";
}

/** Asks where to save, then writes the conversation as Markdown. */
export async function exportConversation(session: { id?: string; title?: string; transcriptPath?: string; cwd?: string }) {
  if (!session.id && !session.transcriptPath) {
    showToast(t("actions.export.noConversation"), "error");
    return;
  }
  const title = session.title || (session.cwd ? folderName(session.cwd) : "conversation");
  const out = await save({
    title: t("actions.export.title"),
    defaultPath: `${fileSafe(title)}.md`,
    filters: [{ name: "Markdown", extensions: ["md"] }],
  });
  if (!out) return;
  try {
    await ipc.exportSession(out, true, session.id, session.transcriptPath);
    showToast(t("actions.export.exported", { name: out.split(/[\\/]/).pop() }), "success", { label: t("common.open"), run: () => void openPath(out) });
  } catch (e) {
    showToast(String(e), "error");
  }
}

export function exportActiveConversation() {
  const pane = activePane();
  if (!pane) return;
  const s = useStore.getState().sessions.find((x) => x.id === pane.sessionId);
  void exportConversation({ id: pane.sessionId, transcriptPath: pane.transcriptPath, title: s?.title || cleanTitle(pane.title), cwd: pane.cwd });
}


/** Asks before closing a file tab with unsaved edits. */
export async function closeFileSafely(id: string) {
  const file = useStore.getState().fileTabs.find((f) => f.id === id);
  if (!file) return;
  if (file.draft !== undefined) {
    const name = file.path.split(/[\\/]/).pop();
    const close = await ask(t("actions.unsaved.close", { count: 1, names: name }), {
      title: t("actions.unsaved.closeTitle"),
      kind: "warning",
      okLabel: t("actions.unsaved.closeOk"),
      cancelLabel: t("actions.keepOpen"),
    });
    if (!close) return;
  }
  useStore.getState().closeFile(id);
}

/** Asks before closing a project workspace tab that has files with unsaved edits. */
export async function closeWorkspaceSafely(id: string) {
  const ws = useStore.getState().workspaces.find((w) => w.id === id);
  if (!ws) return;
  const unsaved = ws.files.filter((f) => f.draft !== undefined);
  if (unsaved.length) {
    const names = unsaved.map((f) => f.path.split(/[\\/]/).pop()).join(", ");
    const close = await ask(t("actions.unsaved.close", { count: unsaved.length, names }), {
      title: t("actions.unsaved.closeTitle"),
      kind: "warning",
      okLabel: t("actions.unsaved.closeOk"),
      cancelLabel: t("actions.keepOpen"),
    });
    if (!close) return;
  }
  useStore.getState().closeWorkspace(id);
}

/** Before quitting: unsaved file edits, then panes where Claude is still working. */
export async function confirmQuit(): Promise<boolean> {
  const st = useStore.getState();
  const unsaved = [...st.fileTabs, ...st.workspaces.flatMap((w) => w.files)].filter((f) => f.draft !== undefined);
  if (unsaved.length) {
    const names = unsaved.map((f) => f.path.split(/[\\/]/).pop()).join(", ");
    const quit = await ask(t("actions.unsaved.quit", { count: unsaved.length, names }), {
      title: t("actions.unsaved.quitTitle"),
      kind: "warning",
      okLabel: t("actions.unsaved.quitOk"),
      cancelLabel: t("common.cancel"),
    });
    if (!quit) return false;
  }
  return confirmClosePanes(Object.keys(useStore.getState().panes), "many");
}
