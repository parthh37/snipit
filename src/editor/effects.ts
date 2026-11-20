/**
 * Whole-image effects: a border, a drop shadow and torn edges. They are settings rather than
 * pixels, so they can be changed or removed later (a `.snip` stores them), and their sizes
 * follow the image, so a preset's effects look the same on a small or a large capture.
 *
 * The editor previews them on its canvas and presets add them without the editor; both draw
 * through {@link frameOf} and {@link drawPaper}, so the two always match. Nothing here
 * touches the DOM except {@link applyEffects}.
 */
import type { Area } from "./types";

export type Side = "top" | "right" | "bottom" | "left";
export const SIDES: Side[] = ["top", "right", "bottom", "left"];
export type EffectSize = "s" | "m" | "l";

export interface Effects {
  /** A solid frame around the image. */
  border?: { size: EffectSize; color: string } | null;
  /** A soft drop shadow; the exported PNG gets see-through margins for it. */
  shadow?: boolean;
  /** Sides that look torn off. */
  torn?: Side[];
}

export const hasEffects = (e: Effects | null | undefined): e is Effects =>
  !!e && (!!e.border || !!e.shadow || !!e.torn?.length);

/** Where everything goes, in image pixels. */
export interface Frame {
  /** The image plus its border (the "paper"), as a flat `[x0, y0, x1, y1, …]` polygon. */
  paper: number[];
  /** Where the image itself shows: inside the border and cut by any tears. */
  clip: number[];
  /** Whether `clip` is more than the plain image rectangle. */
  torn: boolean;
  /** Everything that ends up in the exported file, in whole pixels. */
  bounds: Area;
  shadow: { blur: number; x: number; y: number } | null;
  /** Fill for the paper: the border colour, or white when there is no border. */
  fill: string;
}

const clamp = (v: number, min: number, max: number) =>
  Math.min(max, Math.max(min, v));

const BORDER = { s: 0.006, m: 0.012, l: 0.024 };

/** Border width in pixels for an image whose longer side is `longest`. */
export const borderWidth = (size: EffectSize, longest: number) =>
  Math.round(clamp(longest * BORDER[size], 2, 64));

