//! Builds the shell command line for a pane: PowerShell 7, Windows PowerShell or Git Bash. A small
//! init script wraps `claude` so every Claude session started inside Helm reports back to Helm,
//! and makes the prompt report the current folder (OSC 9;9).

use std::path::{Path, PathBuf};

use base64::Engine;
use serde::{Deserialize, Serialize};

use crate::pty::SpawnSpec;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchRequest {
    pub pane_id: String,
    pub cwd: String,
    /// "claude" starts Claude Code right away; "shell" just opens the shell.
    pub kind: String,
    /// "pwsh", "powershell" or "bash". Falls back to the best available PowerShell.
    pub shell: Option<String>,
    /// Starts a new Claude session with this id (so the tab can be restored later).
    pub new_session_id: Option<String>,
    /// Resumes an existing Claude session.
    pub resume_session_id: Option<String>,
    /// With `resume_session_id`: continue in a new conversation and leave the original as it was.
    #[serde(default)]
    pub fork: bool,
    /// Starts Claude in a new git worktree with this name (a parallel task).
    pub worktree: Option<String>,
    /// Identifies this launch so hook events from a previous process in the same pane are ignored.
    pub launch_id: String,
    /// Tell Claude it runs on Windows and which shell syntax to use.
    pub windows_hints: bool,
    /// Send permission requests to Helm's approval inbox.
    pub approvals: bool,
    /// Feed the usage cockpit from Claude's status line (skipped if the user has their own).
    pub usage: bool,
    /// Extra options appended when Helm starts Claude (Settings → Advanced).
    #[serde(default)]
    pub extra_args: String,
    /// Extra environment variables for the shell (Settings → Advanced).
    #[serde(default)]
    pub env: Vec<(String, String)>,
    pub cols: u16,
    pub rows: u16,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ShellInfo {
    pub id: String,
    pub label: String,
    pub path: String,
}

/// Git for Windows' bash, never WSL's `C:\Windows\System32\bash.exe`.
fn git_bash() -> Option<PathBuf> {
    let from_git = which::which("git.exe").ok().and_then(|git| {
        // ...\Git\cmd\git.exe or ...\Git\bin\git.exe → ...\Git\bin\bash.exe
        let root = git.parent()?.parent()?;
        Some(root.join("bin").join("bash.exe"))
    });
    [from_git, Some(PathBuf::from(r"C:\Program Files\Git\bin\bash.exe"))]
        .into_iter()
        .flatten()
        .find(|p| p.is_file())
}

pub fn available_shells() -> Vec<ShellInfo> {
    let mut out = Vec::new();
    if let Ok(p) = which::which("pwsh.exe") {
        out.push(ShellInfo { id: "pwsh".into(), label: "PowerShell 7".into(), path: p.to_string_lossy().into_owned() });
    }
    out.push(ShellInfo { id: "powershell".into(), label: "Windows PowerShell".into(), path: "powershell.exe".into() });
    if let Some(p) = git_bash() {
        out.push(ShellInfo { id: "bash".into(), label: "Git Bash".into(), path: p.to_string_lossy().into_owned() });
    }
    out
}

fn is_safe_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 64 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
}

/// The `claude …` line that starts Claude for this pane, if it should start right away.
pub(crate) fn claude_line(req: &LaunchRequest) -> Option<String> {
    if req.kind != "claude" {
        return None;
    }
    let base = match (&req.resume_session_id, &req.new_session_id, &req.worktree) {
        (Some(id), _, _) if req.fork => format!("claude --resume {id} --fork-session"),
        (Some(id), _, _) => format!("claude --resume {id}"),
        (None, Some(id), Some(name)) => format!("claude --session-id {id} --worktree {name}"),
        (None, Some(id), None) => format!("claude --session-id {id}"),
        _ => "claude".into(),
    };
    // The user's own extra options, typed exactly as they would in their shell. Line breaks are
    // removed so the value can't add further commands to the init script.
    let extra = req.extra_args.replace(['\r', '\n'], " ");
    Some(if extra.trim().is_empty() { base } else { format!("{base} {}", extra.trim()) })
}

pub(crate) fn valid_env_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 128
        && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
        && !name.starts_with("HELM_")
}

fn windows_hint(shell_label: &str) -> String {
    format!(
        "Environment note from the Helm terminal: this machine runs Windows and the user's terminal shell is {shell_label}. \
         Your Bash tool runs Git Bash, so use POSIX shell syntax there (forward slashes, $VAR, && chaining) and never \
         PowerShell cmdlets; use PowerShell syntax only with a PowerShell tool. Quote Windows paths that contain spaces."
    )
}

/// Claude subcommands that must not receive Helm's session flags.
const SUBCOMMANDS: &str = "mcp|config|update|doctor|install|plugin|plugins|agents|attach|respawn|setup-token|migrate-installer|auth";

