import { useCallback, useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { api, UPDATE_STATUS_EVENT, type UpdateStatus } from "../../lib/api";

/**
 * Mirrors the updater in `src-tauri/src/updater.rs`, which checks on launch and every few
 * hours even while this window is hidden, and also drives the tray menu.
 *
 * "Later" only hides the banner here; the tray keeps offering the update, and the banner
 * comes back on the next manual check.
 */
export function useUpdater() {
  const [status, setStatus] = useState<UpdateStatus>({ status: "idle" });
  const [dismissed, setDismissed] = useState<UpdateStatus>();

  useEffect(() => {
    const unlisten = listen<UpdateStatus>(UPDATE_STATUS_EVENT, (e) => {
      if (e.payload.status === "checking") setDismissed(undefined);
      setStatus(e.payload);
    });
    api
      .getUpdateStatus()
      .then(setStatus)
      .catch(() => {});
    return () => void unlisten.then((stop) => stop());
  }, []);

  const shown: UpdateStatus =
    dismissed && sameStatus(dismissed, status) ? { status: "idle" } : status;

  return {
    status: shown,
    checking: status.status === "checking",
    checkForUpdates: useCallback(() => void api.checkForUpdates(), []),
    // Failures come back as an "error" status.
    install: useCallback(() => void api.installUpdate().catch(() => {}), []),
    dismiss: useCallback(() => setDismissed(status), [status]),
  };
}

/** Background re-checks repeat the same status; a dismissed banner stays dismissed. */
function sameStatus(a: UpdateStatus, b: UpdateStatus) {
  if (a.status === "available" && b.status === "available") {
    return a.version === b.version;
  }
  return a.status === b.status;
}
