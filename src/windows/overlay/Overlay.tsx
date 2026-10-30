import { useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  cancelCapture,
  finishCapture,
  getOverlayFrame,
  getOverlayInfo,
} from "../../lib/capture";
import { OverlayController } from "./controller";

/** Full-screen capture overlay for one monitor. */
export default function Overlay() {
  const frameRef = useRef<HTMLCanvasElement>(null);
  const uiRef = useRef<HTMLCanvasElement>(null);
  const [showHint, setShowHint] = useState(true);

  useEffect(() => {
    let controller: OverlayController | undefined;
    let disposed = false;
    const ui = uiRef.current!;
    const forward = {
      down: (e: PointerEvent) => {
        setShowHint(false);
        controller?.pointerDown(e);
      },
      move: (e: PointerEvent) => controller?.pointerMove(e),
      up: (e: PointerEvent) => controller?.pointerUp(e),
      key: (e: KeyboardEvent) => controller?.keyDown(e),
      menu: (e: MouseEvent) => e.preventDefault(),
    };

    (async () => {
      const [info, buffer] = await Promise.all([
        getOverlayInfo(),
        getOverlayFrame(),
      ]);
      if (disposed) return;
      const pixels = new Uint8ClampedArray(buffer);

      const frame = frameRef.current!;
      frame.width = info.width;
      frame.height = info.height;
      frame
        .getContext("2d")!
        .putImageData(new ImageData(pixels, info.width, info.height), 0, 0);

      controller = new OverlayController(ui, info, pixels, {
        finish: (rect) => void finishCapture(rect),
        cancel: () => void cancelCapture(),
      });

      const win = getCurrentWindow();
      await win.show();
      // Only the monitor with the cursor takes focus, so Esc reaches the right overlay.
      if (info.cursor) await win.setFocus();
    })().catch(() => void cancelCapture());

    ui.addEventListener("pointerdown", forward.down);
    ui.addEventListener("pointermove", forward.move);
    ui.addEventListener("pointerup", forward.up);
    ui.addEventListener("contextmenu", forward.menu);
    window.addEventListener("keydown", forward.key);
    return () => {
      disposed = true;
      controller?.dispose();
      ui.removeEventListener("pointerdown", forward.down);
      ui.removeEventListener("pointermove", forward.move);
      ui.removeEventListener("pointerup", forward.up);
      ui.removeEventListener("contextmenu", forward.menu);
      window.removeEventListener("keydown", forward.key);
    };
  }, []);

  return (
    <div className="fixed inset-0 cursor-crosshair overflow-hidden bg-black">
      <canvas ref={frameRef} className="absolute inset-0 size-full" />
      <canvas ref={uiRef} className="absolute inset-0 size-full" />
      {showHint && (
        <div className="pointer-events-none absolute top-6 left-1/2 -translate-x-1/2 rounded-full bg-zinc-950/85 px-4 py-2 text-sm text-white shadow-lg">
          Drag to select · Click a window · <Key>F</Key> full screen ·{" "}
          <Key>Esc</Key> cancel
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
