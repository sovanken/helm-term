// Automatic updates from GitHub Releases (signed; see tauri.conf.json plugins.updater).

import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { showToast, useStore } from "../state/store";

let checking = false;

/** Checks for a newer release. `manual` reports "up to date" and errors; background checks stay quiet. */
export async function checkForUpdate(manual = false) {
  if (checking) return;
  checking = true;
  try {
    const update = await check();
    if (!update) {
      if (manual) showToast("Helm is up to date.", "success");
      return;
    }
    useStore.getState().set({
      update: {
        version: update.version,
        notes: update.body,
        install: async () => {
          showToast(`Downloading Helm ${update.version}…`);
          await update.downloadAndInstall();
          await relaunch();
        },
      },
    });
    if (manual) showToast(`Helm ${update.version} is available.`, "info");
  } catch (e) {
    if (manual) showToast(`Couldn't check for updates: ${String(e)}`, "error");
  } finally {
    checking = false;
  }
}

/** Background checks: shortly after start, then every six hours. Off in development builds. */
export function startUpdateChecks() {
  if (import.meta.env.DEV) return;
  setTimeout(() => void checkForUpdate(), 8000);
  setInterval(() => void checkForUpdate(), 6 * 60 * 60 * 1000);
}
