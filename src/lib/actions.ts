import { save } from "@tauri-apps/plugin-dialog";
import { openPath } from "@tauri-apps/plugin-opener";
import { ipc } from "./ipc";
import { activePane, cleanTitle, folderName, showToast, useStore } from "../state/store";

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

