//! Built-in browser: real WebView2 pages placed inside Helm's window (one per browser pane).
//!
//! Helm drives each page through the DevTools protocol that WebView2 exposes in-process, so
//! nothing listens on a port: device emulation, screenshots, element picking and the page's
//! console and network errors all go through `CallDevToolsProtocolMethod` and its events.
//!
//! Pages never get access to Helm itself: Tauri refuses every command from non-app origins, and
//! navigation to Helm's own addresses is blocked here so a page can't load Helm's UI.

use std::cell::RefCell;
use std::collections::HashMap;
use std::rc::Rc;
use std::sync::Mutex;

use serde::Deserialize;
use serde_json::{json, Value};
use tauri::webview::{NewWindowResponse, PageLoadEvent, WebviewBuilder};
use tauri::{AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, Url, Webview, WebviewUrl, Wry};

#[cfg(windows)]
use webview2_com::{
    take_pwstr, CallDevToolsProtocolMethodCompletedHandler, DevToolsProtocolEventReceivedEventHandler,
    Microsoft::Web::WebView2::Win32::ICoreWebView2,
};
#[cfg(windows)]
use windows::core::{BOOL, HSTRING, PWSTR};

#[derive(Default)]
pub struct Browsers(Mutex<HashMap<String, Webview<Wry>>>);

impl Browsers {
    fn get(&self, pane: &str) -> Result<Webview<Wry>, String> {
        self.0.lock().unwrap().get(pane).cloned().ok_or_else(|| "This browser tab is closed.".into())
    }

    pub fn close_all(&self) {
        for (_, wv) in self.0.lock().unwrap().drain() {
            let _ = wv.close();
        }
    }
}

fn label(pane: &str) -> String {
    let safe: String = pane.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-').collect();
    format!("browser-{safe}")
}

/// Turns what was typed in the address bar into a URL ("localhost:3000" → "http://localhost:3000").
pub fn parse_url(input: &str) -> Result<Url, String> {
    let input = input.trim();
    let with_scheme = if input.contains("://") || input.starts_with("about:") || input.starts_with("file:") {
        input.to_string()
    } else if input.starts_with("localhost") || input.starts_with("127.") || input.starts_with("0.0.0.0") || input.starts_with("[::1]") {
        format!("http://{input}")
    } else {
        format!("https://{input}")
    };
    let url = Url::parse(&with_scheme).map_err(|_| "That doesn't look like a web address.".to_string())?;
    match url.scheme() {
        "http" | "https" | "file" | "about" => Ok(url),
        _ => Err("Only web pages (http and https) and files can be opened here.".into()),
    }
}

/// Helm's own pages and internal addresses: a browser tab must never load these.
pub fn is_app_url(url: &Url, dev_url: Option<&Url>) -> bool {
    if matches!(url.scheme(), "tauri" | "ipc" | "asset" | "http+tauri") {
        return true;
    }
    let host = url.host_str().unwrap_or_default().to_ascii_lowercase();
    if host.ends_with(".localhost") {
        return true; // tauri.localhost, ipc.localhost, asset.localhost…
    }
    dev_url.is_some_and(|dev| dev.host_str() == url.host_str() && dev.port_or_known_default() == url.port_or_known_default())
}

fn emit(app: &AppHandle, payload: Value) {
    let _ = app.emit_to("main", "browser", payload);
}

// ---------- DevTools protocol plumbing (Windows) ----------

/// Calls one DevTools protocol method on a page and returns its result.
#[cfg(windows)]
pub async fn cdp(wv: &Webview<Wry>, method: &str, params: Value) -> Result<Value, String> {
    let (tx, rx) = tokio::sync::oneshot::channel::<Result<String, String>>();
    let (m, p) = (HSTRING::from(method), HSTRING::from(params.to_string()));
    wv.with_webview(move |pw| unsafe {
        let Ok(core) = pw.controller().CoreWebView2() else { return };
        let handler = CallDevToolsProtocolMethodCompletedHandler::create(Box::new(move |res, json| {
            let _ = tx.send(res.map(|_| json).map_err(|e| e.message().to_string()));
            Ok(())
        }));
        // On failure the handler (and its sender) is dropped, which ends the wait below.
        let _ = core.CallDevToolsProtocolMethod(&m, &p, &handler);
    })
    .map_err(|e| e.to_string())?;
    let json = rx.await.map_err(|_| "The page didn't answer.".to_string())??;
    serde_json::from_str(&json).map_err(|e| e.to_string())
}

