//! When background commands and agents finish: Claude Code writes a `<task-notification>` into the
//! transcript (with the tool call's id, how it ended and where its output went). Helm reads only
//! the part of the transcript that's new since the last look.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::Serialize;
use serde_json::Value;

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Finished {
    pub tool_use_id: String,
    /// "completed", "failed", "killed" (as Claude Code reports it).
    pub status: String,
    pub summary: Option<String>,
    pub output_file: Option<String>,
}

/// transcript → (bytes already read, finished tasks by tool-use id)
#[derive(Default)]
pub struct BgTaskCache(Mutex<HashMap<PathBuf, (u64, HashMap<String, Finished>)>>);

fn tag<'a>(text: &'a str, name: &str) -> Option<&'a str> {
    let open = format!("<{name}>");
    let close = format!("</{name}>");
    let start = text.find(&open)? + open.len();
    let end = text[start..].find(&close)? + start;
    Some(text[start..end].trim())
}

fn unescape(s: &str) -> String {
    s.replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", "\"").replace("&#39;", "'")
}

/// The finish notice in one transcript line, if it has one.
pub fn parse_notification(line: &Value) -> Option<Finished> {
    let text = match line.get("type").and_then(Value::as_str)? {
        "queue-operation" => line.get("content")?.as_str()?,
        "user" => line.pointer("/message/content")?.as_str()?,
        _ => return None,
    };
    if !text.trim_start().starts_with("<task-notification>") {
        return None;
    }
    Some(Finished {
        tool_use_id: tag(text, "tool-use-id")?.to_string(),
        status: tag(text, "status").unwrap_or("completed").to_string(),
        summary: tag(text, "summary").map(unescape),
        output_file: tag(text, "output-file").map(String::from),
    })
}

/// Every background task that has finished in this conversation so far.
pub fn finished(cache: &BgTaskCache, path: &Path) -> Vec<Finished> {
    let mut all = cache.0.lock().unwrap();
    let entry = all.entry(path.to_path_buf()).or_default();
    let Ok(mut file) = std::fs::File::open(path) else { return entry.1.values().cloned().collect() };
    let len = file.metadata().map(|m| m.len()).unwrap_or(0);
    if len < entry.0 {
        // The file was replaced: start over.
        *entry = (0, HashMap::new());
    }
    if file.seek(SeekFrom::Start(entry.0)).is_ok() {
        let mut reader = BufReader::new(file);
        let mut line = String::new();
        let mut pos = entry.0;
        loop {
            line.clear();
            match reader.read_line(&mut line) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    // A line still being written has no newline yet: read it again next time.
                    if !line.ends_with('\n') {
                        break;
                    }
                    pos += n as u64;
                    if line.contains("<task-notification>") {
                        if let Ok(v) = serde_json::from_str::<Value>(&line) {
                            if let Some(f) = parse_notification(&v) {
                                entry.1.insert(f.tool_use_id.clone(), f);
                            }
                        }
                    }
                }
            }
        }
        entry.0 = pos;
    }
    entry.1.values().cloned().collect()
}
