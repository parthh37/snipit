/**
 * Each tool's current style (what the next object drawn looks like), the Quick Styles
 * offered for it under each theme, and the user's favourite styles.
 */
import type {
  BlurMode,
  BoxKind,
  CalloutBody,
  Cap,
  Dash,
  HAlign,
  LensShape,
  PenNib,
  ShadowDir,
  StepSequence,
  StepStyle,
  Tool,
  VAlign,
} from "./types";
import type { CutEdge, FillMode } from "./pixelOps";

export interface ArrowStyle {
  stroke: string;
  strokeWidth: number;
  dash: Dash;
  startCap: Cap;
  endCap: Cap;
  startSize: number;
  endSize: number;
  bezier: boolean;
  opacity: number;
  shadow: ShadowDir | null;
}

export interface TextToolStyle {
  font: string;
  fontSize: number;
  textColor: string;
  outline: string | null;
  outlineWidth: number;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  align: HAlign;
  valign: VAlign;
  padding: number;
  opacity: number;
  shadow: ShadowDir | null;
}

export interface CalloutStyle extends Omit<
  TextToolStyle,
  "outline" | "outlineWidth"
> {
  body: CalloutBody;
  fill: string | null;
  outline: string | null;
  strokeWidth: number;
  dash: Dash;
  arrowColor: string;
  arrowWidth: number;
  arrowDash: Dash;
  arrowCap: Cap;
}

export interface ShapeToolStyle {
  kind: BoxKind;
  fill: string | null;
  outline: string | null;
  strokeWidth: number;
  dash: Dash;
  opacity: number;
  shadow: ShadowDir | null;
}

export interface StepToolStyle {
  style: StepStyle;
  sequence: StepSequence;
  size: number;
  fill: string;
  textColor: string;
  opacity: number;
  shadow: ShadowDir | null;
}

export interface PenStyle {
  stroke: string;
  strokeWidth: number;
  nib: PenNib;
  smooth: boolean;
  opacity: number;
  shadow: ShadowDir | null;
}

export interface HighlightStyle {
  color: string;
  opacity: number;
}

export interface BlurStyle {
  mode: BlurMode;
  ellipse: boolean;
  intensity: number;
  color: string;
}

export interface MagnifyStyle {
  lens: LensShape;
  scale: number;
  outline: string;
  strokeWidth: number;
}

export interface SimplifyStyle {
  radius: number;
  opacity: number;
  /** `null` samples each block's colour from the image under it. */
  color: string | null;
}

export interface StampStyle {
  glyph: string;
  opacity: number;
  shadow: ShadowDir | null;
}

export interface FillStyle {
  color: string;
  tolerance: number;
  opacity: number;
}

export interface EraserStyle {
  width: number;
  opacity: number;
  antialias: boolean;
}

export interface WandStyle {
  tolerance: number;
  global: boolean;
  fillMode: FillMode;
}

export interface SelectionStyle {
  shape: "rect" | "ellipse" | "freehand";
  fillMode: FillMode;
}

export interface CutOutStyle {
  vertical: boolean;
  edge: CutEdge;
}

export interface Styles {
  arrow: ArrowStyle;
  line: ArrowStyle;
  text: TextToolStyle;
  callout: CalloutStyle;
  shape: ShapeToolStyle;
  step: StepToolStyle;
  pen: PenStyle;
  highlighter: HighlightStyle;
  blur: BlurStyle;
  magnify: MagnifyStyle;
  simplify: SimplifyStyle;
  stamp: StampStyle;
  fill: FillStyle;
  eraser: EraserStyle;
  magicwand: WandStyle;
  selection: SelectionStyle;
  move: { fillMode: FillMode };
  cutout: CutOutStyle;
}

export type StyledTool = keyof Styles;

