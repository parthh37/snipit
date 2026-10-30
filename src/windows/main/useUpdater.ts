import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";

/** Snipit lives in the tray for days, so re-check periodically, not just on launch. */
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const STARTUP_DELAY_MS = 5_000;

/** Emitted by the tray menu's "Check for updates…" item (see `src-tauri/src/tray.rs`). */
const CHECK_EVENT = "check-for-updates";

export type UpdaterState =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "up-to-date" }
  | { status: "available"; update: Update }
  | { status: "installing"; version: string; progress?: number }
  | { status: "error"; message: string };

/**
 * Checks GitHub Releases for a newer signed build (endpoint and public key are in
 * `tauri.conf.json`). Background checks stay silent unless an update is found; manual
 * checks also report "up to date" and errors.
 */
export function useUpdater() {
  const [state, setState] = useState<UpdaterState>({ status: "idle" });
  const busy = useRef(false);

  const checkForUpdates = useCallback(async (manual: boolean) => {
    if (busy.current) return;
    busy.current = true;
    if (manual) setState({ status: "checking" });
    try {
      const update = await check();
      if (update) setState({ status: "available", update });
      else if (manual) setState({ status: "up-to-date" });
    } catch (err) {
      console.warn("Update check failed", err);
      if (manual) setState({ status: "error", message: String(err) });
    } finally {
      busy.current = false;
    }
  }, []);

  const install = useCallback(async () => {
    if (state.status !== "available" || busy.current) return;
    const { update } = state;
    busy.current = true;
    setState({ status: "installing", version: update.version });
    try {
      let total = 0;
      let downloaded = 0;
      await update.downloadAndInstall((event) => {
        if (event.event === "Started") total = event.data.contentLength ?? 0;
        if (event.event === "Progress" && total > 0) {
          downloaded += event.data.chunkLength;
          setState({
            status: "installing",
            version: update.version,
            progress: Math.min(downloaded / total, 1),
          });
        }
      });
      // On Windows the installer has already closed the app; elsewhere restart into the new version.
      await relaunch();
    } catch (err) {
      busy.current = false;
      setState({ status: "error", message: String(err) });
    }
  }, [state]);

  const dismiss = useCallback(() => {
    if (state.status === "available") void state.update.close();
    setState({ status: "idle" });
  }, [state]);

  useEffect(() => {
    const unlisten = listen(CHECK_EVENT, () => void checkForUpdates(true));
    // Dev builds would "update" themselves to the released installer, so only check on request.
    if (!import.meta.env.PROD) {
      return () => void unlisten.then((stop) => stop());
    }
    // Let startup settle (and the network come up after login autostart) before the first check.
    const firstCheck = window.setTimeout(
      () => void checkForUpdates(false),
      STARTUP_DELAY_MS,
    );
    const interval = window.setInterval(
      () => void checkForUpdates(false),
      CHECK_INTERVAL_MS,
    );
    return () => {
      window.clearTimeout(firstCheck);
      window.clearInterval(interval);
      void unlisten.then((stop) => stop());
    };
  }, [checkForUpdates]);

  return {
    state,
    checkForUpdates: () => void checkForUpdates(true),
    install: () => void install(),
    dismiss,
  };
}
