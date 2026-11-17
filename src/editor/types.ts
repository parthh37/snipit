/**
 * The editor's document model. Tools and their options follow Snagit's editor: the same
 * twenty tools, and per tool the properties Snagit's side panel offers.
 */

export type Tool =
  | "favorites"
  | "arrow"
  | "text"
  | "callout"
  | "shape"
  | "stamp"
  | "fill"
  | "move"
  | "selection"
  | "blur"
  | "simplify"
  | "magicwand"
  | "crop"
  | "cutout"
  | "pen"
  | "line"
  | "highlighter"
  | "step"
  | "eraser"
  | "magnify";

/** Where an object's drop shadow falls; `center` is a glow on all sides. */
export type ShadowDir =
  "tl" | "t" | "tr" | "l" | "center" | "r" | "bl" | "b" | "br";

export type Dash = "solid" | "dash" | "dot" | "dashdot" | "dashdotdot";

/** How a line or arrow ends. */
export type Cap =
  | "none"
  | "round"
  | "arrow"
  | "barbed"
  | "open"
  | "circle"
  | "square"
  | "diamond"
  | "tbar";

/** `null` (transparent) is allowed wherever a fill or outline can be turned off. */
export type Paint = string | null;

/** Common to every object: a position (image pixels) plus rotation. */
interface Base {
  id: string;
  x: number;
  y: number;
  rotation?: number;
  /** 0–1. */
  opacity?: number;
  shadow?: ShadowDir | null;
}

/** Arrow and line: start → end, optionally bent through `control` (a Bezier curve). */
export interface LineShape extends Base {
  type: "arrow" | "line";
  /** `[x0, y0, x1, y1]` relative to `x`/`y`. */
  points: number[];
  /** Relative to `x`/`y`; present when the line is curved. */
  control?: { x: number; y: number } | null;
  stroke: string;
  strokeWidth: number;
  dash: Dash;
  startCap: Cap;
  endCap: Cap;
  /** Cap size, in multiples of the line width. */
  startSize: number;
  endSize: number;
}

export type PenNib =
  "round" | "square" | "horizontal" | "vertical" | "slash" | "backslash";

export interface PenShape extends Base {
  type: "pen";
  /** Flat `[x0, y0, x1, y1, …]` relative to `x`/`y`. */
  points: number[];
  stroke: string;
  strokeWidth: number;
  nib: PenNib;
  smooth: boolean;
  /** Older highlighter strokes: drawn see-through with a multiply blend. */
  marker?: boolean;
}

export type BoxKind =
  "rect" | "rounded" | "ellipse" | "triangle" | "diamond" | "hexagon" | "star";

/** The Shape tool's objects. */
export interface BoxShape extends Base {
  type: "shape";
  kind: BoxKind;
  width: number;
  height: number;
  fill: Paint;
  outline: Paint;
  strokeWidth: number;
  dash: Dash;
  /** Rounded rectangles: corner radius in image pixels. */
  radius?: number;
}

export type HAlign = "left" | "center" | "right";
export type VAlign = "top" | "middle" | "bottom";

/** Formatting shared by text and callouts. */
export interface TextStyle {
  text: string;
  font: string;
  fontSize: number;
  textColor: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  align: HAlign;
  valign: VAlign;
  padding: number;
}

/** A text box: outlined letters, wrapped to `width`. */
export interface TextShape extends Base, TextStyle {
  type: "text";
  width: number;
  height: number;
  /** Letter outline. */
  outline: Paint;
  outlineWidth: number;
}

export type CalloutBody =
  | "rect"
  | "rounded"
  | "oval"
  | "cloud"
  | "speech"
  | "speechRound"
  | "arrowRight"
  | "arrowLeft";

/** A text box with a tail pointing at `tail` (relative to `x`/`y`). */
export interface CalloutShape extends Base, TextStyle {
  type: "callout";
  body: CalloutBody;
  width: number;
  height: number;
  fill: Paint;
  outline: Paint;
  strokeWidth: number;
  dash: Dash;
  /** `null` for a callout without a tail. */
  tail: { x: number; y: number } | null;
  /** Bodies without a built-in pointer get a line arrow to the tail: its look. */
  arrowColor: string;
  arrowWidth: number;
  arrowDash: Dash;
  arrowCap: Cap;
}

