//! Git helpers for the changes panel and status bar. Everything shells out to `git`.

use std::path::{Component, Path};
use std::process::{Command, Output};

use serde::Serialize;

pub fn hidden(program: &str) -> Command {
    let mut cmd = Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    cmd
}

fn git(cwd: &str, args: &[&str]) -> Result<Output, String> {
    hidden("git")
        .args(["-c", "core.quotepath=off", "--no-optional-locks"])
        .args(args)
        .current_dir(cwd)
        .output()
        .map_err(|_| "Git is not installed or not on PATH".to_string())
}

fn git_ok(cwd: &str, args: &[&str]) -> Result<String, String> {
    let out = git(cwd, args)?;
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).into_owned())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
    }
}

/// The empty tree object, used as the base in a repository with no commits yet.
const EMPTY_TREE: &str = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

fn base(cwd: &str) -> &'static str {
    if git_ok(cwd, &["rev-parse", "--verify", "-q", "HEAD"]).is_ok() { "HEAD" } else { EMPTY_TREE }
}

pub fn branch(cwd: &str) -> Option<String> {
    let name = git_ok(cwd, &["rev-parse", "--abbrev-ref", "HEAD"]).ok()?.trim().to_string();
    if name == "HEAD" {
        // Detached: show the short commit instead.
        return git_ok(cwd, &["rev-parse", "--short", "HEAD"]).ok().map(|s| s.trim().to_string());
    }
    (!name.is_empty()).then_some(name)
}

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct GitSummary {
    pub branch: Option<String>,
    /// Files with uncommitted changes (including untracked).
    pub changed: u32,
    /// Commits not yet pushed / not yet pulled; None when the branch has no upstream.
    pub ahead: Option<u32>,
    pub behind: Option<u32>,
}

/// Branch, uncommitted file count and ahead/behind in a single `git status` call.
pub fn summary(cwd: &str) -> Option<GitSummary> {
    let out = git_ok(cwd, &["status", "--porcelain=v2", "--branch", "--untracked-files=normal"]).ok()?;
    Some(parse_summary(&out))
}