/** Small deterministic random numbers, so tears look the same every time they are drawn. */
function random(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Points along one side of `r`, walking clockwise. A torn side zig-zags up to `depth`
 * inwards; its ends stay on the corners, so neighbouring sides join cleanly.
 */
function sidePoints(r: Area, side: Side, torn: boolean, depth: number) {
  const corners = {
    top: [r.x, r.y, r.x + r.width, r.y],
    right: [r.x + r.width, r.y, r.x + r.width, r.y + r.height],
    bottom: [r.x + r.width, r.y + r.height, r.x, r.y + r.height],
    left: [r.x, r.y + r.height, r.x, r.y],
  }[side];
  const [x0, y0, x1, y1] = corners;
  if (!torn) return [x0, y0, x1, y1];
  const length = Math.hypot(x1 - x0, y1 - y0);
  const teeth = Math.max(4, Math.round(length / (depth * 1.4)));
  // Inward normal of a clockwise walk.
  const nx = -(y1 - y0) / length;
  const ny = (x1 - x0) / length;
  const rand = random(SIDES.indexOf(side) * 7919 + 17);
  const points: number[] = [];
  for (let i = 0; i <= teeth; i++) {
    const t = i / teeth;
    // Alternate deep and shallow so it reads as torn paper rather than noise.
    const d =
      i === 0 || i === teeth
        ? 0
        : depth * (i % 2 ? 0.55 + 0.45 * rand() : 0.1 + 0.3 * rand());
    const jitter = i === 0 || i === teeth ? 0 : (rand() - 0.5) * (1 / teeth);
    const tt = clamp(t + jitter, 0, 1);
    points.push(x0 + (x1 - x0) * tt + nx * d, y0 + (y1 - y0) * tt + ny * d);
  }
  return points;
}

/** Lays out the effects around `area` (the image, or its crop). */
export function frameOf(area: Area, effects: Effects): Frame {
  const longest = Math.max(area.width, area.height, 1);
  const bw = effects.border ? borderWidth(effects.border.size, longest) : 0;
  const paper: Area = {
    x: area.x - bw,
    y: area.y - bw,
    width: area.width + bw * 2,
    height: area.height + bw * 2,
  };
  const torn = new Set(effects.torn ?? []);
  const depth = clamp(
    Math.min(paper.width, paper.height) * 0.035,
    4,
    Math.min(28, Math.min(paper.width, paper.height) / 4),
  );

  const paperPoints: number[] = [];
  const clipPoints: number[] = [];
  for (const side of SIDES) {
    const points = sidePoints(paper, side, torn.has(side), depth);
    paperPoints.push(...points);
    if (torn.has(side)) {
      // The tear runs through the border into the image where it is deep enough.
      for (let i = 0; i < points.length; i += 2) {
        clipPoints.push(
          clamp(points[i], area.x, area.x + area.width),
          clamp(points[i + 1], area.y, area.y + area.height),
        );
      }
    } else {
      clipPoints.push(...sidePoints(area, side, false, 0));
    }
  }

  let shadow: Frame["shadow"] = null;
  let margin = 0;
  if (effects.shadow) {
    const blur = Math.round(clamp(longest * 0.02, 8, 32));
    shadow = { blur, x: Math.round(blur * 0.25), y: Math.round(blur * 0.45) };
    margin = Math.ceil(blur * 1.6 + shadow.y);
  }
  return {
    paper: paperPoints,
    clip: clipPoints,
    torn: torn.size > 0,
    bounds: {
      x: paper.x - margin,
      y: paper.y - margin,
      width: paper.width + margin * 2,
      height: paper.height + margin * 2,
    },
    shadow,
    fill: effects.border?.color ?? "#ffffff",
  };
}

/** Anything that can trace a path: a canvas context, or Konva's wrapper of one. */
interface PathContext {
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  closePath(): void;
}

export function tracePolygon(ctx: PathContext, points: number[]) {
  ctx.beginPath();
  ctx.moveTo(points[0], points[1]);
  for (let i = 2; i < points.length; i += 2)
    ctx.lineTo(points[i], points[i + 1]);
  ctx.closePath();
}

/**
 * Draws the paper (border colour) with its shadow. `ctx` may be scaled; canvas shadows ignore
 * the transform, so the shadow is scaled to match.
 */
export function drawPaper(ctx: CanvasRenderingContext2D, frame: Frame) {
  const scale = Math.hypot(ctx.getTransform().a, ctx.getTransform().b) || 1;
  ctx.save();
  tracePolygon(ctx, frame.paper);
  ctx.fillStyle = frame.fill;
  if (frame.shadow) {
    ctx.shadowColor = "rgba(0, 0, 0, 0.4)";
    ctx.shadowBlur = frame.shadow.blur * scale;
    ctx.shadowOffsetX = frame.shadow.x * scale;
    ctx.shadowOffsetY = frame.shadow.y * scale;
  }
  ctx.fill();
  ctx.restore();
}

/** The image with its effects, as a new canvas the size of the frame's bounds. */
export function applyEffects(
  image: CanvasImageSource,
  width: number,
  height: number,
  effects: Effects,
): HTMLCanvasElement {
  const frame = frameOf({ x: 0, y: 0, width, height }, effects);
  const canvas = document.createElement("canvas");
  canvas.width = frame.bounds.width;
  canvas.height = frame.bounds.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Couldn't add the effects");
  ctx.translate(-frame.bounds.x, -frame.bounds.y);
  drawPaper(ctx, frame);
  tracePolygon(ctx, frame.clip);
  ctx.clip();
  ctx.drawImage(image, 0, 0, width, height);
  return canvas;
}
