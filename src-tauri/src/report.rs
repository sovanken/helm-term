//! Usage reports from Claude Code transcripts: one session in detail (tokens, turns, tools, a
//! context estimate, and the exact `/context` breakdown when it has been run), and totals across
//! recent sessions by day, project and model.

use std::collections::{HashMap, HashSet};
use std::fs::File;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::Serialize;
use serde_json::Value;

/// Transcripts bigger than this are only partly read (keeps the page fast on huge sessions).
/// A safety stop for absurdly large files; real conversations reach a few hundred MB.
const MAX_READ: u64 = 4 * 1024 * 1024 * 1024;
/// Tool results longer than this are only skimmed for their time (their text never affects a report).
const SKIM_ABOVE: usize = 8 * 1024;
/// Gaps longer than this between messages don't count as time working.
const IDLE_GAP_MS: i64 = 5 * 60 * 1000;

// ---------- small helpers ----------

/// "2026-10-19T10:14:23.192Z" → Unix milliseconds (UTC). No date crate needed.
pub fn parse_ts(s: &str) -> Option<i64> {
    let b = s.as_bytes();
    if b.len() < 19 {
        return None;
    }
    let num = |a: usize, n: usize| s.get(a..a + n)?.parse::<i64>().ok();
    let (y, mo, d) = (num(0, 4)?, num(5, 2)?, num(8, 2)?);
    let (h, mi, se) = (num(11, 2)?, num(14, 2)?, num(17, 2)?);
    let ms = if b.get(19) == Some(&b'.') {
        let frac: String = s[20..].chars().take_while(char::is_ascii_digit).take(3).collect();
        format!("{frac:0<3}").parse::<i64>().unwrap_or(0)
    } else {
        0
    };
    // Days from civil (Howard Hinnant's algorithm).
    let (y2, m2) = if mo <= 2 { (y - 1, mo + 9) } else { (y, mo - 3) };
    let era = y2.div_euclid(400);
    let yoe = y2 - era * 400;
    let doy = (153 * m2 + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146_097 + doe - 719_468;
    Some(((days * 24 + h) * 60 + mi) * 60_000 + se * 1000 + ms)
}

/// Unix ms → local "YYYY-MM-DD", given the local offset from UTC in minutes (east positive).
pub fn local_day(ms: i64, offset_min: i64) -> String {
    let days = (ms + offset_min * 60_000).div_euclid(86_400_000);
    // Civil from days.
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + i64::from(m <= 2);
    format!("{y:04}-{m:02}-{d:02}")
}

fn strip_ansi(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\u{1b}' {
            if chars.peek() == Some(&'[') {
                chars.next();
                for c in chars.by_ref() {
                    if ('@'..='~').contains(&c) {
                        break;
                    }
                }
            }
            continue;
        }
        out.push(c);
    }
    out
}

/// "2.9k" → 2900, "1m" → 1_000_000, "695" → 695.
fn parse_amount(num: &str, unit: &str) -> Option<u64> {
    let n: f64 = num.parse().ok()?;
    let mult = match unit.to_ascii_lowercase().as_str() {
        "k" => 1_000.0,
        "m" => 1_000_000.0,
        _ => 1.0,
    };
    Some((n * mult).round() as u64)
}

/// The string value of `"key":"…"` in a JSON line, without parsing the line.
fn quick_field<'a>(line: &'a str, key: &str) -> Option<&'a str> {
    let pat = format!("\"{key}\":\"");
    let start = line.find(&pat)? + pat.len();
    let end = line[start..].find('"')?;
    Some(&line[start..start + end])
}

