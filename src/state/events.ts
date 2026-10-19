// Backend events: Claude Code hook reports and terminal exits.

import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow, UserAttentionType } from "@tauri-apps/api/window";
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import { paneIds } from "../lib/layout";
import { cleanTitle, folderName, type Pane, useStore } from "./store";

interface HookEvent {
  paneId: string;
  event: string;
  data: Record<string, unknown> | null;
}

/** True when the user can currently see this pane. */
function isVisible(paneId: string) {
  const s = useStore.getState();
  const tab = s.tabs.find((t) => t.id === s.activeTabId);
  return document.hasFocus() && !!tab && paneIds(tab.root).includes(paneId);
}

let notifyAllowed: boolean | null = null;

async function notify(pane: Pane, title: string, body: string) {
  if (!useStore.getState().settings.notifications || isVisible(pane.id)) return;
  if (notifyAllowed === null) {
    notifyAllowed = (await isPermissionGranted()) || (await requestPermission()) === "granted";
  }
  if (notifyAllowed) sendNotification({ title, body });
  if (!document.hasFocus()) void getCurrentWindow().requestUserAttention(UserAttentionType.Informational);
}

function onHook({ paneId, event, data }: HookEvent) {
  const { panes, updatePane } = useStore.getState();
  const pane = panes[paneId];
  if (!pane) return;
  const cwd = typeof data?.cwd === "string" ? data.cwd : undefined;
  const where = folderName(cwd ?? pane.cwd);

  switch (event) {
    case "SessionStart":
      updatePane(paneId, {
        claudeActive: true,
        status: "idle",
        sessionId: typeof data?.session_id === "string" ? data.session_id : pane.sessionId,
        ...(cwd ? { cwd } : {}),
      });
      break;
    case "SessionEnd":
      // Claude was closed in this pane, so a restored tab should not reopen it.
      updatePane(paneId, { kind: "shell", claudeActive: false, status: "idle", attentionMessage: undefined });
      break;
    case "UserPromptSubmit":
    case "PreToolUse":
    case "PostToolUse":
      updatePane(paneId, { claudeActive: true, status: "working", attentionMessage: undefined });
      break;
    case "Notification": {
      const message = typeof data?.message === "string" ? data.message : "Claude is waiting for you";
      const type = typeof data?.notification_type === "string" ? data.notification_type : "";
      // The idle reminder repeats "waiting for your input" after a finished turn; that is not new.
      if (type === "idle_prompt" || /waiting for your input/i.test(message)) break;
      updatePane(paneId, { status: "attention", attentionMessage: message });
      void notify(pane, `Claude needs you · ${where}`, message);
      break;
    }
    case "Stop": {
      const seen = isVisible(paneId);
      updatePane(paneId, { status: seen ? "idle" : "done", attentionMessage: undefined });
      void notify(pane, `Claude finished · ${where}`, cleanTitle(pane.title) || "Ready for your next message");
      break;
    }
  }
}

export async function initEvents() {
  await listen<HookEvent>("claude-hook", (e) => onHook(e.payload));
  await listen<{ paneId: string }>("pty-exit", (e) => useStore.getState().closePane(e.payload.paneId));
  window.addEventListener("focus", () => useStore.getState().markSeen());
}
