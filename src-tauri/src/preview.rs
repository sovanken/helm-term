//! File tabs: reads a file for Helm's built-in viewer (code, images, PDF, video and audio).

use std::io::Read;
use std::path::Path;

use base64::Engine;
use serde::Serialize;

const MAX_TEXT: u64 = 3 * 1024 * 1024;
const MAX_IMAGE: u64 = 15 * 1024 * 1024;
/// PDFs, video and audio are sent as raw bytes and played by the window itself.
pub const MAX_MEDIA: u64 = 300 * 1024 * 1024;

#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum FilePreview {
    #[serde(rename_all = "camelCase")]
    /// `editable`: the whole file was read and it is valid UTF-8, so saving it back loses nothing.
    Text { text: String, size: u64, truncated: bool, editable: bool, modified: u64 },
    #[serde(rename_all = "camelCase")]
    Image { data_url: String, size: u64, modified: u64 },
    /// PDF, video or audio: fetch the bytes with `file_bytes`.
    #[serde(rename_all = "camelCase")]
    Media { mime: String, size: u64, modified: u64 },
    #[serde(rename_all = "camelCase")]
    TooLarge { size: u64, modified: u64 },
    #[serde(rename_all = "camelCase")]
    Binary { size: u64, modified: u64 },
}

fn extension(path: &Path) -> String {
    path.extension().and_then(|e| e.to_str()).unwrap_or_default().to_ascii_lowercase()
}

fn image_type(ext: &str) -> Option<&'static str> {
    Some(match ext {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        "ico" => "image/x-icon",
        "svg" => "image/svg+xml",
        "avif" => "image/avif",
        _ => return None,
    })
}

pub fn media_type(ext: &str) -> Option<&'static str> {
    Some(match ext {
        "pdf" => "application/pdf",
        "mp4" | "m4v" => "video/mp4",
        "webm" => "video/webm",
        "mov" => "video/quicktime",
        "ogv" => "video/ogg",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "ogg" | "oga" => "audio/ogg",
        "m4a" | "aac" => "audio/mp4",
        "flac" => "audio/flac",
        _ => return None,
    })
}

fn modified_ms(meta: &std::fs::Metadata) -> u64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn metadata(path: &Path) -> Result<std::fs::Metadata, String> {
    let meta = std::fs::metadata(path).map_err(|_| "This file no longer exists.".to_string())?;
    if meta.is_dir() {
        return Err("This is a folder.".into());
    }
    Ok(meta)
}

pub fn read(path: &Path) -> Result<FilePreview, String> {
    let meta = metadata(path)?;
    let size = meta.len();
    let modified = modified_ms(&meta);
    let ext = extension(path);

    if let Some(media) = image_type(&ext) {
        if size > MAX_IMAGE {
            return Ok(FilePreview::TooLarge { size, modified });
        }
        let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
        let data = base64::engine::general_purpose::STANDARD.encode(bytes);
        return Ok(FilePreview::Image { data_url: format!("data:{media};base64,{data}"), size, modified });
    }
    if let Some(mime) = media_type(&ext) {
        if size > MAX_MEDIA {
            return Ok(FilePreview::TooLarge { size, modified });
        }
        return Ok(FilePreview::Media { mime: mime.into(), size, modified });
    }

    let mut bytes = Vec::with_capacity(size.min(MAX_TEXT) as usize);
    std::fs::File::open(path)
        .map_err(|e| e.to_string())?
        .take(MAX_TEXT)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes[..bytes.len().min(8192)].contains(&0) {
        return Ok(FilePreview::Binary { size, modified });
    }
    let truncated = size > MAX_TEXT;
    let (text, editable) = match String::from_utf8(bytes) {
        Ok(text) => (text, !truncated),
        Err(e) => (String::from_utf8_lossy(e.as_bytes()).into_owned(), false),
    };
    Ok(FilePreview::Text { text, size, truncated, editable, modified })
}

/// Raw bytes of a PDF, video or audio file (only those types, and within the size limit).
pub fn bytes(path: &Path) -> Result<Vec<u8>, String> {
    let meta = metadata(path)?;
    if media_type(&extension(path)).is_none() || meta.len() > MAX_MEDIA {
        return Err("This file can't be shown here.".into());
    }
    std::fs::read(path).map_err(|e| e.to_string())
}

/// Characters Windows doesn't allow in a file name.
const BAD_NAME: &[char] = &['<', '>', ':', '"', '|', '?', '*'];

/// Creates a new, empty file `name` inside `dir` and returns its full path. `name` may include
/// sub-folders (created as needed) but never leaves `dir`, and an existing file is never replaced.
pub fn create(dir: &Path, name: &str) -> Result<std::path::PathBuf, String> {
    let parts: Vec<&str> = name.trim().split(['/', '\\']).filter(|p| !p.is_empty()).collect();
    if parts.is_empty() {
        return Err("Give the file a name.".into());
    }
    if parts.iter().any(|p| *p == "." || *p == ".." || p.ends_with(['.', ' ']) || p.chars().any(|c| BAD_NAME.contains(&c) || c.is_control())) {
        return Err("That name can't be used for a file.".into());
    }
    if !dir.is_dir() {
        return Err("The folder no longer exists.".into());
    }
    let path = parts.iter().fold(dir.to_path_buf(), |p, part| p.join(part));
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    match std::fs::OpenOptions::new().write(true).create_new(true).open(&path) {
        Ok(_) => Ok(path),
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => Err("A file with that name already exists.".into()),
        Err(e) => Err(e.to_string()),
    }
}

/// Saves edited text. `expected` is the modified time the editor started from: if the file has
/// changed since (Claude edited it, say), nothing is written unless `force`. Returns the new time.
pub fn save(path: &Path, text: &str, expected: u64, force: bool) -> Result<u64, String> {
    if !force {
        if let Ok(meta) = std::fs::metadata(path) {
            if modified_ms(&meta) != expected {
                return Err("changed".into());
            }
        }
    }
    std::fs::write(path, text).map_err(|e| e.to_string())?;
    std::fs::metadata(path).map(|m| modified_ms(&m)).map_err(|e| e.to_string())
}