#[cfg(windows)]
fn call(core: &ICoreWebView2, method: &str, params: Value) {
    let handler = CallDevToolsProtocolMethodCompletedHandler::create(Box::new(|_, _| Ok(())));
    let _ = unsafe { core.CallDevToolsProtocolMethod(&HSTRING::from(method), &HSTRING::from(params.to_string()), &handler) };
}

#[cfg(windows)]
fn subscribe(core: &ICoreWebView2, event: &str, mut on: impl FnMut(&ICoreWebView2, Value) + 'static) {
    let Ok(receiver) = (unsafe { core.GetDevToolsProtocolEventReceiver(&HSTRING::from(event)) }) else { return };
    let handler = DevToolsProtocolEventReceivedEventHandler::create(Box::new(move |sender, args| {
        if let (Some(sender), Some(args)) = (sender, args) {
            let mut raw = PWSTR::null();
            if unsafe { args.ParameterObjectAsJson(&mut raw) }.is_ok() {
                if let Ok(value) = serde_json::from_str::<Value>(&take_pwstr(raw)) {
                    on(&sender, value);
                }
            }
        }
        Ok(())
    }));
    let mut token = 0i64;
    let _ = unsafe { receiver.add_DevToolsProtocolEventReceived(&handler, &mut token) };
}

#[cfg(windows)]
fn history(core: &ICoreWebView2) -> (bool, bool) {
    let (mut back, mut forward) = (BOOL(0), BOOL(0));
    unsafe {
        let _ = core.CanGoBack(&mut back);
        let _ = core.CanGoForward(&mut forward);
    }
    (back.as_bool(), forward.as_bool())
}

fn text_of(arg: &Value) -> String {
    if let Some(s) = arg.get("value").and_then(Value::as_str) {
        return s.to_string();
    }
    if let Some(v) = arg.get("value") {
        if !v.is_null() {
            return v.to_string();
        }
    }
    arg.get("description")
        .or_else(|| arg.get("unserializableValue"))
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string()
}

fn location(url: Option<&str>, line: Option<i64>) -> Option<String> {
    let url = url.filter(|u| !u.is_empty())?;
    Some(match line {
        Some(l) => format!("{url}:{}", l + 1),
        None => url.to_string(),
    })
}

