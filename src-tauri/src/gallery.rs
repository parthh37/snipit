use std::{
    fs,
    io::Cursor,
    path::{Path, PathBuf},
    time::UNIX_EPOCH,
};

use serde::Serialize;
use tauri::{AppHandle, Manager, Runtime, ipc::Response};
use xcap::image::{ImageFormat, RgbaImage};

/// Every snip is saved here as a PNG; the Gallery view lists this folder.
pub fn dir<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .picture_dir()
        .map_err(|e| e.to_string())?
        .join("Snipit");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

pub fn encode_png(image: &RgbaImage) -> Result<Vec<u8>, String> {
    let mut png = Vec::new();
    image
        .write_to(&mut Cursor::new(&mut png), ImageFormat::Png)
        .map_err(|e| e.to_string())?;
    Ok(png)
}

/// Saves a new snip and returns its path.
pub fn save_new<R: Runtime>(app: &AppHandle<R>, png: &[u8]) -> Result<PathBuf, String> {
    let dir = dir(app)?;
    let stamp = chrono::Local::now().format("Snip %Y-%m-%d %H-%M-%S");
    let mut path = dir.join(format!("{stamp}.png"));
    let mut n = 2;
    while path.exists() {
        path = dir.join(format!("{stamp} ({n}).png"));
        n += 1;
    }
    fs::write(&path, png).map_err(|e| e.to_string())?;
    Ok(path)
}

/// Resolves `path` and makes sure it is a PNG inside the gallery folder.
fn checked<R: Runtime>(app: &AppHandle<R>, path: &str) -> Result<PathBuf, String> {
    let dir = dir(app)?.canonicalize().map_err(|e| e.to_string())?;
    let path = Path::new(path).canonicalize().map_err(|e| e.to_string())?;
    let is_png = path
        .extension()
        .is_some_and(|ext| ext.eq_ignore_ascii_case("png"));
    if path.parent() == Some(dir.as_path()) && is_png {
        Ok(path)
    } else {
        Err("Not a gallery snip".into())
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snip {
    path: PathBuf,
    name: String,
    /// Milliseconds since the Unix epoch.
    modified: u64,
    size: u64,
}

#[tauri::command]
pub fn list_snips(app: AppHandle) -> Result<Vec<Snip>, String> {
    let mut snips: Vec<Snip> = fs::read_dir(dir(&app)?)
        .map_err(|e| e.to_string())?
        .filter_map(Result::ok)
        .filter(|entry| {
            entry
                .path()
                .extension()
                .is_some_and(|ext| ext.eq_ignore_ascii_case("png"))
        })
        .filter_map(|entry| {
            let meta = entry.metadata().ok()?;
            let modified = meta.modified().ok()?.duration_since(UNIX_EPOCH).ok()?;
            Some(Snip {
                name: entry.path().file_stem()?.to_string_lossy().into_owned(),
                path: entry.path(),
                modified: modified.as_millis() as u64,
                size: meta.len(),
            })
        })
        .collect();
    snips.sort_by_key(|snip| std::cmp::Reverse(snip.modified));
    Ok(snips)
}

#[tauri::command]
pub fn read_snip(app: AppHandle, path: String) -> Result<Response, String> {
    let path = checked(&app, &path)?;
    fs::read(path).map(Response::new).map_err(|e| e.to_string())
}

/// Writes PNG bytes (the raw request body) to the snip named in the `x-snip-path`
/// header, or to a new gallery file when the header is absent. Returns the path.
#[tauri::command]
pub fn save_snip(app: AppHandle, request: tauri::ipc::Request<'_>) -> Result<PathBuf, String> {
    let tauri::ipc::InvokeBody::Raw(png) = request.body() else {
        return Err("Expected PNG bytes".into());
    };
    let target = request
        .headers()
        .get("x-snip-path")
        .and_then(|value| value.to_str().ok())
        .map(percent_decode);
    match target {
        Some(path) => {
            let path = checked(&app, &path)?;
            fs::write(&path, png).map_err(|e| e.to_string())?;
            Ok(path)
        }
        None => save_new(&app, png),
    }
}

/// Moves a snip to the Recycle Bin.
#[tauri::command]
pub fn delete_snip(app: AppHandle, path: String) -> Result<(), String> {
    trash::delete(checked(&app, &path)?).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn reveal_snip(app: AppHandle, path: String) -> Result<(), String> {
    tauri_plugin_opener::reveal_item_in_dir(checked(&app, &path)?).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn open_gallery_folder(app: AppHandle) -> Result<(), String> {
    tauri_plugin_opener::open_path(dir(&app)?, None::<&str>).map_err(|e| e.to_string())
}

/// Header values must be ASCII, so the frontend sends the path `encodeURIComponent`-ed.
fn percent_decode(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%'
            && let Some(byte) = value
                .get(i + 1..i + 3)
                .and_then(|hex| u8::from_str_radix(hex, 16).ok())
        {
            out.push(byte);
            i += 3;
            continue;
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

#[cfg(test)]
mod tests {
    use super::percent_decode;

    #[test]
    fn decodes_encode_uri_component() {
        assert_eq!(
            percent_decode("C%3A%5CUsers%5Cp%C3%A4rth%5CSnip%201.png"),
            r"C:\Users\pärth\Snip 1.png"
        );
        assert_eq!(percent_decode("100%"), "100%");
    }
}
