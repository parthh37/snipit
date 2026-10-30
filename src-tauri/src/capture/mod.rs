//! Screen capture sessions.
//!
//! A capture freezes every monitor into memory first, then opens one borderless overlay window
//! per monitor showing that frozen frame. The user selects on the still image, so menus and
//! hover states stay exactly as they were when the hotkey was pressed. All geometry is in
//! physical pixels; overlays work in coordinates local to their own monitor.

pub mod geometry;
mod window_list;

use std::path::PathBuf;
use std::sync::Mutex;
use std::thread;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, State, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder, ipc::Response,
};
use xcap::Monitor;
use xcap::image::{RgbaImage, imageops};

use crate::settings::{self, AfterCapture};
use crate::{clipboard, gallery, shortcuts, tray};
use geometry::{Point, Rect};

const OVERLAY_PREFIX: &str = "overlay-";
/// A new snip was saved to the gallery.
pub const CAPTURE_SAVED_EVENT: &str = "capture-saved";
/// Asks the main window to open a snip in the editor.
pub const EDITOR_OPEN_EVENT: &str = "editor:open";
/// A capture or clipboard import failed; the payload is the message to show.
pub const ERROR_EVENT: &str = "app:error";

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CaptureMode {
    /// Overlay where the user drags a region or clicks a window.
    Interactive,
    /// The whole monitor under the cursor, no overlay.
    Fullscreen,
}

struct FrozenMonitor {
    bounds: Rect,
    image: RgbaImage,
}

struct Session {
    monitors: Vec<FrozenMonitor>,
    /// Global window bounds, topmost first.
    windows: Vec<Rect>,
    cursor: Option<Point>,
    /// Whether the main window was hidden for the capture and should come back afterwards.
    restore_main: bool,
}

impl Session {
    fn monitor_under_cursor(&self) -> usize {
        self.cursor
            .and_then(|c| self.monitors.iter().position(|m| m.bounds.contains(c)))
            .unwrap_or(0)
    }

    /// Crops `local` (relative to monitor `index`) out of the frozen frame.
    fn crop(&self, index: usize, local: Rect) -> Option<RgbaImage> {
        let monitor = self.monitors.get(index)?;
        let full = Rect::new(0, 0, monitor.bounds.width, monitor.bounds.height);
        let r = local.intersect(&full)?;
        Some(
            imageops::crop_imm(&monitor.image, r.x as u32, r.y as u32, r.width, r.height)
                .to_image(),
        )
    }
}

#[derive(Default)]
pub struct CaptureState(Mutex<Option<Session>>);

#[derive(Debug, Clone, Serialize)]
struct CaptureSaved {
    path: PathBuf,
    copied: bool,
}

#[derive(Debug, Clone, Serialize)]
struct OpenEditor {
    path: PathBuf,
}

/// Starts a capture on a background thread. `settle` gives menus and our own window time to
/// disappear before the screen is frozen (not needed for the hotkey).
pub fn start(app: &AppHandle, mode: CaptureMode, settle: bool) {
    let app = app.clone();
    thread::spawn(move || {
        if let Err(err) = run(&app, mode, settle) {
            report_error(&app, format!("Capture failed: {err}"));
        }
    });
}

fn run(app: &AppHandle, mode: CaptureMode, settle: bool) -> Result<(), String> {
    let state = app.state::<CaptureState>();
    let mut slot = state.0.lock().map_err(|e| e.to_string())?;
    if slot.is_some() {
        return Ok(()); // A capture is already open.
    }

    let restore_main = hide_main(app);
    if restore_main {
        thread::sleep(Duration::from_millis(250));
    } else if settle {
        thread::sleep(Duration::from_millis(150));
    }

    let session = freeze(app, restore_main)?;
    match mode {
        CaptureMode::Fullscreen => {
            let index = session.monitor_under_cursor();
            let bounds = session.monitors[index].bounds;
            let full = Rect::new(0, 0, bounds.width, bounds.height);
            let image = session.crop(index, full).ok_or("Empty monitor")?;
            drop(slot);
            deliver(app, &image, restore_main)
        }
        CaptureMode::Interactive => {
            let bounds: Vec<Rect> = session.monitors.iter().map(|m| m.bounds).collect();
            *slot = Some(session);
            drop(slot);
            // The overlays may not get keyboard focus (another app can hold the foreground),
            // so Esc is grabbed globally for as long as they are open.
            shortcuts::grab_escape(app);
            for (i, b) in bounds.into_iter().enumerate() {
                if let Err(err) = open_overlay(app, i, b) {
                    cancel(app);
                    return Err(err.to_string());
                }
            }
            Ok(())
        }
    }
}

