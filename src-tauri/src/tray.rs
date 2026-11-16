use std::{path::PathBuf, sync::Mutex, thread};

use chrono::{DateTime, Local, TimeZone};
use tauri::{
    AppHandle, Emitter, Listener, Manager, Runtime, Wry,
    image::Image,
    menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu},
    tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent},
};
use tauri_plugin_notification::NotificationExt;

use crate::{
    capture::{self, CaptureMode},
    gallery,
    settings::{self, ShortcutAction},
    shortcuts, updater, widget,
};

const MENU_CAPTURE: &str = "capture";
const MENU_CAPTURE_FULLSCREEN: &str = "capture_fullscreen";
const MENU_CAPTURE_SCROLLING: &str = "capture_scrolling";
const MENU_ANNOTATE_CLIPBOARD: &str = "annotate_clipboard";
const MENU_OPEN_FOLDER: &str = "open_folder";
const MENU_WIDGET: &str = "widget";
const MENU_PAUSE: &str = "pause";
const MENU_AUTOSTART: &str = "autostart";
const MENU_OPEN: &str = "open";
const MENU_SETTINGS: &str = "settings";
const MENU_CHECK_UPDATES: &str = "check-updates";
const MENU_QUIT: &str = "quit";
/// Recent capture items are `recent:<path of the snip>`.
const MENU_RECENT_PREFIX: &str = "recent:";
const RECENT_COUNT: usize = 6;

const SCROLLING_LABEL: &str = "Scrolling capture (long page)";

/// Asks the main window to switch view; payload is the view name (see `MainWindow.tsx`).
const EVENT_NAVIGATE: &str = "navigate";

/// The tray icon and the menu items that change while Snipit runs.
pub struct Tray {
    icon: TrayIcon,
    running_icon: Image<'static>,
    paused_icon: Image<'static>,
    status: MenuItem<Wry>,
    capture_region: MenuItem<Wry>,
    capture_fullscreen: MenuItem<Wry>,
    capture_scrolling: MenuItem<Wry>,
    annotate_clipboard: MenuItem<Wry>,
    recent: Submenu<Wry>,
    /// Held while the recent submenu is rebuilt so two rebuilds don't interleave. Only taken
    /// on worker threads, since menu changes wait for the main thread.
    recent_rebuild: Mutex<()>,
    pause: CheckMenuItem<Wry>,
    autostart: CheckMenuItem<Wry>,
    check_updates: MenuItem<Wry>,
}

/// Creates the system tray icon. Left click opens the main window; right click shows the menu.
pub fn init(app: &AppHandle) -> tauri::Result<()> {
    let item = |id: &str, text: &str| MenuItem::with_id(app, id, text, true, None::<&str>);
    let check =
        |id: &str, text: &str| CheckMenuItem::with_id(app, id, text, true, false, None::<&str>);

    // Texts that depend on state are filled in by `refresh`.
    let status = MenuItem::new(app, "Snipit", false, None::<&str>)?;
    let capture_region = item(MENU_CAPTURE, "Capture region or window")?;
    let capture_fullscreen = item(MENU_CAPTURE_FULLSCREEN, "Capture full screen")?;
    let capture_scrolling = item(MENU_CAPTURE_SCROLLING, SCROLLING_LABEL)?;
    let annotate_clipboard = item(MENU_ANNOTATE_CLIPBOARD, "Annotate clipboard image")?;
    let recent = Submenu::new(app, "Recent captures", true)?;
    let open_folder = item(MENU_OPEN_FOLDER, "Open captures folder")?;
    let show_widget = CheckMenuItem::with_id(
        app,
        MENU_WIDGET,
        "Show capture widget",
        true,
        settings::get(app).show_widget,
        None::<&str>,
    )?;
    app.manage(widget::TrayToggle(show_widget.clone()));
    let pause = check(MENU_PAUSE, "Pause shortcuts")?;
    let autostart = check(MENU_AUTOSTART, "Launch at login")?;
    let open = item(MENU_OPEN, "Open Snipit")?;
    let open_settings = item(MENU_SETTINGS, "Settings…")?;
    let check_updates = item(MENU_CHECK_UPDATES, "Check for updates…")?;
    let quit = item(MENU_QUIT, "Quit Snipit")?;
    let menu = Menu::with_items(
        app,
        &[
            &status,
            &PredefinedMenuItem::separator(app)?,
            &capture_region,
            &capture_fullscreen,
            &capture_scrolling,
            &annotate_clipboard,
            &PredefinedMenuItem::separator(app)?,
            &recent,
            &open_folder,
            &PredefinedMenuItem::separator(app)?,
            &show_widget,
            &pause,
            &autostart,
            &PredefinedMenuItem::separator(app)?,
            &open,
            &open_settings,
            &check_updates,
            &PredefinedMenuItem::separator(app)?,
            &quit,
        ],
    )?;

    // A small source image keeps the icon crisp at the tray's 16–32 px.
    let running_icon = tauri::include_image!("icons/32x32.png");
    let paused_icon = dimmed(&running_icon);
    let icon = TrayIconBuilder::with_id("main")
        .icon(running_icon.clone())
        .tooltip("Snipit")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| on_menu(app, event.id().as_ref()))
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        })
        .build(app)?;

    app.manage(Tray {
        icon,
        running_icon,
        paused_icon,
        status,
        capture_region,
        capture_fullscreen,
        capture_scrolling,
        annotate_clipboard,
        recent,
        recent_rebuild: Mutex::default(),
        pause,
        autostart,
        check_updates,
    });
    refresh(app);
    refresh_recent(app);

    // New captures and clipboard snips; editor saves and deletes call `refresh_recent` directly.
    let handle = app.clone();
    app.listen_any(capture::CAPTURE_SAVED_EVENT, move |_| {
        refresh_recent(&handle)
    });
    Ok(())
}