export const DEFAULT_STYLES: Styles = {
  arrow: {
    stroke: "#e5191c",
    strokeWidth: 10,
    dash: "solid",
    startCap: "none",
    endCap: "arrow",
    startSize: 3,
    endSize: 3,
    bezier: false,
    opacity: 1,
    shadow: "br",
  },
  line: {
    stroke: "#e5191c",
    strokeWidth: 6,
    dash: "solid",
    startCap: "round",
    endCap: "round",
    startSize: 3,
    endSize: 3,
    bezier: false,
    opacity: 1,
    shadow: null,
  },
  text: {
    font: "Segoe UI",
    fontSize: 28,
    textColor: "#e5191c",
    outline: null,
    outlineWidth: 0,
    bold: true,
    italic: false,
    underline: false,
    align: "left",
    valign: "top",
    padding: 4,
    opacity: 1,
    shadow: "br",
  },
  callout: {
    body: "speechRound",
    fill: "#e5191c",
    outline: null,
    strokeWidth: 2,
    dash: "solid",
    font: "Segoe UI",
    fontSize: 18,
    textColor: "#ffffff",
    bold: false,
    italic: false,
    underline: false,
    align: "center",
    valign: "middle",
    padding: 12,
    arrowColor: "#e5191c",
    arrowWidth: 6,
    arrowDash: "solid",
    arrowCap: "arrow",
    opacity: 1,
    shadow: "br",
  },
  shape: {
    kind: "rect",
    fill: null,
    outline: "#e5191c",
    strokeWidth: 6,
    dash: "solid",
    opacity: 1,
    shadow: "br",
  },
  step: {
    style: "circle",
    sequence: "123",
    size: 36,
    fill: "#e5191c",
    textColor: "#ffffff",
    opacity: 1,
    shadow: "br",
  },
  pen: {
    stroke: "#e5191c",
    strokeWidth: 6,
    nib: "round",
    smooth: true,
    opacity: 1,
    shadow: null,
  },
  highlighter: { color: "#ffe100", opacity: 0.5 },
  blur: { mode: "blur", ellipse: false, intensity: 25, color: "#111111" },
  magnify: { lens: "oval", scale: 200, outline: "#4b5563", strokeWidth: 3 },
  simplify: { radius: 4, opacity: 1, color: null },
  stamp: { glyph: "✅", opacity: 1, shadow: null },
  fill: { color: "#e5191c", tolerance: 15, opacity: 1 },
  eraser: { width: 20, opacity: 1, antialias: true },
  magicwand: { tolerance: 15, global: false, fillMode: "auto" },
  selection: { shape: "rect", fillMode: "auto" },
  move: { fillMode: "auto" },
  cutout: { vertical: true, edge: "sharktooth" },
};

// ---- Quick Styles ---------------------------------------------------------------------------

export interface Theme {
  name: string;
  colors: [string, string, string, string];
}

export const THEMES: Theme[] = [
  { name: "Starter", colors: ["#e5191c", "#35b13a", "#1b8fe5", "#ffd200"] },
  { name: "Bold", colors: ["#111827", "#ffffff", "#f97316", "#8b5cf6"] },
  { name: "Soft", colors: ["#f87171", "#34d399", "#60a5fa", "#fbbf24"] },
  { name: "Ocean", colors: ["#0e7490", "#0284c7", "#14b8a6", "#f1f5f9"] },
  { name: "Mono", colors: ["#000000", "#4b5563", "#9ca3af", "#ffffff"] },
];

export const HIGHLIGHT_COLORS = ["#ffe100", "#7cf266", "#ff7bd5", "#6ad3ff"];

export type QuickStyle<T extends StyledTool = StyledTool> = Partial<Styles[T]>;

const contrast = (c: string) => {
  const hex = c.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return r * 0.299 + g * 0.587 + b * 0.114 > 160 ? "#111827" : "#ffffff";
};

