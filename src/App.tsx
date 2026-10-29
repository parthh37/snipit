import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import logo from "../assets/icon.svg";

const captureModes = [
  { name: "Region", hint: "Drag to select any area" },
  { name: "Window", hint: "Click a window to capture it" },
  { name: "Full screen", hint: "Capture a whole monitor" },
];

function App() {
  const [version, setVersion] = useState<string>();

  useEffect(() => {
    getVersion()
      .then(setVersion)
      .catch(() => setVersion(undefined));
  }, []);

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

      <section className="flex-1 overflow-auto px-6 py-8">
        <h2 className="mb-4 text-sm font-medium text-zinc-500 uppercase dark:text-zinc-400">
          New capture
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {captureModes.map((mode) => (
            <button
              key={mode.name}
              type="button"
              disabled
              className="rounded-xl border border-zinc-200 bg-white p-5 text-left shadow-sm transition disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-800 dark:bg-zinc-900"
            >
              <span className="block font-medium">{mode.name}</span>
              <span className="mt-1 block text-sm text-zinc-500 dark:text-zinc-400">
                {mode.hint}
              </span>
            </button>
          ))}
        </div>
        <p className="mt-6 text-sm text-zinc-500 dark:text-zinc-400">
          Capture is coming in the next milestone. Snipit keeps running in the
          system tray when you close this window.
        </p>
      </section>

      <footer className="border-t border-zinc-200 px-6 py-3 text-xs text-zinc-400 dark:border-zinc-800 dark:text-zinc-500">
        {version ? `v${version}` : " "}
      </footer>
    </main>
  );
}

export default App;
