//! Phones and tablets connected to the PC: Android devices through adb (USB, Wi-Fi debugging,
//! emulators) plus any phone Windows lists as a portable device (MTP), for the status bar.

use std::path::{Path, PathBuf};
use std::process::Command;

use serde::Serialize;

#[cfg(windows)]
use std::os::windows::process::CommandExt;
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

fn hidden(program: &Path) -> Command {
    let mut c = Command::new(program);
    #[cfg(windows)]
    c.creation_flags(CREATE_NO_WINDOW);
    c
}

/// adb from PATH, the Android SDK (ANDROID_HOME / ANDROID_SDK_ROOT / the default SDK folder), or
/// scrcpy's bundled copy.
pub fn adb() -> Option<PathBuf> {
    if let Ok(p) = which::which("adb") {
        return Some(p);
    }
    let mut roots: Vec<PathBuf> = ["ANDROID_HOME", "ANDROID_SDK_ROOT"].iter().filter_map(|k| std::env::var_os(k)).map(PathBuf::from).collect();
    if let Some(local) = dirs::data_local_dir() {
        roots.push(local.join("Android").join("Sdk"));
    }
    roots.into_iter().map(|r| r.join("platform-tools").join("adb.exe")).find(|p| p.is_file()).or_else(|| scrcpy().map(|s| s.with_file_name("adb.exe")).filter(|p| p.is_file()))
}