/** The Quick Styles grid for a tool under a theme: rows of four, one per theme colour. */
export function quickStyles(tool: StyledTool, theme: Theme): QuickStyle[] {
  const row = <T>(f: (c: string) => T) => theme.colors.map(f);
  switch (tool) {
    case "arrow":
      return [
        ...row((c) => ({
          stroke: c,
          strokeWidth: 10,
          dash: "solid" as Dash,
          startCap: "none" as Cap,
          endCap: "arrow" as Cap,
          endSize: 3,
          shadow: "br" as ShadowDir,
        })),
        ...row((c) => ({
          stroke: c,
          strokeWidth: 12,
          dash: "solid" as Dash,
          startCap: "none" as Cap,
          endCap: "barbed" as Cap,
          endSize: 3,
          shadow: null,
        })),
        ...row((c) => ({
          stroke: c,
          strokeWidth: 5,
          dash: "dash" as Dash,
          startCap: "circle" as Cap,
          endCap: "arrow" as Cap,
          startSize: 2,
          endSize: 4,
          shadow: null,
        })),
        ...row((c) => ({
          stroke: c,
          strokeWidth: 6,
          dash: "solid" as Dash,
          startCap: "arrow" as Cap,
          endCap: "arrow" as Cap,
          startSize: 3,
          endSize: 3,
          shadow: "br" as ShadowDir,
        })),
      ];
    case "line":
      return [
        ...row((c) => ({
          stroke: c,
          strokeWidth: 6,
          dash: "solid" as Dash,
          startCap: "round" as Cap,
          endCap: "round" as Cap,
          shadow: null,
        })),
        ...row((c) => ({
          stroke: c,
          strokeWidth: 6,
          dash: "dash" as Dash,
          startCap: "round" as Cap,
          endCap: "round" as Cap,
          shadow: null,
        })),
        ...row((c) => ({
          stroke: c,
          strokeWidth: 4,
          dash: "dot" as Dash,
          startCap: "round" as Cap,
          endCap: "round" as Cap,
          shadow: null,
        })),
      ];
    case "text":
      return [
        ...row((c) => ({
          textColor: c,
          outline: null,
          outlineWidth: 0,
          fontSize: 24,
          bold: true,
          shadow: "br" as ShadowDir,
        })),
        ...row((c) => ({
          textColor: c,
          outline: "#ffffff",
          outlineWidth: 2,
          fontSize: 28,
          bold: true,
          shadow: null,
        })),
        ...row((c) => ({
          textColor: c,
          outline: null,
          outlineWidth: 0,
          fontSize: 40,
          bold: true,
          shadow: "br" as ShadowDir,
        })),
      ];
    case "callout":
      return [
        ...row((c) => ({
          body: "speechRound" as CalloutBody,
          fill: c,
          outline: null,
          textColor: contrast(c),
          arrowColor: c,
          shadow: "br" as ShadowDir,
        })),
        ...row((c) => ({
          body: "rounded" as CalloutBody,
          fill: "#ffffff",
          outline: c,
          strokeWidth: 3,
          textColor: "#111827",
          arrowColor: c,
          shadow: "br" as ShadowDir,
        })),
        ...row((c) => ({
          body: "rect" as CalloutBody,
          fill: c,
          outline: null,
          textColor: contrast(c),
          arrowColor: c,
          arrowCap: "arrow" as Cap,
          shadow: "br" as ShadowDir,
        })),
        ...row((c) => ({
          body: "arrowRight" as CalloutBody,
          fill: c,
          outline: null,
          textColor: contrast(c),
          shadow: "br" as ShadowDir,
        })),
        ...row((c) => ({
          body: "cloud" as CalloutBody,
          fill: "#ffffff",
          outline: c,
          strokeWidth: 3,
          textColor: "#111827",
          shadow: null,
        })),
      ];
    case "shape":
      return [
        ...row((c) => ({
          kind: "rect" as BoxKind,
          fill: null,
          outline: c,
          strokeWidth: 6,
          dash: "solid" as Dash,
          shadow: "br" as ShadowDir,
          opacity: 1,
        })),
        ...row((c) => ({
          kind: "rounded" as BoxKind,
          fill: null,
          outline: c,
          strokeWidth: 6,
          dash: "solid" as Dash,
          shadow: "br" as ShadowDir,
          opacity: 1,
        })),
        ...row((c) => ({
          kind: "ellipse" as BoxKind,
          fill: null,
          outline: c,
          strokeWidth: 6,
          dash: "solid" as Dash,
          shadow: "br" as ShadowDir,
          opacity: 1,
        })),
        ...row((c) => ({
          kind: "rect" as BoxKind,
          fill: c,
          outline: null,
          strokeWidth: 4,
          dash: "solid" as Dash,
          shadow: null,
          opacity: 0.5,
        })),
        ...row((c) => ({
          kind: "rect" as BoxKind,
          fill: null,
          outline: c,
          strokeWidth: 4,
          dash: "dash" as Dash,
          shadow: null,
          opacity: 1,
        })),
      ];
    case "step":
      return [
        ...row((c) => ({
          style: "circle" as StepStyle,
          fill: c,
          textColor: contrast(c),
          shadow: "br" as ShadowDir,
        })),
        ...row((c) => ({
          style: "square" as StepStyle,
          fill: c,
          textColor: contrast(c),
          shadow: "br" as ShadowDir,
        })),
        ...row((c) => ({
          style: "circlePoint" as StepStyle,
          fill: c,
          textColor: contrast(c),
          shadow: "br" as ShadowDir,
        })),
        ...row((c) => ({
          style: "circle" as StepStyle,
          sequence: "ABC" as StepSequence,
          fill: c,
          textColor: contrast(c),
          shadow: "br" as ShadowDir,
        })),
      ];
    case "pen":
      return [
        ...row((c) => ({ stroke: c, strokeWidth: 6, nib: "round" as PenNib })),
        ...row((c) => ({ stroke: c, strokeWidth: 12, nib: "round" as PenNib })),
        ...row((c) => ({ stroke: c, strokeWidth: 10, nib: "slash" as PenNib })),
      ];
    case "highlighter":
      return [
        ...HIGHLIGHT_COLORS.map((color) => ({ color, opacity: 0.5 })),
        ...HIGHLIGHT_COLORS.map((color) => ({ color, opacity: 0.3 })),
      ];
    case "blur":
      return [
        ...[10, 25, 50, 80].map((intensity) => ({
          mode: "blur" as BlurMode,
          intensity,
        })),
        ...[10, 25, 50, 80].map((intensity) => ({
          mode: "pixelate" as BlurMode,
          intensity,
        })),
        ...["#111111", "#ffffff", "#6b7280", theme.colors[0]].map((color) => ({
          mode: "redact" as BlurMode,
          color,
        })),
      ];
    case "magnify":
      return [
        { lens: "oval", scale: 200, outline: theme.colors[0] },
        { lens: "rect", scale: 200, outline: theme.colors[1] },
        { lens: "rounded", scale: 300, outline: theme.colors[2] },
        { lens: "oval", scale: 400, outline: "#4b5563" },
      ] as QuickStyle[];
    case "simplify":
      return [
        { radius: 0, color: null },
        { radius: 4, color: null },
        { radius: 12, color: null },
        ...theme.colors.map((color) => ({ radius: 4, color })),
      ] as QuickStyle[];
    case "cutout":
      return (
        ["none", "fade", "sharktooth", "saw", "wave", "torn"] as CutEdge[]
      ).map((edge) => ({ edge }));
    default:
      return [];
  }
}

