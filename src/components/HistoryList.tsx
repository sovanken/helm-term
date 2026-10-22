import { ipc } from "../lib/ipc";
import { useStore } from "../state/store";

let refreshing: Promise<void> | null = null;

/** Reloads the list of past Claude conversations (shown in the sidebar's project tree). */
export function refreshSessions() {
  refreshing ??= ipc
    .listSessions()
    .then((sessions) => useStore.getState().set({ sessions }))
    .catch(() => {})
    .then(() => useStore.getState().set({ sessionsLoaded: true }))
    .finally(() => (refreshing = null));
  return refreshing;
}

/** Opens the sidebar and puts the cursor in its search box (Ctrl+Shift+H). */
export function focusSidebarSearch() {
  useStore.getState().set({ sidebarOpen: true });
  // The sidebar may only be mounting now; let it render before asking it to show the search box.
  requestAnimationFrame(() => window.dispatchEvent(new Event("helm:sidebar-search")));
}
