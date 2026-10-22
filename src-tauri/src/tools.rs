//! Developer tools tab: the parts that need the system (hashing files, the screen, ports,
//! HTTP without browser CORS, environment variables) and a small store for tool data.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use base64::Engine;
use serde::{Deserialize, Serialize};

// ---------- tool data (saved requests, recent colours, scratchpads) ----------

/// Files live in `<data>/tools`; names are plain (letters, digits, - _ .) so they can't leave it.
pub fn data_path(dir: &Path, name: &str) -> Result<PathBuf, String> {
    let ok = !name.is_empty() && name.len() <= 120 && !name.starts_with('.') && name.chars().all(|c| c.is_ascii_alphanumeric() || "-_.".contains(c));
    if !ok {
        return Err("Bad name".into());
    }
    Ok(dir.join(name))
}

pub fn data_read(dir: &Path, name: &str) -> Result<Option<String>, String> {
    match std::fs::read_to_string(data_path(dir, name)?) {
        Ok(text) => Ok(Some(text)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

pub fn data_write(dir: &Path, name: &str, text: &str) -> Result<(), String> {
    let path = data_path(dir, name)?;
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    // Write then rename, so a crash never leaves half a file.
    let tmp = path.with_extension("tmp");
    std::fs::write(&tmp, text).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &path).map_err(|e| e.to_string())
}

// ---------- hashes ----------

fn hasher(algo: &str) -> Result<Box<dyn sha2::digest::DynDigest>, String> {
    Ok(match algo {
        "md5" => Box::new(md5::Md5::default()),
        "sha1" => Box::new(sha1::Sha1::default()),
        "sha256" => Box::new(sha2::Sha256::default()),
        "sha512" => Box::new(sha2::Sha512::default()),
        _ => return Err("Unknown hash".into()),
    })
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

pub fn hash_text(text: &str, algo: &str) -> Result<String, String> {
    let mut h = hasher(algo)?;
    h.update(text.as_bytes());
    Ok(hex(&h.finalize()))
}

/// Hashes a file of any size, reading it in chunks.
pub fn hash_file(path: &Path, algo: &str) -> Result<String, String> {
    use std::io::Read;
    let mut h = hasher(algo)?;
    let mut file = std::fs::File::open(path).map_err(|e| e.to_string())?;
    let mut buf = vec![0u8; 1 << 20];
    loop {
        let n = file.read(&mut buf).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        h.update(&buf[..n]);
    }
    Ok(hex(&h.finalize()))
}

// ---------- HTTP requests ----------

#[derive(Deserialize)]
pub struct HttpRequest {
    method: String,
    url: String,
    headers: Vec<(String, String)>,
    body: Option<String>,
    timeout_secs: Option<u64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpResponse {
    status: u16,
    status_text: String,
    headers: Vec<(String, String)>,
    /// Text when the body is text; otherwise base64 with `binary` set.
    body: String,
    binary: bool,
    size: usize,
    time_ms: u128,
    truncated: bool,
}

const MAX_BODY: usize = 10 * 1024 * 1024;

pub async fn http(req: HttpRequest) -> Result<HttpResponse, String> {
    let url = reqwest::Url::parse(req.url.trim()).map_err(|_| "That address isn't a valid URL (it needs http:// or https://).".to_string())?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err("Only http:// and https:// addresses can be requested.".into());
    }
    let method = reqwest::Method::from_bytes(req.method.to_ascii_uppercase().as_bytes()).map_err(|_| "Unknown method".to_string())?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(req.timeout_secs.unwrap_or(30).clamp(1, 300)))
        .redirect(reqwest::redirect::Policy::limited(10))
        .user_agent(concat!("Helm/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|e| e.to_string())?;
    let mut builder = client.request(method, url);
    for (k, v) in req.headers.iter().filter(|(k, _)| !k.trim().is_empty()) {
        builder = builder.header(k.trim(), v);
    }
    if let Some(body) = req.body.filter(|b| !b.is_empty()) {
        builder = builder.body(body);
    }
    let started = Instant::now();
    let res = builder.send().await.map_err(|e| {
        if e.is_timeout() {
            "The server took too long to answer.".to_string()
        } else if e.is_connect() {
            "Couldn't connect. Is the server running, and is the address right?".to_string()
        } else {
            e.to_string()
        }
    })?;
    let status = res.status();
    let headers: Vec<(String, String)> = res.headers().iter().map(|(k, v)| (k.to_string(), String::from_utf8_lossy(v.as_bytes()).into_owned())).collect();
    let mut bytes = res.bytes().await.map_err(|e| e.to_string())?.to_vec();
    let time_ms = started.elapsed().as_millis();
    let size = bytes.len();
    let truncated = size > MAX_BODY;
    bytes.truncate(MAX_BODY);
    let (body, binary) = match String::from_utf8(bytes) {
        Ok(text) => (text, false),
        Err(e) => (base64::engine::general_purpose::STANDARD.encode(e.as_bytes()), true),
    };
    Ok(HttpResponse { status: status.as_u16(), status_text: status.canonical_reason().unwrap_or("").into(), headers, body, binary, size, time_ms, truncated })
}

// ---------- environment variables ----------

#[derive(Serialize)]
pub struct EnvVars {
    user: BTreeMap<String, String>,
    system: BTreeMap<String, String>,
}

#[cfg(windows)]
pub fn env_vars() -> EnvVars {
    use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};
    use winreg::types::FromRegValue;
    use winreg::RegKey;
    let read = |root, path: &str| -> BTreeMap<String, String> {
        RegKey::predef(root)
            .open_subkey(path)
            .map(|key| key.enum_values().filter_map(Result::ok).filter_map(|(name, v)| String::from_reg_value(&v).ok().map(|s| (name, s))).collect())
            .unwrap_or_default()
    };
    EnvVars {
        user: read(HKEY_CURRENT_USER, "Environment"),
        system: read(HKEY_LOCAL_MACHINE, r"SYSTEM\CurrentControlSet\Control\Session Manager\Environment"),
    }
}

#[cfg(not(windows))]
pub fn env_vars() -> EnvVars {
    EnvVars { user: std::env::vars().collect(), system: BTreeMap::new() }
}

// ---------- ports ----------

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PortUse {
    port: u16,
    address: String,
    pid: u32,
    name: String,
    path: String,
    /// Windows itself or Helm: never offered a Stop button.
    protected: bool,
}

#[cfg(windows)]
fn process_path(pid: u32) -> Option<String> {
    use windows::core::PWSTR;
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Threading::{OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION};
    unsafe {
        let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
        let mut buf = [0u16; 1024];
        let mut len = buf.len() as u32;
        let ok = QueryFullProcessImageNameW(handle, PROCESS_NAME_WIN32, PWSTR(buf.as_mut_ptr()), &mut len).is_ok();
        let _ = CloseHandle(handle);
        ok.then(|| String::from_utf16_lossy(&buf[..len as usize]))
    }
}

#[cfg(windows)]
/// Every running process: id → (parent id, exe file name in lower case).
#[cfg(windows)]
fn process_table() -> BTreeMap<u32, (u32, String)> {
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Diagnostics::ToolHelp::{CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS};
    let mut table = BTreeMap::new();
    unsafe {
        let Ok(snap) = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) else { return table };
        let mut entry = PROCESSENTRY32W { dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32, ..Default::default() };
        let mut ok = Process32FirstW(snap, &mut entry).is_ok();
        while ok {
            let len = entry.szExeFile.iter().position(|&c| c == 0).unwrap_or(entry.szExeFile.len());
            table.insert(entry.th32ProcessID, (entry.th32ParentProcessID, String::from_utf16_lossy(&entry.szExeFile[..len]).to_ascii_lowercase()));
            ok = Process32NextW(snap, &mut entry).is_ok();
        }
        let _ = CloseHandle(snap);
    }
    table
}

/// Windows' own programs, any Helm window (this one or another copy), and the page engine a Helm
/// window runs on. Stopping those would close Helm and the Claude sessions in it.
#[cfg(windows)]
fn is_protected(pid: u32, path: &str, table: &BTreeMap<u32, (u32, String)>) -> bool {
    let lower = path.to_ascii_lowercase();
    let windir = std::env::var("SystemRoot").unwrap_or_else(|_| r"C:\Windows".into()).to_ascii_lowercase();
    if pid <= 4 || pid == std::process::id() || path.is_empty() || lower.starts_with(&format!("{windir}\\")) {
        return true;
    }
    let helm_name = std::env::current_exe().ok().and_then(|p| p.file_name().map(|n| n.to_string_lossy().to_ascii_lowercase())).unwrap_or_else(|| "helm.exe".into());
    let name = |p: u32| table.get(&p).map(|(_, n)| n.as_str()).unwrap_or("");
    if name(pid) == helm_name {
        return true;
    }
    // WebView2 processes belong to whichever program started them; walk up a few parents.
    if name(pid) == "msedgewebview2.exe" {
        let mut cur = pid;
        for _ in 0..4 {
            let Some((parent, _)) = table.get(&cur) else { break };
            if name(*parent) == helm_name {
                return true;
            }
            cur = *parent;
        }
    }
    false
}

/// TCP ports that programs are listening on (IPv4 and IPv6), one row per port and program.
#[cfg(windows)]
pub fn ports() -> Result<Vec<PortUse>, String> {
    use windows::Win32::NetworkManagement::IpHelper::{GetExtendedTcpTable, MIB_TCP6TABLE_OWNER_PID, MIB_TCPTABLE_OWNER_PID, TCP_TABLE_OWNER_PID_LISTENER};
    use windows::Win32::Networking::WinSock::{AF_INET, AF_INET6};

    fn table(family: u32) -> Vec<u8> {
        let mut size = 0u32;
        unsafe {
            let _ = GetExtendedTcpTable(None, &mut size, false, family, TCP_TABLE_OWNER_PID_LISTENER, 0);
            let mut buf = vec![0u8; size as usize + 1024];
            size = buf.len() as u32;
            if GetExtendedTcpTable(Some(buf.as_mut_ptr().cast()), &mut size, false, family, TCP_TABLE_OWNER_PID_LISTENER, 0) != 0 {
                return Vec::new();
            }
            buf
        }
    }

    let mut rows: Vec<(u16, String, u32)> = Vec::new();
    let v4 = table(AF_INET.0 as u32);
    if !v4.is_empty() {
        let t = unsafe { &*(v4.as_ptr() as *const MIB_TCPTABLE_OWNER_PID) };
        let list = unsafe { std::slice::from_raw_parts(t.table.as_ptr(), t.dwNumEntries as usize) };
        for r in list {
            let port = u16::from_be((r.dwLocalPort & 0xffff) as u16);
            let ip = std::net::Ipv4Addr::from(u32::from_be(r.dwLocalAddr));
            rows.push((port, ip.to_string(), r.dwOwningPid));
        }
    }
    let v6 = table(AF_INET6.0 as u32);
    if !v6.is_empty() {
        let t = unsafe { &*(v6.as_ptr() as *const MIB_TCP6TABLE_OWNER_PID) };
        let list = unsafe { std::slice::from_raw_parts(t.table.as_ptr(), t.dwNumEntries as usize) };
        for r in list {
            let port = u16::from_be((r.dwLocalPort & 0xffff) as u16);
            let ip = std::net::Ipv6Addr::from(r.ucLocalAddr);
            rows.push((port, format!("[{ip}]"), r.dwOwningPid));
        }
    }
    rows.sort();
    rows.dedup_by(|a, b| a.0 == b.0 && a.2 == b.2);

    let table = process_table();
    let mut names: BTreeMap<u32, String> = BTreeMap::new();
    Ok(rows
        .into_iter()
        .map(|(port, address, pid)| {
            let path = names.entry(pid).or_insert_with(|| process_path(pid).unwrap_or_default()).clone();
            let name = match pid {
                0 => "System Idle".into(),
                4 => "Windows (System)".into(),
                _ => Path::new(&path).file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| "(protected program)".into()),
            };
            PortUse { port, address, pid, protected: is_protected(pid, &path, &table), name, path }
        })
        .collect())
}

#[cfg(not(windows))]
pub fn ports() -> Result<Vec<PortUse>, String> {
    Ok(Vec::new())
}

/// Stops the program holding a port. Refuses Windows' own programs and Helm.
#[cfg(windows)]
pub fn stop_process(pid: u32) -> Result<(), String> {
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Threading::{OpenProcess, TerminateProcess, PROCESS_TERMINATE};
    let path = process_path(pid).unwrap_or_default();
    if is_protected(pid, &path, &process_table()) {
        return Err("That's part of Windows (or Helm itself), so Helm won't stop it.".into());
    }
    unsafe {
        let handle = OpenProcess(PROCESS_TERMINATE, false, pid).map_err(|_| "Windows didn't allow stopping it (it may need admin rights).".to_string())?;
        let result = TerminateProcess(handle, 1);
        let _ = CloseHandle(handle);
        result.map_err(|e| e.to_string())
    }
}

#[cfg(not(windows))]
pub fn stop_process(_pid: u32) -> Result<(), String> {
    Err("Not supported".into())
}

// ---------- screen capture (for the ruler) ----------

/// The whole desktop (every monitor) as BGRA pixels: 8 bytes of width and height (u32 LE), then rows.
#[cfg(windows)]
pub fn capture_screen() -> Result<Vec<u8>, String> {
    use windows::Win32::Graphics::Gdi::{
        BitBlt, CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject, GetDC, GetDIBits, ReleaseDC, SelectObject, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, CAPTUREBLT,
        DIB_RGB_COLORS, SRCCOPY,
    };
    use windows::Win32::UI::WindowsAndMessaging::{GetSystemMetrics, SM_CXVIRTUALSCREEN, SM_CYVIRTUALSCREEN, SM_XVIRTUALSCREEN, SM_YVIRTUALSCREEN};
    unsafe {
        let (x, y) = (GetSystemMetrics(SM_XVIRTUALSCREEN), GetSystemMetrics(SM_YVIRTUALSCREEN));
        let (w, h) = (GetSystemMetrics(SM_CXVIRTUALSCREEN), GetSystemMetrics(SM_CYVIRTUALSCREEN));
        if w <= 0 || h <= 0 {
            return Err("Couldn't read the screen size.".into());
        }
        let screen = GetDC(None);
        let mem = CreateCompatibleDC(Some(screen));
        let bitmap = CreateCompatibleBitmap(screen, w, h);
        let old = SelectObject(mem, bitmap.into());
        let copied = BitBlt(mem, 0, 0, w, h, Some(screen), x, y, SRCCOPY | CAPTUREBLT);
        let mut info = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: w,
                biHeight: -h, // top-down rows
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB.0,
                ..Default::default()
            },
            ..Default::default()
        };
        let mut out = Vec::with_capacity(8 + (w * h * 4) as usize);
        out.extend_from_slice(&(w as u32).to_le_bytes());
        out.extend_from_slice(&(h as u32).to_le_bytes());
        out.resize(8 + (w * h * 4) as usize, 0);
        let lines = GetDIBits(mem, bitmap, 0, h as u32, Some(out[8..].as_mut_ptr().cast()), &mut info, DIB_RGB_COLORS);
        SelectObject(mem, old);
        let _ = DeleteObject(bitmap.into());
        let _ = DeleteDC(mem);
        ReleaseDC(None, screen);
        if copied.is_err() || lines == 0 {
            return Err("Couldn't capture the screen.".into());
        }
        Ok(out)
    }
}

#[cfg(not(windows))]
pub fn capture_screen() -> Result<Vec<u8>, String> {
    Err("Not supported".into())
}
