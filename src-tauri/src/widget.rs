//! The floating capture widget: a small tab docked to the top edge of a monitor that slides
//! open on hover with the capture buttons (in the spirit of Snagit's capture widget). It can be
//! slid along the top edge, including onto another monitor, and remembers where it was left.
//!
//! The window is excluded from screen capture and never takes focus, so clicking it leaves the
//! app you were working in active and the widget never shows up in a snip.

use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{
    AppHandle, Emitter, Manager, Monitor, PhysicalPosition, PhysicalSize, Runtime, WebviewUrl,
    WebviewWindow, WebviewWindowBuilder, menu::CheckMenuItem,
};

use crate::settings::{self, Settings};
use crate::tray;

pub const LABEL: &str = "widget";
/// Settings changed outside the main window (e.g. the widget was closed); payload is `Settings`.
pub const SETTINGS_CHANGED_EVENT: &str = "settings-changed";
/// Tells the widget page its window was put back to the collapsed tab.
const COLLAPSE_EVENT: &str = "widget:collapsed";

/// Window sizes in logical pixels; the page lays itself out to fill them.
const COLLAPSED: (f64, f64) = (76.0, 24.0);
const EXPANDED: (f64, f64) = (430.0, 78.0);

/// Top-centre of the widget in physical screen pixels. `y` is the top of the monitor it is
/// docked to.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Anchor {
    pub x: i32,
    pub y: i32,
}

#[derive(Default)]
struct Layout {
    anchor: Option<Anchor>,
    expanded: bool,
    /// Cursor x minus anchor x when a drag started.
    grab_offset: i32,
}

#[derive(Default)]
pub struct WidgetState(Mutex<Layout>);

/// The tray's "Show capture widget" item, kept in sync with the setting.
pub struct TrayToggle<R: Runtime>(pub CheckMenuItem<R>);

/// Shows the widget at startup if it is switched on.
pub fn init(app: &AppHandle) {
    let saved = settings::get(app);
    app.state::<WidgetState>().0.lock().unwrap().anchor = saved.widget_position;
    if saved.show_widget {
        show(app);
    }
}

fn window(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window(LABEL)
}

fn show(app: &AppHandle) {
    let window = match window(app) {
        Some(w) => w,
        None => match create(app) {
            Ok(w) => w,
            Err(err) => {
                eprintln!("Couldn't create the capture widget: {err}");
                return;
            }
        },
    };
    app.state::<WidgetState>().0.lock().unwrap().expanded = false;
    place(app, &window, None);
    let _ = window.emit_to(LABEL, COLLAPSE_EVENT, ());
    let _ = window.show();
}

fn create(app: &AppHandle) -> tauri::Result<WebviewWindow> {
    WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("index.html".into()))
        .title("Snipit capture widget")
        .visible(false)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .focusable(false)
        .content_protected(true)
        .inner_size(COLLAPSED.0, COLLAPSED.1)
        .build()
}

/// Turns the widget on or off and remembers the choice.
pub fn set_enabled(app: &AppHandle, enabled: bool) -> Result<Settings, String> {
    let next = settings::update(app, |s| s.show_widget = enabled)?;
    if enabled {
        show(app);
    } else if let Some(w) = window(app) {
        let _ = w.hide();
    }
    if let Some(toggle) = app.try_state::<TrayToggle<tauri::Wry>>() {
        let _ = toggle.0.set_checked(enabled);
    }
    let _ = app.emit(SETTINGS_CHANGED_EVENT, &next);
    Ok(next)
}

/// Gets the widget out of the way while the capture overlays are open.
pub fn hide_for_capture(app: &AppHandle) {
    if let Some(w) = window(app) {
        let _ = w.hide();
    }
}

/// Brings the widget back after a capture, if it is switched on.
pub fn restore_after_capture(app: &AppHandle) {
    if settings::get(app).show_widget {
        show(app);
    }
}

/// The monitor containing `point`, or the primary one.
fn monitor_at(app: &AppHandle, x: i32, y: i32) -> Option<Monitor> {
    let monitors = app.available_monitors().ok()?;
    monitors
        .iter()
        .find(|m| {
            let (p, s) = (m.position(), m.size());
            x >= p.x && x < p.x + s.width as i32 && y >= p.y && y < p.y + s.height as i32
        })
        .cloned()
        .or_else(|| app.primary_monitor().ok().flatten())
        .or_else(|| monitors.into_iter().next())
}

