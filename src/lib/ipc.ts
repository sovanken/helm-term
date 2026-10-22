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
  /** How many days Claude Code keeps conversations; unset means its default of 30. */
  cleanupPeriodDays?: number | null;
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

export interface FileUse {
  path: string;
  count: number;
}

export interface SessionDetails {
  images: string[];
  mentioned: string[];
  read: FileUse[];
  changed: FileUse[];
  web: string[];
  mcp: FileUse[];
  subagents: FileUse[];
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
  fork?: boolean;
  worktree?: string;
  launchId: string;
  shell?: string;
  windowsHints: boolean;
  approvals: boolean;
  usage: boolean;
  extraArgs: string;
  env: [string, string][];
  cols: number;
  rows: number;
}

export type FilePreview =
  | { kind: "text"; text: string; size: number; truncated: boolean; editable: boolean; modified: number }
  | { kind: "image"; dataUrl: string; size: number; modified: number }
  | { kind: "media"; mime: string; size: number; modified: number }
  | { kind: "tooLarge"; size: number; modified: number }
  | { kind: "binary"; size: number; modified: number };

export interface ContextItem {
  label: string;
  tokens: number;
  pct: number;
}

export interface SessionReport {
  prompts: number;
  replies: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  contextTokens: number;
  contextWindow: number;
  setupTokens?: number;
  series: { t: number; context: number; output: number }[];
  tools: { name: string; count: number }[];
  toolCalls: number;
  models: string[];
  started?: number;
  last?: number;
  activeMs: number;
  compactions: number;
  costUsd?: number;
  linesAdded?: number;
  linesRemoved?: number;
  /** Claude's own /context breakdown, from the last time it was run in this session. */
  exact?: { at: number; used: number; window: number; items: ContextItem[] };
  /** Prompts, tools Claude used and compactions, oldest first. */
  timeline: { t: number; kind: "prompt" | "tool" | "compact"; text: string; tool?: string; path?: string }[];
  /** Files Claude changed in this conversation, with lines added and removed by its edits. */
  files: { path: string; added: number; removed: number; edits: number; created: boolean }[];
}

export interface DayTotals {
  day: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
  linesAdded: number;
  linesRemoved: number;
  activeMs: number;
  sessions: number;
  replies: number;
}

