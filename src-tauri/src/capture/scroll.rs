//! Scrolling capture: grabs a long webpage, document or list that doesn't fit on screen.
//!
//! The user picks the area in the normal capture overlay. Snipit then turns the mouse wheel over
//! it, scrolls back to the top, and steps down the page grabbing a frame after each step until
//! the page stops moving, the image gets too tall, or the user presses Esc (or moves the mouse).
//! The frames are stitched into one image by [`super::stitch`].
//!
//! While it runs, a small click-through status pill sits at the top of the monitor. Like the
//! capture widget it is excluded from screen capture, so it never shows up in the frames.

use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindowBuilder,
};
use xcap::Monitor;
use xcap::image::RgbaImage;

use super::geometry::{Point, Rect};
use super::stitch::{self, Step, Stitcher};
use crate::{shortcuts, tray, widget};

pub const STATUS_LABEL: &str = "scroll-status";
/// Progress for the status pill; payload [`Progress`].
const PROGRESS_EVENT: &str = "scroll:progress";
/// Status pill size in logical pixels.
const STATUS_SIZE: (f64, f64) = (460.0, 44.0);

/// Areas shorter than this leave too little to line frames up on.
const MIN_AREA_HEIGHT: u32 = 80;
/// The stitched image stops growing here; WebView canvases (the editor) top out around 32k.
const MAX_HEIGHT: u32 = 20_000;
const MAX_STEPS: usize = 400;
/// Wheel notches per burst, and how many bursts at most, when scrolling back to the top.
const TOP_NOTCHES: i32 = 15;
const TOP_BURSTS: usize = 25;
/// Each step aims to scroll this share of the scrolling part of the area, so consecutive frames
/// overlap enough to be lined up.
const STEP_SHARE: f64 = 0.55;
const MAX_NOTCHES: i32 = 20;
/// Columns at each side of the area ignored when lining frames up (logical pixels): room for a
/// scrollbar and the window border.
const SCROLLBAR_MARGIN: f64 = 24.0;
/// Waiting for smooth scrolling and repaints to finish after each wheel turn.
const SETTLE_FIRST: Duration = Duration::from_millis(90);
const SETTLE_POLL: Duration = Duration::from_millis(45);
const SETTLE_MAX: Duration = Duration::from_millis(900);
/// Time for the capture overlays to disappear before the first frame is grabbed.
const OVERLAYS_GONE: Duration = Duration::from_millis(300);

#[derive(Default)]
pub struct ScrollState {
    running: AtomicBool,
    stop: AtomicBool,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "lowercase")]
enum Phase {
    Starting,
    Top,
    Capturing,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Progress {
    phase: Phase,
    /// Height of the stitched image so far, in pixels.
    height: u32,
    /// Moving the mouse also finishes the capture.
    mouse_stops: bool,
}

pub fn is_running(app: &AppHandle) -> bool {
    app.state::<ScrollState>().running.load(Ordering::SeqCst)
}

/// Asks a running scrolling capture to finish with what it has so far. Returns false if none is
/// running.
pub fn request_stop(app: &AppHandle) -> bool {
    let state = app.state::<ScrollState>();
    if !state.running.load(Ordering::SeqCst) {
        return false;
    }
    state.stop.store(true, Ordering::SeqCst);
    true
}

fn stop_requested(app: &AppHandle) -> bool {
    app.state::<ScrollState>().stop.load(Ordering::SeqCst)
}

/// Starts scrolling `area` (local to `monitor`) on a worker thread. `target` is the window to
/// bring to the front first (a window handle), if known.
pub fn start(
    app: &AppHandle,
    monitor: Rect,
    area: Rect,
    target: Option<isize>,
    restore_main: bool,
) {
    let state = app.state::<ScrollState>();
    if state.running.swap(true, Ordering::SeqCst) {
        return;
    }
    state.stop.store(false, Ordering::SeqCst);
    let app = app.clone();
    // Esc is still grabbed from the capture overlay, and the widget still hidden; both are
    // handed back below once the capture is done.
    thread::spawn(move || {
        show_status(&app, monitor);
        let result = capture(&app, monitor, area, target);
        close_status(&app);
        shortcuts::release_escape(&app);
        app.state::<ScrollState>()
            .running
            .store(false, Ordering::SeqCst);
        widget::restore_after_capture(&app);

        match result {
            Ok((image, scrolled)) => {
                if let Err(err) = super::deliver(&app, &image, restore_main) {
                    super::report_error(&app, err);
                } else if !scrolled {
                    super::report_error(
                        &app,
                        "The area didn't scroll, so only what was on screen was captured. \
                         Pick an area that scrolls with the mouse wheel."
                            .into(),
                    );
                }
            }
            Err(err) => {
                super::report_error(&app, format!("Scrolling capture failed: {err}"));
                if restore_main {
                    tray::show_main_window(&app);
                }
            }
        }
    });
}

/// Grabs the picked area of one monitor.
struct Grabber {
    monitor: Monitor,
    area: Rect,
}

impl Grabber {
    fn new(bounds: Rect, area: Rect) -> Result<Self, String> {
        let monitor = Monitor::all()
            .map_err(|e| e.to_string())?
            .into_iter()
            .find(|m| m.x().ok() == Some(bounds.x) && m.y().ok() == Some(bounds.y))
            .ok_or("The monitor went away")?;
        Ok(Self { monitor, area })
    }

