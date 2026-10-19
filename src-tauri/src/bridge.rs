//! Local HTTP bridge between Helm-launched Claude Code sessions and the UI.
//!
//! Each pane gets a settings file (passed with `claude --settings`) that points Claude Code here:
//! - command hooks POST hook events to `/hook/{event}` (tab status, notifications)
//! - an http `PermissionRequest` hook POSTs to `/permission` and waits for Helm's answer
//! - the status line POSTs its JSON to `/status` (usage limits, context, cost)
//!
//! Only loopback is bound and every request must carry the per-run key.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use axum::Router;
use axum::body::Bytes;
use axum::extract::{Path, Query, State};
use axum::http::{StatusCode, header};
use axum::response::{IntoResponse, Response};
use axum::routing::post;
use serde::Serialize;
use serde_json::{Value, json};
use tauri::{AppHandle, Emitter};
use tokio::sync::oneshot;

/// A decision for a pending permission request: `Some(decision)` answers it, `None` hands it
/// back to Claude's own prompt in the terminal.
type Pending = Arc<Mutex<HashMap<String, oneshot::Sender<Option<Value>>>>>;

pub struct Bridge {
    pub port: u16,
    pub key: String,
    pub hooks_dir: PathBuf,
    pending: Pending,
}

/// Hook events Helm listens to. Status logic lives in the UI.
pub const HOOK_EVENTS: &[&str] = &[
    "SessionStart",
    "UserPromptSubmit",
    "PreToolUse",
    "PostToolUse",
    "Notification",
    "Stop",
    "StopFailure",
    "SubagentStart",
    "SubagentStop",
    "SessionEnd",
];

/// How long Helm holds a permission request before handing it back to the terminal prompt.
/// Claude's http hook timeout (600 s) is a little longer so Helm always answers first.
const PERMISSION_WAIT: Duration = Duration::from_secs(570);

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PaneEvent {
    pane_id: String,
    launch_id: Option<String>,
    event: String,
    data: Value,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PermissionEvent {
    id: String,
    pane_id: String,
    launch_id: Option<String>,
    data: Value,
}

#[derive(Clone)]
struct AppState {
    app: AppHandle,
    key: String,
    pending: Pending,
}

fn authorize(state: &AppState, q: &HashMap<String, String>) -> Result<(String, Option<String>), StatusCode> {
    if q.get("key") != Some(&state.key) {
        return Err(StatusCode::FORBIDDEN);
    }
    let pane = q.get("pane").cloned().ok_or(StatusCode::BAD_REQUEST)?;
    Ok((pane, q.get("launch").cloned()))
}

async fn hook(
    State(state): State<AppState>,
    Path(event): Path<String>,
    Query(q): Query<HashMap<String, String>>,
    body: Bytes,
) -> StatusCode {
    let (pane_id, launch_id) = match authorize(&state, &q) {
        Ok(v) => v,
        Err(code) => return code,
    };
    let data = serde_json::from_slice(&body).unwrap_or(Value::Null);
    let _ = state.app.emit("claude-hook", PaneEvent { pane_id, launch_id, event, data });
    StatusCode::NO_CONTENT
}

/// Holds Claude's permission request until the UI (or a toast button) answers it.
async fn permission(State(state): State<AppState>, Query(q): Query<HashMap<String, String>>, body: Bytes) -> Response {
    let (pane_id, launch_id) = match authorize(&state, &q) {
        Ok(v) => v,
        Err(code) => return code.into_response(),
    };
    let data: Value = serde_json::from_slice(&body).unwrap_or(Value::Null);
    let id = uuid::Uuid::new_v4().simple().to_string();
    let (tx, rx) = oneshot::channel();
    state.pending.lock().unwrap().insert(id.clone(), tx);
    let _ = state.app.emit("permission-request", PermissionEvent { id: id.clone(), pane_id, launch_id, data });

    let decision = tokio::time::timeout(PERMISSION_WAIT, rx).await;
    state.pending.lock().unwrap().remove(&id);
    match decision {
        Ok(Ok(Some(decision))) => {
            let _ = state.app.emit("permission-resolved", json!({ "id": id }));
            let body = json!({ "hookSpecificOutput": { "hookEventName": "PermissionRequest", "decision": decision } });
            ([(header::CONTENT_TYPE, "application/json")], body.to_string()).into_response()
        }
        _ => {
            // No answer from Helm: an empty 2xx lets Claude ask in the terminal as usual.
            let _ = state.app.emit("permission-resolved", json!({ "id": id }));
            StatusCode::NO_CONTENT.into_response()
        }
    }
}

/// Receives the status-line JSON and answers with the line Claude shows inside the terminal.
async fn status(State(state): State<AppState>, Query(q): Query<HashMap<String, String>>, body: Bytes) -> Response {
    let (pane_id, launch_id) = match authorize(&state, &q) {
        Ok(v) => v,
        Err(code) => return code.into_response(),
    };
    let data: Value = serde_json::from_slice(&body).unwrap_or(Value::Null);
    let line = status_line(&data);
    let _ = state.app.emit("claude-status", PaneEvent { pane_id, launch_id, event: "status".into(), data });
    ([(header::CONTENT_TYPE, "text/plain; charset=utf-8")], line).into_response()
}

fn short_duration(secs: i64) -> String {
    let secs = secs.max(0);
    if secs >= 86_400 {
        format!("{}d {}h", secs / 86_400, (secs % 86_400) / 3600)
    } else if secs >= 3600 {
        format!("{}h {}m", secs / 3600, (secs % 3600) / 60)
    } else {
        format!("{}m", secs / 60)
    }
}

/// e.g. "ctx 8% · 5h 23% (resets 2h 10m) · week 41%"
pub(crate) fn status_line(data: &Value) -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    let mut parts = Vec::new();
    if let Some(pct) = data.pointer("/context_window/used_percentage").and_then(Value::as_f64) {
        parts.push(format!("ctx {:.0}%", pct));
    }
    if let Some(w) = data.pointer("/rate_limits/five_hour") {
        if let Some(pct) = w.get("used_percentage").and_then(Value::as_f64) {
            let reset = w.get("resets_at").and_then(Value::as_i64).map(|t| format!(" (resets {})", short_duration(t - now)));
            parts.push(format!("5h {:.0}%{}", pct, reset.unwrap_or_default()));
        }
    }
    if let Some(pct) = data.pointer("/rate_limits/seven_day/used_percentage").and_then(Value::as_f64) {
        parts.push(format!("week {:.0}%", pct));
    }
    if let Some(pct) = data.pointer("/rate_limits/spend_limit/used_percentage").and_then(Value::as_f64) {
        parts.push(format!("spend {:.0}%", pct));
    }
    parts.join(" · ")
}

