mod capture;
mod clipboard;
mod gallery;
mod settings;
mod shortcuts;
mod tray;
mod widget;

use std::sync::Mutex;
use std::time::Duration;

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
        "--capture-scrolling" => Some(CaptureMode::Scrolling),
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
        .plugin(tauri_plugin_notification::init())
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
        .manage(capture::overlays::OverlayPool::default())
        .manage(capture::scroll::ScrollState::default())
        .manage(shortcuts::ShortcutErrors::default())
        .manage(shortcuts::ShortcutsPaused::default())
        .manage(widget::WidgetState::default())
        .setup(|app| {
            let handle = app.handle();
            app.manage(settings::SettingsState(Mutex::new(settings::load(handle))));
            shortcuts::register_all(handle);
            shortcuts::init_autostart(handle);
            // After the two above, so the menu starts out with their state.
            tray::init(handle)?;
            widget::init(handle);
            // Ready the capture overlays now, so the first capture opens as fast as the rest.
            capture::overlays::refill(handle, Duration::ZERO);
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
            widget::set_widget_visible,
            widget::widget_edge,
            widget::widget_set_expanded,
            widget::widget_drag_start,
            widget::widget_drag_move,
            widget::widget_drag_end,
            widget::open_main_window,
        ])
        .on_window_event(|window, event| {
            // Closing the main window hides it to the tray; "Quit" in the tray menu exits.
            if let WindowEvent::CloseRequested { api, .. } = event
                && window.label() == "main"
            {
                api.prevent_close();
                let _ = window.hide();
                tray::hint_still_running(window.app_handle());
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running Snipit");
}

#[cfg(test)]
mod tests {
    /// Without `http://ipc.localhost` in `connect-src`, the webview blocks Tauri's IPC
    /// protocol and Tauri falls back to `postMessage`, which returns binary command results
    /// (`read_snip`, `paste_image`) as plain number arrays. The editor then can't decode the
    /// PNG and shows "Could not load the image" after every capture. Only release builds
    /// apply the CSP, so this never shows up under `tauri dev`.
    #[test]
    fn csp_allows_the_ipc_protocol() {
        let conf: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let csp = conf["app"]["security"]["csp"].as_str().unwrap();
        let connect_src = csp
            .split(';')
            .map(str::trim)
            .find_map(|directive| directive.strip_prefix("connect-src "))
            .expect("the CSP must set connect-src (default-src 'self' blocks IPC)");
        let sources: Vec<&str> = connect_src.split_whitespace().collect();
        assert!(sources.contains(&"ipc:"), "connect-src lacks ipc:");
        assert!(
            sources.contains(&"http://ipc.localhost"),
            "connect-src lacks http://ipc.localhost"
        );
    }
}
