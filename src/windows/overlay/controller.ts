import type { OverlayInfo, Point, Rect } from "../../lib/capture";
import { clamp, contains, rectFromPoints, squareFrom } from "./geometry";

export const ACCENT = "#6c6cff";
/** CSS pixels the pointer must move before a press becomes a drag. */
const DRAG_THRESHOLD = 4;
/** Pixels shown across the loupe; odd so the cursor pixel sits in the middle. */
const LOUPE_PIXELS = 15;
const LOUPE_SIZE = 128;
const LOUPE_INFO = 40;
const LOUPE_OFFSET = 22;
/** How long the highlight takes to glide from one window to the next, ms. */
const GLIDE_MS = 140;
/** Faster than this (CSS px per ms) the loupe fades out while picking a window. */
const FAST_POINTER = 1.4;
/** Pause in pointer movement before a faded loupe comes back, ms. */
const LOUPE_RETURN_MS = 220;

export interface OverlayCallbacks {
  finish(rect: Rect): void;
  cancel(): void;
  /** Moves the real cursor, so the arrow keys can nudge it a pixel at a time. */
  moveCursor(p: Point): void;
  /** UI state the React layer shows around the canvas (help, full-screen button). */
  state(s: OverlayUiState): void;
}

export interface OverlayUiState {
  /** The pointer is on this monitor. */
  active: boolean;
  /** A region is being dragged out (by mouse or after Space). */
  selecting: boolean;
  /** The cursor is in the top-right corner, where the help sits. */
  cursorTopRight: boolean;
  magnifier: boolean;
  help: boolean;
}

/**
 * Draws the selection UI over a frozen monitor frame and turns pointer and keyboard input into
 * a capture rectangle. All coordinates are physical pixels local to the monitor; the canvases
 * match the frame 1:1 and CSS scales them to fill the window.
 *
 * Outside the selection the frame shows washed-out and dark (baked into the frame canvas by
 * the page); inside it the original pixels are drawn back from `color`, so the picked area is
 * the only part in full colour.
 */
export class OverlayController {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly loupeCtx: CanvasRenderingContext2D;
  private cursor: Point | null;
  private dragStart: Point | null = null;
  /** Space started a selection: it follows the pointer until a click or Enter. */
  private keyboardSelect = false;
  private selection: Rect | null = null;
  private square = false;
  private frame = 0;
  private crosshairScale = 0;

  /** What the highlight shows now, gliding towards the hovered window. */
  private shown: Rect | null = null;
  private glide: { from: Rect; to: Rect; start: number } | null = null;

