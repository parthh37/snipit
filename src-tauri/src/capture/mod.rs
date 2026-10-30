//! Screen capture sessions.
//!
//! A capture freezes every monitor into memory first, then opens one borderless overlay window
//! per monitor showing that frozen frame. The user selects on the still image, so menus and
//! hover states stay exactly as they were when the hotkey was pressed. All geometry is in
//! physical pixels; overlays work in coordinates local to their own monitor.

pub mod geometry;
mod window_list;

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

use crate::{hotkey, library, tray};
use geometry::{Point, Rect};

const OVERLAY_PREFIX: &str = "overlay-";
pub const CAPTURE_SAVED_EVENT: &str = "capture-saved";
pub const CAPTURE_FAILED_EVENT: &str = "capture-failed";

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
    entry: library::CaptureEntry,
    copied: bool,
}

/// Starts a capture on a background thread. `settle` gives menus and our own window time to
/// disappear before the screen is frozen (not needed for the hotkey).
pub fn start(app: &AppHandle, mode: CaptureMode, settle: bool) {
    let app = app.clone();
    thread::spawn(move || {
        if let Err(err) = run(&app, mode, settle) {
            eprintln!("Capture failed: {err}");
            let _ = app.emit(CAPTURE_FAILED_EVENT, err);
        }
    });
}

fn run(app: &AppHandle, mode: CaptureMode, settle: bool) -> Result<(), String> {
    let state = app.state::<CaptureState>();
    let mut slot = state.0.lock().map_err(|e| e.to_string())?;
    if slot.is_some() {
        return Ok(()); // A capture is already open.
    }

    if let Some(main) = app.get_webview_window("main")
        && main.is_visible().unwrap_or(false)
    {
        let _ = main.hide();
        thread::sleep(Duration::from_millis(250));
    } else if settle {
        thread::sleep(Duration::from_millis(150));
    }

    let session = freeze(app)?;
    match mode {
        CaptureMode::Fullscreen => {
            let index = session.monitor_under_cursor();
            let bounds = session.monitors[index].bounds;
            let full = Rect::new(0, 0, bounds.width, bounds.height);
            let image = session.crop(index, full).ok_or("Empty monitor")?;
            drop(slot);
            deliver(app, &image)
        }
        CaptureMode::Interactive => {
            let bounds: Vec<Rect> = session.monitors.iter().map(|m| m.bounds).collect();
            *slot = Some(session);
            drop(slot);
            // The overlays may not get keyboard focus (another app can hold the foreground),
            // so Esc is grabbed globally for as long as they are open.
            hotkey::grab_escape(app);
            for (i, b) in bounds.into_iter().enumerate() {
                if let Err(err) = open_overlay(app, i, b) {
                    close_overlays(app);
                    *state.0.lock().map_err(|e| e.to_string())? = None;
                    return Err(err.to_string());
                }
            }
            Ok(())
        }
    }
}

fn freeze(app: &AppHandle) -> Result<Session, String> {
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
    hotkey::release_escape(app);
    for (label, window) in app.webview_windows() {
        if is_overlay(&label) {
            let _ = window.destroy();
        }
    }
}

/// Copies the capture to the clipboard, saves it, and shows it in the main window.
fn deliver(app: &AppHandle, image: &RgbaImage) -> Result<(), String> {
    let copied = library::copy_to_clipboard(image).is_ok();
    let entry = library::save_png(app, image)?;
    tray::show_main_window(app);
    app.emit(CAPTURE_SAVED_EVENT, CaptureSaved { entry, copied })
        .map_err(|e| e.to_string())
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
    thread::spawn(move || {
        if let Err(err) = deliver(&app, &image) {
            let _ = app.emit(CAPTURE_FAILED_EVENT, err);
        }
    });
    Ok(())
}

#[tauri::command]
pub fn cancel_capture(app: AppHandle) {
    cancel(&app);
}

pub fn cancel(app: &AppHandle) {
    if let Ok(mut slot) = app.state::<CaptureState>().0.lock() {
        *slot = None;
    }
    close_overlays(app);
}

fn is_overlay(label: &str) -> bool {
    label.starts_with(OVERLAY_PREFIX)
}
