use std::{
    fs,
    io::Cursor,
    path::{Path, PathBuf},
    time::UNIX_EPOCH,
};

use chrono::{DateTime, Local};
use serde::Serialize;
use tauri::{AppHandle, Manager, Runtime, ipc::Response};
use xcap::image::{ImageFormat, RgbaImage};

use crate::tray;

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

/// Saves a new snip and returns its path.
pub fn save_new<R: Runtime>(app: &AppHandle<R>, png: &[u8]) -> Result<PathBuf, String> {
    let path = unique_path(&dir(app)?, &file_stem(Local::now()));
    fs::write(&path, png).map_err(|e| format!("Couldn't save {}: {e}", path.display()))?;
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

/// The `.snip` project saved beside an edited PNG: the same name with a `.snip` extension.
/// It holds the original capture plus every annotation, so the edit can be reopened and
/// changed later (the format is described in `src/editor/snipFile.ts`).
pub fn project_path(png: &Path) -> PathBuf {
    png.with_extension("snip")
}

/// Writes through a temporary file, so a crash mid-save can't leave a half-written project
/// where the last good one was.
fn write_atomic(path: &Path, data: &[u8]) -> Result<(), String> {
    let tmp = path.with_extension("snip.tmp");
    fs::write(&tmp, data).map_err(|e| format!("Couldn't save {}: {e}", path.display()))?;
    fs::rename(&tmp, path).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        format!("Couldn't save {}: {e}", path.display())
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snip {
    pub path: PathBuf,
    pub name: String,
    /// Milliseconds since the Unix epoch.
    pub modified: u64,
    size: u64,
    /// A `.snip` project sits beside it, so its annotations can still be edited.
    editable: bool,
}

#[tauri::command]
pub async fn list_snips(app: AppHandle) -> Result<Vec<Snip>, String> {
    list(&app)
}

/// Every snip in the gallery folder, newest first.
pub fn list<R: Runtime>(app: &AppHandle<R>) -> Result<Vec<Snip>, String> {
    let mut snips: Vec<Snip> = fs::read_dir(dir(app)?)
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
            let path = entry.path();
            Some(Snip {
                name: path.file_stem()?.to_string_lossy().into_owned(),
                editable: project_path(&path).is_file(),
                modified: modified.as_millis() as u64,
                size: meta.len(),
                path,
            })
        })
        .collect();
    snips.sort_by_key(|snip| std::cmp::Reverse(snip.modified));
    Ok(snips)
}

const EDITED_SUFFIX: &str = "_edited";

/// Whether `stem` names an edited copy: `name_edited`, or `name_edited_2` and so on.
pub fn is_edited(stem: &str) -> bool {
    let base = match stem.rsplit_once('_') {
        Some((base, n)) if !n.is_empty() && n.bytes().all(|b| b.is_ascii_digit()) => base,
        _ => stem,
    };
    base.ends_with(EDITED_SUFFIX)
}

/// Where an edit of `path` is saved. Original captures are never overwritten: the first save
/// goes to a new `<name>_edited.png` beside it, and later saves update that copy.
fn edit_target(path: &Path) -> PathBuf {
    let stem = path
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_default();
    match path.parent() {
        Some(dir) if !is_edited(&stem) => unique_path(dir, &format!("{stem}{EDITED_SUFFIX}")),
        _ => path.to_path_buf(),
    }
}

// The commands below read, decode or write whole images, so they are `async` to keep that work
// off the main thread (synchronous commands run on it and would freeze every window).

#[tauri::command]
pub async fn read_snip(app: AppHandle, path: String) -> Result<Response, String> {
    let path = checked(&app, &path)?;
    fs::read(path).map(Response::new).map_err(|e| e.to_string())
}

/// The `.snip` project saved beside the snip at `path`, or no bytes when it has none.
#[tauri::command]
pub async fn read_snip_project(app: AppHandle, path: String) -> Result<Response, String> {
    let project = project_path(&checked(&app, &path)?);
    match fs::read(&project) {
        Ok(bytes) => Ok(Response::new(bytes)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Response::new(Vec::new())),
        Err(e) => Err(format!("Couldn't open {}: {e}", project.display())),
    }
}

/// Splits a save request's body into the flattened PNG and the `.snip` project after it. The
/// `x-png-length` header says where the PNG ends; without it the whole body is the PNG.
fn split_body<'a>(
    body: &'a [u8],
    png_length: Option<&str>,
) -> Result<(&'a [u8], &'a [u8]), String> {
    match png_length {
        None => Ok((body, &[])),
        Some(value) => {
            let n: usize = value.parse().map_err(|_| "Bad x-png-length header")?;
            if n > body.len() {
                return Err("x-png-length is longer than the body".into());
            }
            Ok(body.split_at(n))
        }
    }
}

