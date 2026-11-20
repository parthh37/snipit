//! Screen capture sessions.
//!
//! A capture freezes every monitor into memory first, then opens one borderless overlay window
//! per monitor showing that frozen frame. The user selects on the still image, so menus and
//! hover states stay exactly as they were when the hotkey was pressed. All geometry is in
//! physical pixels; overlays work in coordinates local to their own monitor.
//!
//! A scrolling capture uses the same overlay to pick the area, then hands it to [`scroll`].
//! A timed capture first counts down (see [`countdown`]); a repeated capture skips the overlay
//! and grabs the area of the last one again.

pub mod countdown;
mod cursor;
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

use crate::gallery::{self, Origin};
use crate::settings::{self, AfterCapture, CapturePreset, LastCapture};
use crate::{clipboard, shortcuts, tray, widget};
use geometry::{Point, Rect};
use window_list::TopWindow;

/// A new snip was saved to the gallery.
pub const CAPTURE_SAVED_EVENT: &str = "capture-saved";
/// Asks the main window to open a snip in the editor.
pub const EDITOR_OPEN_EVENT: &str = "editor:open";
/// Asks the main window to add effects to a new snip, then copy or keep it.
pub const PROCESS_EVENT: &str = "capture:process";
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

/// How one capture runs and where its result goes: from Settings, or from a preset.
#[derive(Debug, Clone)]
pub struct Request {
    pub mode: CaptureMode,
    /// Seconds to count down first.
    pub delay: u32,
    /// Draw the mouse pointer in.
    pub cursor: bool,
    pub after: AfterCapture,
    /// Effects for the editor's renderer to add (see `CapturePreset::effects`).
    pub effects: Option<serde_json::Value>,
    /// Grab the area of the last capture instead of asking for one.
    pub repeat: bool,
}

impl Request {
    pub fn from_settings(app: &AppHandle, mode: CaptureMode) -> Self {
        let s = settings::get(app);
        Self {
            mode,
            delay: s.capture_delay,
            cursor: s.capture_cursor,
            after: s.after_capture,
            effects: None,
            repeat: false,
        }
    }

    pub fn from_preset(preset: &CapturePreset) -> Self {
        Self {
            mode: preset.mode,
            delay: preset.delay,
            cursor: preset.cursor,
            after: preset.after,
            effects: preset.has_effects().then(|| preset.effects.clone()),
            repeat: false,
        }
    }
}

/// Everything needed to hand over a finished capture.
#[derive(Debug, Clone)]
pub struct Delivery {
    /// Whether the main window was hidden for the capture and should come back afterwards.
    pub restore_main: bool,
    pub request: Request,
    /// Where it came from, for its file name and the gallery search.
    pub origin: Origin,
}

struct FrozenMonitor {
    bounds: Rect,
    /// Shared so an overlay can be handed the frame without holding the session lock.
    image: Arc<RgbaImage>,
}

struct Session {
    request: Request,
    monitors: Vec<FrozenMonitor>,
    /// Top-level windows with global bounds, topmost first.
    windows: Vec<TopWindow>,
    cursor: Option<Point>,
    /// Overlay window labels, one per monitor in the order of `monitors`.
    overlays: Vec<String>,
    restore_main: bool,
}

impl Session {
    fn monitor_under_cursor(&self) -> usize {
        self.cursor
            .and_then(|c| self.monitors.iter().position(|m| m.bounds.contains(c)))
            .unwrap_or(0)
    }

    /// The window exactly covering `area` (a clicked window), else the one showing at its
    /// centre. Both are global coordinates.
    fn window_for(&self, area: Rect) -> (Option<&TopWindow>, bool) {
        if let Some(w) = self.windows.iter().find(|w| {
            self.monitors
                .iter()
                .any(|m| w.bounds.intersect(&m.bounds) == Some(area))
        }) {
            return (Some(w), true);
        }
        let centre = Point {
            x: area.x + area.width as i32 / 2,
            y: area.y + area.height as i32 / 2,
        };
        (
            self.windows.iter().find(|w| w.bounds.contains(centre)),
            false,
        )
    }

