/* eslint-disable react-refresh/only-export-components -- shares the editor helpers and constants that go with these components */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import Konva from "konva";
import {
  Circle,
  Ellipse,
  Image as KImage,
  Layer,
  Line,
  Rect,
  Shape as KShape,
  Stage,
  Transformer,
} from "react-konva";
import { api, errorMessage, snipUrl, type Snip } from "../lib/api";
import { startCapture } from "../lib/capture";
import ShapeNode, { measureText } from "./ShapeNode";
import SidePanel from "./SidePanel";
import Toolbar, { TOOL_KEYS, loadBar, saveBar } from "./Toolbar";
import { GearIcon, RecentIcon, ZoomIcon } from "./icons";
import { Dropdown } from "./controls";
import {
  canvasOf,
  canvasPngBuffer,
  colorMask,
  cutOut,
  dominantColor,
  eraseStroke,
  liftMask,
  loadImage,
  paintMask,
  shapeMask,
  toBase,
} from "./pixelOps";
import { shapeBounds, stepPointer } from "./geometry";
import {
  QUICK_STYLE_TOOLS,
  loadFavorites,
  loadStyles,
  loadTheme,
  sameStyle,
  saveFavorites,
  saveStyles,
  saveTheme,
  type Favorite,
  type QuickStyle,
  type StyledTool,
  type Styles,
} from "./toolStyles";
import {
  type Area,
  type BaseImage,
  type CalloutShape,
  type DocState,
  type LineShape,
  type Shape,
  type ShapePatch,
  type StepSequence,
  type TextShape,
  type Tool,
  TEXT_LINE_HEIGHT,
} from "./types";
import { useHistory } from "./useHistory";
import { encodeSnip, type SnipProject } from "./snipFile";

export interface EditorDoc {
  /** Gallery file being edited; `null` until the first save. */
  path: string | null;
  /** PNG bytes of the background image. */
  png: ArrayBuffer;
  /** The `.snip` saved with an earlier edit: its original image and annotations reopen. */
  project?: SnipProject | null;
}

interface Props {
  doc: EditorDoc;
  onClose: () => void;
  onSaved: () => void;
  notify: (message: string) => void;
  /** Opens another library snip (from the Recent tray). */
  onOpenSnip?: (path: string) => void;
}

/** Tools that work on the image's pixels, so objects don't catch their clicks. */
const PIXEL_TOOLS = new Set<Tool>([
  "fill",
  "eraser",
  "magicwand",
  "selection",
  "cutout",
  "crop",
]);

/** Which tool's properties edit a shape. */
export function toolOf(shape: Shape): Tool {
  switch (shape.type) {
    case "highlight":
      return "highlighter";
    case "block":
      return "simplify";
    case "image":
      return "move";
    default:
      return shape.type;
  }
}

const PANEL_KEY = "snipit.editor.panel";
function panelInitiallyOpen() {
  try {
    return localStorage.getItem(PANEL_KEY) !== "closed";
  } catch {
    return true;
  }
}

/** Zoom presets, in device pixels per image pixel (1 = 100%). */
const ZOOM_STEPS = [
  0.1,
  0.25,
  1 / 3,
  0.5,
  2 / 3,
  0.75,
  1,
  1.5,
  2,
  3,
  4,
  6,
  8,
  12,
  16,
];
const MARGIN = 28;

interface View {
  scale: number;
  x: number;
  y: number;
}

/** A UI-only preview drawn while a pixel tool or the marquee is dragged. */
type Overlay =
  | { kind: "marquee"; area: Area }
  | {
      kind: "select";
      shape: "rect" | "ellipse" | "freehand";
      area: Area;
      points: number[];
    }
  | { kind: "band"; vertical: boolean; from: number; to: number }
  | { kind: "erase"; points: number[]; width: number };

const newId = () => crypto.randomUUID();
const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));
const sameArea = (a: Area | null, b: Area | null) =>
  a === b ||
  (!!a &&
    !!b &&
    a.x === b.x &&
    a.y === b.y &&
    a.width === b.width &&
    a.height === b.height);
const union = (a: Area, b: Area): Area => {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y,
  };
};
const norm = (
  a: { x: number; y: number },
  b: { x: number; y: number },
): Area => ({
  x: Math.min(a.x, b.x),
  y: Math.min(a.y, b.y),
  width: Math.abs(b.x - a.x),
  height: Math.abs(b.y - a.y),
});

function trackPointer(
  onMove: (e: PointerEvent) => void,
  onUp?: (e: PointerEvent) => void,
) {
  const up = (e: PointerEvent) => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", up);
    onUp?.(e);
  };
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", up);
}

const THUMBNAIL_SIZE = 400;

function canvasPng(canvas: HTMLCanvasElement) {
  return canvasPngBuffer(canvas).then((b) => new Uint8Array(b));
}

function thumbnailOf(canvas: HTMLCanvasElement) {
  const scale = Math.min(
    1,
    THUMBNAIL_SIZE / Math.max(canvas.width, canvas.height, 1),
  );
  const thumb = document.createElement("canvas");
  thumb.width = Math.max(1, Math.round(canvas.width * scale));
  thumb.height = Math.max(1, Math.round(canvas.height * scale));
  const ctx = thumb.getContext("2d");
  if (ctx) {
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(canvas, 0, 0, thumb.width, thumb.height);
  }
  return thumb;
}

const bufferOf = (bytes: Uint8Array): ArrayBuffer =>
  bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
    ? (bytes.buffer as ArrayBuffer)
    : (bytes.slice().buffer as ArrayBuffer);

async function projectState(project: SnipProject): Promise<DocState> {
  const shapes = await Promise.all(
    project.shapes.map(async (stored): Promise<Shape> => {
      if (stored.type !== "image") return stored;
      const { asset, ...rest } = stored;
      const png = bufferOf(project.assets.get(asset)!);
      return { ...rest, png, image: await loadImage(png) };
    }),
  );
  let base: BaseImage | null = null;
  if (project.base) {
    const png = bufferOf(project.base.png);
    base = {
      png,
      image: await loadImage(png),
      width: project.base.width,
      height: project.base.height,
    };
  }
  return { shapes, crop: project.crop, base };
}

function snap45(dx: number, dy: number) {
  const angle = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
  const len = Math.hypot(dx, dy);
  return [Math.cos(angle) * len, Math.sin(angle) * len];
}

/** A shape's text box grown to fit its text. */
function fitText<T extends TextShape | CalloutShape>(shape: T): T {
  const need = measureText(shape, shape.width);
  if (shape.type === "text") return { ...shape, height: need };
  return need > shape.height ? { ...shape, height: need } : shape;
}

/** Turns a style-panel change into a patch for an existing shape of that tool. */
function shapePatch(
  shape: Shape,
  patch: QuickStyle,
  bg: CanvasImageSource | null,
): ShapePatch {
  const p = { ...patch } as Record<string, unknown>;
  if (shape.type === "arrow" || shape.type === "line") {
    if ("bezier" in p) {
      const [x0, y0, x1, y1] = shape.points;
      p.control = p.bezier
        ? (shape.control ?? { x: (x0 + x1) / 2, y: (y0 + y1) / 2 })
        : null;
      delete p.bezier;
    }
  }
  if (shape.type === "block" && "color" in p) {
    p.fill =
      p.color ??
      (bg
        ? dominantColor(
            canvasOf(bg, shape.x + shape.width + 1, shape.y + shape.height + 1),
            shape,
          )
        : shape.fill);
    delete p.color;
  }
  if (shape.type === "step") {
    // A step's own number stays; only its look changes.
    delete p.n;
  }
  return p;
}

