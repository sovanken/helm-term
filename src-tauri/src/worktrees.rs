//! Parallel tasks: git worktrees of a repository. Claude Code creates them (`claude --worktree`);
//! Helm lists, merges and removes them with plain git.

use std::path::Path;

use serde::Serialize;

use crate::git::hidden;

fn git(cwd: &str, args: &[&str]) -> Result<String, String> {
    let out = hidden("git")
        .args(["-c", "core.quotepath=off"])
        .args(args)
        .current_dir(cwd)
        .output()
        .map_err(|_| "Git is not installed or not on PATH".to_string())?;
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).into_owned())
    } else {
        let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
        let msg = if err.is_empty() { String::from_utf8_lossy(&out.stdout).trim().to_string() } else { err };
        Err(msg)
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Worktree {
    pub path: String,
    pub branch: Option<String>,
    pub is_main: bool,
    /// Files with uncommitted changes.
    pub dirty: u32,
    /// Commits on this branch that the main worktree's branch doesn't have.
    pub ahead: u32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeList {
    pub is_repo: bool,
    pub main_path: Option<String>,
    pub main_branch: Option<String>,
    pub worktrees: Vec<Worktree>,
}

fn normalize(p: &str) -> String {
    p.replace('/', "\\").trim_end_matches('\\').to_lowercase()
}

/// `git worktree list --porcelain` → (Windows path, branch) pairs, main worktree first.
/// Worktrees whose folder is gone ("prunable") are skipped.
pub(crate) fn parse_porcelain(porcelain: &str) -> Vec<(String, Option<String>)> {
    let mut raw = Vec::new();
    for block in porcelain.replace("\r\n", "\n").split("\n\n").filter(|b| !b.trim().is_empty()) {
        let mut path = None;
        let mut branch = None;
        let mut prunable = false;
        for line in block.lines() {
            if let Some(p) = line.strip_prefix("worktree ") {
                path = Some(p.replace('/', "\\"));
            } else if let Some(b) = line.strip_prefix("branch ") {
                branch = Some(b.trim_start_matches("refs/heads/").to_string());
            } else if line.starts_with("prunable") {
                prunable = true;
            }
        }
        if let (Some(path), false) = (path, prunable) {
            raw.push((path, branch));
        }
    }
    raw
}

pub fn list(cwd: &str) -> Result<WorktreeList, String> {
    let Ok(porcelain) = git(cwd, &["worktree", "list", "--porcelain"]) else {
        return Ok(WorktreeList { is_repo: false, main_path: None, main_branch: None, worktrees: vec![] });
    };

    let raw = parse_porcelain(&porcelain);
    let Some((main_path, main_branch)) = raw.first().cloned() else {
        return Ok(WorktreeList { is_repo: false, main_path: None, main_branch: None, worktrees: vec![] });
    };

    let worktrees = raw
        .iter()
        .enumerate()
        .map(|(i, (path, branch))| {
            let dirty = git(path, &["status", "--porcelain"]).map(|s| s.lines().count() as u32).unwrap_or(0);
            let ahead = match (i, branch, &main_branch) {
                (0, _, _) => 0,
                (_, Some(b), Some(m)) => git(&main_path, &["rev-list", "--count", &format!("{m}..{b}")])
                    .ok()
                    .and_then(|s| s.trim().parse().ok())
                    .unwrap_or(0),
                _ => 0,
            };
            Worktree { path: path.clone(), branch: branch.clone(), is_main: i == 0, dirty, ahead }
        })
        .collect();

    Ok(WorktreeList { is_repo: true, main_path: Some(main_path), main_branch, worktrees })
}

/// Merges a task branch into the main worktree's current branch. Conflicts are aborted cleanly.
pub fn merge(main_path: &str, branch: &str) -> Result<String, String> {
    if branch.starts_with('-') {
        return Err("Invalid branch".into());
    }
    if git(main_path, &["status", "--porcelain", "--untracked-files=no"])?.trim().len() > 0 {
        return Err("The main folder has uncommitted changes. Commit or undo them first, then merge.".into());
    }
    match git(main_path, &["merge", "--no-ff", "--no-edit", branch]) {
        Ok(out) => Ok(out.lines().last().unwrap_or("Merged").to_string()),
        Err(err) => {
            let _ = git(main_path, &["merge", "--abort"]);
            Err(if err.contains("CONFLICT") || err.contains("conflict") {
                "These changes conflict with the main branch, so nothing was merged. Ask Claude in the task to merge the main branch in and resolve the conflicts, then try again.".into()
            } else {
                err
            })
        }
    }
}

pub fn remove(main_path: &str, path: &str, branch: Option<&str>, force: bool, delete_branch: bool) -> Result<(), String> {
    if normalize(path) == normalize(main_path) {
        return Err("The main folder can't be removed".into());
    }
    let mut args = vec!["worktree", "remove"];
    if force {
        args.push("--force");
    }
    args.push(path);
    git(main_path, &args)?;
    if delete_branch {
        if let Some(b) = branch.filter(|b| !b.starts_with('-')) {
            git(main_path, &["branch", "-D", b])?;
        }
    }
    // Claude Code may leave an empty parent folder behind.
    if let Some(parent) = Path::new(path).parent() {
        let _ = std::fs::remove_dir(parent);
    }
    Ok(())
}
