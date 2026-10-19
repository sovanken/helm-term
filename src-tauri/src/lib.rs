mod bridge;
mod claude_settings;
mod clipboard;
mod commands;
mod details;
mod export;
mod git;
mod projects;
mod preview;
mod pty;
mod sessions;
mod shell;
mod toast;
mod worktrees;

#[cfg(test)]
mod tests;

use std::path::{Path, PathBuf};

use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::{AppHandle, Manager, RunEvent, State};

use bridge::Bridge;
use pty::PtyManager;
use sessions::SessionCache;

fn data_dir(app: &AppHandle) -> PathBuf {
    app.path().app_local_data_dir().unwrap_or_else(|_| std::env::temp_dir().join("helm"))
}

#[tauri::command]
fn pty_launch(
    app: AppHandle,
    ptys: State<PtyManager>,
    bridge: State<Bridge>,
    req: shell::LaunchRequest,
    on_data: Channel<InvokeResponseBody>,
) -> Result<(), String> {
    let opts = bridge::SettingsOptions {
        approvals: req.approvals,
        status_line: req.usage && !claude_settings::has_own_status_line(&req.cwd),
    };
    let settings = bridge.write_settings(&req.pane_id, &req.launch_id, &opts)?;
    let spec = shell::build(&req, &settings)?;
    ptys.spawn(&app, req.pane_id.clone(), spec, on_data)
}

#[tauri::command]
fn pty_write(ptys: State<PtyManager>, pane_id: String, data: String) -> Result<(), String> {
    ptys.write(&pane_id, &data)
}

#[tauri::command]
fn pty_resize(ptys: State<PtyManager>, pane_id: String, cols: u16, rows: u16) -> Result<(), String> {
    ptys.resize(&pane_id, cols, rows)
}

#[tauri::command]
fn pty_kill(ptys: State<PtyManager>, bridge: State<Bridge>, pane_id: String) {
    ptys.kill(&pane_id);
    bridge.remove_settings(&pane_id);
}

/// Called when the UI (re)loads: terminals from a previous page load have no view any more.
#[tauri::command]
fn pty_reset(ptys: State<PtyManager>) {
    ptys.kill_all();
}

#[tauri::command]
async fn recent_projects() -> Vec<projects::RecentProject> {
    tauri::async_runtime::spawn_blocking(|| projects::recent(30)).await.unwrap_or_default()
}

#[tauri::command]
async fn session_exists(session_id: String) -> bool {
    tauri::async_runtime::spawn_blocking(move || projects::session_exists(&session_id)).await.unwrap_or(false)
}

#[tauri::command]
async fn paste_image(app: AppHandle) -> Result<Option<String>, String> {
    let dir = data_dir(&app).join("screenshots");
    tauri::async_runtime::spawn_blocking(move || clipboard::image_to_file(dir))
        .await
        .map_err(|e| e.to_string())?
}

/// Resolves a path printed in the terminal against the pane's folder; None if no such file.
#[tauri::command]
fn resolve_path(cwd: String, path: String) -> Option<String> {
    let candidate = Path::new(&path);
    let full = if candidate.is_absolute() { candidate.to_path_buf() } else { Path::new(&cwd).join(candidate) };
    full.exists().then(|| full.to_string_lossy().into_owned())
}

/// Opens a file at a line in VS Code. Returns false when VS Code is not available.
#[tauri::command]
fn open_in_editor(path: String, line: Option<u32>, column: Option<u32>) -> bool {
    if !Path::new(&path).exists() {
        return false;
    }
    let target = match (line, column) {
        (Some(l), Some(c)) => format!("{path}:{l}:{c}"),
        (Some(l), None) => format!("{path}:{l}"),
        _ => path,
    };
    // Never go through `cmd /C`: a file name containing `&` or `|` would run as a command.
    // Launching code.cmd directly lets Rust apply its safe batch-file argument escaping, which
    // refuses arguments it can't pass through unchanged.
    let Ok(code) = which::which("code") else { return false };
    git::hidden(&code.to_string_lossy()).args(["-g", &target]).status().is_ok_and(|s| s.success())
}

