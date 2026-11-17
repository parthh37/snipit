//! Capture presets: named recipes of capture mode, delay, pointer, effects and output, each
//! with an optional global shortcut. They run from the Capture page, the tray menu or their
//! shortcut (see `capture::start_preset`).

use std::time::{SystemTime, UNIX_EPOCH};

use tauri::AppHandle;

use crate::settings::{self, CapturePreset};
use crate::shortcuts::{self, SettingsView};
use crate::tray;

const MAX_NAME: usize = 40;

/// Adds the preset, or replaces the one with the same id. A preset without an id gets one.
#[tauri::command]
pub fn save_preset(app: AppHandle, mut preset: CapturePreset) -> Result<SettingsView, String> {
    preset.name = preset.name.trim().chars().take(MAX_NAME).collect();
    if preset.name.is_empty() {
        return Err("Give the preset a name.".into());
    }
    settings::check_delay(preset.delay)?;
    if preset.id.is_empty() {
        preset.id = new_id();
    }
    preset.shortcut = preset.shortcut.filter(|s| !s.is_empty());
    if preset.effects.is_null() {
        preset.effects = serde_json::json!({});
    }
    let current = settings::get(&app);
    if let Some(accel) = &preset.shortcut
        && let Some(other) = shortcuts::clash(&current, accel, None, Some(&preset.id))?
    {
        return Err(format!("That shortcut is already used by {other}."));
    }
    if current
        .presets
        .iter()
        .any(|p| p.id != preset.id && p.name.eq_ignore_ascii_case(&preset.name))
    {
        return Err(format!(
            "There is already a preset called \"{}\".",
            preset.name
        ));
    }
    settings::update(&app, |s| {
        match s.presets.iter_mut().find(|p| p.id == preset.id) {
            Some(existing) => *existing = preset,
            None => s.presets.push(preset),
        }
    })?;
    changed(&app);
    Ok(shortcuts::view(&app))
}

#[tauri::command]
pub fn delete_preset(app: AppHandle, id: String) -> Result<SettingsView, String> {
    settings::update(&app, |s| s.presets.retain(|p| p.id != id))?;
    changed(&app);
    Ok(shortcuts::view(&app))
}

fn changed(app: &AppHandle) {
    shortcuts::register_all(app);
    tray::refresh_presets(app);
}

fn new_id() -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_nanos());
    format!("p{nanos:x}")
}
