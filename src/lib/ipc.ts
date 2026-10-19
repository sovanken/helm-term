import { Channel, invoke } from "@tauri-apps/api/core";
import type { PaneKind, RecentProject } from "../state/store";

export interface LaunchRequest {
  paneId: string;
  cwd: string;
  kind: PaneKind;
  newSessionId?: string;
  resumeSessionId?: string;
  cols: number;
  rows: number;
}

export const ipc = {
  launch: (req: LaunchRequest, onData: Channel<ArrayBuffer>) => invoke<void>("pty_launch", { req, onData }),
  write: (paneId: string, data: string) => invoke<void>("pty_write", { paneId, data }),
  resize: (paneId: string, cols: number, rows: number) => invoke<void>("pty_resize", { paneId, cols, rows }),
  kill: (paneId: string) => invoke<void>("pty_kill", { paneId }),
  recentProjects: () => invoke<RecentProject[]>("recent_projects"),
  sessionExists: (sessionId: string) => invoke<boolean>("session_exists", { sessionId }),
  pasteImage: () => invoke<string | null>("paste_image"),
  resolvePath: (cwd: string, path: string) => invoke<string | null>("resolve_path", { cwd, path }),
  openInEditor: (path: string, line?: number, column?: number) =>
    invoke<boolean>("open_in_editor", { path, line, column }),
  homeDir: () => invoke<string>("home_dir"),
  osBuild: () => invoke<number>("os_build"),
};

/** Quotes a path for pasting into a prompt or shell when it contains spaces. */
export function quotePath(path: string): string {
  return /\s/.test(path) ? `"${path}"` : path;
}