/// Where the widget goes on a monitor spanning `monitor_x..monitor_x + monitor_width`:
/// returns the window's left edge, its size and the clamped centre to remember.
///
/// The remembered centre is the tab's, so the tab returns to the same spot after the wider
/// panel had to be pushed in from a screen edge.
fn layout_on(
    monitor_x: i32,
    monitor_width: i32,
    scale: f64,
    expanded: bool,
    wanted_x: Option<i32>,
) -> (i32, PhysicalSize<u32>, i32) {
    let physical = |logical: f64| (logical * scale).round() as u32;
    let (w, h) = if expanded { EXPANDED } else { COLLAPSED };
    let size = PhysicalSize::new(physical(w), physical(h));
    let width = size.width as i32;
    let tab_half = physical(COLLAPSED.0) as i32 / 2;
    let right = monitor_x + monitor_width;

    let wanted = wanted_x.unwrap_or(monitor_x + monitor_width / 2);
    let centre = wanted.clamp(
        monitor_x + tab_half,
        (right - tab_half).max(monitor_x + tab_half),
    );
    let left = (centre - width / 2).clamp(monitor_x, (right - width).max(monitor_x));
    (left, size, centre)
}

/// Sizes and positions the window for the current anchor and state on `monitor` (by default
/// the one the anchor is on), keeping it inside that monitor. Stores the clamped anchor back.
fn place(app: &AppHandle, window: &WebviewWindow, monitor: Option<Monitor>) {
    let state = app.state::<WidgetState>();
    let mut layout = state.0.lock().unwrap();
    let monitor = monitor.or_else(|| match layout.anchor {
        Some(a) => monitor_at(app, a.x, a.y),
        None => app.primary_monitor().ok().flatten(),
    });
    let Some(monitor) = monitor else { return };
    let (mx, my) = (monitor.position().x, monitor.position().y);
    let (left, size, centre) = layout_on(
        mx,
        monitor.size().width as i32,
        monitor.scale_factor(),
        layout.expanded,
        layout.anchor.map(|a| a.x),
    );
    layout.anchor = Some(Anchor { x: centre, y: my });
    drop(layout);

    let position = PhysicalPosition::new(left, my);
    // Moving first lets Windows apply the new monitor's DPI before the final size is set.
    let _ = window.set_position(position);
    if window.outer_size().ok() != Some(size) {
        let _ = window.set_size(size);
        let _ = window.set_position(position);
    }
}

#[tauri::command]
pub async fn set_widget_visible(app: AppHandle, visible: bool) -> Result<Settings, String> {
    set_enabled(&app, visible)
}

#[tauri::command]
pub fn widget_set_expanded(app: AppHandle, expanded: bool) {
    let Some(window) = window(&app) else { return };
    app.state::<WidgetState>().0.lock().unwrap().expanded = expanded;
    place(&app, &window, None);
}

#[tauri::command]
pub fn widget_drag_start(app: AppHandle) {
    let Ok(cursor) = app.cursor_position() else {
        return;
    };
    let state = app.state::<WidgetState>();
    let mut layout = state.0.lock().unwrap();
    let anchor_x = layout.anchor.map_or(cursor.x as i32, |a| a.x);
    layout.grab_offset = cursor.x as i32 - anchor_x;
}

/// Follows the cursor along the top edge of whichever monitor it is on.
#[tauri::command]
pub fn widget_drag_move(app: AppHandle) {
    let (Some(window), Ok(cursor)) = (window(&app), app.cursor_position()) else {
        return;
    };
    let (cx, cy) = (cursor.x as i32, cursor.y as i32);
    let Some(monitor) = monitor_at(&app, cx, cy) else {
        return;
    };
    {
        let state = app.state::<WidgetState>();
        let mut layout = state.0.lock().unwrap();
        layout.anchor = Some(Anchor {
            x: cx - layout.grab_offset,
            y: monitor.position().y,
        });
    }
    // The monitor under the cursor, even while the grab offset keeps the centre on the last one.
    place(&app, &window, Some(monitor));
}

/// Saves where the widget was dropped.
#[tauri::command]
pub fn widget_drag_end(app: AppHandle) -> Result<(), String> {
    let anchor = app.state::<WidgetState>().0.lock().unwrap().anchor;
    settings::update(&app, |s| s.widget_position = anchor).map(|_| ())
}

#[tauri::command]
pub fn open_main_window(app: AppHandle) {
    tray::show_main_window(&app);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_to_top_centre() {
        let (left, size, centre) = layout_on(0, 1920, 1.0, false, None);
        assert_eq!((left, size.width, size.height, centre), (922, 76, 24, 960));
    }

    #[test]
    fn panel_opens_around_the_tab() {
        let (left, size, centre) = layout_on(0, 1920, 1.0, true, Some(960));
        assert_eq!(centre, 960);
        assert_eq!(left + size.width as i32 / 2, 960);
    }

    #[test]
    fn panel_is_pushed_in_from_the_edge_but_tab_stays() {
        // Tab dragged hard against the right edge of a second monitor.
        let (left, size, centre) = layout_on(1920, 1920, 1.0, true, Some(5000));
        assert_eq!(centre, 3840 - 38);
        assert_eq!(left + size.width as i32, 3840);
        let (left, size, _) = layout_on(1920, 1920, 1.0, false, Some(centre));
        assert_eq!(left + size.width as i32, 3840);
    }

    #[test]
    fn scales_with_the_monitor() {
        let (_, size, _) = layout_on(0, 2560, 1.5, true, None);
        assert_eq!((size.width, size.height), (645, 117));
    }
}
