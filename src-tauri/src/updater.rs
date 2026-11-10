//! Checks GitHub Releases for a newer signed build (endpoint and public key are in
//! `tauri.conf.json`) and installs it.
//!
//! Snipit spends most of its life in the tray with the main window hidden, so the checks run
//! here rather than in the window: an update found in the background updates the tray menu
//! and tooltip and shows a notification, as well as the main window's banner.

use std::{
    sync::Mutex,
    thread,
    time::{Duration, SystemTime},
};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_updater::{Update, UpdaterExt};

use crate::{settings, tray};

/// Let startup settle (and the network come up after a launch at login) before the first check.
const STARTUP_DELAY: Duration = Duration::from_secs(5);
/// Snipit runs for days, so re-check periodically, not just on launch.
const CHECK_INTERVAL: Duration = Duration::from_secs(6 * 60 * 60);
/// After a failed background check (usually no network), try again sooner.
const RETRY_INTERVAL: Duration = Duration::from_secs(30 * 60);
/// How often the background thread wakes to see whether a check is due. Comparing wall-clock
/// times on each wake keeps checks on schedule across sleep and hibernation.
const POLL_INTERVAL: Duration = Duration::from_secs(10 * 60);

/// The main window mirrors this event's payload (an `UpdateStatus`); see `useUpdater.ts`.
const STATUS_EVENT: &str = "update-status";

/// What the updater is doing, as shown in the main window's banner and the tray menu.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(
    tag = "status",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum UpdateStatus {
    Idle,
    Checking,
    UpToDate,
    Available {
        version: String,
        current_version: String,
    },
    Installing {
        version: String,
        /// 0–1, once the download size is known.
        progress: Option<f64>,
    },
    Error {
        message: String,
    },
}

#[derive(Default)]
struct Inner {
    status: Option<UpdateStatus>,
    /// The update found by the last check, ready to install.
    pending: Option<Update>,
    /// A check is in flight; `Some(true)` once someone asked for it to report its result.
    checking: Option<bool>,
    installing: bool,
    /// When the background thread should check next.
    next_check: Option<SystemTime>,
    /// The version the last notification was about, so each release is announced once.
    notified: Option<String>,
}

#[derive(Default)]
pub struct UpdaterState(Mutex<Inner>);

fn lock(app: &AppHandle) -> std::sync::MutexGuard<'_, Inner> {
    app.state::<UpdaterState>().inner().0.lock().unwrap()
}

pub fn status(app: &AppHandle) -> UpdateStatus {
    lock(app).status.clone().unwrap_or(UpdateStatus::Idle)
}

/// Stores the new status and tells the main window and the tray.
fn set_status(app: &AppHandle, status: UpdateStatus) {
    let previous = lock(app).status.replace(status.clone());
    let _ = app.emit_to("main", STATUS_EVENT, &status);
    // Download progress only changes the banner, so don't redo the tray for every percent.
    let same_kind = previous
        .as_ref()
        .is_some_and(|p| std::mem::discriminant(p) == std::mem::discriminant(&status));
    if !same_kind || matches!(status, UpdateStatus::Available { .. }) {
        tray::refresh(app);
    }
}

/// Starts the background checks. Dev builds would "update" themselves to the released
/// installer, so they only check on request.
pub fn init(app: &AppHandle) {
    if cfg!(debug_assertions) {
        return;
    }
    let app = app.clone();
    thread::spawn(move || {
        thread::sleep(STARTUP_DELAY);
        loop {
            if settings::get(&app).auto_check_updates && check_due(&app) {
                tauri::async_runtime::block_on(check(&app, false));
            }
            thread::sleep(POLL_INTERVAL);
        }
    });
}

fn check_due(app: &AppHandle) -> bool {
    match lock(app).next_check {
        None => true,
        // An `Err` means the clock went backwards; check rather than wait it out.
        Some(next) => SystemTime::now().duration_since(next).is_ok() || next_is_far(next),
    }
}

/// True when `next` is further away than a full interval, i.e. the clock was set back.
fn next_is_far(next: SystemTime) -> bool {
    next.duration_since(SystemTime::now())
        .is_ok_and(|wait| wait > CHECK_INTERVAL)
}

