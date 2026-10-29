import { useCallback, useEffect, useRef, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { listen } from "@tauri-apps/api/event";
import logo from "../assets/icon.svg";
import Editor, { type EditorDoc } from "./editor/Editor";
import Gallery from "./gallery/Gallery";
import {
  api,
  errorMessage,
  type SettingsView,
  type ShortcutAction,
} from "./lib/api";
import Settings, { Keys } from "./settings/Settings";

type View = "capture" | "gallery" | "settings";

const NAV: { view: View; label: string }[] = [
  { view: "capture", label: "Capture" },
  { view: "gallery", label: "Gallery" },
  { view: "settings", label: "Settings" },
];

const captureModes: {
  name: string;
  hint: string;
  shortcut?: ShortcutAction;
  run?: () => Promise<void>;
}[] = [
  {
    name: "Region",
    hint: "Drag to select any area",
    shortcut: "captureRegion",
    run: () => api.startCapture("region"),
  },
  {
    name: "Full screen",
    hint: "Capture the monitor under the cursor",
    shortcut: "captureFullscreen",
    run: () => api.startCapture("fullscreen"),
  },
  {
    name: "From clipboard",
    hint: "Annotate a copied image (Ctrl+V)",
    shortcut: "annotateClipboard",
    run: () => api.annotateClipboard(),
  },
  { name: "Window", hint: "Coming soon" },
];

function App() {
  const [version, setVersion] = useState<string>();
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
        "editor:open",
        (e) => void openSnip(e.payload.path),
      ),
      listen("gallery:changed", refreshGallery),
      listen<string>("app:error", (e) => notify(e.payload)),
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
        api.annotateClipboard().catch((err) => notify(errorMessage(err)));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [doc, notify]);

  return (
    <main className="flex h-full flex-col">
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
                <h2 className="mb-4 text-sm font-medium text-zinc-500 uppercase dark:text-zinc-400">
                  New capture
                </h2>
                <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                  {captureModes.map((mode) => {
                    const accel =
                      mode.shortcut &&
                      settings?.settings.shortcuts[mode.shortcut];
                    return (
                      <button
                        key={mode.name}
                        type="button"
                        disabled={!mode.run}
                        onClick={() =>
                          mode.run?.().catch((e) => notify(errorMessage(e)))
                        }
                        className="rounded-xl border border-zinc-200 bg-white p-5 text-left shadow-sm transition hover:border-brand-500 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:border-zinc-200 dark:border-zinc-800 dark:bg-zinc-900"
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

          <footer className="border-t border-zinc-200 px-6 py-2 text-xs text-zinc-400 dark:border-zinc-800 dark:text-zinc-500">
            {version ? `v${version}` : " "} · Closing this window keeps Snipit
            running in the tray.
          </footer>
        </>
      )}

      {toast && (
        <div className="pointer-events-none fixed inset-x-0 bottom-10 flex justify-center">
          <div className="rounded-lg bg-zinc-900/90 px-4 py-2 text-sm text-white shadow-lg dark:bg-zinc-100/95 dark:text-zinc-900">
            {toast}
          </div>
        </div>
      )}
    </main>
  );
}

export default App;