/// Windows build number (e.g. 26100); the terminal uses it to match ConPTY's line reflow.
#[tauri::command]
fn os_build() -> u32 {
    let out = git::hidden("cmd").args(["/C", "ver"]).output().map(|o| String::from_utf8_lossy(&o.stdout).into_owned()).unwrap_or_default();
    // "Microsoft Windows [Version 10.0.26100.1234]"
    out.split(['[', ']', ' '])
        .find(|s| s.starts_with("10."))
        .and_then(|v| v.split('.').nth(2))
        .and_then(|b| b.parse().ok())
        .unwrap_or(19045)
}

#[tauri::command]
async fn list_sessions(cache: State<'_, SessionCache>) -> Result<Vec<sessions::SessionInfo>, String> {
    Ok(cache.list(500))
}

#[tauri::command]
async fn search_sessions(query: String) -> Vec<sessions::SearchHit> {
    tauri::async_runtime::spawn_blocking(move || sessions::search(&query, 60)).await.unwrap_or_default()
}

/// Status-bar numbers for a session, from its transcript path (preferred) or id.
#[tauri::command]
async fn session_stats(transcript_path: Option<String>, session_id: Option<String>) -> Option<sessions::SessionStats> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = transcript_path
            .map(PathBuf::from)
            .filter(|p| p.is_file())
            .or_else(|| session_id.as_deref().and_then(sessions::find_transcript))?;
        Some(sessions::stats(&path))
    })
    .await
    .ok()
    .flatten()
}

#[tauri::command]
async fn git_summary(cwd: String) -> Option<git::GitSummary> {
    tauri::async_runtime::spawn_blocking(move || git::summary(&cwd)).await.ok().flatten()
}