/// Calls `f` for each JSON line. A big tool result (most of a long conversation's size: file
/// contents, command output) is only skimmed: `f` gets its type, time and side-chain flag, which
/// is all any report uses from it, so huge conversations are read quickly and in full.
fn for_each_line(path: &Path, mut f: impl FnMut(Value)) {
    let Ok(file) = File::open(path) else { return };
    let mut read = 0u64;
    for line in BufReader::new(file).lines() {
        let Ok(line) = line else { break };
        read += line.len() as u64 + 1;
        if read > MAX_READ {
            break;
        }
        if line.len() > SKIM_ABOVE && line.contains("\"tool_result\"") && quick_field(&line, "type") == Some("user") {
            let mut v = serde_json::json!({ "type": "user", "isSidechain": line.contains("\"isSidechain\":true") });
            if let Some(ts) = quick_field(&line, "timestamp") {
                v["timestamp"] = Value::String(ts.to_string());
            }
            if let Some(cwd) = quick_field(&line, "cwd") {
                v["cwd"] = Value::String(cwd.replace("\\\\", "\\"));
            }
            f(v);
            continue;
        }
        if let Ok(v) = serde_json::from_str::<Value>(&line) {
            f(v);
        }
    }
}

// ---------- exact /context ----------

#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct ContextItem {
    pub label: String,
    pub tokens: u64,
    pub pct: f64,
}

#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct ExactContext {
    /// When /context was run (Unix ms).
    pub at: i64,
    pub used: u64,
    pub window: u64,
    pub items: Vec<ContextItem>,
}

/// Reads the category lines of Claude Code's `/context` output.
pub fn parse_context_output(raw: &str, at: i64) -> Option<ExactContext> {
    let text = strip_ansi(raw);
    let mut out = ExactContext { at, ..Default::default() };
    for line in text.lines() {
        // Totals line: "52.3k/1m tokens (5%)".
        if let Some(pos) = line.find(" tokens (") {
            let head = line[..pos].trim();
            if let Some((used, window)) = head.rsplit(' ').next().and_then(|t| t.split_once('/')) {
                let split = |t: &str| {
                    let i = t.find(|c: char| c.is_ascii_alphabetic()).unwrap_or(t.len());
                    parse_amount(&t[..i], &t[i..])
                };
                if let (Some(u), Some(w)) = (split(used), split(window)) {
                    out.used = u;
                    out.window = w;
                    continue;
                }
            }
        }
        // Category lines: "System prompt: 2.9k tokens (0.3%)", "Free space: 914.7k (91.5%)".
        let Some((label, rest)) = line.split_once(": ") else { continue };
        let label = label.trim_start_matches(|c: char| !c.is_ascii_alphabetic()).trim();
        if label.is_empty() || label.len() > 40 || !rest.contains('%') {
            continue;
        }
        let rest = rest.trim();
        let num_end = rest.find(|c: char| !(c.is_ascii_digit() || c == '.')).unwrap_or(rest.len());
        let unit_end = rest[num_end..].find(|c: char| !c.is_ascii_alphabetic()).map_or(rest.len(), |i| num_end + i);
        let unit = &rest[num_end..unit_end];
        let unit = if unit.eq_ignore_ascii_case("k") || unit.eq_ignore_ascii_case("m") { unit } else { "" };
        let Some(tokens) = parse_amount(&rest[..num_end], unit) else { continue };
        let pct = rest
            .rsplit_once('(')
            .and_then(|(_, p)| p.split('%').next())
            .and_then(|p| p.trim().parse::<f64>().ok())
            .unwrap_or(0.0);
        out.items.push(ContextItem { label: label.to_string(), tokens, pct });
    }
    (!out.items.is_empty()).then_some(out)
}

// ---------- one session ----------

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct TurnPoint {
    pub t: i64,
    pub context: u64,
    pub output: u64,
}

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Count {
    pub name: String,
    pub count: u32,
}

/// One step of a conversation for the timeline: a prompt you sent, a tool Claude used, or a compaction.
#[derive(Serialize, Default, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TimelineEvent {
    pub t: i64,
    /// "prompt", "tool" or "compact".
    pub kind: String,
    pub text: String,
    /// Tool name for "tool" events (Edit, Bash, Read, …).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool: Option<String>,
    /// File the tool worked on, if any.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
}

/// A file Claude changed in this conversation, with lines added and removed by its edits.
#[derive(Serialize, Default, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FileChange {
    pub path: String,
    pub added: u64,
    pub removed: u64,
    pub edits: u32,
    /// Written from scratch with Write (often a new file).
    pub created: bool,
}

const TIMELINE_MAX: usize = 800;