    /// The window a scrolling capture of `area` (local to the monitor at `monitor`) should
    /// scroll: the window that was clicked, or the one that was showing in the middle of a
    /// dragged area. Its handle lets it be brought to the front even if it was partly covered.
    fn scroll_target(&self, monitor: Rect, area: Rect) -> Option<isize> {
        self.window_for(area.translate(monitor.x, monitor.y))
            .0
            .map(|w| w.handle)
    }

    /// Names the program and window a capture of `area` (global) came from.
    fn origin(&self, area: Rect) -> Origin {
        let (window, exact) = self.window_for(area);
        let mode = match self.request.mode {
            CaptureMode::Scrolling => "scrolling",
            CaptureMode::Fullscreen => "fullscreen",
            CaptureMode::Interactive if exact => "window",
            CaptureMode::Interactive => "region",
        };
        let (app, title) = window.map_or((None, None), |w| window_list::describe(w.handle));
        Origin { mode, app, title }
    }

    fn delivery(&self, area: Rect) -> Delivery {
        Delivery {
            restore_main: self.restore_main,
            request: self.request.clone(),
            origin: self.origin(area),
        }
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
    /// Effects from a preset, added in the editor as the first change.
    #[serde(skip_serializing_if = "Option::is_none")]
    effects: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize)]
struct Process {
    path: PathBuf,
    effects: serde_json::Value,
    /// Also copy the result to the clipboard.
    copy: bool,
}

/// Starts a capture with the options from Settings. `settle` gives menus and our own window
/// time to disappear before the screen is frozen (not needed for the hotkey).
pub fn start(app: &AppHandle, mode: CaptureMode, settle: bool) {
    start_request(app, Request::from_settings(app, mode), settle);
}

/// Runs the preset with this id.
pub fn start_preset(app: &AppHandle, id: &str, settle: bool) {
    match settings::get(app).presets.iter().find(|p| p.id == id) {
        Some(preset) => start_request(app, Request::from_preset(preset), settle),
        None => report_error(app, "That capture preset no longer exists.".into()),
    }
}

/// Captures the area of the last capture again.
pub fn repeat(app: &AppHandle, settle: bool) {
    let Some(last) = settings::get(app).last_capture else {
        report_error(app, "There is no capture to repeat yet.".into());
        return;
    };
    let mut request = Request::from_settings(app, last.mode);
    request.repeat = true;
    start_request(app, request, settle);
}

/// Starts a capture on a background thread.
pub fn start_request(app: &AppHandle, request: Request, settle: bool) {
    let app = app.clone();
    thread::spawn(move || {
        if let Err(err) = run(&app, request, settle) {
            report_error(&app, format!("Capture failed: {err}"));
        }
        // Interactive captures bring the widget back when their overlays close, scrolling
        // captures when they finish.
        if !is_busy(&app) {
            widget::restore_after_capture(&app);
        }
    });
}

/// An overlay, countdown or scrolling capture is under way.
fn is_busy(app: &AppHandle) -> bool {
    let capturing = app
        .state::<CaptureState>()
        .0
        .lock()
        .is_ok_and(|slot| slot.is_some());
    capturing || scroll::is_running(app) || countdown::is_active(app)
}

