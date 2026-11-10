//! Screen capture sessions.
//!
//! A capture freezes every monitor into memory first, then opens one borderless overlay window
//! per monitor showing that frozen frame. The user selects on the still image, so menus and
//! hover states stay exactly as they were when the hotkey was pressed. All geometry is in
//! physical pixels; overlays work in coordinates local to their own monitor.
//!
//! A scrolling capture uses the same overlay to pick the area, then hands it to [`scroll`].

pub mod geometry;
pub mod overlays;
pub mod scroll;
mod stitch;
mod window_list;

use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow, ipc::Response};
use xcap::Monitor;
use xcap::image::{RgbaImage, imageops};

use crate::settings::{self, AfterCapture};
use crate::{clipboard, gallery, shortcuts, tray, widget};
use geometry::{Point, Rect};
use window_list::TopWindow;

/// A new snip was saved to the gallery.
pub const CAPTURE_SAVED_EVENT: &str = "capture-saved";
/// Asks the main window to open a snip in the editor.
pub const EDITOR_OPEN_EVENT: &str = "editor:open";
/// A capture or clipboard import failed; the payload is the message to show.
pub const ERROR_EVENT: &str = "app:error";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CaptureMode {
    /// Overlay where the user drags a region or clicks a window.
    Interactive,
    /// The whole monitor under the cursor, no overlay.
    Fullscreen,
    /// Overlay to pick the area, which is then scrolled and stitched into one long image.
    Scrolling,
}

struct FrozenMonitor {
    bounds: Rect,
    /// Shared so an overlay can be handed the frame without holding the session lock.
    image: Arc<RgbaImage>,
}

struct Session {
    mode: CaptureMode,
    monitors: Vec<FrozenMonitor>,
    /// Top-level windows with global bounds, topmost first.
    windows: Vec<TopWindow>,
    cursor: Option<Point>,
    /// Overlay window labels, one per monitor in the order of `monitors`.
    overlays: Vec<String>,
    /// Whether the main window was hidden for the capture and should come back afterwards.
    restore_main: bool,
}

impl Session {
    fn monitor_under_cursor(&self) -> usize {
        self.cursor
            .and_then(|c| self.monitors.iter().position(|m| m.bounds.contains(c)))
            .unwrap_or(0)
    }

    /// The window a scrolling capture of `area` (local to the monitor at `monitor`) should
    /// scroll: the window that was clicked, or the one that was showing in the middle of a
    /// dragged area. Its handle lets it be brought to the front even if it was partly covered.
    fn scroll_target(&self, monitor: Rect, area: Rect) -> Option<isize> {
        let clicked = self
            .windows
            .iter()
            .find(|w| local_bounds(w, monitor) == Some(area));
        let centre = Point {
            x: monitor.x + area.x + area.width as i32 / 2,
            y: monitor.y + area.y + area.height as i32 / 2,
        };
        clicked
            .or_else(|| self.windows.iter().find(|w| w.bounds.contains(centre)))
            .map(|w| w.handle)
    }

    /// Crops `local` (relative to monitor `index`) out of the frozen frame.
    fn crop(&self, index: usize, local: Rect) -> Option<RgbaImage> {
        let monitor = self.monitors.get(index)?;
        let full = Rect::new(0, 0, monitor.bounds.width, monitor.bounds.height);
        let r = local.intersect(&full)?;
        Some(
            imageops::crop_imm(
                monitor.image.as_ref(),
                r.x as u32,
                r.y as u32,
                r.width,
                r.height,
            )
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
        // Interactive captures bring the widget back when their overlays close, scrolling
        // captures when they finish.
        let capturing = app
            .state::<CaptureState>()
            .0
            .lock()
            .is_ok_and(|slot| slot.is_some());
        if !capturing && !scroll::is_running(&app) {
            widget::restore_after_capture(&app);
        }
    });
}

