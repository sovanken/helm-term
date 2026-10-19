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

export interface Worktree {
  path: string;
  branch?: string;
  isMain: boolean;
  dirty: number;
  ahead: number;
}

export interface WorktreeList {
  isRepo: boolean;
  mainPath?: string;
  mainBranch?: string;
  worktrees: Worktree[];
}

export type Scope = "user" | "project" | "local";

export interface SettingsFile {
  path: string;
  exists: boolean;
  permissions: { allow?: string[]; ask?: string[]; deny?: string[]; defaultMode?: string; [k: string]: unknown } | null;
  hooks: Record<string, { matcher?: string; hooks: { type: string; command?: string; timeout?: number }[] }[]> | null;
}

export interface MemoryFile {
  scope: Scope;
  path: string;
  exists: boolean;
  content: string;
}

export interface McpServer {
  name: string;
  target: string;
  status: string;
  health: "ok" | "auth" | "failed" | "pending" | "unknown";
  managed: boolean;
}

export interface ShellInfo {
  id: string;
  label: string;
  path: string;
}

export interface LaunchRequest {
  paneId: string;
  cwd: string;
  kind: PaneKind;
  newSessionId?: string;
  resumeSessionId?: string;
  worktree?: string;
  launchId: string;
  shell?: string;
  windowsHints: boolean;
  approvals: boolean;
  usage: boolean;
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
  gitSummary: (cwd: string) =>
    invoke<{ branch?: string; changed: number; ahead?: number; behind?: number } | null>("git_summary", { cwd }),
  gitChanges: (cwd: string) => invoke<Changes>("git_changes", { cwd }),
  gitDiff: (root: string, path: string, status: string) => invoke<string>("git_diff", { root, path, status }),
  gitRevert: (root: string, path: string, status: string) => invoke<void>("git_revert", { root, path, status }),
  slashCommands: (cwd: string) => invoke<SlashCommand[]>("slash_commands", { cwd }),
  osBuild: () => invoke<number>("os_build"),
  permissionRespond: (id: string, decision: unknown | null) => invoke<boolean>("permission_respond", { id, decision }),
  showApprovalToast: (id: string, title: string, body: string, detail: string) =>
    invoke<void>("show_approval_toast", { id, title, body, detail }),
  listShells: () => invoke<ShellInfo[]>("list_shells"),
  gitRevertHunk: (root: string, patch: string) => invoke<void>("git_revert_hunk", { root, patch }),
  sessionCwd: (sessionId: string) => invoke<string | null>("session_cwd", { sessionId }),
  worktreeList: (cwd: string) => invoke<WorktreeList>("worktree_list", { cwd }),
  worktreeMerge: (mainPath: string, branch: string) => invoke<string>("worktree_merge", { mainPath, branch }),
  worktreeRemove: (mainPath: string, path: string, branch: string | undefined, force: boolean, deleteBranch: boolean) =>
    invoke<void>("worktree_remove", { mainPath, path, branch, force, deleteBranch }),
  claudeSettingsRead: (scope: Scope, cwd: string) => invoke<SettingsFile>("claude_settings_read", { scope, cwd }),
  claudeSettingsWrite: (scope: Scope, cwd: string, key: "permissions" | "hooks", value: unknown) =>
    invoke<void>("claude_settings_write", { scope, cwd, key, value }),
  memoryRead: (scope: Scope, cwd: string) => invoke<MemoryFile>("memory_read", { scope, cwd }),
  memoryWrite: (scope: Scope, cwd: string, content: string) => invoke<void>("memory_write", { scope, cwd, content }),
  mcpList: (cwd: string) => invoke<McpServer[]>("mcp_list", { cwd }),
  mcpAdd: (cwd: string, name: string, scope: string, transport: string, target: string, args: string[], env: string[]) =>
    invoke<void>("mcp_add", { cwd, name, scope, transport, target, args, env }),
  mcpRemove: (cwd: string, name: string, scope?: string) => invoke<void>("mcp_remove", { cwd, name, scope }),
  exportSession: (outPath: string, includeTools: boolean, sessionId?: string, transcriptPath?: string) =>
    invoke<void>("export_session", { sessionId, transcriptPath, outPath, includeTools }),
};

/** Quotes a path for pasting into a prompt or shell when it contains spaces. */
export function quotePath(path: string): string {
  return /\s/.test(path) ? `"${path}"` : path;
}