fn on_menu(app: &AppHandle, id: &str) {
    match id {
        MENU_CAPTURE => capture::start(app, CaptureMode::Interactive, true),
        MENU_CAPTURE_FULLSCREEN => capture::start(app, CaptureMode::Fullscreen, true),
        MENU_CAPTURE_SCROLLING => capture::start(app, CaptureMode::Scrolling, true),
        MENU_ANNOTATE_CLIPBOARD => capture::annotate_clipboard(app),
        MENU_OPEN_FOLDER => {
            if let Err(err) = gallery::open_gallery_folder(app.clone()) {
                eprintln!("Couldn't open the captures folder: {err}");
            }
        }
        MENU_WIDGET => {
            let enabled = !settings::get(app).show_widget;
            if let Err(err) = widget::set_enabled(app, enabled) {
                eprintln!("Couldn't change the capture widget setting: {err}");
            }
        }
        MENU_PAUSE => shortcuts::set_paused(app, !shortcuts::is_paused(app)),
        MENU_AUTOSTART => {
            use tauri_plugin_autostart::ManagerExt;
            let enabled = !app.autolaunch().is_enabled().unwrap_or(false);
            if let Err(err) = shortcuts::change_autostart(app, enabled) {
                eprintln!("Couldn't change launch at login: {err}");
            }
        }
        MENU_OPEN => show_main_window(app),
        MENU_SETTINGS => navigate(app, "settings"),
        MENU_CHECK_UPDATES => {
            // The main window's banner shows the result, or the download's progress.
            show_main_window(app);
            let app = app.clone();
            tauri::async_runtime::spawn(async move {
                if updater::is_offered(&app) {
                    let _ = updater::install(&app).await;
                } else {
                    updater::check(&app, true).await;
                }
            });
        }
        MENU_QUIT => app.exit(0),
        _ => {
            if let Some(path) = id.strip_prefix(MENU_RECENT_PREFIX) {
                capture::open_editor(app, PathBuf::from(path));
            }
        }
    }
}

fn tray(app: &AppHandle) -> Option<tauri::State<'_, Tray>> {
    app.try_state::<Tray>()
}

