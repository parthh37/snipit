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

use crate::library::{self, Meta};
use crate::settings::{self, DEFAULT_FILENAME_TEMPLATE, Settings};
use crate::{shortcuts, tray};

/// `Pictures\Snipit`, where snips go unless Settings picks another folder.
pub fn default_dir<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .picture_dir()
        .map_err(|e| e.to_string())?
        .join("Snipit"))
}

/// The folder chosen in Settings, or the default one; it isn't created.
pub fn configured_dir<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    match settings::get(app).output_folder {
        Some(dir) => Ok(dir),
        None => default_dir(app),
    }
}

/// Every snip is saved here as a PNG; the Gallery view lists this folder.
pub fn dir<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let dir = configured_dir(app)?;
    fs::create_dir_all(&dir).map_err(|e| format!("Couldn't open {}: {e}", dir.display()))?;
    Ok(dir)
}

/// Lets the gallery's `<img>` tags load files from the snips folder. The default folder is
/// allowed in `tauri.conf.json`; one picked in Settings is added here.
pub fn allow_assets<R: Runtime>(app: &AppHandle<R>) {
    if let Ok(dir) = configured_dir(app)
        && let Err(err) = app.asset_protocol_scope().allow_directory(&dir, true)
    {
        eprintln!("Couldn't allow {} for thumbnails: {err}", dir.display());
    }
}

pub fn encode_png(image: &RgbaImage) -> Result<Vec<u8>, String> {
    let mut png = Vec::new();
    image
        .write_to(&mut Cursor::new(&mut png), ImageFormat::Png)
        .map_err(|e| e.to_string())?;
    Ok(png)
}

/// What a new snip is called after, for the filename template.
#[derive(Debug, Clone, Default)]
pub struct Origin {
    /// `region`, `window`, `fullscreen`, `scrolling` or `clipboard`.
    pub mode: &'static str,
    /// The program the capture came from, e.g. `chrome`.
    pub app: Option<String>,
    /// The window's title.
    pub title: Option<String>,
}

/// Fields a filename template can use, each written `{name}`.
pub const TEMPLATE_FIELDS: [&str; 11] = [
    "date", "time", "year", "month", "day", "hour", "minute", "second", "mode", "app", "title",
];

/// Fills in a filename template such as `Snipit_{date}_{time}` (see [`TEMPLATE_FIELDS`]) and
/// makes the result safe to use as a Windows file name. Errors on unknown or unclosed fields.
pub fn format_name(
    template: &str,
    now: DateTime<Local>,
    origin: &Origin,
) -> Result<String, String> {
    let mut out = String::new();
    let mut rest = template;
    while let Some(start) = rest.find('{') {
        out.push_str(&rest[..start]);
        let after = &rest[start + 1..];
        let end = after
            .find('}')
            .ok_or("A { in the file name has no closing }")?;
        let field = after[..end].trim().to_ascii_lowercase();
        let value = match field.as_str() {
            "date" => now.format("%Y-%m-%d").to_string(),
            "time" => now.format("%H-%M-%S").to_string(),
            "year" => now.format("%Y").to_string(),
            "month" => now.format("%m").to_string(),
            "day" => now.format("%d").to_string(),
            "hour" => now.format("%H").to_string(),
            "minute" => now.format("%M").to_string(),
            "second" => now.format("%S").to_string(),
            "mode" => origin.mode.to_owned(),
            "app" => origin.app.clone().unwrap_or_default(),
            "title" => origin
                .title
                .as_deref()
                .unwrap_or_default()
                .chars()
                .take(60)
                .collect(),
            _ => {
                return Err(format!(
                    "Unknown field {{{}}}. Use {}.",
                    &after[..end],
                    TEMPLATE_FIELDS.map(|f| format!("{{{f}}}")).join(", ")
                ));
            }
        };
        out.push_str(&value);
        rest = &after[end + 1..];
    }
    out.push_str(rest);
    Ok(safe_file_name(&out))
}

/// Replaces characters Windows doesn't allow in file names, and avoids reserved names.
fn safe_file_name(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| match c {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => '_',
            c if c.is_control() => '_',
            c => c,
        })
        .collect();
    let mut cleaned = cleaned
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .trim_matches(|c: char| c == '.' || c == ' ')
        .chars()
        .take(150)
        .collect::<String>();
    if cleaned.is_empty() {
        cleaned = "Snipit".into();
    }
    const RESERVED: [&str; 22] = [
        "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
        "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
    ];
    let stem = cleaned.split('.').next().unwrap_or_default();
    if RESERVED.iter().any(|r| r.eq_ignore_ascii_case(stem)) {
        cleaned.insert(0, '_');
    }
    cleaned
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

/// Saves a new snip, named by the template in Settings, and returns its path.
pub fn save_new<R: Runtime>(
    app: &AppHandle<R>,
    png: &[u8],
    origin: &Origin,
) -> Result<PathBuf, String> {
    let template = settings::get(app).filename_template;
    let now = Local::now();
    let stem = format_name(&template, now, origin)
        .or_else(|_| format_name(DEFAULT_FILENAME_TEMPLATE, now, origin))?;
    let path = unique_path(&dir(app)?, &stem);
    fs::write(&path, png).map_err(|e| format!("Couldn't save {}: {e}", path.display()))?;
    library::record(
        app,
        &path,
        Meta {
            tags: Vec::new(),
            app: origin.app.clone(),
            title: origin.title.clone(),
        },
    );
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
    tags: Vec<String>,
    /// The program it was captured from.
    app: Option<String>,
    /// The title of the window it was captured from.
    title: Option<String>,
}