fn lines_in(s: &str) -> u64 {
    if s.is_empty() {
        0
    } else {
        s.lines().count() as u64
    }
}

/// One-line description of a tool call and the file it touched.
fn tool_event(p: &Value) -> (String, Option<String>) {
    let name = p.get("name").and_then(Value::as_str).unwrap_or("tool");
    let input = p.get("input");
    let field = |k: &str| input.and_then(|i| i.get(k)).and_then(Value::as_str);
    let path = field("file_path").or_else(|| field("notebook_path")).map(String::from);
    let first = |s: &str| s.lines().next().unwrap_or("").chars().take(140).collect::<String>();
    let text = match name {
        "Bash" | "PowerShell" => field("description").map(String::from).or_else(|| field("command").map(first)).unwrap_or_default(),
        "Grep" | "Glob" => field("pattern").map(|x| format!("“{x}”")).unwrap_or_default(),
        "WebFetch" => field("url").map(String::from).unwrap_or_default(),
        "WebSearch" => field("query").map(|q| format!("“{q}”")).unwrap_or_default(),
        "Agent" | "Task" => field("description").map(String::from).unwrap_or_default(),
        "TodoWrite" => "Updated the to-do list".into(),
        _ => path.clone().or_else(|| field("description").map(String::from)).unwrap_or_default(),
    };
    (text, path)
}

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SessionReport {
    pub prompts: u32,
    pub replies: u32,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cache_read_tokens: u64,
    pub cache_write_tokens: u64,
    pub context_tokens: u64,
    pub context_window: u64,
    /// Estimated fixed cost of every request: system prompt, tools, memory, skills.
    pub setup_tokens: Option<u64>,
    pub series: Vec<TurnPoint>,
    pub tools: Vec<Count>,
    pub tool_calls: u32,
    pub models: Vec<String>,
    pub started: Option<i64>,
    pub last: Option<i64>,
    pub active_ms: i64,
    pub compactions: u32,
    pub cost_usd: Option<f64>,
    pub lines_added: Option<u64>,
    pub lines_removed: Option<u64>,
    pub exact: Option<ExactContext>,
    /// Newest last; the most recent steps only for very long conversations.
    pub timeline: Vec<TimelineEvent>,
    pub files: Vec<FileChange>,
}

fn human_text_len(v: &Value) -> usize {
    match v.pointer("/message/content") {
        Some(Value::String(s)) => s.len(),
        Some(Value::Array(parts)) => parts.iter().filter_map(|p| p.get("text").and_then(Value::as_str)).map(str::len).sum(),
        _ => 0,
    }
}

