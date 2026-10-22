//! Project workspace tab: folder listing for the file tree, quick open, search in files, and
//! file operations (new folder, rename, delete to the Recycle Bin).

use std::path::{Path, PathBuf};

use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    name: String,
    path: String,
    is_dir: bool,
}

/// One folder's contents for the tree: folders first, then files, each A→Z (case-insensitive).
pub fn list_dir(dir: &Path) -> Result<Vec<Entry>, String> {
    let read = std::fs::read_dir(dir).map_err(|_| "This folder can't be opened.".to_string())?;
    let mut out: Vec<Entry> = read
        .flatten()
        .map(|e| {
            let path = e.path();
            // Follow links for the folder check, so linked folders expand like normal ones.
            let is_dir = path.is_dir();
            Entry { name: e.file_name().to_string_lossy().into_owned(), path: path.to_string_lossy().into_owned(), is_dir }
        })
        .collect();
    out.sort_by(|a, b| b.is_dir.cmp(&a.is_dir).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase())));
    Ok(out)
}

/// Walks the project the way git sees it: skips .git, node_modules and anything .gitignore lists.
fn walker(root: &Path) -> ignore::Walk {
    ignore::WalkBuilder::new(root)
        .hidden(false)
        .git_ignore(true)
        .git_global(false)
        .git_exclude(true)
        .require_git(false)
        .filter_entry(|e| !matches!(e.file_name().to_str(), Some(".git") | Some("node_modules")))
        .build()
}

/// Every file in the project (relative paths with backslashes), for quick open. Capped.
pub fn list_files(root: &Path, limit: usize) -> Vec<String> {
    walker(root)
        .flatten()
        .filter(|e| e.file_type().is_some_and(|t| t.is_file()))
        .filter_map(|e| e.path().strip_prefix(root).ok().map(|p| p.to_string_lossy().into_owned()))
        .take(limit)
        .collect()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchMatch {
    /// Relative to the project.
    path: String,
    line: usize,
    column: usize,
    text: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    matches: Vec<SearchMatch>,
    /// More matches exist than were returned.
    truncated: bool,
}

/// Finds text across the project's files (case-insensitive unless `case_sensitive`).
/// Skips binary files and files over 2 MB.
pub fn search(root: &Path, query: &str, case_sensitive: bool, limit: usize) -> SearchResult {
    let mut matches = Vec::new();
    if query.is_empty() {
        return SearchResult { matches, truncated: false };
    }
    let needle = if case_sensitive { query.to_string() } else { query.to_lowercase() };
    for entry in walker(root).flatten() {
        if !entry.file_type().is_some_and(|t| t.is_file()) || entry.metadata().map(|m| m.len() > 2 * 1024 * 1024).unwrap_or(true) {
            continue;
        }
        let Ok(bytes) = std::fs::read(entry.path()) else { continue };
        if bytes[..bytes.len().min(8192)].contains(&0) {
            continue;
        }
        let text = String::from_utf8_lossy(&bytes);
        let rel = entry.path().strip_prefix(root).map(|p| p.to_string_lossy().into_owned()).unwrap_or_default();
        for (i, line) in text.lines().enumerate() {
            let hay = if case_sensitive { line.to_string() } else { line.to_lowercase() };
            if let Some(at) = hay.find(&needle) {
                if matches.len() >= limit {
                    return SearchResult { matches, truncated: true };
                }
                // Column in characters, and a trimmed line around the match.
                let column = line[..at.min(line.len())].chars().count() + 1;
                let text: String = line.trim().chars().take(240).collect();
                matches.push(SearchMatch { path: rel.clone(), line: i + 1, column, text });
            }
        }
    }
    SearchResult { matches, truncated: false }
}

/// A single file or folder name: no separators, nothing Windows refuses.
pub fn valid_name(name: &str) -> bool {
    let n = name.trim();
    !n.is_empty() && n != "." && n != ".." && !n.ends_with(['.', ' ']) && !n.chars().any(|c| r#"<>:"/\|?*"#.contains(c) || c.is_control())
}

pub fn create_dir(parent: &Path, name: &str) -> Result<PathBuf, String> {
    if !valid_name(name) {
        return Err("That name can't be used for a folder.".into());
    }
    let path = parent.join(name.trim());
    if path.exists() {
        return Err("Something with that name already exists here.".into());
    }
    std::fs::create_dir(&path).map_err(|e| e.to_string())?;
    Ok(path)
}

/// Renames in place (same folder). Never replaces an existing file or folder.
pub fn rename(path: &Path, new_name: &str) -> Result<PathBuf, String> {
    if !valid_name(new_name) {
        return Err("That name can't be used.".into());
    }
    let target = path.parent().ok_or("Can't rename this")?.join(new_name.trim());
    // Changing only the letter case is allowed even though Windows sees the same name.
    let case_only = target.to_string_lossy().to_lowercase() == path.to_string_lossy().to_lowercase();
    if target.exists() && !case_only {
        return Err("Something with that name already exists here.".into());
    }
    std::fs::rename(path, &target).map_err(|e| e.to_string())?;
    Ok(target)
}

/// Moves a file or folder to the Recycle Bin (it can be restored from there).
pub fn trash(path: &Path) -> Result<(), String> {
    if !path.exists() {
        return Err("It's already gone.".into());
    }
    trash::delete(path).map_err(|e| e.to_string())
}