/// Sends the page's errors, URL changes and picked elements to the Helm window.
#[cfg(windows)]
fn watch(app: &AppHandle, wv: &Webview<Wry>, pane: &str) {
    let (app, pane) = (app.clone(), pane.to_string());
    let _ = wv.with_webview(move |pw| unsafe {
        let Ok(core) = pw.controller().CoreWebView2() else { return };
        if let Ok(settings) = core.Settings() {
            // The page's own DevTools and right-click menu are for the user's site, not Helm.
            let _ = settings.SetAreDevToolsEnabled(true);
            let _ = settings.SetAreDefaultContextMenusEnabled(true);
        }
        for method in ["Runtime.enable", "Log.enable", "Network.enable", "Page.enable"] {
            call(&core, method, json!({}));
        }

        let problem = {
            let (app, pane) = (app.clone(), pane.clone());
            move |level: &str, source: &str, text: String, at: Option<String>| {
                let text: String = text.chars().take(2000).collect();
                emit(&app, json!({ "kind": "problem", "pane": pane, "problem": { "level": level, "source": source, "text": text, "at": at } }));
            }
        };

        let p = problem.clone();
        subscribe(&core, "Runtime.consoleAPICalled", move |_, v| {
            let level = match v["type"].as_str() {
                Some("error" | "assert") => "error",
                Some("warning") => "warning",
                _ => return,
            };
            let text = v["args"].as_array().map(|a| a.iter().map(text_of).collect::<Vec<_>>().join(" ")).unwrap_or_default();
            let frame = &v["stackTrace"]["callFrames"][0];
            p(level, "console", text, location(frame["url"].as_str(), frame["lineNumber"].as_i64()));
        });

        let p = problem.clone();
        subscribe(&core, "Runtime.exceptionThrown", move |_, v| {
            let d = &v["exceptionDetails"];
            let text = d["exception"]["description"].as_str().or(d["text"].as_str()).unwrap_or("Uncaught error").to_string();
            p("error", "exception", text, location(d["url"].as_str(), d["lineNumber"].as_i64()));
        });

        let p = problem.clone();
        subscribe(&core, "Log.entryAdded", move |_, v| {
            let e = &v["entry"];
            // Network failures are reported (with more detail) by the Network events below.
            if e["level"].as_str() == Some("error") && e["source"].as_str() != Some("network") {
                p("error", "browser", e["text"].as_str().unwrap_or_default().to_string(), location(e["url"].as_str(), e["lineNumber"].as_i64()));
            }
        });

        // Request id → "GET https://…", so failures can say what failed.
        let requests: Rc<RefCell<HashMap<String, String>>> = Rc::default();
        let r = requests.clone();
        subscribe(&core, "Network.requestWillBeSent", move |_, v| {
            let mut map = r.borrow_mut();
            if map.len() > 3000 {
                map.clear();
            }
            if let (Some(id), Some(url)) = (v["requestId"].as_str(), v["request"]["url"].as_str()) {
                if !url.starts_with("data:") {
                    map.insert(id.to_string(), format!("{} {url}", v["request"]["method"].as_str().unwrap_or("GET")));
                }
            }
        });
        let (r, p) = (requests.clone(), problem.clone());
        subscribe(&core, "Network.responseReceived", move |_, v| {
            let status = v["response"]["status"].as_i64().unwrap_or(0);
            // A missing favicon is noise, not a problem with the app.
            let favicon = v["response"]["url"].as_str().is_some_and(|u| u.ends_with("/favicon.ico"));
            if status >= 400 && !favicon {
                let what = r.borrow().get(v["requestId"].as_str().unwrap_or_default()).cloned().unwrap_or_else(|| v["response"]["url"].as_str().unwrap_or_default().to_string());
                let reason = v["response"]["statusText"].as_str().filter(|s| !s.is_empty()).map(|s| format!(" {s}")).unwrap_or_default();
                p("error", "network", format!("{what} → {status}{reason}"), None);
            }
        });
        let (r, p) = (requests, problem);
        subscribe(&core, "Network.loadingFailed", move |_, v| {
            if v["canceled"].as_bool() == Some(true) {
                return;
            }
            if let Some(what) = r.borrow().get(v["requestId"].as_str().unwrap_or_default()).cloned() {
                p("error", "network", format!("{what} → {}", v["errorText"].as_str().unwrap_or("failed")), None);
            }
        });

        // Address and back/forward state, including single-page-app navigation.
        let url_changed = {
            let (app, pane) = (app.clone(), pane.clone());
            move |core: &ICoreWebView2, url: &str| {
                let (back, forward) = history(core);
                emit(&app, json!({ "kind": "url", "pane": pane, "url": url, "canBack": back, "canForward": forward }));
            }
        };
        let u = url_changed.clone();
        subscribe(&core, "Page.frameNavigated", move |core, v| {
            if v["frame"]["parentId"].is_null() {
                u(core, v["frame"]["url"].as_str().unwrap_or_default());
            }
        });
        subscribe(&core, "Page.navigatedWithinDocument", move |core, v| url_changed(core, v["url"].as_str().unwrap_or_default()));

        // Element picking: Helm's picker in the page reports the clicked element through a binding.
        let (app2, pane2) = (app.clone(), pane.clone());
        subscribe(&core, "Runtime.bindingCalled", move |_, v| {
            let Some(name) = v["name"].as_str().filter(|n| n.starts_with(PICK_BINDING)) else { return };
            let payload = v["payload"].as_str().unwrap_or_default();
            match serde_json::from_str::<Value>(payload) {
                Ok(element) if element.is_object() => emit(&app2, json!({ "kind": "picked", "pane": pane2, "element": element })),
                _ => emit(&app2, json!({ "kind": "pickCancelled", "pane": pane2 })),
            }
            let (app, pane, name) = (app2.clone(), pane2.clone(), name.to_string());
            tauri::async_runtime::spawn(async move {
                if let Ok(wv) = app.state::<Browsers>().get(&pane) {
                    let _ = cdp(&wv, "Runtime.removeBinding", json!({ "name": name })).await;
                }
            });
        });
    });
}

const PICK_BINDING: &str = "__helmPick";