const PWSH_INIT: &str = r#"$env:HELM_CLAUDE = (Get-Command claude -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1).Source
function claude {
  if (-not $env:HELM_CLAUDE) {
    Write-Host 'Claude Code is not installed. Install it from https://claude.com/claude-code then open a new tab.' -ForegroundColor Yellow
    return
  }
  if ($args.Count -gt 0 -and "$($args[0])" -match '^(__SUBCOMMANDS__)$') { & $env:HELM_CLAUDE @args; return }
  $helm = @('--settings', $env:HELM_SETTINGS)
  if ($env:HELM_APPEND) { $helm += @('--append-system-prompt', $env:HELM_APPEND) }
  & $env:HELM_CLAUDE @helm @args
}
# Report the current folder to Helm (OSC 9;9, same convention as Windows Terminal).
$global:__HelmPrompt = $function:prompt
function global:prompt {
  $loc = $executionContext.SessionState.Path.CurrentLocation
  $out = & $global:__HelmPrompt
  if ($loc.Provider.Name -eq 'FileSystem') { "$([char]27)]9;9;`"$($loc.ProviderPath)`"$([char]27)\" + $out } else { $out }
}
"#;

const BASH_INIT: &str = r#"[ -f ~/.bashrc ] && . ~/.bashrc
claude() {
  if ! command -v claude >/dev/null 2>&1; then
    echo "Claude Code is not installed. Install it from https://claude.com/claude-code then open a new tab."
    return 1
  fi
  case "$1" in
    __SUBCOMMANDS__) command claude "$@"; return ;;
  esac
  if [ -n "$HELM_APPEND" ]; then
    command claude --settings "$HELM_SETTINGS" --append-system-prompt "$HELM_APPEND" "$@"
  else
    command claude --settings "$HELM_SETTINGS" "$@"
  fi
}
# Report the current folder to Helm (OSC 9;9, same convention as Windows Terminal).
__helm_cwd() { printf '\033]9;9;"%s"\033\\' "$(cygpath -w "$PWD")"; }
PROMPT_COMMAND="__helm_cwd${PROMPT_COMMAND:+;$PROMPT_COMMAND}"
"#;

pub fn build(req: &LaunchRequest, settings_path: &Path) -> Result<SpawnSpec, String> {
    if !is_safe_id(&req.pane_id) || !is_safe_id(&req.launch_id) {
        return Err("Invalid pane id".into());
    }
    for id in [&req.new_session_id, &req.resume_session_id, &req.worktree].into_iter().flatten() {
        if !is_safe_id(id) {
            return Err("Invalid session id".into());
        }
    }

    let cwd = if Path::new(&req.cwd).is_dir() {
        req.cwd.clone()
    } else {
        dirs::home_dir().map(|p| p.to_string_lossy().into_owned()).unwrap_or_else(|| "C:\\".into())
    };

    let shells = available_shells();
    let wanted = req.shell.as_deref().unwrap_or("pwsh");
    let shell = shells
        .iter()
        .find(|s| s.id == wanted)
        .or_else(|| shells.iter().find(|s| s.id == "pwsh"))
        .unwrap_or(&shells[0])
        .clone();

    let mut env = vec![
        ("HELM_PANE".to_string(), req.pane_id.clone()),
        ("HELM_SETTINGS".to_string(), settings_path.to_string_lossy().into_owned()),
        ("COLORTERM".to_string(), "truecolor".to_string()),
        ("TERM_PROGRAM".to_string(), "Helm".to_string()),
    ];
    if req.windows_hints {
        env.push(("HELM_APPEND".into(), windows_hint(&shell.label)));
    }
    for (k, v) in &req.env {
        if valid_env_name(k) {
            env.push((k.clone(), v.clone()));
        }
    }

    let (program, args) = if shell.id == "bash" {
        let mut rc = BASH_INIT.replace("__SUBCOMMANDS__", SUBCOMMANDS);
        if let Some(line) = claude_line(req) {
            rc.push_str(&line);
            rc.push('\n');
        }
        let rc_path = settings_path.with_extension("bashrc");
        std::fs::write(&rc_path, rc).map_err(|e| e.to_string())?;
        env.push(("CHERE_INVOKING".into(), "1".into())); // keep Git Bash in the pane's folder
        (shell.path.clone(), vec!["--rcfile".into(), rc_path.to_string_lossy().replace('\\', "/"), "-i".into()])
    } else {
        let mut script = PWSH_INIT.replace("__SUBCOMMANDS__", SUBCOMMANDS);
        if let Some(line) = claude_line(req) {
            script.push_str(&line);
            script.push('\n');
        }
        let utf16: Vec<u8> = script.encode_utf16().flat_map(u16::to_le_bytes).collect();
        let encoded = base64::engine::general_purpose::STANDARD.encode(utf16);
        (shell.path.clone(), vec!["-NoLogo".into(), "-NoExit".into(), "-EncodedCommand".into(), encoded])
    };

    Ok(SpawnSpec { program, args, cwd, env, cols: req.cols, rows: req.rows })
}