pub fn session(path: &Path) -> SessionReport {
    let mut r = SessionReport::default();
    // Assistant messages arrive as several lines sharing one id; keep each id's final usage.
    let mut order: Vec<String> = vec![];
    let mut usage: HashMap<String, (i64, Value)> = HashMap::new();
    let mut tools: HashMap<String, u32> = HashMap::new();
    let mut models: Vec<String> = vec![];
    let mut first_prompt_len: Option<usize> = None;
    let mut last_t: Option<i64> = None;
    let mut one_m = false;
    let mut files: Vec<FileChange> = vec![];
    let mut file_change = |path: &str, added: u64, removed: u64, created: bool| {
        let i = files.iter().position(|f| f.path.eq_ignore_ascii_case(path)).unwrap_or_else(|| {
            files.push(FileChange { path: path.to_string(), ..Default::default() });
            files.len() - 1
        });
        let f = &mut files[i];
        f.added += added;
        f.removed += removed;
        f.edits += 1;
        f.created |= created;
    };

    for_each_line(path, |v| {
        let ts = v.get("timestamp").and_then(Value::as_str).and_then(parse_ts);
        if let Some(t) = ts {
            r.started.get_or_insert(t);
            if let Some(prev) = last_t {
                let gap = t - prev;
                if (0..=IDLE_GAP_MS).contains(&gap) {
                    r.active_ms += gap;
                }
            }
            last_t = Some(t);
            r.last = Some(t);
        }
        let sidechain = v.get("isSidechain").and_then(Value::as_bool) == Some(true);
        match v.get("type").and_then(Value::as_str) {
            Some("user") if !sidechain => {
                // The summary Claude writes after compacting arrives as a user message; it isn't one.
                let summary = v.get("isCompactSummary").and_then(Value::as_bool) == Some(true);
                if let Some(text) = crate::sessions::human_prompt(&v).filter(|_| !summary) {
                    r.prompts += 1;
                    first_prompt_len.get_or_insert_with(|| human_text_len(&v));
                    let text: String = text.split_whitespace().collect::<Vec<_>>().join(" ").chars().take(240).collect();
                    r.timeline.push(TimelineEvent { t: ts.unwrap_or(0), kind: "prompt".into(), text, ..Default::default() });
                }
            }
            Some("assistant") if !sidechain => {
                let msg = &v["message"];
                if let Some(model) = msg.get("model").and_then(Value::as_str).filter(|m| !m.starts_with('<')) {
                    if !models.iter().any(|m| m == model) {
                        models.push(model.to_string());
                    }
                }
                if let Some(parts) = msg.get("content").and_then(Value::as_array) {
                    for p in parts {
                        if p.get("type").and_then(Value::as_str) == Some("tool_use") {
                            let name = p.get("name").and_then(Value::as_str).unwrap_or("tool");
                            let short = if name.starts_with("mcp__") { "MCP tools" } else { name };
                            *tools.entry(short.to_string()).or_default() += 1;
                            r.tool_calls += 1;
                            let (text, path) = tool_event(p);
                            r.timeline.push(TimelineEvent { t: ts.unwrap_or(0), kind: "tool".into(), text, tool: Some(short.to_string()), path: path.clone() });
                            let input = p.get("input");
                            let s = |k: &str| input.and_then(|i| i.get(k)).and_then(Value::as_str).unwrap_or("");
                            if let Some(path) = path {
                                match name {
                                    "Edit" => file_change(&path, lines_in(s("new_string")), lines_in(s("old_string")), false),
                                    "MultiEdit" => {
                                        let edits = input.and_then(|i| i.get("edits")).and_then(Value::as_array).cloned().unwrap_or_default();
                                        let get = |e: &Value, k: &str| e.get(k).and_then(Value::as_str).map(lines_in).unwrap_or(0);
                                        file_change(&path, edits.iter().map(|e| get(e, "new_string")).sum(), edits.iter().map(|e| get(e, "old_string")).sum(), false)
                                    }
                                    "Write" => file_change(&path, lines_in(s("content")), 0, true),
                                    "NotebookEdit" => file_change(&path, lines_in(s("new_source")), 0, false),
                                    _ => {}
                                }
                            }
                        }
                    }
                }
                if let (Some(id), Some(u)) = (msg.get("id").and_then(Value::as_str), msg.get("usage")) {
                    if !usage.contains_key(id) {
                        order.push(id.to_string());
                    }
                    usage.insert(id.to_string(), (ts.unwrap_or(0), u.clone()));
                }
            }
            Some("cost-state") => {
                r.cost_usd = v.get("totalCostUSD").and_then(Value::as_f64);
                r.lines_added = v.get("totalLinesAdded").and_then(Value::as_u64);
                r.lines_removed = v.get("totalLinesRemoved").and_then(Value::as_u64);
                if let Some(mu) = v.get("modelUsage").and_then(Value::as_object) {
                    one_m |= mu.keys().any(|k| k.contains("[1m]"));
                }
            }
            Some("system") => {
                if v.get("subtype").and_then(Value::as_str) == Some("compact_boundary") {
                    r.compactions += 1;
                    r.timeline.push(TimelineEvent { t: ts.unwrap_or(0), kind: "compact".into(), text: "The conversation was compacted to free up context".into(), ..Default::default() });
                }
                if v.pointer("/commandRun/command").and_then(Value::as_str) == Some("context") {
                    if let Some(raw) = v.get("content").and_then(Value::as_str) {
                        if let Some(exact) = parse_context_output(raw, ts.unwrap_or(0)) {
                            r.exact = Some(exact);
                        }
                    }
                }
            }
            _ => {}
        }
    });

    for id in &order {
        let (t, u) = &usage[id];
        let n = |k: &str| u.get(k).and_then(Value::as_u64).unwrap_or(0);
        let (input, read, write, output) = (n("input_tokens"), n("cache_read_input_tokens"), n("cache_creation_input_tokens"), n("output_tokens"));
        r.input_tokens += input;
        r.cache_read_tokens += read;
        r.cache_write_tokens += write;
        r.output_tokens += output;
        let context = input + read + write;
        if context > 0 {
            if r.setup_tokens.is_none() {
                // The first request is Claude's setup plus your first message (~4 characters a token).
                let prompt = first_prompt_len.unwrap_or(0) as u64 / 4;
                r.setup_tokens = Some(context.saturating_sub(prompt));
            }
            r.series.push(TurnPoint { t: *t, context, output });
            r.context_tokens = context + output;
        }
    }
    r.replies = order.len() as u32;
    let mut tools: Vec<Count> = tools.into_iter().map(|(name, count)| Count { name, count }).collect();
    tools.sort_by(|a, b| b.count.cmp(&a.count).then(a.name.cmp(&b.name)));
    tools.truncate(8);
    r.tools = tools;
    one_m |= models.iter().any(|m| m.contains("[1m]")) || r.context_tokens > 200_000;
    r.context_window = r.exact.as_ref().map(|e| e.window).filter(|w| *w > 0).unwrap_or(if one_m { 1_000_000 } else { 200_000 });
    r.models = models;
    if r.timeline.len() > TIMELINE_MAX {
        r.timeline.drain(..r.timeline.len() - TIMELINE_MAX);
    }
    r.files = files;
    r
}

