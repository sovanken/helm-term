//! Saves what Helm's window prints (a report laid out with print styles) as a PDF, using
//! WebView2's built-in PrintToPdf: no print dialog, real text, backgrounds included.

use tauri::{AppHandle, Manager};

#[cfg(windows)]
pub async fn print(app: &AppHandle, path: String) -> Result<(), String> {
    use webview2_com::{
        Microsoft::Web::WebView2::Win32::{ICoreWebView2Environment6, ICoreWebView2_7},
        PrintToPdfCompletedHandler,
    };
    use windows::core::{Interface, HSTRING};

    let webview = app.get_webview("main").ok_or("Helm's window isn't ready.")?;
    let (tx, rx) = tokio::sync::oneshot::channel::<Result<bool, String>>();
    webview
        .with_webview(move |pw| unsafe {
            let run = || -> windows::core::Result<()> {
                let core = pw.controller().CoreWebView2()?.cast::<ICoreWebView2_7>()?;
                let settings = pw.environment().cast::<ICoreWebView2Environment6>()?.CreatePrintSettings()?;
                settings.SetShouldPrintBackgrounds(true)?;
                settings.SetShouldPrintHeaderAndFooter(false)?;
                // A4, in inches.
                settings.SetPageWidth(8.27)?;
                settings.SetPageHeight(11.69)?;
                // Inches; the report sets its own padding.
                settings.SetMarginTop(0.0)?;
                settings.SetMarginBottom(0.0)?;
                settings.SetMarginLeft(0.0)?;
                settings.SetMarginRight(0.0)?;
                let handler = PrintToPdfCompletedHandler::create(Box::new(move |hr, ok| {
                    let _ = tx.send(hr.map(|_| ok).map_err(|e| e.message().to_string()));
                    Ok(())
                }));
                core.PrintToPdf(&HSTRING::from(path), &settings, &handler)
            };
            // On failure the handler (and its sender) is dropped, which ends the wait below.
            let _ = run();
        })
        .map_err(|e| e.to_string())?;
    match rx.await {
        Ok(Ok(true)) => Ok(()),
        Ok(Ok(false)) => Err("The PDF couldn't be written. Is the file open in another app?".into()),
        Ok(Err(e)) => Err(e),
        Err(_) => Err("The PDF couldn't be created.".into()),
    }
}

#[cfg(not(windows))]
pub async fn print(_app: &AppHandle, _path: String) -> Result<(), String> {
    Err("Saving as PDF isn't available on this system yet.".into())
}
