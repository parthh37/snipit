use std::{collections::BTreeMap, fs, path::PathBuf, sync::Mutex};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, Runtime};

use crate::capture::{CaptureMode, geometry::Rect};
use crate::widget::Anchor;

/// Things a global shortcut can trigger.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ShortcutAction {
    CaptureRegion,
    CaptureFullscreen,
    CaptureScrolling,
    AnnotateClipboard,
    RepeatLastCapture,
}

/// What happens to a finished capture when no explicit choice was made
/// (full-screen capture, or Enter in the region overlay).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AfterCapture {
    #[default]
    Edit,
    Copy,
    /// Only save it to the gallery.
    Save,
}

/// Light or dark windows; `System` follows Windows.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Theme {
    #[default]
    System,
    Light,
    Dark,
}

/// Delays a capture may wait before freezing the screen, in seconds.
pub const CAPTURE_DELAYS: [u32; 4] = [0, 3, 5, 10];

pub const DEFAULT_FILENAME_TEMPLATE: &str = "Snipit_{date}_{time}";

/// The area of the most recent capture, so it can be captured again.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LastCapture {
    /// `Interactive` (a region or window), `Fullscreen` or `Scrolling`.
    pub mode: CaptureMode,
    /// Global screen coordinates in physical pixels.
    pub rect: Rect,
}

/// A named capture recipe: what to capture, how, which effects to add and where it goes.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CapturePreset {
    pub id: String,
    pub name: String,
    pub mode: CaptureMode,
    /// Seconds to wait before capturing (one of [`CAPTURE_DELAYS`]).
    #[serde(default)]
    pub delay: u32,
    /// Include the mouse pointer.
    #[serde(default)]
    pub cursor: bool,
    /// Image effects (border, shadow, torn edges), drawn by the editor's renderer. The shape
    /// is `Effects` in `src/editor/effects.ts`; Rust only passes it along.
    #[serde(default)]
    pub effects: serde_json::Value,
    #[serde(default)]
    pub after: AfterCapture,
    /// Global shortcut, in the same format as `Settings::shortcuts`.
    #[serde(default)]
    pub shortcut: Option<String>,
}

impl CapturePreset {
    /// Whether there are effects to apply: anything but `null` or an empty object.
    pub fn has_effects(&self) -> bool {
        match &self.effects {
            serde_json::Value::Null => false,
            serde_json::Value::Object(map) => !map.is_empty(),
            _ => true,
        }
    }
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
    /// Set once Snipit has said it keeps running in the tray after the window is closed.
    pub tray_hint_shown: bool,
    /// Show the floating capture widget docked to an edge of the screen.
    pub show_widget: bool,
    /// Where the widget was last left; `None` means top-centre of the primary monitor.
    pub widget_position: Option<Anchor>,
    /// Look for new releases on launch and every few hours (release builds only).
    pub auto_check_updates: bool,
    /// Where snips are saved; `None` means `Pictures\Snipit`.
    pub output_folder: Option<PathBuf>,
    /// Name for new snips, without the extension (see `gallery::format_name`).
    pub filename_template: String,
    pub theme: Theme,
    /// Seconds every capture waits before freezing the screen (one of [`CAPTURE_DELAYS`]).
    pub capture_delay: u32,
    /// Draw the mouse pointer into captures.
    pub capture_cursor: bool,
    pub last_capture: Option<LastCapture>,
    pub presets: Vec<CapturePreset>,
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
                (ShortcutAction::CaptureScrolling, "Ctrl+PrintScreen".into()),
            ]),
            after_capture: AfterCapture::default(),
            autostart_initialized: false,
            tray_hint_shown: false,
            show_widget: true,
            widget_position: None,
            auto_check_updates: true,
            output_folder: None,
            filename_template: DEFAULT_FILENAME_TEMPLATE.into(),
            theme: Theme::default(),
            capture_delay: 0,
            capture_cursor: false,
            last_capture: None,
            presets: Vec::new(),
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

/// Switches every window (and the tray menu) between light and dark. The web views follow
/// along, so `prefers-color-scheme` in the pages matches.
pub fn apply_theme<R: Runtime>(app: &AppHandle<R>, theme: Theme) {
    app.set_theme(match theme {
        Theme::System => None,
        Theme::Light => Some(tauri::Theme::Light),
        Theme::Dark => Some(tauri::Theme::Dark),
    });
}

#[tauri::command]
pub fn set_theme(app: AppHandle, theme: Theme) -> Result<Settings, String> {
    let next = update(&app, |s| s.theme = theme)?;
    apply_theme(&app, theme);
    Ok(next)
}

#[tauri::command]
pub fn set_capture_options(app: AppHandle, delay: u32, cursor: bool) -> Result<Settings, String> {
    check_delay(delay)?;
    update(&app, |s| {
        s.capture_delay = delay;
        s.capture_cursor = cursor;
    })
}

pub fn check_delay(delay: u32) -> Result<(), String> {
    if CAPTURE_DELAYS.contains(&delay) {
        Ok(())
    } else {
        Err(format!("Unsupported delay: {delay} s"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn settings_round_trip_with_missing_fields() {
        let settings: Settings = serde_json::from_str(r#"{"afterCapture":"copy"}"#).unwrap();
        assert_eq!(settings.after_capture, AfterCapture::Copy);
        assert!(settings.show_widget);
        assert_eq!(settings.widget_position, None);
        assert!(settings.auto_check_updates);
        assert_eq!(settings.filename_template, DEFAULT_FILENAME_TEMPLATE);
        assert_eq!(settings.theme, Theme::System);
        assert_eq!(settings.capture_delay, 0);
        assert!(settings.presets.is_empty());
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

    #[test]
    fn presets_round_trip_and_know_their_effects() {
        let json = r#"{"presets":[
            {"id":"a","name":"Bordered","mode":"interactive","effects":{"shadow":true},"after":"copy"},
            {"id":"b","name":"Plain","mode":"fullscreen","effects":{}}
        ]}"#;
        let settings: Settings = serde_json::from_str(json).unwrap();
        let [a, b] = &settings.presets[..] else {
            panic!("expected two presets")
        };
        assert_eq!(a.after, AfterCapture::Copy);
        assert!(a.has_effects());
        assert_eq!(b.mode, CaptureMode::Fullscreen);
        assert_eq!(b.after, AfterCapture::Edit);
        assert_eq!(b.delay, 0);
        assert!(!b.has_effects());
        let again: Settings =
            serde_json::from_str(&serde_json::to_string(&settings).unwrap()).unwrap();
        assert_eq!(again.presets, settings.presets);
    }

    #[test]
    fn only_known_delays() {
        assert!(check_delay(0).is_ok());
        assert!(check_delay(10).is_ok());
        assert!(check_delay(7).is_err());
    }
}