// ---------- totals across sessions ----------

#[derive(Serialize, Default, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DayTotals {
    pub day: String,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cache_read_tokens: u64,
    pub cache_write_tokens: u64,
    pub cost_usd: f64,
    pub lines_added: u64,
    pub lines_removed: u64,
    pub active_ms: i64,
    pub sessions: u32,
    pub replies: u32,
}

#[derive(Serialize, Default, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GroupTotals {
    pub key: String,
    pub tokens: u64,
    pub cost_usd: f64,
    pub sessions: u32,
}

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct UsageTotals {
    pub days: Vec<DayTotals>,
    /// Totals over the whole period, by project folder (cwd) and by model.
    pub by_project: Vec<GroupTotals>,
    pub by_model: Vec<GroupTotals>,
    /// Replies per local hour of the day (0–23) over the period: when you work with Claude.
    pub hours: Vec<u32>,
    /// Replies per 15 minutes today (96 slots from midnight): when Claude worked today.
    pub today: Vec<u32>,
}

/// The project a file belongs to: the nearest folder above it with a `.git`, or None.
fn git_root(file: &Path, cache: &mut HashMap<PathBuf, Option<PathBuf>>) -> Option<PathBuf> {
    let mut dir = file.parent()?.to_path_buf();
    let mut visited = vec![];
    let found = loop {
        if let Some(hit) = cache.get(&dir) {
            break hit.clone();
        }
        visited.push(dir.clone());
        if dir.join(".git").exists() {
            break Some(dir.clone());
        }
        match dir.parent() {
            Some(up) => dir = up.to_path_buf(),
            None => break None,
        }
    };
    for v in visited {
        cache.insert(v, found.clone());
    }
    found
}

/// For a file outside any git repo but inside the folder Claude ran in: the folder directly under
/// it ("C:\Users\you\site\index.html" → "C:\Users\you\site"), unless that's a hidden or
/// app-data folder rather than a project.
fn top_folder(file: &Path, cwd: &str) -> Option<String> {
    // Folders that hold projects rather than being one: look one level further in.
    const CONTAINERS: &[&str] = &["desktop", "documents", "downloads", "source", "repos", "projects", "dev", "code", "work", "github"];
    let rest = file.strip_prefix(Path::new(cwd)).ok()?;
    let parts: Vec<String> = rest.components().map(|c| c.as_os_str().to_string_lossy().into_owned()).collect();
    let mut depth = 0;
    while depth + 1 < parts.len() {
        let name = parts[depth].to_lowercase();
        if name.starts_with('.') || name == "appdata" {
            return None;
        }
        if !(CONTAINERS.contains(&name.as_str()) || name.starts_with("onedrive")) {
            break;
        }
        depth += 1;
    }
    // The file itself, directly in cwd or a container: no project folder.
    if depth + 1 >= parts.len() {
        return None;
    }
    Some(parts[..=depth].iter().fold(PathBuf::from(cwd), |p, c| p.join(c)).to_string_lossy().into_owned())
}

