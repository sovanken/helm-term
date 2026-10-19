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
const MAX_READ: u64 = 64 * 1024 * 1024;
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

fn for_each_line(path: &Path, mut f: impl FnMut(Value)) {
    let Ok(file) = File::open(path) else { return };
    let mut read = 0u64;
    for line in BufReader::new(file).lines() {
        let Ok(line) = line else { break };
        read += line.len() as u64 + 1;
        if read > MAX_READ {
            break;
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
                if crate::sessions::human_prompt(&v).is_some() {
                    r.prompts += 1;
                    first_prompt_len.get_or_insert_with(|| human_text_len(&v));
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
                            let name = if name.starts_with("mcp__") { "MCP tools" } else { name };
                            *tools.entry(name.to_string()).or_default() += 1;
                            r.tool_calls += 1;
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
}

/// One transcript's contribution, per local day.
#[derive(Clone, Default)]
struct FileTotals {
    cwd: String,
    days: HashMap<String, DayTotals>,
    /// day → model → (tokens, cost)
    models: HashMap<String, HashMap<String, (u64, f64)>>,
}

fn file_totals(path: &Path, offset_min: i64) -> FileTotals {
    let mut f = FileTotals::default();
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
        if !model.is_empty() && !model.starts_with('<') {
            f.models.entry(day).or_default().entry(model.clone()).or_default().0 += n("input_tokens") + n("output_tokens") + n("cache_creation_input_tokens");
        }
    }
    for d in f.days.values_mut() {
        d.sessions = 1;
    }
    f
}

#[derive(Default)]
pub struct TotalsCache(Mutex<HashMap<PathBuf, (u64, u64, i64, FileTotals)>>);

pub fn totals(cache: &TotalsCache, days: u32, offset_min: i64) -> UsageTotals {
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0);
    let since_ms = now - i64::from(days) * 86_400_000;
    let first_day = local_day(since_ms + 86_400_000, offset_min);
    let mut all: Vec<FileTotals> = vec![];
    for path in crate::sessions::transcript_paths() {
        let Ok(meta) = std::fs::metadata(&path) else { continue };
        let mtime = meta.modified().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_millis() as i64).unwrap_or(0);
        if mtime < since_ms {
            continue;
        }
        let key = (mtime as u64, meta.len());
        let cached = cache.0.lock().unwrap().get(&path).filter(|c| (c.0, c.1) == key && c.2 == offset_min).map(|c| c.3.clone());
        let t = cached.unwrap_or_else(|| {
            let t = file_totals(&path, offset_min);
            cache.0.lock().unwrap().insert(path.clone(), (key.0, key.1, offset_min, t.clone()));
            t
        });
        all.push(t);
    }

    let mut days_map: HashMap<String, DayTotals> = HashMap::new();
    let mut projects: HashMap<String, GroupTotals> = HashMap::new();
    let mut models: HashMap<String, GroupTotals> = HashMap::new();
    for f in &all {
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
            let p = projects.entry(f.cwd.clone()).or_insert_with(|| GroupTotals { key: f.cwd.clone(), ..Default::default() });
            p.tokens += d.input_tokens + d.output_tokens + d.cache_write_tokens;
            p.cost_usd += d.cost_usd;
            if !counted_project && d.replies > 0 {
                p.sessions += 1;
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
    UsageTotals { days, by_project: sort(projects), by_model: sort(models) }
}
