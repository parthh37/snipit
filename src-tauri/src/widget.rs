//! The floating capture widget: a small tab docked to the top, left or right edge of a monitor
//! that drops open on hover into a round capture button flanked by a menu and an "open
//! Snipit" button, with a drawer for picking the capture mode (in the spirit of Snagit's
//! OneClick widget). Dragging it slides it along an edge and snaps it to whichever edge of whichever
//! monitor the cursor is nearest, and it remembers where it was left.
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
/// Tells the widget page which edge it is docked to now; payload is `Edge`.
const EDGE_EVENT: &str = "widget:edge";

/// Window sizes in logical pixels, as (width, height). The tab is given for the top edge and
/// turned on its side on a left or right edge; the open card is the same on every edge.
const TAB: (f64, f64) = (64.0, 20.0);
const OPEN: (f64, f64) = (224.0, 112.0);
/// Open with the mode list or the menu pulled out underneath.
const DRAWER: (f64, f64) = (224.0, 268.0);

/// How much of the widget is showing.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum WidgetLayout {
    /// Just the tab hanging from the edge.
    #[default]
    Collapsed,
    /// The capture button and its neighbours.
    Open,
    /// Open, plus the drawer underneath.
    Drawer,
}

/// While dragging, the widget only jumps to another edge once that edge is this much closer
/// to the cursor (logical px), so sliding along an edge near a corner doesn't flicker.
const SNAP_BIAS: f64 = 48.0;

/// The screen edge the widget hangs from.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Edge {
    #[default]
    Top,
    Left,
    Right,
}

/// Where the widget is docked, in physical screen pixels: the edge, plus a point on the
/// monitor it is docked to. On the top edge the point is (tab centre x, top of the work area);
/// on a side it is (the work area's outermost column on that side, tab centre y). Settings
/// saved before side docking have no `edge` and mean the top.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Anchor {
    #[serde(default)]
    pub edge: Edge,
    pub x: i32,
    pub y: i32,
}

impl Anchor {
    fn new(edge: Edge, area: Area, centre: i32) -> Self {
        let (x, y) = match edge {
            Edge::Top => (centre, area.y),
            Edge::Left => (area.x, centre),
            Edge::Right => (area.right() - 1, centre),
        };
        Self { edge, x, y }
    }

    /// The tab's centre along its edge.
    fn along(self) -> i32 {
        match self.edge {
            Edge::Top => self.x,
            Edge::Left | Edge::Right => self.y,
        }
    }
}

/// A screen rectangle in physical pixels.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct Area {
    x: i32,
    y: i32,
    width: i32,
    height: i32,
}

impl Area {
    /// The part of a monitor not covered by the taskbar.
    fn work_area(monitor: &Monitor) -> Self {
        let rect = monitor.work_area();
        Self {
            x: rect.position.x,
            y: rect.position.y,
            width: rect.size.width as i32,
            height: rect.size.height as i32,
        }
    }

    fn right(self) -> i32 {
        self.x + self.width
    }

    fn bottom(self) -> i32 {
        self.y + self.height
    }
}

