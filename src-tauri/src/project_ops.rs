//! Project folder actions from the sidebar: a check before renaming or deleting (protected
//! folders, permission, in use, what's inside), renaming that takes Claude Code's chat history
//! along, and moving folders or chats to the Recycle Bin.

use std::io::{BufRead, BufReader, BufWriter, Write};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use serde::Serialize;

use crate::{projects, sessions, workspace};

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Check {
    /// Why Helm won't rename or delete this folder at all (protected, missing).
    pub blocked: Option<String>,
    /// Why it can't right now (in use, no permission). Worth trying again later.
    pub busy: Option<String>,
    pub files: u64,
    pub bytes: u64,
    /// Counting stopped early (very large folder): the numbers are a lower bound.
    pub more: bool,
    /// Files git sees as changed or new (None: not a git repo, or git isn't installed).
    pub git_changes: Option<u32>,
}

fn same(a: &Path, b: &Path) -> bool {
    a.to_string_lossy().trim_end_matches(['\\', '/']).eq_ignore_ascii_case(b.to_string_lossy().trim_end_matches(['\\', '/']))
}

fn inside(path: &Path, root: &Path) -> bool {
    let p = path.to_string_lossy().to_lowercase();
    let r = root.to_string_lossy().trim_end_matches(['\\', '/']).to_lowercase();
    p == r || p.starts_with(&format!("{r}\\")) || p.starts_with(&format!("{r}/"))
}

/// Folders Helm never renames or deletes: drive roots, the user folder and its standard folders,
/// Windows and program folders, and Claude's own data.
pub fn protected(path: &Path) -> Option<String> {
    if path.parent().is_none() {
        return Some("This is a whole drive.".into());
    }
    let home = dirs::home_dir();
    if let Some(home) = &home {
        if same(path, home) {
            return Some("This is your user folder.".into());
        }
        if inside(home, path) {
            return Some("Your user folder is inside this folder.".into());
        }
        if inside(path, &home.join(".claude")) {
            return Some("This folder holds Claude Code's own data.".into());
        }
        for name in ["OneDrive", "AppData", "Desktop", "Documents", "Downloads", "Pictures", "Videos", "Music"] {
            if same(path, &home.join(name)) {
                return Some(format!("This is your {name} folder."));
            }
        }
    }
    let known = [dirs::desktop_dir(), dirs::document_dir(), dirs::download_dir(), dirs::picture_dir(), dirs::video_dir(), dirs::audio_dir(), dirs::data_dir(), dirs::data_local_dir()];
    if known.iter().flatten().any(|k| same(path, k)) {
        return Some("This is one of Windows' standard folders.".into());
    }
    for var in ["SystemRoot", "ProgramFiles", "ProgramFiles(x86)", "ProgramData"] {
        if let Ok(dir) = std::env::var(var) {
            if inside(path, Path::new(&dir)) {
                return Some("This is part of Windows or an installed program.".into());
            }
        }
    }
    None
}

/// Plain words for why Windows refused.
pub fn explain(e: &std::io::Error) -> String {
    match e.raw_os_error() {
        Some(5) => "Windows won't allow it: you may not have permission, or a program (an editor, a terminal, a dev server) has something inside this folder open.".into(),
        Some(32) | Some(33) => "A program is using this folder or a file inside it. Close it and try again.".into(),
        Some(145) => "The folder isn't empty and can't be replaced.".into(),
        Some(183) => "Something with that name already exists here.".into(),
        _ => e.to_string(),
    }
}

/// Asks Windows for delete access to the folder itself: refused when we lack permission or a
/// program holds it open (for example as its working folder).
fn probe(path: &Path) -> Option<String> {
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        const DELETE: u32 = 0x0001_0000;
        const SHARE_ALL: u32 = 0x7;
        const BACKUP_SEMANTICS: u32 = 0x0200_0000;
        if let Err(e) = std::fs::OpenOptions::new().access_mode(DELETE).share_mode(SHARE_ALL).custom_flags(BACKUP_SEMANTICS).open(path) {
            return Some(explain(&e));
        }
    }
    if std::fs::metadata(path).map(|m| m.permissions().readonly()).unwrap_or(false) {
        return Some("The folder is marked read-only.".into());
    }
    None
}

