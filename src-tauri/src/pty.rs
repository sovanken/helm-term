//! Pseudo-terminal sessions (ConPTY on Windows) streamed to the UI over IPC channels.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::Mutex;

use portable_pty::{ChildKiller, CommandBuilder, MasterPty, PtySize, native_pty_system};
use serde::Serialize;
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::{AppHandle, Emitter};

struct Session {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    killer: Box<dyn ChildKiller + Send + Sync>,
}

#[derive(Default)]
pub struct PtyManager {
    sessions: Mutex<HashMap<String, Session>>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ExitEvent {
    pane_id: String,
    code: u32,
}

/// Variables a running Claude Code session sets for its own child processes. User config
/// variables (CLAUDE_CODE_USE_BEDROCK, ANTHROPIC_*, …) are deliberately not listed.
pub const INHERITED_SESSION_VARS: &[&str] = &[
    "CLAUDECODE",
    "CLAUDE_PID",
    "CLAUDE_EFFORT",
    "CLAUDE_CODE_CHILD_SESSION",
    "CLAUDE_CODE_SESSION_ID",
    "CLAUDE_CODE_SESSION_ATTENDED",
    "CLAUDE_CODE_ENTRYPOINT",
    "CLAUDE_CODE_EXECPATH",
    "CLAUDE_CODE_MESSAGING_SOCKET",
    "CLAUDE_CODE_MESSAGING_TOKEN",
    "CLAUDE_CODE_SSE_PORT",
    "AI_AGENT",
    "GIT_EDITOR",
    "COREPACK_ENABLE_AUTO_PIN",
];

pub struct SpawnSpec {
    pub program: String,
    pub args: Vec<String>,
    pub cwd: String,
    pub env: Vec<(String, String)>,
    pub cols: u16,
    pub rows: u16,
}

impl PtyManager {
    pub fn spawn(
        &self,
        app: &AppHandle,
        pane_id: String,
        spec: SpawnSpec,
        on_data: Channel<InvokeResponseBody>,
    ) -> Result<(), String> {
        let pair = native_pty_system()
            .openpty(PtySize { rows: spec.rows.max(2), cols: spec.cols.max(2), pixel_width: 0, pixel_height: 0 })
            .map_err(|e| format!("Could not open a terminal: {e}"))?;

        let mut cmd = CommandBuilder::new(&spec.program);
        cmd.args(&spec.args);
        cmd.cwd(&spec.cwd);
        // If Helm itself was started from a Claude Code session, don't let its session markers
        // leak into new terminals (Claude would treat them as child sessions and skip transcripts).
        if std::env::var_os("CLAUDECODE").is_some() {
            for k in INHERITED_SESSION_VARS {
                cmd.env_remove(k);
            }
        }
        for (k, v) in &spec.env {
            cmd.env(k, v);
        }

        let mut child = pair.slave.spawn_command(cmd).map_err(|e| format!("Could not start {}: {e}", spec.program))?;
        drop(pair.slave);

        let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
        let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
        let killer = child.clone_killer();

        self.sessions
            .lock()
            .unwrap()
            .insert(pane_id.clone(), Session { master: pair.master, writer, killer });

        std::thread::spawn(move || {
            let mut buf = vec![0u8; 64 * 1024];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => {
                        if on_data.send(InvokeResponseBody::Raw(buf[..n].to_vec())).is_err() {
                            break;
                        }
                    }
                }
            }
        });

        // ConPTY keeps the reader open after the child exits, so exit is detected by waiting on
        // the child and then dropping the master, which closes the pseudo console.
        let app = app.clone();
        std::thread::spawn(move || {
            let code = child.wait().map(|s| s.exit_code()).unwrap_or(1);
            let _ = app.emit("pty-exit", ExitEvent { pane_id: pane_id.clone(), code });
            use tauri::Manager;
            app.state::<PtyManager>().sessions.lock().unwrap().remove(&pane_id);
        });

        Ok(())
    }

    pub fn write(&self, pane_id: &str, data: &str) -> Result<(), String> {
        let mut sessions = self.sessions.lock().unwrap();
        let session = sessions.get_mut(pane_id).ok_or("This terminal has closed")?;
        session.writer.write_all(data.as_bytes()).map_err(|e| e.to_string())?;
        session.writer.flush().map_err(|e| e.to_string())
    }

    pub fn resize(&self, pane_id: &str, cols: u16, rows: u16) -> Result<(), String> {
        let sessions = self.sessions.lock().unwrap();
        if let Some(session) = sessions.get(pane_id) {
            session
                .master
                .resize(PtySize { rows: rows.max(2), cols: cols.max(2), pixel_width: 0, pixel_height: 0 })
                .map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    pub fn kill(&self, pane_id: &str) {
        if let Some(mut session) = self.sessions.lock().unwrap().remove(pane_id) {
            let _ = session.killer.kill();
        }
    }

    pub fn kill_all(&self) {
        for (_, mut session) in self.sessions.lock().unwrap().drain() {
            let _ = session.killer.kill();
        }
    }
}
