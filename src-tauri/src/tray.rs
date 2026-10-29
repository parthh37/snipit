use tauri::{
    AppHandle, Manager, Runtime,
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
};

use crate::capture::{self, CaptureMode};

const MENU_OPEN: &str = "open";
const MENU_REGION: &str = "capture-region";
const MENU_FULLSCREEN: &str = "capture-fullscreen";
const MENU_CLIPBOARD: &str = "annotate-clipboard";
const MENU_QUIT: &str = "quit";

/// Creates the system tray icon. Left click opens the main window; right click shows the menu.
pub fn init<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let region = MenuItem::with_id(app, MENU_REGION, "Capture region", true, None::<&str>)?;
    let fullscreen = MenuItem::with_id(
        app,
        MENU_FULLSCREEN,
        "Capture full screen",
        true,
        None::<&str>,
    )?;
    let clipboard = MenuItem::with_id(
        app,
        MENU_CLIPBOARD,
        "Annotate clipboard image",
        true,
        None::<&str>,
    )?;
    let open = MenuItem::with_id(app, MENU_OPEN, "Open Snipit", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let separator2 = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, MENU_QUIT, "Quit Snipit", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[
            &region,
            &fullscreen,
            &clipboard,
            &separator,
            &open,
            &separator2,
            &quit,
        ],
    )?;

    let mut tray = TrayIconBuilder::with_id("main")
        .tooltip("Snipit")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            MENU_OPEN => show_main_window(app),
            MENU_REGION => capture::start(app, CaptureMode::Region),
            MENU_FULLSCREEN => capture::start(app, CaptureMode::Fullscreen),
            MENU_CLIPBOARD => capture::annotate_clipboard(app),
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