/// Brings the tray up to date with the shortcuts, pause and launch-at-login state.
pub fn refresh(app: &AppHandle) {
    use tauri_plugin_autostart::ManagerExt;
    let Some(tray) = tray(app) else { return };
    let settings = settings::get(app);
    let errors = app
        .state::<shortcuts::ShortcutErrors>()
        .0
        .lock()
        .unwrap()
        .clone();
    let paused = shortcuts::is_paused(app);

    let key = |action| {
        settings
            .shortcuts
            .get(&action)
            .map(|a| display_accelerator(a))
    };
    let with_key = |text: &str, action| match key(action) {
        Some(key) if !paused && !errors.contains_key(&action) => format!("{text}\t{key}"),
        _ => text.to_owned(),
    };
    let _ = tray.capture_region.set_text(with_key(
        "Capture region or window",
        ShortcutAction::CaptureRegion,
    ));
    let _ = tray.capture_fullscreen.set_text(with_key(
        "Capture full screen",
        ShortcutAction::CaptureFullscreen,
    ));
    let _ = tray
        .capture_scrolling
        .set_text(with_key(SCROLLING_LABEL, ShortcutAction::CaptureScrolling));
    let _ = tray.annotate_clipboard.set_text(with_key(
        "Annotate clipboard image",
        ShortcutAction::AnnotateClipboard,
    ));

    let state = if paused {
        "shortcuts paused"
    } else {
        "running"
    };
    let version = &app.package_info().version;
    let _ = tray.status.set_text(format!("Snipit {version} — {state}"));
    let _ = tray.pause.set_checked(paused);
    let _ = tray
        .autostart
        .set_checked(app.autolaunch().is_enabled().unwrap_or(false));

    let update = updater::status(app);
    let (update_text, update_enabled) = match &update {
        updater::UpdateStatus::Available { version, .. } => (update_menu_text(version), true),
        updater::UpdateStatus::Installing { version, .. } => {
            (format!("Downloading Snipit {version}…"), false)
        }
        updater::UpdateStatus::Checking => ("Checking for updates…".to_owned(), false),
        _ => ("Check for updates…".to_owned(), true),
    };
    let _ = tray.check_updates.set_text(update_text);
    let _ = tray.check_updates.set_enabled(update_enabled);

    let mut tooltip = tooltip(
        paused,
        key(ShortcutAction::CaptureRegion).as_deref(),
        errors.contains_key(&ShortcutAction::CaptureRegion),
    );
    if let updater::UpdateStatus::Available { version, .. } = &update {
        tooltip.push_str(&format!("\nUpdate available: {version}"));
    }
    let _ = tray.icon.set_tooltip(Some(tooltip));
    let icon = if paused {
        &tray.paused_icon
    } else {
        &tray.running_icon
    };
    let _ = tray.icon.set_icon(Some(icon.clone()));
}

fn tooltip(paused: bool, region_key: Option<&str>, region_failed: bool) -> String {
    match (paused, region_key) {
        (true, _) => "Snipit — shortcuts paused".into(),
        (false, Some(key)) if region_failed => {
            format!("Snipit — running\n{key} is taken by another app")
        }
        (false, Some(key)) => format!("Snipit — running\n{key} to capture"),
        (false, None) => "Snipit — running".into(),
    }
}

/// The tray menu item that installs a waiting update.
pub fn update_menu_text(version: &str) -> String {
    format!("Update to Snipit {version}…")
}

/// Rebuilds the "Recent captures" submenu from the gallery folder, off the main thread.
pub fn refresh_recent(app: &AppHandle) {
    let app = app.clone();
    thread::spawn(move || {
        let Some(tray) = tray(&app) else { return };
        let snips = gallery::list(&app).unwrap_or_default();
        let recent: Vec<_> = snips.into_iter().take(RECENT_COUNT).collect();

        let _rebuilding = tray.recent_rebuild.lock().unwrap();
        let result = (|| -> tauri::Result<()> {
            while tray.recent.remove_at(0)?.is_some() {}
            if recent.is_empty() {
                tray.recent.append(&MenuItem::new(
                    &app,
                    "No captures yet",
                    false,
                    None::<&str>,
                )?)?;
            }
            for snip in &recent {
                let label = recent_label(&snip.name, snip.modified, Local::now());
                let id = format!("{MENU_RECENT_PREFIX}{}", snip.path.display());
                tray.recent
                    .append(&MenuItem::with_id(&app, id, label, true, None::<&str>)?)?;
            }
            Ok(())
        })();
        if let Err(err) = result {
            eprintln!("Couldn't update the recent captures menu: {err}");
        }
    });
}

/// `Today 15:04`, `Yesterday 09:30` or `3 Nov 18:12`, plus "(edited)" for edited copies.
fn recent_label(stem: &str, modified_ms: u64, now: DateTime<Local>) -> String {
    let when = Local
        .timestamp_millis_opt(modified_ms as i64)
        .single()
        .map(|time| {
            let days = (now.date_naive() - time.date_naive()).num_days();
            let day = match days {
                0 => "Today".to_owned(),
                1 => "Yesterday".to_owned(),
                _ => time.format("%-d %b").to_string(),
            };
            format!("{day} {}", time.format("%H:%M"))
        })
        .unwrap_or_else(|| stem.replace('&', "&&"));
    if gallery::is_edited(stem) {
        format!("{when} (edited)")
    } else {
        when
    }
}