/// Which projects a conversation worked on, as shares that add up to 1: by the git folders of the
/// files Claude edited (or, if it edited nothing, read), so a chat started in your home folder
/// counts toward the projects it actually changed. Nothing edited or read: the folder it ran in.
pub fn project_shares(cwd: &str, files: &[String], cache: &mut HashMap<PathBuf, Option<PathBuf>>) -> Vec<(String, f64)> {
    // Counted case-insensitively (Windows paths), shown as first seen; "/" and "\\" alike.
    let mut counts: HashMap<String, (String, f64)> = HashMap::new();
    for f in files {
        let path = PathBuf::from(f.replace('/', "\\"));
        // Temp files, app data and dot-folders (.claude memory, settings) aren't project work.
        // Judged below the folder the chat ran in (that folder may itself live in Temp).
        let below = path.strip_prefix(Path::new(cwd)).map(Path::to_path_buf).unwrap_or_else(|_| path.clone());
        let lower = format!("\\{}", below.to_string_lossy().to_lowercase());
        let dotted = below.components().any(|c| {
            let n = c.as_os_str().to_string_lossy();
            n.starts_with('.') && n != "." && n != ".."
        });
        if lower.contains("\\appdata\\") || lower.contains("\\temp\\") || dotted {
            continue;
        }
        let key = git_root(&path, cache).map(|p| p.to_string_lossy().into_owned()).or_else(|| top_folder(&path, cwd)).unwrap_or_else(|| cwd.to_string());
        counts.entry(key.to_lowercase()).or_insert_with(|| (key, 0.0)).1 += 1.0;
    }
    if counts.is_empty() {
        return vec![(cwd.to_string(), 1.0)];
    }
    let total: f64 = counts.values().map(|v| v.1).sum();
    let mut out: Vec<(String, f64)> = counts.into_values().map(|(k, n)| (k, n / total)).collect();
    out.sort_by(|a, b| b.1.total_cmp(&a.1));
    out
}

/// One transcript's contribution, per local day.
#[derive(Clone, Default)]
struct FileTotals {
    cwd: String,
    /// The projects this conversation worked on, with their share (see `project_shares`).
    projects: Vec<(String, f64)>,
    days: HashMap<String, DayTotals>,
    /// day → model → (tokens, cost)
    models: HashMap<String, HashMap<String, (u64, f64)>>,
    /// day → replies per 15-minute slot (96)
    slots: HashMap<String, Vec<u32>>,
}