#[tauri::command]
async fn git_changes(cwd: String) -> Result<git::Changes, String> {
    tauri::async_runtime::spawn_blocking(move || git::changes(&cwd)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn git_diff(root: String, path: String, status: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || git::diff(&root, &path, &status)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn git_revert(root: String, path: String, status: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || git::revert(&root, &path, &status)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn slash_commands(cwd: String) -> Vec<commands::SlashCommand> {
    tauri::async_runtime::spawn_blocking(move || commands::list(&cwd)).await.unwrap_or_default()
}

macro_rules! blocking {
    ($body:expr) => {
        tauri::async_runtime::spawn_blocking(move || $body).await.map_err(|e| e.to_string())?
    };
}

#[tauri::command]
async fn worktree_list(cwd: String) -> Result<worktrees::WorktreeList, String> {
    blocking!(worktrees::list(&cwd))
}

#[tauri::command]
async fn worktree_merge(main_path: String, branch: String) -> Result<String, String> {
    blocking!(worktrees::merge(&main_path, &branch))
}

#[tauri::command]
async fn worktree_remove(main_path: String, path: String, branch: Option<String>, force: bool, delete_branch: bool) -> Result<(), String> {
    blocking!(worktrees::remove(&main_path, &path, branch.as_deref(), force, delete_branch))
}

#[tauri::command]
async fn claude_settings_read(scope: String, cwd: String) -> Result<claude_settings::SettingsFile, String> {
    blocking!(claude_settings::read_settings(&scope, &cwd))
}

#[tauri::command]
async fn claude_settings_write(scope: String, cwd: String, key: String, value: serde_json::Value) -> Result<(), String> {
    blocking!(claude_settings::write_settings_key(&scope, &cwd, &key, value))
}

#[tauri::command]
async fn memory_read(scope: String, cwd: String) -> Result<claude_settings::MemoryFile, String> {
    blocking!(claude_settings::read_memory(&scope, &cwd))
}

#[tauri::command]
async fn memory_write(scope: String, cwd: String, content: String) -> Result<(), String> {
    blocking!(claude_settings::write_memory(&scope, &cwd, &content))
}

#[tauri::command]
async fn mcp_list(cwd: String) -> Result<Vec<claude_settings::McpServer>, String> {
    blocking!(claude_settings::mcp_list(&cwd))
}

#[tauri::command]
async fn mcp_add(
    cwd: String,
    name: String,
    scope: String,
    transport: String,
    target: String,
    args: Vec<String>,
    env: Vec<String>,
) -> Result<(), String> {
    blocking!(claude_settings::mcp_add(&cwd, &name, &scope, &transport, &target, &args, &env))
}

#[tauri::command]
async fn mcp_remove(cwd: String, name: String, scope: Option<String>) -> Result<(), String> {
    blocking!(claude_settings::mcp_remove(&cwd, &name, scope.as_deref()))
}

/// Writes a session as Markdown to `out_path` (chosen by the user in a save dialog).
#[tauri::command]
async fn export_session(
    session_id: Option<String>,
    transcript_path: Option<String>,
    out_path: String,
    include_tools: bool,
) -> Result<(), String> {
    blocking!({
        let path = transcript_path
            .map(PathBuf::from)
            .filter(|p| p.is_file())
            .or_else(|| session_id.as_deref().and_then(sessions::find_transcript))
            .ok_or("This conversation has no saved transcript yet")?;
        let md = export::to_markdown(&path, include_tools)?;
        std::fs::write(&out_path, md).map_err(|e| e.to_string())
    })
}

/// Answers a permission request held by the bridge. `None` hands it back to the terminal prompt.
#[tauri::command]
fn permission_respond(bridge: State<Bridge>, id: String, decision: Option<serde_json::Value>) -> bool {
    bridge.respond(&id, decision)
}

#[tauri::command]
fn show_approval_toast(app: AppHandle, id: String, title: String, body: String, detail: String, silent: Option<bool>) -> Result<(), String> {
    toast::show_approval(&app, &id, &title, &body, &detail, silent.unwrap_or(false))
}

#[tauri::command]
fn show_toast(app: AppHandle, title: String, body: String, silent: Option<bool>) -> Result<(), String> {
    toast::show(&app, &title, &body, silent.unwrap_or(false))
}

#[tauri::command]
fn list_shells() -> Vec<shell::ShellInfo> {
    shell::available_shells()
}

#[tauri::command]
async fn git_revert_hunk(root: String, patch: String) -> Result<(), String> {
    blocking!(git::revert_hunk(&root, &patch))
}

#[tauri::command]
async fn session_cwd(session_id: String) -> Option<String> {
    tauri::async_runtime::spawn_blocking(move || sessions::session_cwd(&session_id)).await.ok().flatten()
}

/// Helm's own data folder (settings, hook files, pasted screenshots).
#[tauri::command]
fn data_dir_path(app: AppHandle) -> String {
    data_dir(&app).to_string_lossy().into_owned()
}

/// Size in bytes and number of pasted screenshots Helm keeps (they're pruned after a week).
#[tauri::command]
fn screenshots_info(app: AppHandle) -> (u64, u32) {
    let mut bytes = 0;
    let mut count = 0;
    for entry in std::fs::read_dir(data_dir(&app).join("screenshots")).into_iter().flatten().flatten() {
        bytes += entry.metadata().map(|m| m.len()).unwrap_or(0);
        count += 1;
    }
    (bytes, count)
}

#[tauri::command]
fn clear_screenshots(app: AppHandle) -> u32 {
    let mut removed = 0;
    for entry in std::fs::read_dir(data_dir(&app).join("screenshots")).into_iter().flatten().flatten() {
        if std::fs::remove_file(entry.path()).is_ok() {
            removed += 1;
        }
    }
    removed
}

/// What a session attached, read, changed and fetched (right panel → Details).
#[tauri::command]
async fn session_details(transcript_path: Option<String>, session_id: Option<String>) -> Result<details::SessionDetails, String> {
    blocking!({
        let path = transcript_path
            .map(PathBuf::from)
            .filter(|p| p.is_file())
            .or_else(|| session_id.as_deref().and_then(sessions::find_transcript))
            .ok_or("No conversation yet")?;
        details::read(&path)
    })
}

/// A subagent's final answer, from the transcript path its SubagentStop hook reports.
#[tauri::command]
async fn subagent_result(path: String) -> Option<String> {
    tauri::async_runtime::spawn_blocking(move || {
        let p = PathBuf::from(&path);
        // Only Claude Code transcripts, never arbitrary files.
        let root = sessions::projects_dir()?;
        if !p.starts_with(&root) || p.extension().is_none_or(|e| e != "jsonl") {
            return None;
        }
        sessions::last_assistant_text(&p)
    })
    .await
    .ok()
    .flatten()
}

/// Rewrites a prompt to be clearer (Claude Haiku, no tools, nothing saved).
#[tauri::command]
async fn improve_prompt(app: AppHandle, text: String, project: String) -> Result<String, String> {
    let dir = data_dir(&app).join("improve");
    blocking!(details::improve_prompt(&text, &project, &dir))
}

/// Saves a very large paste as a text file so Claude can read it instead of filling the prompt.
#[tauri::command]
fn save_paste(app: AppHandle, text: String) -> Result<String, String> {
    let dir = data_dir(&app).join("pastes");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0);
    let path = dir.join(format!("paste-{stamp}.txt"));
    std::fs::write(&path, text).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().into_owned())
}

/// Export / import of settings to a file the user picked in a save/open dialog.
#[tauri::command]
fn write_text_file(path: String, content: String) -> Result<(), String> {
    std::fs::write(path, content).map_err(|e| e.to_string())
}

#[tauri::command]
fn read_text_file(path: String) -> Result<String, String> {
    let meta = std::fs::metadata(&path).map_err(|e| e.to_string())?;
    if meta.len() > 2 * 1024 * 1024 {
        return Err("That file is too large to be a Helm settings file".into());
    }
    std::fs::read_to_string(path).map_err(|e| e.to_string())
}

/// Contents of a file for a Helm file tab.
#[tauri::command]
async fn preview_file(path: String) -> Result<preview::FilePreview, String> {
    tauri::async_runtime::spawn_blocking(move || preview::read(std::path::Path::new(&path))).await.map_err(|e| e.to_string())?
}

/// Bytes of a PDF, video or audio file for a file tab, sent as a binary response (no JSON).
#[tauri::command]
async fn file_bytes(path: String) -> Result<tauri::ipc::Response, String> {
    let bytes = tauri::async_runtime::spawn_blocking(move || preview::bytes(std::path::Path::new(&path))).await.map_err(|e| e.to_string())??;
    Ok(tauri::ipc::Response::new(bytes))
}

#[tauri::command]
fn home_dir() -> String {
    dirs::home_dir().map(|p| p.to_string_lossy().into_owned()).unwrap_or_else(|| "C:\\".into())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_window_state::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_autostart::Builder::new().build())
        .manage(PtyManager::default())
        .manage(SessionCache::default())
        .setup(|app| {
            let dir = data_dir(app.handle());
            let bridge = bridge::start(app.handle().clone(), dir.join("hooks"))?;
            bridge.clear_all();
            app.manage(bridge);
            std::thread::spawn(move || {
                clipboard::prune(dir.join("screenshots"));
                clipboard::prune(dir.join("pastes"));
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            pty_launch,
            pty_write,
            pty_resize,
            pty_kill,
            pty_reset,
            recent_projects,
            session_exists,
            paste_image,
            resolve_path,
            open_in_editor,
            os_build,
            list_sessions,
            search_sessions,
            session_stats,
            git_summary,
            git_changes,
            git_diff,
            git_revert,
            slash_commands,
            worktree_list,
            worktree_merge,
            worktree_remove,
            claude_settings_read,
            claude_settings_write,
            memory_read,
            memory_write,
            mcp_list,
            mcp_add,
            mcp_remove,
            export_session,
            permission_respond,
            show_approval_toast,
            show_toast,
            list_shells,
            git_revert_hunk,
            session_cwd,
            data_dir_path,
            session_details,
            improve_prompt,
            subagent_result,
            save_paste,
            screenshots_info,
            clear_screenshots,
            write_text_file,
            read_text_file,
            preview_file,
            file_bytes,
            home_dir,
        ])
        .build(tauri::generate_context!())
        .expect("error while building Helm")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                app.state::<PtyManager>().kill_all();
                app.state::<Bridge>().clear_all();
            }
        });
}