fn run(app: &AppHandle, request: Request, settle: bool) -> Result<(), String> {
    if is_busy(app) {
        return Ok(()); // A capture is already open.
    }

    // The widget is excluded from screen capture, so it can be hidden without waiting.
    widget::hide_for_capture(app);
    let restore_main = hide_main(app);
    if request.delay > 0 {
        if !countdown::run(app, request.delay) {
            if restore_main {
                tray::show_main_window(app);
            }
            return Ok(());
        }
        // Let the countdown pill disappear.
        thread::sleep(Duration::from_millis(120));
    } else if restore_main {
        thread::sleep(Duration::from_millis(250));
    } else if settle {
        thread::sleep(Duration::from_millis(150));
    }

    let state = app.state::<CaptureState>();
    let mut slot = state.0.lock().map_err(|e| e.to_string())?;
    if slot.is_some() || scroll::is_running(app) {
        return Ok(());
    }
    let mut session = freeze(request, restore_main)?;
    session.cursor = app.cursor_position().ok().map(|p| Point {
        x: p.x as i32,
        y: p.y as i32,
    });

    if session.request.repeat {
        drop(slot);
        return repeat_now(app, &session);
    }
    match session.request.mode {
        CaptureMode::Fullscreen => {
            let index = session.monitor_under_cursor();
            let bounds = session.monitors[index].bounds;
            let full = Rect::new(0, 0, bounds.width, bounds.height);
            let image = session.crop(index, full).ok_or("Empty monitor")?;
            drop(slot);
            remember(app, CaptureMode::Fullscreen, bounds);
            deliver(app, &image, &session.delivery(bounds))
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

/// Grabs the remembered area from the frozen frames, or scrolls it again.
fn repeat_now(app: &AppHandle, session: &Session) -> Result<(), String> {
    let last = settings::get(app)
        .last_capture
        .ok_or("There is no capture to repeat yet.")?;
    let index = repeat_monitor(&session.monitors, last)
        .ok_or("The area of the last capture isn't on screen any more.")?;
    let bounds = session.monitors[index].bounds;
    let local = last.rect.translate(-bounds.x, -bounds.y);
    let delivery = session.delivery(last.rect);
    if last.mode == CaptureMode::Scrolling {
        let target = session.scroll_target(bounds, local);
        shortcuts::grab_escape(app);
        scroll::start(app, bounds, local, target, delivery);
        return Ok(());
    }
    let image = session.crop(index, local).ok_or("Selection is empty")?;
    deliver(app, &image, &delivery)
}

/// The monitor that wholly contains the last capture's area.
fn repeat_monitor(monitors: &[FrozenMonitor], last: LastCapture) -> Option<usize> {
    monitors
        .iter()
        .position(|m| m.bounds.intersect(&last.rect) == Some(last.rect))
}

/// Keeps the area of this capture for "Repeat last capture".
fn remember(app: &AppHandle, mode: CaptureMode, rect: Rect) {
    let last = Some(LastCapture { mode, rect });
    if settings::get(app).last_capture == last {
        return;
    }
    match settings::update(app, |s| s.last_capture = last) {
        // The tray's "Repeat last capture" may only now have something to repeat.
        Ok(_) => tray::refresh(app),
        Err(err) => eprintln!("Couldn't remember the capture area: {err}"),
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

fn freeze(request: Request, restore_main: bool) -> Result<Session, String> {
    let windows = window_list::visible_windows();
    // Scrolling captures grab their own frames, with the cursor parked over the page.
    let pointer = (request.cursor && request.mode != CaptureMode::Scrolling)
        .then(cursor::grab)
        .flatten();
    let monitors = Monitor::all()
        .map_err(|e| e.to_string())?
        .into_iter()
        .map(|m| {
            let bounds = Rect::new(m.x()?, m.y()?, m.width()?, m.height()?);
            let mut image = m.capture_image()?;
            if let Some(pointer) = &pointer {
                pointer.draw_into(
                    &mut image,
                    Point {
                        x: bounds.x,
                        y: bounds.y,
                    },
                );
            }
            Ok(FrozenMonitor {
                bounds,
                image: Arc::new(image),
            })
        })
        .collect::<Result<Vec<_>, xcap::XCapError>>()
        .map_err(|e| format!("Screen capture failed: {e}"))?;
    if monitors.is_empty() {
        return Err("No monitors found".into());
    }
    Ok(Session {
        request,
        monitors,
        windows,
        cursor: None,
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

/// Saves the capture to the gallery, then copies it, opens it in the editor, or just keeps
/// it, as the request says. Effects are added by the main window's renderer.
fn deliver(app: &AppHandle, image: &RgbaImage, delivery: &Delivery) -> Result<(), String> {
    let path = gallery::save_new(app, &gallery::encode_png(image)?, &delivery.origin)?;
    let request = &delivery.request;
    let action = request.after;

    if let Some(effects) = request.effects.clone() {
        let _ = app.emit(
            CAPTURE_SAVED_EVENT,
            CaptureSaved {
                path: path.clone(),
                copied: false,
            },
        );
        if action == AfterCapture::Edit {
            open_editor_with(app, path, Some(effects));
        } else {
            if delivery.restore_main {
                tray::show_main_window(app);
            }
            let copy = action == AfterCapture::Copy;
            let _ = app.emit_to(
                "main",
                PROCESS_EVENT,
                Process {
                    path,
                    effects,
                    copy,
                },
            );
        }
        return Ok(());
    }

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
        AfterCapture::Copy | AfterCapture::Save => {
            if delivery.restore_main {
                tray::show_main_window(app);
            } else if action == AfterCapture::Save {
                tray::notify_saved(app, &path);
            }
        }
    }
    Ok(())
}

pub fn open_editor(app: &AppHandle, path: PathBuf) {
    open_editor_with(app, path, None);
}

fn open_editor_with(app: &AppHandle, path: PathBuf, effects: Option<serde_json::Value>) {
    tray::show_main_window(app);
    let _ = app.emit_to("main", EDITOR_OPEN_EVENT, OpenEditor { path, effects });
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
        let origin = Origin {
            mode: "clipboard",
            ..Origin::default()
        };
        let path = gallery::save_new(app, &gallery::encode_png(&image)?, &origin)?;
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
pub fn repeat_last_capture(app: AppHandle) {
    repeat(&app, true);
}

#[tauri::command]
pub fn run_preset(app: AppHandle, id: String) {
    start_preset(&app, &id, true);
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
        mode: session.request.mode,
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
    let bounds = session.monitors.get(index).map(|m| m.bounds);
    let area = bounds.and_then(|b| rect.intersect(&Rect::new(0, 0, b.width, b.height)));
    let (Some(bounds), Some(area)) = (bounds, area) else {
        close_overlays(&app, false);
        return Err("Selection is empty".into());
    };
    let global = area.translate(bounds.x, bounds.y);
    remember(&app, session.request.mode, global);
    if session.request.mode == CaptureMode::Scrolling {
        let target = session.scroll_target(bounds, area);
        let delivery = session.delivery(global);
        // Started before the overlays close, so an Esc pressed in between already finishes the
        // scrolling capture instead of being lost.
        scroll::start(&app, bounds, area, target, delivery);
        close_overlays(&app, true);
        return Ok(());
    }
    close_overlays(&app, false);
    let image = session.crop(index, area).ok_or("Selection is empty")?;
    thread::spawn(move || {
        // Looking up the window's program can take a moment, so it happens off the UI thread.
        let delivery = session.delivery(global);
        if let Err(err) = deliver(&app, &image, &delivery) {
            report_error(&app, err);
        }
    });
    Ok(())
}

#[tauri::command]
pub fn cancel_capture(app: AppHandle) {
    cancel(&app);
}

/// Stops a countdown, cancels the capture overlays, or finishes a running scrolling capture
/// with what it has.
pub fn cancel(app: &AppHandle) {
    if countdown::cancel(app) || scroll::request_stop(app) {
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

#[cfg(test)]
mod tests {
    use super::*;

    fn monitor(x: i32, y: i32, width: u32, height: u32) -> FrozenMonitor {
        FrozenMonitor {
            bounds: Rect::new(x, y, width, height),
            image: Arc::new(RgbaImage::new(1, 1)),
        }
    }

    #[test]
    fn repeats_only_on_a_monitor_that_holds_the_whole_area() {
        let monitors = [monitor(0, 0, 1920, 1080), monitor(1920, 0, 1920, 1080)];
        let last = |x, y, w, h| LastCapture {
            mode: CaptureMode::Interactive,
            rect: Rect::new(x, y, w, h),
        };
        assert_eq!(repeat_monitor(&monitors, last(100, 100, 50, 50)), Some(0));
        assert_eq!(repeat_monitor(&monitors, last(2000, 10, 300, 200)), Some(1));
        // Straddling two monitors, or off every screen after the layout changed.
        assert_eq!(repeat_monitor(&monitors, last(1900, 0, 100, 100)), None);
        assert_eq!(repeat_monitor(&monitors, last(4000, 0, 100, 100)), None);
    }
}