fn file_totals(path: &Path, offset_min: i64, roots: &mut HashMap<PathBuf, Option<PathBuf>>) -> FileTotals {
    let mut f = FileTotals::default();
    let mut edited: Vec<String> = vec![];
    let mut read: Vec<String> = vec![];
    let mut seen: HashSet<String> = HashSet::new();
    let mut last_t: Option<i64> = None;
    let mut prev_cost: Option<(f64, u64, u64, HashMap<String, f64>)> = None;
    let mut usage: HashMap<String, (i64, String, Value)> = HashMap::new();
    let mut order: Vec<String> = vec![];

    for_each_line(path, |v| {
        if f.cwd.is_empty() {
            if let Some(cwd) = v.get("cwd").and_then(Value::as_str) {
                f.cwd = cwd.to_string();
            }
        }
        let ts = v.get("timestamp").and_then(Value::as_str).and_then(parse_ts);
        if let Some(t) = ts {
            let day = local_day(t, offset_min);
            let d = f.days.entry(day.clone()).or_insert_with(|| DayTotals { day, ..Default::default() });
            if let Some(prev) = last_t {
                if (0..=IDLE_GAP_MS).contains(&(t - prev)) {
                    d.active_ms += t - prev;
                }
            }
            last_t = Some(t);
        }
        match v.get("type").and_then(Value::as_str) {
            Some("assistant") => {
                let msg = &v["message"];
                for p in msg.get("content").and_then(Value::as_array).into_iter().flatten() {
                    if p.get("type").and_then(Value::as_str) != Some("tool_use") {
                        continue;
                    }
                    let file = p.pointer("/input/file_path").or_else(|| p.pointer("/input/notebook_path")).and_then(Value::as_str);
                    if let Some(file) = file {
                        match p.get("name").and_then(Value::as_str) {
                            Some("Edit" | "MultiEdit" | "Write" | "NotebookEdit") => edited.push(file.to_string()),
                            Some("Read") => read.push(file.to_string()),
                            _ => {}
                        }
                    }
                }
                if let (Some(id), Some(u)) = (msg.get("id").and_then(Value::as_str), msg.get("usage")) {
                    if seen.insert(id.to_string()) {
                        order.push(id.to_string());
                    }
                    let model = msg.get("model").and_then(Value::as_str).unwrap_or("").to_string();
                    usage.insert(id.to_string(), (ts.or(last_t).unwrap_or(0), model, u.clone()));
                }
            }
            Some("cost-state") => {
                // Cumulative per session: attribute the increase to the day it happened.
                let Some(t) = last_t else { return };
                let day = local_day(t, offset_min);
                let cost = v.get("totalCostUSD").and_then(Value::as_f64).unwrap_or(0.0);
                let added = v.get("totalLinesAdded").and_then(Value::as_u64).unwrap_or(0);
                let removed = v.get("totalLinesRemoved").and_then(Value::as_u64).unwrap_or(0);
                let per_model: HashMap<String, f64> = v
                    .get("modelUsage")
                    .and_then(Value::as_object)
                    .map(|m| m.iter().map(|(k, x)| (k.clone(), x.get("costUSD").and_then(Value::as_f64).unwrap_or(0.0))).collect())
                    .unwrap_or_default();
                let (pc, pa, pr, pm) = prev_cost.clone().unwrap_or_default();
                let d = f.days.entry(day.clone()).or_insert_with(|| DayTotals { day: day.clone(), ..Default::default() });
                // A lower total means a new process (resumed session); count it from zero.
                let base = |now: f64, before: f64| if now >= before { now - before } else { now };
                d.cost_usd += base(cost, pc);
                d.lines_added += if added >= pa { added - pa } else { added };
                d.lines_removed += if removed >= pr { removed - pr } else { removed };
                let dm = f.models.entry(day).or_default();
                for (m, c) in &per_model {
                    dm.entry(m.clone()).or_default().1 += base(*c, *pm.get(m).unwrap_or(&0.0));
                }
                prev_cost = Some((cost, added, removed, per_model));
            }
            _ => {}
        }
    });

    for id in &order {
        let (t, model, u) = &usage[id];
        let n = |k: &str| u.get(k).and_then(Value::as_u64).unwrap_or(0);
        let day = local_day(*t, offset_min);
        let d = f.days.entry(day.clone()).or_insert_with(|| DayTotals { day: day.clone(), ..Default::default() });
        d.input_tokens += n("input_tokens");
        d.output_tokens += n("output_tokens");
        d.cache_read_tokens += n("cache_read_input_tokens");
        d.cache_write_tokens += n("cache_creation_input_tokens");
        d.replies += 1;
        let local = t + offset_min * 60_000;
        let slot = (local.rem_euclid(86_400_000) / 900_000) as usize;
        f.slots.entry(day.clone()).or_insert_with(|| vec![0; 96])[slot.min(95)] += 1;
        if !model.is_empty() && !model.starts_with('<') {
            f.models.entry(day).or_default().entry(model.clone()).or_default().0 += n("input_tokens") + n("output_tokens") + n("cache_creation_input_tokens");
        }
    }
    for d in f.days.values_mut() {
        d.sessions = 1;
    }
    f.projects = project_shares(&f.cwd, if edited.is_empty() { &read } else { &edited }, roots);
    f
}

