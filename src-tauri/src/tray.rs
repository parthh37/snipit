use tauri::{
    AppHandle, Emitter, Manager, Runtime,
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
};

use crate::capture::{self, CaptureMode};

const MENU_CAPTURE: &str = "capture";
const MENU_CAPTURE_FULLSCREEN: &str = "capture_fullscreen";
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
            &PredefinedMenuItem::separator(app)?,
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
