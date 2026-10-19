//! Builds the shell command line for a pane. Every pane runs PowerShell; a small init script
//! wraps `claude` so any Claude session started inside Helm reports its status back.

use base64::Engine;
use serde::Deserialize;

use crate::pty::SpawnSpec;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchRequest {
    pub pane_id: String,
    pub cwd: String,
    /// "claude" starts Claude Code right away; "shell" just opens PowerShell.
    pub kind: String,
    /// Starts a new Claude session with this id (so the tab can be restored later).
    pub new_session_id: Option<String>,
    /// Resumes an existing Claude session.
    pub resume_session_id: Option<String>,
    /// Starts Claude in a new git worktree with this name (a parallel task).
    pub worktree: Option<String>,
    /// Identifies this launch so hook events from a previous process in the same pane are ignored.
    pub launch_id: String,
    pub cols: u16,
    pub rows: u16,
}

pub fn shell_program() -> String {
    which::which("pwsh.exe")
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_else(|_| "powershell.exe".into())
}

fn is_safe_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 64 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
}

pub fn build(req: &LaunchRequest, settings_path: &str) -> Result<SpawnSpec, String> {
    if !is_safe_id(&req.pane_id) {
        return Err("Invalid pane id".into());
    }
    if !is_safe_id(&req.launch_id) {
        return Err("Invalid launch id".into());
    }
    for id in [&req.new_session_id, &req.resume_session_id, &req.worktree].into_iter().flatten() {
        if !is_safe_id(id) {
            return Err("Invalid session id".into());
        }
    }

    let cwd = if std::path::Path::new(&req.cwd).is_dir() {
        req.cwd.clone()
    } else {
        dirs::home_dir().map(|p| p.to_string_lossy().into_owned()).unwrap_or_else(|| "C:\\".into())
    };

    let mut script = String::from(
        r#"$env:HELM_CLAUDE = (Get-Command claude -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1).Source
function claude {
  if (-not $env:HELM_CLAUDE) {
    Write-Host 'Claude Code is not installed. Install it from https://claude.com/claude-code then open a new tab.' -ForegroundColor Yellow
    return
  }
  & $env:HELM_CLAUDE --settings $env:HELM_SETTINGS @args
}
# Report the current folder to Helm (OSC 9;9, same convention as Windows Terminal).
$global:__HelmPrompt = $function:prompt
function global:prompt {
  $loc = $executionContext.SessionState.Path.CurrentLocation
  $out = & $global:__HelmPrompt
  if ($loc.Provider.Name -eq 'FileSystem') { "$([char]27)]9;9;`"$($loc.ProviderPath)`"$([char]27)\" + $out } else { $out }
}
"#,
    );
    if req.kind == "claude" {
        match (&req.resume_session_id, &req.new_session_id) {
            (Some(id), _) => script.push_str(&format!("claude --resume {id}\n")),
            (None, Some(id)) => match &req.worktree {
                Some(name) => script.push_str(&format!("claude --session-id {id} --worktree {name}\n")),
                None => script.push_str(&format!("claude --session-id {id}\n")),
            },
            _ => script.push_str("claude\n"),
        }
    }

    let utf16: Vec<u8> = script.encode_utf16().flat_map(u16::to_le_bytes).collect();
    let encoded = base64::engine::general_purpose::STANDARD.encode(utf16);

    Ok(SpawnSpec {
        program: shell_program(),
        args: vec!["-NoLogo".into(), "-NoExit".into(), "-EncodedCommand".into(), encoded],
        cwd,
        env: vec![
            ("HELM_PANE".into(), req.pane_id.clone()),
            ("HELM_SETTINGS".into(), settings_path.into()),
            ("COLORTERM".into(), "truecolor".into()),
            ("TERM_PROGRAM".into(), "Helm".into()),
        ],
        cols: req.cols,
        rows: req.rows,
    })
}