/// Helm's element picker, injected into the page while "pick" mode is on. It outlines what's
/// under the pointer, and on click reports a selector, text and trimmed HTML through the binding.
const PICKER: &str = r#"(() => {
  const send = window['__BINDING__'];
  if (window.__helmPickStop) window.__helmPickStop();
  const box = document.createElement('div');
  const tag = document.createElement('div');
  const base = 'position:fixed;z-index:2147483647;pointer-events:none;';
  box.style.cssText = base + 'border:2px solid #e0a458;background:rgba(224,164,88,.18);border-radius:3px;transition:all 60ms;display:none';
  tag.style.cssText = base + 'font:12px/1.4 ui-monospace,Consolas,monospace;background:#1f2024;color:#fff;padding:3px 7px;border-radius:5px;display:none;max-width:70vw;white-space:nowrap;overflow:hidden;text-overflow:ellipsis';
  document.documentElement.append(box, tag);
  const part = (e) => {
    if (e.id) return '#' + CSS.escape(e.id);
    let s = e.localName;
    const cls = [...e.classList].filter((c) => !/^(hover|active|focus)/.test(c)).slice(0, 2);
    if (cls.length) s += '.' + cls.map((c) => CSS.escape(c)).join('.');
    const p = e.parentElement;
    if (p) {
      const same = [...p.children].filter((c) => c.localName === e.localName);
      if (same.length > 1) s += ':nth-of-type(' + (same.indexOf(e) + 1) + ')';
    }
    return s;
  };
  const selector = (el) => {
    const path = [];
    for (let e = el; e && e.nodeType === 1 && path.length < 6; e = e.parentElement) {
      path.unshift(part(e));
      if (e.id || e.localName === 'body') break;
    }
    return path.join(' > ');
  };
  let current = null;
  const show = (el) => {
    if (!el || el === box || el === tag) return;
    current = el;
    const r = el.getBoundingClientRect();
    Object.assign(box.style, { display: 'block', left: r.left - 2 + 'px', top: r.top - 2 + 'px', width: r.width + 4 + 'px', height: r.height + 4 + 'px' });
    tag.textContent = selector(el) + '  ' + Math.round(r.width) + '×' + Math.round(r.height);
    tag.style.display = 'block';
    tag.style.left = Math.max(4, r.left) + 'px';
    tag.style.top = (r.top > 30 ? r.top - 26 : r.bottom + 6) + 'px';
  };
  const describe = (el) => {
    const r = el.getBoundingClientRect();
    const html = el.outerHTML;
    return {
      selector: selector(el),
      tag: el.localName,
      text: (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 300),
      html: html.length > 1500 ? html.slice(0, 1500) + '…' : html,
      size: Math.round(r.width) + '×' + Math.round(r.height),
      page: location.href,
    };
  };
  const stop = () => {
    removeEventListener('pointermove', move, true);
    removeEventListener('pointerdown', block, true);
    removeEventListener('mousedown', block, true);
    removeEventListener('click', click, true);
    removeEventListener('keydown', key, true);
    box.remove();
    tag.remove();
    delete window.__helmPickStop;
  };
  const move = (e) => show(document.elementFromPoint(e.clientX, e.clientY));
  const block = (e) => { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); };
  const click = (e) => {
    block(e);
    const el = document.elementFromPoint(e.clientX, e.clientY) || current;
    stop();
    if (el) send(JSON.stringify(describe(el)));
  };
  const key = (e) => { if (e.key === 'Escape') { block(e); stop(); send('"cancel"'); } };
  addEventListener('pointermove', move, true);
  addEventListener('pointerdown', block, true);
  addEventListener('mousedown', block, true);
  addEventListener('click', click, true);
  addEventListener('keydown', key, true);
  window.__helmPickStop = stop;
})()"#;

