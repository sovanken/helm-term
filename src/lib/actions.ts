import { ask, save } from "@tauri-apps/plugin-dialog";
import { paneIds } from "./layout";
import { openPath } from "@tauri-apps/plugin-opener";
import { ipc } from "./ipc";
import { activePane, cleanTitle, folderName, showToast, useStore } from "../state/store";

/** True when any of these panes has Claude working or waiting on the user. */
function busy(paneIdsToCheck: string[]) {
  const s = useStore.getState();
  return paneIdsToCheck.some((id) => {
    const p = s.panes[id];
    return p && (p.status === "working" || p.status === "attention");
  });
}

/** Asks before closing panes where Claude is still working (Settings → General). */
export async function confirmClosePanes(ids: string[], what: string): Promise<boolean> {
  if (!useStore.getState().settings.confirmClose || !busy(ids)) return true;
  return ask(`Claude is still working in ${what}. Closing stops it.`, {
    title: "Close while Claude is working?",
    kind: "warning",
    okLabel: "Close",
    cancelLabel: "Keep open",
  });
}

export async function closeTabSafely(tabId: string) {
  const s = useStore.getState();
  const tab = s.tabs.find((t) => t.id === tabId);
  if (tab && (await confirmClosePanes(paneIds(tab.root), "this tab"))) useStore.getState().closeTab(tabId);
}

export async function closePaneSafely(paneId: string) {
  if (await confirmClosePanes([paneId], "this pane")) useStore.getState().closePane(paneId);
}

function fileSafe(text: string) {
  return text.replace(/[<>:"/\\|?*\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) || "conversation";
}

/** Asks where to save, then writes the conversation as Markdown. */
export async function exportConversation(session: { id?: string; title?: string; transcriptPath?: string; cwd?: string }) {
  if (!session.id && !session.transcriptPath) {
    showToast("This tab has no Claude conversation to export yet.", "error");
    return;
  }
  const title = session.title || (session.cwd ? folderName(session.cwd) : "conversation");
  const out = await save({
    title: "Export conversation",
    defaultPath: `${fileSafe(title)}.md`,
    filters: [{ name: "Markdown", extensions: ["md"] }],
  });
  if (!out) return;
  try {
    await ipc.exportSession(out, true, session.id, session.transcriptPath);
    showToast(`Exported to ${out.split(/[\\/]/).pop()}`, "success", { label: "Open", run: () => void openPath(out) });
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

