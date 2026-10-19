//! Saves a clipboard image to a PNG file so its path can be handed to Claude Code.

use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

pub fn image_to_file(dir: PathBuf) -> Result<Option<String>, String> {
    let mut clipboard = arboard::Clipboard::new().map_err(|e| e.to_string())?;
    let Ok(image) = clipboard.get_image() else { return Ok(None) };

    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let stamp = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0);
    let path = dir.join(format!("screenshot-{stamp}.png"));

    let file = std::fs::File::create(&path).map_err(|e| e.to_string())?;
    let mut encoder = png::Encoder::new(std::io::BufWriter::new(file), image.width as u32, image.height as u32);
    encoder.set_color(png::ColorType::Rgba);
    encoder.set_depth(png::BitDepth::Eight);
    let mut writer = encoder.write_header().map_err(|e| e.to_string())?;
    writer.write_image_data(&image.bytes).map_err(|e| e.to_string())?;
    writer.finish().map_err(|e| e.to_string())?;

    Ok(Some(path.to_string_lossy().into_owned()))
}

/// Deletes pasted screenshots older than a week.
pub fn prune(dir: PathBuf) {
    let week = std::time::Duration::from_secs(7 * 24 * 3600);
    for entry in std::fs::read_dir(dir).into_iter().flatten().flatten() {
        let old = entry
            .metadata()
            .and_then(|m| m.modified())
            .ok()
            .and_then(|t| t.elapsed().ok())
            .is_some_and(|age| age > week);
        if old {
            let _ = std::fs::remove_file(entry.path());
        }
    }
}
