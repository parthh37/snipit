use std::{path::PathBuf, sync::Mutex, thread, time::Duration};

use serde::{Deserialize, Serialize};
use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, Runtime, WebviewUrl,
    WebviewWindowBuilder, ipc::Response,
};
use xcap::{Monitor, image::RgbaImage};

use crate::{clipboard, gallery, settings, settings::AfterCapture, tray};

pub const OVERLAY: &str = "overlay";

#[derive(Debug, Clone, Copy)]
pub enum CaptureMode {
    Region,
    Fullscreen,
}

/// The frozen screen shown by the region overlay while the user selects an area.
#[derive(Default)]
pub struct CaptureState(Mutex<Session>);

#[derive(Default)]
struct Session {
    frozen: Option<RgbaImage>,
    /// Whether the main window was hidden for the capture and should come back afterwards.
    restore_main: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct OpenEditor {
    path: PathBuf,
}

/// Creates the (hidden) overlay window up front so a capture shows without a webview
/// start-up delay.
pub fn init<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    WebviewWindowBuilder::new(app, OVERLAY, WebviewUrl::App("index.html".into()))
        .title("Snipit capture")
        .visible(false)
        .focused(false)
        .decorations(false)
        .shadow(false)
        .resizable(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .build()?;
    Ok(())
}

/// Starts a capture on the monitor under the cursor. Runs off the event loop thread.
pub fn start<R: Runtime>(app: &AppHandle<R>, mode: CaptureMode) {
    let app = app.clone();
    thread::spawn(move || {
        if let Err(e) = run(&app, mode) {
            report_error(&app, format!("Capture failed: {e}"));
        }
    });
}

fn run<R: Runtime>(app: &AppHandle<R>, mode: CaptureMode) -> Result<(), String> {
    let overlay = app
        .get_webview_window(OVERLAY)
        .ok_or("overlay window missing")?;
    if overlay.is_visible().unwrap_or(false) {
        return Ok(());
    }

    // Keep Snipit's own window out of the shot.
    let restore_main = hide_main(app);
    if restore_main {
        thread::sleep(Duration::from_millis(200));
    }

    let cursor = app.cursor_position().map_err(|e| e.to_string())?;
    let monitor = Monitor::from_point(cursor.x as i32, cursor.y as i32)
        .or_else(|_| {
            Monitor::all()?
                .into_iter()
                .find(|m| m.is_primary().unwrap_or(false))
                .ok_or(xcap::XCapError::new("no monitor found"))
        })
        .map_err(|e| e.to_string())?;
    let image = monitor.capture_image().map_err(|e| e.to_string())?;

    match mode {
        CaptureMode::Fullscreen => {
            let action = settings::get(app).after_capture;
            finish(app, &image, action, restore_main)
        }
        CaptureMode::Region => {
            let position = PhysicalPosition::new(
                monitor.x().map_err(|e| e.to_string())?,
                monitor.y().map_err(|e| e.to_string())?,
            );
            let size = PhysicalSize::new(image.width(), image.height());
            *app.state::<CaptureState>().0.lock().unwrap() = Session {
                frozen: Some(image),
                restore_main,
            };
            // Twice: moving onto a monitor with a different scale factor can resize the window.
            for _ in 0..2 {
                overlay.set_position(position).map_err(|e| e.to_string())?;
                overlay.set_size(size).map_err(|e| e.to_string())?;
            }
            // The overlay draws the frozen frame, then calls `overlay_ready` to show itself.
            overlay
                .emit_to(OVERLAY, "overlay:capture", ())
                .map_err(|e| e.to_string())
        }
    }
}

/// Saves the snip to the gallery, then copies it or opens it in the editor.
fn finish<R: Runtime>(
    app: &AppHandle<R>,
    image: &RgbaImage,
    action: AfterCapture,
    restore_main: bool,
) -> Result<(), String> {
    let path = gallery::save_new(app, &gallery::encode_png(image)?)?;
    let _ = app.emit_to("main", "gallery:changed", ());
    match action {
        AfterCapture::Copy => {
            clipboard::copy_image(image)?;
            if restore_main {
                tray::show_main_window(app);
            }
        }
        AfterCapture::Edit => open_editor(app, path),
    }
    Ok(())
}

pub fn open_editor<R: Runtime>(app: &AppHandle<R>, path: PathBuf) {
    tray::show_main_window(app);
    let _ = app.emit_to("main", "editor:open", OpenEditor { path });
}

fn hide_main<R: Runtime>(app: &AppHandle<R>) -> bool {
    let Some(main) = app.get_webview_window("main") else {
        return false;
    };
    let visible = main.is_visible().unwrap_or(false) && !main.is_minimized().unwrap_or(false);
    if visible {
        let _ = main.hide();
    }
    visible
}

fn report_error<R: Runtime>(app: &AppHandle<R>, message: String) {
    eprintln!("{message}");
    tray::show_main_window(app);
    let _ = app.emit_to("main", "app:error", message);
}

/// Saves the clipboard image as a snip and opens it in the editor.
pub fn annotate_clipboard<R: Runtime>(app: &AppHandle<R>) {
    let result = clipboard::read_image().and_then(|image| {
        let image = image.ok_or("The clipboard doesn't contain an image.")?;
        let path = gallery::save_new(app, &gallery::encode_png(&image)?)?;
        let _ = app.emit_to("main", "gallery:changed", ());
        open_editor(app, path);
        Ok(())
    });
    if let Err(e) = result {
        report_error(app, e);
    }
}

#[tauri::command]
pub fn start_capture(app: AppHandle, mode: String) {
    let mode = if mode == "fullscreen" {
        CaptureMode::Fullscreen
    } else {
        CaptureMode::Region
    };
    start(&app, mode);
}

#[tauri::command]
pub async fn annotate_clipboard_cmd(app: AppHandle) {
    annotate_clipboard(&app);
}

/// The frozen frame as `[width u32 LE][height u32 LE][RGBA bytes]`.
#[tauri::command]
pub fn get_frozen(state: tauri::State<'_, CaptureState>) -> Result<Response, String> {
    let session = state.0.lock().unwrap();
    let image = session.frozen.as_ref().ok_or("no capture in progress")?;
    let mut bytes = Vec::with_capacity(8 + image.as_raw().len());
    bytes.extend_from_slice(&image.width().to_le_bytes());
    bytes.extend_from_slice(&image.height().to_le_bytes());
    bytes.extend_from_slice(image.as_raw());
    Ok(Response::new(bytes))
}

#[tauri::command]
pub fn overlay_ready(window: tauri::WebviewWindow) -> Result<(), String> {
    window.show().map_err(|e| e.to_string())?;
    window.set_focus().map_err(|e| e.to_string())
}

#[derive(Debug, Deserialize)]
pub struct Region {
    x: u32,
    y: u32,
    width: u32,
    height: u32,
}

/// Ends the region capture. `action: None` cancels it.
#[tauri::command]
pub async fn finish_region(
    app: AppHandle,
    region: Option<Region>,
    action: Option<AfterCapture>,
) -> Result<(), String> {
    let session = std::mem::take(&mut *app.state::<CaptureState>().0.lock().unwrap());
    if let Some(overlay) = app.get_webview_window(OVERLAY) {
        let _ = overlay.hide();
    }

    let (Some(frozen), Some(region), Some(action)) = (session.frozen, region, action) else {
        if session.restore_main {
            tray::show_main_window(&app);
        }
        return Ok(());
    };

    let x = region.x.min(frozen.width() - 1);
    let y = region.y.min(frozen.height() - 1);
    let width = region.width.clamp(1, frozen.width() - x);
    let height = region.height.clamp(1, frozen.height() - y);
    let cropped = xcap::image::imageops::crop_imm(&frozen, x, y, width, height).to_image();
    finish(&app, &cropped, action, session.restore_main).inspect_err(|e| {
        report_error(&app, e.clone());
    })
}