/// scrcpy from PATH or a winget install.
pub fn scrcpy() -> Option<PathBuf> {
    if let Ok(p) = which::which("scrcpy") {
        return Some(p);
    }
    let packages = dirs::data_local_dir()?.join("Microsoft").join("WinGet").join("Packages");
    std::fs::read_dir(packages).ok()?.flatten().filter(|e| e.file_name().to_string_lossy().starts_with("Genymobile.scrcpy")).find_map(|e| {
        std::fs::read_dir(e.path()).ok()?.flatten().map(|d| d.path().join("scrcpy.exe")).find(|p| p.is_file())
    })
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Device {
    /// adb serial ("R58M…", "192.168.1.5:5555", "emulator-5554"); empty for Windows-only phones.
    pub serial: String,
    /// The phone's own name when Windows knows it ("Ada's Pixel"), else the model.
    pub name: String,
    /// Model as adb reports it ("SM M536B"); empty when unknown.
    pub model: String,
    /// "device" (ready), "unauthorized" (allow on the phone), "offline", or "usb" (seen by Windows only).
    pub state: String,
    /// "usb", "wifi" or "emulator".
    pub connection: String,
}

/// Parses `adb devices -l`.
pub fn parse_adb_devices(out: &str) -> Vec<Device> {
    out.lines()
        .skip_while(|l| !l.starts_with("List of devices"))
        .skip(1)
        .filter_map(|line| {
            let mut parts = line.split_whitespace();
            let serial = parts.next()?.to_string();
            let state = parts.next()?.to_string();
            let fields: Vec<&str> = parts.collect();
            let field = |k: &str| fields.iter().find_map(|f| f.strip_prefix(k)).map(|v| v.replace('_', " "));
            let connection = if serial.starts_with("emulator-") {
                "emulator"
            } else if serial.contains(':') || serial.contains("._adb-tls-connect.") {
                "wifi"
            } else {
                "usb"
            };
            let model = field("model:").or_else(|| field("device:")).unwrap_or_default();
            let name = if !model.is_empty() { model.clone() } else if state == "unauthorized" { "Android phone".into() } else { serial.clone() };
            Some(Device { serial, name, model, state, connection: connection.into() })
        })
        .collect()
}

/// Phones and cameras Windows lists as portable devices (MTP/PTP), by their friendly name.
#[cfg(windows)]
fn portable_devices() -> Vec<String> {
    use windows::core::GUID;
    use windows::Win32::Devices::DeviceAndDriverInstallation::{
        SetupDiDestroyDeviceInfoList, SetupDiEnumDeviceInfo, SetupDiGetClassDevsW, SetupDiGetDeviceRegistryPropertyW, DIGCF_PRESENT, SPDRP_DEVICEDESC, SPDRP_FRIENDLYNAME,
        SP_DEVINFO_DATA,
    };
    // GUID_DEVCLASS_WPD (Windows Portable Devices).
    let wpd = GUID::from_u128(0xeec5ad98_8080_425f_922a_dabf3de3f69a);
    let mut names = Vec::new();
    unsafe {
        let Ok(set) = SetupDiGetClassDevsW(Some(&wpd), None, None, DIGCF_PRESENT) else { return names };
        let mut i = 0;
        loop {
            let mut data = SP_DEVINFO_DATA { cbSize: std::mem::size_of::<SP_DEVINFO_DATA>() as u32, ..Default::default() };
            if SetupDiEnumDeviceInfo(set, i, &mut data).is_err() {
                break;
            }
            i += 1;
            for prop in [SPDRP_FRIENDLYNAME, SPDRP_DEVICEDESC] {
                let mut buf = [0u8; 512];
                if SetupDiGetDeviceRegistryPropertyW(set, &data, prop, None, Some(&mut buf), None).is_ok() {
                    let wide: Vec<u16> = buf.chunks_exact(2).map(|c| u16::from_le_bytes([c[0], c[1]])).take_while(|&c| c != 0).collect();
                    let name = String::from_utf16_lossy(&wide).trim().to_string();
                    if !name.is_empty() {
                        names.push(name);
                        break;
                    }
                }
            }
        }
        let _ = SetupDiDestroyDeviceInfoList(set);
    }
    names
}

#[cfg(not(windows))]
fn portable_devices() -> Vec<String> {
    Vec::new()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceList {
    devices: Vec<Device>,
    has_adb: bool,
    has_scrcpy: bool,
}

pub fn list() -> DeviceList {
    let adb = adb();
    let mut devices = adb
        .as_ref()
        .and_then(|a| hidden(a).args(["devices", "-l"]).output().ok())
        .map(|o| parse_adb_devices(&String::from_utf8_lossy(&o.stdout)))
        .unwrap_or_default();
    merge_windows_names(&mut devices, portable_devices());
    DeviceList { devices, has_adb: adb.is_some(), has_scrcpy: scrcpy().is_some() }
}

/// Combines adb's devices with the phones Windows lists. Windows names Android phones by the name
/// set on the phone ("dom's M53") while adb gives the model, so they can't be matched by name:
/// each USB phone adb knows takes one Android name from Windows (pairing is certain with one phone).
/// Whatever is left (an iPhone, a phone without USB debugging) is listed as seen by Windows only.
pub fn merge_windows_names(devices: &mut Vec<Device>, windows: Vec<String>) {
    let apple = |n: &str| n.to_lowercase().contains("iphone") || n.to_lowercase().contains("ipad");
    let (mut android, others): (Vec<String>, Vec<String>) = windows.into_iter().partition(|n| !apple(n));
    let usb: Vec<usize> = (0..devices.len()).filter(|&i| devices[i].connection == "usb").collect();
    if usb.len() == 1 && android.len() == 1 {
        devices[usb[0]].name = android.remove(0);
    } else {
        // Several phones: keep adb's names, and don't list the same phones twice.
        android.drain(..android.len().min(usb.len()));
    }
    // The same phone over Wi-Fi as well as USB gets the same name.
    let named: Vec<(String, String)> = devices.iter().filter(|d| d.connection == "usb" && !d.model.is_empty()).map(|d| (d.model.clone(), d.name.clone())).collect();
    for d in devices.iter_mut().filter(|d| d.connection == "wifi") {
        if let Some((_, name)) = named.iter().find(|(m, _)| *m == d.model) {
            d.name = name.clone();
        }
    }
    for name in android.into_iter().chain(others) {
        devices.push(Device { serial: String::new(), name, model: String::new(), state: "usb".into(), connection: "usb".into() });
    }
}

fn run(serial: &str, args: &[&str]) -> Result<String, String> {
    let adb = adb().ok_or("adb wasn't found. Install Android SDK Platform-Tools.")?;
    let out = hidden(&adb).arg("-s").arg(serial).args(args).output().map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceDetails {
    manufacturer: String,
    model: String,
    android: String,
    sdk: String,
    battery: Option<u32>,
    charging: bool,
    /// The phone's Wi-Fi address, for switching to Wi-Fi debugging.
    ip: Option<String>,
}

pub fn details(serial: &str) -> Result<DeviceDetails, String> {
    let prop = |k: &str| run(serial, &["shell", "getprop", k]).unwrap_or_default();
    let battery = run(serial, &["shell", "dumpsys", "battery"]).unwrap_or_default();
    let value = |k: &str| battery.lines().find_map(|l| l.trim().strip_prefix(k).map(|v| v.trim().to_string()));
    let ip = run(serial, &["shell", "ip", "-f", "inet", "addr", "show", "wlan0"])
        .ok()
        .and_then(|o| o.split_whitespace().skip_while(|w| *w != "inet").nth(1).map(|a| a.split('/').next().unwrap_or("").to_string()))
        .filter(|a| !a.is_empty());
    Ok(DeviceDetails {
        manufacturer: prop("ro.product.manufacturer"),
        model: prop("ro.product.model"),
        android: prop("ro.build.version.release"),
        sdk: prop("ro.build.version.sdk"),
        battery: value("level:").and_then(|v| v.parse().ok()),
        charging: ["AC powered: true", "USB powered: true", "Wireless powered: true"].iter().any(|k| battery.contains(k)),
        ip,
    })
}

/// The phone's screen as PNG bytes.
pub fn screenshot(serial: &str) -> Result<Vec<u8>, String> {
    let adb = adb().ok_or("adb wasn't found.")?;
    let out = hidden(&adb).args(["-s", serial, "exec-out", "screencap", "-p"]).output().map_err(|e| e.to_string())?;
    if !out.status.success() || !out.stdout.starts_with(&[0x89, b'P', b'N', b'G']) {
        return Err("The phone didn't send a screenshot (is it unlocked?).".into());
    }
    Ok(out.stdout)
}

/// Opens scrcpy for this device (a separate window on the PC).
pub fn mirror(serial: &str, title: &str) -> Result<(), String> {
    let scrcpy = scrcpy().ok_or("missing")?;
    let mut c = Command::new(&scrcpy);
    c.args(["-s", serial, "--window-title", title]).stdin(std::process::Stdio::null()).stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null());
    if let Some(adb) = adb() {
        c.env("ADB", adb);
    }
    #[cfg(windows)]
    c.creation_flags(CREATE_NO_WINDOW);
    c.spawn().map(|_| ()).map_err(|e| e.to_string())
}

/// The Android app id of a project (applicationId in android/app/build.gradle[.kts]).
pub fn app_id(project: &Path) -> Option<String> {
    for name in ["build.gradle.kts", "build.gradle"] {
        let Ok(text) = std::fs::read_to_string(project.join("android").join("app").join(name)) else { continue };
        for line in text.lines() {
            let l = line.trim();
            if let Some(rest) = l.strip_prefix("applicationId") {
                let id: String = rest.trim_start_matches([' ', '=', '(']).trim().trim_matches(|c| c == '"' || c == '\'' || c == ')').to_string();
                if !id.is_empty() && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '_') {
                    return Some(id);
                }
            }
        }
    }
    None
}

/// Installed apps (package, user id) for the main user, from `pm list packages -U`.
fn packages(serial: &str) -> Result<Vec<(String, String)>, String> {
    let adb = adb().ok_or("adb wasn't found.")?;
    // Only the main user: other profiles (like Samsung's Secure Folder) make pm print errors.
    let out = hidden(&adb).args(["-s", serial, "shell", "pm", "list", "packages", "-U", "--user", "0"]).output().map_err(|e| e.to_string())?;
    Ok(parse_packages(&String::from_utf8_lossy(&out.stdout)))
}

pub fn parse_packages(out: &str) -> Vec<(String, String)> {
    out.lines()
        .filter_map(|l| {
            let rest = l.trim().strip_prefix("package:")?;
            let mut parts = rest.split_whitespace();
            let name = parts.next()?.to_string();
            let uid = parts.find_map(|p| p.strip_prefix("uid:"))?.split(',').next()?.to_string();
            uid.chars().all(|c| c.is_ascii_digit()).then_some((name, uid))
        })
        .collect()
}

/// The project's app as installed on the device: the exact id, or flavour builds of it
/// ("com.example.app.dev"), exact first.
pub fn installed_variants(serial: &str, app: &str) -> Result<Vec<String>, String> {
    let mut list: Vec<String> = packages(serial)?.into_iter().map(|(n, _)| n).filter(|n| n == app || n.starts_with(&format!("{app}."))).collect();
    list.sort_by_key(|n| (n != app, n.clone()));
    Ok(list)
}

/// The logcat command for a terminal tab: everything, or only one app (by its user id, so the
/// filter survives app restarts). PowerShell needs `&` to run a quoted program path; bash doesn't.
pub fn logcat_command(serial: &str, app: Option<&str>, powershell: bool) -> Result<String, String> {
    let adb = adb().ok_or("adb wasn't found.")?;
    let call = if powershell { "& " } else { "" };
    let adb = format!("{call}\"{}\"", adb.to_string_lossy());
    // Start from the last 200 lines rather than the whole saved log.
    let Some(app) = app else { return Ok(format!("{adb} -s {serial} logcat -v color -T 200")) };
    let uid = packages(serial)?.into_iter().find(|(n, _)| n == app).map(|(_, u)| u).ok_or_else(|| format!("{app} isn't installed on this device yet."))?;
    Ok(format!("{adb} -s {serial} logcat -v color -T 200 --uid={uid}"))
}

/// Wi-Fi debugging: restart adb on the phone in TCP mode and connect to it over the network.
pub fn to_wifi(serial: &str, ip: &str) -> Result<String, String> {
    run(serial, &["tcpip", "5555"])?;
    std::thread::sleep(std::time::Duration::from_millis(1500));
    let adb = adb().ok_or("adb wasn't found.")?;
    let target = format!("{ip}:5555");
    let out = hidden(&adb).args(["connect", &target]).output().map_err(|e| e.to_string())?;
    let text = String::from_utf8_lossy(&out.stdout).to_string();
    if text.contains("connected") {
        Ok(target)
    } else {
        Err(text.trim().to_string())
    }
}

pub fn disconnect(serial: &str) -> Result<(), String> {
    let adb = adb().ok_or("adb wasn't found.")?;
    hidden(&adb).args(["disconnect", serial]).output().map(|_| ()).map_err(|e| e.to_string())
}
