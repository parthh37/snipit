use std::{collections::BTreeMap, str::FromStr, sync::Mutex};

use serde::Serialize;
use tauri::{AppHandle, Manager, Runtime};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutEvent, ShortcutState};

use crate::{
    capture::{self, CaptureMode},
    settings::{self, Settings, ShortcutAction},
};

/// Registration problems per action (e.g. the key is already taken by another app).
#[derive(Default)]
pub struct ShortcutErrors(pub Mutex<BTreeMap<ShortcutAction, String>>);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsView {
    settings: Settings,
    shortcut_errors: BTreeMap<ShortcutAction, String>,
    autostart: bool,
}

pub fn handle<R: Runtime>(app: &AppHandle<R>, shortcut: &Shortcut, event: ShortcutEvent) {
    if event.state != ShortcutState::Pressed {
        return;
    }
    let settings = settings::get(app);
    let action = settings.shortcuts.iter().find_map(|(action, accel)| {
        let parsed = Shortcut::from_str(accel).ok()?;
        (parsed.id() == shortcut.id()).then_some(*action)
    });
    match action {
        Some(ShortcutAction::CaptureRegion) => capture::start(app, CaptureMode::Region),
        Some(ShortcutAction::CaptureFullscreen) => capture::start(app, CaptureMode::Fullscreen),
        Some(ShortcutAction::AnnotateClipboard) => capture::annotate_clipboard(app),
        None => {}
    }
}

/// Registers every configured shortcut, recording the ones that failed.
pub fn register_all<R: Runtime>(app: &AppHandle<R>) {
    let gs = app.global_shortcut();
    let _ = gs.unregister_all();
    let mut errors = BTreeMap::new();
    for (action, accel) in settings::get(app).shortcuts {
        if let Err(e) = Shortcut::from_str(&accel)
            .map_err(|e| e.to_string())
            .and_then(|s| gs.register(s).map_err(|e| e.to_string()))
        {
            eprintln!("Could not register {accel} for {action:?}: {e}");
            errors.insert(action, describe_error(&accel, &e));
        }
    }
    *app.state::<ShortcutErrors>().0.lock().unwrap() = errors;
}

fn describe_error(accel: &str, error: &str) -> String {
    if !error.contains("already registered") {
        format!("Couldn't use this shortcut: {error}")
    } else if accel.contains("PrintScreen") {
        "Another app is using Print Screen (e.g. Snagit, ShareX, Greenshot or OneDrive \
         screenshots, or Windows' \"Use the Print screen key to open screen capture\"). \
         Close or reconfigure it, or pick a different shortcut."
            .into()
    } else {
        "Another app is already using this shortcut. Pick a different one.".into()
    }
}

fn view(app: &AppHandle) -> SettingsView {
    use tauri_plugin_autostart::ManagerExt;
    SettingsView {
        settings: settings::get(app),
        shortcut_errors: app.state::<ShortcutErrors>().0.lock().unwrap().clone(),
        autostart: app.autolaunch().is_enabled().unwrap_or(false),
    }
}

#[tauri::command]
pub fn get_settings(app: AppHandle) -> SettingsView {
    view(&app)
}

/// Binds `action` to `accelerator` (or unbinds it when `None`).
#[tauri::command]
pub fn set_shortcut(
    app: AppHandle,
    action: ShortcutAction,
    accelerator: Option<String>,
) -> Result<SettingsView, String> {
    if let Some(accel) = &accelerator {
        let parsed = Shortcut::from_str(accel).map_err(|e| format!("Invalid shortcut: {e}"))?;
        let current = settings::get(&app);
        let clash = current.shortcuts.iter().find(|(other, other_accel)| {
            **other != action
                && Shortcut::from_str(other_accel).is_ok_and(|s| s.id() == parsed.id())
        });
        if let Some((other, _)) = clash {
            return Err(format!("Already used by \"{}\"", label(*other)));
        }
    }

    settings::update(&app, |s| match accelerator {
        Some(accel) => {
            s.shortcuts.insert(action, accel);
        }
        None => {
            s.shortcuts.remove(&action);
        }
    })?;
    register_all(&app);
    Ok(view(&app))
}

/// Temporarily releases all global shortcuts so the settings recorder can capture them.
#[tauri::command]
pub fn pause_shortcuts(app: AppHandle, paused: bool) {
    if paused {
        let _ = app.global_shortcut().unregister_all();
    } else {
        register_all(&app);
    }
}

#[tauri::command]
pub fn set_autostart(app: AppHandle, enabled: bool) -> Result<SettingsView, String> {
    use tauri_plugin_autostart::ManagerExt;
    let launcher = app.autolaunch();
    if enabled {
        launcher.enable().map_err(|e| e.to_string())?;
    } else {
        launcher.disable().map_err(|e| e.to_string())?;
    }
    settings::update(&app, |s| s.autostart_initialized = true)?;
    Ok(view(&app))
}

/// Turns launch-at-login on the first time a release build runs.
pub fn init_autostart<R: Runtime>(app: &AppHandle<R>) {
    use tauri_plugin_autostart::ManagerExt;
    if cfg!(debug_assertions) || settings::get(app).autostart_initialized {
        return;
    }
    if app.autolaunch().enable().is_ok() {
        let _ = settings::update(app, |s| s.autostart_initialized = true);
    }
}

fn label(action: ShortcutAction) -> &'static str {
    match action {
        ShortcutAction::CaptureRegion => "Capture region",
        ShortcutAction::CaptureFullscreen => "Capture full screen",
        ShortcutAction::AnnotateClipboard => "Annotate clipboard image",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_recorder_accelerators() {
        for accel in [
            "PrintScreen",
            "Shift+PrintScreen",
            "Ctrl+Shift+KeyS",
            "Alt+Digit1",
            "F9",
        ] {
            assert!(Shortcut::from_str(accel).is_ok(), "{accel}");
        }
        assert_eq!(
            Shortcut::from_str("Ctrl+Shift+KeyS").unwrap().id(),
            Shortcut::from_str("shift+control+S").unwrap().id()
        );
    }
}
