//! Reads and edits Claude Code configuration: settings.json (permissions, hooks), CLAUDE.md
//! memory files, and MCP servers (through the `claude mcp` CLI so formats stay Claude's).

use std::path::{Path, PathBuf};

use serde::Serialize;
use serde_json::{Map, Value};

use crate::git::hidden;

fn home_claude() -> Result<PathBuf, String> {
    Ok(dirs::home_dir().ok_or("No home folder")?.join(".claude"))
}

fn project_root(cwd: &str) -> Result<PathBuf, String> {
    let p = Path::new(cwd);
    if cwd.is_empty() || !p.is_dir() {
        return Err("Open a project tab first".into());
    }
    Ok(p.to_path_buf())
}

/// user → ~/.claude/settings.json · project → <cwd>/.claude/settings.json (shared with the team)
/// · local → <cwd>/.claude/settings.local.json (only you)
pub fn settings_path(scope: &str, cwd: &str) -> Result<PathBuf, String> {
    match scope {
        "user" => Ok(home_claude()?.join("settings.json")),
        "project" => Ok(project_root(cwd)?.join(".claude").join("settings.json")),
        "local" => Ok(project_root(cwd)?.join(".claude").join("settings.local.json")),
        _ => Err("Unknown scope".into()),
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsFile {
    pub path: String,
    pub exists: bool,
    pub permissions: Value,
    pub hooks: Value,
}

fn read_json(path: &Path) -> Result<Map<String, Value>, String> {
    match std::fs::read_to_string(path) {
        Ok(text) if text.trim().is_empty() => Ok(Map::new()),
        Ok(text) => match serde_json::from_str::<Value>(&text) {
            Ok(Value::Object(map)) => Ok(map),
            Ok(_) => Err(format!("{} is not a JSON object", path.display())),
            Err(e) => Err(format!("{} has a JSON error: {e}. Fix it by hand before editing here.", path.display())),
        },
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Map::new()),
        Err(e) => Err(e.to_string()),
    }
}

pub fn read_settings(scope: &str, cwd: &str) -> Result<SettingsFile, String> {
    let path = settings_path(scope, cwd)?;
    let map = read_json(&path)?;
    Ok(SettingsFile {
        path: path.to_string_lossy().into_owned(),
        exists: path.is_file(),
        permissions: map.get("permissions").cloned().unwrap_or(Value::Null),
        hooks: map.get("hooks").cloned().unwrap_or(Value::Null),
    })
}

/// Replaces one top-level key ("permissions" or "hooks"), keeping everything else as it was.
pub fn write_settings_key(scope: &str, cwd: &str, key: &str, value: Value) -> Result<(), String> {
    if key != "permissions" && key != "hooks" {
        return Err("Helm only edits permissions and hooks".into());
    }
    let path = settings_path(scope, cwd)?;
    let mut map = read_json(&path)?;

    // One backup per file, the first time Helm edits it.
    let backup = path.with_extension("json.helm-backup");
    if path.is_file() && !backup.exists() {
        let _ = std::fs::copy(&path, &backup);
    }

    let empty = match &value {
        Value::Null => true,
        Value::Object(o) => o.values().all(|v| matches!(v, Value::Array(a) if a.is_empty()) || v.is_null()),
        _ => false,
    };
    if empty {
        map.remove(key);
    } else {
        map.insert(key.to_string(), value);
    }
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let text = serde_json::to_string_pretty(&Value::Object(map)).map_err(|e| e.to_string())?;
    std::fs::write(&path, text + "\n").map_err(|e| e.to_string())
}

/// True when the user configured their own status line, which Helm must not replace.
pub fn has_own_status_line(cwd: &str) -> bool {
    ["user", "project", "local"].iter().any(|scope| {
        settings_path(scope, cwd)
            .ok()
            .and_then(|p| read_json(&p).ok())
            .is_some_and(|m| m.get("statusLine").is_some_and(|v| !v.is_null()))
    })
}

// ---------- CLAUDE.md ----------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryFile {
    pub scope: String,
    pub path: String,
    pub exists: bool,
    pub content: String,
}