    /// The monitor's scale factor.
    fn scale(&self) -> f64 {
        self.monitor.scale_factor().map_or(1.0, f64::from)
    }

    fn grab(&self) -> Result<RgbaImage, String> {
        let a = self.area;
        self.monitor
            .capture_region(a.x as u32, a.y as u32, a.width, a.height)
            .map_err(|e| format!("Screen capture failed: {e}"))
    }

    /// Grabs a frame once the view has stopped moving (smooth scrolling, lazy images), or after
    /// a short timeout for pages that never stop animating.
    fn settled(&self) -> Result<RgbaImage, String> {
        thread::sleep(SETTLE_FIRST);
        let deadline = Instant::now() + SETTLE_MAX;
        let mut last = self.grab()?;
        loop {
            thread::sleep(SETTLE_POLL);
            let next = self.grab()?;
            if next.as_raw() == last.as_raw() || Instant::now() >= deadline {
                return Ok(next);
            }
            last = next;
        }
    }
}

/// Runs the capture. Returns the stitched image and whether the area scrolled at all.
fn capture(
    app: &AppHandle,
    monitor: Rect,
    area: Rect,
    target: Option<isize>,
) -> Result<(RgbaImage, bool), String> {
    if area.height < MIN_AREA_HEIGHT || area.width < 16 {
        return Err("Pick a larger area to scroll.".into());
    }
    thread::sleep(OVERLAYS_GONE);
    let grabber = Grabber::new(monitor, area)?;
    let centre = Point {
        x: monitor.x + area.x + area.width as i32 / 2,
        y: monitor.y + area.y + area.height as i32 / 2,
    };
    let mut wheel = Wheel::new(centre, target);
    let progress = |phase, height, wheel: &Wheel| {
        let _ = app.emit_to(
            STATUS_LABEL,
            PROGRESS_EVENT,
            Progress {
                phase,
                height,
                mouse_stops: wheel.moves_cursor(),
            },
        );
    };
    progress(Phase::Starting, 0, &wheel);

    // Make sure the wheel reaches the area; some apps only listen to one kind of input.
    let mut frame = grabber.settled()?;
    if !probe(&wheel, &grabber, &mut frame)? && wheel.fall_back() {
        probe(&wheel, &grabber, &mut frame)?;
    }

    // Start from the top of the page.
    progress(Phase::Top, 0, &wheel);
    for _ in 0..TOP_BURSTS {
        if stop_requested(app) || wheel.user_moved() {
            break;
        }
        wheel.scroll(-TOP_NOTCHES);
        let next = grabber.settled()?;
        let still = stitch::is_still(&frame, &next);
        frame = next;
        if still {
            break;
        }
    }

    let margin = (SCROLLBAR_MARGIN * grabber.scale()).round() as u32;
    let mut stitcher = Stitcher::new(frame, margin);
    progress(Phase::Capturing, stitcher.height(), &wheel);
    let mut notches = 1;
    let mut px_per_notch = 0.0f64;
    let mut scrolled = false;
    let mut stills = 0;
    let mut losses = 0;
    for _ in 0..MAX_STEPS {
        if stop_requested(app) || wheel.user_moved() {
            break;
        }
        wheel.scroll(notches);
        match stitcher.push(grabber.settled()?) {
            Step::Scrolled { shift, span } => {
                scrolled = true;
                stills = 0;
                // The largest rate seen: a short last step at the end of the page undercounts.
                px_per_notch = px_per_notch.max(f64::from(shift) / f64::from(notches));
                let wanted = f64::from(span) * STEP_SHARE / px_per_notch;
                notches = (wanted.floor() as i32).clamp(1, MAX_NOTCHES);
                progress(Phase::Capturing, stitcher.height(), &wheel);
                if stitcher.height() >= MAX_HEIGHT {
                    break;
                }
            }
            Step::Still => {
                // Give a lazy-loading page one more chance before calling it the end.
                stills += 1;
                if stills >= 2 {
                    break;
                }
            }
            Step::Lost => {
                // Too far to line up: go back and take smaller steps.
                losses += 1;
                if losses >= 3 {
                    break;
                }
                wheel.scroll(-notches);
                grabber.settled()?;
                notches = (notches / 2).max(1);
            }
        }
    }
    Ok((stitcher.finish(), scrolled))
}

/// Turns the wheel one notch down, then up, and reports whether either moved the view.
fn probe(wheel: &Wheel, grabber: &Grabber, frame: &mut RgbaImage) -> Result<bool, String> {
    for notches in [1, -1] {
        wheel.scroll(notches);
        let next = grabber.settled()?;
        let moved = !stitch::is_still(frame, &next);
        *frame = next;
        if moved {
            return Ok(true);
        }
    }
    Ok(false)
}

fn show_status(app: &AppHandle, monitor: Rect) {
    let scale = app
        .available_monitors()
        .ok()
        .and_then(|all| {
            all.into_iter()
                .find(|m| m.position().x == monitor.x && m.position().y == monitor.y)
        })
        .map_or(1.0, |m| m.scale_factor());
    let size = PhysicalSize::new(
        (STATUS_SIZE.0 * scale).round() as u32,
        (STATUS_SIZE.1 * scale).round() as u32,
    );
    let position = PhysicalPosition::new(
        monitor.x + (monitor.width as i32 - size.width as i32) / 2,
        monitor.y + (16.0 * scale).round() as i32,
    );
    let window = WebviewWindowBuilder::new(app, STATUS_LABEL, WebviewUrl::App("index.html".into()))
        .title("Snipit scrolling capture")
        .visible(false)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .resizable(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .focusable(false)
        .content_protected(true)
        .build();
    match window {
        Ok(window) => {
            // Click-through, so the wheel and the mouse go to the page underneath.
            let _ = window.set_ignore_cursor_events(true);
            let _ = window.set_position(position);
            let _ = window.set_size(size);
            let _ = window.set_position(position);
            let _ = window.show();
        }
        Err(err) => eprintln!("Couldn't show the scrolling capture status: {err}"),
    }
}

fn close_status(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(STATUS_LABEL) {
        let _ = window.destroy();
    }
}

/// Turns the mouse wheel over a point on screen.
///
/// Real (injected) wheel input works with every app, but needs the cursor over the area, so the
/// cursor is parked there and put back afterwards. Where the cursor can't be moved (some remote
/// sessions) or the app ignores it, wheel messages are posted to the window instead.
struct Wheel {
    point: Point,
    method: Method,
    /// Where the cursor was before it was parked over the area.
    home: Option<Point>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Method {
    Input,
    Message,
}

/// How far the cursor may drift before it counts as the user moving the mouse.
const MOUSE_SLACK: i32 = 6;

impl Wheel {
    fn new(point: Point, target: Option<isize>) -> Self {
        let home = platform::cursor();
        platform::bring_to_front(target, point);
        let parked = platform::set_cursor(point) && platform::cursor() == Some(point);
        Self {
            point,
            method: if parked {
                Method::Input
            } else {
                Method::Message
            },
            home,
        }
    }

    fn moves_cursor(&self) -> bool {
        self.method == Method::Input
    }

    /// Scrolls `notches` wheel notches; positive scrolls down.
    fn scroll(&self, notches: i32) {
        match self.method {
            Method::Input => platform::send_wheel(notches),
            Method::Message => platform::post_wheel(self.point, notches),
        }
    }

    /// The user moved the mouse away from the parked cursor.
    fn user_moved(&self) -> bool {
        self.method == Method::Input
            && platform::cursor().is_some_and(|c| {
                (c.x - self.point.x).abs() > MOUSE_SLACK || (c.y - self.point.y).abs() > MOUSE_SLACK
            })
    }

    /// Switches from injected input to posted messages. Returns false if there is nothing left
    /// to try.
    fn fall_back(&mut self) -> bool {
        if self.method == Method::Message {
            return false;
        }
        self.restore_cursor();
        self.method = Method::Message;
        true
    }

    fn restore_cursor(&self) {
        if self.method == Method::Input
            && let Some(home) = self.home
        {
            platform::set_cursor(home);
        }
    }
}

impl Drop for Wheel {
    fn drop(&mut self) {
        // Leave the cursor where the user had it, unless they have moved it since.
        if !self.user_moved() {
            self.restore_cursor();
        }
    }
}

#[cfg(windows)]
mod platform {
    use super::Point;
    use std::ffi::c_void;
    use windows::Win32::Foundation::{HWND, LPARAM, POINT, WPARAM};
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        INPUT, INPUT_0, INPUT_MOUSE, MOUSEEVENTF_WHEEL, MOUSEINPUT, SendInput,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        GA_ROOT, GetAncestor, GetCursorPos, IsWindow, PostMessageW, SetCursorPos,
        SetForegroundWindow, WM_MOUSEWHEEL, WindowFromPoint,
    };

    const WHEEL_DELTA: i32 = 120;

    pub fn cursor() -> Option<Point> {
        let mut p = POINT::default();
        unsafe { GetCursorPos(&mut p) }
            .ok()
            .map(|_| Point { x: p.x, y: p.y })
    }

    pub fn set_cursor(p: Point) -> bool {
        unsafe { SetCursorPos(p.x, p.y) }.is_ok()
    }

    /// Brings `target` (or else the window under `p`) to the front, so nothing covers the area
    /// and the app treats the wheel as meant for it. Best effort.
    pub fn bring_to_front(target: Option<isize>, p: Point) {
        unsafe {
            let hwnd = match target {
                Some(handle) => HWND(handle as *mut c_void),
                None => GetAncestor(WindowFromPoint(POINT { x: p.x, y: p.y }), GA_ROOT),
            };
            if !hwnd.is_invalid() && IsWindow(Some(hwnd)).as_bool() {
                let _ = SetForegroundWindow(hwnd);
            }
        }
    }

    /// One wheel event per notch; some apps ignore anything but whole single notches.
    pub fn send_wheel(notches: i32) {
        let delta = if notches > 0 {
            -WHEEL_DELTA
        } else {
            WHEEL_DELTA
        };
        let input = INPUT {
            r#type: INPUT_MOUSE,
            Anonymous: INPUT_0 {
                mi: MOUSEINPUT {
                    mouseData: delta as u32,
                    dwFlags: MOUSEEVENTF_WHEEL,
                    ..Default::default()
                },
            },
        };
        let inputs = vec![input; notches.unsigned_abs() as usize];
        unsafe { SendInput(&inputs, size_of::<INPUT>() as i32) };
    }

    pub fn post_wheel(p: Point, notches: i32) {
        let delta = if notches > 0 {
            -WHEEL_DELTA
        } else {
            WHEEL_DELTA
        };
        unsafe {
            let hwnd = WindowFromPoint(POINT { x: p.x, y: p.y });
            if hwnd.is_invalid() {
                return;
            }
            // HIWORD of wParam is the delta; lParam holds the screen point.
            let wparam = WPARAM(((delta as i16 as u16 as u32) << 16) as usize);
            let lparam =
                LPARAM((((p.y as i16 as u16 as u32) << 16) | p.x as i16 as u16 as u32) as isize);
            for _ in 0..notches.unsigned_abs() {
                let _ = PostMessageW(Some(hwnd), WM_MOUSEWHEEL, wparam, lparam);
            }
        }
    }
}

#[cfg(not(windows))]
mod platform {
    use super::Point;

    pub fn cursor() -> Option<Point> {
        None
    }
    pub fn set_cursor(_: Point) -> bool {
        false
    }
    pub fn bring_to_front(_: Option<isize>, _: Point) {}
    pub fn send_wheel(_: i32) {}
    pub fn post_wheel(_: Point, _: i32) {}
}