/// `Ctrl+Shift+KeyS` → `Ctrl+Shift+S`, matching `acceleratorParts` in `shortcutFormat.ts`.
fn display_accelerator(accelerator: &str) -> String {
    accelerator
        .split('+')
        .map(|part| {
            if let Some(rest) = part.strip_prefix("Key").filter(|r| r.len() == 1) {
                rest.to_owned()
            } else if let Some(rest) = part.strip_prefix("Digit").filter(|r| r.len() == 1) {
                rest.to_owned()
            } else if let Some(rest) = part.strip_prefix("Numpad") {
                format!("Num {rest}")
            } else if let Some(rest) = part.strip_prefix("Arrow") {
                rest.to_owned()
            } else {
                match part {
                    "PrintScreen" => "PrtSc".to_owned(),
                    "Super" => "Win".to_owned(),
                    other => other.to_owned(),
                }
            }
        })
        .collect::<Vec<_>>()
        .join("+")
}

/// Greyed-out, half-transparent copy of the icon, shown while shortcuts are paused.
fn dimmed(icon: &Image<'_>) -> Image<'static> {
    let rgba = icon
        .rgba()
        .as_chunks::<4>()
        .0
        .iter()
        .flat_map(|px| {
            let [r, g, b, a] = px.map(u32::from);
            let grey = ((r * 299 + g * 587 + b * 114) / 1000) as u8;
            [grey, grey, grey, (a * 3 / 5) as u8]
        })
        .collect();
    Image::new_owned(rgba, icon.width(), icon.height())
}

/// The first time the main window is closed, says that Snipit keeps running in the tray.
pub fn hint_still_running(app: &AppHandle) {
    if settings::get(app).tray_hint_shown {
        return;
    }
    let _ = settings::update(app, |s| s.tray_hint_shown = true);
    let settings = settings::get(app);
    let key = settings
        .shortcuts
        .get(&ShortcutAction::CaptureRegion)
        .map(|a| display_accelerator(a));
    let body = match key {
        Some(key) => format!(
            "Snipit is still running in the system tray. Press {key} to capture, or right-click \
             the tray icon for more."
        ),
        None => "Snipit is still running in the system tray. Right-click the tray icon to \
                 capture or quit."
            .into(),
    };
    if let Err(err) = app
        .notification()
        .builder()
        .title("Snipit is still running")
        .body(body)
        .show()
    {
        eprintln!("Couldn't show the tray notification: {err}");
    }
}

fn navigate(app: &AppHandle, view: &str) {
    show_main_window(app);
    let _ = app.emit_to("main", EVENT_NAVIGATE, view);
}

pub fn show_main_window<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn formats_accelerators_for_the_menu() {
        assert_eq!(display_accelerator("PrintScreen"), "PrtSc");
        assert_eq!(display_accelerator("Shift+PrintScreen"), "Shift+PrtSc");
        assert_eq!(display_accelerator("Ctrl+Shift+KeyS"), "Ctrl+Shift+S");
        assert_eq!(display_accelerator("Alt+Digit1"), "Alt+1");
        assert_eq!(display_accelerator("Super+ArrowUp"), "Win+Up");
        assert_eq!(display_accelerator("Numpad5"), "Num 5");
        assert_eq!(display_accelerator("F9"), "F9");
        assert_eq!(display_accelerator("Ctrl+Keyboard"), "Ctrl+Keyboard");
    }

    #[test]
    fn labels_recent_captures_by_day() {
        let now = Local.with_ymd_and_hms(2026, 11, 10, 18, 0, 0).unwrap();
        let ms = |d, h, m| {
            Local
                .with_ymd_and_hms(2026, 11, d, h, m, 0)
                .unwrap()
                .timestamp_millis() as u64
        };
        assert_eq!(recent_label("Snipit_a", ms(10, 15, 4), now), "Today 15:04");
        assert_eq!(
            recent_label("Snipit_a", ms(9, 9, 30), now),
            "Yesterday 09:30"
        );
        assert_eq!(
            recent_label("Snipit_a_edited", ms(3, 18, 12), now),
            "3 Nov 18:12 (edited)"
        );
    }

    #[test]
    fn tooltip_reports_status() {
        assert_eq!(
            tooltip(false, Some("PrtSc"), false),
            "Snipit — running\nPrtSc to capture"
        );
        assert_eq!(
            tooltip(false, Some("PrtSc"), true),
            "Snipit — running\nPrtSc is taken by another app"
        );
        assert_eq!(
            tooltip(true, Some("PrtSc"), false),
            "Snipit — shortcuts paused"
        );
        assert_eq!(tooltip(false, None, false), "Snipit — running");
    }
}