export default function Editor({
  doc,
  onClose,
  onSaved,
  notify,
  onOpenSnip,
}: Props) {
  const [original, setOriginal] = useState<HTMLImageElement>();
  const originalRef = useRef<Uint8Array>(new Uint8Array());
  const [path, setPath] = useState<string | null>(doc.path);
  const history = useHistory<DocState>({ shapes: [], crop: null, base: null });
  const { shapes, crop, base } = history.present;
  const [savedDoc, setSavedDoc] = useState<DocState>(history.present);
  const dirty = history.present !== savedDoc;

  const [tool, setToolState] = useState<Tool>("arrow");
  const [styles, setStylesState] = useState<Styles>(loadStyles);
  const [theme, setThemeState] = useState(loadTheme);
  const [favorites, setFavorites] = useState<Favorite[]>(loadFavorites);
  const [bar, setBarState] = useState<Tool[]>(loadBar);
  const [recentTool, setRecentTool] = useState<Tool | null>(null);
  const [panelOpen, setPanelOpen] = useState(panelInitiallyOpen);
  const [showRecent, setShowRecent] = useState(false);
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<number>(undefined);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [draft, setDraftState] = useState<Shape | null>(null);
  const draftRef = useRef<Shape | null>(null);
  const setDraft = (next: Shape | null) => {
    draftRef.current = next;
    setDraftState(next);
  };
  const [overlay, setOverlay] = useState<Overlay | null>(null);
  const [editing, setEditing] = useState<{ id: string; base: DocState } | null>(
    null,
  );
  const editingRef = useRef(editing);
  /** The objects the canvas was last fitted to; `skipFit` skips loads, undo and redo. */
  const fitShapes = useRef<Shape[] | null>(null);
  const skipFit = useRef(false);
  /** An object is being dragged: it shows past the canvas edge until dropped. */
  const [moving, setMoving] = useState(false);
  const [busy, setBusy] = useState(false);
  /** Where the next step of each sequence starts after a Reset. */
  const stepReset = useRef<Partial<Record<StepSequence, number>>>({});

  const [cropDraft, setCropDraft] = useState<Area | null>(null);
  const toolBeforeCrop = useRef<Tool>("arrow");

  const [zoom, setZoom] = useState<View | null>(null);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [panning, setPanning] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const contentRef = useRef<Konva.Layer>(null);
  const uiLayerRef = useRef<Konva.Layer>(null);
  const trRef = useRef<Konva.Transformer>(null);
  const cropTrRef = useRef<Konva.Transformer>(null);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) =>
      setViewport({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      }),
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // ---- preferences ------------------------------------------------------------------------

  const setStyles = (next: Styles) => {
    setStylesState(next);
    saveStyles(next);
  };
  const setTheme = (name: string) => {
    setThemeState(name);
    saveTheme(name);
  };
  const setBar = (next: Tool[]) => {
    setBarState(next);
    saveBar(next);
  };
  const toggleFavorite = (fav: Favorite) => {
    const has = favorites.some(
      (f) => f.tool === fav.tool && sameStyle(f.style, fav.style),
    );
    const next = has
      ? favorites.filter(
          (f) => !(f.tool === fav.tool && sameStyle(f.style, fav.style)),
        )
      : [...favorites, fav];
    setFavorites(next);
    saveFavorites(next);
  };

  // ---- view: crop area, zoom and pan --------------------------------------------------------

  const bg: HTMLImageElement | undefined = base?.image ?? original;
  const iw = base?.width ?? original?.naturalWidth ?? 0;
  const ih = base?.height ?? original?.naturalHeight ?? 0;
  const dpr = window.devicePixelRatio;
  const cropping = tool === "crop";
  const full: Area = { x: 0, y: 0, width: iw, height: ih };
  /** Everything there is to crop: the image plus any canvas grown around it. */
  const extent = crop ? union(full, crop) : full;
  const area = cropping ? extent : (crop ?? full);

  const fitScale =
    iw && viewport.width
      ? Math.max(
          0.01,
          Math.min(
            1 / dpr,
            (viewport.width - MARGIN * 2) / area.width,
            (viewport.height - MARGIN * 2) / area.height,
          ),
        )
      : 1;

  const clampView = (v: View): View => {
    const axis = (pos: number, start: number, length: number, room: number) => {
      const size = length * v.scale;
      const offset = start * v.scale;
      if (size <= room) return Math.round((room - size) / 2 - offset);
      return Math.round(
        clamp(pos, room - MARGIN - size - offset, MARGIN - offset),
      );
    };
    return {
      scale: v.scale,
      x: axis(v.x, area.x, area.width, viewport.width),
      y: axis(v.y, area.y, area.height, viewport.height),
    };
  };

  const view = clampView(zoom ?? { scale: fitScale, x: 0, y: 0 });
  const viewRef = useRef(view);
  useLayoutEffect(() => {
    viewRef.current = view;
  });
  const setView = (v: View) => {
    const next = clampView(v);
    viewRef.current = next;
    setZoom(next);
  };
  const zoomTo = (scale: number, anchor?: { x: number; y: number }) => {
    const v = viewRef.current;
    const a = anchor ?? { x: viewport.width / 2, y: viewport.height / 2 };
    const s = clamp(scale, Math.min(0.1 / dpr, fitScale), 16 / dpr);
    const ix = (a.x - v.x) / v.scale;
    const iy = (a.y - v.y) / v.scale;
    setView({ scale: s, x: a.x - ix * s, y: a.y - iy * s });
  };
  const stepZoom = (direction: 1 | -1) => {
    const current = viewRef.current.scale * dpr;
    const next =
      direction > 0
        ? (ZOOM_STEPS.find((s) => s > current * 1.01) ??
          ZOOM_STEPS[ZOOM_STEPS.length - 1])
        : ([...ZOOM_STEPS].reverse().find((s) => s < current / 1.01) ??
          ZOOM_STEPS[0]);
    zoomTo(next / dpr);
  };
  const fitToWindow = () => setZoom(null);

  const startPan = (start: MouseEvent) => {
    if (!zoom) return;
    const v0 = viewRef.current;
    setPanning(true);
    trackPointer(
      (e) =>
        setView({
          ...v0,
          x: v0.x + e.clientX - start.clientX,
          y: v0.y + e.clientY - start.clientY,
        }),
      () => setPanning(false),
    );
  };

  const wheel = useRef<(e: WheelEvent) => void>(() => {});
  const onWheel = (e: WheelEvent) => {
    if (!bg) return;
    e.preventDefault();
    const unit =
      e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? viewport.height : 1;
    if (e.ctrlKey || e.metaKey) {
      const rect = containerRef.current!.getBoundingClientRect();
      zoomTo(viewRef.current.scale * Math.exp(-e.deltaY * unit * 0.002), {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      });
    } else if (zoom) {
      const v = viewRef.current;
      const [dx, dy] = e.shiftKey ? [e.deltaY, e.deltaX] : [e.deltaX, e.deltaY];
      setView({ ...v, x: v.x - dx * unit, y: v.y - dy * unit });
    }
  };
  useEffect(() => {
    wheel.current = onWheel;
  });
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const listener = (e: WheelEvent) => wheel.current(e);
    el.addEventListener("wheel", listener, { passive: false });
    return () => el.removeEventListener("wheel", listener);
  }, []);

  // ---- export, save, copy -------------------------------------------------------------------

  const renderCanvas = useCallback(
    (region: Area | null) => {
      const stage = stageRef.current;
      if (!stage) throw new Error("Editor not ready");
      const r = region ?? { x: 0, y: 0, width: iw, height: ih };
      const onScreen = {
        size: stage.size(),
        scale: stage.scale(),
        position: stage.position(),
      };
      uiLayerRef.current?.visible(false);
      stage.size({ width: iw, height: ih });
      stage.scale({ x: 1, y: 1 });
      stage.position({ x: 0, y: 0 });
      let canvas: HTMLCanvasElement;
      try {
        canvas = stage.toCanvas({ ...r, pixelRatio: 1 });
      } finally {
        stage.size(onScreen.size);
        stage.scale(onScreen.scale);
        stage.position(onScreen.position);
        uiLayerRef.current?.visible(true);
      }
      return canvas;
    },
    [iw, ih],
  );

  const save = useCallback(
    async (state: DocState) => {
      const canvas = renderCanvas(state.crop);
      const project = await encodeSnip({
        original: originalRef.current,
        width: original?.naturalWidth ?? iw,
        height: original?.naturalHeight ?? ih,
        crop: state.crop,
        shapes: state.shapes,
        base: state.base
          ? {
              png: new Uint8Array(state.base.png),
              width: state.base.width,
              height: state.base.height,
            }
          : null,
        thumbnail: await canvasPng(thumbnailOf(canvas)),
      });
      const saved = await api.saveSnip(await canvasPng(canvas), path, project);
      setPath(saved);
      setSavedDoc(state);
      onSaved();
    },
    [renderCanvas, iw, ih, original, onSaved, path],
  );

  const run = useCallback(
    async (task: () => Promise<void>) => {
      if (busy) return;
      setBusy(true);
      try {
        await task();
      } catch (e) {
        notify(errorMessage(e));
      } finally {
        setBusy(false);
      }
    },
    [busy, notify],
  );

  // ---- crop ---------------------------------------------------------------------------------

  const clampArea = (a: Area): Area => {
    const { x, y, width, height } = extent;
    const x0 = clamp(Math.round(a.x), x, x + width);
    const y0 = clamp(Math.round(a.y), y, y + height);
    const x1 = clamp(Math.round(a.x + a.width), x, x + width);
    const y1 = clamp(Math.round(a.y + a.height), y, y + height);
    return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
  };

  const leaveCrop = (
    cancel = false,
    next: Tool = toolBeforeCrop.current,
  ): DocState => {
    let state = history.present;
    if (!cancel && cropDraft) {
      const c = clampArea(cropDraft);
      const value = c.width < 1 || c.height < 1 || sameArea(c, full) ? null : c;
      if (!sameArea(value, crop)) {
        state = { ...state, crop: value };
        history.commit(state);
      }
    }
    setCropDraft(null);
    setZoom(null);
    setToolState(next);
    return state;
  };

  const settleCrop = () => (cropping ? leaveCrop() : history.present);

  const onBar = new Set(bar);
  const setTool = (next: Tool) => {
    // A tool picked from More stays on the bar until another replaces it.
    if (!onBar.has(next)) setRecentTool(next);
    if (next === tool) return;
    finishEditing();
    setSelectedIds([]);
    if (next === "crop") {
      toolBeforeCrop.current = tool;
      setCropDraft(crop ?? full);
      setZoom(null);
      setToolState("crop");
    } else if (cropping) leaveCrop(false, next);
    else setToolState(next);
  };

  const copy = () =>
    run(async () => {
      const state = settleCrop();
      await api.copyPng(await canvasPng(renderCanvas(state.crop)));
      if (state !== savedDoc) await save(state);
      window.clearTimeout(copiedTimer.current);
      setCopied(true);
      copiedTimer.current = window.setTimeout(() => setCopied(false), 1500);
    });

  const saveNow = () =>
    run(async () => {
      await save(settleCrop());
      notify("Saved to the library");
    });

  const close = () =>
    run(async () => {
      const state = settleCrop();
      if (state !== savedDoc) {
        try {
          await save(state);
        } catch (e) {
          const discard = window.confirm(
            `Couldn't save your changes: ${errorMessage(e)}\n\nClose anyway and discard them?`,
          );
          if (!discard) return;
        }
      }
      onClose();
    });

  const saveRef = useRef({ dirty, save: () => save(history.present) });
  useEffect(() => {
    saveRef.current = { dirty, save: () => save(history.present) };
  });
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (saveRef.current.dirty) await saveRef.current.save().catch(() => {});
      const originalBytes = doc.project
        ? doc.project.original
        : new Uint8Array(doc.png);
      const image = await loadImage(bufferOf(originalBytes));
      const state: DocState = doc.project
        ? await projectState(doc.project)
        : { shapes: [], crop: null, base: null };
      if (cancelled) return;
      originalRef.current = originalBytes;
      setOriginal(image);
      setPath(doc.path);
      skipFit.current = true;
      history.reset(state);
      setSavedDoc(state);
      setSelectedIds([]);
      editingRef.current = null;
      setEditing(null);
      setCropDraft(null);
      setZoom(null);
      setToolState((t) => (t === "crop" ? toolBeforeCrop.current : t));
    })().catch((e) => notify(errorMessage(e)));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the document changes
  }, [doc]);

  // ---- shape edits ----------------------------------------------------------------------------

  const commitShapes = (next: Shape[]) =>
    history.commit({ ...history.present, shapes: next });
  /** Adds an object to the latest document (drags and async tools may finish out of order). */
  const addShape = (shape: Shape) =>
    history.commitWith((present) => ({
      ...present,
      shapes: [...present.shapes, shape],
    }));
  const replaceShapes = (next: Shape[]) =>
    history.replace({ ...history.present, shapes: next });

  const update = (id: string, patch: ShapePatch) =>
    commitShapes(
      shapes.map((s) => {
        if (s.id !== id) return s;
        const next = { ...s, ...patch } as Shape;
        return next.type === "text" || next.type === "callout"
          ? fitText(next)
          : next;
      }),
    );

  const selected = shapes.filter((s) => selectedIds.includes(s.id));
  const single = selected.length === 1 ? selected[0] : null;

  /** The panel shows the selected objects' tool, or else the active tool. */
  const panelTool: Tool =
    single && toolOf(single) !== "move"
      ? toolOf(single)
      : selected.length > 1 &&
          selected.every((s) => toolOf(s) === toolOf(selected[0]))
        ? toolOf(selected[0])
        : tool;

  /** The panel's values: the single selected object's, or the tool's. */
  const panelStyles: Styles = (() => {
    if (!single || !(toolOf(single) in styles)) return styles;
    const key = toolOf(single) as StyledTool;
    const s = single as unknown as Record<string, unknown>;
    const merged = { ...styles[key] } as Record<string, unknown>;
    for (const k of Object.keys(merged)) if (k in s) merged[k] = s[k];
    if (single.type === "arrow" || single.type === "line")
      merged.bezier = !!single.control;
    if (single.type === "block") merged.color = single.fill;
    return { ...styles, [key]: merged } as Styles;
  })();

  /** A change from the side panel or a Quick Style: the tool's style and the selection. */
  const applyStyle = (t: StyledTool, patch: QuickStyle) => {
    setStyles({ ...styles, [t]: { ...styles[t], ...patch } } as Styles);
    const targets = selected.filter((s) => toolOf(s) === t);
    if (!targets.length) return;
    const ids = new Set(targets.map((s) => s.id));
    commitShapes(
      shapes.map((s) => {
        if (!ids.has(s.id)) return s;
        const next = { ...s, ...shapePatch(s, patch, bg ?? null) } as Shape;
        return next.type === "text" || next.type === "callout"
          ? fitText(next)
          : next;
      }),
    );
  };

  const applyQuickStyle = (t: StyledTool, style: QuickStyle) => {
    if (tool !== t && !selected.some((s) => toolOf(s) === t))
      setTool(t as Tool);
    applyStyle(t, style);
  };

  const removeSelected = () => {
    if (!selectedIds.length) return;
    const ids = new Set(selectedIds);
    commitShapes(shapes.filter((s) => !ids.has(s.id)));
    setSelectedIds([]);
  };

  const selectAllOf = (t: Tool) => {
    const ids = shapes
      .filter((s) => (t === "move" ? true : toolOf(s) === t))
      .map((s) => s.id);
    setSelectedIds(ids);
  };

  const togglePanel = () =>
    setPanelOpen((open) => {
      try {
        localStorage.setItem(PANEL_KEY, open ? "closed" : "open");
      } catch {
        // Only a preference.
      }
      return !open;
    });

  const paste = () =>
    run(async () => {
      const png = await api.pasteImage();
      if (!png.byteLength) {
        notify("The clipboard doesn't contain an image");
        return;
      }
      const image = await loadImage(png);
      const fit = Math.min(
        1,
        (area.width * 0.8) / image.width,
        (area.height * 0.8) / image.height,
      );
      const width = image.width * fit;
      const height = image.height * fit;
      const shape: Shape = {
        id: newId(),
        type: "image",
        image,
        png,
        x: area.x + (area.width - width) / 2,
        y: area.y + (area.height - height) / 2,
        width,
        height,
      };
      addShape(shape);
      setSelectedIds([shape.id]);
    });

  // ---- text editing -------------------------------------------------------------------------

  const startEditing = (
    shape: TextShape | CalloutShape,
    baseState: DocState,
  ) => {
    setSelectedIds([]);
    editingRef.current = { id: shape.id, base: baseState };
    setEditing(editingRef.current);
  };

  const editingShape = shapes.find((s) => s.id === editing?.id) as
    TextShape | CalloutShape | undefined;

  function finishEditing() {
    const current = editingRef.current;
    if (!current) return;
    editingRef.current = null;
    const present = history.present;
    const shape = present.shapes.find((s) => s.id === current.id);
    // An empty text box disappears; an empty callout stays (it may be just a pointer).
    const next =
      shape && shape.type === "text" && !shape.text.trim()
        ? present.shapes.filter((s) => s.id !== current.id)
        : present.shapes;
    setEditing(null);
    const baseState = current.base;
    const unchanged =
      next.length === baseState.shapes.length &&
      next.every(
        (s, i) =>
          s === baseState.shapes[i] ||
          JSON.stringify(s) === JSON.stringify(baseState.shapes[i]),
      );
    if (unchanged) history.replace(baseState);
    else history.commit({ ...present, shapes: next }, baseState);
    if (shape && next.includes(shape)) setSelectedIds([shape.id]);
  }

  // ---- pixel tools --------------------------------------------------------------------------

  const baseCanvas = () => canvasOf(bg!, iw, ih);

  /** Lifts the masked pixels into a movable image object, leaving a filled hole. */
  const liftToObject = async (
    mask: Uint8Array,
    bbox: Area,
    fill: "transparent" | "auto",
  ) => {
    const canvas = baseCanvas();
    const piece = liftMask(canvas, mask, bbox, fill);
    const [nextBase, png] = await Promise.all([
      toBase(canvas),
      canvasPngBuffer(piece),
    ]);
    const shape: Shape = {
      id: newId(),
      type: "image",
      image: await loadImage(png),
      png,
      x: bbox.x,
      y: bbox.y,
      width: bbox.width,
      height: bbox.height,
    };
    history.commitWith((present) => ({
      ...present,
      base: nextBase,
      shapes: [...present.shapes, shape],
    }));
    setSelectedIds([shape.id]);
  };

  const fillAt = (p: { x: number; y: number }) =>
    run(async () => {
      const s = styles.fill;
      const canvas = baseCanvas();
      const { mask, bbox } = colorMask(canvas, p.x, p.y, s.tolerance);
      if (!bbox) return;
      paintMask(canvas, mask, s.color, s.opacity);
      const nextBase = await toBase(canvas);
      history.commitWith((present) => ({ ...present, base: nextBase }));
    });

  const wandAt = (p: { x: number; y: number }) =>
    run(async () => {
      const s = styles.magicwand;
      const { mask, bbox } = colorMask(
        baseCanvas(),
        p.x,
        p.y,
        s.tolerance,
        s.global,
      );
      if (!bbox) return;
      await liftToObject(mask, bbox, s.fillMode);
    });

  // ---- drawing ------------------------------------------------------------------------------

  const pointer = () =>
    stageRef.current?.getRelativePointerPosition() ?? { x: 0, y: 0 };
  const pointerOf = (evt: PointerEvent) => {
    stageRef.current?.setPointersPositions(evt);
    return pointer();
  };

  const startCropDrag = (e: Konva.KonvaEventObject<MouseEvent>) => {
    if (
      e.target.id() === "crop-rect" ||
      e.target.getParent()?.className === "Transformer"
    )
      return;
    e.evt.preventDefault();
    const inside = (p: { x: number; y: number }) => ({
      x: clamp(p.x, extent.x, extent.x + extent.width),
      y: clamp(p.y, extent.y, extent.y + extent.height),
    });
    const start = inside(pointer());
    const previous = cropDraft;
    trackPointer(
      (evt) => setCropDraft(norm(start, inside(pointerOf(evt)))),
      (evt) => {
        const a = norm(start, inside(pointerOf(evt)));
        const tiny = 4 / viewRef.current.scale;
        setCropDraft(
          a.width < tiny || a.height < tiny ? previous : clampArea(a),
        );
      },
    );
  };

  /** Next number for a new step in `sequence`. */
  const nextStep = (sequence: StepSequence) => {
    const reset = stepReset.current[sequence];
    if (reset !== undefined) {
      stepReset.current[sequence] = reset + 1;
      return reset;
    }
    return (
      Math.max(
        0,
        ...shapes.map((s) =>
          s.type === "step" && s.sequence === sequence ? s.n : 0,
        ),
      ) + 1
    );
  };

  const onStageMouseDown = (e: Konva.KonvaEventObject<MouseEvent>) => {
    if (e.evt.button === 1 || (e.evt.button === 0 && spaceHeld)) {
      e.evt.preventDefault();
      startPan(e.evt);
      return;
    }
    if (editingRef.current) {
      finishEditing();
      return;
    }
    if (e.evt.button !== 0 || !bg) return;
    if (cropping) {
      startCropDrag(e);
      return;
    }
    // Clicks on transformer anchors and handles belong to them.
    if (e.target.getLayer() === uiLayerRef.current) return;
    e.evt.preventDefault();
    const additive = e.evt.shiftKey || e.evt.ctrlKey;
    if (!additive) setSelectedIds([]);
    const start = pointer();

    switch (tool) {
      case "move":
      case "favorites": {
        trackPointer(
          (evt) =>
            setOverlay({ kind: "marquee", area: norm(start, pointerOf(evt)) }),
          (evt) => {
            setOverlay(null);
            const a = norm(start, pointerOf(evt));
            if (a.width < 3 && a.height < 3) return;
            const layer = contentRef.current;
            if (!layer) return;
            const hits = shapes.filter((s) => {
              const node = layer.findOne(`#${s.id}`);
              if (!node) return false;
              const r = node.getClientRect({ relativeTo: layer });
              return (
                r.x < a.x + a.width &&
                r.x + r.width > a.x &&
                r.y < a.y + a.height &&
                r.y + r.height > a.y
              );
            });
            setSelectedIds((ids) => [
              ...new Set([...(additive ? ids : []), ...hits.map((s) => s.id)]),
            ]);
          },
        );
        return;
      }
      case "fill":
        void fillAt(start);
        return;
      case "magicwand":
        void wandAt(start);
        return;
      case "eraser": {
        const s = styles.eraser;
        const pts = [start.x, start.y];
        setOverlay({ kind: "erase", points: pts, width: s.width });
        trackPointer(
          (evt) => {
            const p = pointerOf(evt);
            pts.push(p.x, p.y);
            setOverlay({ kind: "erase", points: [...pts], width: s.width });
          },
          () => {
            setOverlay(null);
            void run(async () => {
              const canvas = baseCanvas();
              eraseStroke(canvas, pts, s.width, s.opacity, s.antialias);
              const nextBase = await toBase(canvas);
              history.commitWith((present) => ({ ...present, base: nextBase }));
            });
          },
        );
        return;
      }
      case "selection": {
        const s = styles.selection;
        const pts = [start.x, start.y];
        const make = (p: { x: number; y: number }): Overlay => {
          if (s.shape === "freehand") pts.push(p.x, p.y);
          const xs = pts.filter((_, i) => i % 2 === 0);
          const ys = pts.filter((_, i) => i % 2 === 1);
          return {
            kind: "select",
            shape: s.shape,
            points: [...pts],
            area:
              s.shape === "freehand"
                ? {
                    x: Math.min(...xs),
                    y: Math.min(...ys),
                    width: Math.max(...xs) - Math.min(...xs),
                    height: Math.max(...ys) - Math.min(...ys),
                  }
                : norm(start, p),
          };
        };
        let last: Overlay | null = null;
        trackPointer(
          (evt) => {
            last = make(pointerOf(evt));
            setOverlay(last);
          },
          () => {
            setOverlay(null);
            const o = last as Extract<Overlay, { kind: "select" }> | null;
            if (!o || o.area.width < 3 || o.area.height < 3) return;
            void run(async () => {
              const { mask, bbox } = shapeMask(
                iw,
                ih,
                o.shape,
                o.area,
                o.points,
              );
              if (bbox) await liftToObject(mask, bbox, s.fillMode);
            });
          },
        );
        return;
      }
      case "cutout": {
        const s = styles.cutout;
        const band = (p: { x: number; y: number }): Overlay => ({
          kind: "band",
          vertical: s.vertical,
          from: clamp(
            Math.min(s.vertical ? start.x : start.y, s.vertical ? p.x : p.y),
            0,
            s.vertical ? iw : ih,
          ),
          to: clamp(
            Math.max(s.vertical ? start.x : start.y, s.vertical ? p.x : p.y),
            0,
            s.vertical ? iw : ih,
          ),
        });
        let last: Overlay | null = null;
        trackPointer(
          (evt) => {
            last = band(pointerOf(evt));
            setOverlay(last);
          },
          () => {
            setOverlay(null);
            const o = last as Extract<Overlay, { kind: "band" }> | null;
            if (!o || o.to - o.from < 2) return;
            void run(async () => {
              const { canvas, shift } = cutOut(
                baseCanvas(),
                o.vertical,
                o.from,
                o.to,
                s.edge,
              );
              const nextBase = await toBase(canvas);
              history.commitWith((present) => ({
                crop: null,
                base: nextBase,
                // Objects beyond the cut move back with the image.
                shapes: present.shapes.map((sh) => {
                  const pos = o.vertical ? sh.x : sh.y;
                  if (pos < o.to) return sh;
                  return o.vertical
                    ? { ...sh, x: sh.x - shift }
                    : { ...sh, y: sh.y - shift };
                }),
              }));
            });
          },
        );
        return;
      }
    }

    const base = { id: newId(), x: start.x, y: start.y };
    switch (tool) {
      case "arrow":
      case "line": {
        const s = styles[tool];
        setDraft({
          ...base,
          type: tool,
          points: [0, 0, 0, 0],
          control: null,
          stroke: s.stroke,
          strokeWidth: s.strokeWidth,
          dash: s.dash,
          startCap: s.startCap,
          endCap: s.endCap,
          startSize: s.startSize,
          endSize: s.endSize,
          opacity: s.opacity,
          shadow: s.shadow,
        });
        break;
      }
      case "pen": {
        const s = styles.pen;
        setDraft({
          ...base,
          type: "pen",
          points: [0, 0],
          stroke: s.stroke,
          strokeWidth: s.strokeWidth,
          nib: s.nib,
          smooth: s.smooth,
          opacity: s.opacity,
          shadow: s.shadow,
        });
        break;
      }
      case "shape": {
        const s = styles.shape;
        setDraft({
          ...base,
          type: "shape",
          kind: s.kind,
          width: 0,
          height: 0,
          fill: s.fill,
          outline: s.outline,
          strokeWidth: s.strokeWidth,
          dash: s.dash,
          opacity: s.opacity,
          shadow: s.shadow,
        });
        break;
      }
      case "highlighter":
        setDraft({
          ...base,
          type: "highlight",
          width: 0,
          height: 0,
          color: styles.highlighter.color,
          opacity: styles.highlighter.opacity,
        });
        break;
      case "blur": {
        const s = styles.blur;
        setDraft({
          ...base,
          type: "blur",
          mode: s.mode,
          ellipse: s.ellipse,
          intensity: s.intensity,
          color: s.color,
          width: 0,
          height: 0,
        });
        break;
      }
      case "magnify": {
        const s = styles.magnify;
        setDraft({
          ...base,
          type: "magnify",
          lens: s.lens,
          scale: s.scale,
          outline: s.outline,
          strokeWidth: s.strokeWidth,
          width: 0,
          height: 0,
        });
        break;
      }
      case "simplify": {
        const s = styles.simplify;
        setDraft({
          ...base,
          type: "block",
          width: 0,
          height: 0,
          fill: s.color ?? "#9aa4b2",
          radius: s.radius,
          opacity: s.opacity,
        });
        break;
      }
      case "stamp": {
        const s = styles.stamp;
        setDraft({
          ...base,
          type: "stamp",
          glyph: s.glyph,
          width: 0,
          height: 0,
          opacity: s.opacity,
          shadow: s.shadow,
        });
        break;
      }
      case "text": {
        const s = styles.text;
        setDraft({
          ...base,
          type: "text",
          text: "",
          width: 0,
          height: 0,
          font: s.font,
          fontSize: s.fontSize,
          textColor: s.textColor,
          outline: s.outline,
          outlineWidth: s.outlineWidth,
          bold: s.bold,
          italic: s.italic,
          underline: s.underline,
          align: s.align,
          valign: s.valign,
          padding: s.padding,
          opacity: s.opacity,
          shadow: s.shadow,
        });
        break;
      }
      case "callout": {
        const s = styles.callout;
        setDraft({
          ...base,
          type: "callout",
          text: "",
          width: 0,
          height: 0,
          body: s.body,
          fill: s.fill,
          outline: s.outline,
          strokeWidth: s.strokeWidth,
          dash: s.dash,
          font: s.font,
          fontSize: s.fontSize,
          textColor: s.textColor,
          bold: s.bold,
          italic: s.italic,
          underline: s.underline,
          align: s.align,
          valign: s.valign,
          padding: s.padding,
          tail: null,
          arrowColor: s.arrowColor,
          arrowWidth: s.arrowWidth,
          arrowDash: s.arrowDash,
          arrowCap: s.arrowCap,
          opacity: s.opacity,
          shadow: s.shadow,
        });
        break;
      }
      case "step": {
        const s = styles.step;
        const shape: Shape = {
          ...base,
          type: "step",
          n: nextStep(s.sequence),
          sequence: s.sequence,
          style: s.style,
          size: s.size,
          fill: s.fill,
          textColor: s.textColor,
          opacity: s.opacity,
          shadow: s.shadow,
          pointAngle: 135,
        };
        addShape(shape);
        setSelectedIds([shape.id]);
        return;
      }
      default:
        return;
    }
    trackPointer(
      (evt) => onDraftMove(start, pointerOf(evt), evt.shiftKey),
      () => onDraftUp(start),
    );
  };

  const onDraftMove = (
    start: { x: number; y: number },
    p: { x: number; y: number },
    shift: boolean,
  ) => {
    const current = draftRef.current;
    if (!current) return;
    let dx = p.x - start.x;
    let dy = p.y - start.y;
    switch (current.type) {
      case "arrow":
      case "line": {
        if (shift) [dx, dy] = snap45(dx, dy);
        const bezier = styles[current.type].bezier;
        setDraft({
          ...current,
          points: [0, 0, dx, dy],
          control: bezier ? { x: dx / 2, y: dy / 2 } : null,
        });
        return;
      }
      case "pen":
        setDraft({ ...current, points: [...current.points, dx, dy] });
        return;
      default: {
        if (shift && current.type !== "text" && current.type !== "callout") {
          const side = Math.max(Math.abs(dx), Math.abs(dy));
          dx = Math.sign(dx || 1) * side;
          dy = Math.sign(dy || 1) * side;
        }
        setDraft({
          ...current,
          ...norm(start, { x: start.x + dx, y: start.y + dy }),
        } as Shape);
      }
    }
  };

  const onDraftUp = (start: { x: number; y: number }) => {
    const current = draftRef.current;
    setDraft(null);
    if (!current) return;
    const tiny = 4 / viewRef.current.scale;
    let shape: Shape | null = current;
    switch (current.type) {
      case "arrow":
      case "line":
        if (Math.hypot(current.points[2], current.points[3]) < tiny)
          shape = null;
        break;
      case "pen":
        if (current.points.length < 4) shape = null;
        break;
      case "stamp": {
        const size =
          current.width < tiny ? 72 : Math.max(current.width, current.height);
        shape =
          current.width < tiny
            ? {
                ...current,
                x: start.x - size / 2,
                y: start.y - size / 2,
                width: size,
                height: size,
              }
            : current;
        break;
      }
      case "magnify":
        if (current.width < tiny)
          shape = {
            ...current,
            x: start.x - 75,
            y: start.y - 75,
            width: 150,
            height: 150,
          };
        break;
      case "text": {
        const width =
          current.width < tiny * 4
            ? Math.max(160, current.fontSize * 9)
            : current.width;
        const y =
          current.width < tiny * 4
            ? start.y -
              (current.fontSize * TEXT_LINE_HEIGHT) / 2 -
              current.padding
            : current.y;
        shape = fitText({ ...current, y, width });
        break;
      }
      case "callout": {
        const clicked = current.width < tiny * 4;
        const width = clicked
          ? Math.max(180, current.fontSize * 11)
          : current.width;
        const minH = measureText(current, width);
        const height = clicked ? minH : Math.max(minH, current.height);
        const x = clicked ? start.x + 30 : current.x;
        const y = clicked ? start.y - height - 50 : current.y;
        const tail = clicked
          ? { x: start.x - x, y: start.y - y }
          : { x: width * 0.2, y: height + Math.max(40, height * 0.6) };
        shape = { ...current, x, y, width, height, tail };
        break;
      }
      case "block": {
        if (current.width < 3 || current.height < 3) shape = null;
        else if (!styles.simplify.color && bg) {
          shape = { ...current, fill: dominantColor(baseCanvas(), current) };
        }
        break;
      }
      default:
        if ("width" in current && (current.width < 3 || current.height < 3))
          shape = null;
    }
    if (!shape) return;
    if (shape.type === "text" || shape.type === "callout") {
      const before = history.present;
      replaceShapes([...shapes, shape]);
      startEditing(shape, before);
    } else {
      addShape(shape);
      setSelectedIds([shape.id]);
    }
  };

  // ---- selecting and moving objects ---------------------------------------------------------

  const selectShape = (id: string, additive: boolean) => {
    if (editingRef.current) finishEditing();
    setSelectedIds((ids) =>
      additive
        ? ids.includes(id)
          ? ids.filter((x) => x !== id)
          : [...ids, id]
        : ids.includes(id)
          ? ids
          : [id],
    );
  };

  const dragStart = useRef<Map<string, { x: number; y: number }> | null>(null);
  const onShapeDragMove = (id: string, node: Konva.Node) => {
    const group = selectedIds.includes(id) ? selectedIds : [id];
    if (!dragStart.current) {
      setMoving(true);
      dragStart.current = new Map(
        shapes
          .filter((s) => group.includes(s.id))
          .map((s) => [s.id, { x: s.x, y: s.y }]),
      );
    }
    const origin = dragStart.current.get(id);
    if (!origin) return;
    const dx = node.x() - origin.x;
    const dy = node.y() - origin.y;
    for (const [other, pos] of dragStart.current) {
      if (other === id) continue;
      contentRef.current
        ?.findOne(`#${other}`)
        ?.position({ x: pos.x + dx, y: pos.y + dy });
    }
  };
  const onShapeDragEnd = (id: string, node: Konva.Node) => {
    const starts =
      dragStart.current ?? new Map([[id, { x: node.x(), y: node.y() }]]);
    dragStart.current = null;
    setMoving(false);
    const origin = starts.get(id) ?? { x: node.x(), y: node.y() };
    const dx = node.x() - origin.x;
    const dy = node.y() - origin.y;
    if (!dx && !dy) return;
    commitShapes(
      shapes.map((s) => {
        const pos = starts.get(s.id);
        return pos ? { ...s, x: pos.x + dx, y: pos.y + dy } : s;
      }),
    );
    if (!selectedIds.includes(id)) setSelectedIds([id]);
  };

  // Selection frame: Snagit-style square handles, a round rotate handle; lines get their own.
  const lineSelected =
    single && (single.type === "arrow" || single.type === "line");
  useEffect(() => {
    const tr = trRef.current;
    const layer = contentRef.current;
    if (!tr || !layer) return;
    const nodes = lineSelected
      ? []
      : selectedIds
          .map((id) => layer.findOne(`#${id}`))
          .filter((n): n is Konva.Node => !!n);
    tr.nodes(nodes);
    const t = single?.type;
    const multi = selected.length > 1;
    tr.resizeEnabled(!multi);
    tr.rotateEnabled(
      !multi &&
        (t === "shape" ||
          t === "text" ||
          t === "stamp" ||
          t === "image" ||
          t === "pen"),
    );
    tr.keepRatio(t === "stamp" || t === "image" || t === "step");
    tr.enabledAnchors(
      t === "step"
        ? ["top-left", "top-right", "bottom-left", "bottom-right"]
        : t === "text"
          ? [
              "top-left",
              "top-right",
              "bottom-left",
              "bottom-right",
              "middle-left",
              "middle-right",
            ]
          : [
              "top-left",
              "top-center",
              "top-right",
              "middle-left",
              "middle-right",
              "bottom-left",
              "bottom-center",
              "bottom-right",
            ],
    );
    tr.getLayer()?.batchDraw();
  });

  const hasCropDraft = cropDraft !== null;
  useEffect(() => {
    const tr = cropTrRef.current;
    const node = stageRef.current?.findOne("#crop-rect");
    if (!tr) return;
    tr.nodes(cropping && node ? [node] : []);
    tr.getLayer()?.batchDraw();
  }, [cropping, hasCropDraft]);

  // ---- handle drags (endpoints, curve, callout tail, corner radius, step point) ------------

  const handleBase = useRef<DocState | null>(null);
  const dragHandle =
    (
      id: string,
      patchFor: (local: { x: number; y: number }, s: Shape) => ShapePatch,
    ) =>
    (e: Konva.KonvaEventObject<DragEvent>) => {
      const present = history.present;
      if (!handleBase.current) handleBase.current = present;
      const node = contentRef.current?.findOne(`#${id}`);
      const shape = present.shapes.find((s) => s.id === id);
      if (!node || !shape) return;
      const local = node
        .getTransform()
        .copy()
        .invert()
        .point(e.target.position());
      history.replace({
        ...present,
        shapes: present.shapes.map((s) =>
          s.id === id ? ({ ...s, ...patchFor(local, s) } as Shape) : s,
        ),
      });
    };
  const endHandle = () => {
    const before = handleBase.current;
    handleBase.current = null;
    if (before && before !== history.present)
      history.commit(history.present, before);
  };

  // ---- canvas auto-expand -----------------------------------------------------------------

  // Like Snagit's "Automatically expand the canvas to fit objects": an object added, moved
  // or resized past the canvas edge grows the canvas (transparent) to fit it. Only objects
  // that just changed count, so a crop that cuts through an older object stays put.
  // The growth rides on the edit's own undo step (it replaces the present).
  const undo = () => {
    if (history.canUndo) skipFit.current = true;
    history.undo();
  };
  const redo = () => {
    if (history.canRedo) skipFit.current = true;
    history.redo();
  };
  useLayoutEffect(() => {
    const prev = fitShapes.current;
    if (skipFit.current || prev === null) {
      skipFit.current = false;
      fitShapes.current = shapes;
      return;
    }
    // Wait until a handle drag or text edit is committed, then compare with before it.
    if (handleBase.current || editingRef.current || cropping) return;
    fitShapes.current = shapes;
    if (shapes === prev) return;
    if (!iw || !ih) return;
    const before = new Set(prev);
    let need: Area | null = null;
    for (const s of shapes) {
      if (before.has(s)) continue;
      const r = shapeBounds(s);
      if (!r.width && !r.height) continue;
      need = need ? union(need, r) : r;
    }
    if (!need) return;
    const current = crop ?? full;
    const grown = union(current, {
      x: Math.floor(need.x),
      y: Math.floor(need.y),
      width: Math.ceil(need.x + need.width) - Math.floor(need.x),
      height: Math.ceil(need.y + need.height) - Math.floor(need.y),
    });
    if (sameArea(grown, current)) return;
    history.replace({
      ...history.present,
      crop: sameArea(grown, full) ? null : grown,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs when the document changes
  }, [history.present]);

  // ---- keyboard ---------------------------------------------------------------------------

  const keys = useRef<(e: KeyboardEvent) => void>(() => {});
  const onKeyDown = (e: KeyboardEvent) => {
    const target = e.target as HTMLElement;
    if (["TEXTAREA", "INPUT", "SELECT"].includes(target.tagName)) return;
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    if (mod && key === "z" && !e.shiftKey) undo();
    else if (mod && (key === "y" || (key === "z" && e.shiftKey))) redo();
    else if (mod && key === "c") void copy();
    else if (mod && key === "s") void saveNow();
    else if (mod && key === "v") void paste();
    else if (mod && key === "a") setSelectedIds(shapes.map((s) => s.id));
    else if (mod && (key === "=" || key === "+")) stepZoom(1);
    else if (mod && key === "-") stepZoom(-1);
    else if (mod && key === "0") fitToWindow();
    else if (mod && key === "1") zoomTo(1 / dpr);
    else if (e.key === " ") setSpaceHeld(true);
    else if (cropping && e.key === "Enter") leaveCrop();
    else if (
      (e.key === "Delete" || e.key === "Backspace") &&
      selectedIds.length
    )
      removeSelected();
    else if (e.key.startsWith("Arrow") && selectedIds.length) {
      const step = e.shiftKey ? 10 : 1;
      const dx =
        e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
      const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
      commitShapes(
        shapes.map((s) =>
          selectedIds.includes(s.id) ? { ...s, x: s.x + dx, y: s.y + dy } : s,
        ),
      );
    } else if (e.key === "Escape") {
      if (cropping) leaveCrop(true);
      else if (selectedIds.length) setSelectedIds([]);
    } else if (!mod && !e.altKey) {
      const match = (Object.entries(TOOL_KEYS) as [Tool, string][]).find(
        ([, k]) => k.toLowerCase() === key,
      );
      if (!match) return;
      setTool(match[0]);
    } else return;
    e.preventDefault();
  };
  useEffect(() => {
    keys.current = onKeyDown;
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => keys.current(e);
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === " ") setSpaceHeld(false);
    };
    const onBlur = () => setSpaceHeld(false);
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

  // ---- render -------------------------------------------------------------------------------

  const visibleShapes = draft ? [...shapes, draft] : shapes;
  const shown = cropping && cropDraft ? cropDraft : area;
  const pixelTool = PIXEL_TOOLS.has(tool);
  const cursor = panning
    ? "grabbing"
    : spaceHeld && zoom
      ? "grab"
      : tool === "move" || tool === "favorites"
        ? "default"
        : "crosshair";

  const toScreen = (a: Area) => ({
    left: view.x + a.x * view.scale,
    top: view.y + a.y * view.scale,
    width: a.width * view.scale,
    height: a.height * view.scale,
  });
  const cropBox = cropping && cropDraft ? toScreen(cropDraft) : null;
  const sizing =
    draft && "width" in draft && draft.type !== "text" && draft.width > 0
      ? draft
      : null;
  const sizingBox =
    sizing && "height" in sizing ? toScreen(sizing as Area) : null;
  const hs = 1 / view.scale;
  // While an object is dragged or drawn it shows past the canvas edge; dropping it there
  // grows the canvas.
  const unclipped = (moving || !!draft) && !cropping;

  return (
    <div className="flex h-full flex-col bg-white dark:bg-zinc-900">
      <Toolbar
        tool={tool}
        onTool={setTool}
        bar={bar}
        onBar={setBar}
        recent={recentTool}
        canUndo={history.canUndo}
        canRedo={history.canRedo}
        onUndo={undo}
        onRedo={redo}
        onLibrary={() => void close()}
        onCapture={() =>
          void startCapture("interactive").catch((e) => notify(errorMessage(e)))
        }
        onCopy={() => void copy()}
        onSave={() => void saveNow()}
        busy={busy}
        copied={copied}
      />

      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <div
            ref={containerRef}
            className="relative min-h-0 flex-1 overflow-hidden bg-[#f3f4f6] dark:bg-zinc-950"
          >
            {bg && (
              <>
                <div
                  className="checkerboard pointer-events-none absolute shadow-[0_2px_12px_rgba(0,0,0,0.25)]"
                  style={toScreen(area)}
                />
                <Stage
                  ref={stageRef}
                  width={viewport.width}
                  height={viewport.height}
                  x={view.x}
                  y={view.y}
                  scaleX={view.scale}
                  scaleY={view.scale}
                  onMouseDown={onStageMouseDown}
                  style={{ position: "absolute", inset: 0, cursor }}
                >
                  <Layer
                    ref={contentRef}
                    clipX={unclipped ? undefined : area.x}
                    clipY={unclipped ? undefined : area.y}
                    clipWidth={unclipped ? undefined : area.width}
                    clipHeight={unclipped ? undefined : area.height}
                  >
                    <KImage image={bg} name="background" listening={false} />
                    {visibleShapes.map((shape) => (
                      <ShapeNode
                        key={shape.id}
                        shape={shape}
                        background={bg}
                        selectable={
                          !pixelTool && !spaceHeld && shape !== draft && !draft
                        }
                        editing={shape.id === editing?.id}
                        onSelect={selectShape}
                        onChange={update}
                        onDragMove={onShapeDragMove}
                        onDragEnd={onShapeDragEnd}
                        onEdit={(id) => {
                          const s = shapes.find((x) => x.id === id);
                          if (s && (s.type === "text" || s.type === "callout"))
                            startEditing(s, history.present);
                        }}
                      />
                    ))}
                  </Layer>

                  {/* Editing chrome: never exported, and not clipped to the crop. */}
                  <Layer ref={uiLayerRef}>
                    {cropping && cropDraft && (
                      <CropBox
                        area={cropDraft}
                        bounds={extent}
                        viewRef={viewRef}
                        onChange={setCropDraft}
                        onDone={(a) => setCropDraft(clampArea(a))}
                      />
                    )}
                    {overlay && (
                      <OverlayView
                        overlay={overlay}
                        scale={view.scale}
                        iw={iw}
                        ih={ih}
                      />
                    )}
                    <Transformer
                      ref={trRef}
                      rotateAnchorOffset={22}
                      anchorSize={8}
                      anchorCornerRadius={0}
                      anchorFill="#ffffff"
                      anchorStroke="#2f2f2f"
                      anchorStrokeWidth={1}
                      borderStroke="#2f2f2f"
                      borderStrokeWidth={1}
                      borderDash={[4, 3]}
                      ignoreStroke
                      anchorStyleFunc={(anchor) => {
                        if (anchor.hasName("rotater")) {
                          anchor.cornerRadius(anchor.width() / 2);
                          anchor.fill("#ffffff");
                        }
                      }}
                      boundBoxFunc={(oldBox, box) =>
                        Math.abs(box.width) < 6 || Math.abs(box.height) < 6
                          ? oldBox
                          : box
                      }
                    />
                    {single && !editing && !draft && (
                      <ObjectHandles
                        shape={single}
                        hs={hs}
                        dragHandle={dragHandle}
                        endHandle={endHandle}
                      />
                    )}
                    <Transformer
                      ref={cropTrRef}
                      rotateEnabled={false}
                      flipEnabled={false}
                      keepRatio={false}
                      borderEnabled={false}
                      anchorSize={10}
                      anchorCornerRadius={0}
                      anchorStroke="#2f2f2f"
                      boundBoxFunc={(oldBox, box) => {
                        const v = viewRef.current;
                        const left = Math.max(v.x + extent.x * v.scale, box.x);
                        const top = Math.max(v.y + extent.y * v.scale, box.y);
                        const right = Math.min(
                          v.x + (extent.x + extent.width) * v.scale,
                          box.x + box.width,
                        );
                        const bottom = Math.min(
                          v.y + (extent.y + extent.height) * v.scale,
                          box.y + box.height,
                        );
                        if (right - left < 8 || bottom - top < 8) return oldBox;
                        return {
                          x: left,
                          y: top,
                          width: right - left,
                          height: bottom - top,
                          rotation: 0,
                        };
                      }}
                    />
                  </Layer>
                </Stage>

                {editingShape && (
                  <TextEditor
                    shape={editingShape}
                    view={view}
                    onChange={(text) =>
                      replaceShapes(
                        history.present.shapes.map((s) =>
                          s.id === editingShape.id
                            ? fitText({
                                ...(s as TextShape | CalloutShape),
                                text,
                              })
                            : s,
                        ),
                      )
                    }
                    onDone={finishEditing}
                  />
                )}
              </>
            )}

            {cropBox && (
              <CropBar
                box={cropBox}
                viewport={viewport}
                width={Math.round(shown.width)}
                height={Math.round(shown.height)}
                onReset={() => setCropDraft(full)}
                onCancel={() => leaveCrop(true)}
                onApply={() => leaveCrop()}
              />
            )}

            {sizing && sizingBox && (
              <div
                className="pointer-events-none absolute rounded bg-zinc-900/85 px-1.5 py-0.5 text-[11px] text-white tabular-nums shadow"
                style={{
                  left: Math.min(
                    sizingBox.left + sizingBox.width + 8,
                    viewport.width - 90,
                  ),
                  top: Math.min(
                    sizingBox.top + sizingBox.height + 8,
                    viewport.height - 24,
                  ),
                }}
              >
                {Math.round((sizing as Area).width)} ×{" "}
                {Math.round((sizing as Area).height)}
              </div>
            )}
          </div>

          {showRecent && (
            <RecentTray current={path} onOpen={(p) => onOpenSnip?.(p)} />
          )}
        </div>

        {panelOpen && (
          <SidePanel
            tool={panelTool}
            styles={panelStyles}
            onStyle={applyStyle}
            theme={theme}
            onTheme={setTheme}
            favorites={favorites}
            onToggleFavorite={toggleFavorite}
            onQuickStyle={applyQuickStyle}
            selectedCount={selected.length}
            onSelectAll={
              QUICK_STYLE_TOOLS.has(panelTool) ||
              panelTool === "stamp" ||
              panelTool === "move"
                ? () => selectAllOf(panelTool)
                : undefined
            }
            onResetSteps={() => {
              stepReset.current[styles.step.sequence] = 1;
              notify("The next step starts again at the beginning");
            }}
          />
        )}
      </div>

      <div className="flex h-10 shrink-0 items-center gap-3 border-t border-zinc-300 bg-white px-2 text-xs text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
        <button
          type="button"
          aria-pressed={showRecent}
          onClick={() => setShowRecent((v) => !v)}
          className={`flex h-7 items-center gap-1.5 rounded border px-2.5 text-[13px] ${
            showRecent
              ? "border-zinc-400 bg-zinc-200 dark:border-zinc-500 dark:bg-zinc-700"
              : "border-zinc-300 hover:bg-zinc-100 dark:border-zinc-600 dark:hover:bg-zinc-800"
          }`}
        >
          <RecentIcon /> {showRecent ? "Hide Recent" : "Show Recent"}
        </button>
        <div className="flex flex-1 items-center justify-center gap-3">
          <span className="flex items-center gap-1">
            <ZoomIcon />
            <Dropdown
              className="h-6 w-[72px] border-transparent"
              value={zoom ? Math.round(view.scale * dpr * 100) : -1}
              renderValue={() => `${Math.round(view.scale * dpr * 100)}%`}
              onChange={(v) =>
                v === -1 ? fitToWindow() : zoomTo(v / 100 / dpr)
              }
              options={[
                { value: -1, label: "Fit in window" },
                ...[25, 50, 75, 100, 150, 200, 300, 400].map((z) => ({
                  value: z,
                  label: `${z}%`,
                })),
              ]}
            />
          </span>
          <span className="tabular-nums">
            {Math.round(shown.width)} x {Math.round(shown.height)}px
          </span>
          {dirty && <span className="text-zinc-400">· Unsaved changes</span>}
        </div>
        <button
          type="button"
          title="Show or hide the Quick Styles and Tool Properties panel"
          aria-pressed={panelOpen}
          onClick={togglePanel}
          className={`flex h-7 items-center gap-1.5 rounded border px-2.5 text-[13px] ${
            panelOpen
              ? "border-zinc-400 bg-zinc-200 dark:border-zinc-500 dark:bg-zinc-700"
              : "border-zinc-300 hover:bg-zinc-100 dark:border-zinc-600 dark:hover:bg-zinc-800"
          }`}
        >
          <GearIcon /> Properties
        </button>
      </div>
    </div>
  );
}

/** Handles specific to an object type, drawn over it (sizes are in screen pixels). */
function ObjectHandles({
  shape,
  hs,
  dragHandle,
  endHandle,
}: {
  shape: Shape;
  hs: number;
  dragHandle: (
    id: string,
    patchFor: (local: { x: number; y: number }, s: Shape) => ShapePatch,
  ) => (e: Konva.KonvaEventObject<DragEvent>) => void;
  endHandle: () => void;
}) {
  // Objects are placed by position and rotation only, so their transform is easy to rebuild.
  const t = new Konva.Transform()
    .translate(shape.x, shape.y)
    .rotate(((shape.rotation ?? 0) * Math.PI) / 180);
  const at = (x: number, y: number) => t.point({ x, y });
  const cursorOn = (e: Konva.KonvaEventObject<MouseEvent>, c: string) => {
    const el = e.target.getStage()?.container();
    if (el) el.style.cursor = c;
  };
  /** A white endpoint dot, like Snagit's line handles. */
  const dot = (
    key: string,
    pos: { x: number; y: number },
    onMove: (e: Konva.KonvaEventObject<DragEvent>) => void,
  ) => (
    <Circle
      key={key}
      x={pos.x}
      y={pos.y}
      radius={5.5 * hs}
      fill="#ffffff"
      stroke="#2f2f2f"
      strokeWidth={1.2 * hs}
      draggable
      onDragMove={onMove}
      onDragEnd={endHandle}
      onMouseEnter={(e) => cursorOn(e, "crosshair")}
      onMouseLeave={(e) => cursorOn(e, "")}
    />
  );
  /** A yellow diamond: Snagit's handle for adjusting a shape rather than resizing it. */
  const diamond = (
    key: string,
    pos: { x: number; y: number },
    onMove: (e: Konva.KonvaEventObject<DragEvent>) => void,
  ) => (
    <Rect
      key={key}
      x={pos.x}
      y={pos.y}
      width={9 * hs}
      height={9 * hs}
      offsetX={4.5 * hs}
      offsetY={4.5 * hs}
      rotation={45}
      fill="#ffd400"
      stroke="#3b3b3b"
      strokeWidth={1 * hs}
      draggable
      onDragMove={onMove}
      onDragEnd={endHandle}
      onMouseEnter={(e) => cursorOn(e, "pointer")}
      onMouseLeave={(e) => cursorOn(e, "")}
    />
  );

  switch (shape.type) {
    case "arrow":
    case "line": {
      const [x0, y0, x1, y1] = shape.points;
      const mid = shape.control ?? null;
      return (
        <>
          <Line
            points={[at(x0, y0).x, at(x0, y0).y, at(x1, y1).x, at(x1, y1).y]}
            stroke="#2f2f2f"
            strokeWidth={hs}
            dash={[4 * hs, 3 * hs]}
            listening={false}
            visible={!!mid}
          />
          {dot(
            "start",
            at(x0, y0),
            dragHandle(shape.id, (p, s) => {
              const l = s as LineShape;
              return { points: [p.x, p.y, l.points[2], l.points[3]] };
            }),
          )}
          {dot(
            "end",
            at(x1, y1),
            dragHandle(shape.id, (p, s) => {
              const l = s as LineShape;
              return { points: [l.points[0], l.points[1], p.x, p.y] };
            }),
          )}
          {mid &&
            diamond(
              "curve",
              at(mid.x, mid.y),
              dragHandle(shape.id, (p) => ({ control: { x: p.x, y: p.y } })),
            )}
        </>
      );
    }
    case "callout":
      return shape.tail
        ? diamond(
            "tail",
            at(shape.tail.x, shape.tail.y),
            dragHandle(shape.id, (p) => ({ tail: { x: p.x, y: p.y } })),
          )
        : null;
    case "shape": {
      if (shape.kind !== "rounded") return null;
      const r = Math.min(
        shape.radius ?? Math.min(shape.width, shape.height) * 0.15,
        shape.width / 2,
        shape.height / 2,
      );
      return diamond(
        "radius",
        at(r, 0),
        dragHandle(shape.id, (p, s) => {
          const b = s as typeof shape;
          return { radius: clamp(p.x, 0, Math.min(b.width, b.height) / 2) };
        }),
      );
    }
    case "step": {
      if (shape.style !== "circlePoint" && shape.style !== "squarePoint")
        return null;
      const tip = stepPointer(shape.size, shape.pointAngle ?? 135)[1];
      return diamond(
        "point",
        at(tip.x, tip.y),
        dragHandle(shape.id, (p) => ({
          pointAngle: (Math.atan2(p.y, p.x) * 180) / Math.PI,
        })),
      );
    }
    default:
      return null;
  }
}

/** Previews for pixel tools and the marquee. */
function OverlayView({
  overlay,
  scale,
  iw,
  ih,
}: {
  overlay: Overlay;
  scale: number;
  iw: number;
  ih: number;
}) {
  const hs = 1 / scale;
  const ants = {
    stroke: "#111" as string,
    strokeWidth: hs,
    dash: [4 * hs, 4 * hs],
    listening: false as boolean,
  };
  const antsLight = { ...ants, stroke: "#fff", dashOffset: 4 * hs };
  switch (overlay.kind) {
    case "marquee":
      return (
        <>
          <Rect {...overlay.area} fill="rgba(108,108,255,0.12)" {...ants} />
          <Rect {...overlay.area} {...antsLight} />
        </>
      );
    case "select": {
      const a = overlay.area;
      if (overlay.shape === "freehand")
        return (
          <>
            <Line points={overlay.points} closed {...ants} />
            <Line points={overlay.points} closed {...antsLight} />
          </>
        );
      if (overlay.shape === "ellipse") {
        const e = {
          x: a.x + a.width / 2,
          y: a.y + a.height / 2,
          radiusX: a.width / 2,
          radiusY: a.height / 2,
        };
        return (
          <>
            <Ellipse {...e} {...ants} />
            <Ellipse {...e} {...antsLight} />
          </>
        );
      }
      return (
        <>
          <Rect {...a} {...ants} />
          <Rect {...a} {...antsLight} />
        </>
      );
    }
    case "band": {
      const r = overlay.vertical
        ? {
            x: overlay.from,
            y: 0,
            width: overlay.to - overlay.from,
            height: ih,
          }
        : {
            x: 0,
            y: overlay.from,
            width: iw,
            height: overlay.to - overlay.from,
          };
      return (
        <Rect
          {...r}
          fill="rgba(229,25,28,0.25)"
          stroke="#e5191c"
          strokeWidth={hs}
          dash={[5 * hs, 3 * hs]}
          listening={false}
        />
      );
    }
    case "erase":
      return (
        <Line
          points={overlay.points}
          stroke="rgba(255,255,255,0.75)"
          strokeWidth={overlay.width}
          lineCap="round"
          lineJoin="round"
          shadowColor="#000"
          shadowBlur={2}
          listening={false}
        />
      );
  }
}

/** Snagit's bottom tray: recent captures, click one to open it. */
function RecentTray({
  current,
  onOpen,
}: {
  current: string | null;
  onOpen: (path: string) => void;
}) {
  const [snips, setSnips] = useState<Snip[] | null>(null);
  useEffect(() => {
    api
      .listSnips()
      .then((list) =>
        setSnips(
          [...list].sort((a, b) => b.modified - a.modified).slice(0, 40),
        ),
      )
      .catch(() => setSnips([]));
  }, [current]);
  return (
    <div className="flex h-[92px] shrink-0 items-center gap-2 overflow-x-auto border-t border-zinc-300 bg-zinc-100 px-2 dark:border-zinc-700 dark:bg-zinc-900">
      {snips === null ? (
        <span className="text-xs text-zinc-500">Loading…</span>
      ) : snips.length === 0 ? (
        <span className="text-xs text-zinc-500">No recent captures</span>
      ) : (
        snips.map((s) => (
          <button
            key={s.path}
            type="button"
            title={s.name}
            onClick={() => onOpen(s.path)}
            className={`flex h-[74px] w-[104px] shrink-0 items-center justify-center overflow-hidden rounded border-2 bg-white dark:bg-zinc-800 ${
              s.path === current
                ? "border-[#2b7bd6]"
                : "border-transparent hover:border-zinc-300"
            }`}
          >
            <img
              src={snipUrl(s)}
              alt=""
              className="max-h-full max-w-full object-contain"
              draggable={false}
            />
          </button>
        ))
      )}
    </div>
  );
}

/** Size and actions for the crop, floating under the crop box (Snagit's crop floaty). */
function CropBar({
  box,
  viewport,
  width,
  height,
  onReset,
  onCancel,
  onApply,
}: {
  box: { left: number; top: number; width: number; height: number };
  viewport: { width: number; height: number };
  width: number;
  height: number;
  onReset: () => void;
  onCancel: () => void;
  onApply: () => void;
}) {
  const barWidth = 290;
  const left = clamp(
    box.left + box.width / 2 - barWidth / 2,
    8,
    Math.max(8, viewport.width - barWidth - 8),
  );
  const below = box.top + box.height + 10;
  const top =
    below + 40 <= viewport.height
      ? below
      : Math.max(8, box.top + box.height - 48);
  return (
    <div
      className="absolute flex items-center gap-1 rounded-md border border-zinc-300 bg-white p-1 text-sm text-zinc-800 shadow-lg dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
      style={{ left, top, width: barWidth }}
    >
      <span className="flex-1 px-2 text-xs text-zinc-500 tabular-nums">
        {width} × {height}
      </span>
      <button
        type="button"
        title="Select the whole image"
        onClick={onReset}
        className="rounded px-2 py-1 hover:bg-zinc-100 dark:hover:bg-zinc-700"
      >
        Reset
      </button>
      <button
        type="button"
        title="Cancel (Esc)"
        onClick={onCancel}
        className="rounded px-2 py-1 hover:bg-zinc-100 dark:hover:bg-zinc-700"
      >
        Cancel
      </button>
      <button
        type="button"
        title="Crop (Enter)"
        onClick={onApply}
        className="rounded bg-brand-600 px-3 py-1 font-medium text-white hover:bg-brand-500"
      >
        Crop
      </button>
    </div>
  );
}

function CropBox({
  area,
  bounds,
  viewRef,
  onChange,
  onDone,
}: {
  area: Area;
  /** The image plus any grown canvas: what the crop can cover. */
  bounds: Area;
  viewRef: React.RefObject<View>;
  onChange: (area: Area) => void;
  onDone: (area: Area) => void;
}) {
  const fromNode = (node: Konva.Node): Area => ({
    x: node.x(),
    y: node.y(),
    width: node.width() * node.scaleX(),
    height: node.height() * node.scaleY(),
  });
  const { x, y, width, height } = area;
  const whole = width >= bounds.width && height >= bounds.height;
  return (
    <>
      <KShape
        listening={false}
        fill="rgba(0,0,0,0.55)"
        fillRule="evenodd"
        sceneFunc={(ctx, node) => {
          ctx.beginPath();
          ctx.rect(bounds.x, bounds.y, bounds.width, bounds.height);
          ctx.rect(x, y, width, height);
          ctx.fillStrokeShape(node);
        }}
      />
      <KShape
        listening={false}
        stroke="rgba(255,255,255,0.4)"
        strokeWidth={1}
        strokeScaleEnabled={false}
        sceneFunc={(ctx, node) => {
          ctx.beginPath();
          for (const t of [1 / 3, 2 / 3]) {
            ctx.moveTo(x + width * t, y);
            ctx.lineTo(x + width * t, y + height);
            ctx.moveTo(x, y + height * t);
            ctx.lineTo(x + width, y + height * t);
          }
          ctx.fillStrokeShape(node);
        }}
      />
      <Rect
        id="crop-rect"
        x={x}
        y={y}
        width={width}
        height={height}
        fill="rgba(0,0,0,0)"
        stroke="#ffffff"
        strokeWidth={1.5}
        strokeScaleEnabled={false}
        listening={!whole}
        draggable
        dragBoundFunc={(pos) => {
          const v = viewRef.current;
          return {
            x: clamp(
              pos.x,
              v.x + bounds.x * v.scale,
              v.x + (bounds.x + bounds.width - width) * v.scale,
            ),
            y: clamp(
              pos.y,
              v.y + bounds.y * v.scale,
              v.y + (bounds.y + bounds.height - height) * v.scale,
            ),
          };
        }}
        onMouseEnter={(e) => {
          const c = e.target.getStage()?.container();
          if (c) c.style.cursor = "move";
        }}
        onMouseLeave={(e) => {
          const c = e.target.getStage()?.container();
          if (c) c.style.cursor = "crosshair";
        }}
        onDragMove={(e) => onChange(fromNode(e.target))}
        onDragEnd={(e) => onDone(fromNode(e.target))}
        onTransform={(e) => {
          const a = fromNode(e.target);
          e.target.setAttrs({ ...a, scaleX: 1, scaleY: 1 });
          onChange(a);
        }}
        onTransformEnd={(e) => onDone(fromNode(e.target))}
      />
    </>
  );
}

/** A textarea laid exactly over a text box or callout while its text is typed. */
function TextEditor({
  shape,
  view,
  onChange,
  onDone,
}: {
  shape: TextShape | CalloutShape;
  view: View;
  onChange: (text: string) => void;
  onDone: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    ref.current?.focus();
  }, []);
  const s = view.scale;
  const textH = measureText(shape, shape.width) - shape.padding * 2;
  const room = shape.height - shape.padding * 2;
  const offset =
    shape.valign === "middle"
      ? Math.max(0, (room - textH) / 2)
      : shape.valign === "bottom"
        ? Math.max(0, room - textH)
        : 0;
  return (
    <textarea
      ref={ref}
      value={shape.text}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onDone}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape" || (e.key === "Enter" && e.ctrlKey)) {
          e.preventDefault();
          onDone();
        }
      }}
      placeholder="Type…"
      spellCheck={false}
      className="absolute resize-none overflow-hidden border-0 bg-transparent p-0 outline-1 outline-[#2f2f2f] outline-dashed placeholder:opacity-50"
      style={
        {
          left: view.x + (shape.x + shape.padding) * s,
          top: view.y + (shape.y + shape.padding + offset) * s,
          width: (shape.width - shape.padding * 2) * s,
          height: Math.max(textH, shape.fontSize * TEXT_LINE_HEIGHT) * s,
          fontFamily: shape.font,
          fontSize: shape.fontSize * s,
          fontWeight: shape.bold ? 700 : 400,
          fontStyle: shape.italic ? "italic" : "normal",
          textDecoration: shape.underline ? "underline" : "none",
          textAlign: shape.align,
          lineHeight: TEXT_LINE_HEIGHT,
          color: shape.textColor,
          caretColor: shape.textColor,
          whiteSpace: "pre-wrap",
          overflowWrap: "break-word",
        } as React.CSSProperties
      }
    />
  );
}