#[derive(Default)]
struct Layout {
    anchor: Option<Anchor>,
    layout: WidgetLayout,
    /// Logical distance along the edge from the window's leading side (left on the top
    /// edge, top on a side) to the cursor when a drag started.
    grab: f64,
    /// The edge the page was last told about.
    page_edge: Option<Edge>,
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
    app.state::<WidgetState>().0.lock().unwrap().layout = WidgetLayout::Collapsed;
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
        .inner_size(TAB.0, TAB.1)
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

fn contains(monitor: &Monitor, x: i32, y: i32) -> bool {
    let (p, s) = (monitor.position(), monitor.size());
    x >= p.x && x < p.x + s.width as i32 && y >= p.y && y < p.y + s.height as i32
}

/// The monitor containing the point, if any is connected there.
fn monitor_containing(app: &AppHandle, x: i32, y: i32) -> Option<Monitor> {
    let monitors = app.available_monitors().ok()?;
    monitors.into_iter().find(|m| contains(m, x, y))
}

/// The monitor containing the point, or the primary one.
fn monitor_at(app: &AppHandle, x: i32, y: i32) -> Option<Monitor> {
    monitor_containing(app, x, y).or_else(|| primary_monitor(app))
}

fn primary_monitor(app: &AppHandle) -> Option<Monitor> {
    app.primary_monitor()
        .ok()
        .flatten()
        .or_else(|| app.available_monitors().ok()?.into_iter().next())
}

/// The window's physical size docked to `edge`.
fn window_size(edge: Edge, layout: WidgetLayout, scale: f64) -> PhysicalSize<u32> {
    let (w, h) = match (edge, layout) {
        (Edge::Top, WidgetLayout::Collapsed) => TAB,
        (_, WidgetLayout::Collapsed) => (TAB.1, TAB.0),
        (_, WidgetLayout::Open) => OPEN,
        (_, WidgetLayout::Drawer) => DRAWER,
    };
    let physical = |logical: f64| (logical * scale).round() as u32;
    PhysicalSize::new(physical(w), physical(h))
}

/// The window's length along `edge`.
fn length_along(edge: Edge, size: PhysicalSize<u32>) -> i32 {
    match edge {
        Edge::Top => size.width as i32,
        Edge::Left | Edge::Right => size.height as i32,
    }
}

/// Where the widget goes on `edge` of a monitor whose work area is `area`, with the tab
/// centred on `wanted` along that edge (by default the middle of it): returns the window's
/// position, its size and the clamped anchor to remember.
///
/// The remembered centre is the tab's, so the tab returns to the same spot after the longer
/// panel had to be pushed in from a corner.
fn layout_on(
    area: Area,
    scale: f64,
    edge: Edge,
    layout: WidgetLayout,
    wanted: Option<i32>,
) -> (PhysicalPosition<i32>, PhysicalSize<u32>, Anchor) {
    let size = window_size(edge, layout, scale);
    let length = length_along(edge, size);
    let tab_half = length_along(edge, window_size(edge, WidgetLayout::Collapsed, scale)) / 2;
    let (start, end) = match edge {
        Edge::Top => (area.x, area.right()),
        Edge::Left | Edge::Right => (area.y, area.bottom()),
    };

    let wanted = wanted.unwrap_or(start + (end - start) / 2);
    let centre = wanted.clamp(start + tab_half, (end - tab_half).max(start + tab_half));
    let lead = (centre - length / 2).clamp(start, (end - length).max(start));
    let position = match edge {
        Edge::Top => PhysicalPosition::new(lead, area.y),
        Edge::Left => PhysicalPosition::new(area.x, lead),
        Edge::Right => PhysicalPosition::new(area.right() - size.width as i32, lead),
    };
    (position, size, Anchor::new(edge, area, centre))
}

/// The edge of `area` nearest the cursor, staying on `current` unless another edge is more
/// than `bias` physical pixels closer. The bottom edge is left to the taskbar.
fn nearest_edge(area: Area, x: i32, y: i32, current: Edge, bias: i32) -> Edge {
    let distance = |edge| match edge {
        Edge::Top => y - area.y,
        Edge::Left => x - area.x,
        Edge::Right => area.right() - 1 - x,
    };
    let mut best = (current, distance(current) - bias);
    for edge in [Edge::Top, Edge::Left, Edge::Right] {
        let d = distance(edge);
        if d < best.1 {
            best = (edge, d);
        }
    }
    best.0
}

/// Sizes and positions the window for the current anchor and state, keeping it inside the
/// work area of `monitor`, or by default of the monitor the anchor is on. An anchor left on a
/// monitor that has since been unplugged moves to the middle of the same edge of the primary
/// monitor. Stores the clamped anchor back, and tells the page if the edge changed.
fn place(app: &AppHandle, window: &WebviewWindow, monitor: Option<Monitor>) {
    let state = app.state::<WidgetState>();
    let mut layout = state.0.lock().unwrap();
    let anchor = layout.anchor;
    let (monitor, wanted) = match (monitor, anchor) {
        (Some(m), a) => (m, a.map(Anchor::along)),
        (None, Some(a)) => match monitor_containing(app, a.x, a.y) {
            Some(m) => (m, Some(a.along())),
            None => match primary_monitor(app) {
                Some(m) => (m, None),
                None => return,
            },
        },
        (None, None) => match primary_monitor(app) {
            Some(m) => (m, None),
            None => return,
        },
    };
    let edge = anchor.map_or(Edge::Top, |a| a.edge);
    let (position, size, anchor) = layout_on(
        Area::work_area(&monitor),
        monitor.scale_factor(),
        edge,
        layout.layout,
        wanted,
    );
    layout.anchor = Some(anchor);
    let edge_changed = layout.page_edge != Some(edge);
    layout.page_edge = Some(edge);
    drop(layout);

    if edge_changed {
        let _ = window.emit_to(LABEL, EDGE_EVENT, edge);
    }
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

/// The edge the widget is docked to, for the page to lay itself out when it loads.
#[tauri::command]
pub fn widget_edge(app: AppHandle) -> Edge {
    let state = app.state::<WidgetState>();
    let mut layout = state.0.lock().unwrap();
    let edge = layout.anchor.map_or(Edge::Top, |a| a.edge);
    layout.page_edge = Some(edge);
    edge
}

#[tauri::command]
pub fn widget_set_layout(app: AppHandle, layout: WidgetLayout) {
    let Some(window) = window(&app) else { return };
    app.state::<WidgetState>().0.lock().unwrap().layout = layout;
    place(&app, &window, None);
}

#[tauri::command]
pub fn widget_drag_start(app: AppHandle) {
    let (Some(window), Ok(cursor)) = (window(&app), app.cursor_position()) else {
        return;
    };
    let (Ok(position), Ok(scale)) = (window.outer_position(), window.scale_factor()) else {
        return;
    };
    let state = app.state::<WidgetState>();
    let mut layout = state.0.lock().unwrap();
    let grab = match layout.anchor.map_or(Edge::Top, |a| a.edge) {
        Edge::Top => cursor.x - position.x as f64,
        Edge::Left | Edge::Right => cursor.y - position.y as f64,
    };
    layout.grab = (grab / scale).max(0.0);
}

/// Follows the cursor along the nearest edge of whichever monitor it is on.
#[tauri::command]
pub fn widget_drag_move(app: AppHandle) {
    let (Some(window), Ok(cursor)) = (window(&app), app.cursor_position()) else {
        return;
    };
    let (cx, cy) = (cursor.x as i32, cursor.y as i32);
    let Some(monitor) = monitor_at(&app, cx, cy) else {
        return;
    };
    let area = Area::work_area(&monitor);
    let scale = monitor.scale_factor();
    {
        let state = app.state::<WidgetState>();
        let mut layout = state.0.lock().unwrap();
        let current = layout.anchor.map_or(Edge::Top, |a| a.edge);
        let edge = nearest_edge(area, cx, cy, current, (SNAP_BIAS * scale).round() as i32);
        // Keep the spot that was grabbed under the cursor, clamped to the window's length
        // along the new edge after jumping between the top and a side.
        let length = length_along(edge, window_size(edge, layout.layout, scale));
        let grab = ((layout.grab * scale).round() as i32).min(length - 1);
        let cursor_along = if edge == Edge::Top { cx } else { cy };
        layout.anchor = Some(Anchor::new(edge, area, cursor_along - grab + length / 2));
    }
    // The monitor under the cursor, even while the grab keeps the tab's centre on the last one.
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

/// Opens the main window on its Settings page (the widget's menu).
#[tauri::command]
pub fn open_settings(app: AppHandle) {
    tray::navigate(&app, "settings");
}

/// "Quit Snipit" from the widget's menu, like the tray's.
#[tauri::command]
pub fn quit_app(app: AppHandle) {
    app.exit(0);
}

#[cfg(test)]
mod tests {
    use super::*;

    const FHD: Area = Area {
        x: 0,
        y: 0,
        width: 1920,
        height: 1032,
    };
    /// A second 1920×1080 monitor to the right of the first.
    const SECOND: Area = Area {
        x: 1920,
        y: 0,
        width: 1920,
        height: 1032,
    };

    #[test]
    fn defaults_to_top_centre() {
        let (pos, size, anchor) = layout_on(FHD, 1.0, Edge::Top, WidgetLayout::Collapsed, None);
        assert_eq!((pos.x, pos.y, size.width, size.height), (928, 0, 64, 20));
        assert_eq!(
            anchor,
            Anchor {
                edge: Edge::Top,
                x: 960,
                y: 0
            }
        );
    }

    #[test]
    fn panel_opens_around_the_tab() {
        let (pos, size, anchor) = layout_on(FHD, 1.0, Edge::Top, WidgetLayout::Open, Some(960));
        assert_eq!(anchor.along(), 960);
        assert_eq!(pos.x + size.width as i32 / 2, 960);
    }

    #[test]
    fn panel_is_pushed_in_from_the_edge_but_tab_stays() {
        // Tab dragged hard against the right edge of a second monitor.
        let (pos, size, anchor) = layout_on(SECOND, 1.0, Edge::Top, WidgetLayout::Open, Some(5000));
        assert_eq!(anchor.x, 3840 - 32);
        assert_eq!(pos.x + size.width as i32, 3840);
        let (pos, size, _) = layout_on(
            SECOND,
            1.0,
            Edge::Top,
            WidgetLayout::Collapsed,
            Some(anchor.x),
        );
        assert_eq!(pos.x + size.width as i32, 3840);
    }

    #[test]
    fn scales_with_the_monitor() {
        let (_, size, _) = layout_on(FHD, 1.5, Edge::Top, WidgetLayout::Open, None);
        assert_eq!((size.width, size.height), (336, 168));
    }

    #[test]
    fn docks_to_the_left_edge() {
        let (pos, size, anchor) = layout_on(FHD, 1.0, Edge::Left, WidgetLayout::Collapsed, None);
        assert_eq!((size.width, size.height), (20, 64));
        assert_eq!((pos.x, pos.y), (0, 516 - 32));
        assert_eq!(
            anchor,
            Anchor {
                edge: Edge::Left,
                x: 0,
                y: 516
            }
        );
        let (pos, size, _) = layout_on(FHD, 1.0, Edge::Left, WidgetLayout::Open, Some(516));
        assert_eq!((size.width, size.height), (224, 112));
        assert_eq!((pos.x, pos.y + size.height as i32 / 2), (0, 516));
    }

    #[test]
    fn docks_to_the_right_edge_of_the_second_monitor() {
        let (pos, size, anchor) =
            layout_on(SECOND, 1.0, Edge::Right, WidgetLayout::Open, Some(-50));
        // Flush with the right edge, pushed down from the top corner.
        assert_eq!(pos.x + size.width as i32, 3840);
        assert_eq!(pos.y, 0);
        assert_eq!(anchor.y, 32);
        // The anchor stays on the monitor it is docked to.
        assert_eq!(anchor.x, 3839);
        // And never runs onto the taskbar.
        let (pos, size, _) = layout_on(SECOND, 1.0, Edge::Right, WidgetLayout::Open, Some(5000));
        assert_eq!(pos.y + size.height as i32, 1032);
    }

    #[test]
    fn monitors_left_of_and_above_the_primary() {
        let area = Area {
            x: -2560,
            y: -400,
            width: 2560,
            height: 1400,
        };
        let (pos, size, anchor) = layout_on(area, 1.25, Edge::Left, WidgetLayout::Collapsed, None);
        assert_eq!(pos.x, -2560);
        assert_eq!(pos.y + size.height as i32 / 2, 300);
        assert_eq!((anchor.x, anchor.y), (-2560, 300));
        let (pos, _, _) = layout_on(area, 1.25, Edge::Top, WidgetLayout::Collapsed, None);
        assert_eq!(pos.y, -400);
    }

    #[test]
    fn snaps_to_the_nearest_edge() {
        let bias = 48;
        // Pulled down the middle of the screen: stays on top.
        assert_eq!(nearest_edge(FHD, 960, 500, Edge::Top, bias), Edge::Top);
        // Pulled to the left side.
        assert_eq!(nearest_edge(FHD, 20, 400, Edge::Top, bias), Edge::Left);
        // Pulled to the right side of the second monitor.
        assert_eq!(
            nearest_edge(SECOND, 3830, 600, Edge::Top, bias),
            Edge::Right
        );
        // Sliding along the top across the border between the two monitors doesn't flip the
        // widget onto the inner sides.
        assert_eq!(nearest_edge(FHD, 1919, 30, Edge::Top, bias), Edge::Top);
        assert_eq!(nearest_edge(SECOND, 1920, 30, Edge::Top, bias), Edge::Top);
        // Near the top-left corner it stays wherever it already is.
        assert_eq!(nearest_edge(FHD, 30, 40, Edge::Left, bias), Edge::Left);
        assert_eq!(nearest_edge(FHD, 40, 30, Edge::Top, bias), Edge::Top);
    }

    #[test]
    fn old_saved_positions_mean_the_top_edge() {
        let anchor: Anchor = serde_json::from_str(r#"{"x":2880,"y":0}"#).unwrap();
        assert_eq!(
            anchor,
            Anchor {
                edge: Edge::Top,
                x: 2880,
                y: 0
            }
        );
        let json = serde_json::to_string(&Anchor {
            edge: Edge::Right,
            x: 1,
            y: 2,
        })
        .unwrap();
        assert_eq!(json, r#"{"edge":"right","x":1,"y":2}"#);
    }
}