pub fn check(path: &Path) -> Check {
    let mut c = Check::default();
    if !path.is_dir() {
        c.blocked = Some("This folder doesn't exist any more.".into());
        return c;
    }
    if let Some(why) = protected(path) {
        c.blocked = Some(why);
        return c;
    }
    c.busy = probe(path);
    // What's inside, within a time and size budget.
    let started = Instant::now();
    let mut stack = vec![path.to_path_buf()];
    'walk: while let Some(dir) = stack.pop() {
        for entry in std::fs::read_dir(&dir).into_iter().flatten().flatten() {
            if c.files >= 500_000 || started.elapsed() > Duration::from_secs(3) {
                c.more = true;
                break 'walk;
            }
            let Ok(ft) = entry.file_type() else { continue };
            if ft.is_dir() {
                stack.push(entry.path());
            } else {
                c.files += 1;
                c.bytes += entry.metadata().map(|m| m.len()).unwrap_or(0);
            }
        }
    }
    if path.join(".git").exists() {
        if let Ok(out) = crate::git::hidden("git").args(["--no-optional-locks", "status", "--porcelain"]).current_dir(path).output() {
            if out.status.success() {
                c.git_changes = Some(String::from_utf8_lossy(&out.stdout).lines().filter(|l| !l.trim().is_empty()).count() as u32);
            }
        }
    }
    c
}

/// Claude Code's folder name for a working folder: every character that isn't a letter or digit
/// becomes "-" (one per UTF-16 unit, as Claude Code counts them).
pub fn encode(path: &str) -> String {
    path.chars().flat_map(|ch| if ch.is_ascii_alphanumeric() { vec![ch] } else { vec!['-'; ch.len_utf16()] }).collect()
}

/// Points every `"cwd"` at or inside `old` to the same place under `new`. Paths are compared
/// without regard to case, as Windows does. Returns None when the line has nothing to change.
pub fn rewrite_cwd(line: &str, old: &str, new: &str) -> Option<String> {
    let esc = |s: &str| serde_json::to_string(s).map(|q| q[1..q.len() - 1].to_string()).unwrap_or_default();
    let (old_e, new_e) = (esc(old.trim_end_matches(['\\', '/'])), esc(new.trim_end_matches(['\\', '/'])));
    const KEY: &str = "\"cwd\":\"";
    let mut out = String::with_capacity(line.len());
    let mut rest = line;
    let mut changed = false;
    while let Some(i) = rest.find(KEY) {
        let start = i + KEY.len();
        out.push_str(&rest[..start]);
        rest = &rest[start..];
        let matches = rest.len() >= old_e.len()
            && rest.is_char_boundary(old_e.len())
            && rest[..old_e.len()].eq_ignore_ascii_case(&old_e)
            && matches!(rest.as_bytes().get(old_e.len()), Some(b'"') | Some(b'\\') | Some(b'/'));
        if matches {
            out.push_str(&new_e);
            rest = &rest[old_e.len()..];
            changed = true;
        }
    }
    out.push_str(rest);
    changed.then_some(out)
}