fn run(app: &AppHandle, mode: CaptureMode, settle: bool) -> Result<(), String> {
    let state = app.state::<CaptureState>();
    let mut slot = state.0.lock().map_err(|e| e.to_string())?;
    if slot.is_some() || scroll::is_running(app) {
        return Ok(()); // A capture is already open.
    }

    // The widget is excluded from screen capture, so it can be hidden without waiting.
    widget::hide_for_capture(app);
    let restore_main = hide_main(app);
    if restore_main {
        thread::sleep(Duration::from_millis(250));
    } else if settle {
        thread::sleep(Duration::from_millis(150));
    }

    let mut session = freeze(app, mode, restore_main)?;
    match mode {
        CaptureMode::Fullscreen => {
            let index = session.monitor_under_cursor();
            let bounds = session.monitors[index].bounds;
            let full = Rect::new(0, 0, bounds.width, bounds.height);
            let image = session.crop(index, full).ok_or("Empty monitor")?;
            drop(slot);
            deliver(app, &image, restore_main)
        }
        CaptureMode::Interactive | CaptureMode::Scrolling => {
            let bounds: Vec<Rect> = session.monitors.iter().map(|m| m.bounds).collect();
            let labels = overlays::take(app, bounds.len());
            session.overlays = labels.clone();
            *slot = Some(session);
            drop(slot);
            // The overlays may not get keyboard focus (another app can hold the foreground),
            // so Esc is grabbed globally for as long as they are open.
            shortcuts::grab_escape(app);
            for (label, b) in labels.iter().zip(bounds) {
                if let Err(err) = overlays::present(app, label, b) {
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

fn freeze(app: &AppHandle, mode: CaptureMode, restore_main: bool) -> Result<Session, String> {
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
                image: Arc::new(m.capture_image()?),
            })
        })
        .collect::<Result<Vec<_>, xcap::XCapError>>()
        .map_err(|e| format!("Screen capture failed: {e}"))?;
    if monitors.is_empty() {
        return Err("No monitors found".into());
    }
    Ok(Session {
        mode,
        monitors,
        windows,
        cursor,
        overlays: Vec::new(),
        restore_main,
    })
}

/// Closes the overlays. When a scrolling capture takes over (`scrolling_next`), it keeps the
/// Esc grab and the widget hidden, and releases both when it finishes.
fn close_overlays(app: &AppHandle, scrolling_next: bool) {
    if !scrolling_next {
        shortcuts::release_escape(app);
    }
    overlays::close(app);
    if !scrolling_next {
        widget::restore_after_capture(app);
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

/// Saves the clipboard image as a snip and opens it in the editor. Runs on a worker thread:
/// the tray and shortcut handlers call this on the main thread, and encoding a large image
/// there would freeze the app.
pub fn annotate_clipboard(app: &AppHandle) {
    let app = app.clone();
    thread::spawn(move || annotate_clipboard_now(&app));
}

fn annotate_clipboard_now(app: &AppHandle) {
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

/// The monitor index of the calling overlay in `session`.
fn overlay_index(window: &WebviewWindow, session: &Session) -> Result<usize, String> {
    session
        .overlays
        .iter()
        .position(|label| label == window.label())
        .ok_or_else(|| "Not an overlay of this capture".into())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OverlayInfo {
    mode: CaptureMode,
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
    annotate_clipboard_now(&app);
}

#[tauri::command]
pub fn overlay_info(
    window: WebviewWindow,
    state: State<'_, CaptureState>,
) -> Result<OverlayInfo, String> {
    let slot = state.0.lock().map_err(|e| e.to_string())?;
    let session = slot.as_ref().ok_or("No capture in progress")?;
    let index = overlay_index(&window, session)?;
    let bounds = session.monitors.get(index).ok_or("Unknown monitor")?.bounds;
    let windows = session
        .windows
        .iter()
        .filter_map(|w| local_bounds(w, bounds))
        .collect();
    let cursor = session
        .cursor
        .filter(|c| bounds.contains(*c))
        .map(|c| Point {
            x: c.x - bounds.x,
            y: c.y - bounds.y,
        });
    Ok(OverlayInfo {
        mode: session.mode,
        width: bounds.width,
        height: bounds.height,
        windows,
        cursor,
    })
}

/// The frozen frame for this overlay's monitor as raw RGBA bytes. Async so it runs off the
/// main thread, which has to be free to hand over the shared buffer.
#[tauri::command]
pub async fn overlay_frame(
    window: WebviewWindow,
    state: State<'_, CaptureState>,
) -> Result<Response, String> {
    let image = {
        let slot = state.0.lock().map_err(|e| e.to_string())?;
        let session = slot.as_ref().ok_or("No capture in progress")?;
        let index = overlay_index(&window, session)?;
        let monitor = session.monitors.get(index).ok_or("Unknown monitor")?;
        Arc::clone(&monitor.image)
    };
    // An empty response means the frame went through shared memory instead.
    if overlays::share_frame(&window, Arc::clone(&image)).is_ok() {
        return Ok(Response::new(Vec::new()));
    }
    Ok(Response::new(image.as_raw().clone()))
}

/// Finishes the capture with `rect`, in the calling overlay's local coordinates.
#[tauri::command]
pub fn finish_capture(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, CaptureState>,
    rect: Rect,
) -> Result<(), String> {
    let mut slot = state.0.lock().map_err(|e| e.to_string())?;
    let index = overlay_index(&window, slot.as_ref().ok_or("No capture in progress")?)?;
    let session = slot.take().ok_or("No capture in progress")?;
    drop(slot);
    let restore_main = session.restore_main;
    if session.mode == CaptureMode::Scrolling {
        let bounds = session.monitors.get(index).map(|m| m.bounds);
        let area = bounds.and_then(|b| rect.intersect(&Rect::new(0, 0, b.width, b.height)));
        let (Some(bounds), Some(area)) = (bounds, area) else {
            close_overlays(&app, false);
            return Err("Selection is empty".into());
        };
        let target = session.scroll_target(bounds, area);
        // Started before the overlays close, so an Esc pressed in between already finishes the
        // scrolling capture instead of being lost.
        scroll::start(&app, bounds, area, target, restore_main);
        close_overlays(&app, true);
        return Ok(());
    }
    close_overlays(&app, false);
    let image = session.crop(index, rect).ok_or("Selection is empty")?;
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

/// Cancels the capture overlays, or finishes a running scrolling capture with what it has.
pub fn cancel(app: &AppHandle) {
    if scroll::request_stop(app) {
        return;
    }
    let session = app
        .state::<CaptureState>()
        .0
        .lock()
        .ok()
        .and_then(|mut slot| slot.take());
    close_overlays(app, false);
    if session.is_some_and(|s| s.restore_main) {
        tray::show_main_window(app);
    }
}

/// A window's bounds on the monitor at `monitor`, in that monitor's local coordinates: what the
/// overlay highlights and returns when the window is clicked.
fn local_bounds(window: &TopWindow, monitor: Rect) -> Option<Rect> {
    window
        .bounds
        .intersect(&monitor)
        .map(|r| r.translate(-monitor.x, -monitor.y))
}
