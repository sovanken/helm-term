// Automatic updates from GitHub Releases (signed; see tauri.conf.json plugins.updater).

import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { t } from "../i18n";
import { showToast, useStore } from "../state/store";

let checking = false;

/** Checks for a newer release. `manual` reports "up to date" and errors; background checks stay quiet. */
export async function checkForUpdate(manual = false) {
  if (checking) return;
  checking = true;
  try {
    const update = await check();
    if (!update) {
      if (manual) showToast(t("updater.upToDate"), "success");
      return;
    }
    useStore.getState().set({
      update: {
        version: update.version,
        notes: update.body,
        install: async () => {
          showToast(t("updater.downloading", { version: update.version }));
          await update.downloadAndInstall();
          await relaunch();
        },
      },
    });
    if (manual) showToast(t("updater.available", { version: update.version }), "info");
  } catch (e) {
    if (manual) showToast(t("updater.checkFailed", { error: String(e) }), "error");
  } finally {
    checking = false;
  }
}

/** Background checks: shortly after start, then every six hours. Off in development builds. */
export function startUpdateChecks() {
  if (import.meta.env.DEV) return;
  const auto = () => useStore.getState().settings.autoUpdate && void checkForUpdate();
  setTimeout(auto, 8000);
  setInterval(auto, 6 * 60 * 60 * 1000);
}
