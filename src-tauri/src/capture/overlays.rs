//! The capture overlay windows, one per monitor.
//!
//! Building a webview and loading the page into it takes far longer than freezing the screen,
//! so Snipit keeps a hidden overlay per monitor already built and loaded. A capture takes those
//! and only has to hand them the frozen frame; fresh spares are built in the background after
//! it closes. Each window serves a single capture, so it can never flash an earlier frame.

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, mpsc};
use std::thread;
use std::time::Duration;

use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder,
};
use xcap::image::RgbaImage;

use super::geometry::Rect;

/// Every overlay label starts with this (the overlay capability matches `overlay-*`).
pub const PREFIX: &str = "overlay-";
/// Tells a ready overlay that it has been given a monitor of the current capture.
const START_EVENT: &str = "overlay:start";
/// Lets the finished capture hand its result over before new spares compete for the CPU.
const REFILL_DELAY: Duration = Duration::from_millis(800);

#[derive(Default)]
pub struct OverlayPool {
    /// Labels of hidden overlays that are built and have not been used yet.
    spares: Mutex<Vec<String>>,
    refilling: AtomicBool,
}

static NEXT_ID: AtomicU64 = AtomicU64::new(0);

fn next_label() -> String {
    format!("{PREFIX}{}", NEXT_ID.fetch_add(1, Ordering::Relaxed))
}

pub fn is_overlay(label: &str) -> bool {
    label.starts_with(PREFIX)
}

fn build(app: &AppHandle, label: &str) -> tauri::Result<WebviewWindow> {
    // Created hidden; the overlay page shows itself once the frozen frame is drawn.
    WebviewWindowBuilder::new(app, label, WebviewUrl::App("index.html".into()))
        .title("Snipit capture")
        .visible(false)
        .decorations(false)
        .resizable(false)
        .shadow(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .build()
}

/// Labels for the overlays of a capture across `count` monitors: ready spares first, then new
/// labels whose windows [`present`] builds on the spot.
pub fn take(app: &AppHandle, count: usize) -> Vec<String> {
    let pool = app.state::<OverlayPool>();
    let mut spares = pool.spares.lock().unwrap();
    spares.retain(|label| app.get_webview_window(label).is_some());
    let ready = count.min(spares.len());
    let mut labels: Vec<String> = spares.drain(..ready).collect();
    labels.extend((ready..count).map(|_| next_label()));
    labels
}

/// Moves overlay `label` onto the monitor at `bounds` and tells it to start.
pub fn present(app: &AppHandle, label: &str, bounds: Rect) -> tauri::Result<()> {
    let window = match app.get_webview_window(label) {
        Some(window) => window,
        // A window built here asks for its capture as soon as its page loads.
        None => build(app, label)?,
    };
    // Physical units, so it lands exactly on the monitor whatever its scale factor.
    window.set_position(PhysicalPosition::new(bounds.x, bounds.y))?;
    window.set_size(PhysicalSize::new(bounds.width, bounds.height))?;
    window.emit_to(label, START_EVENT, ())?;
    Ok(())
}

/// Hands `image` to the page in `window` through WebView2 shared memory, where it arrives as a
/// `sharedbufferreceived` event. Streaming a frame through the IPC protocol instead takes over
/// 100 ms at 1080p. Fails if the WebView2 runtime is too old; call it off the main thread.
#[cfg(windows)]
pub fn share_frame(window: &WebviewWindow, image: Arc<RgbaImage>) -> Result<(), String> {
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        COREWEBVIEW2_SHARED_BUFFER_ACCESS_READ_WRITE, ICoreWebView2_17, ICoreWebView2Environment12,
    };
    use windows::core::{Interface, w};

    let (done, result) = mpsc::sync_channel(1);
    window
        .with_webview(move |webview| {
            let post = || -> windows::core::Result<()> {
                let bytes = image.as_raw();
                unsafe {
                    let env: ICoreWebView2Environment12 = webview.environment().cast()?;
                    let core: ICoreWebView2_17 = webview.controller().CoreWebView2()?.cast()?;
                    let buffer = env.CreateSharedBuffer(bytes.len() as u64)?;
                    let mut target = std::ptr::null_mut();
                    buffer.Buffer(&mut target)?;
                    std::ptr::copy_nonoverlapping(bytes.as_ptr(), target, bytes.len());
                    // The page keeps its mapping after this reference is dropped.
                    core.PostSharedBufferToScript(
                        &buffer,
                        COREWEBVIEW2_SHARED_BUFFER_ACCESS_READ_WRITE,
                        w!("{}"),
                    )
                }
            };
            let _ = done.send(post().map_err(|e| e.to_string()));
        })
        .map_err(|e| e.to_string())?;
    result
        .recv_timeout(Duration::from_secs(2))
        .map_err(|e| e.to_string())?
}

#[cfg(not(windows))]
pub fn share_frame(_window: &WebviewWindow, _image: Arc<RgbaImage>) -> Result<(), String> {
    Err("Shared buffers are WebView2 only".into())
}

/// Destroys the overlays of the capture that just ended and readies new ones.
pub fn close(app: &AppHandle) {
    let spares = app.state::<OverlayPool>().spares.lock().unwrap().clone();
    for (label, window) in app.webview_windows() {
        if is_overlay(&label) && !spares.contains(&label) {
            let _ = window.destroy();
        }
    }
    refill(app, REFILL_DELAY);
}

/// Builds hidden spare overlays on a worker thread, after `delay`, until there is one per
/// monitor. Never builds windows on the calling thread: that deadlocks from sync commands.
pub fn refill(app: &AppHandle, delay: Duration) {
    if app
        .state::<OverlayPool>()
        .refilling
        .swap(true, Ordering::SeqCst)
    {
        return;
    }
    let app = app.clone();
    thread::spawn(move || {
        thread::sleep(delay);
        let pool = app.state::<OverlayPool>();
        let wanted = app.available_monitors().map_or(1, |m| m.len()).max(1);
        while pool.spares.lock().unwrap().len() < wanted {
            // Not holding the lock while building: that waits on the main thread, which may
            // be taking spares for a capture.
            let label = next_label();
            match build(&app, &label) {
                Ok(_) => pool.spares.lock().unwrap().push(label),
                Err(err) => {
                    eprintln!("Couldn't prepare a capture overlay: {err}");
                    break;
                }
            }
        }
        pool.refilling.store(false, Ordering::SeqCst);
    });
}
