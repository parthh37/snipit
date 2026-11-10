import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { SCROLL_PROGRESS_EVENT, type ScrollProgress } from "../../lib/capture";

const number = new Intl.NumberFormat();

/**
 * The pill at the top of the screen while a scrolling capture runs. The window is click-through
 * and excluded from screen capture (see `capture/scroll.rs`), so it only informs.
 */
export default function ScrollStatus() {
  const [progress, setProgress] = useState<ScrollProgress>({
    phase: "starting",
    height: 0,
    mouseStops: false,
  });

  useEffect(() => {
    const off = listen<ScrollProgress>(SCROLL_PROGRESS_EVENT, (e) =>
      setProgress(e.payload),
    );
    return () => void off.then((f) => f());
  }, []);

  const status =
    progress.phase === "starting"
      ? "Getting ready…"
      : progress.phase === "top"
        ? "Scrolling to the top…"
        : `Capturing · ${number.format(progress.height)} px`;

  return (
    <div className="flex h-full w-full items-center justify-center">
      <div className="flex h-full items-center gap-3 rounded-full bg-zinc-950/90 px-4 text-sm whitespace-nowrap text-white shadow-lg">
        <span className="relative flex size-2.5">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-brand-500 opacity-75" />
          <span className="relative inline-flex size-2.5 rounded-full bg-brand-500" />
        </span>
        <span className="font-medium tabular-nums">{status}</span>
        <span className="text-zinc-400">
          <kbd className="rounded border border-white/25 px-1.5 py-0.5 font-sans text-xs text-white">
            Esc
          </kbd>{" "}
          {progress.mouseStops ? "or move the mouse to finish" : "to finish"}
        </span>
      </div>
    </div>
  );
}
