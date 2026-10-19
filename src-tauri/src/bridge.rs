//! Local HTTP bridge that receives Claude Code hook events from Helm-launched sessions.
//!
//! Each pane gets a settings file (passed with `claude --settings`) whose hooks POST the hook's
//! JSON input here. Only loopback is bound and every request must carry the per-launch key.

use std::collections::HashMap;
use std::path::PathBuf;

use axum::Router;
use axum::body::Bytes;
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::routing::post;
use serde::Serialize;
use tauri::{AppHandle, Emitter};

pub struct Bridge {
    pub port: u16,
    pub key: String,
    pub hooks_dir: PathBuf,
}

/// Hook events Helm listens to. Status logic lives in the UI.
pub const HOOK_EVENTS: &[&str] =
    &["SessionStart", "UserPromptSubmit", "PreToolUse", "PostToolUse", "Notification", "Stop", "SessionEnd"];

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct HookEvent {
    pane_id: String,
    launch_id: Option<String>,
    event: String,
    data: serde_json::Value,
}

#[derive(Clone)]
struct AppState {
    app: AppHandle,
    key: String,
}

async fn hook(
    State(state): State<AppState>,
    Path(event): Path<String>,
    Query(q): Query<HashMap<String, String>>,
    body: Bytes,
) -> StatusCode {
    if q.get("key") != Some(&state.key) {
        return StatusCode::FORBIDDEN;
    }
    let Some(pane_id) = q.get("pane").cloned() else {
        return StatusCode::BAD_REQUEST;
    };
    let data = serde_json::from_slice(&body).unwrap_or(serde_json::Value::Null);
    let launch_id = q.get("launch").cloned();
    let _ = state.app.emit("claude-hook", HookEvent { pane_id, launch_id, event, data });
    StatusCode::NO_CONTENT
}

pub fn start(app: AppHandle, hooks_dir: PathBuf) -> Result<Bridge, String> {
    let listener = std::net::TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let key = uuid::Uuid::new_v4().simple().to_string();
    std::fs::create_dir_all(&hooks_dir).map_err(|e| e.to_string())?;

    let state = AppState { app, key: key.clone() };
    tauri::async_runtime::spawn(async move {
        let Ok(listener) = tokio::net::TcpListener::from_std(listener) else { return };
        let router = Router::new().route("/hook/{event}", post(hook)).with_state(state);
        let _ = axum::serve(listener, router).await;
    });

    Ok(Bridge { port, key, hooks_dir })
}

impl Bridge {
    /// Writes the per-pane settings file and returns its path.
    pub fn write_settings(&self, pane_id: &str, launch_id: &str) -> Result<PathBuf, String> {
        let mut hooks = serde_json::Map::new();
        for event in HOOK_EVENTS {
            // curl.exe ships with Windows 10+; plain double quotes work in cmd, PowerShell and bash.
            let command = format!(
                "curl.exe -s -m 3 -X POST -H \"Content-Type: application/json\" --data-binary @- \"http://127.0.0.1:{}/hook/{}?pane={}&launch={}&key={}\"",
                self.port, event, pane_id, launch_id, self.key
            );
            hooks.insert(
                event.to_string(),
                serde_json::json!([{ "hooks": [{ "type": "command", "command": command, "timeout": 5 }] }]),
            );
        }
        let settings = serde_json::json!({ "hooks": hooks });
        let path = self.hooks_dir.join(format!("{pane_id}.json"));
        std::fs::write(&path, serde_json::to_vec_pretty(&settings).unwrap()).map_err(|e| e.to_string())?;
        Ok(path)
    }

    pub fn remove_settings(&self, pane_id: &str) {
        let _ = std::fs::remove_file(self.hooks_dir.join(format!("{pane_id}.json")));
    }

    pub fn clear_all(&self) {
        if let Ok(entries) = std::fs::read_dir(&self.hooks_dir) {
            for entry in entries.flatten() {
                let _ = std::fs::remove_file(entry.path());
            }
        }
    }
}