export type StepStyle = "circle" | "square" | "circlePoint" | "squarePoint";
export type StepSequence = "123" | "ABC" | "abc";

/** A numbered (or lettered) badge, centred on `x`/`y`. */
export interface StepShape extends Base {
  type: "step";
  /** 1-based position in its sequence. */
  n: number;
  sequence: StepSequence;
  style: StepStyle;
  size: number;
  fill: string;
  textColor: string;
  /** Pointed styles: the direction of the point, in degrees. */
  pointAngle?: number;
}

export type BlurMode = "blur" | "pixelate" | "redact";

/** Hides what is underneath. */
export interface BlurShape extends Base {
  type: "blur";
  mode: BlurMode;
  ellipse: boolean;
  width: number;
  height: number;
  /** 1–100. */
  intensity: number;
  /** Redact only. */
  color: string;
}

/** A see-through marker rectangle. */
export interface HighlightShape extends Base {
  type: "highlight";
  width: number;
  height: number;
  color: string;
}

export type LensShape = "oval" | "rect" | "rounded";

/** Shows the image under it enlarged, as a lens. */
export interface MagnifyShape extends Base {
  type: "magnify";
  lens: LensShape;
  width: number;
  height: number;
  /** Percent: 200 doubles. */
  scale: number;
  outline: string;
  strokeWidth: number;
}

/** Simplify: a flat block standing in for detailed UI. */
export interface BlockShape extends Base {
  type: "block";
  width: number;
  height: number;
  fill: string;
  radius: number;
}

/** A sticker from the stamp library (an emoji glyph, drawn at `size`). */
export interface StampShape extends Base {
  type: "stamp";
  glyph: string;
  width: number;
  height: number;
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
  | LineShape
  | PenShape
  | BoxShape
  | TextShape
  | CalloutShape
  | StepShape
  | BlurShape
  | HighlightShape
  | MagnifyShape
  | BlockShape
  | StampShape
  | ImageShape;

export type ShapeType = Shape["type"];

export type ShapePatch = Record<string, unknown>;

/** An axis-aligned area of the image, in image pixels. */
export interface Area {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The background after pixel edits (fill, eraser, cut out, moved selections). */
export interface BaseImage {
  image: HTMLImageElement;
  png: ArrayBuffer;
  width: number;
  height: number;
}

/** What undo/redo steps through. */
export interface DocState {
  shapes: Shape[];
  /** `null` shows the whole image. */
  crop: Area | null;
  /** `null` until a pixel tool changes the capture. */
  base: BaseImage | null;
}

export const FONT_FAMILY =
  '"Segoe UI Variable", "Segoe UI", system-ui, sans-serif';
export const TEXT_LINE_HEIGHT = 1.2;

export const FONTS = [
  "Segoe UI",
  "Arial",
  "Calibri",
  "Cambria",
  "Comic Sans MS",
  "Consolas",
  "Courier New",
  "Georgia",
  "Impact",
  "Tahoma",
  "Times New Roman",
  "Trebuchet MS",
  "Verdana",
];

/** Readable text colour on top of `fill`. */
export function contrastText(fill: string | null) {
  let hex = (fill ?? "#ffffff").replace("#", "");
  if (hex.length === 3) hex = [...hex].map((c) => c + c).join("");
  if (hex.length !== 6) return "#ffffff";
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return r * 0.299 + g * 0.587 + b * 0.114 > 160 ? "#111827" : "#ffffff";
}

/** Width/height of any boxed shape, or `null` for lines and pens. */
export function boxOf(shape: Shape): Area | null {
  if ("width" in shape && "height" in shape) {
    return { x: shape.x, y: shape.y, width: shape.width, height: shape.height };
  }
  return null;
}

/** Text in a step badge for its position in the sequence. */
export function stepLabel(n: number, sequence: StepSequence) {
  if (sequence === "123") return String(n);
  let s = "";
  let k = n;
  while (k > 0) {
    const r = (k - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    k = Math.floor((k - 1) / 26);
  }
  return sequence === "abc" ? s.toLowerCase() : s;
}