#[derive(Default)]
pub struct TotalsCache(Mutex<HashMap<PathBuf, (u64, u64, i64, FileTotals)>>);

pub fn totals(cache: &TotalsCache, days: u32, offset_min: i64) -> UsageTotals {
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0);
    let since_ms = now - i64::from(days) * 86_400_000;
    let first_day = local_day(since_ms + 86_400_000, offset_min);
    let mut all: Vec<FileTotals> = vec![];
    let mut roots: HashMap<PathBuf, Option<PathBuf>> = HashMap::new();
    for path in crate::sessions::transcript_paths() {
        let Ok(meta) = std::fs::metadata(&path) else { continue };
        let mtime = meta.modified().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_millis() as i64).unwrap_or(0);
        if mtime < since_ms {
            continue;
        }
        let key = (mtime as u64, meta.len());
        let cached = cache.0.lock().unwrap().get(&path).filter(|c| (c.0, c.1) == key && c.2 == offset_min).map(|c| c.3.clone());
        let t = cached.unwrap_or_else(|| {
            let t = file_totals(&path, offset_min, &mut roots);
            cache.0.lock().unwrap().insert(path.clone(), (key.0, key.1, offset_min, t.clone()));
            t
        });
        all.push(t);
    }

    let mut days_map: HashMap<String, DayTotals> = HashMap::new();
    let mut projects: HashMap<String, GroupTotals> = HashMap::new();
    let mut models: HashMap<String, GroupTotals> = HashMap::new();
    let mut hours = vec![0u32; 24];
    let mut today = vec![0u32; 96];
    let today_key = local_day(now, offset_min);
    for f in &all {
        for (day, slots) in &f.slots {
            if *day < first_day {
                continue;
            }
            for (i, n) in slots.iter().enumerate() {
                hours[i / 4] += n;
                if *day == today_key {
                    today[i] += n;
                }
            }
        }
        let mut counted_project = false;
        for (day, d) in &f.days {
            if *day < first_day {
                continue;
            }
            let e = days_map.entry(day.clone()).or_insert_with(|| DayTotals { day: day.clone(), ..Default::default() });
            e.input_tokens += d.input_tokens;
            e.output_tokens += d.output_tokens;
            e.cache_read_tokens += d.cache_read_tokens;
            e.cache_write_tokens += d.cache_write_tokens;
            e.cost_usd += d.cost_usd;
            e.lines_added += d.lines_added;
            e.lines_removed += d.lines_removed;
            e.active_ms += d.active_ms;
            e.replies += d.replies;
            if d.replies > 0 || d.cost_usd > 0.0 {
                e.sessions += 1;
            }
            // Split the day's cost and tokens over the projects the conversation worked on.
            for (key, share) in &f.projects {
                let p = projects.entry(key.clone()).or_insert_with(|| GroupTotals { key: key.clone(), ..Default::default() });
                p.tokens += ((d.input_tokens + d.output_tokens + d.cache_write_tokens) as f64 * share).round() as u64;
                p.cost_usd += d.cost_usd * share;
                if !counted_project && d.replies > 0 {
                    p.sessions += 1;
                }
            }
            if d.replies > 0 {
                counted_project = true;
            }
        }
        for (day, per) in &f.models {
            if *day < first_day {
                continue;
            }
            for (m, (tokens, cost)) in per {
                let name = m.trim_end_matches("[1m]").to_string();
                let g = models.entry(name.clone()).or_insert_with(|| GroupTotals { key: name, ..Default::default() });
                g.tokens += tokens;
                g.cost_usd += cost;
            }
        }
    }
    let mut days: Vec<DayTotals> = days_map.into_values().collect();
    days.sort_by(|a, b| a.day.cmp(&b.day));
    let sort = |m: HashMap<String, GroupTotals>| {
        let mut v: Vec<GroupTotals> = m.into_values().filter(|g| g.tokens > 0 || g.cost_usd > 0.0).collect();
        v.sort_by(|a, b| b.cost_usd.total_cmp(&a.cost_usd).then(b.tokens.cmp(&a.tokens)));
        v
    };
    UsageTotals { days, by_project: sort(projects), by_model: sort(models), hours, today }
}