export interface UsageTotals {
  days: DayTotals[];
  byProject: { key: string; tokens: number; costUsd: number; sessions: number }[];
  byModel: { key: string; tokens: number; costUsd: number; sessions: number }[];
  /** Replies per local hour (24) over the period. */
  hours: number[];
  /** Replies per 15 minutes today (96 slots from midnight). */
  today: number[];
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
  gitSummary: (cwd: string) =>
    invoke<{ branch?: string; changed: number; ahead?: number; behind?: number } | null>("git_summary", { cwd }),
  gitChanges: (cwd: string) => invoke<Changes>("git_changes", { cwd }),
  gitDiff: (root: string, path: string, status: string) => invoke<string>("git_diff", { root, path, status }),
  gitRevert: (root: string, path: string, status: string) => invoke<void>("git_revert", { root, path, status }),
  slashCommands: (cwd: string) => invoke<SlashCommand[]>("slash_commands", { cwd }),
  osBuild: () => invoke<number>("os_build"),
  permissionRespond: (id: string, decision: unknown | null) => invoke<boolean>("permission_respond", { id, decision }),
  showApprovalToast: (id: string, title: string, body: string, detail: string, silent = false) =>
    invoke<void>("show_approval_toast", { id, title, body, detail, silent }),
  showToast: (title: string, body: string, silent = false) => invoke<void>("show_toast", { title, body, silent }),
  dataDirPath: () => invoke<string>("data_dir_path"),
  sessionDetails: (transcriptPath?: string, sessionId?: string) => invoke<SessionDetails>("session_details", { transcriptPath, sessionId }),
  improvePrompt: (text: string, project: string) => invoke<string>("improve_prompt", { text, project }),
  subagentResult: (path: string) => invoke<string | null>("subagent_result", { path }),
  savePaste: (text: string) => invoke<string>("save_paste", { text }),
  screenshotsInfo: () => invoke<[number, number]>("screenshots_info"),
  clearScreenshots: () => invoke<number>("clear_screenshots"),
  writeTextFile: (path: string, content: string) => invoke<void>("write_text_file", { path, content }),
  readTextFile: (path: string) => invoke<string>("read_text_file", { path }),
  sessionReport: (transcriptPath?: string, sessionId?: string) => invoke<SessionReport | null>("session_report", { transcriptPath, sessionId }),
  usageTotals: (days: number) => invoke<UsageTotals>("usage_totals", { days, offsetMin: -new Date().getTimezoneOffset() }),
  previewFile: (path: string) => invoke<FilePreview>("preview_file", { path }),
  fileBytes: (path: string) => invoke<ArrayBuffer>("file_bytes", { path }),
  createFile: (dir: string, name: string) => invoke<string>("create_file", { dir, name }),
  listDir: (path: string) => invoke<DirEntry[]>("list_dir", { path }),
  listProjectFiles: (root: string) => invoke<string[]>("list_project_files", { root }),
  searchProject: (root: string, query: string, caseSensitive: boolean) => invoke<ProjectSearch>("search_project", { root, query, caseSensitive }),
  createDir: (parent: string, name: string) => invoke<string>("create_dir", { parent, name }),
  renamePath: (path: string, newName: string) => invoke<string>("rename_path", { path, newName }),
  trashPath: (path: string) => invoke<void>("trash_path", { path }),
  sessionMarkdown: (sessionId: string, title: string) => invoke<string>("session_markdown", { sessionId, title }),
  sessionFiles: (sessionId: string) => invoke<string[]>("session_files", { sessionId }),
  projectCheck: (path: string) => invoke<ProjectCheck>("project_check", { path }),
  projectRename: (path: string, newName: string) => invoke<{ path: string; chats: number; warning?: string }>("project_rename", { path, newName }),
  projectTrash: (path: string) => invoke<void>("project_trash", { path }),
  sessionTrash: (sessionId: string) => invoke<void>("session_trash", { sessionId }),
  projectRemote: (path: string) => invoke<{ web?: string; clone: string } | null>("project_remote", { path }),
  voiceStatus: () => invoke<VoiceStatus>("voice_status"),
  voiceInstall: () => invoke<void>("voice_install"),
  voiceCancelInstall: () => invoke<void>("voice_cancel_install"),
  voiceRemove: () => invoke<void>("voice_remove"),
  voiceMics: () => invoke<string[]>("voice_mics"),
  voiceStart: (mic: string | null, test: boolean) => invoke<void>("voice_start", { mic, test }),
  voiceStop: (keep: boolean) => invoke<void>("voice_stop", { keep }),
  backgroundFinished: (transcriptPath: string) => invoke<BackgroundFinished[]>("background_finished", { transcriptPath }),
  sessionDelete: (sessionId: string) => invoke<void>("session_delete", { sessionId }),
  toolDataRead: (name: string) => invoke<string | null>("tool_data_read", { name }),
  toolDataWrite: (name: string, text: string) => invoke<void>("tool_data_write", { name, text }),
  hashText: (text: string, algo: HashAlgo) => invoke<string>("hash_text", { text, algo }),
  hashFile: (path: string, algo: HashAlgo) => invoke<string>("hash_file", { path, algo }),
  httpRequest: (request: HttpRequest) => invoke<HttpResponse>("http_request", { request }),
  envVars: () => invoke<{ user: Record<string, string>; system: Record<string, string> }>("env_vars"),
  portsInUse: () => invoke<PortUse[]>("ports_in_use"),
  stopProcess: (pid: number) => invoke<void>("stop_process", { pid }),
  captureScreen: () => invoke<ArrayBuffer>("capture_screen"),
  writeFileBase64: (path: string, data: string) => invoke<void>("write_file_base64", { path, data }),
  /** Rejects with "changed" when the file changed on disk since `expected` (unless `force`). */
  saveFile: (path: string, text: string, expected: number, force = false) => invoke<number>("save_file", { path, text, expected, force }),
  listShells: () => invoke<ShellInfo[]>("list_shells"),
  gitRevertHunk: (root: string, patch: string) => invoke<void>("git_revert_hunk", { root, patch }),
  sessionCwd: (sessionId: string) => invoke<string | null>("session_cwd", { sessionId }),
  worktreeList: (cwd: string) => invoke<WorktreeList>("worktree_list", { cwd }),
  worktreeMerge: (mainPath: string, branch: string) => invoke<string>("worktree_merge", { mainPath, branch }),
  worktreeRemove: (mainPath: string, path: string, branch: string | undefined, force: boolean, deleteBranch: boolean) =>
    invoke<void>("worktree_remove", { mainPath, path, branch, force, deleteBranch }),
  claudeSettingsRead: (scope: Scope, cwd: string) => invoke<SettingsFile>("claude_settings_read", { scope, cwd }),
  claudeSettingsWrite: (scope: Scope, cwd: string, key: "permissions" | "hooks" | "cleanupPeriodDays", value: unknown) =>
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

export type HashAlgo = "md5" | "sha1" | "sha256" | "sha512";

export interface HttpRequest {
  method: string;
  url: string;
  headers: [string, string][];
  body?: string;
  timeout_secs?: number;
}

export interface HttpResponse {
  status: number;
  statusText: string;
  headers: [string, string][];
  body: string;
  binary: boolean;
  size: number;
  timeMs: number;
  truncated: boolean;
}

export interface PortUse {
  port: number;
  address: string;
  pid: number;
  name: string;
  path: string;
  protected: boolean;
}

export interface DirEntry {
  name: string;
  path: string;
  isDir: boolean;
}

export interface ProjectSearch {
  matches: { path: string; line: number; column: number; text: string }[];
  truncated: boolean;
}

/** A background command or agent that has finished, from Claude Code's finish notice. */
export interface BackgroundFinished {
  toolUseId: string;
  status: "completed" | "failed" | "killed" | string;
  summary?: string;
  outputFile?: string;
}

/** Before renaming or deleting a project folder. */
export interface ProjectCheck {
  /** Never allowed (protected folder, missing). */
  blocked?: string;
  /** Not right now (in use, no permission). */
  busy?: string;
  files: number;
  bytes: number;
  /** Counting stopped early: at least this many. */
  more: boolean;
  gitChanges?: number;
}

export interface VoiceStatus {
  installed: boolean;
  installing: boolean;
  downloadMb: number;
  sizeMb: number;
}