/// Looks for a newer release. Background checks (`manual == false`) stay quiet unless they find
/// one; manual checks also report "up to date" and errors.
pub async fn check(app: &AppHandle, manual: bool) {
    {
        let mut inner = lock(app);
        if inner.installing {
            return;
        }
        if let Some(reporting) = &mut inner.checking {
            // Already checking: have that check report its result.
            *reporting |= manual;
            drop(inner);
            if manual {
                set_status(app, UpdateStatus::Checking);
            }
            return;
        }
        inner.checking = Some(manual);
    }
    if manual {
        set_status(app, UpdateStatus::Checking);
    }

    let result = match app.updater() {
        Ok(updater) => updater.check().await,
        Err(err) => Err(err),
    };

    let (manual, previous) = {
        let mut inner = lock(app);
        let manual = inner.checking.take().unwrap_or(manual);
        let retry = if result.is_ok() {
            CHECK_INTERVAL
        } else {
            RETRY_INTERVAL
        };
        inner.next_check = Some(SystemTime::now() + retry);
        (manual, inner.status.clone())
    };

    match result {
        Ok(Some(update)) => {
            let version = update.version.clone();
            let status = UpdateStatus::Available {
                version: version.clone(),
                current_version: update.current_version.clone(),
            };
            let announce = {
                let mut inner = lock(app);
                inner.pending = Some(update);
                let announce = !manual && inner.notified.as_deref() != Some(&version);
                if announce {
                    inner.notified = Some(version.clone());
                }
                announce
            };
            set_status(app, status);
            if announce && !main_window_visible(app) {
                notify_available(app, &version);
            }
        }
        Ok(None) => {
            lock(app).pending = None;
            if manual {
                set_status(app, UpdateStatus::UpToDate);
            } else if matches!(previous, Some(UpdateStatus::Available { .. })) {
                // The release we offered was pulled.
                set_status(app, UpdateStatus::Idle);
            }
        }
        Err(err) => {
            eprintln!("Update check failed: {err}");
            if manual {
                set_status(
                    app,
                    UpdateStatus::Error {
                        message: err.to_string(),
                    },
                );
            }
        }
    }
}

/// Downloads the pending update, verifies its signature and runs the installer. On Windows the
/// installer closes Snipit itself; elsewhere Snipit restarts into the new version.
pub async fn install(app: &AppHandle) -> Result<(), String> {
    let update = {
        let mut inner = lock(app);
        if inner.installing {
            return Ok(());
        }
        let update = inner
            .pending
            .clone()
            .ok_or("There's no update to install. Check for updates first.")?;
        inner.installing = true;
        update
    };
    let version = update.version.clone();
    set_status(
        app,
        UpdateStatus::Installing {
            version: version.clone(),
            progress: None,
        },
    );

    let mut downloaded = 0u64;
    let mut shown_percent = None;
    let result = update
        .download_and_install(
            |chunk, total| {
                downloaded += chunk as u64;
                let Some(total) = total.filter(|&t| t > 0) else {
                    return;
                };
                let progress = (downloaded as f64 / total as f64).min(1.0);
                // One event per percent is plenty for a progress readout.
                let percent = (progress * 100.0) as u8;
                if shown_percent != Some(percent) {
                    shown_percent = Some(percent);
                    set_status(
                        app,
                        UpdateStatus::Installing {
                            version: version.clone(),
                            progress: Some(progress),
                        },
                    );
                }
            },
            || {},
        )
        .await;

    match result {
        Ok(()) => app.restart(),
        Err(err) => {
            lock(app).installing = false;
            let message = err.to_string();
            set_status(
                app,
                UpdateStatus::Error {
                    message: message.clone(),
                },
            );
            Err(message)
        }
    }
}

/// An update is being offered, so the tray item installs it rather than checking again.
pub fn is_offered(app: &AppHandle) -> bool {
    matches!(status(app), UpdateStatus::Available { .. })
}

fn main_window_visible(app: &AppHandle) -> bool {
    app.get_webview_window("main")
        .and_then(|w| w.is_visible().ok())
        .unwrap_or(false)
}

fn notify_available(app: &AppHandle, version: &str) {
    if let Err(err) = app
        .notification()
        .builder()
        .title(format!("Snipit {version} is available"))
        .body(format!(
            "Right-click the Snipit tray icon and choose “{}”, or open Snipit.",
            tray::update_menu_text(version)
        ))
        .show()
    {
        eprintln!("Couldn't show the update notification: {err}");
    }
}

#[tauri::command]
pub fn get_update_status(app: AppHandle) -> UpdateStatus {
    status(&app)
}

#[tauri::command]
pub async fn check_for_updates(app: AppHandle) {
    check(&app, true).await;
}

#[tauri::command]
pub async fn install_update(app: AppHandle) -> Result<(), String> {
    install(&app).await
}

#[tauri::command]
pub fn set_auto_check_updates(app: AppHandle, enabled: bool) -> Result<settings::Settings, String> {
    let settings = settings::update(&app, |s| s.auto_check_updates = enabled)?;
    if enabled && !cfg!(debug_assertions) {
        // Check now instead of on the next background wake.
        let app = app.clone();
        tauri::async_runtime::spawn(async move { check(&app, false).await });
    }
    Ok(settings)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn status_matches_the_frontend_shape() {
        let json = serde_json::to_value(UpdateStatus::Available {
            version: "0.2.0".into(),
            current_version: "0.1.0".into(),
        })
        .unwrap();
        assert_eq!(
            json,
            serde_json::json!({
                "status": "available",
                "version": "0.2.0",
                "currentVersion": "0.1.0",
            })
        );
        assert_eq!(
            serde_json::to_value(UpdateStatus::UpToDate).unwrap(),
            serde_json::json!({ "status": "up-to-date" })
        );
    }

    #[test]
    fn clock_set_back_counts_as_due() {
        assert!(next_is_far(SystemTime::now() + CHECK_INTERVAL * 2));
        assert!(!next_is_far(SystemTime::now() + RETRY_INTERVAL));
    }
}
