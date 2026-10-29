use tauri::{
    AppHandle, Emitter, Manager, Runtime,
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
};

const MENU_OPEN: &str = "open";
const MENU_CHECK_UPDATES: &str = "check-updates";
const MENU_QUIT: &str = "quit";

/// Event the main window listens for to run an update check (see `src/useUpdater.ts`).
const EVENT_CHECK_UPDATES: &str = "check-for-updates";

/// Creates the system tray icon. Left click opens the main window; right click shows the menu.
pub fn init<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, MENU_OPEN, "Open Snipit", true, None::<&str>)?;
    let check_updates = MenuItem::with_id(
        app,
        MENU_CHECK_UPDATES,
        "Check for updates…",
        true,
        None::<&str>,
    )?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, MENU_QUIT, "Quit Snipit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &check_updates, &separator, &quit])?;

    let mut tray = TrayIconBuilder::with_id("main")
        .tooltip("Snipit")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
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
