//! Facts about snips that a PNG can't hold: tags, plus the app and window they were captured
//! from (so the gallery can search by them). Kept as JSON in the app config directory, keyed
//! by the snip's path.

use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, Runtime};

const MAX_TAGS: usize = 20;
const MAX_TAG_CHARS: usize = 32;

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Meta {
    pub tags: Vec<String>,
    /// The program the capture came from, e.g. `chrome`.
    pub app: Option<String>,
    /// The title of the window it came from.
    pub title: Option<String>,
}

impl Meta {
    fn is_empty(&self) -> bool {
        self.tags.is_empty() && self.app.is_none() && self.title.is_none()
    }
}

/// Loaded on first use.
#[derive(Default)]
pub struct LibraryState(Mutex<Option<BTreeMap<String, Meta>>>);

fn file<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    Some(app.path().app_config_dir().ok()?.join("library.json"))
}

/// Paths compare case-insensitively on Windows, and a canonicalized path (`\\?\C:\…`, as the
/// commands check them) names the same file as the plain one the folder listing gives.
fn key(path: &Path) -> String {
    let path = path.to_string_lossy().to_lowercase();
    if let Some(unc) = path.strip_prefix(r"\\?\unc\") {
        format!(r"\\{unc}")
    } else if let Some(local) = path.strip_prefix(r"\\?\") {
        local.to_owned()
    } else {
        path
    }
}

fn with<R: Runtime, T>(
    app: &AppHandle<R>,
    change: impl FnOnce(&mut BTreeMap<String, Meta>) -> T,
) -> T {
    let state = app.state::<LibraryState>();
    let mut slot = state.0.lock().unwrap();
    let entries = slot.get_or_insert_with(|| {
        file(app)
            .and_then(|path| fs::read_to_string(path).ok())
            .and_then(|json| serde_json::from_str(&json).ok())
            .unwrap_or_default()
    });
    change(entries)
}

fn save<R: Runtime>(app: &AppHandle<R>, entries: &BTreeMap<String, Meta>) {
    let Some(path) = file(app) else { return };
    let result = serde_json::to_string(entries)
        .map_err(|e| e.to_string())
        .and_then(|json| {
            if let Some(dir) = path.parent() {
                fs::create_dir_all(dir).map_err(|e| e.to_string())?;
            }
            fs::write(&path, json).map_err(|e| e.to_string())
        });
    if let Err(err) = result {
        eprintln!("Couldn't save the library: {err}");
    }
}

/// Every snip's facts, by [`key`].
pub fn all<R: Runtime>(app: &AppHandle<R>) -> BTreeMap<String, Meta> {
    with(app, |entries| entries.clone())
}

pub fn lookup(entries: &BTreeMap<String, Meta>, path: &Path) -> Meta {
    entries.get(&key(path)).cloned().unwrap_or_default()
}

/// Records where a new snip came from.
pub fn record<R: Runtime>(app: &AppHandle<R>, path: &Path, meta: Meta) {
    if meta.is_empty() {
        return;
    }
    with(app, |entries| {
        entries.insert(key(path), meta);
        save(app, entries);
    });
}

/// Gives an edited copy the tags and origin of the snip it was made from.
pub fn inherit<R: Runtime>(app: &AppHandle<R>, from: &Path, to: &Path) {
    with(app, |entries| {
        if entries.contains_key(&key(to)) {
            return;
        }
        if let Some(meta) = entries.get(&key(from)).cloned() {
            entries.insert(key(to), meta);
            save(app, entries);
        }
    });
}

pub fn remove<R: Runtime>(app: &AppHandle<R>, path: &Path) {
    with(app, |entries| {
        if entries.remove(&key(path)).is_some() {
            save(app, entries);
        }
    });
}

/// Replaces a snip's tags; returns them as stored.
pub fn set_tags<R: Runtime>(app: &AppHandle<R>, path: &Path, tags: &[String]) -> Vec<String> {
    let tags = clean_tags(tags);
    with(app, |entries| {
        let meta = entries.entry(key(path)).or_default();
        meta.tags = tags.clone();
        if meta.is_empty() {
            entries.remove(&key(path));
        }
        save(app, entries);
    });
    tags
}

/// Trimmed, single-spaced, at most [`MAX_TAG_CHARS`] long, and each only once (ignoring case).
pub fn clean_tags(tags: &[String]) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for tag in tags {
        let tag: String = tag
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ")
            .chars()
            .filter(|c| !c.is_control() && *c != ',')
            .take(MAX_TAG_CHARS)
            .collect();
        let tag = tag.trim().to_owned();
        if !tag.is_empty() && !out.iter().any(|t| t.eq_ignore_ascii_case(&tag)) {
            out.push(tag);
        }
        if out.len() == MAX_TAGS {
            break;
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tags_are_tidied() {
        let raw = [
            "  bug ".to_owned(),
            "Bug".to_owned(),
            "release   notes".to_owned(),
            "".to_owned(),
            "a,b".to_owned(),
            "x".repeat(40),
        ];
        assert_eq!(
            clean_tags(&raw),
            vec![
                "bug".to_owned(),
                "release notes".to_owned(),
                "ab".to_owned(),
                "x".repeat(MAX_TAG_CHARS)
            ]
        );
    }

    #[test]
    fn keys_ignore_case() {
        assert_eq!(
            key(Path::new(r"C:\Pics\Shot.PNG")),
            key(Path::new(r"c:\pics\shot.png"))
        );
        assert_eq!(
            key(Path::new(r"\\?\C:\Pics\shot.png")),
            key(Path::new(r"C:\Pics\shot.png"))
        );
        assert_eq!(
            key(Path::new(r"\\?\UNC\nas\share\shot.png")),
            key(Path::new(r"\\nas\share\shot.png"))
        );
    }
}
