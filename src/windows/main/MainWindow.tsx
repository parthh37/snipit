import { useCallback, useEffect, useRef, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { listen } from "@tauri-apps/api/event";
import logo from "../../../assets/icon.svg";
import Editor, { type EditorDoc } from "../../editor/Editor";
import Gallery from "../../gallery/Gallery";
import {
  api,
  errorMessage,
  type SettingsView,
  type ShortcutAction,
} from "../../lib/api";
import {
  CAPTURE_SAVED_EVENT,
  EDITOR_OPEN_EVENT,
  ERROR_EVENT,
  type CaptureSaved,
  annotateClipboard,
  startCapture,
} from "../../lib/capture";
import Settings, { Keys } from "../../settings/Settings";
import UpdateBanner from "./UpdateBanner";
import { useUpdater } from "./useUpdater";

type View = "capture" | "gallery" | "settings";

const NAV: { view: View; label: string }[] = [
  { view: "capture", label: "Capture" },
  { view: "gallery", label: "Gallery" },
  { view: "settings", label: "Settings" },
];

const captureModes: {
  name: string;
  hint: string;
  shortcut: ShortcutAction;
  run: () => Promise<void>;
}[] = [
  {
    name: "Region or window",
    hint: "Drag to select an area, or click a window",
    shortcut: "captureRegion",
    run: () => startCapture("interactive"),
  },
  {
    name: "Full screen",
    hint: "Capture the monitor under the cursor",
    shortcut: "captureFullscreen",
    run: () => startCapture("fullscreen"),
  },
  {
    name: "From clipboard",
    hint: "Annotate a copied image (Ctrl+V)",
    shortcut: "annotateClipboard",
    run: annotateClipboard,
  },
];

export default function MainWindow() {
  const [version, setVersion] = useState<string>();
  const updater = useUpdater();
  const [view, setView] = useState<View>("capture");
  const [doc, setDoc] = useState<EditorDoc | null>(null);
  const [settings, setSettings] = useState<SettingsView>();
  const [galleryKey, setGalleryKey] = useState(0);
  const [toast, setToast] = useState<string>();
  const toastTimer = useRef<number>(undefined);

  const notify = useCallback((message: string) => {
    setToast(message);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(undefined), 3000);
  }, []);

  const refreshGallery = useCallback(() => setGalleryKey((n) => n + 1), []);

  const openSnip = useCallback(
    async (path: string) => {
      try {
        setDoc({ path, png: await api.readSnip(path) });
      } catch (e) {
        notify(errorMessage(e));
      }
    },
    [notify],
  );

  useEffect(() => {
    getVersion()
      .then(setVersion)
      .catch(() => setVersion(undefined));
    api
      .getSettings()
      .then(setSettings)
      .catch((e) => notify(errorMessage(e)));
  }, [notify]);

  useEffect(() => {
    const subscriptions = [
      listen<{ path: string }>(
        EDITOR_OPEN_EVENT,
        (e) => void openSnip(e.payload.path),
      ),
      listen<CaptureSaved>(CAPTURE_SAVED_EVENT, (e) => {
        refreshGallery();
        if (e.payload.copied) {
          notify("Copied to clipboard and saved to Pictures\\Snipit");
        }
      }),
      listen<string>(ERROR_EVENT, (e) => notify(e.payload)),
    ];
    return () => {
      for (const sub of subscriptions) void sub.then((off) => off());
    };
  }, [notify, openSnip, refreshGallery]);

  // Ctrl+V outside the editor annotates the clipboard image.
  useEffect(() => {
    if (doc) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "v") {
        e.preventDefault();
        annotateClipboard().catch((err) => notify(errorMessage(err)));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [doc, notify]);

  const regionKey = settings?.settings.shortcuts.captureRegion;
  const reservedByWindows =
    !!settings?.printscreenReservedByWindows &&
    !!regionKey?.includes("PrintScreen");
  const regionKeyFailed = !!settings?.shortcutErrors.captureRegion;

  return (
    <main className="flex h-full flex-col">
      <UpdateBanner
        state={updater.state}
        onInstall={updater.install}
        onDismiss={updater.dismiss}
      />
      {doc ? (
        <Editor
          doc={doc}
          onClose={() => setDoc(null)}
          onSaved={refreshGallery}
          notify={notify}
        />
      ) : (
        <>
          <header className="flex items-center gap-3 border-b border-zinc-200 px-6 py-3 dark:border-zinc-800">
            <img src={logo} alt="" className="size-8" />
            <h1 className="mr-4 text-lg leading-tight font-semibold">Snipit</h1>
            <nav className="flex gap-1">
              {NAV.map((item) => (
                <button
                  key={item.view}
                  type="button"
                  onClick={() => setView(item.view)}
                  className={`rounded-lg px-3 py-1.5 text-sm ${
                    view === item.view
                      ? "bg-zinc-200/70 font-medium dark:bg-zinc-800"
                      : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-900"
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </nav>
          </header>

          <section className="flex-1 overflow-auto px-6 py-6">
            {view === "capture" && (
              <>
                {(reservedByWindows || regionKeyFailed) && (
                  <div className="mb-6 flex flex-wrap items-center gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
                    <p className="flex-1">
                      {reservedByWindows
                        ? "Windows is using the Print Screen key for Snipping Tool. Turn off “Use the Print screen key to open screen capture” to capture with PrtSc."
                        : "Snipit couldn't register its capture shortcut; another app is probably using it. Pick a different key in Settings, or capture from here or the tray menu."}
                    </p>
                    <button
                      type="button"
                      onClick={() =>
                        reservedByWindows
                          ? void api.openKeyboardSettings()
                          : setView("settings")
                      }
                      className="rounded-md bg-amber-900 px-3 py-1.5 font-medium text-white hover:bg-amber-800 dark:bg-amber-300 dark:text-amber-950 dark:hover:bg-amber-200"
                    >
                      {reservedByWindows
                        ? "Open keyboard settings"
                        : "Change shortcut"}
                    </button>
                  </div>
                )}

                <h2 className="mb-4 text-sm font-medium text-zinc-500 uppercase dark:text-zinc-400">
                  New capture
                </h2>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  {captureModes.map((mode) => {
                    const accel = settings?.settings.shortcuts[mode.shortcut];
                    return (
                      <button
                        key={mode.name}
                        type="button"
                        onClick={() =>
                          mode.run().catch((e) => notify(errorMessage(e)))
                        }
                        className="rounded-xl border border-zinc-200 bg-white p-5 text-left shadow-sm transition hover:border-brand-500 hover:shadow-md focus-visible:outline-2 focus-visible:outline-brand-500 dark:border-zinc-800 dark:bg-zinc-900"
                      >
                        <span className="block font-medium">{mode.name}</span>
                        <span className="mt-1 block text-sm text-zinc-500 dark:text-zinc-400">
                          {mode.hint}
                        </span>
                        {accel && (
                          <span className="mt-3 block text-zinc-500">
                            <Keys accelerator={accel} />
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>

                <div className="mt-8 mb-4 flex items-center justify-between">
                  <h2 className="text-sm font-medium text-zinc-500 uppercase dark:text-zinc-400">
                    Recent snips
                  </h2>
                  <button
                    type="button"
                    onClick={() => setView("gallery")}
                    className="text-sm text-brand-600 hover:underline dark:text-brand-500"
                  >
                    View gallery
                  </button>
                </div>
                <Gallery
                  refreshKey={galleryKey}
                  onOpen={(snip) => void openSnip(snip.path)}
                  notify={notify}
                  limit={4}
                />
              </>
            )}

            {view === "gallery" && (
              <Gallery
                refreshKey={galleryKey}
                onOpen={(snip) => void openSnip(snip.path)}
                notify={notify}
              />
            )}

            {view === "settings" && (
              <Settings
                view={settings}
                onChange={setSettings}
                notify={notify}
              />
            )}
          </section>

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
        </>
      )}

      {toast && (
        <div
          role="status"
          className="pointer-events-none fixed inset-x-0 bottom-14 flex justify-center"
        >
          <div className="rounded-lg bg-zinc-900/90 px-4 py-2 text-sm text-white shadow-lg dark:bg-zinc-100/95 dark:text-zinc-900">
            {toast}
          </div>
        </div>
      )}
    </main>
  );
}
