mod capture;
mod clipboard;
mod gallery;
mod settings;
mod shortcuts;
mod tray;

use std::sync::Mutex;

use tauri::{AppHandle, Manager, WindowEvent};

use capture::CaptureMode;

/// Passed by the launch-at-login entry so Snipit starts in the tray.
const AUTOSTART_ARG: &str = "--minimized";

/// Handles command-line flags, so `snipit --capture` can be bound to other tools or shortcuts.
/// Returns false if there was nothing to do.
fn handle_args(app: &AppHandle, args: &[String]) -> bool {
    let mode = args.iter().find_map(|a| match a.as_str() {
        "--capture" => Some(CaptureMode::Interactive),
        "--capture-fullscreen" => Some(CaptureMode::Fullscreen),
        _ => None,
    });
    if let Some(mode) = mode {
        capture::start(app, mode, false);
    }
    mode.is_some()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Must be registered first: a second launch is forwarded to the running instance.
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            if !handle_args(app, &args) {
                tray::show_main_window(app);
            }
        }))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(shortcuts::handle)
                .build(),
        )
        .plugin(
            tauri_plugin_autostart::Builder::new()
                .arg(AUTOSTART_ARG)
                .build(),
        )
        .manage(capture::CaptureState::default())
        .manage(shortcuts::ShortcutErrors::default())
        .setup(|app| {
            let handle = app.handle();
            app.manage(settings::SettingsState(Mutex::new(settings::load(handle))));
            tray::init(handle)?;
            shortcuts::register_all(handle);
            shortcuts::init_autostart(handle);
            let args: Vec<String> = std::env::args().collect();
            let started_capture = handle_args(handle, &args);
            if !started_capture && !args.iter().any(|arg| arg == AUTOSTART_ARG) {
                tray::show_main_window(handle);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            capture::start_capture,
            capture::annotate_clipboard_cmd,
            capture::overlay_info,
            capture::overlay_frame,
            capture::finish_capture,
            capture::cancel_capture,
            clipboard::copy_png,
            clipboard::paste_image,
            gallery::list_snips,
            gallery::read_snip,
            gallery::save_snip,
            gallery::delete_snip,
            gallery::reveal_snip,
            gallery::open_gallery_folder,
            settings::set_after_capture,
            shortcuts::get_settings,
            shortcuts::set_shortcut,
            shortcuts::pause_shortcuts,
            shortcuts::set_autostart,
            shortcuts::open_keyboard_settings,
        ])
        .on_window_event(|window, event| {
            // Closing the main window hides it to the tray; "Quit" in the tray menu exits.
            if let WindowEvent::CloseRequested { api, .. } = event
                && window.label() == "main"
            {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running Snipit");
}
