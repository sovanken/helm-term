import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { register, unregister } from "@tauri-apps/plugin-global-shortcut";
import { t } from "../i18n";
import { showToast, useStore } from "../state/store";

export interface SnipFile {
  path: string;
  modified: number;
  size: number;
}

export const snipApi = {
  start: () => invoke<void>("snip_start"),
  list: () => invoke<SnipFile[]>("snip_list"),
  remove: (path: string) => invoke<void>("snip_delete", { path }),
  copy: (path: string) => invoke<void>("copy_image_file", { path }),
};

let countdown: number | undefined;

/** Starts a screenshot now, or after `delay` seconds (with a countdown in Helm). */
export function startSnip(delay = 0) {
  window.clearInterval(countdown);
  if (!delay) {
    void snipApi.start().catch((e) => showToast(t("snip.toast.startFailed", { error: String(e) }), "error"));
    return;
  }
  let left = delay;
  showToast(t("snip.toast.countdown", { count: left }), "info", { label: t("common.cancel"), run: () => window.clearInterval(countdown) });
  countdown = window.setInterval(() => {
    left -= 1;
    if (left > 0) return showToast(t("snip.toast.countdown", { count: left }), "info", { label: t("common.cancel"), run: () => window.clearInterval(countdown) });
    window.clearInterval(countdown);
    useStore.getState().set({ toast: null });
    // Give the toast a frame to disappear so it isn't in the picture.
    setTimeout(() => startSnip(0), 120);
  }, 1000);
}

let registered = "";

/** Keeps the global shortcut in step with Settings. */
async function syncShortcut(keys: string) {
  if (keys === registered) return;
  if (registered) await unregister(registered).catch(() => {});
  registered = "";
  if (!keys) return;
  try {
    await register(keys, (e) => e.state === "Pressed" && startSnip(0));
    registered = keys;
  } catch {
    showToast(t("snip.toast.shortcutTaken", { keys }), "error");
  }
}

/** Main window: open each new snip in the Screenshots tab, copy it if wanted, and watch the shortcut. */
export function initSnips() {
  void listen<string>("snip-done", ({ payload: path }) => {
    const s = useStore.getState();
    s.openSnips(path);
    if (s.settings.snipAutoCopy) {
      void snipApi.copy(path).then(
        () => showToast(t("snip.toast.copied"), "success"),
        () => {},
      );
    }
  });
  void syncShortcut(useStore.getState().settings.snipShortcut);
  useStore.subscribe((s, prev) => {
    if (s.settings.snipShortcut !== prev.settings.snipShortcut) void syncShortcut(s.settings.snipShortcut);
  });
}