// ---- Persistence -----------------------------------------------------------------------------

const STYLES_KEY = "snipit.editor.styles";
const FAVORITES_KEY = "snipit.editor.favorites";
const THEME_KEY = "snipit.editor.theme";

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Only preferences.
  }
}

/** The tool styles last used, over the defaults (so new fields keep their defaults). */
export function loadStyles(): Styles {
  const saved = read<Partial<Styles>>(STYLES_KEY, {});
  const out = { ...DEFAULT_STYLES } as Record<string, unknown>;
  for (const key of Object.keys(DEFAULT_STYLES) as StyledTool[]) {
    out[key] = { ...DEFAULT_STYLES[key], ...(saved[key] ?? {}) };
  }
  return out as unknown as Styles;
}

export const saveStyles = (styles: Styles) => write(STYLES_KEY, styles);

export interface Favorite {
  tool: StyledTool;
  style: QuickStyle;
}

export const loadFavorites = () => read<Favorite[]>(FAVORITES_KEY, []);
export const saveFavorites = (favorites: Favorite[]) =>
  write(FAVORITES_KEY, favorites);

export const loadTheme = () => read<string>(THEME_KEY, "Starter");
export const saveTheme = (name: string) => write(THEME_KEY, name);

export const sameStyle = (a: QuickStyle, b: QuickStyle) =>
  JSON.stringify(a) === JSON.stringify(b);

