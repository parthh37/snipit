//! Global capture hotkeys.

use std::thread;

use serde::Serialize;
use tauri::{AppHandle, Manager};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

use crate::capture::{self, CaptureMode};

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HotkeyStatus {
    /// Whether PrintScreen was registered with the OS.
    registered: bool,
    /// Windows' "Use the Print screen key to open screen capture" setting is on, which
    /// swallows PrintScreen before Snipit sees it.
    reserved_by_windows: bool,
}

pub fn init(app: &AppHandle) -> tauri::Result<()> {
    app.plugin(
        tauri_plugin_global_shortcut::Builder::new()
            .with_handler(|app, shortcut, event| {
                if event.state() != ShortcutState::Pressed {
                    return;
                }
                match shortcut.key {
                    Code::PrintScreen => {
                        let mode = if shortcut.mods.contains(Modifiers::SHIFT) {
                            CaptureMode::Fullscreen
                        } else {
                            CaptureMode::Interactive
                        };
                        capture::start(app, mode, false);
                    }
                    Code::Escape => capture::cancel(app),
                    _ => {}
                }
            })
            .build(),
    )?;

    let shortcuts = [
        Shortcut::new(None, Code::PrintScreen),
        Shortcut::new(Some(Modifiers::SHIFT), Code::PrintScreen),
    ];
    let registered = match app.global_shortcut().register_multiple(shortcuts) {
        Ok(()) => true,
        Err(err) => {
            eprintln!("Couldn't register PrintScreen hotkeys: {err}");
            false
        }
    };
    app.manage(HotkeyStatus {
        registered,
        reserved_by_windows: printscreen_reserved_by_windows(),
    });
    Ok(())
}

fn escape() -> Shortcut {
    Shortcut::new(None, Code::Escape)
}

/// Makes Esc cancel the capture whichever window has focus; held only while overlays are open.
/// The plugin blocks until the main thread has registered it, so call this from a worker thread
/// and before the overlays open, so it is always in place before anything can release it.
pub fn grab_escape(app: &AppHandle) {
    if let Err(err) = app.global_shortcut().register(escape()) {
        eprintln!("Couldn't register Esc for the capture overlay: {err}");
    }
}

/// Safe to call from any thread, including the shortcut handler itself.
pub fn release_escape(app: &AppHandle) {
    let app = app.clone();
    thread::spawn(move || {
        if app.global_shortcut().is_registered(escape()) {
            let _ = app.global_shortcut().unregister(escape());
        }
    });
}

#[cfg(windows)]
fn printscreen_reserved_by_windows() -> bool {
    use windows::Win32::System::Registry::{HKEY_CURRENT_USER, RRF_RT_REG_DWORD, RegGetValueW};
    use windows::core::w;

    let mut value = 0u32;
    let mut size = size_of::<u32>() as u32;
    let result = unsafe {
        RegGetValueW(
            HKEY_CURRENT_USER,
            w!("Control Panel\\Keyboard"),
            w!("PrintScreenKeyForSnippingEnabled"),
            RRF_RT_REG_DWORD,
            None,
            Some(&mut value as *mut u32 as *mut _),
            Some(&mut size),
        )
    };
    result.is_ok() && value != 0
}

#[cfg(not(windows))]
fn printscreen_reserved_by_windows() -> bool {
    false
}

#[tauri::command]
pub fn hotkey_status(app: AppHandle) -> HotkeyStatus {
    *app.state::<HotkeyStatus>()
}

#[tauri::command]
pub fn open_keyboard_settings() -> Result<(), String> {
    tauri_plugin_opener::open_url("ms-settings:easeofaccess-keyboard", None::<&str>)
        .map_err(|e| e.to_string())
}