  private magnifier = true;
  private help = false;
  private loupeHidden = false;
  private loupeTimer = 0;
  private lastMove: { x: number; y: number; t: number } | null = null;
  private lastState = "";

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly color: HTMLCanvasElement,
    private readonly crosshair: { h: HTMLElement; v: HTMLElement },
    private readonly loupe: HTMLCanvasElement,
    private readonly info: OverlayInfo,
    private readonly pixels: Uint8ClampedArray,
    private readonly callbacks: OverlayCallbacks,
  ) {
    canvas.width = info.width;
    canvas.height = info.height;
    this.ctx = canvas.getContext("2d")!;
    this.loupeCtx = loupe.getContext("2d")!;
    this.cursor = info.cursor;
    this.shown = this.cursor ? this.hoverRect() : null;
    this.moveCrosshair();
    this.render();
    this.emitState();
  }

  /** Physical pixels per CSS pixel; derived from the frame so mixed-DPI setups stay exact. */
  private get scale(): number {
    return this.info.width / this.canvas.clientWidth;
  }

  private get monitor(): Rect {
    return { x: 0, y: 0, width: this.info.width, height: this.info.height };
  }

  private get selecting(): boolean {
    return this.keyboardSelect || this.dragStart !== null;
  }

  private toLocal(e: { clientX: number; clientY: number }): Point {
    const box = this.canvas.getBoundingClientRect();
    return {
      x: clamp(
        Math.floor((e.clientX - box.left) * this.scale),
        0,
        this.info.width - 1,
      ),
      y: clamp(
        Math.floor((e.clientY - box.top) * this.scale),
        0,
        this.info.height - 1,
      ),
    };
  }

  /** The window under the cursor, or the whole monitor over the desktop. */
  private hoverRect(): Rect {
    const cursor = this.cursor;
    return (
      (cursor && this.info.windows.find((w) => contains(w, cursor))) ??
      this.monitor
    );
  }

  private regionTo(p: Point): Rect {
    const start = this.dragStart!;
    return this.square
      ? squareFrom(start, p, this.monitor)
      : rectFromPoints(start, p);
  }

  pointerDown = (e: PointerEvent) => {
    if (e.button === 2) {
      this.callbacks.cancel();
      return;
    }
    if (e.button !== 0) return;
    this.canvas.setPointerCapture(e.pointerId);
    this.cursor = this.toLocal(e);
    this.square = e.shiftKey;
    this.moveCrosshair();
    // A click while a Space selection is open finishes it on release.
    if (!this.keyboardSelect) this.dragStart = this.cursor;
    this.update();
  };

  /** The pointer went to another monitor's overlay, which draws its own crosshair. */
  pointerLeave = (e: PointerEvent) => {
    // Moving onto the overlay's own buttons is not leaving the monitor.
    if (this.selecting || e.relatedTarget) return;
    this.cursor = null;
    this.moveCrosshair();
    this.update();
  };

  pointerMove = (e: PointerEvent) => {
    this.cursor = this.toLocal(e);
    this.square = e.shiftKey;
    this.trackSpeed(e);
    this.moveCrosshair();
    this.extendSelection();
    this.update();
  };

  pointerUp = (e: PointerEvent) => {
    if (e.button !== 0 || !this.dragStart) return;
    const rect = this.selection ?? this.hoverRect();
    this.dragStart = null;
    this.keyboardSelect = false;
    this.selection = null;
    this.callbacks.finish(rect);
  };

  keyDown = (e: KeyboardEvent) => {
    const key = e.key;
    if (key === "Escape") {
      this.callbacks.cancel();
    } else if (key === "Enter") {
      // Nothing is highlighted here once the pointer moved to another monitor.
      if (e.repeat || (!this.selection && !this.cursor)) return;
      this.callbacks.finish(this.selection ?? this.hoverRect());
    } else if (key === " ") {
      e.preventDefault();
      if (e.repeat || this.selecting || !this.cursor) return;
      this.keyboardSelect = true;
      this.dragStart = this.cursor;
      this.selection = rectFromPoints(this.cursor, this.cursor);
      this.update();
    } else if (key.startsWith("Arrow")) {
      e.preventDefault();
      this.nudge(key, e.shiftKey ? 10 : 1);
    } else if (key === "Shift") {
      this.square = true;
      this.extendSelection();
      this.update();
    } else if (key === "f" || key === "F") {
      if (!this.selecting) this.callbacks.finish(this.monitor);
    } else if (key === "m" || key === "M") {
      this.toggleMagnifier();
    } else if (key === "F1") {
      e.preventDefault();
      this.toggleHelp();
    }
  };

  keyUp = (e: KeyboardEvent) => {
    if (e.key === "Shift") {
      this.square = false;
      this.extendSelection();
      this.update();
    }
  };

  toggleHelp = () => {
    this.help = !this.help;
    this.emitState();
  };

  toggleMagnifier = () => {
    this.magnifier = !this.magnifier;
    this.update();
  };

  /** Captures the whole monitor (the full-screen button). */
  captureMonitor = () => this.callbacks.finish(this.monitor);

  dispose() {
    cancelAnimationFrame(this.frame);
    window.clearTimeout(this.loupeTimer);
  }

  private nudge(key: string, step: number) {
    const c = this.cursor;
    if (!c) return;
    const dx = key === "ArrowLeft" ? -step : key === "ArrowRight" ? step : 0;
    const dy = key === "ArrowUp" ? -step : key === "ArrowDown" ? step : 0;
    this.cursor = {
      x: clamp(c.x + dx, 0, this.info.width - 1),
      y: clamp(c.y + dy, 0, this.info.height - 1),
    };
    this.callbacks.moveCursor(this.cursor);
    this.moveCrosshair();
    this.extendSelection();
    this.update();
  }

  private extendSelection() {
    const start = this.dragStart;
    const c = this.cursor;
    if (!start || !c) return;
    const threshold = DRAG_THRESHOLD * this.scale;
    const moved =
      Math.abs(c.x - start.x) >= threshold ||
      Math.abs(c.y - start.y) >= threshold;
    if (this.selection || moved || this.keyboardSelect) {
      this.selection = this.regionTo(c);
    }
  }

  /** Fades the loupe out while the pointer sweeps across the screen picking windows. */
  private trackSpeed(e: PointerEvent) {
    const now = e.timeStamp;
    const last = this.lastMove;
    this.lastMove = { x: e.clientX, y: e.clientY, t: now };
    if (!last || this.selecting) return;
    const dt = Math.max(1, now - last.t);
    const speed = Math.hypot(e.clientX - last.x, e.clientY - last.y) / dt;
    if (speed > FAST_POINTER) this.loupeHidden = true;
    window.clearTimeout(this.loupeTimer);
    this.loupeTimer = window.setTimeout(() => {
      this.loupeHidden = false;
      this.placeLoupe();
    }, LOUPE_RETURN_MS);
  }

  /**
   * Full-length hairlines through the cursor pixel, one physical pixel thick. They are their
   * own elements, moved right away on each event, so they track the pointer without waiting
   * for a full redraw.
   */
  private moveCrosshair() {
    const c = this.cursor;
    const { h, v } = this.crosshair;
    if (!c) {
      h.style.visibility = "hidden";
      v.style.visibility = "hidden";
      return;
    }
    const s = this.scale;
    if (s !== this.crosshairScale) {
      h.style.height = `${1 / s}px`;
      v.style.width = `${1 / s}px`;
      this.crosshairScale = s;
    }
    h.style.transform = `translateY(${c.y / s}px)`;
    v.style.transform = `translateX(${c.x / s}px)`;
    h.style.visibility = "visible";
    v.style.visibility = "visible";
  }

  private update() {
    this.emitState();
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame((t) => this.render(t));
  }

  private emitState() {
    const c = this.cursor;
    const s = this.scale || 1;
    const state: OverlayUiState = {
      active: c !== null,
      selecting: this.selecting,
      cursorTopRight:
        c !== null && c.y < 220 * s && c.x > this.info.width - 360 * s,
      magnifier: this.magnifier,
      help: this.help,
    };
    const key = JSON.stringify(state);
    if (key === this.lastState) return;
    this.lastState = key;
    this.callbacks.state(state);
  }

  /** The highlight to draw now, starting a glide when the hovered window changes. */
  private highlight(now: number): Rect | null {
    if (this.selection) {
      this.glide = null;
      this.shown = this.selection;
      return this.selection;
    }
    if (!this.cursor) return null;
    const target = this.hoverRect();
    if (!this.shown) this.shown = target;
    if (!sameRect(target, this.glide?.to ?? this.shown)) {
      this.glide = { from: this.shown, to: target, start: now };
    }
    if (this.glide) {
      const t = Math.min(1, (now - this.glide.start) / GLIDE_MS);
      this.shown = lerpRect(this.glide.from, this.glide.to, easeOut(t));
      if (t >= 1) this.glide = null;
    }
    return this.shown;
  }

  private render(now = performance.now()) {
    const { ctx } = this;
    ctx.clearRect(0, 0, this.info.width, this.info.height);
    const rect = this.highlight(now);
    if (rect) {
      this.drawHighlight(rect);
      this.drawSizeLabel(this.selection ?? this.hoverRect(), rect);
    }
    this.placeLoupe();
    if (this.glide) {
      this.frame = requestAnimationFrame((t) => this.render(t));
    }
  }

  private drawHighlight(r: Rect) {
    const { ctx } = this;
    const s = this.scale;
    const x = Math.round(r.x);
    const y = Math.round(r.y);
    const w = Math.max(1, Math.round(r.width));
    const h = Math.max(1, Math.round(r.height));
    // The original, full-colour pixels show through the washed-out frame.
    ctx.drawImage(this.color, x, y, w, h, x, y, w, h);

    const line = Math.max(1, Math.round(2 * s));
    ctx.strokeStyle = ACCENT;
    ctx.lineWidth = line;
    // Keep the border inside the rect so it never covers captured pixels at the monitor edge.
    ctx.strokeRect(x + line / 2, y + line / 2, w - line, h - line);

    // Short, heavier corner marks: they read as "this is the frame" at a glance.
    if (w < 24 * s || h < 24 * s) return;
    const arm = Math.round(Math.min(14 * s, w / 4, h / 4));
    const t = Math.max(2, Math.round(4 * s));
    ctx.fillStyle = ACCENT;
    const right = x + w;
    const bottom = y + h;
    ctx.fillRect(x, y, arm, t);
    ctx.fillRect(x, y, t, arm);
    ctx.fillRect(right - arm, y, arm, t);
    ctx.fillRect(right - t, y, t, arm);
    ctx.fillRect(x, bottom - t, arm, t);
    ctx.fillRect(x, bottom - arm, t, arm);
    ctx.fillRect(right - arm, bottom - t, arm, t);
    ctx.fillRect(right - t, bottom - arm, t, arm);
  }

  /** "W × H" in a pill above the highlight; `size` is the real rect, `at` where it is drawn. */
  private drawSizeLabel(size: Rect, at: Rect) {
    const s = this.scale;
    const text = `${size.width} × ${size.height}`;
    const { ctx } = this;
    ctx.font = `600 ${12 * s}px "Segoe UI Variable", "Segoe UI", system-ui, sans-serif`;
    const padX = 9 * s;
    const h = 22 * s;
    const w = ctx.measureText(text).width + padX * 2;
    const gap = 6 * s;
    const x = clamp(at.x, 0, this.info.width - w);
    // Above the highlight if there is room, otherwise just inside its top edge.
    const y = at.y - h - gap >= 0 ? at.y - h - gap : at.y + gap;
    ctx.fillStyle = ACCENT;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 6 * s);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.textBaseline = "middle";
    ctx.textAlign = "center";
    ctx.fillText(text, x + w / 2, y + h / 2 + 1);
    ctx.textAlign = "start";
  }

  /**
   * The magnifier lives in its own small canvas next to the cursor, so moving it never
   * repaints the whole screen. It flips to whichever side of the cursor has room, and fades
   * while the pointer sweeps fast across windows.
   */
  private placeLoupe() {
    const el = this.loupe;
    const c = this.cursor;
    const visible =
      c !== null && this.magnifier && (this.selecting || !this.loupeHidden);
    el.style.opacity = visible ? "1" : "0";
    if (!c || !this.magnifier) return;

    const s = this.scale;
    const size = Math.round(LOUPE_SIZE * s);
    const infoH = Math.round(LOUPE_INFO * s);
    if (el.width !== size || el.height !== size + infoH) {
      el.width = size;
      el.height = size + infoH;
      el.style.width = `${size / s}px`;
      el.style.height = `${(size + infoH) / s}px`;
    }
    this.drawLoupe(c, size, infoH);

    const offset = LOUPE_OFFSET * s;
    let x = c.x + offset;
    let y = c.y + offset;
    if (x + size > this.info.width) x = c.x - offset - size;
    if (y + size + infoH > this.info.height) y = c.y - offset - size - infoH;
    el.style.transform = `translate(${x / s}px, ${y / s}px)`;
  }

  private drawLoupe(c: Point, size: number, infoH: number) {
    const ctx = this.loupeCtx;
    const s = this.scale;
    const cell = size / LOUPE_PIXELS;
    const half = (LOUPE_PIXELS - 1) / 2;
    const radius = 10 * s;

    ctx.clearRect(0, 0, size, size + infoH);
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(0, 0, size, size + infoH, radius);
    ctx.clip();
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, size, size + infoH);

    // Pixels straight from the full-colour frame, scaled up without smoothing.
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(
      this.color,
      c.x - half,
      c.y - half,
      LOUPE_PIXELS,
      LOUPE_PIXELS,
      0,
      0,
      size,
      size,
    );

    // Hairlines through the cursor pixel, which gets a box so its colour stays visible.
    const hair = Math.max(1, Math.round(s));
    const cx = half * cell;
    const mid = (cell - hair) / 2;
    const rest = size - (half + 1) * cell;
    ctx.fillStyle = "rgba(108, 108, 255, 0.85)";
    ctx.fillRect(0, cx + mid, half * cell, hair);
    ctx.fillRect(cx + cell, cx + mid, rest, hair);
    ctx.fillRect(cx + mid, 0, hair, half * cell);
    ctx.fillRect(cx + mid, cx + cell, hair, rest);
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = hair;
    ctx.strokeRect(cx, cx, cell, cell);

    const hex = this.colorAt(c.x, c.y);
    ctx.fillStyle = "rgba(17, 17, 24, 0.94)";
    ctx.fillRect(0, size, size, infoH);
    ctx.fillStyle = hex;
    ctx.beginPath();
    ctx.roundRect(8 * s, size + 12 * s, 16 * s, 16 * s, 4 * s);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.font = `${11 * s}px "Cascadia Mono", Consolas, monospace`;
    ctx.textBaseline = "middle";
    const sel = this.selection;
    ctx.fillText(
      sel ? `${sel.width} × ${sel.height}` : `${c.x}, ${c.y}`,
      32 * s,
      size + 13 * s,
    );
    ctx.fillStyle = "#a1a1aa";
    ctx.fillText(hex.toUpperCase(), 32 * s, size + 27 * s);
    ctx.restore();

    ctx.strokeStyle = "rgba(255, 255, 255, 0.8)";
    ctx.lineWidth = Math.max(1, s);
    ctx.beginPath();
    ctx.roundRect(0.5 * s, 0.5 * s, size - s, size + infoH - s, radius);
    ctx.stroke();
  }

  private colorAt(px: number, py: number): string {
    const i = (py * this.info.width + px) * 4;
    const hex = (v: number) => v.toString(16).padStart(2, "0");
    return `#${hex(this.pixels[i])}${hex(this.pixels[i + 1])}${hex(this.pixels[i + 2])}`;
  }
}

function sameRect(a: Rect, b: Rect): boolean {
  return (
    a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height
  );
}

function lerpRect(a: Rect, b: Rect, t: number): Rect {
  const l = (p: number, q: number) => p + (q - p) * t;
  return {
    x: l(a.x, b.x),
    y: l(a.y, b.y),
    width: l(a.width, b.width),
    height: l(a.height, b.height),
  };
}

function easeOut(t: number): number {
  return 1 - (1 - t) ** 3;
}