/// Parses `git status --porcelain=v2 --branch` output.
pub fn parse_summary(out: &str) -> GitSummary {
    let mut s = GitSummary::default();
    let mut commit = None;
    for line in out.lines() {
        if let Some(head) = line.strip_prefix("# branch.head ") {
            s.branch = (head != "(detached)").then(|| head.to_string());
        } else if let Some(oid) = line.strip_prefix("# branch.oid ") {
            commit = (oid != "(initial)").then(|| oid.chars().take(7).collect::<String>());
        } else if let Some(ab) = line.strip_prefix("# branch.ab ") {
            let mut parts = ab.split_whitespace();
            s.ahead = parts.next().and_then(|a| a.trim_start_matches('+').parse().ok());
            s.behind = parts.next().and_then(|b| b.trim_start_matches('-').parse().ok());
        } else if !line.starts_with('#') && !line.is_empty() {
            s.changed += 1;
        }
    }
    // Detached HEAD: show the short commit instead of a branch name.
    if s.branch.is_none() {
        s.branch = commit;
    }
    s
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangedFile {
    pub path: String,
    /// M modified, A added, D deleted, R renamed, U untracked
    pub status: String,
    pub added: Option<u64>,
    pub removed: Option<u64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Changes {
    pub is_repo: bool,
    pub root: Option<String>,
    pub branch: Option<String>,
    pub files: Vec<ChangedFile>,
}

pub fn changes(cwd: &str) -> Result<Changes, String> {
    let Ok(root) = git_ok(cwd, &["rev-parse", "--show-toplevel"]) else {
        return Ok(Changes { is_repo: false, root: None, branch: None, files: vec![] });
    };
    let root = root.trim().to_string();
    let base = base(&root);

    let mut files: Vec<ChangedFile> = Vec::new();
    let status = git_ok(&root, &["status", "--porcelain=v1", "-z", "--untracked-files=all"])?;
    let mut parts = status.split('\0').filter(|s| !s.is_empty());
    while let Some(entry) = parts.next() {
        if entry.len() < 4 {
            continue;
        }
        let (xy, path) = entry.split_at(3);
        let xy = xy.trim();
        let status = if xy == "??" {
            "U"
        } else if xy.contains('R') {
            parts.next(); // original path of a rename
            "R"
        } else if xy.contains('D') {
            "D"
        } else if xy.contains('A') {
            "A"
        } else {
            "M"
        };
        files.push(ChangedFile { path: path.to_string(), status: status.into(), added: None, removed: None });
    }

    // Line counts for tracked changes in one call.
    if let Ok(numstat) = git_ok(&root, &["diff", "--numstat", "-z", "-M", base]) {
        let mut it = numstat.split('\0').filter(|s| !s.is_empty()).peekable();
        while let Some(rec) = it.next() {
            let mut cols = rec.splitn(3, '\t');
            let (a, r, p) = (cols.next(), cols.next(), cols.next());
            // Renames put the paths in the next two records.
            let path = match p {
                Some("") | None => {
                    it.next();
                    it.next().map(String::from)
                }
                Some(p) => Some(p.to_string()),
            };
            if let Some(f) = path.and_then(|p| files.iter_mut().find(|f| f.path == p)) {
                f.added = a.and_then(|v| v.parse().ok());
                f.removed = r.and_then(|v| v.parse().ok());
            }
        }
    }
    for f in files.iter_mut().filter(|f| f.status == "U") {
        if let Ok(bytes) = std::fs::read(Path::new(&root).join(&f.path)) {
            if bytes.len() < 4 * 1024 * 1024 && !bytes.contains(&0) {
                let lines = bytes.iter().filter(|b| **b == b'\n').count() as u64;
                f.added = Some(lines + u64::from(!bytes.ends_with(b"\n") && !bytes.is_empty()));
                f.removed = Some(0);
            }
        }
    }

    Ok(Changes { is_repo: true, branch: branch(&root), root: Some(root), files })
}

/// Rejects absolute paths and `..` so callers can only touch files inside the repository.
fn safe_relative(path: &str) -> Result<(), String> {
    let p = Path::new(path);
    if p.is_absolute() || p.components().any(|c| matches!(c, Component::ParentDir | Component::Prefix(_))) {
        return Err("Invalid path".into());
    }
    Ok(())
}

pub fn diff(root: &str, path: &str, status: &str) -> Result<String, String> {
    safe_relative(path)?;
    if status == "U" {
        // --no-index exits with 1 when files differ, which is expected here.
        let out = git(root, &["diff", "--no-color", "--no-ext-diff", "--no-index", "--", "/dev/null", path])?;
        return Ok(String::from_utf8_lossy(&out.stdout).into_owned());
    }
    git_ok(root, &["diff", "--no-color", "--no-ext-diff", "-M", base(root), "--", path])
}

/// Undoes one hunk: `patch` is the file's diff header plus that single hunk, applied in reverse.
pub fn revert_hunk(root: &str, patch: &str) -> Result<(), String> {
    use std::io::Write;
    let mut child = hidden("git")
        .args(["apply", "--reverse", "--whitespace=nowarn", "--recount", "-"])
        .current_dir(root)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|_| "Git is not installed or not on PATH".to_string())?;
    child.stdin.take().ok_or("no stdin")?.write_all(patch.as_bytes()).map_err(|e| e.to_string())?;
    let out = child.wait_with_output().map_err(|e| e.to_string())?;
    if out.status.success() {
        Ok(())
    } else {
        Err(format!(
            "This part changed again since the diff was shown. Refresh and try again. ({})",
            String::from_utf8_lossy(&out.stderr).trim()
        ))
    }
}

pub fn revert(root: &str, path: &str, status: &str) -> Result<(), String> {
    safe_relative(path)?;
    let full = Path::new(root).join(path);
    match status {
        "U" => std::fs::remove_file(&full).map_err(|e| e.to_string()),
        "A" => {
            git_ok(root, &["rm", "--cached", "-q", "--", path])?;
            std::fs::remove_file(&full).or_else(|e| if full.exists() { Err(e.to_string()) } else { Ok(()) })
        }
        _ => {
            if base(root) != "HEAD" {
                return Err("This repository has no commits yet, so there is nothing to go back to".into());
            }
            git_ok(root, &["restore", "--source=HEAD", "--staged", "--worktree", "--", path]).map(|_| ())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn summary_counts_changes_and_ahead_behind() {
        let out = "# branch.oid 1234567890abcdef\n# branch.head main\n# branch.upstream origin/main\n# branch.ab +2 -1\n1 .M N... 100644 100644 100644 a b src/app.ts\n? notes.txt\n";
        let s = parse_summary(out);
        assert_eq!(s.branch.as_deref(), Some("main"));
        assert_eq!(s.changed, 2);
        assert_eq!((s.ahead, s.behind), (Some(2), Some(1)));
    }

    #[test]
    fn summary_without_upstream_or_on_detached_head() {
        let s = parse_summary("# branch.oid abcdef1234567\n# branch.head (detached)\n");
        assert_eq!(s.branch.as_deref(), Some("abcdef1"));
        assert_eq!((s.ahead, s.behind, s.changed), (None, None, 0));
    }

    #[test]
    fn rejects_paths_outside_the_repo() {
        assert!(safe_relative("src/app.ts").is_ok());
        assert!(safe_relative("../secret.txt").is_err());
        assert!(safe_relative(r"C:\Windows\win.ini").is_err());
    }
}
