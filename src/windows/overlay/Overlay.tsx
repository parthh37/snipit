import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { listen } from "@tauri-apps/api/event";
import { PhysicalPosition } from "@tauri-apps/api/dpi";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  OVERLAY_START_EVENT,
  cancelCapture,
  finishCapture,
  getOverlayFrame,
  getOverlayInfo,
  type OverlayInfo,
} from "../../lib/capture";
import { ACCENT, OverlayController, type OverlayUiState } from "./controller";

/** How the frame looks outside the selection: mostly grey and darker. */
const WASHED_OUT = "grayscale(0.85) brightness(0.5)";

const IDLE: OverlayUiState = {
  active: false,
  selecting: false,
  cursorTopRight: false,
  magnifier: true,
  help: false,
};

/**
 * Full-screen capture overlay for one monitor. The window is built and loaded ahead of time and
 * sits hidden until a capture hands it a monitor; then it draws the frozen frame and shows
 * itself. Each window serves a single capture.
 */
export default function Overlay() {
  const frameRef = useRef<HTMLCanvasElement>(null);
  const uiRef = useRef<HTMLCanvasElement>(null);
  const loupeRef = useRef<HTMLCanvasElement>(null);
  const hLineRef = useRef<HTMLDivElement>(null);
  const vLineRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<OverlayController>(undefined);
  const [ui, setUi] = useState<OverlayUiState>(IDLE);
  const [scrolling, setScrolling] = useState(false);

  useEffect(() => {
    let controller: OverlayController | undefined;
    let started = false;
    let disposed = false;
    const canvas = uiRef.current!;
    const forward = {
      down: (e: PointerEvent) => controller?.pointerDown(e),
      move: (e: PointerEvent) => controller?.pointerMove(e),
      up: (e: PointerEvent) => controller?.pointerUp(e),
      leave: (e: PointerEvent) => controller?.pointerLeave(e),
      keyDown: (e: KeyboardEvent) => controller?.keyDown(e),
      keyUp: (e: KeyboardEvent) => controller?.keyUp(e),
      menu: (e: MouseEvent) => e.preventDefault(),
    };

    const run = async (info: OverlayInfo) => {
      const buffer = await getOverlayFrame();
      if (disposed) return;
      setScrolling(info.mode === "scrolling");

      // The untouched frame, read back inside the selection and by the loupe.
      const pixels = new Uint8ClampedArray(buffer);
      const color = document.createElement("canvas");
      color.width = info.width;
      color.height = info.height;
      color
        .getContext("2d")!
        .putImageData(new ImageData(pixels, info.width, info.height), 0, 0);

      // What shows everywhere else: the same frame, washed out.
      const frame = frameRef.current!;
      frame.width = info.width;
      frame.height = info.height;
      const ctx = frame.getContext("2d")!;
      ctx.filter = WASHED_OUT;
      ctx.drawImage(color, 0, 0);

      const win = getCurrentWindow();
      controller = new OverlayController(
        canvas,
        color,
        { h: hLineRef.current!, v: vLineRef.current! },
        loupeRef.current!,
        info,
        pixels,
        {
          finish: (rect) => void finishCapture(rect),
          cancel: () => void cancelCapture(),
          moveCursor: (p) =>
            void win.setCursorPosition(new PhysicalPosition(p.x, p.y)),
          state: setUi,
        },
      );
      controllerRef.current = controller;

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

    canvas.addEventListener("pointerdown", forward.down);
    canvas.addEventListener("pointermove", forward.move);
    canvas.addEventListener("pointerup", forward.up);
    canvas.addEventListener("pointerleave", forward.leave);
    canvas.addEventListener("contextmenu", forward.menu);
    window.addEventListener("keydown", forward.keyDown);
    window.addEventListener("keyup", forward.keyUp);
    return () => {
      disposed = true;
      void unlisten.then((off) => off());
      controller?.dispose();
      canvas.removeEventListener("pointerdown", forward.down);
      canvas.removeEventListener("pointermove", forward.move);
      canvas.removeEventListener("pointerup", forward.up);
      canvas.removeEventListener("pointerleave", forward.leave);
      canvas.removeEventListener("contextmenu", forward.menu);
      window.removeEventListener("keydown", forward.keyDown);
      window.removeEventListener("keyup", forward.keyUp);
    };
  }, []);

  const showChrome = ui.active && !ui.selecting;

  return (
    <div
      className="fixed inset-0 cursor-none overflow-hidden bg-black"
      onContextMenu={(e) => e.preventDefault()}
    >
      <canvas ref={frameRef} className="absolute inset-0 size-full" />
      <canvas ref={uiRef} className="absolute inset-0 size-full" />

      {/* Full-length crosshair through the cursor pixel. */}
      <div
        ref={hLineRef}
        className="pointer-events-none invisible absolute top-0 left-0 w-full will-change-transform"
        style={{ background: ACCENT }}
      />
      <div
        ref={vLineRef}
        className="pointer-events-none invisible absolute top-0 left-0 h-full will-change-transform"
        style={{ background: ACCENT }}
      />

      <canvas
        ref={loupeRef}
        className="pointer-events-none absolute top-0 left-0 opacity-0 shadow-xl shadow-black/40 transition-opacity duration-150 will-change-transform"
      />

      {showChrome &&
        (scrolling ? (
          <div className="pointer-events-none absolute top-6 left-1/2 -translate-x-1/2 rounded-full bg-zinc-950/85 px-4 py-2 text-sm text-white shadow-lg">
            Scrolling capture: click the window or drag the part that scrolls ·{" "}
            <Key>Esc</Key> cancel
          </div>
        ) : (
          <ChromeButton
            className="top-7 left-1/2 -translate-x-1/2 gap-2 rounded-full px-4 py-2 text-sm font-medium"
            title="Capture this whole screen (F)"
            onClick={() => controllerRef.current?.captureMonitor()}
          >
            <FullscreenIcon />
            Full screen
            <Key>F</Key>
          </ChromeButton>
        ))}

      {ui.active && !scrolling && (
        <Help
          open={ui.help}
          left={ui.cursorTopRight}
          magnifier={ui.magnifier}
          onToggle={() => controllerRef.current?.toggleHelp()}
        />
      )}
    </div>
  );
}

/** Help in a corner: "F1" when folded, the selector's keys when open. */
function Help({
  open,
  left,
  magnifier,
  onToggle,
}: {
  open: boolean;
  left: boolean;
  magnifier: boolean;
  onToggle: () => void;
}) {
  // Moves to the other corner when the cursor heads for it, so it never hides what you pick.
  const corner = left ? "left-3" : "right-3";
  if (!open) {
    return (
      <ChromeButton
        className={`top-3 ${corner} gap-2 rounded-lg px-3 py-1.5 text-xs`}
        title="Show keyboard shortcuts (F1)"
        onClick={onToggle}
      >
        <span className="font-semibold">Shortcuts</span>
        <Key>F1</Key>
      </ChromeButton>
    );
  }
  const rows: [string, string][] = [
    ["Click", "capture the highlighted window"],
    ["Drag", "select a region"],
    ["Space", "start a region at the crosshair"],
    ["Enter", "capture the selection"],
    ["Arrows", "nudge the crosshair (Shift: 10 px)"],
    ["Shift", "keep the region square"],
    ["M", magnifier ? "hide the magnifier" : "show the magnifier"],
    ["F", "capture the whole screen"],
    ["Esc", "cancel (or right-click)"],
    ["F1", "close this help"],
  ];
  return (
    <div
      className={`absolute top-3 ${corner} w-72 cursor-default rounded-xl border border-white/10 bg-zinc-950/88 p-3 text-white shadow-2xl`}
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-semibold">Keyboard shortcuts</span>
        <button
          type="button"
          tabIndex={-1}
          onMouseDown={(e) => e.preventDefault()}
          onClick={onToggle}
          className="rounded px-1.5 text-xs text-zinc-400 hover:bg-white/10 hover:text-white"
        >
          Close
        </button>
      </div>
      <dl className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1.5 text-xs">
        {rows.map(([key, what]) => (
          <div key={key} className="contents">
            <dt className="justify-self-end">
              <Key>{key}</Key>
            </dt>
            <dd className="text-zinc-300">{what}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function ChromeButton({
  className,
  title,
  onClick,
  children,
}: {
  className: string;
  title: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      // Never takes focus, so Space and Enter keep driving the selector.
      tabIndex={-1}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={`absolute flex cursor-pointer items-center border border-white/10 bg-zinc-950/80 text-white shadow-lg transition hover:bg-zinc-900 ${className}`}
    >
      {children}
    </button>
  );
}

function Key({ children }: { children: string }) {
  return (
    <kbd className="rounded border border-white/25 px-1.5 py-0.5 font-sans text-[11px] leading-none">
      {children}
    </kbd>
  );
}

function FullscreenIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width={16}
      height={16}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="3" y="5" width="18" height="13" rx="2" />
      <path d="M8 9h-1.5v2M16 9h1.5v2M8 14.5h-1.5V13M16 14.5h1.5V13" />
    </svg>
  );
}
