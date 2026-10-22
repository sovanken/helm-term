//! Finds projects the user has already used with Claude Code by reading the session
//! transcripts Claude Code stores under `~/.claude/projects`.

use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentProject {
    pub path: String,
    pub last_used: u64,
}

fn claude_projects_dir() -> Option<PathBuf> {
    Some(dirs::home_dir()?.join(".claude").join("projects"))
}

fn modified_ms(path: &Path) -> u64 {
    std::fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Reads the first transcript lines until one carries the session's working directory.
pub fn cwd_from_transcript(path: &Path) -> Option<String> {
    let file = std::fs::File::open(path).ok()?;
    for line in BufReader::new(file).lines().take(60).map_while(Result::ok) {
        if !line.contains("\"cwd\"") {
            continue;
        }
        if let Ok(value) = serde_json::from_str::<serde_json::Value>(&line) {
            if let Some(cwd) = value.get("cwd").and_then(|v| v.as_str()) {
                return Some(cwd.to_string());
            }
        }
    }
    None
}

pub fn recent(limit: usize) -> Vec<RecentProject> {
    let Some(root) = claude_projects_dir() else { return vec![] };
    let Ok(dirs) = std::fs::read_dir(root) else { return vec![] };

    let mut projects: Vec<RecentProject> = Vec::new();
    for dir in dirs.flatten().filter(|d| d.path().is_dir()) {
        let mut transcripts: Vec<(u64, PathBuf)> = std::fs::read_dir(dir.path())
            .into_iter()
            .flatten()
            .flatten()
            .map(|e| e.path())
            .filter(|p| p.extension().is_some_and(|x| x == "jsonl"))
            .map(|p| (modified_ms(&p), p))
            .collect();
        transcripts.sort_by(|a, b| b.0.cmp(&a.0));

        // The newest few transcripts are enough; older ones may predate a folder rename.
        for (last_used, path) in transcripts.iter().take(3) {
            if let Some(cwd) = cwd_from_transcript(path) {
                if Path::new(&cwd).is_dir() {
                    match projects.iter_mut().find(|p| p.path.eq_ignore_ascii_case(&cwd)) {
                        Some(existing) => existing.last_used = existing.last_used.max(*last_used),
                        None => projects.push(RecentProject { path: cwd, last_used: *last_used }),
                    }
                }
                break;
            }
        }
    }
    projects.sort_by(|a, b| b.last_used.cmp(&a.last_used));
    projects.truncate(limit);
    projects
}

/// True when Claude Code has a saved transcript for this session id (so `--resume` will work).
pub fn session_exists(session_id: &str) -> bool {
    let Some(root) = claude_projects_dir() else { return false };
    let file_name = format!("{session_id}.jsonl");
    std::fs::read_dir(root)
        .into_iter()
        .flatten()
        .flatten()
        .any(|dir| dir.path().join(&file_name).is_file())
}
