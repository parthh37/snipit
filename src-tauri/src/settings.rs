use std::{collections::BTreeMap, fs, path::PathBuf, sync::Mutex};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, Runtime};

/// Things a global shortcut can trigger.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ShortcutAction {
    CaptureRegion,
    CaptureFullscreen,
    AnnotateClipboard,
}

/// What happens to a finished capture when no explicit choice was made
/// (full-screen capture, or Enter in the region overlay).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AfterCapture {
    #[default]
    Edit,
    Copy,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Settings {
    /// Accelerator per action, e.g. `"Ctrl+Shift+KeyS"`. A missing entry means unbound.
    pub shortcuts: BTreeMap<ShortcutAction, String>,
    pub after_capture: AfterCapture,
    /// Set once launch-at-login has been switched on for the first time, so turning it
    /// off later sticks.
    pub autostart_initialized: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            shortcuts: BTreeMap::from([
                (ShortcutAction::CaptureRegion, "PrintScreen".into()),
                (
                    ShortcutAction::CaptureFullscreen,
                    "Shift+PrintScreen".into(),
                ),
            ]),
            after_capture: AfterCapture::default(),
            autostart_initialized: false,
        }
    }
}

/// App-wide settings, persisted as JSON in the app config directory.
pub struct SettingsState(pub Mutex<Settings>);

fn settings_path<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<PathBuf> {
    Ok(app.path().app_config_dir()?.join("settings.json"))
}

pub fn load<R: Runtime>(app: &AppHandle<R>) -> Settings {
    settings_path(app)
        .ok()
        .and_then(|path| fs::read_to_string(path).ok())
        .and_then(|json| serde_json::from_str(&json).ok())
        .unwrap_or_default()
}

pub fn save<R: Runtime>(app: &AppHandle<R>, settings: &Settings) -> Result<(), String> {
    let path = settings_path(app).map_err(|e| e.to_string())?;
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    fs::write(path, json).map_err(|e| e.to_string())
}

pub fn get<R: Runtime>(app: &AppHandle<R>) -> Settings {
    app.state::<SettingsState>().0.lock().unwrap().clone()
}

/// Applies `change` to the settings and writes them to disk.
pub fn update<R: Runtime>(
    app: &AppHandle<R>,
    change: impl FnOnce(&mut Settings),
) -> Result<Settings, String> {
    let state = app.state::<SettingsState>();
    let mut settings = state.0.lock().unwrap();
    change(&mut settings);
    save(app, &settings)?;
    Ok(settings.clone())
}

#[tauri::command]
pub fn set_after_capture(app: AppHandle, mode: AfterCapture) -> Result<Settings, String> {
    update(&app, |s| s.after_capture = mode)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn settings_round_trip_with_missing_fields() {
        let settings: Settings = serde_json::from_str(r#"{"afterCapture":"copy"}"#).unwrap();
        assert_eq!(settings.after_capture, AfterCapture::Copy);
        assert_eq!(
            settings
                .shortcuts
                .get(&ShortcutAction::CaptureRegion)
                .map(String::as_str),
            Some("PrintScreen")
        );

        let json = serde_json::to_string(&settings).unwrap();
        assert!(json.contains(r#""captureRegion":"PrintScreen""#));
    }
}