#[tauri::command]
pub async fn list_snips(app: AppHandle) -> Result<Vec<Snip>, String> {
    list(&app)
}

/// Every snip in the gallery folder, newest first.
pub fn list<R: Runtime>(app: &AppHandle<R>) -> Result<Vec<Snip>, String> {
    let library = library::all(app);
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
            let Meta { tags, app, title } = library::lookup(&library, &path);
            Some(Snip {
                name: path.file_stem()?.to_string_lossy().into_owned(),
                editable: project_path(&path).is_file(),
                tags,
                app,
                title,
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
            let source = checked(&app, &path)?;
            let path = edit_target(&source);
            fs::write(&path, png).map_err(|e| e.to_string())?;
            library::inherit(&app, &source, &path);
            path
        }
        None => save_new(
            &app,
            png,
            &Origin {
                mode: "clipboard",
                ..Origin::default()
            },
        )?,
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
    library::remove(&app, &path);
    tray::refresh_recent(&app);
    Ok(())
}

/// Replaces a snip's tags; returns them tidied up (see [`library::clean_tags`]).
#[tauri::command]
pub fn set_snip_tags(
    app: AppHandle,
    path: String,
    tags: Vec<String>,
) -> Result<Vec<String>, String> {
    let path = checked(&app, &path)?;
    Ok(library::set_tags(&app, &path, &tags))
}

/// Asks for a new snips folder. Returns the new settings view, or nothing if cancelled.
#[tauri::command]
pub async fn choose_output_folder(
    app: AppHandle,
) -> Result<Option<shortcuts::SettingsView>, String> {
    let start = configured_dir(&app).ok();
    let owner = app
        .get_webview_window("main")
        .and_then(|w| w.hwnd().ok())
        .map(|h| h.0 as isize);
    let Some(folder) = crate::folder_picker::pick(owner, start.as_deref())? else {
        return Ok(None);
    };
    fs::create_dir_all(&folder).map_err(|e| format!("Can't use {}: {e}", folder.display()))?;
    set_output_folder(&app, Some(folder))?;
    Ok(Some(shortcuts::view(&app)))
}

/// Goes back to saving in `Pictures\Snipit`.
#[tauri::command]
pub fn reset_output_folder(app: AppHandle) -> Result<shortcuts::SettingsView, String> {
    set_output_folder(&app, None)?;
    Ok(shortcuts::view(&app))
}

fn set_output_folder(app: &AppHandle, folder: Option<PathBuf>) -> Result<Settings, String> {
    // Picking the default folder is the same as not picking one.
    let folder = folder.filter(|f| default_dir(app).is_ok_and(|d| !same_dir(&d, f)));
    let next = settings::update(app, |s| s.output_folder = folder)?;
    allow_assets(app);
    tray::refresh_recent(app);
    Ok(next)
}

fn same_dir(a: &Path, b: &Path) -> bool {
    match (a.canonicalize(), b.canonicalize()) {
        (Ok(a), Ok(b)) => a == b,
        _ => a == b,
    }
}

/// Saves the filename template after checking it (an empty one restores the default).
#[tauri::command]
pub fn set_filename_template(app: AppHandle, template: String) -> Result<Settings, String> {
    let template = match template.trim() {
        "" => DEFAULT_FILENAME_TEMPLATE.to_owned(),
        t => t.to_owned(),
    };
    preview_filename(template.clone())?;
    settings::update(&app, |s| s.filename_template = template)
}

/// What a snip taken now from a browser window would be called with `template`.
#[tauri::command]
pub fn preview_filename(template: String) -> Result<String, String> {
    let origin = Origin {
        mode: "region",
        app: Some("msedge".into()),
        title: Some("Snipit - Microsoft Edge".into()),
    };
    format_name(&template, Local::now(), &origin).map(|name| format!("{name}.png"))
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
    fn default_name_is_sortable_timestamp() {
        let t = Local.with_ymd_and_hms(2026, 3, 7, 9, 5, 2).unwrap();
        assert_eq!(
            format_name(DEFAULT_FILENAME_TEMPLATE, t, &Origin::default()).unwrap(),
            "Snipit_2026-03-07_09-05-02"
        );
    }

    #[test]
    fn templates_fill_in_fields() {
        let t = Local.with_ymd_and_hms(2026, 3, 7, 9, 5, 2).unwrap();
        let origin = Origin {
            mode: "window",
            app: Some("chrome".into()),
            title: Some("Docs: \"Plan\" / v2".into()),
        };
        assert_eq!(
            format_name(
                "{app} {YEAR}{month}{day}-{hour}{minute}{second} {mode}",
                t,
                &origin
            )
            .unwrap(),
            "chrome 20260307-090502 window"
        );
        assert_eq!(
            format_name("{title}", t, &origin).unwrap(),
            "Docs_ _Plan_ _ v2"
        );
        // Missing values leave nothing behind, and an empty name still saves.
        assert_eq!(
            format_name("{app}", t, &Origin::default()).unwrap(),
            "Snipit"
        );
        assert!(format_name("{nope}", t, &origin).is_err());
        assert!(format_name("Snip {date", t, &origin).is_err());
    }

    #[test]
    fn file_names_are_windows_safe() {
        assert_eq!(safe_file_name("a<b>c:d"), "a_b_c_d");
        assert_eq!(safe_file_name("  trailing dots... "), "trailing dots");
        assert_eq!(safe_file_name("con"), "_con");
        assert_eq!(safe_file_name("COM1.backup"), "_COM1.backup");
        assert_eq!(safe_file_name("   "), "Snipit");
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