// ---------- commands ----------

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn browser_open(app: AppHandle, pane_id: String, url: String, x: f64, y: f64, width: f64, height: f64) -> Result<(), String> {
    let state = app.state::<Browsers>();
    if let Ok(wv) = state.get(&pane_id) {
        let _ = wv.set_position(LogicalPosition::new(x, y));
        let _ = wv.set_size(LogicalSize::new(width.max(1.0), height.max(1.0)));
        return Ok(());
    }
    let target = parse_url(&url)?;
    let dev_url = app.config().build.dev_url.clone();
    if is_app_url(&target, dev_url.as_ref()) {
        return Err("That address belongs to Helm itself.".into());
    }
    let window = app.get_window("main").ok_or("Helm's window isn't ready.")?;

    let (a1, p1) = (app.clone(), pane_id.clone());
    let (a2, p2) = (app.clone(), pane_id.clone());
    let (a3, p3) = (app.clone(), pane_id.clone());
    let (a4, p4) = (app.clone(), pane_id.clone());
    let builder = WebviewBuilder::new(label(&pane_id), WebviewUrl::External(target))
        .devtools(true)
        .on_navigation(move |url| {
            let allowed = !is_app_url(url, dev_url.as_ref());
            if !allowed {
                emit(&a1, json!({ "kind": "blocked", "pane": p1, "url": url.as_str() }));
            }
            allowed
        })
        .on_page_load(move |_, payload| {
            let loading = matches!(payload.event(), PageLoadEvent::Started);
            emit(&a2, json!({ "kind": "load", "pane": p2, "url": payload.url().as_str(), "loading": loading }));
        })
        .on_document_title_changed(move |_, title| emit(&a3, json!({ "kind": "title", "pane": p3, "title": title })))
        .on_new_window(move |url, _| {
            // Links that open a new window become a new browser tab in Helm.
            emit(&a4, json!({ "kind": "newWindow", "pane": p4, "url": url.as_str() }));
            NewWindowResponse::Deny
        });
    let wv = window
        .add_child(builder, LogicalPosition::new(x, y), LogicalSize::new(width.max(1.0), height.max(1.0)))
        .map_err(|e| e.to_string())?;
    #[cfg(windows)]
    watch(&app, &wv, &pane_id);
    state.0.lock().unwrap().insert(pane_id, wv);
    Ok(())
}

