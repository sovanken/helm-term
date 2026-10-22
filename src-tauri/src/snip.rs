//! Screenshots ("snips"): freezes the screen, shows a full-screen overlay window to pick an area,
//! window, screen or freeform shape, and keeps the results in `<data>/snips`.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindowBuilder};

#[derive(Serialize, Clone, Copy, Default)]
pub struct Rect {
    x: i32,
    y: i32,
    w: i32,
    h: i32,
}

#[derive(Serialize, Clone)]
pub struct WindowInfo {
    title: String,
    rect: Rect,
}

/// What the overlay needs besides the pixels: where the desktop starts, its monitors and the
/// windows on it (top-most first), all in screen pixels.
#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct SnipInfo {
    origin_x: i32,
    origin_y: i32,
    width: u32,
    height: u32,
    monitors: Vec<Rect>,
    windows: Vec<WindowInfo>,
}

#[derive(Default)]
pub struct SnipState {
    pub info: Mutex<Option<SnipInfo>>,
    /// The frozen screen: 8-byte size header then BGRA rows (as `tools::capture_screen`).
    pub pixels: Mutex<Option<Vec<u8>>>,
}

#[cfg(windows)]
fn monitors() -> Vec<Rect> {
    use windows::core::BOOL;
    use windows::Win32::Foundation::{LPARAM, RECT};
    use windows::Win32::Graphics::Gdi::{EnumDisplayMonitors, HDC, HMONITOR};
    unsafe extern "system" fn each(_: HMONITOR, _: HDC, r: *mut RECT, data: LPARAM) -> BOOL {
        let list = unsafe { &mut *(data.0 as *mut Vec<Rect>) };
        let r = unsafe { *r };
        list.push(Rect { x: r.left, y: r.top, w: r.right - r.left, h: r.bottom - r.top });
        true.into()
    }
    let mut list: Vec<Rect> = Vec::new();
    unsafe {
        let _ = EnumDisplayMonitors(None, None, Some(each), LPARAM(&mut list as *mut _ as isize));
    }
    list
}

/// Visible, titled top-level windows in z-order (top first), with their visible frame (no shadow).
#[cfg(windows)]
fn windows_list() -> Vec<WindowInfo> {
    use windows::core::BOOL;
    use windows::Win32::Foundation::{HWND, LPARAM, RECT};
    use windows::Win32::Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_CLOAKED, DWMWA_EXTENDED_FRAME_BOUNDS};
    use windows::Win32::UI::WindowsAndMessaging::{EnumWindows, GetWindowTextLengthW, GetWindowTextW, IsIconic, IsWindowVisible};
    unsafe extern "system" fn each(hwnd: HWND, data: LPARAM) -> BOOL {
        let list = unsafe { &mut *(data.0 as *mut Vec<WindowInfo>) };
        unsafe {
            if !IsWindowVisible(hwnd).as_bool() || IsIconic(hwnd).as_bool() {
                return true.into();
            }
            let mut cloaked: u32 = 0;
            let _ = DwmGetWindowAttribute(hwnd, DWMWA_CLOAKED, &mut cloaked as *mut _ as *mut _, 4);
            if cloaked != 0 {
                return true.into();
            }
            let len = GetWindowTextLengthW(hwnd);
            if len == 0 {
                return true.into();
            }
            let mut buf = vec![0u16; len as usize + 1];
            let n = GetWindowTextW(hwnd, &mut buf);
            let title = String::from_utf16_lossy(&buf[..n as usize]);
            let mut r = RECT::default();
            if DwmGetWindowAttribute(hwnd, DWMWA_EXTENDED_FRAME_BOUNDS, &mut r as *mut _ as *mut _, std::mem::size_of::<RECT>() as u32).is_err() {
                return true.into();
            }
            if r.right - r.left > 20 && r.bottom - r.top > 20 {
                list.push(WindowInfo { title, rect: Rect { x: r.left, y: r.top, w: r.right - r.left, h: r.bottom - r.top } });
            }
        }
        true.into()
    }
    let mut list: Vec<WindowInfo> = Vec::new();
    unsafe {
        let _ = EnumWindows(Some(each), LPARAM(&mut list as *mut _ as isize));
    }
    list
}

#[cfg(not(windows))]
fn monitors() -> Vec<Rect> {
    Vec::new()
}
#[cfg(not(windows))]
fn windows_list() -> Vec<WindowInfo> {
    Vec::new()
}

#[cfg(windows)]
fn virtual_origin() -> (i32, i32) {
    use windows::Win32::UI::WindowsAndMessaging::{GetSystemMetrics, SM_XVIRTUALSCREEN, SM_YVIRTUALSCREEN};
    unsafe { (GetSystemMetrics(SM_XVIRTUALSCREEN), GetSystemMetrics(SM_YVIRTUALSCREEN)) }
}
#[cfg(not(windows))]
fn virtual_origin() -> (i32, i32) {
    (0, 0)
}