/** Tools whose side panel shows a Quick Styles grid. */
export const QUICK_STYLE_TOOLS = new Set<Tool>([
  "arrow",
  "line",
  "text",
  "callout",
  "shape",
  "step",
  "pen",
  "highlighter",
  "blur",
  "magnify",
  "simplify",
  "cutout",
]);

// ---- Stamps ----------------------------------------------------------------------------------

export interface Stamp {
  glyph: string;
  name: string;
}

const stamps = (list: string) =>
  list
    .trim()
    .split("\n")
    .map((line) => {
      const [glyph, ...name] = line.trim().split(" ");
      return { glyph, name: name.join(" ") };
    });

export const STAMP_CATEGORIES: { name: string; stamps: Stamp[] }[] = [
  {
    name: "Business",
    stamps: stamps(`
      💻 laptop computer
      🖥️ desktop computer monitor
      ⌨️ keyboard
      🖱️ mouse
      🖨️ printer
      💾 save floppy disk
      💿 disc cd
      📀 dvd disc
      📱 phone mobile
      📁 folder
      📂 open folder
      📄 document page
      📊 bar chart
      📈 chart up growth
      📉 chart down
      📎 paperclip attachment
      ✉️ email envelope mail
      📅 calendar date
      🔒 lock locked secure
      🔓 unlock unlocked
      🔑 key password
      ⚙️ settings gear
      🔍 search magnify
      🛒 cart shopping
      💳 card payment
      ☁️ cloud
      🗑️ trash delete
      📌 pin
      🏷️ tag label
      🔗 link
      `),
  },
  {
    name: "Symbols",
    stamps: stamps(`
      ✅ check yes done
      ✔️ check tick
      ❌ cross no wrong
      ❎ cross box
      ⚠️ warning caution
      ⛔ stop no entry
      🚫 prohibited forbidden
      ℹ️ info information
      ❓ question
      ❗ exclamation important
      ❕ exclamation light
      💡 idea tip bulb
      ⭐ star favorite
      🌟 star glowing
      ❤️ heart love
      🔔 bell notification
      🆕 new
      🆗 ok
      🔴 red circle dot
      🟢 green circle dot
      🔵 blue circle dot
      🟡 yellow circle dot
      ➕ plus add
      ➖ minus remove
      ♻️ recycle refresh
      🎯 target goal
      🏁 finish flag
      🔥 fire hot
      `),
  },
  {
    name: "Arrows",
    stamps: stamps(`
      ⬆️ arrow up
      ⬇️ arrow down
      ⬅️ arrow left
      ➡️ arrow right
      ↗️ arrow up right
      ↘️ arrow down right
      ↙️ arrow down left
      ↖️ arrow up left
      ↩️ return back
      ↪️ forward
      🔄 refresh reload cycle
      🔃 clockwise
      🔼 up button
      🔽 down button
      ▶️ play right
      ◀️ reverse left
      ⏩ fast forward
      ⏪ rewind
      `),
  },
  {
    name: "Numbers",
    stamps: stamps(`
      0️⃣ zero 0
      1️⃣ one 1
      2️⃣ two 2
      3️⃣ three 3
      4️⃣ four 4
      5️⃣ five 5
      6️⃣ six 6
      7️⃣ seven 7
      8️⃣ eight 8
      9️⃣ nine 9
      🔟 ten 10
      #️⃣ hash number
      `),
  },
  {
    name: "Faces & hands",
    stamps: stamps(`
      😀 smile happy
      😃 grin happy
      😉 wink
      😍 love eyes
      🤔 thinking hmm
      😮 surprised wow
      😢 sad cry
      😡 angry
      😎 cool sunglasses
      🙈 oops monkey
      👍 thumbs up good like
      👎 thumbs down bad
      👏 clap applause
      🙌 hooray hands
      👉 point right
      👈 point left
      👆 point up
      👇 point down
      ✋ hand stop
      👀 eyes look
      `),
  },
  {
    name: "Cursors",
    stamps: stamps(`
      👆 hand cursor click
      🖱️ mouse click
      ✏️ pencil edit
      ✂️ scissors cut
      📋 clipboard paste
      ⏳ hourglass wait
      ⌛ hourglass done
      🔎 zoom search
      `),
  },
];

export const ALL_STAMPS = STAMP_CATEGORIES.flatMap((c) => c.stamps);
