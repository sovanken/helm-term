// Voice input for Claude tabs. Speech is turned into text on this PC (see src-tauri/src/voice.rs);
// each finished phrase is typed into the tab's prompt, never sent. Hold the voice key to talk
// (a short tap keeps listening until the next press), or use the mic button.

import { listen } from "@tauri-apps/api/event";
import { create } from "zustand";

import { typeCommand } from "../terminal/terminals";
import { activePane, showToast, useStore } from "../state/store";
import { ipc } from "./ipc";
import { t } from "../i18n";

type Phase = "idle" | "loading" | "listening";

interface VoiceState {
  phase: Phase;
  /** The tab the words go to. */
  paneId: string | null;
  /** The phrase being spoken, before it's final. */
  partial: string;
  /** Phrases already typed this time, for the preview. */
  typed: string[];
  level: number;
  /** The first-use download dialog is open. */
  setupOpen: boolean;
  /** Started by holding the voice key (so letting go finishes). */
  held: boolean;
}

export const useVoice = create<VoiceState>(() => ({ phase: "idle", paneId: null, partial: "", typed: [], level: 0, setupOpen: false, held: false }));

/** Microphone test in Settings: level only, nothing typed. */
let testing = false;

export async function startVoice(paneId: string, held = false) {
  const v = useVoice.getState();
  if (v.phase !== "idle") return;
  testing = false;
  useVoice.setState({ paneId, partial: "", typed: [], level: 0, phase: "loading", held });
  try {
    await ipc.voiceStart(useStore.getState().settings.voiceMic || null, false);
  } catch (e) {
    useVoice.setState({ phase: "idle", paneId: null });
    if (String(e) === "not-installed") useVoice.setState({ setupOpen: true });
    else showToast(String(e), "error");
  }
}

export function stopVoice(keep = true) {
  if (useVoice.getState().phase === "idle") return;
  void ipc.voiceStop(keep);
}

export function toggleVoice(paneId: string) {
  if (useVoice.getState().phase === "idle") void startVoice(paneId);
  else stopVoice(true);
}

export async function startMicTest(mic: string) {
  if (useVoice.getState().phase !== "idle") return;
  testing = true;
  useVoice.setState({ paneId: null, level: 0, phase: "loading" });
  await ipc.voiceStart(mic || null, true).catch((e) => {
    testing = false;
    useVoice.setState({ phase: "idle" });
    showToast(String(e), "error");
  });
}

export function isMicTesting() {
  return testing && useVoice.getState().phase !== "idle";
}

/** "Ctrl+Shift+Space", "F8"… for a key event. */
function comboOf(e: KeyboardEvent) {
  const key = e.code === "Space" ? "Space" : /^F\d+$/.test(e.code) ? e.code : null;
  if (!key) return null;
  return [e.ctrlKey && "Ctrl", e.altKey && "Alt", e.shiftKey && "Shift", key].filter(Boolean).join("+");
}

const isClaude = () => {
  const p = activePane();
  return p && (p.claudeActive || p.kind === "claude") ? p : null;
};

export function initVoice() {
  void listen<{ kind: string; text?: string; level?: number }>("voice", ({ payload }) => {
    const v = useVoice.getState();
    switch (payload.kind) {
      case "loading":
        return useVoice.setState({ phase: "loading" });
      case "listening":
        return useVoice.setState({ phase: "listening" });
      case "level":
        return useVoice.setState({ level: payload.level ?? 0 });
      case "partial":
        return useVoice.setState({ partial: payload.text ?? "" });
      case "final": {
        const text = payload.text?.trim();
        if (!text || !v.paneId || testing) return;
        // Phrases join with a space, as if typed in one go.
        typeCommand(v.paneId, (v.typed.length ? " " : "") + text, false);
        return useVoice.setState({ typed: [...v.typed, text], partial: "" });
      }
      case "error":
        return showToast(payload.text ?? t("voice.stopped"), "error");
      case "idle":
        testing = false;
        return useVoice.setState({ phase: "idle", partial: "", level: 0, paneId: null });
    }
  });

  // Hold the key to talk; a short tap keeps listening until the next press.
  let pressedAt = 0;
  let holdKey = "";
  window.addEventListener(
    "keydown",
    (e) => {
      const want = useStore.getState().settings.voiceHoldKey;
      if (!want || comboOf(e) !== want) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.repeat) return;
      if (useVoice.getState().phase !== "idle") {
        if (!testing) stopVoice(true);
        return;
      }
      const pane = isClaude();
      if (!pane) return showToast(t("voice.needsClaudeTab"), "info");
      pressedAt = Date.now();
      holdKey = e.code;
      void startVoice(pane.id, true);
    },
    true,
  );
  window.addEventListener(
    "keyup",
    (e) => {
      if (!holdKey || (e.code !== holdKey && !["ControlLeft", "ControlRight", "AltLeft", "AltRight", "ShiftLeft", "ShiftRight"].includes(e.code))) return;
      holdKey = "";
      e.preventDefault();
      // Held: push to talk, so letting go stops. Tapped: keep listening (until the next press).
      if (Date.now() - pressedAt > 350) stopVoice(true);
      else useVoice.setState({ held: false });
    },
    true,
  );
  // Stop when the window loses focus mid-hold (the key-up would never arrive).
  window.addEventListener("blur", () => {
    if (holdKey && Date.now() - pressedAt > 350) {
      holdKey = "";
      stopVoice(true);
    }
  });
}
