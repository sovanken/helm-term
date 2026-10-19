//! Reads Claude Code session transcripts (`~/.claude/projects/<project>/<session>.jsonl`) for
//! the history sidebar, full-text search and the status bar.

use std::collections::HashMap;
use std::fs::File;
use std::io::{BufRead, BufReader, Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::UNIX_EPOCH;

use serde::Serialize;
use serde_json::Value;

const HEAD_BYTES: u64 = 256 * 1024;
const TAIL_BYTES: u64 = 256 * 1024;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionInfo {
    pub id: String,
    pub cwd: String,
    pub title: String,
    pub first_prompt: String,
    pub branch: Option<String>,
    pub prompts: u32,
    pub created: Option<String>,
    pub last_used: u64,
}

#[derive(Default)]
pub struct SessionCache {
    entries: Mutex<HashMap<PathBuf, (u64, u64, Option<SessionInfo>)>>,
}

pub fn projects_dir() -> Option<PathBuf> {
    Some(dirs::home_dir()?.join(".claude").join("projects"))
}

fn mtime_ms(meta: &std::fs::Metadata) -> u64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// All top-level transcript files (subagent transcripts live in subfolders and are skipped).
fn transcript_files() -> Vec<PathBuf> {
    let Some(root) = projects_dir() else { return vec![] };
    std::fs::read_dir(root)
        .into_iter()
        .flatten()
        .flatten()
        .filter(|d| d.path().is_dir())
        .flat_map(|d| std::fs::read_dir(d.path()).into_iter().flatten().flatten())
        .map(|e| e.path())
        .filter(|p| p.extension().is_some_and(|x| x == "jsonl"))
        .collect()
}

pub fn find_transcript(session_id: &str) -> Option<PathBuf> {
    let name = format!("{session_id}.jsonl");
    let root = projects_dir()?;
    std::fs::read_dir(root)
        .ok()?
        .flatten()
        .map(|d| d.path().join(&name))
        .find(|p| p.is_file())
}

/// The folder a session was started in (Claude only resumes a session from its own project).
pub fn session_cwd(session_id: &str) -> Option<String> {
    let path = find_transcript(session_id)?;
    read_lines(&path, 0, HEAD_BYTES)
        .iter()
        .find_map(|l| l.get("cwd").and_then(Value::as_str).map(String::from))
}

/// Text of a human-typed prompt, or None for tool results, meta and command noise.
pub(crate) fn human_prompt(line: &Value) -> Option<String> {
    if line.get("type")?.as_str()? != "user" || line.get("isMeta").and_then(Value::as_bool) == Some(true) {
        return None;
    }
    if line.get("isSidechain").and_then(Value::as_bool) == Some(true) {
        return None;
    }
    let content = line.get("message")?.get("content")?;
    let text = match content {
        Value::String(s) => s.clone(),
        Value::Array(parts) => parts
            .iter()
            .filter(|p| p.get("type").and_then(Value::as_str) == Some("text"))
            .filter_map(|p| p.get("text").and_then(Value::as_str))
            .collect::<Vec<_>>()
            .join(" "),
        _ => return None,
    };
    let text = text.trim();
    let noise = ["<command-", "<local-command", "<task-notification", "<system-reminder", "Caveat:", "[Request interrupted"];
    if text.is_empty() || noise.iter().any(|n| text.starts_with(n)) {
        return None;
    }
    Some(text.to_string())
}

fn read_lines(path: &Path, from: u64, len: u64) -> Vec<Value> {
    let Ok(mut file) = File::open(path) else { return vec![] };
    if file.seek(SeekFrom::Start(from)).is_err() {
        return vec![];
    }
    let mut buf = Vec::new();
    let _ = file.take(len).read_to_end(&mut buf);
    let text = String::from_utf8_lossy(&buf);
    let mut lines = text.lines();
    if from > 0 {
        lines.next(); // partial line
    }
    lines.filter_map(|l| serde_json::from_str(l).ok()).collect()
}

pub(crate) fn truncate(s: &str, max: usize) -> String {
    let one_line = s.split_whitespace().collect::<Vec<_>>().join(" ");
    if one_line.chars().count() <= max {
        one_line
    } else {
        format!("{}…", one_line.chars().take(max).collect::<String>())
    }
}

fn parse_session(path: &Path, size: u64, last_used: u64) -> Option<SessionInfo> {
    let id = path.file_stem()?.to_string_lossy().into_owned();
    let head = read_lines(path, 0, HEAD_BYTES);
    let tail = if size > HEAD_BYTES { read_lines(path, size.saturating_sub(TAIL_BYTES), TAIL_BYTES) } else { vec![] };

    let mut cwd = None;
    let mut first_prompt = None;
    let mut created = None;
    let mut prompts = 0u32;
    for line in &head {
        if cwd.is_none() {
            cwd = line.get("cwd").and_then(Value::as_str).map(String::from);
        }
        if created.is_none() {
            created = line.get("timestamp").and_then(Value::as_str).map(String::from);
        }
        if let Some(p) = human_prompt(line) {
            prompts += 1;
            first_prompt.get_or_insert(p);
        }
    }
    if size > HEAD_BYTES {
        prompts += tail.iter().filter(|l| human_prompt(l).is_some()).count() as u32;
    }
    let first_prompt = first_prompt?; // sessions nobody typed in are not worth listing

    let mut title = None;
    let mut branch = None;
    for line in head.iter().chain(tail.iter()) {
        match line.get("type").and_then(Value::as_str) {
            Some("ai-title") => title = line.get("aiTitle").and_then(Value::as_str).map(String::from).or(title),
            Some("summary") => title = line.get("summary").and_then(Value::as_str).map(String::from).or(title),
            _ => {}
        }
        if let Some(b) = line.get("gitBranch").and_then(Value::as_str) {
            if !b.is_empty() && b != "HEAD" {
                branch = Some(b.to_string());
            }
        }
    }

    Some(SessionInfo {
        id,
        cwd: cwd.unwrap_or_default(),
        title: title.unwrap_or_else(|| truncate(&first_prompt, 80)),
        first_prompt: truncate(&first_prompt, 200),
        branch,
        prompts,
        created,
        last_used,
    })
}

impl SessionCache {
    pub fn list(&self, limit: usize) -> Vec<SessionInfo> {
        let mut out = Vec::new();
        let mut entries = self.entries.lock().unwrap();
        for path in transcript_files() {
            let Ok(meta) = std::fs::metadata(&path) else { continue };
            let (mtime, size) = (mtime_ms(&meta), meta.len());
            let info = match entries.get(&path) {
                Some((m, s, info)) if *m == mtime && *s == size => info.clone(),
                _ => {
                    let info = parse_session(&path, size, mtime);
                    entries.insert(path.clone(), (mtime, size, info.clone()));
                    info
                }
            };
            out.extend(info);
        }
        out.sort_by(|a, b| b.last_used.cmp(&a.last_used));
        out.truncate(limit);
        out
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub session_id: String,
    pub snippet: String,
}

/// Full-text search over what you and Claude wrote. Returns one hit per session.
pub fn search(query: &str, limit: usize) -> Vec<SearchHit> {
    let needle = query.trim().to_lowercase();
    if needle.chars().count() < 2 {
        return vec![];
    }
    let mut files: Vec<(u64, PathBuf)> = transcript_files()
        .into_iter()
        .filter_map(|p| Some((mtime_ms(&std::fs::metadata(&p).ok()?), p)))
        .collect();
    files.sort_by(|a, b| b.0.cmp(&a.0));

    let mut hits = Vec::new();
    for (_, path) in files {
        let Ok(file) = File::open(&path) else { continue };
        for raw in BufReader::new(file).lines().map_while(Result::ok) {
            if !raw.to_lowercase().contains(&needle) {
                continue;
            }
            let Ok(line) = serde_json::from_str::<Value>(&raw) else { continue };
            let text = human_prompt(&line).or_else(|| assistant_text(&line));
            let Some(text) = text else { continue };
            let lower = text.to_lowercase();
            let Some(pos) = lower.find(&needle) else { continue };
            hits.push(SearchHit {
                session_id: path.file_stem().unwrap_or_default().to_string_lossy().into_owned(),
                snippet: snippet(&text, pos, needle.len()),
            });
            break;
        }
        if hits.len() >= limit {
            break;
        }
    }
    hits
}

fn assistant_text(line: &Value) -> Option<String> {
    if line.get("type")?.as_str()? != "assistant" {
        return None;
    }
    let parts = line.get("message")?.get("content")?.as_array()?;
    let text: Vec<&str> = parts
        .iter()
        .filter(|p| p.get("type").and_then(Value::as_str) == Some("text"))
        .filter_map(|p| p.get("text").and_then(Value::as_str))
        .collect();
    (!text.is_empty()).then(|| text.join(" "))
}

fn snippet(text: &str, byte_pos: usize, len: usize) -> String {
    let mut start = byte_pos.saturating_sub(60);
    while !text.is_char_boundary(start) {
        start -= 1;
    }
    let mut end = (byte_pos + len + 100).min(text.len());
    while !text.is_char_boundary(end) {
        end += 1;
    }
    let body = text[start..end].split_whitespace().collect::<Vec<_>>().join(" ");
    format!("{}{}{}", if start > 0 { "…" } else { "" }, body, if end < text.len() { "…" } else { "" })
}

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SessionStats {
    pub model: Option<String>,
    pub context_tokens: u64,
    pub context_window: u64,
    pub cost_usd: Option<f64>,
    pub lines_added: Option<u64>,
    pub lines_removed: Option<u64>,
    pub title: Option<String>,
}

fn configured_1m_model() -> bool {
    dirs::home_dir()
        .and_then(|h| std::fs::read_to_string(h.join(".claude").join("settings.json")).ok())
        .and_then(|s| serde_json::from_str::<Value>(&s).ok())
        .and_then(|v| v.get("model").and_then(Value::as_str).map(|m| m.contains("[1m]")))
        .unwrap_or(false)
}

/// Live numbers for the status bar, from the end of the session transcript.
pub fn stats(path: &Path) -> SessionStats {
    let size = std::fs::metadata(path).map(|m| m.len()).unwrap_or(0);
    let lines = read_lines(path, size.saturating_sub(TAIL_BYTES * 2), TAIL_BYTES * 2);
    let mut s = SessionStats::default();
    let mut one_m = false;

    for line in &lines {
        match line.get("type").and_then(Value::as_str) {
            Some("assistant") if line.get("isSidechain").and_then(Value::as_bool) != Some(true) => {
                let msg = line.get("message");
                if let Some(model) = msg.and_then(|m| m.get("model")).and_then(Value::as_str) {
                    if !model.starts_with('<') {
                        s.model = Some(model.to_string());
                    }
                }
                if let Some(u) = msg.and_then(|m| m.get("usage")) {
                    let n = |k: &str| u.get(k).and_then(Value::as_u64).unwrap_or(0);
                    let total = n("input_tokens") + n("cache_read_input_tokens") + n("cache_creation_input_tokens");
                    if total > 0 {
                        s.context_tokens = total + n("output_tokens");
                    }
                }
            }
            Some("cost-state") => {
                s.cost_usd = line.get("totalCostUSD").and_then(Value::as_f64);
                s.lines_added = line.get("totalLinesAdded").and_then(Value::as_u64);
                s.lines_removed = line.get("totalLinesRemoved").and_then(Value::as_u64);
                if let Some(usage) = line.get("modelUsage").and_then(Value::as_object) {
                    one_m |= usage.keys().any(|k| k.contains("[1m]"));
                }
            }
            Some("ai-title") => s.title = line.get("aiTitle").and_then(Value::as_str).map(String::from),
            Some("compact_boundary") | Some("system")
                if line.get("subtype").and_then(Value::as_str) == Some("compact_boundary") =>
            {
                s.context_tokens = 0;
            }
            _ => {}
        }
    }
    one_m |= s.context_tokens > 200_000 || configured_1m_model();
    s.context_window = if one_m { 1_000_000 } else { 200_000 };
    s
}
