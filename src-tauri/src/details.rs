//! "Details" for the right panel: what a Claude session has looked at and produced, read from its
//! transcript. Also the prompt improver (a one-shot Claude Haiku call).

use std::collections::BTreeMap;
use std::fs::File;
use std::io::{BufRead, BufReader, Write};
use std::path::Path;
use std::process::Stdio;

use serde::Serialize;
use serde_json::Value;

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct FileUse {
    pub path: String,
    pub count: u32,
}

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SessionDetails {
    /// Pasted images as data URLs (newest last, capped).
    pub images: Vec<String>,
    /// Files you attached or mentioned with @ in your messages.
    pub mentioned: Vec<String>,
    pub read: Vec<FileUse>,
    pub changed: Vec<FileUse>,
    pub web: Vec<String>,
    pub mcp: Vec<FileUse>,
    pub subagents: Vec<FileUse>,
}

const MAX_IMAGES: usize = 12;
const MAX_IMAGE_BYTES: usize = 4 * 1024 * 1024;

fn bump(map: &mut BTreeMap<String, u32>, key: &str) {
    *map.entry(key.to_string()).or_default() += 1;
}

fn to_uses(map: BTreeMap<String, u32>) -> Vec<FileUse> {
    let mut v: Vec<FileUse> = map.into_iter().map(|(path, count)| FileUse { path, count }).collect();
    v.sort_by(|a, b| b.count.cmp(&a.count).then(a.path.cmp(&b.path)));
    v
}

/// Words in a prompt that look like `@path/to/file` mentions or Windows/Unix file paths.
fn mentions_in(text: &str, out: &mut Vec<String>) {
    for word in text.split_whitespace() {
        let w = word.trim_matches(|c: char| c == '"' || c == '\'' || c == ',' || c == ')' || c == '(');
        let candidate = w.strip_prefix('@').unwrap_or(w);
        let looks_like_path = w.starts_with('@') && candidate.len() > 1
            || (candidate.len() > 3 && candidate.as_bytes().get(1) == Some(&b':') && candidate.contains('\\'));
        if looks_like_path && !out.iter().any(|m| m == candidate) {
            out.push(candidate.to_string());
        }
    }
}

pub fn read(path: &Path) -> Result<SessionDetails, String> {
    let file = File::open(path).map_err(|e| e.to_string())?;
    let mut d = SessionDetails::default();
    let (mut read, mut changed, mut mcp, mut subagents) = (BTreeMap::new(), BTreeMap::new(), BTreeMap::new(), BTreeMap::new());

    for line in BufReader::new(file).lines().map_while(Result::ok) {
        // Cheap filter before parsing: only user and assistant messages matter here.
        if !line.contains("\"type\":\"user\"") && !line.contains("\"type\":\"assistant\"") {
            continue;
        }
        let Ok(v) = serde_json::from_str::<Value>(&line) else { continue };
        if v.get("isSidechain").and_then(Value::as_bool) == Some(true) {
            continue;
        }
        let Some(content) = v.pointer("/message/content") else { continue };
        match v.get("type").and_then(Value::as_str) {
            Some("user") => {
                if let Some(text) = content.as_str() {
                    mentions_in(text, &mut d.mentioned);
                }
                for part in content.as_array().into_iter().flatten() {
                    match part.get("type").and_then(Value::as_str) {
                        Some("text") => mentions_in(part.get("text").and_then(Value::as_str).unwrap_or(""), &mut d.mentioned),
                        Some("image") => {
                            let media = part.pointer("/source/media_type").and_then(Value::as_str).unwrap_or("image/png");
                            if let Some(data) = part.pointer("/source/data").and_then(Value::as_str) {
                                if data.len() <= MAX_IMAGE_BYTES {
                                    d.images.push(format!("data:{media};base64,{data}"));
                                    if d.images.len() > MAX_IMAGES {
                                        d.images.remove(0);
                                    }
                                }
                            }
                        }
                        _ => {}
                    }
                }
            }
            _ => {
                for part in content.as_array().into_iter().flatten() {
                    if part.get("type").and_then(Value::as_str) != Some("tool_use") {
                        continue;
                    }
                    let name = part.get("name").and_then(Value::as_str).unwrap_or("");
                    let input = part.get("input");
                    let field = |k: &str| input.and_then(|i| i.get(k)).and_then(Value::as_str);
                    match name {
                        "Read" => field("file_path").into_iter().for_each(|p| bump(&mut read, p)),
                        "Edit" | "MultiEdit" | "Write" | "NotebookEdit" => {
                            field("file_path").or_else(|| field("notebook_path")).into_iter().for_each(|p| bump(&mut changed, p))
                        }
                        "WebFetch" => field("url").into_iter().for_each(|u| {
                            if !d.web.iter().any(|x| x == u) {
                                d.web.push(u.to_string());
                            }
                        }),
                        "WebSearch" => field("query").into_iter().for_each(|q| {
                            let item = format!("Search: {q}");
                            if !d.web.contains(&item) {
                                d.web.push(item);
                            }
                        }),
                        "Task" | "Agent" => {
                            let label = field("subagent_type").unwrap_or("general-purpose");
                            bump(&mut subagents, label);
                        }
                        n if n.starts_with("mcp__") => bump(&mut mcp, n),
                        _ => {}
                    }
                }
            }
        }
    }
    d.read = to_uses(read);
    d.changed = to_uses(changed);
    d.mcp = to_uses(mcp);
    d.subagents = to_uses(subagents);
    Ok(d)
}

const IMPROVE_SYSTEM: &str = "You improve prompts that a developer will send to Claude Code. Return only the improved prompt, with no preamble or explanation. Keep it short: at most 6 lines or bullets. Make the goal, where to look, constraints and what 'done' means clear. Keep the user's language and any file names, code or error messages exactly. Never invent file names or facts.";

/// Rewrites a prompt with Claude Haiku. Runs outside any project, with no tools, plugins, hooks or
/// MCP servers, and without saving a session.
pub fn improve_prompt(text: &str, project: &str, work_dir: &Path) -> Result<String, String> {
    if text.trim().is_empty() {
        return Err("Write a prompt first".into());
    }
    std::fs::create_dir_all(work_dir).map_err(|e| e.to_string())?;
    let system = if project.is_empty() { IMPROVE_SYSTEM.to_string() } else { format!("{IMPROVE_SYSTEM} The project is called '{project}'.") };
    let mut cmd = crate::claude_settings::claude_cmd(&work_dir.to_string_lossy())?;
    cmd.args([
        "-p",
        "--model",
        "haiku",
        "--tools",
        "",
        "--setting-sources",
        "project",
        "--strict-mcp-config",
        "--disable-slash-commands",
        "--no-session-persistence",
        "--system-prompt",
        &system,
    ])
    .stdin(Stdio::piped())
    .stdout(Stdio::piped())
    .stderr(Stdio::piped());
    let mut child = cmd.spawn().map_err(|e| e.to_string())?;
    child.stdin.take().ok_or("no stdin")?.write_all(text.as_bytes()).map_err(|e| e.to_string())?;
    let out = child.wait_with_output().map_err(|e| e.to_string())?;
    let result = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if !out.status.success() || result.is_empty() {
        let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
        return Err(if err.is_empty() { result } else { err }.chars().take(300).collect());
    }
    Ok(result)
}
