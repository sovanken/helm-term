//! Windows toast with Allow / Deny buttons for permission requests, answered without opening Helm.

use serde_json::{Value, json};
use tauri::{AppHandle, Manager};

use crate::bridge::{self, Bridge};

fn focus_main(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

#[cfg(windows)]
fn app_id(app: &AppHandle) -> String {
    // Installed builds are registered under the app identifier; dev builds borrow PowerShell's.
    if cfg!(debug_assertions) {
        tauri_winrt_notification::Toast::POWERSHELL_APP_ID.to_string()
    } else {
        app.config().identifier.clone()
    }
}

/// A plain notification. Clicking it brings Helm to the front.
#[cfg(windows)]
pub fn show(app: &AppHandle, title: &str, body: &str, silent: bool) -> Result<(), String> {
    use tauri_winrt_notification::{Sound, Toast};
    let handle = app.clone();
    Toast::new(&app_id(app))
        .title(title)
        .text1(body)
        .sound(if silent { None } else { Some(Sound::Default) })
        .on_activated(move |_| {
            focus_main(&handle);
            Ok(())
        })
        .show()
        .map_err(|e| e.to_string())
}

#[cfg(not(windows))]
pub fn show(_app: &AppHandle, _title: &str, _body: &str, _silent: bool) -> Result<(), String> {
    Ok(())
}

/// Shows the toast. Clicking a button answers the request; clicking the toast body opens Helm.
#[cfg(windows)]
pub fn show_approval(app: &AppHandle, id: &str, title: &str, body: &str, detail: &str, silent: bool) -> Result<(), String> {
    use tauri_winrt_notification::{Duration, Sound, Toast};

    let pending = app.state::<Bridge>().pending();
    let handle = app.clone();
    let request = id.to_string();

    Toast::new(&app_id(app))
        .title(title)
        .text1(body)
        .text2(detail)
        .duration(Duration::Long)
        .sound(if silent { None } else { Some(Sound::Default) })
        .add_button("Allow", "allow")
        .add_button("Deny", "deny")
        .on_activated(move |action| {
            let decision: Option<Value> = match action.as_deref() {
                Some("allow") => Some(json!({ "behavior": "allow" })),
                Some("deny") => Some(json!({ "behavior": "deny", "message": "Denied from a Helm notification" })),
                _ => {
                    focus_main(&handle);
                    return Ok(());
                }
            };
            bridge::respond(&pending, &request, decision);
            Ok(())
        })
        .show()
        .map_err(|e| e.to_string())
}

#[cfg(not(windows))]
pub fn show_approval(_app: &AppHandle, _id: &str, _title: &str, _body: &str, _detail: &str, _silent: bool) -> Result<(), String> {
    Ok(())
}