/// Freezes the screen and opens the overlay to choose what to keep.
pub fn start(app: &AppHandle) -> Result<(), String> {
    if let Some(old) = app.get_webview_window("snip") {
        let _ = old.close();
    }
    let windows = windows_list();
    let pixels = crate::tools::capture_screen()?;
    let width = u32::from_le_bytes(pixels[0..4].try_into().unwrap());
    let height = u32::from_le_bytes(pixels[4..8].try_into().unwrap());
    let (origin_x, origin_y) = virtual_origin();
    let state = app.state::<SnipState>();
    *state.info.lock().unwrap() = Some(SnipInfo { origin_x, origin_y, width, height, monitors: monitors(), windows });
    *state.pixels.lock().unwrap() = Some(pixels);

    let window = WebviewWindowBuilder::new(app, "snip", WebviewUrl::App("index.html#snip".into()))
        .title("Helm snip")
        .decorations(false)
        .resizable(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .shadow(false)
        .visible(false)
        .focused(true)
        .build()
        .map_err(|e| e.to_string())?;
    // Cover every monitor exactly, in screen pixels.
    let _ = window.set_position(PhysicalPosition::new(origin_x, origin_y));
    let _ = window.set_size(PhysicalSize::new(width, height));
    Ok(())
}

pub fn dir(app: &AppHandle) -> PathBuf {
    crate::data_dir(app).join("snips")
}

/// Saves the chosen part (PNG bytes from the overlay), closes the overlay and tells the main window.
pub fn finish(app: &AppHandle, png: &[u8]) -> Result<String, String> {
    let dir = dir(app);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let stamp = chrono_stamp();
    let path = dir.join(format!("snip-{stamp}.png"));
    std::fs::write(&path, png).map_err(|e| e.to_string())?;
    cancel(app);
    let path = path.to_string_lossy().into_owned();
    let _ = app.emit("snip-done", &path);
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.unminimize();
        let _ = main.show();
        let _ = main.set_focus();
    }
    Ok(path)
}

pub fn cancel(app: &AppHandle) {
    let state = app.state::<SnipState>();
    *state.pixels.lock().unwrap() = None;
    *state.info.lock().unwrap() = None;
    if let Some(w) = app.get_webview_window("snip") {
        let _ = w.close();
    }
}

/// Local date and time for file names, e.g. 2026-10-20_14-05-09 (falls back to Unix ms).
fn chrono_stamp() -> String {
    #[cfg(windows)]
    unsafe {
        let t = windows::Win32::System::SystemInformation::GetLocalTime();
        return format!("{:04}-{:02}-{:02}_{:02}-{:02}-{:02}-{:03}", t.wYear, t.wMonth, t.wDay, t.wHour, t.wMinute, t.wSecond, t.wMilliseconds);
    }
    #[allow(unreachable_code)]
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis().to_string()).unwrap_or_default()
}

#[derive(Serialize)]
pub struct SnipFile {
    path: String,
    modified: u64,
    size: u64,
}

/// Saved snips, newest first (edited copies and notes are left out).
pub fn list(dir: &Path) -> Vec<SnipFile> {
    let mut out: Vec<SnipFile> = std::fs::read_dir(dir)
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().into_owned();
            if !name.starts_with("snip-") || !name.ends_with(".png") || name.contains(".edited") {
                return None;
            }
            let meta = e.metadata().ok()?;
            let modified = meta.modified().ok()?.duration_since(std::time::UNIX_EPOCH).ok()?.as_millis() as u64;
            Some(SnipFile { path: e.path().to_string_lossy().into_owned(), modified, size: meta.len() })
        })
        .collect();
    out.sort_by(|a, b| b.modified.cmp(&a.modified));
    out
}

/// Deletes a snip and its edits/notes. Only files inside the snips folder.
pub fn delete(dir: &Path, path: &Path) -> Result<(), String> {
    if path.parent() != Some(dir) {
        return Err("That isn't a Helm snip".into());
    }
    let stem = path.file_stem().and_then(|s| s.to_str()).ok_or("Bad name")?.to_string();
    for entry in std::fs::read_dir(dir).map_err(|e| e.to_string())?.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if name == format!("{stem}.png") || name.starts_with(&format!("{stem}.")) {
            let _ = std::fs::remove_file(entry.path());
        }
    }
    Ok(())
}

/// Copies a PNG file to the clipboard as an image.
pub fn copy_image(path: &Path) -> Result<(), String> {
    let file = std::fs::File::open(path).map_err(|e| e.to_string())?;
    let mut decoder = png::Decoder::new(std::io::BufReader::new(file));
    decoder.set_transformations(png::Transformations::normalize_to_color8());
    let mut reader = decoder.read_info().map_err(|e| e.to_string())?;
    let mut buf = vec![0; reader.output_buffer_size().ok_or("Image too large")?];
    let info = reader.next_frame(&mut buf).map_err(|e| e.to_string())?;
    let bytes = &buf[..info.buffer_size()];
    let rgba: Vec<u8> = match info.color_type {
        png::ColorType::Rgba => bytes.to_vec(),
        png::ColorType::Rgb => bytes.chunks(3).flat_map(|p| [p[0], p[1], p[2], 255]).collect(),
        png::ColorType::GrayscaleAlpha => bytes.chunks(2).flat_map(|p| [p[0], p[0], p[0], p[1]]).collect(),
        png::ColorType::Grayscale => bytes.iter().flat_map(|&g| [g, g, g, 255]).collect(),
        png::ColorType::Indexed => return Err("Unsupported image".into()),
    };
    let mut clipboard = arboard::Clipboard::new().map_err(|e| e.to_string())?;
    clipboard
        .set_image(arboard::ImageData { width: info.width as usize, height: info.height as usize, bytes: rgba.into() })
        .map_err(|e| e.to_string())
}