pub fn memory_path(scope: &str, cwd: &str) -> Result<PathBuf, String> {
    match scope {
        "user" => Ok(home_claude()?.join("CLAUDE.md")),
        "project" => Ok(project_root(cwd)?.join("CLAUDE.md")),
        "local" => Ok(project_root(cwd)?.join("CLAUDE.local.md")),
        _ => Err("Unknown scope".into()),
    }
}

pub fn read_memory(scope: &str, cwd: &str) -> Result<MemoryFile, String> {
    let path = memory_path(scope, cwd)?;
    let content = std::fs::read_to_string(&path).unwrap_or_default();
    Ok(MemoryFile { scope: scope.into(), path: path.to_string_lossy().into_owned(), exists: path.is_file(), content })
}

pub fn write_memory(scope: &str, cwd: &str, content: &str) -> Result<(), String> {
    let path = memory_path(scope, cwd)?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    std::fs::write(&path, content).map_err(|e| e.to_string())
}

// ---------- MCP servers ----------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpServer {
    pub name: String,
    pub target: String,
    pub status: String,
    /// "ok" | "auth" | "failed" | "pending" | "unknown"
    pub health: String,
    /// Servers from plugins or claude.ai are managed elsewhere.
    pub managed: bool,
}

pub(crate) fn claude_cmd(cwd: &str) -> Result<std::process::Command, String> {
    let exe = which::which("claude").map_err(|_| "Claude Code is not installed or not on PATH".to_string())?;
    let mut cmd = hidden(&exe.to_string_lossy());
    if Path::new(cwd).is_dir() {
        cmd.current_dir(cwd);
    }
    for k in crate::pty::INHERITED_SESSION_VARS {
        cmd.env_remove(k);
    }
    Ok(cmd)
}

fn run(mut cmd: std::process::Command) -> Result<String, String> {
    let out = cmd.output().map_err(|e| e.to_string())?;
    let stdout = String::from_utf8_lossy(&out.stdout).into_owned();
    if out.status.success() {
        Ok(stdout)
    } else {
        let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
        Err(if err.is_empty() { stdout.trim().to_string() } else { err })
    }
}

pub fn mcp_list(cwd: &str) -> Result<Vec<McpServer>, String> {
    let mut cmd = claude_cmd(cwd)?;
    cmd.args(["mcp", "list"]);
    let out = run(cmd)?;
    Ok(out
        .lines()
        .filter_map(|line| {
            // "name: target - ✔ Connected"
            let (name, rest) = line.split_once(": ")?;
            let (target, status) = rest.rsplit_once(" - ")?;
            let status = status.trim().to_string();
            let health = if status.contains('✔') {
                "ok"
            } else if status.contains("authentication") {
                "auth"
            } else if status.contains('✘') {
                "failed"
            } else if status.contains("Pending") || status.contains('⏸') {
                "pending"
            } else {
                "unknown"
            };
            Some(McpServer {
                managed: name.starts_with("plugin:") || name.starts_with("claude.ai"),
                name: name.trim().to_string(),
                target: target.trim().to_string(),
                status: status.trim_start_matches(['✔', '✘', '!', '⏸', ' ']).to_string(),
                health: health.into(),
            })
        })
        .collect())
}

pub fn mcp_add(cwd: &str, name: &str, scope: &str, transport: &str, target: &str, args: &[String], env: &[String]) -> Result<(), String> {
    let valid_name = !name.is_empty() && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
    if !valid_name {
        return Err("Use letters, numbers, - or _ for the name".into());
    }
    if !["local", "user", "project"].contains(&scope) || !["stdio", "http", "sse"].contains(&transport) {
        return Err("Invalid scope or transport".into());
    }
    let mut cmd = claude_cmd(cwd)?;
    cmd.args(["mcp", "add", "--scope", scope, "--transport", transport]);
    for e in env {
        cmd.args(["-e", e]);
    }
    cmd.arg(name);
    if transport == "stdio" {
        cmd.arg("--").arg(target).args(args);
    } else {
        cmd.arg(target);
    }
    run(cmd).map(|_| ())
}

pub fn mcp_remove(cwd: &str, name: &str, scope: Option<&str>) -> Result<(), String> {
    let mut cmd = claude_cmd(cwd)?;
    cmd.args(["mcp", "remove"]);
    if let Some(s) = scope {
        cmd.args(["--scope", s]);
    }
    cmd.arg(name);
    run(cmd).map(|_| ())
}
