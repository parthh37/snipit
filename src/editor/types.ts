import type { Effects } from "./effects";

export type Tool =
  | "select"
  | "arrow"
  | "rect"
  | "ellipse"
  | "line"
  | "pen"
  | "highlighter"
  | "text"
  | "callout"
  | "step"
  | "pixelate"
  | "blur"
  | "magnify"
  | "spotlight"
  | "crop";

/** Common to every annotation: a position (image pixels) plus the transformer's edits. */
interface Base {
  id: string;
  x: number;
  y: number;
  rotation?: number;
  scaleX?: number;
  scaleY?: number;
}

export type LineStyle = "solid" | "dashed" | "dotted";

/** Look of a stroked shape; missing fields mean solid and fully opaque. */
interface Styled {
  dash?: LineStyle;
  /** 0–1. */
  opacity?: number;
  /** A soft drop shadow under the stroke or fill. */
  shadow?: boolean;
}

export interface BoxShape extends Base, Styled {
  type: "rect" | "ellipse";
  width: number;
  height: number;
  stroke: string;
  strokeWidth: number;
  /** Filled shapes use `stroke` as the fill colour. */
  filled: boolean;
  /** Rectangles only: clearly rounded corners rather than just softened ones. */
  rounded?: boolean;
}

export interface PathShape extends Base, Styled {
  type: "arrow" | "line" | "pen" | "highlighter";
  /** Flat `[x0, y0, x1, y1, …]`, relative to `x`/`y`. */
  points: number[];
  stroke: string;
  strokeWidth: number;
  /** Arrows only: a head at the start as well as the end. */
  bothEnds?: boolean;
}

export interface TextShape extends Base {
  type: "text";
  text: string;
  fill: string;
  fontSize: number;
}

/** Speech bubble whose tail points at `tailX`/`tailY` (relative to the bubble). */
export interface CalloutShape extends Base {
  type: "callout";
  text: string;
  width: number;
  fill: string;
  fontSize: number;
  tailX: number;
  tailY: number;
}

export interface StepShape extends Base {
  type: "step";
  n: number;
  fill: string;
  radius: number;
}

/** Hides what is underneath: pixel blocks or a blur, `amount` image pixels strong. */
export interface ObscureShape extends Base {
  type: "pixelate" | "blur";
  width: number;
  height: number;
  amount: number;
}

/** A round lens showing what is under it, `zoom` times larger. */
export interface MagnifyShape extends Base {
  type: "magnify";
  width: number;
  height: number;
  zoom: number;
  /** Colour of the ring. */
  stroke: string;
  strokeWidth: number;
}

/**
 * An area left bright while the rest of the image is dimmed. Several spotlights share one
 * dimmed layer, drawn where the first of them sits in the stacking order.
 */
export interface SpotlightShape extends Base {
  type: "spotlight";
  width: number;
  height: number;
  /** How dark the rest gets, 0–1. */
  dim: number;
}

export interface ImageShape extends Base {
  type: "image";
  image: HTMLImageElement;
  /** The image's PNG bytes, kept so a `.snip` can store it. */
  png: ArrayBuffer;
  width: number;
  height: number;
}

export type Shape =
  | BoxShape
  | PathShape
  | TextShape
  | CalloutShape
  | StepShape
  | ObscureShape
  | MagnifyShape
  | SpotlightShape
  | ImageShape;

export type ShapePatch = Partial<Omit<Shape, "id" | "type">> &
  Record<string, unknown>;

/** An axis-aligned area of the image, in image pixels. */
export interface Area {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** What undo/redo steps through: the annotations, the non-destructive crop and the effects. */
export interface DocState {
  shapes: Shape[];
  /** `null` shows the whole image. */
  crop: Area | null;
  effects: Effects;
}

export const FONT_FAMILY =
  '"Segoe UI Variable", "Segoe UI", system-ui, sans-serif';
export const CALLOUT_PADDING = 12;
export const TEXT_LINE_HEIGHT = 1.25;

/** Readable text colour on top of `fill`. */
export function contrastText(fill: string) {
  const hex = fill.replace("#", "");
  if (hex.length !== 6) return "#ffffff";
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return r * 0.299 + g * 0.587 + b * 0.114 > 160 ? "#111827" : "#ffffff";
}
