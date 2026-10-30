mod capture;
mod hotkey;
mod library;
mod tray;

use tauri::{AppHandle, WindowEvent};

use capture::CaptureMode;

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
        .manage(capture::CaptureState::default())
        .setup(|app| {
            tray::init(app.handle())?;
            hotkey::init(app.handle())?;
            handle_args(app.handle(), &std::env::args().collect::<Vec<_>>());
            Ok(())
        })
        .on_window_event(|window, event| {
            // Closing the main window hides it to the tray; "Quit" in the tray menu exits.
            if let WindowEvent::CloseRequested { api, .. } = event
                && window.label() == "main"
            {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            capture::start_capture,
            capture::overlay_info,
            capture::overlay_frame,
            capture::finish_capture,
            capture::cancel_capture,
            library::list_recent_captures,
            library::copy_capture,
            library::reveal_capture,
            hotkey::hotkey_status,
            hotkey::open_keyboard_settings,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Snipit");
}