/// Writes the flattened PNG for the snip named in the `x-snip-path` header (see
/// [`edit_target`]), or to a new gallery file when the header is absent, plus the `.snip`
/// project beside it when the body carries one (see [`split_body`]). Returns the PNG's path,
/// which the editor uses for its next save.
#[tauri::command]
pub async fn save_snip(
    app: AppHandle,
    request: tauri::ipc::Request<'_>,
) -> Result<PathBuf, String> {
    let tauri::ipc::InvokeBody::Raw(body) = request.body() else {
        return Err("Expected PNG bytes".into());
    };
    let headers = request.headers();
    let (png, project) = split_body(
        body,
        headers
            .get("x-png-length")
            .and_then(|value| value.to_str().ok()),
    )?;
    let target = headers
        .get("x-snip-path")
        .and_then(|value| value.to_str().ok())
        .map(percent_decode);
    let path = match target {
        Some(path) => {
            let path = edit_target(&checked(&app, &path)?);
            fs::write(&path, png).map_err(|e| e.to_string())?;
            path
        }
        None => save_new(&app, png)?,
    };
    if !project.is_empty() {
        write_atomic(&project_path(&path), project)?;
    }
    tray::refresh_recent(&app);
    Ok(path)
}

/// Moves a snip, and its `.snip` project if it has one, to the Recycle Bin.
#[tauri::command]
pub async fn delete_snip(app: AppHandle, path: String) -> Result<(), String> {
    let path = checked(&app, &path)?;
    let project = project_path(&path);
    if project.is_file() {
        trash::delete_all([&path, &project]).map_err(|e| e.to_string())?;
    } else {
        trash::delete(&path).map_err(|e| e.to_string())?;
    }
    tray::refresh_recent(&app);
    Ok(())
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

    #[test]
    fn recognises_edited_copies() {
        assert!(is_edited("Snipit_2026-03-07_09-05-02_edited"));
        assert!(is_edited("Snipit_2026-03-07_09-05-02_edited_3"));
        assert!(!is_edited("Snipit_2026-03-07_09-05-02"));
        assert!(!is_edited("Snipit_2026-03-07_09-05-02_2"));
    }

    #[test]
    fn edits_never_overwrite_the_original() {
        let dir = std::env::temp_dir().join(format!("snipit-edit-test-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let original = dir.join("shot.png");
        fs::write(&original, b"").unwrap();

        let first = edit_target(&original);
        assert_eq!(first.file_name().unwrap(), "shot_edited.png");
        fs::write(&first, b"").unwrap();
        // Saving again from the edited copy updates it in place.
        assert_eq!(edit_target(&first), first);
        // Editing the original again (say, in a later session) makes a second copy.
        assert_eq!(
            edit_target(&original).file_name().unwrap(),
            "shot_edited_2.png"
        );
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn project_sits_beside_the_png() {
        assert_eq!(
            project_path(Path::new(r"C:\Pics\Snipit_2026_edited.png")),
            Path::new(r"C:\Pics\Snipit_2026_edited.snip")
        );
    }

    #[test]
    fn splits_png_from_project() {
        let body = b"PNGDATAsnipdata";
        assert_eq!(split_body(body, None).unwrap(), (&body[..], &b""[..]));
        assert_eq!(
            split_body(body, Some("7")).unwrap(),
            (&b"PNGDATA"[..], &b"snipdata"[..])
        );
        assert_eq!(split_body(body, Some("15")).unwrap(), (&body[..], &b""[..]));
        assert!(split_body(body, Some("16")).is_err());
        assert!(split_body(body, Some("-1")).is_err());
    }

    #[test]
    fn atomic_write_replaces_and_leaves_no_temp() {
        let dir = std::env::temp_dir().join(format!("snipit-atomic-test-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("shot_edited.snip");
        write_atomic(&path, b"one").unwrap();
        write_atomic(&path, b"two").unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"two");
        assert!(!path.with_extension("snip.tmp").exists());
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn decodes_encode_uri_component() {
        assert_eq!(
            percent_decode("C%3A%5CUsers%5Cp%C3%A4rth%5CSnip%201.png"),
            r"C:\Users\pärth\Snip 1.png"
        );
        assert_eq!(percent_decode("100%"), "100%");
    }
}
