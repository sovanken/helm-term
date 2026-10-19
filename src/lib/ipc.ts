import { Channel, invoke } from "@tauri-apps/api/core";
import type { PaneKind, RecentProject } from "../state/store";

export interface SessionInfo {
  id: string;
  cwd: string;
  title: string;
  firstPrompt: string;
  branch?: string;
  prompts: number;
  created?: string;
  lastUsed: number;
}

export interface SearchHit {
  sessionId: string;
  snippet: string;
}

export interface SessionStats {
  model?: string;
  contextTokens: number;
  contextWindow: number;
  costUsd?: number;
  linesAdded?: number;
  linesRemoved?: number;
  title?: string;
}

export interface ChangedFile {
  path: string;
  /** M modified, A added, D deleted, R renamed, U untracked */
  status: "M" | "A" | "D" | "R" | "U";
  added?: number;
  removed?: number;
}

export interface Changes {
  isRepo: boolean;
  root?: string;
  branch?: string;
  files: ChangedFile[];
}

export interface SlashCommand {
  name: string;
  description: string;
  kind: "command" | "skill";
  scope: "user" | "project";
  takesArgs: boolean;
}

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
  reset: () => invoke<void>("pty_reset"),
  recentProjects: () => invoke<RecentProject[]>("recent_projects"),
  sessionExists: (sessionId: string) => invoke<boolean>("session_exists", { sessionId }),
  pasteImage: () => invoke<string | null>("paste_image"),
  resolvePath: (cwd: string, path: string) => invoke<string | null>("resolve_path", { cwd, path }),
  openInEditor: (path: string, line?: number, column?: number) =>
    invoke<boolean>("open_in_editor", { path, line, column }),
  homeDir: () => invoke<string>("home_dir"),
  listSessions: () => invoke<SessionInfo[]>("list_sessions"),
  searchSessions: (query: string) => invoke<SearchHit[]>("search_sessions", { query }),
  sessionStats: (transcriptPath?: string, sessionId?: string) =>
    invoke<SessionStats | null>("session_stats", { transcriptPath, sessionId }),
  gitBranch: (cwd: string) => invoke<string | null>("git_branch", { cwd }),
  gitChanges: (cwd: string) => invoke<Changes>("git_changes", { cwd }),
  gitDiff: (root: string, path: string, status: string) => invoke<string>("git_diff", { root, path, status }),
  gitRevert: (root: string, path: string, status: string) => invoke<void>("git_revert", { root, path, status }),
  slashCommands: (cwd: string) => invoke<SlashCommand[]>("slash_commands", { cwd }),
  osBuild: () => invoke<number>("os_build"),
};

/** Quotes a path for pasting into a prompt or shell when it contains spaces. */
export function quotePath(path: string): string {
  return /\s/.test(path) ? `"${path}"` : path;
}
