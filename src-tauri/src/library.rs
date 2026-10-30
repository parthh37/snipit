//! Where captures are stored, plus clipboard helpers.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use chrono::{DateTime, Local};
use serde::Serialize;
use tauri::{AppHandle, Manager, Runtime};
use xcap::image::{self, RgbaImage};

const FOLDER_NAME: &str = "Snipit";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureEntry {
    pub path: String,
    pub name: String,
    pub width: u32,
    pub height: u32,
    pub created_ms: u64,
}

/// `Pictures/Snipit`, created on first use.
pub fn capture_dir<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .picture_dir()
        .map_err(|e| e.to_string())?
        .join(FOLDER_NAME);
    fs::create_dir_all(&dir).map_err(|e| format!("Couldn't create {}: {e}", dir.display()))?;
    Ok(dir)
}

fn file_stem(now: DateTime<Local>) -> String {
    now.format("Snipit_%Y-%m-%d_%H-%M-%S").to_string()
}

/// `dir/stem.png`, or `dir/stem_2.png`, `_3`... if that name is taken.
fn unique_path(dir: &Path, stem: &str) -> PathBuf {
    let mut path = dir.join(format!("{stem}.png"));
    let mut n = 2;
    while path.exists() {
        path = dir.join(format!("{stem}_{n}.png"));
        n += 1;
    }
    path
}

pub fn save_png<R: Runtime>(app: &AppHandle<R>, image: &RgbaImage) -> Result<CaptureEntry, String> {
    let path = unique_path(&capture_dir(app)?, &file_stem(Local::now()));
    image
        .save(&path)
        .map_err(|e| format!("Couldn't save {}: {e}", path.display()))?;
    entry_for(&path).ok_or_else(|| format!("Couldn't read back {}", path.display()))
}

fn entry_for(path: &Path) -> Option<CaptureEntry> {
    let (width, height) = image::image_dimensions(path).ok()?;
    let created_ms = fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()?
        .duration_since(UNIX_EPOCH)
        .ok()?
        .as_millis() as u64;
    Some(CaptureEntry {
        path: path.to_string_lossy().into_owned(),
        name: path.file_name()?.to_string_lossy().into_owned(),
        width,
        height,
        created_ms,
    })
}

pub fn copy_to_clipboard(image: &RgbaImage) -> Result<(), String> {
    let mut clipboard = arboard::Clipboard::new().map_err(|e| e.to_string())?;
    clipboard
        .set_image(arboard::ImageData {
            width: image.width() as usize,
            height: image.height() as usize,
            bytes: image.as_raw().into(),
        })
        .map_err(|e| e.to_string())
}

/// Resolves a path coming from the UI, refusing anything outside the capture folder.
fn resolve_capture<R: Runtime>(app: &AppHandle<R>, path: &str) -> Result<PathBuf, String> {
    let dir = capture_dir(app)?
        .canonicalize()
        .map_err(|e| e.to_string())?;
    let path = Path::new(path).canonicalize().map_err(|e| e.to_string())?;
    if path.starts_with(&dir) {
        Ok(path)
    } else {
        Err("Not a Snipit capture".into())
    }
}

#[tauri::command]
pub fn list_recent_captures(app: AppHandle, limit: usize) -> Result<Vec<CaptureEntry>, String> {
    let mut entries: Vec<CaptureEntry> = fs::read_dir(capture_dir(&app)?)
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| {
            p.extension()
                .is_some_and(|ext| ext.eq_ignore_ascii_case("png"))
        })
        .filter_map(|p| entry_for(&p))
        .collect();
    entries.sort_by_key(|e| std::cmp::Reverse(e.created_ms));
    entries.truncate(limit);
    Ok(entries)
}

#[tauri::command]
pub async fn copy_capture(app: AppHandle, path: String) -> Result<(), String> {
    let path = resolve_capture(&app, &path)?;
    let image = image::open(&path).map_err(|e| e.to_string())?.to_rgba8();
    copy_to_clipboard(&image)
}

#[tauri::command]
pub fn reveal_capture(app: AppHandle, path: String) -> Result<(), String> {
    let path = resolve_capture(&app, &path)?;
    tauri_plugin_opener::reveal_item_in_dir(path).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    #[test]
    fn file_stem_is_sortable_timestamp() {
        let t = Local.with_ymd_and_hms(2026, 3, 7, 9, 5, 2).unwrap();
        assert_eq!(file_stem(t), "Snipit_2026-03-07_09-05-02");
    }

    #[test]
    fn unique_path_appends_counter() {
        let dir = std::env::temp_dir().join(format!("snipit-test-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let first = unique_path(&dir, "shot");
        assert_eq!(first.file_name().unwrap(), "shot.png");
        fs::write(&first, b"").unwrap();
        let second = unique_path(&dir, "shot");
        assert_eq!(second.file_name().unwrap(), "shot_2.png");
        fs::remove_dir_all(&dir).unwrap();
    }
}
