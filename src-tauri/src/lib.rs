mod bridge;
mod clipboard;
mod commands;
mod git;
mod projects;
mod pty;
mod sessions;
mod shell;

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
    let settings = bridge.write_settings(&req.pane_id)?;
    let spec = shell::build(&req, &settings.to_string_lossy())?;
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
    let target = match (line, column) {
        (Some(l), Some(c)) => format!("{path}:{l}:{c}"),
        (Some(l), None) => format!("{path}:{l}"),
        _ => path,
    };
    git::hidden("cmd").args(["/C", "code", "-g", &target]).status().is_ok_and(|s| s.success())
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
async fn git_branch(cwd: String) -> Option<String> {
    tauri::async_runtime::spawn_blocking(move || git::branch(&cwd)).await.ok().flatten()
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
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(PtyManager::default())
        .manage(SessionCache::default())
        .setup(|app| {
            let dir = data_dir(app.handle());
            let bridge = bridge::start(app.handle().clone(), dir.join("hooks"))?;
            bridge.clear_all();
            app.manage(bridge);
            std::thread::spawn(move || clipboard::prune(dir.join("screenshots")));
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
            git_branch,
            git_changes,
            git_diff,
            git_revert,
            slash_commands,
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
