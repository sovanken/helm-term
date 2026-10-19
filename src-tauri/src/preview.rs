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
    Text { text: String, size: u64, truncated: bool, modified: u64 },
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
    let text = String::from_utf8_lossy(&bytes).into_owned();
    Ok(FilePreview::Text { text, size, truncated: size > MAX_TEXT, modified })
}

/// Raw bytes of a PDF, video or audio file (only those types, and within the size limit).
pub fn bytes(path: &Path) -> Result<Vec<u8>, String> {
    let meta = metadata(path)?;
    if media_type(&extension(path)).is_none() || meta.len() > MAX_MEDIA {
        return Err("This file can't be shown here.".into());
    }
    std::fs::read(path).map_err(|e| e.to_string())
}
