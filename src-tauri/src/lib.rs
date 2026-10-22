mod bgtasks;
mod bridge;
mod browser;
mod claude_settings;
mod clipboard;
mod commands;
mod details;
mod devices;
mod export;
mod git;
mod project_ops;
mod projects;
mod preview;
mod pdf;
mod pty;
mod report;
mod sessions;
mod shell;
mod snip;
mod toast;
mod tools;
mod voice;
mod workspace;
mod worktrees;

#[cfg(test)]
mod tests;

use std::path::{Path, PathBuf};

use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::{AppHandle, Manager, RunEvent, State};

use bridge::Bridge;
use pty::PtyManager;
use sessions::SessionCache;

pub(crate) fn data_dir(app: &AppHandle) -> PathBuf {
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
    // A folder opens as a project; a file opens at the line.
    let args: Vec<&str> = if Path::new(&target).is_dir() { vec![&target] } else { vec!["-g", &target] };
    git::hidden(&code.to_string_lossy()).args(args).status().is_ok_and(|s| s.success())
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

/// Saves the report currently laid out for printing as a PDF at `path`.
#[tauri::command]
async fn print_pdf(app: AppHandle, path: String) -> Result<(), String> {
    pdf::print(&app, path).await
}

/// Tokens, turns, tools and context for one session (the Agents page detail view).
#[tauri::command]
async fn session_report(transcript_path: Option<String>, session_id: Option<String>) -> Option<report::SessionReport> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = transcript_path
            .map(PathBuf::from)
            .filter(|p| p.is_file())
            .or_else(|| session_id.as_deref().and_then(sessions::find_transcript))?;
        Some(report::session(&path))
    })
    .await
    .ok()
    .flatten()
}

