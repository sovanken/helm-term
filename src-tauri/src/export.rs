//! Turns a Claude Code transcript into a readable Markdown document.

use std::io::{BufRead, BufReader};
use std::path::Path;

use serde_json::Value;

fn text_parts(content: &Value) -> Vec<String> {
    match content {
        Value::String(s) => vec![s.clone()],
        Value::Array(parts) => parts
            .iter()
            .filter(|p| p.get("type").and_then(Value::as_str) == Some("text"))
            .filter_map(|p| p.get("text").and_then(Value::as_str).map(String::from))
            .collect(),
        _ => vec![],
    }
}

/// One-line summary of a tool call, e.g. "Bash: `npm test`" or "Edit: src/app.ts".
fn tool_summary(part: &Value) -> Option<String> {
    let name = part.get("name")?.as_str()?;
    let input = part.get("input");
    let field = |k: &str| input.and_then(|i| i.get(k)).and_then(Value::as_str);
    let detail = field("command")
        .map(|c| format!("`{}`", c.lines().next().unwrap_or("").chars().take(160).collect::<String>()))
        .or_else(|| field("file_path").map(String::from))
        .or_else(|| field("pattern").map(|p| format!("`{p}`")))
        .or_else(|| field("url").map(String::from))
        .or_else(|| field("description").map(String::from))
        .unwrap_or_default();
    Some(if detail.is_empty() { name.to_string() } else { format!("{name}: {detail}") })
}

fn is_noise(text: &str) -> bool {
    let t = text.trim_start();
    ["<command-", "<local-command", "<task-notification", "<system-reminder", "Caveat:"]
        .iter()
        .any(|n| t.starts_with(n))
}

pub fn to_markdown(path: &Path, include_tools: bool) -> Result<String, String> {
    let file = std::fs::File::open(path).map_err(|e| e.to_string())?;
    let mut title = None;
    let mut cwd = None;
    let mut started = None;
    let mut body = String::new();
    let mut last_role = "";
    let mut tools: Vec<String> = Vec::new();

    let flush_tools = |body: &mut String, tools: &mut Vec<String>| {
        if !tools.is_empty() {
            body.push_str("\n<details><summary>Tools used (");
            body.push_str(&tools.len().to_string());
            body.push_str(")</summary>\n\n");
            for t in tools.drain(..) {
                body.push_str(&format!("- {t}\n"));
            }
            body.push_str("\n</details>\n");
        }
    };

    for line in BufReader::new(file).lines().map_while(Result::ok) {
        let Ok(v) = serde_json::from_str::<Value>(&line) else { continue };
        if v.get("isSidechain").and_then(Value::as_bool) == Some(true) {
            continue;
        }
        cwd = cwd.or_else(|| v.get("cwd").and_then(Value::as_str).map(String::from));
        started = started.or_else(|| v.get("timestamp").and_then(Value::as_str).map(String::from));
        match v.get("type").and_then(Value::as_str) {
            Some("ai-title") => title = v.get("aiTitle").and_then(Value::as_str).map(String::from).or(title),
            Some("user") if v.get("isMeta").and_then(Value::as_bool) != Some(true) => {
                let Some(content) = v.get("message").and_then(|m| m.get("content")) else { continue };
                let texts: Vec<String> = text_parts(content).into_iter().filter(|t| !t.trim().is_empty() && !is_noise(t)).collect();
                if texts.is_empty() {
                    continue; // tool results
                }
                flush_tools(&mut body, &mut tools);
                body.push_str("\n---\n\n### You\n\n");
                body.push_str(&texts.join("\n\n"));
                body.push('\n');
                last_role = "user";
            }
            Some("assistant") => {
                let Some(content) = v.get("message").and_then(|m| m.get("content")) else { continue };
                for part in content.as_array().into_iter().flatten() {
                    match part.get("type").and_then(Value::as_str) {
                        Some("text") => {
                            let text = part.get("text").and_then(Value::as_str).unwrap_or("").trim();
                            if text.is_empty() {
                                continue;
                            }
                            flush_tools(&mut body, &mut tools);
                            if last_role != "assistant" {
                                body.push_str("\n### Claude\n\n");
                            } else {
                                body.push('\n');
                            }
                            body.push_str(text);
                            body.push('\n');
                            last_role = "assistant";
                        }
                        Some("tool_use") if include_tools => {
                            if last_role != "assistant" {
                                body.push_str("\n### Claude\n");
                                last_role = "assistant";
                            }
                            tools.extend(tool_summary(part));
                        }
                        _ => {}
                    }
                }
            }
            _ => {}
        }
    }
    flush_tools(&mut body, &mut tools);

    let mut out = format!("# {}\n\n", title.as_deref().unwrap_or("Claude Code conversation"));
    if let Some(c) = cwd {
        out.push_str(&format!("- **Project:** `{c}`\n"));
    }
    if let Some(s) = started {
        out.push_str(&format!("- **Started:** {}\n", s.replace('T', " ").trim_end_matches('Z').split('.').next().unwrap_or(&s)));
    }
    out.push_str(&format!(
        "- **Session:** `{}`\n",
        path.file_stem().unwrap_or_default().to_string_lossy()
    ));
    out.push_str("\n_Exported with Helm._\n");
    out.push_str(&body);
    Ok(out)
}
