use tauri::{
    AppHandle, Emitter, Manager, Runtime,
    menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
};

use crate::capture::{self, CaptureMode};
use crate::{settings, widget};

const MENU_CAPTURE: &str = "capture";
const MENU_CAPTURE_FULLSCREEN: &str = "capture_fullscreen";
const MENU_CAPTURE_SCROLLING: &str = "capture_scrolling";
const MENU_ANNOTATE_CLIPBOARD: &str = "annotate_clipboard";
const MENU_WIDGET: &str = "widget";
const MENU_OPEN: &str = "open";
const MENU_CHECK_UPDATES: &str = "check-updates";
const MENU_QUIT: &str = "quit";

/// Event the main window listens for to run an update check (see `src/windows/main/useUpdater.ts`).
const EVENT_CHECK_UPDATES: &str = "check-for-updates";

/// Creates the system tray icon. Left click opens the main window; right click shows the menu.
pub fn init(app: &AppHandle) -> tauri::Result<()> {
    let capture = MenuItem::with_id(
        app,
        MENU_CAPTURE,
        "Capture region or window",
        true,
        None::<&str>,
    )?;
    let capture_fullscreen = MenuItem::with_id(
        app,
        MENU_CAPTURE_FULLSCREEN,
        "Capture full screen",
        true,
        None::<&str>,
    )?;
    let capture_scrolling = MenuItem::with_id(
        app,
        MENU_CAPTURE_SCROLLING,
        "Scrolling capture (long page)",
        true,
        None::<&str>,
    )?;
    let annotate_clipboard = MenuItem::with_id(
        app,
        MENU_ANNOTATE_CLIPBOARD,
        "Annotate clipboard image",
        true,
        None::<&str>,
    )?;
    let show_widget = CheckMenuItem::with_id(
        app,
        MENU_WIDGET,
        "Show capture widget",
        true,
        settings::get(app).show_widget,
        None::<&str>,
    )?;
    app.manage(widget::TrayToggle(show_widget.clone()));
    let open = MenuItem::with_id(app, MENU_OPEN, "Open Snipit", true, None::<&str>)?;
    let check_updates = MenuItem::with_id(
        app,
        MENU_CHECK_UPDATES,
        "Check for updates…",
        true,
        None::<&str>,
    )?;
    let quit = MenuItem::with_id(app, MENU_QUIT, "Quit Snipit", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[
            &capture,
            &capture_fullscreen,
            &capture_scrolling,
            &annotate_clipboard,
            &PredefinedMenuItem::separator(app)?,
            &show_widget,
            &open,
            &check_updates,
            &PredefinedMenuItem::separator(app)?,
            &quit,
        ],
    )?;

    let mut tray = TrayIconBuilder::with_id("main")
        .tooltip("Snipit")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            MENU_CAPTURE => capture::start(app, CaptureMode::Interactive, true),
            MENU_CAPTURE_FULLSCREEN => capture::start(app, CaptureMode::Fullscreen, true),
            MENU_CAPTURE_SCROLLING => capture::start(app, CaptureMode::Scrolling, true),
            MENU_ANNOTATE_CLIPBOARD => capture::annotate_clipboard(app),
            MENU_WIDGET => {
                let enabled = !settings::get(app).show_widget;
                if let Err(err) = widget::set_enabled(app, enabled) {
                    eprintln!("Couldn't change the capture widget setting: {err}");
                }
            }
            MENU_OPEN => show_main_window(app),
            MENU_CHECK_UPDATES => {
                show_main_window(app);
                let _ = app.emit_to("main", EVENT_CHECK_UPDATES, ());
            }
            MENU_QUIT => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        });

    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }

    tray.build(app)?;
    Ok(())
}

pub fn show_main_window<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}
