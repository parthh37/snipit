import type { OverlayInfo, Point, Rect } from "../../lib/capture";
import { clamp, contains, rectFromPoints } from "./geometry";

const ACCENT = "#6c6cff";
const DIM = "rgba(0, 0, 0, 0.45)";
/** CSS pixels the pointer must move before a press becomes a drag. */
const DRAG_THRESHOLD = 4;
/** Pixels shown across the loupe; odd so the cursor pixel sits in the middle. */
const LOUPE_PIXELS = 15;
const LOUPE_SIZE = 135;
const LOUPE_OFFSET = 24;

export interface OverlayCallbacks {
  finish(rect: Rect): void;
  cancel(): void;
}

/**
 * Draws the selection UI over a frozen monitor frame and turns pointer input into a capture
 * rectangle. All coordinates are physical pixels local to the monitor; the UI canvas matches
 * the frame 1:1 and CSS scales it to fill the window.
 */
export class OverlayController {
  private readonly ctx: CanvasRenderingContext2D;
  private cursor: Point | null;
  private dragStart: Point | null = null;
  private selection: Rect | null = null;
  private frame = 0;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly info: OverlayInfo,
    private readonly pixels: Uint8ClampedArray,
    private readonly callbacks: OverlayCallbacks,
  ) {
    canvas.width = info.width;
    canvas.height = info.height;
    this.ctx = canvas.getContext("2d")!;
    this.cursor = info.cursor;
    this.render();
  }

  /** Physical pixels per CSS pixel; derived from the frame so mixed-DPI setups stay exact. */
  private get scale(): number {
    return this.info.width / this.canvas.clientWidth;
  }

  private get monitor(): Rect {
    return { x: 0, y: 0, width: this.info.width, height: this.info.height };
  }

  private toLocal(e: PointerEvent): Point {
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

  pointerDown = (e: PointerEvent) => {
    if (e.button === 2) {
      this.callbacks.cancel();
      return;
    }
    if (e.button !== 0) return;
    this.canvas.setPointerCapture(e.pointerId);
    this.cursor = this.toLocal(e);
    this.dragStart = this.cursor;
    this.schedule();
  };

  pointerMove = (e: PointerEvent) => {
    this.cursor = this.toLocal(e);
    const start = this.dragStart;
    if (start) {
      const threshold = DRAG_THRESHOLD * this.scale;
      const moved =
        Math.abs(this.cursor.x - start.x) >= threshold ||
        Math.abs(this.cursor.y - start.y) >= threshold;
      if (this.selection || moved) {
        this.selection = rectFromPoints(start, this.cursor);
      }
    }
    this.schedule();
  };

  pointerUp = (e: PointerEvent) => {
    if (e.button !== 0 || !this.dragStart) return;
    const rect = this.selection ?? this.hoverRect();
    this.dragStart = null;
    this.selection = null;
    this.callbacks.finish(rect);
  };

  keyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      this.callbacks.cancel();
    } else if (e.key === "f" || e.key === "F") {
      this.callbacks.finish(this.monitor);
    }
  };

  dispose() {
    cancelAnimationFrame(this.frame);
  }

  private schedule() {
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(() => this.render());
  }

  private render() {
    const { ctx } = this;
    ctx.clearRect(0, 0, this.info.width, this.info.height);
    ctx.fillStyle = DIM;
    ctx.fillRect(0, 0, this.info.width, this.info.height);

    const active = this.selection ?? (this.cursor ? this.hoverRect() : null);
    if (active) {
      this.drawHighlight(active);
      this.drawSizeLabel(active);
    }
    if (this.cursor) this.drawLoupe(this.cursor);
  }

  private drawHighlight(r: Rect) {
    const { ctx } = this;
    const line = Math.max(1, Math.round(2 * this.scale));
    ctx.clearRect(r.x, r.y, r.width, r.height);
    ctx.strokeStyle = ACCENT;
    ctx.lineWidth = line;
    // Keep the border inside the rect so it never covers captured pixels at the monitor edge.
    ctx.strokeRect(
      r.x + line / 2,
      r.y + line / 2,
      r.width - line,
      r.height - line,
    );
  }

  private drawSizeLabel(r: Rect) {
    const s = this.scale;
    const text = `${r.width} × ${r.height}`;
    this.ctx.font = `600 ${12 * s}px "Segoe UI Variable", "Segoe UI", system-ui, sans-serif`;
    const padX = 8 * s;
    const h = 22 * s;
    const w = this.ctx.measureText(text).width + padX * 2;
    const gap = 6 * s;
    const x = clamp(r.x, 0, this.info.width - w);
    // Above the selection if there is room, otherwise just inside its top edge.
    const y = r.y - h - gap >= 0 ? r.y - h - gap : r.y + gap;
    this.drawPill(x, y, w, h, text);
  }

  private drawLoupe(c: Point) {
    const { ctx } = this;
    const s = this.scale;
    const size = LOUPE_SIZE * s;
    const cell = size / LOUPE_PIXELS;
    const infoH = 40 * s;
    const offset = LOUPE_OFFSET * s;

    // Bottom-right of the cursor, flipped when it would leave the screen.
    let x = c.x + offset;
    let y = c.y + offset;
    if (x + size > this.info.width) x = c.x - offset - size;
    if (y + size + infoH > this.info.height) y = c.y - offset - size - infoH;

    ctx.save();
    ctx.beginPath();
    ctx.roundRect(x, y, size, size + infoH, 8 * s);
    ctx.clip();
    ctx.fillStyle = "#000";
    ctx.fillRect(x, y, size, size + infoH);

    const half = (LOUPE_PIXELS - 1) / 2;
    for (let row = 0; row < LOUPE_PIXELS; row++) {
      for (let col = 0; col < LOUPE_PIXELS; col++) {
        const color = this.colorAt(c.x - half + col, c.y - half + row);
        if (!color) continue;
        ctx.fillStyle = color;
        // Overlap cells by a pixel to avoid hairline seams at fractional sizes.
        ctx.fillRect(x + col * cell, y + row * cell, cell + 1, cell + 1);
      }
    }

    // Crosshair through the cursor pixel.
    ctx.fillStyle = "rgba(108, 108, 255, 0.35)";
    ctx.fillRect(x, y + half * cell, size, cell);
    ctx.fillRect(x + half * cell, y, cell, size);
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = Math.max(1, s);
    ctx.strokeRect(x + half * cell, y + half * cell, cell, cell);

    const hex = this.colorAt(c.x, c.y) ?? "#000000";
    ctx.fillStyle = "rgba(15, 15, 20, 0.92)";
    ctx.fillRect(x, y + size, size, infoH);
    ctx.fillStyle = hex;
    ctx.fillRect(x + 8 * s, y + size + 12 * s, 16 * s, 16 * s);
    ctx.fillStyle = "#fff";
    ctx.font = `${11 * s}px "Cascadia Mono", Consolas, monospace`;
    ctx.textBaseline = "middle";
    ctx.fillText(`${c.x}, ${c.y}`, x + 32 * s, y + size + 13 * s);
    ctx.fillStyle = "#a1a1aa";
    ctx.fillText(hex.toUpperCase(), x + 32 * s, y + size + 27 * s);
    ctx.restore();

    ctx.strokeStyle = "rgba(255, 255, 255, 0.85)";
    ctx.lineWidth = Math.max(1, s);
    ctx.beginPath();
    ctx.roundRect(x, y, size, size + infoH, 8 * s);
    ctx.stroke();
  }

  private drawPill(x: number, y: number, w: number, h: number, text: string) {
    const { ctx } = this;
    ctx.fillStyle = "rgba(15, 15, 20, 0.85)";
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, h / 2);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.textBaseline = "middle";
    ctx.textAlign = "center";
    ctx.fillText(text, x + w / 2, y + h / 2 + 1);
    ctx.textAlign = "start";
  }

  private colorAt(px: number, py: number): string | null {
    if (px < 0 || py < 0 || px >= this.info.width || py >= this.info.height)
      return null;
    const i = (py * this.info.width + px) * 4;
    const hex = (v: number) => v.toString(16).padStart(2, "0");
    return `#${hex(this.pixels[i])}${hex(this.pixels[i + 1])}${hex(this.pixels[i + 2])}`;
  }
}
