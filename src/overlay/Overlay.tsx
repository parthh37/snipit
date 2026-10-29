import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { api, type AfterCapture } from "../lib/api";

interface Point {
  x: number;
  y: number;
}

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const LOUPE_SIZE = 120;
const LOUPE_ZOOM = 6;

function normalise(a: Point, b: Point): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y),
  };
}

/**
 * Full-monitor window showing a frozen screenshot. Drag to select a region, then copy it
 * straight to the clipboard or open it in the editor.
 */
export default function Overlay() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const loupeRef = useRef<HTMLCanvasElement>(null);
  const [active, setActive] = useState(false);
  const [start, setStart] = useState<Point>();
  const [rect, setRect] = useState<Rect>();
  const [dragging, setDragging] = useState(false);
  const [cursor, setCursor] = useState<Point>();
  const [afterCapture, setAfterCapture] = useState<AfterCapture>("edit");
  const [frameWidth, setFrameWidth] = useState(0);

  const reset = useCallback(() => {
    setActive(false);
    setStart(undefined);
    setRect(undefined);
    setDragging(false);
    setCursor(undefined);
  }, []);

  const load = useCallback(async () => {
    const [buffer, view] = await Promise.all([
      api.getFrozen(),
      api.getSettings(),
    ]);
    const header = new DataView(buffer, 0, 8);
    const width = header.getUint32(0, true);
    const height = header.getUint32(4, true);
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = width;
    canvas.height = height;
    const pixels = new Uint8ClampedArray(buffer, 8, width * height * 4);
    canvas.getContext("2d")?.putImageData(new ImageData(pixels, width), 0, 0);
    setFrameWidth(width);
    setAfterCapture(view.settings.afterCapture);
    setActive(true);
    await api.overlayReady();
  }, []);

  useEffect(() => {
    document.documentElement.classList.add("overlay");
    const unlisten = listen("overlay:capture", () => {
      reset();
      load().catch((e) => {
        console.error(e);
        void api.finishRegion(null, null);
      });
    });
    return () => {
      void unlisten.then((off) => off());
    };
  }, [load, reset]);

  const finish = useCallback(
    (action: AfterCapture | null) => {
      let region = null;
      if (action && rect && frameWidth) {
        // CSS pixels → physical screenshot pixels.
        const scale = frameWidth / window.innerWidth;
        region = {
          x: Math.round(rect.x * scale),
          y: Math.round(rect.y * scale),
          width: Math.max(1, Math.round(rect.width * scale)),
          height: Math.max(1, Math.round(rect.height * scale)),
        };
      }
      reset();
      void api.finishRegion(region, region ? action : null);
    },
    [frameWidth, rect, reset],
  );

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") finish(null);
      else if (!rect || dragging) return;
      else if (e.key === "Enter") finish(afterCapture);
      else if (e.key.toLowerCase() === "c") finish("copy");
      else if (e.key.toLowerCase() === "e") finish("edit");
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, afterCapture, dragging, finish, rect]);

  // Magnifier loupe around the cursor while choosing a region.
  useEffect(() => {
    const loupe = loupeRef.current;
    const source = canvasRef.current;
    const ctx = loupe?.getContext("2d");
    if (!ctx || !source || !cursor || !loupe) return;
    const scale = source.width / window.innerWidth;
    const span = LOUPE_SIZE / LOUPE_ZOOM;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, LOUPE_SIZE, LOUPE_SIZE);
    ctx.drawImage(
      source,
      cursor.x * scale - span / 2,
      cursor.y * scale - span / 2,
      span,
      span,
      0,
      0,
      LOUPE_SIZE,
      LOUPE_SIZE,
    );
    ctx.strokeStyle = "rgba(108,108,255,0.9)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(LOUPE_SIZE / 2, 0);
    ctx.lineTo(LOUPE_SIZE / 2, LOUPE_SIZE);
    ctx.moveTo(0, LOUPE_SIZE / 2);
    ctx.lineTo(LOUPE_SIZE, LOUPE_SIZE / 2);
    ctx.stroke();
  }, [cursor]);

  const point = (e: React.PointerEvent): Point => ({
    x: e.clientX,
    y: e.clientY,
  });

  const onPointerDown = (e: React.PointerEvent) => {
    if (!active) return;
    if (e.button === 2) {
      finish(null);
      return;
    }
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setStart(point(e));
    setRect(undefined);
    setDragging(true);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!active) return;
    setCursor(point(e));
    if (dragging && start) setRect(normalise(start, point(e)));
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (!dragging) return;
    setDragging(false);
    const r = start ? normalise(start, point(e)) : undefined;
    // A click without dragging selects the whole monitor.
    if (!r || r.width < 4 || r.height < 4) {
      setRect({
        x: 0,
        y: 0,
        width: window.innerWidth,
        height: window.innerHeight,
      });
    } else {
      setRect(r);
    }
  };

  // Physical screenshot pixels per CSS pixel.
  const scale = frameWidth ? frameWidth / window.innerWidth : 1;
  const showLoupe = active && cursor && (dragging || !rect);
  const toolbarBelow = rect && rect.y + rect.height + 52 < window.innerHeight;

  return (
    <div
      className="fixed inset-0 cursor-crosshair overflow-hidden select-none"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onContextMenu={(e) => e.preventDefault()}
    >
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />

      {active && !rect && <div className="absolute inset-0 bg-black/40" />}

      {active && rect && (
        <div
          className="absolute border border-brand-500"
          style={{
            left: rect.x,
            top: rect.y,
            width: rect.width,
            height: rect.height,
            boxShadow: "0 0 0 100vmax rgba(0,0,0,0.4)",
          }}
        >
          <span className="absolute -top-7 left-0 rounded bg-zinc-900/85 px-2 py-0.5 text-xs whitespace-nowrap text-white tabular-nums">
            {Math.round(rect.width * scale)} × {Math.round(rect.height * scale)}
          </span>
        </div>
      )}

      {active && rect && !dragging && (
        <div
          className="absolute flex gap-1 rounded-lg bg-zinc-900/95 p-1 text-sm text-white shadow-lg"
          style={{
            left: Math.min(rect.x, window.innerWidth - 300),
            top: toolbarBelow ? rect.y + rect.height + 8 : rect.y + 8,
          }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <OverlayButton onClick={() => finish("copy")} hint="C">
            Copy
          </OverlayButton>
          <OverlayButton onClick={() => finish("edit")} hint="E">
            Annotate
          </OverlayButton>
          <OverlayButton onClick={() => finish(null)} hint="Esc">
            Cancel
          </OverlayButton>
        </div>
      )}

      {showLoupe && (
        <div
          className="pointer-events-none absolute overflow-hidden rounded-md border-2 border-white shadow-lg"
          style={{
            left: Math.min(cursor.x + 20, window.innerWidth - LOUPE_SIZE - 24),
            top: Math.min(cursor.y + 20, window.innerHeight - LOUPE_SIZE - 48),
          }}
        >
          <canvas ref={loupeRef} width={LOUPE_SIZE} height={LOUPE_SIZE} />
          <div className="bg-zinc-900/90 px-1 text-center text-[11px] text-white tabular-nums">
            {Math.round(cursor.x * scale)}, {Math.round(cursor.y * scale)}
          </div>
        </div>
      )}
    </div>
  );
}

function OverlayButton({
  children,
  hint,
  onClick,
}: {
  children: React.ReactNode;
  hint: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-md px-3 py-1.5 hover:bg-white/15"
    >
      {children}
      <kbd className="ml-2 text-xs text-zinc-400">{hint}</kbd>
    </button>
  );
}
