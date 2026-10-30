import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { listen } from "@tauri-apps/api/event";
import logo from "../../../assets/icon.svg";
import {
  CAPTURE_FAILED_EVENT,
  CAPTURE_SAVED_EVENT,
  type CaptureEntry,
  type CaptureMode,
  type CaptureSaved,
  type HotkeyStatus,
  getHotkeyStatus,
  listRecentCaptures,
  openKeyboardSettings,
  startCapture,
} from "../../lib/capture";
import RecentCaptures from "./RecentCaptures";
import UpdateBanner from "./UpdateBanner";
import { useUpdater } from "./useUpdater";

const RECENT_LIMIT = 24;

const captureModes: {
  mode: CaptureMode;
  name: string;
  hint: string;
  keys: string[];
}[] = [
  {
    mode: "interactive",
    name: "Region or window",
    hint: "Drag to select an area, or click a window",
    keys: ["PrtSc"],
  },
  {
    mode: "fullscreen",
    name: "Full screen",
    hint: "Capture the monitor under the cursor",
    keys: ["Shift", "PrtSc"],
  },
];

interface Toast {
  kind: "success" | "error";
  text: string;
}

export default function MainWindow() {
  const [version, setVersion] = useState<string>();
  const [hotkey, setHotkey] = useState<HotkeyStatus>();
  const [captures, setCaptures] = useState<CaptureEntry[]>([]);
  const [toast, setToast] = useState<Toast | null>(null);
  const updater = useUpdater();

  useEffect(() => {
    getVersion().then(setVersion, () => undefined);
    getHotkeyStatus().then(setHotkey, () => undefined);
    listRecentCaptures(RECENT_LIMIT).then(setCaptures, () => undefined);

    const unlisteners = [
      listen<CaptureSaved>(CAPTURE_SAVED_EVENT, ({ payload }) => {
        setCaptures((list) => [payload.entry, ...list].slice(0, RECENT_LIMIT));
        setToast({
          kind: "success",
          text: payload.copied
            ? "Copied to clipboard and saved to Pictures\\Snipit"
            : "Saved to Pictures\\Snipit",
        });
      }),
      listen<string>(CAPTURE_FAILED_EVENT, ({ payload }) =>
        setToast({ kind: "error", text: payload }),
      ),
    ];
    return () => unlisteners.forEach((u) => u.then((off) => off()));
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(timer);
  }, [toast]);

  const hotkeyProblem =
    hotkey && (hotkey.reservedByWindows || !hotkey.registered);

  return (
    <main className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-zinc-200 px-6 py-4 dark:border-zinc-800">
        <img src={logo} alt="" className="size-9" />
        <div>
          <h1 className="text-lg leading-tight font-semibold">Snipit</h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Capture. Annotate. Share.
          </p>
        </div>
      </header>

      <UpdateBanner
        state={updater.state}
        onInstall={updater.install}
        onDismiss={updater.dismiss}
      />

      <div className="flex-1 overflow-auto px-6 py-6">
        {hotkeyProblem && (
          <div className="mb-6 flex flex-wrap items-center gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
            <p className="flex-1">
              {hotkey.reservedByWindows
                ? "Windows is using the Print Screen key for Snipping Tool. Turn off “Use the Print screen key to open screen capture” to capture with PrtSc."
                : "Snipit couldn't register the Print Screen key; another screenshot tool is probably using it. Close that app and restart Snipit, or capture from here or the tray menu."}
            </p>
            {hotkey.reservedByWindows && (
              <button
                type="button"
                onClick={() => void openKeyboardSettings()}
                className="rounded-md bg-amber-900 px-3 py-1.5 font-medium text-white hover:bg-amber-800 dark:bg-amber-300 dark:text-amber-950 dark:hover:bg-amber-200"
              >
                Open keyboard settings
              </button>
            )}
          </div>
        )}

        <h2 className="mb-3 text-xs font-semibold tracking-wide text-zinc-500 uppercase dark:text-zinc-400">
          New capture
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {captureModes.map((m) => (
            <button
              key={m.mode}
              type="button"
              onClick={() => void startCapture(m.mode)}
              className="group rounded-xl border border-zinc-200 bg-white p-5 text-left shadow-sm transition hover:border-brand-500 hover:shadow-md focus-visible:outline-2 focus-visible:outline-brand-500 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-brand-500"
            >
              <span className="flex items-center justify-between gap-2">
                <span className="font-medium">{m.name}</span>
                <span className="flex gap-1">
                  {m.keys.map((k) => (
                    <kbd
                      key={k}
                      className="rounded border border-zinc-300 bg-zinc-50 px-1.5 py-0.5 font-sans text-xs text-zinc-600 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                    >
                      {k}
                    </kbd>
                  ))}
                </span>
              </span>
              <span className="mt-1 block text-sm text-zinc-500 dark:text-zinc-400">
                {m.hint}
              </span>
            </button>
          ))}
        </div>

        <h2 className="mt-8 mb-3 text-xs font-semibold tracking-wide text-zinc-500 uppercase dark:text-zinc-400">
          Recent captures
        </h2>
        <RecentCaptures
          captures={captures}
          onCopied={() =>
            setToast({ kind: "success", text: "Copied to clipboard" })
          }
        />
      </div>

      <footer className="flex items-center justify-between border-t border-zinc-200 px-6 py-3 text-xs text-zinc-400 dark:border-zinc-800 dark:text-zinc-500">
        <span>Closing this window keeps Snipit running in the tray.</span>
        <span className="flex items-center gap-3">
          <button
            type="button"
            onClick={updater.checkForUpdates}
            disabled={updater.state.status === "checking"}
            className="hover:text-zinc-600 disabled:opacity-60 dark:hover:text-zinc-300"
          >
            {updater.state.status === "checking"
              ? "Checking for updates…"
              : "Check for updates"}
          </button>
          <span>{version ? `v${version}` : ""}</span>
        </span>
      </footer>

      {toast && (
        <div
          role="status"
          className={`fixed bottom-14 left-1/2 -translate-x-1/2 rounded-lg px-4 py-2 text-sm text-white shadow-lg ${
            toast.kind === "success"
              ? "bg-zinc-900 dark:bg-zinc-700"
              : "bg-red-600"
          }`}
        >
          {toast.text}
        </div>
      )}
    </main>
  );
}