/// Hides Snipit's own window so it stays out of the shot; returns whether it was showing.
fn hide_main(app: &AppHandle) -> bool {
    let Some(main) = app.get_webview_window("main") else {
        return false;
    };
    let showing = main.is_visible().unwrap_or(false) && !main.is_minimized().unwrap_or(false);
    if showing {
        let _ = main.hide();
    }
    showing
}

fn freeze(app: &AppHandle, restore_main: bool) -> Result<Session, String> {
    let cursor = app.cursor_position().ok().map(|p| Point {
        x: p.x as i32,
        y: p.y as i32,
    });
    let windows = window_list::visible_windows();
    let monitors = Monitor::all()
        .map_err(|e| e.to_string())?
        .into_iter()
        .map(|m| {
            let bounds = Rect::new(m.x()?, m.y()?, m.width()?, m.height()?);
            Ok(FrozenMonitor {
                bounds,
                image: m.capture_image()?,
            })
        })
        .collect::<Result<Vec<_>, xcap::XCapError>>()
        .map_err(|e| format!("Screen capture failed: {e}"))?;
    if monitors.is_empty() {
        return Err("No monitors found".into());
    }
    Ok(Session {
        monitors,
        windows,
        cursor,
        restore_main,
    })
}

fn open_overlay(app: &AppHandle, index: usize, bounds: Rect) -> tauri::Result<()> {
    // Created hidden; the overlay page shows itself once the frozen frame is drawn.
    let window = WebviewWindowBuilder::new(
        app,
        format!("{OVERLAY_PREFIX}{index}"),
        WebviewUrl::App("index.html".into()),
    )
    .title("Snipit capture")
    .visible(false)
    .decorations(false)
    .resizable(false)
    .shadow(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .build()?;
    // Physical units, so it lands exactly on the monitor whatever its scale factor.
    window.set_position(PhysicalPosition::new(bounds.x, bounds.y))?;
    window.set_size(PhysicalSize::new(bounds.width, bounds.height))?;
    Ok(())
}

fn close_overlays(app: &AppHandle) {
    shortcuts::release_escape(app);
    for (label, window) in app.webview_windows() {
        if is_overlay(&label) {
            let _ = window.destroy();
        }
    }
}

/// Saves the capture to the gallery, then copies it or opens it in the editor, as set in
/// Settings.
fn deliver(app: &AppHandle, image: &RgbaImage, restore_main: bool) -> Result<(), String> {
    let path = gallery::save_new(app, &gallery::encode_png(image)?)?;
    let action = settings::get(app).after_capture;
    let copied = action == AfterCapture::Copy && clipboard::copy_image(image).is_ok();
    let _ = app.emit(
        CAPTURE_SAVED_EVENT,
        CaptureSaved {
            path: path.clone(),
            copied,
        },
    );
    match action {
        AfterCapture::Edit => open_editor(app, path),
        AfterCapture::Copy if !copied => {
            return Err("Saved to the gallery, but couldn't copy it to the clipboard".into());
        }
        AfterCapture::Copy => {
            if restore_main {
                tray::show_main_window(app);
            }
        }
    }
    Ok(())
}

pub fn open_editor(app: &AppHandle, path: PathBuf) {
    tray::show_main_window(app);
    let _ = app.emit_to("main", EDITOR_OPEN_EVENT, OpenEditor { path });
}

fn report_error(app: &AppHandle, message: String) {
    eprintln!("{message}");
    tray::show_main_window(app);
    let _ = app.emit_to("main", ERROR_EVENT, message);
}

/// Saves the clipboard image as a snip and opens it in the editor.
pub fn annotate_clipboard(app: &AppHandle) {
    let result = clipboard::read_image().and_then(|image| {
        let image = image.ok_or("The clipboard doesn't contain an image.")?;
        let path = gallery::save_new(app, &gallery::encode_png(&image)?)?;
        let _ = app.emit(
            CAPTURE_SAVED_EVENT,
            CaptureSaved {
                path: path.clone(),
                copied: false,
            },
        );
        open_editor(app, path);
        Ok(())
    });
    if let Err(e) = result {
        report_error(app, e);
    }
}

fn overlay_index(window: &WebviewWindow) -> Result<usize, String> {
    window
        .label()
        .strip_prefix(OVERLAY_PREFIX)
        .and_then(|i| i.parse().ok())
        .ok_or_else(|| "Not a capture overlay".into())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OverlayInfo {
    width: u32,
    height: u32,
    /// Windows visible on this monitor, local coordinates, topmost first.
    windows: Vec<Rect>,
    /// Cursor position if it is on this monitor, local coordinates.
    cursor: Option<Point>,
}

#[tauri::command]
pub fn start_capture(app: AppHandle, mode: CaptureMode) {
    start(&app, mode, true);
}

#[tauri::command]
pub async fn annotate_clipboard_cmd(app: AppHandle) {
    annotate_clipboard(&app);
}

#[tauri::command]
pub fn overlay_info(
    window: WebviewWindow,
    state: State<'_, CaptureState>,
) -> Result<OverlayInfo, String> {
    let index = overlay_index(&window)?;
    let slot = state.0.lock().map_err(|e| e.to_string())?;
    let session = slot.as_ref().ok_or("No capture in progress")?;
    let bounds = session.monitors.get(index).ok_or("Unknown monitor")?.bounds;
    let windows = session
        .windows
        .iter()
        .filter_map(|w| w.intersect(&bounds))
        .map(|w| w.translate(-bounds.x, -bounds.y))
        .collect();
    let cursor = session
        .cursor
        .filter(|c| bounds.contains(*c))
        .map(|c| Point {
            x: c.x - bounds.x,
            y: c.y - bounds.y,
        });
    Ok(OverlayInfo {
        width: bounds.width,
        height: bounds.height,
        windows,
        cursor,
    })
}

/// The frozen frame for this overlay's monitor as raw RGBA bytes.
#[tauri::command]
pub fn overlay_frame(
    window: WebviewWindow,
    state: State<'_, CaptureState>,
) -> Result<Response, String> {
    let index = overlay_index(&window)?;
    let slot = state.0.lock().map_err(|e| e.to_string())?;
    let session = slot.as_ref().ok_or("No capture in progress")?;
    let monitor = session.monitors.get(index).ok_or("Unknown monitor")?;
    Ok(Response::new(monitor.image.as_raw().clone()))
}

/// Finishes the capture with `rect`, in the calling overlay's local coordinates.
#[tauri::command]
pub fn finish_capture(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, CaptureState>,
    rect: Rect,
) -> Result<(), String> {
    let index = overlay_index(&window)?;
    let session = state
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .take()
        .ok_or("No capture in progress")?;
    close_overlays(&app);
    let image = session.crop(index, rect).ok_or("Selection is empty")?;
    let restore_main = session.restore_main;
    thread::spawn(move || {
        if let Err(err) = deliver(&app, &image, restore_main) {
            report_error(&app, err);
        }
    });
    Ok(())
}

#[tauri::command]
pub fn cancel_capture(app: AppHandle) {
    cancel(&app);
}

pub fn cancel(app: &AppHandle) {
    let session = app
        .state::<CaptureState>()
        .0
        .lock()
        .ok()
        .and_then(|mut slot| slot.take());
    close_overlays(app);
    if session.is_some_and(|s| s.restore_main) {
        tray::show_main_window(app);
    }
}

fn is_overlay(label: &str) -> bool {
    label.starts_with(OVERLAY_PREFIX)
}