/// Usage over the last `days` days from every transcript, by local day, project and model.
#[tauri::command]
async fn usage_totals(app: AppHandle, days: u32, offset_min: i64) -> report::UsageTotals {
    tauri::async_runtime::spawn_blocking(move || report::totals(&app.state::<report::TotalsCache>(), days.clamp(1, 60), offset_min))
        .await
        .unwrap_or_default()
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

/// Background commands and agents that have finished in a conversation (from its transcript).
#[tauri::command]
async fn background_finished(app: AppHandle, transcript_path: String) -> Vec<bgtasks::Finished> {
    let path = PathBuf::from(transcript_path);
    tauri::async_runtime::spawn_blocking(move || bgtasks::finished(&app.state::<bgtasks::BgTaskCache>(), &path)).await.unwrap_or_default()
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

/// A past conversation as a readable Markdown file (in Helm's data folder) for a file tab.
#[tauri::command]
async fn session_markdown(app: AppHandle, session_id: String, title: String) -> Result<String, String> {
    let dir = data_dir(&app).join("conversations");
    blocking!({
        if !session_id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
            return Err("Invalid session id".to_string());
        }
        let path = sessions::find_transcript(&session_id).ok_or("This conversation has no saved transcript")?;
        let md = export::to_markdown(&path, true)?;
        // Named after the conversation so the tab reads well: conversations/<id>/<title>.md
        let name: String = title.chars().map(|c| if r#"<>:"/\|?*"#.contains(c) || c.is_control() { ' ' } else { c }).collect();
        let name: String = name.trim().trim_end_matches('.').chars().take(80).collect();
        let dir = dir.join(&session_id);
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let out = dir.join(format!("{}.md", if name.is_empty() { "Conversation" } else { &name }));
        std::fs::write(&out, md).map_err(|e| e.to_string())?;
        Ok(out.to_string_lossy().into_owned())
    })
}

/// Files Claude edited or created in a conversation, oldest first.
#[tauri::command]
async fn session_files(session_id: String) -> Result<Vec<String>, String> {
    blocking!({
        let path = sessions::find_transcript(&session_id).ok_or("This conversation has no saved transcript")?;
        Ok(sessions::changed_files(&path))
    })
}

/// Deletes a conversation's transcript for good (the page asks first).
#[tauri::command]
async fn session_delete(session_id: String) -> Result<(), String> {
    blocking!({
        let path = sessions::find_transcript(&session_id).ok_or("This conversation is already gone")?;
        // Only ever a transcript inside Claude's projects folder.
        let root = sessions::projects_dir().ok_or("Claude's projects folder wasn't found")?;
        if !path.starts_with(&root) || path.extension().and_then(|e| e.to_str()) != Some("jsonl") {
            return Err("That isn't a Claude conversation file".to_string());
        }
        std::fs::remove_file(&path).map_err(|e| e.to_string())?;
        // Its folder of subagent transcripts and tool output, if any.
        let side = path.with_extension("");
        if side.is_dir() && side.starts_with(&root) {
            let _ = std::fs::remove_dir_all(side);
        }
        Ok(())
    })
}

/// Workspace tab: one folder's contents for the file tree.
#[tauri::command]
async fn list_dir(path: String) -> Result<Vec<workspace::Entry>, String> {
    blocking!(workspace::list_dir(Path::new(&path)))
}

/// Workspace tab: every file in the project (for quick open), skipping what git ignores.
#[tauri::command]
async fn list_project_files(root: String) -> Result<Vec<String>, String> {
    blocking!(Ok::<_, String>(workspace::list_files(Path::new(&root), 50_000)))
}

/// Workspace tab: find text across the project's files.
#[tauri::command]
async fn search_project(root: String, query: String, case_sensitive: bool) -> Result<workspace::SearchResult, String> {
    blocking!(Ok::<_, String>(workspace::search(Path::new(&root), &query, case_sensitive, 2000)))
}

#[tauri::command]
fn create_dir(parent: String, name: String) -> Result<String, String> {
    workspace::create_dir(Path::new(&parent), &name).map(|p| p.to_string_lossy().into_owned())
}

#[tauri::command]
fn rename_path(path: String, new_name: String) -> Result<String, String> {
    workspace::rename(Path::new(&path), &new_name).map(|p| p.to_string_lossy().into_owned())
}

/// Moves a file or folder to the Recycle Bin (the page asks first).
#[tauri::command]
async fn trash_path(path: String) -> Result<(), String> {
    blocking!(workspace::trash(Path::new(&path)))
}

/// Before renaming or deleting a project folder: is it allowed, in use, and what's inside.
#[tauri::command]
async fn project_check(path: String) -> Result<project_ops::Check, String> {
    blocking!(Ok::<_, String>(project_ops::check(Path::new(&path))))
}

/// Renames a project folder and moves its Claude Code chat history to the new name.
#[tauri::command]
async fn project_rename(path: String, new_name: String) -> Result<project_ops::Renamed, String> {
    blocking!(project_ops::rename(Path::new(&path), &new_name))
}

/// Moves a project folder to the Recycle Bin (the page checks and asks first).
#[tauri::command]
async fn project_trash(path: String) -> Result<(), String> {
    blocking!(project_ops::trash_folder(Path::new(&path)))
}

/// Moves a conversation to the Recycle Bin.
#[tauri::command]
async fn session_trash(session_id: String) -> Result<(), String> {
    blocking!(project_ops::trash_session(&session_id))
}

#[tauri::command]
async fn project_remote(path: String) -> Result<Option<project_ops::Remote>, String> {
    blocking!(Ok::<_, String>(project_ops::remote(Path::new(&path))))
}

/// Voice input: is the model there, and is it downloading.
#[tauri::command]
fn voice_status(app: AppHandle, install: State<'_, std::sync::Arc<voice::Install>>) -> voice::Status {
    voice::status(&app, &install)
}

/// Downloads the voice model (progress arrives as "voice-install" events).
#[tauri::command]
async fn voice_install(app: AppHandle, install: State<'_, std::sync::Arc<voice::Install>>) -> Result<(), String> {
    voice::install(app, install.inner().clone()).await
}

#[tauri::command]
fn voice_cancel_install(install: State<'_, std::sync::Arc<voice::Install>>) {
    voice::cancel_install(&install);
}

#[tauri::command]
async fn voice_remove(app: AppHandle) -> Result<(), String> {
    let v = app.state::<voice::Voice>();
    voice::remove(&app, &v)
}

#[tauri::command]
async fn voice_mics() -> Vec<String> {
    tauri::async_runtime::spawn_blocking(voice::microphones).await.unwrap_or_default()
}

/// Starts listening (text arrives as "voice" events). `test` only reports the level.
#[tauri::command]
fn voice_start(app: AppHandle, v: State<'_, voice::Voice>, mic: Option<String>, test: bool) -> Result<(), String> {
    voice::start(&app, &v, mic, test)
}

/// Stops listening; `keep` types what was still being said, otherwise it's dropped.
#[tauri::command]
fn voice_stop(v: State<'_, voice::Voice>, keep: bool) {
    voice::stop(&v, keep);
}

/// Screenshots: freeze the screen and open the snip overlay.
// Async so it runs off the main thread: creating a window from a sync command deadlocks on Windows.
#[tauri::command]
async fn snip_start(app: AppHandle) -> Result<(), String> {
    snip::start(&app)
}

/// The overlay asks for what it shows: monitors, windows and the desktop's size and origin.
#[tauri::command]
fn snip_info(state: State<snip::SnipState>) -> Result<snip::SnipInfo, String> {
    state.info.lock().unwrap().clone().ok_or_else(|| "No snip in progress".to_string())
}

/// The frozen screen as raw pixels (size header + BGRA).
#[tauri::command]
fn snip_pixels(state: State<snip::SnipState>) -> Result<tauri::ipc::Response, String> {
    let pixels = state.pixels.lock().unwrap().take().ok_or("No snip in progress")?;
    Ok(tauri::ipc::Response::new(pixels))
}

/// The overlay sends the chosen part as PNG bytes (raw request body).
#[tauri::command]
async fn snip_finish(app: AppHandle, request: tauri::ipc::Request<'_>) -> Result<String, String> {
    let tauri::ipc::InvokeBody::Raw(png) = request.body() else { return Err("Expected image bytes".into()) };
    snip::finish(&app, png)
}

#[tauri::command]
async fn snip_cancel(app: AppHandle) {
    snip::cancel(&app);
}

#[tauri::command]
fn snip_list(app: AppHandle) -> Vec<snip::SnipFile> {
    snip::list(&snip::dir(&app))
}

#[tauri::command]
fn snip_delete(app: AppHandle, path: String) -> Result<(), String> {
    snip::delete(&snip::dir(&app), Path::new(&path))
}

/// Copies a PNG file to the clipboard as an image.
#[tauri::command]
async fn copy_image_file(path: String) -> Result<(), String> {
    blocking!(snip::copy_image(Path::new(&path)))
}

/// Phones and tablets connected to the PC (status bar).
#[tauri::command]
async fn devices_list() -> Result<devices::DeviceList, String> {
    blocking!(Ok::<_, String>(devices::list()))
}

#[tauri::command]
async fn device_details(serial: String) -> Result<devices::DeviceDetails, String> {
    blocking!(devices::details(&serial))
}

/// The phone's screen, saved as a snip and opened in Screenshots.
#[tauri::command]
async fn device_screenshot(app: AppHandle, serial: String) -> Result<String, String> {
    let png = blocking!(devices::screenshot(&serial))?;
    snip::finish(&app, &png)
}

#[tauri::command]
fn device_mirror(serial: String, title: String) -> Result<(), String> {
    devices::mirror(&serial, &title)
}

/// The project's Android app id, if it is an Android or Flutter project.
#[tauri::command]
fn android_app_id(project: String) -> Option<String> {
    devices::app_id(Path::new(&project))
}

/// The project's app as installed on the device (exact id or flavour builds like ".dev").
#[tauri::command]
async fn device_app_variants(serial: String, app: String) -> Result<Vec<String>, String> {
    blocking!(devices::installed_variants(&serial, &app))
}

#[tauri::command]
async fn device_logcat_command(serial: String, app: Option<String>, powershell: bool) -> Result<String, String> {
    blocking!(devices::logcat_command(&serial, app.as_deref(), powershell))
}

#[tauri::command]
async fn device_to_wifi(serial: String, ip: String) -> Result<String, String> {
    blocking!(devices::to_wifi(&serial, &ip))
}

#[tauri::command]
async fn device_disconnect(serial: String) -> Result<(), String> {
    blocking!(devices::disconnect(&serial))
}

/// A new, empty file for a file tab (never replaces an existing one).
#[tauri::command]
fn create_file(dir: String, name: String) -> Result<String, String> {
    preview::create(std::path::Path::new(&dir), &name).map(|p| p.to_string_lossy().into_owned())
}

/// Saves a file edited in a file tab; fails with "changed" if it changed on disk meanwhile.
#[tauri::command]
async fn save_file(path: String, text: String, expected: u64, force: bool) -> Result<u64, String> {
    tauri::async_runtime::spawn_blocking(move || preview::save(std::path::Path::new(&path), &text, expected, force)).await.map_err(|e| e.to_string())?
}

/// Developer tools: small saved data (requests, colours, scratchpads) in Helm's data folder.
#[tauri::command]
fn tool_data_read(app: AppHandle, name: String) -> Result<Option<String>, String> {
    tools::data_read(&data_dir(&app).join("tools"), &name)
}

#[tauri::command]
fn tool_data_write(app: AppHandle, name: String, text: String) -> Result<(), String> {
    tools::data_write(&data_dir(&app).join("tools"), &name, &text)
}

#[tauri::command]
fn hash_text(text: String, algo: String) -> Result<String, String> {
    tools::hash_text(&text, &algo)
}

#[tauri::command]
async fn hash_file(path: String, algo: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || tools::hash_file(std::path::Path::new(&path), &algo)).await.map_err(|e| e.to_string())?
}

/// Sends an HTTP request from Helm (not the page), so CORS doesn't apply.
#[tauri::command]
async fn http_request(request: tools::HttpRequest) -> Result<tools::HttpResponse, String> {
    tools::http(request).await
}

#[tauri::command]
async fn env_vars() -> Result<tools::EnvVars, String> {
    tauri::async_runtime::spawn_blocking(tools::env_vars).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn ports_in_use() -> Result<Vec<tools::PortUse>, String> {
    tauri::async_runtime::spawn_blocking(tools::ports).await.map_err(|e| e.to_string())?
}

#[tauri::command]
fn stop_process(pid: u32) -> Result<(), String> {
    tools::stop_process(pid)
}

/// The whole screen for the ruler, as raw pixels (Helm hides itself first, from the page).
#[tauri::command]
async fn capture_screen() -> Result<tauri::ipc::Response, String> {
    let bytes = tauri::async_runtime::spawn_blocking(tools::capture_screen).await.map_err(|e| e.to_string())??;
    Ok(tauri::ipc::Response::new(bytes))
}

/// Saves bytes made by a tool (a converted image) to a path the user picked.
#[tauri::command]
fn write_file_base64(path: String, data: String) -> Result<(), String> {
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD.decode(data).map_err(|e| e.to_string())?;
    std::fs::write(path, bytes).map_err(|e| e.to_string())
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
        // The window starts hidden and the page shows it once the splash has painted, so don't let the
        // saved state show it earlier.
        .plugin(tauri_plugin_window_state::Builder::new().with_state_flags(tauri_plugin_window_state::StateFlags::all() & !tauri_plugin_window_state::StateFlags::VISIBLE).build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_autostart::Builder::new().build())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .manage(snip::SnipState::default())
        .manage(bgtasks::BgTaskCache::default())
        .manage(std::sync::Arc::new(voice::Install::default()))
        .manage(voice::Voice::default())
        .manage(PtyManager::default())
        .manage(SessionCache::default())
        .manage(report::TotalsCache::default())
        .manage(browser::Browsers::default())
        .setup(|app| {
            let dir = data_dir(app.handle());
            let bridge = bridge::start(app.handle().clone(), dir.join("hooks"))?;
            bridge.clear_all();
            app.manage(bridge);
            std::thread::spawn(move || {
                clipboard::prune(dir.join("screenshots"));
                clipboard::prune(dir.join("pastes"));
            });
            // The page shows the window once its splash has painted; if the page fails to load,
            // show it anyway so Helm never stays invisible.
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_secs(4));
                if let Some(window) = handle.get_webview_window("main") {
                    if !window.is_visible().unwrap_or(true) {
                        let _ = window.show();
                    }
                }
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
            session_report,
            print_pdf,
            usage_totals,
            browser::browser_open,
            browser::browser_bounds,
            browser::browser_visible,
            browser::browser_navigate,
            browser::browser_go,
            browser::browser_close,
            browser::browser_keep_only,
            browser::browser_devtools,
            browser::browser_emulate,
            browser::browser_screenshot,
            browser::browser_pick,
            file_bytes,
            create_file,
            save_file,
            background_finished,
            devices_list,
            device_details,
            device_screenshot,
            device_mirror,
            android_app_id,
            device_logcat_command,
            device_app_variants,
            device_to_wifi,
            device_disconnect,
            snip_start,
            snip_info,
            snip_pixels,
            snip_finish,
            snip_cancel,
            snip_list,
            snip_delete,
            copy_image_file,
            list_dir,
            list_project_files,
            search_project,
            create_dir,
            rename_path,
            trash_path,
            voice_status,
            voice_install,
            voice_cancel_install,
            voice_remove,
            voice_mics,
            voice_start,
            voice_stop,
            project_check,
            project_rename,
            project_trash,
            session_trash,
            project_remote,
            session_markdown,
            session_files,
            session_delete,
            tool_data_read,
            tool_data_write,
            hash_text,
            hash_file,
            http_request,
            env_vars,
            ports_in_use,
            stop_process,
            capture_screen,
            write_file_base64,
            home_dir,
        ])
        .build(tauri::generate_context!())
        .expect("error while building Helm")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                app.state::<PtyManager>().kill_all();
                app.state::<Bridge>().clear_all();
                app.state::<browser::Browsers>().close_all();
            }
        });
}
