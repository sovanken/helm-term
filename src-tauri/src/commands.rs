//! Discovers custom slash commands and skills for the command palette.

use std::path::Path;

use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SlashCommand {
    /// Text typed after the slash, e.g. "review" or "frontend:component".
    pub name: String,
    pub description: String,
    /// "command" or "skill"
    pub kind: String,
    /// "user" (~/.claude) or "project" (<cwd>/.claude)
    pub scope: String,
    /// True when the command expects arguments, so Helm types it without pressing Enter.
    pub takes_args: bool,
}

/// Pulls `key: value` from a markdown file's YAML frontmatter (single-line values only).
fn frontmatter(text: &str, key: &str) -> Option<String> {
    let body = text.strip_prefix("---")?;
    let end = body.find("\n---")?;
    body[..end].lines().find_map(|l| {
        let (k, v) = l.split_once(':')?;
        (k.trim() == key).then(|| v.trim().trim_matches(['"', '\'']).to_string())
    })
}

fn first_text_line(text: &str) -> String {
    let body = match text.strip_prefix("---").and_then(|b| b.find("\n---").map(|e| &b[e + 4..])) {
        Some(rest) => rest,
        None => text,
    };
    body.lines()
        .map(|l| l.trim().trim_start_matches('#').trim())
        .find(|l| !l.is_empty())
        .unwrap_or("")
        .chars()
        .take(120)
        .collect()
}

fn walk_commands(dir: &Path, prefix: &str, scope: &str, out: &mut Vec<SlashCommand>) {
    for entry in std::fs::read_dir(dir).into_iter().flatten().flatten() {
        let path = entry.path();
        let stem = path.file_stem().unwrap_or_default().to_string_lossy().into_owned();
        if path.is_dir() {
            walk_commands(&path, &format!("{prefix}{stem}:"), scope, out);
        } else if path.extension().is_some_and(|e| e == "md") {
            let text = std::fs::read_to_string(&path).unwrap_or_default();
            out.push(SlashCommand {
                name: format!("{prefix}{stem}"),
                description: frontmatter(&text, "description").unwrap_or_else(|| first_text_line(&text)),
                kind: "command".into(),
                scope: scope.into(),
                takes_args: text.contains("$ARGUMENTS") || text.contains("$1") || frontmatter(&text, "argument-hint").is_some(),
            });
        }
    }
}

fn skills(dir: &Path, scope: &str, out: &mut Vec<SlashCommand>) {
    for entry in std::fs::read_dir(dir).into_iter().flatten().flatten() {
        let file = entry.path().join("SKILL.md");
        let Ok(text) = std::fs::read_to_string(&file) else { continue };
        let name = frontmatter(&text, "name").unwrap_or_else(|| entry.file_name().to_string_lossy().into_owned());
        out.push(SlashCommand {
            name,
            description: frontmatter(&text, "description").unwrap_or_default().chars().take(160).collect(),
            kind: "skill".into(),
            scope: scope.into(),
            takes_args: true,
        });
    }
}

pub fn list(cwd: &str) -> Vec<SlashCommand> {
    let mut out = Vec::new();
    if let Some(home) = dirs::home_dir() {
        let claude = home.join(".claude");
        walk_commands(&claude.join("commands"), "", "user", &mut out);
        skills(&claude.join("skills"), "user", &mut out);
    }
    let project = Path::new(cwd).join(".claude");
    if project.is_dir() && Some(Path::new(cwd)) != dirs::home_dir().as_deref() {
        walk_commands(&project.join("commands"), "", "project", &mut out);
        skills(&project.join("skills"), "project", &mut out);
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    out.dedup_by(|a, b| a.name == b.name);
    out
}
