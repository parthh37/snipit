//! The delay before a timed capture: a small pill counts down in the middle of the monitor
//! under the cursor, so menus and hover states can be set up first. Esc cancels it. Like the
//! scrolling capture's status pill, the window is click-through, never takes focus and is
//! excluded from screen capture.

use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use std::time::{Duration, Instant};

use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindowBuilder,
};

use crate::shortcuts;

pub const LABEL: &str = "countdown";
/// Seconds left; payload is a number.
const TICK_EVENT: &str = "countdown:tick";
/// Logical size of the pill window.
const SIZE: (f64, f64) = (300.0, 56.0);

#[derive(Default)]
pub struct CountdownState {
    active: AtomicBool,
    cancelled: AtomicBool,
}

pub fn is_active(app: &AppHandle) -> bool {
    app.state::<CountdownState>().active.load(Ordering::SeqCst)
}

/// Stops a running countdown; returns false if none is running.
pub fn cancel(app: &AppHandle) -> bool {
    let state = app.state::<CountdownState>();
    if !state.active.load(Ordering::SeqCst) {
        return false;
    }
    state.cancelled.store(true, Ordering::SeqCst);
    true
}

/// Counts down `seconds`, blocking the calling (worker) thread. Returns false if it was
/// cancelled, or if another countdown is already running.
pub fn run(app: &AppHandle, seconds: u32) -> bool {
    let state = app.state::<CountdownState>();
    if state.active.swap(true, Ordering::SeqCst) {
        return false;
    }
    state.cancelled.store(false, Ordering::SeqCst);
    shortcuts::grab_escape(app);
    show(app);

    let start = Instant::now();
    let total = Duration::from_secs(seconds.into());
    let mut sent: Option<(u32, Instant)> = None;
    while start.elapsed() < total && !state.cancelled.load(Ordering::SeqCst) {
        let left = (total - start.elapsed()).as_secs_f64().ceil() as u32;
        // Repeated now and then: the page may not have been listening yet the first time.
        let due = sent.is_none_or(|(n, at)| n != left || at.elapsed() > Duration::from_millis(250));
        if due {
            sent = Some((left, Instant::now()));
            let _ = app.emit_to(LABEL, TICK_EVENT, left);
        }
        thread::sleep(Duration::from_millis(40));
    }

    if let Some(window) = app.get_webview_window(LABEL) {
        let _ = window.destroy();
    }
    // Synchronously, so the capture that follows can grab Esc again.
    shortcuts::release_escape_now(app);
    state.active.store(false, Ordering::SeqCst);
    !state.cancelled.load(Ordering::SeqCst)
}

fn show(app: &AppHandle) {
    let cursor = app.cursor_position().ok();
    let monitor = cursor
        .and_then(|c| app.monitor_from_point(c.x, c.y).ok().flatten())
        .or_else(|| app.primary_monitor().ok().flatten());
    let Some(monitor) = monitor else { return };
    let scale = monitor.scale_factor();
    let size = PhysicalSize::new(
        (SIZE.0 * scale).round() as u32,
        (SIZE.1 * scale).round() as u32,
    );
    let area = monitor.work_area();
    let position = PhysicalPosition::new(
        area.position.x + (area.size.width as i32 - size.width as i32) / 2,
        area.position.y + (area.size.height as i32 - size.height as i32) / 2,
    );
    let window = WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("index.html".into()))
        .title("Snipit capture countdown")
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
            let _ = window.set_ignore_cursor_events(true);
            let _ = window.set_position(position);
            let _ = window.set_size(size);
            let _ = window.set_position(position);
            let _ = window.show();
        }
        Err(err) => eprintln!("Couldn't show the capture countdown: {err}"),
    }
}
