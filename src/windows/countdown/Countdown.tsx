import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";

/** Seconds left; sent by `capture/countdown.rs`. */
const TICK_EVENT = "countdown:tick";

/**
 * The pill in the middle of the screen before a timed capture. Like the scrolling capture's
 * status, the window is click-through and kept out of screenshots, so it only informs.
 */
export default function Countdown() {
  const [seconds, setSeconds] = useState<number>();

  useEffect(() => {
    const off = listen<number>(TICK_EVENT, (e) => setSeconds(e.payload));
    return () => void off.then((f) => f());
  }, []);

  return (
    <div className="flex h-full w-full items-center justify-center">
      <div className="flex h-full items-center gap-3 rounded-full bg-zinc-950/90 pr-5 pl-2 text-sm whitespace-nowrap text-white shadow-lg">
        <span className="flex size-10 items-center justify-center rounded-full bg-brand-600 text-lg font-semibold tabular-nums">
          {seconds ?? ""}
        </span>
        <span className="font-medium">Capturing soon…</span>
        <span className="text-zinc-400">
          <kbd className="rounded border border-white/25 px-1.5 py-0.5 font-sans text-xs text-white">
            Esc
          </kbd>{" "}
          to cancel
        </span>
      </div>
    </div>
  );
}