#[tauri::command]
pub fn browser_bounds(app: AppHandle, pane_id: String, x: f64, y: f64, width: f64, height: f64) -> Result<(), String> {
    let wv = app.state::<Browsers>().get(&pane_id)?;
    wv.set_position(LogicalPosition::new(x, y)).map_err(|e| e.to_string())?;
    wv.set_size(LogicalSize::new(width.max(1.0), height.max(1.0))).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn browser_visible(app: AppHandle, pane_id: String, visible: bool) -> Result<(), String> {
    let wv = app.state::<Browsers>().get(&pane_id)?;
    if visible { wv.show() } else { wv.hide() }.map_err(|e| e.to_string())
}

#[tauri::command]
pub fn browser_navigate(app: AppHandle, pane_id: String, url: String) -> Result<String, String> {
    let wv = app.state::<Browsers>().get(&pane_id)?;
    let target = parse_url(&url)?;
    if is_app_url(&target, app.config().build.dev_url.as_ref()) {
        return Err("That address belongs to Helm itself.".into());
    }
    wv.navigate(target.clone()).map_err(|e| e.to_string())?;
    Ok(target.to_string())
}

/// Back, forward, reload or stop.
#[tauri::command]
pub fn browser_go(app: AppHandle, pane_id: String, action: String) -> Result<(), String> {
    let wv = app.state::<Browsers>().get(&pane_id)?;
    if action == "reload" {
        return wv.reload().map_err(|e| e.to_string());
    }
    #[cfg(windows)]
    wv.with_webview(move |pw| unsafe {
        if let Ok(core) = pw.controller().CoreWebView2() {
            let _ = match action.as_str() {
                "back" => core.GoBack(),
                "forward" => core.GoForward(),
                "stop" => core.Stop(),
                _ => Ok(()),
            };
        }
    })
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn browser_close(app: AppHandle, pane_id: String) {
    if let Some(wv) = app.state::<Browsers>().0.lock().unwrap().remove(&pane_id) {
        let _ = wv.close();
    }
}

#[tauri::command]
pub fn browser_keep_only(app: AppHandle, pane_ids: Vec<String>) {
    let state = app.state::<Browsers>();
    let mut map = state.0.lock().unwrap();
    map.retain(|pane, wv| {
        let keep = pane_ids.contains(pane);
        if !keep {
            let _ = wv.close();
        }
        keep
    });
}

#[tauri::command]
pub fn browser_devtools(app: AppHandle, pane_id: String) -> Result<(), String> {
    let wv = app.state::<Browsers>().get(&pane_id)?;
    #[cfg(windows)]
    wv.with_webview(|pw| unsafe {
        if let Ok(core) = pw.controller().CoreWebView2() {
            let _ = core.OpenDevToolsWindow();
        }
    })
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Device {
    width: u32,
    height: u32,
    scale_factor: f64,
    mobile: bool,
    touch: bool,
    user_agent: Option<String>,
    /// How much the page is scaled down to fit the panel.
    fit: f64,
}

/// Emulates a phone, tablet or laptop screen, or (with `None`) goes back to the plain window size.
#[tauri::command]
pub async fn browser_emulate(app: AppHandle, pane_id: String, device: Option<Device>) -> Result<(), String> {
    #[cfg(windows)]
    {
        let wv = app.state::<Browsers>().get(&pane_id)?;
        match device {
            Some(d) => {
                cdp(&wv, "Emulation.setDeviceMetricsOverride", json!({
                    "width": d.width, "height": d.height, "deviceScaleFactor": d.scale_factor, "mobile": d.mobile,
                    "scale": d.fit, "screenWidth": d.width, "screenHeight": d.height,
                }))
                .await?;
                let ua = match d.user_agent {
                    Some(ua) => ua,
                    None => default_user_agent(&wv).await,
                };
                cdp(&wv, "Emulation.setUserAgentOverride", json!({ "userAgent": ua })).await?;
                cdp(&wv, "Emulation.setTouchEmulationEnabled", json!({ "enabled": d.touch, "maxTouchPoints": if d.touch { 5 } else { 1 } })).await?;
                cdp(&wv, "Emulation.setEmitTouchEventsForMouse", json!({ "enabled": d.touch, "configuration": "mobile" })).await?;
            }
            None => {
                cdp(&wv, "Emulation.clearDeviceMetricsOverride", json!({})).await?;
                let ua = default_user_agent(&wv).await;
                cdp(&wv, "Emulation.setUserAgentOverride", json!({ "userAgent": ua })).await?;
                cdp(&wv, "Emulation.setTouchEmulationEnabled", json!({ "enabled": false })).await?;
                cdp(&wv, "Emulation.setEmitTouchEventsForMouse", json!({ "enabled": false })).await?;
            }
        }
    }
    #[cfg(not(windows))]
    let _ = (app, pane_id, device);
    Ok(())
}

#[cfg(windows)]
async fn default_user_agent(wv: &Webview<Wry>) -> String {
    cdp(wv, "Browser.getVersion", json!({}))
        .await
        .ok()
        .and_then(|v| v["userAgent"].as_str().map(String::from))
        .unwrap_or_default()
}

/// Saves what the page shows (at the emulated device's resolution) as a PNG and returns its path.
#[tauri::command]
pub async fn browser_screenshot(app: AppHandle, pane_id: String) -> Result<String, String> {
    #[cfg(windows)]
    {
        use base64::Engine;
        let wv = app.state::<Browsers>().get(&pane_id)?;
        let shot = cdp(&wv, "Page.captureScreenshot", json!({ "format": "png", "fromSurface": true })).await?;
        let data = shot["data"].as_str().ok_or("The page couldn't be captured.")?;
        let bytes = base64::engine::general_purpose::STANDARD.decode(data).map_err(|e| e.to_string())?;
        let dir = crate::data_dir(&app).join("screenshots");
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0);
        let path = dir.join(format!("page-{stamp}.png"));
        std::fs::write(&path, bytes).map_err(|e| e.to_string())?;
        Ok(path.to_string_lossy().into_owned())
    }
    #[cfg(not(windows))]
    {
        let _ = (app, pane_id);
        Err("Not available on this system.".into())
    }
}

/// Turns "pick an element" mode on or off; a click on the page then reports the element.
#[tauri::command]
pub async fn browser_pick(app: AppHandle, pane_id: String, on: bool) -> Result<(), String> {
    #[cfg(windows)]
    {
        let wv = app.state::<Browsers>().get(&pane_id)?;
        if on {
            // A fresh binding name each time, so only Helm's picker (not the page) knows it.
            let nonce = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
            let name = format!("{PICK_BINDING}{nonce}");
            cdp(&wv, "Runtime.addBinding", json!({ "name": name })).await?;
            cdp(&wv, "Runtime.evaluate", json!({ "expression": PICKER.replace("__BINDING__", &name) })).await?;
        } else {
            cdp(&wv, "Runtime.evaluate", json!({ "expression": "window.__helmPickStop && window.__helmPickStop()" })).await?;
        }
    }
    #[cfg(not(windows))]
    let _ = (app, pane_id, on);
    Ok(())
}