fn rewrite_file(path: &Path, old: &str, new: &str) -> std::io::Result<()> {
    let tmp = path.with_extension("jsonl.helm-tmp");
    let had_newline = {
        use std::io::{Read, Seek, SeekFrom};
        let mut f = std::fs::File::open(path)?;
        let mut last = [0u8; 1];
        f.seek(SeekFrom::End(-1)).and_then(|_| f.read_exact(&mut last)).map(|_| last[0] == b'\n').unwrap_or(true)
    };
    {
        let reader = BufReader::new(std::fs::File::open(path)?);
        let mut writer = BufWriter::new(std::fs::File::create(&tmp)?);
        for line in reader.split(b'\n') {
            let line = line?;
            match std::str::from_utf8(&line).ok().and_then(|s| rewrite_cwd(s, old, new)) {
                Some(changed) => writer.write_all(changed.as_bytes())?,
                None => writer.write_all(&line)?,
            }
            writer.write_all(b"\n")?;
        }
        writer.flush()?;
    }
    // Every line was written with a newline; keep the file's own ending.
    if !had_newline {
        let len = std::fs::metadata(&tmp)?.len();
        std::fs::OpenOptions::new().write(true).open(&tmp)?.set_len(len.saturating_sub(1))?;
    }
    std::fs::rename(&tmp, path)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Renamed {
    pub path: String,
    /// Conversations moved to the new folder name.
    pub chats: u32,
    /// Set when the folder was renamed but some chat history couldn't be moved.
    pub warning: Option<String>,
}

/// Moves Claude Code's history for `old` (and folders inside it) over to `new`.
fn move_history(old: &str, new: &str) -> (u32, Option<String>) {
    let Some(root) = sessions::projects_dir() else { return (0, None) };
    let mut moved = 0;
    let mut problems = 0;
    for dir in std::fs::read_dir(&root).into_iter().flatten().flatten().map(|d| d.path()).filter(|p| p.is_dir()) {
        let transcripts: Vec<PathBuf> = std::fs::read_dir(&dir).into_iter().flatten().flatten().map(|e| e.path()).filter(|p| p.extension().is_some_and(|x| x == "jsonl")).collect();
        let Some(cwd) = transcripts.iter().find_map(|t| projects::cwd_from_transcript(t)) else { continue };
        if !inside(Path::new(&cwd), Path::new(old)) {
            continue;
        }
        let new_cwd = format!("{}{}", new.trim_end_matches(['\\', '/']), &cwd[old.trim_end_matches(['\\', '/']).len()..]);
        for t in &transcripts {
            match rewrite_file(t, old, new) {
                Ok(()) => moved += 1,
                Err(_) => problems += 1,
            }
        }
        // Only rename folders whose name follows the scheme we know.
        let name = dir.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        if name != encode(&cwd) {
            problems += 1;
            continue;
        }
        let target = root.join(encode(&new_cwd));
        if target.exists() {
            // Merge into the folder Claude already uses for the new name.
            for entry in std::fs::read_dir(&dir).into_iter().flatten().flatten() {
                if std::fs::rename(entry.path(), target.join(entry.file_name())).is_err() {
                    problems += 1;
                }
            }
            let _ = std::fs::remove_dir(&dir);
        } else if std::fs::rename(&dir, &target).is_err() {
            problems += 1;
        }
    }
    let warning = (problems > 0).then(|| "The folder was renamed, but some of its older chats couldn't be moved. They still show under the old name.".to_string());
    (moved, warning)
}

pub fn rename(path: &Path, new_name: &str) -> Result<Renamed, String> {
    if let Some(why) = protected(path) {
        return Err(why);
    }
    if !workspace::valid_name(new_name) {
        return Err("That name can't be used for a folder.".into());
    }
    let parent = path.parent().ok_or("This folder can't be renamed.")?;
    let target = parent.join(new_name.trim());
    let case_only = same(&target, path);
    if target.exists() && !case_only {
        return Err("Something with that name already exists here.".into());
    }
    std::fs::rename(path, &target).map_err(|e| explain(&e))?;
    let (old, new) = (path.to_string_lossy().into_owned(), target.to_string_lossy().into_owned());
    let (chats, warning) = move_history(&old, &new);
    Ok(Renamed { path: new, chats, warning })
}

pub fn trash_folder(path: &Path) -> Result<(), String> {
    if !path.is_dir() {
        return Err("This folder doesn't exist any more.".into());
    }
    if let Some(why) = protected(path) {
        return Err(why);
    }
    trash::delete(path).map_err(|e| match e {
        trash::Error::Os { code, .. } => explain(&std::io::Error::from_raw_os_error(code)),
        other => other.to_string(),
    })
}

/// Moves a conversation's transcript (and its folder of subagent files) to the Recycle Bin.
pub fn trash_session(session_id: &str) -> Result<(), String> {
    let path = sessions::find_transcript(session_id).ok_or("This conversation is already gone")?;
    let root = sessions::projects_dir().ok_or("Claude's projects folder wasn't found")?;
    if !path.starts_with(&root) || path.extension().and_then(|e| e.to_str()) != Some("jsonl") {
        return Err("That isn't a Claude conversation file".into());
    }
    trash::delete(&path).map_err(|e| e.to_string())?;
    let side = path.with_extension("");
    if side.is_dir() && side.starts_with(&root) {
        let _ = trash::delete(side);
    }
    Ok(())
}

/// The web page for a repo's `origin` remote, and the URL to clone it.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Remote {
    pub web: Option<String>,
    pub clone: String,
}

pub fn web_url(remote: &str) -> Option<String> {
    let r = remote.trim().trim_end_matches(".git");
    if let Some(rest) = r.strip_prefix("git@") {
        let (host, path) = rest.split_once(':')?;
        return Some(format!("https://{host}/{path}"));
    }
    if let Some(rest) = r.strip_prefix("ssh://") {
        let rest = rest.split_once('@').map(|(_, h)| h).unwrap_or(rest);
        let (host, path) = rest.split_once('/')?;
        let host = host.split(':').next()?;
        return Some(format!("https://{host}/{path}"));
    }
    if r.starts_with("https://") || r.starts_with("http://") {
        // Drop any user:token@ part.
        let (scheme, rest) = r.split_once("://")?;
        let rest = rest.split_once('@').filter(|(user, _)| !user.contains('/')).map(|(_, h)| h).unwrap_or(rest);
        return Some(format!("{scheme}://{rest}"));
    }
    None
}

pub fn remote(path: &Path) -> Option<Remote> {
    let out = crate::git::hidden("git").args(["remote", "get-url", "origin"]).current_dir(path).output().ok()?;
    if !out.status.success() {
        return None;
    }
    let clone = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if clone.is_empty() {
        return None;
    }
    let web = web_url(&clone);
    // Never hand out a URL with a saved password or token in it.
    let clone = if clone.starts_with("http") { web.clone().map(|w| format!("{w}.git")).unwrap_or(clone) } else { clone };
    Some(Remote { web, clone })
}
