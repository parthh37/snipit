import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  OVERLAY_START_EVENT,
  cancelCapture,
  finishCapture,
  getOverlayFrame,
  getOverlayInfo,
  type OverlayInfo,
} from "../../lib/capture";
import { OverlayController } from "./controller";

/**
 * Full-screen capture overlay for one monitor. The window is built and loaded ahead of time and
 * sits hidden until a capture hands it a monitor; then it draws the frozen frame and shows
 * itself. Each window serves a single capture.
 */
export default function Overlay() {
  const frameRef = useRef<HTMLCanvasElement>(null);
  const uiRef = useRef<HTMLCanvasElement>(null);
  const crosshairRef = useRef<HTMLCanvasElement>(null);
  const [showHint, setShowHint] = useState(true);
  const [scrolling, setScrolling] = useState(false);

  useEffect(() => {
    let controller: OverlayController | undefined;
    let started = false;
    let disposed = false;
    const ui = uiRef.current!;
    const forward = {
      down: (e: PointerEvent) => {
        setShowHint(false);
        controller?.pointerDown(e);
      },
      move: (e: PointerEvent) => controller?.pointerMove(e),
      up: (e: PointerEvent) => controller?.pointerUp(e),
      leave: () => controller?.pointerLeave(),
      key: (e: KeyboardEvent) => controller?.keyDown(e),
      menu: (e: MouseEvent) => e.preventDefault(),
    };

    const run = async (info: OverlayInfo) => {
      const buffer = await getOverlayFrame();
      if (disposed) return;
      setScrolling(info.mode === "scrolling");

      const pixels = new Uint8ClampedArray(buffer);
      const frame = frameRef.current!;
      frame.width = info.width;
      frame.height = info.height;
      frame
        .getContext("2d")!
        .putImageData(new ImageData(pixels, info.width, info.height), 0, 0);

      controller = new OverlayController(
        ui,
        crosshairRef.current!,
        info,
        pixels,
        {
          finish: (rect) => void finishCapture(rect),
          cancel: () => void cancelCapture(),
        },
      );

      const win = getCurrentWindow();
      await win.show();
      // Only the monitor with the cursor takes focus, so Esc reaches the right overlay.
      if (info.cursor) await win.setFocus();
    };

    /** Starts once this window belongs to a capture; until then it stays hidden. */
    const start = async () => {
      if (started || disposed) return;
      let info: OverlayInfo;
      try {
        info = await getOverlayInfo();
      } catch {
        return; // Still a spare: no capture has claimed this window yet.
      }
      if (started || disposed) return;
      started = true;
      await run(info).catch(() => void cancelCapture());
    };

    // Listen before asking, so a capture claiming this window in between is never missed.
    const unlisten = listen(OVERLAY_START_EVENT, () => void start());
    void unlisten.then(() => start());

    ui.addEventListener("pointerdown", forward.down);
    ui.addEventListener("pointermove", forward.move);
    ui.addEventListener("pointerup", forward.up);
    ui.addEventListener("pointerleave", forward.leave);
    ui.addEventListener("contextmenu", forward.menu);
    window.addEventListener("keydown", forward.key);
    return () => {
      disposed = true;
      void unlisten.then((off) => off());
      controller?.dispose();
      ui.removeEventListener("pointerdown", forward.down);
      ui.removeEventListener("pointermove", forward.move);
      ui.removeEventListener("pointerup", forward.up);
      ui.removeEventListener("pointerleave", forward.leave);
      ui.removeEventListener("contextmenu", forward.menu);
      window.removeEventListener("keydown", forward.key);
    };
  }, []);

  return (
    <div className="fixed inset-0 cursor-none overflow-hidden bg-black">
      <canvas ref={frameRef} className="absolute inset-0 size-full" />
      <canvas ref={uiRef} className="absolute inset-0 size-full" />
      {/* Hairline cursor; difference blending keeps it visible on light and dark pixels. */}
      <canvas
        ref={crosshairRef}
        className="pointer-events-none invisible absolute top-0 left-0 mix-blend-difference will-change-transform"
      />
      {showHint && (
        <div className="pointer-events-none absolute top-6 left-1/2 -translate-x-1/2 rounded-full bg-zinc-950/85 px-4 py-2 text-sm text-white shadow-lg">
          {scrolling ? (
            <>
              Scrolling capture: click the window or drag the part that scrolls
              · <Key>Esc</Key> cancel
            </>
          ) : (
            <>
              Drag to select · Click a window · <Key>F</Key> full screen ·{" "}
              <Key>Esc</Key> cancel
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Key({ children }: { children: string }) {
  return (
    <kbd className="rounded border border-white/25 px-1.5 py-0.5 font-sans text-xs">
      {children}
    </kbd>
  );
}