pub fn start(app: AppHandle, hooks_dir: PathBuf) -> Result<Bridge, String> {
    let listener = std::net::TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let key = uuid::Uuid::new_v4().simple().to_string();
    std::fs::create_dir_all(&hooks_dir).map_err(|e| e.to_string())?;
    let pending: Pending = Arc::default();

    let state = AppState { app, key: key.clone(), pending: pending.clone() };
    tauri::async_runtime::spawn(async move {
        let Ok(listener) = tokio::net::TcpListener::from_std(listener) else { return };
        let router = Router::new()
            .route("/hook/{event}", post(hook))
            .route("/permission", post(permission))
            .route("/status", post(status))
            .with_state(state);
        let _ = axum::serve(listener, router).await;
    });

    Ok(Bridge { port, key, hooks_dir, pending })
}

pub struct SettingsOptions {
    /// Route permission requests to Helm (approval inbox).
    pub approvals: bool,
    /// Use Claude's status line to feed the usage cockpit.
    pub status_line: bool,
}

impl Bridge {
    fn url(&self, path: &str, pane_id: &str, launch_id: &str) -> String {
        format!("http://127.0.0.1:{}/{}?pane={}&launch={}&key={}", self.port, path, pane_id, launch_id, self.key)
    }

    /// Writes the per-pane settings file and returns its path.
    pub fn write_settings(&self, pane_id: &str, launch_id: &str, opts: &SettingsOptions) -> Result<PathBuf, String> {
        // curl.exe ships with Windows 10+; plain double quotes work in cmd, PowerShell and bash.
        let curl = |url: String, timeout: u32| {
            format!("curl.exe -s -m {timeout} -X POST -H \"Content-Type: application/json\" --data-binary @- \"{url}\"")
        };
        let mut hooks = serde_json::Map::new();
        for event in HOOK_EVENTS {
            let command = curl(self.url(&format!("hook/{event}"), pane_id, launch_id), 3);
            hooks.insert(event.to_string(), json!([{ "hooks": [{ "type": "command", "command": command, "timeout": 5 }] }]));
        }
        if opts.approvals {
            hooks.insert(
                "PermissionRequest".into(),
                json!([{ "hooks": [{ "type": "http", "url": self.url("permission", pane_id, launch_id), "timeout": 600 }] }]),
            );
        }
        let mut settings = json!({ "hooks": hooks });
        if opts.status_line {
            settings["statusLine"] = json!({ "type": "command", "command": curl(self.url("status", pane_id, launch_id), 2) });
        }
        let path = self.hooks_dir.join(format!("{pane_id}.json"));
        std::fs::write(&path, serde_json::to_vec_pretty(&settings).unwrap()).map_err(|e| e.to_string())?;
        Ok(path)
    }

    /// Answers a pending permission request. Returns false if it already timed out or was answered.
    pub fn respond(&self, id: &str, decision: Option<Value>) -> bool {
        respond(&self.pending, id, decision)
    }

    pub fn pending(&self) -> Pending {
        self.pending.clone()
    }

    pub fn remove_settings(&self, pane_id: &str) {
        let _ = std::fs::remove_file(self.hooks_dir.join(format!("{pane_id}.json")));
        let _ = std::fs::remove_file(self.hooks_dir.join(format!("{pane_id}.bashrc")));
    }

    pub fn clear_all(&self) {
        if let Ok(entries) = std::fs::read_dir(&self.hooks_dir) {
            for entry in entries.flatten() {
                let _ = std::fs::remove_file(entry.path());
            }
        }
    }
}

pub fn respond(pending: &Pending, id: &str, decision: Option<Value>) -> bool {
    match pending.lock().unwrap().remove(id) {
        Some(tx) => tx.send(decision).is_ok(),
        None => false,
    }
}
