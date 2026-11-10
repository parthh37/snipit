import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import Konva from "konva";
import {
  Image as KImage,
  Layer,
  Rect,
  Shape as KShape,
  Stage,
  Transformer,
} from "react-konva";
import { api, errorMessage } from "../lib/api";
import ShapeNode from "./ShapeNode";
import {
  BothEndsIcon,
  CheckIcon,
  CloseIcon,
  CopyIcon,
  FitIcon,
  LineStyleIcon,
  PasteIcon,
  RedoIcon,
  RoundedIcon,
  SaveIcon,
  UndoIcon,
  ToolIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from "./icons";
import {
  CALLOUT_PADDING,
  FONT_FAMILY,
  TEXT_LINE_HEIGHT,
  contrastText,
  type Area,
  type CalloutShape,
  type DocState,
  type LineStyle,
  type Shape,
  type ShapePatch,
  type TextShape,
  type Tool,
} from "./types";
import { useHistory } from "./useHistory";

export interface EditorDoc {
  /** Gallery file being edited; `null` until the first save. */
  path: string | null;
  /** PNG bytes of the background image. */
  png: ArrayBuffer;
}

interface Props {
  doc: EditorDoc;
  onClose: () => void;
  onSaved: () => void;
  notify: (message: string) => void;
}

const TOOLS: { tool: Tool; label: string; key: string }[] = [
  { tool: "select", label: "Select", key: "V" },
  { tool: "arrow", label: "Arrow", key: "A" },
  { tool: "rect", label: "Rectangle", key: "R" },
  { tool: "ellipse", label: "Ellipse", key: "E" },
  { tool: "line", label: "Line", key: "L" },
  { tool: "pen", label: "Pen", key: "P" },
  { tool: "highlighter", label: "Highlighter", key: "H" },
  { tool: "text", label: "Text", key: "T" },
  { tool: "callout", label: "Text bubble", key: "B" },
  { tool: "step", label: "Step number", key: "N" },
  { tool: "pixelate", label: "Pixelate", key: "X" },
  { tool: "blur", label: "Blur", key: "U" },
  { tool: "crop", label: "Crop", key: "C" },
];

const COLORS = [
  "#ef4444",
  "#f97316",
  "#facc15",
  "#22c55e",
  "#3b82f6",
  "#a855f7",
  "#111827",
  "#ffffff",
];

const HIGHLIGHTER_COLORS = ["#facc15", "#4ade80", "#f472b6", "#60a5fa"];

/** Tools (and shape types) that take a line style and opacity. */
const STYLED_TOOLS = new Set<string>([
  "arrow",
  "line",
  "pen",
  "rect",
  "ellipse",
]);
const OPACITIES = [1, 0.75, 0.5, 0.25];
const LINE_STYLES: LineStyle[] = ["solid", "dashed", "dotted"];
const nextLineStyle = (s: LineStyle) =>
  LINE_STYLES[(LINE_STYLES.indexOf(s) + 1) % LINE_STYLES.length];

/** The style controls' values. */
interface ShapeStyle {
  filled: boolean;
  rounded: boolean;
  dash: LineStyle;
  bothEnds: boolean;
  opacity: number;
}

type Size = "s" | "m" | "l";
const STROKE = { s: 3, m: 5, l: 9 };
const FONT = { s: 16, m: 22, l: 32 };
const STEP_RADIUS = { s: 12, m: 16, l: 22 };
const HIGHLIGHT = { s: 14, m: 22, l: 34 };
const PIXEL = { s: 6, m: 10, l: 16 };
const BLUR = { s: 10, m: 20, l: 32 };

/** Zoom presets for the +/− buttons, in device pixels per image pixel (1 = 100%). */
const ZOOM_STEPS = [
  0.1,
  0.25,
  1 / 3,
  0.5,
  2 / 3,
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
/** Room kept around the image when it is fitted, or panned to an edge. */
const MARGIN = 24;

/** Stage transform: CSS pixels per image pixel, and where the image origin sits. */
interface View {
  scale: number;
  x: number;
  y: number;
}

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

/** Follows the pointer outside the canvas until the button is released. */
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

function loadImage(png: ArrayBuffer) {
  const url = URL.createObjectURL(new Blob([png], { type: "image/png" }));
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new window.Image();
    // A loaded image keeps its pixels, so the blob can go; otherwise every opened snip and
    // paste would stay in memory for as long as Snipit sits in the tray.
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not load the image"));
    };
    image.src = url;
  });
}

/** Snaps a vector to the nearest 45°. */
function snap45(dx: number, dy: number) {
  const angle = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
  const len = Math.hypot(dx, dy);
  return [Math.cos(angle) * len, Math.sin(angle) * len];
}

export default function Editor({ doc, onClose, onSaved, notify }: Props) {
  const [background, setBackground] = useState<HTMLImageElement>();
  const [path, setPath] = useState<string | null>(doc.path);
  const history = useHistory<DocState>({ shapes: [], crop: null });
  const { shapes, crop } = history.present;
  const [savedDoc, setSavedDoc] = useState<DocState>(history.present);
  const dirty = history.present !== savedDoc;

  const [tool, setToolState] = useState<Tool>("arrow");
  const [color, setColor] = useState(COLORS[0]);
  const [highlight, setHighlight] = useState(HIGHLIGHTER_COLORS[0]);
  const [size, setSize] = useState<Size>("m");
  const [filled, setFilled] = useState(false);
  const [rounded, setRounded] = useState(false);
  const [dash, setDash] = useState<LineStyle>("solid");
  const [bothEnds, setBothEnds] = useState(false);
  const [opacity, setOpacity] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraftState] = useState<Shape | null>(null);
  const [editing, setEditing] = useState<{
    id: string;
    base: DocState;
  } | null>(null);
  // Pointer handlers read these synchronously, between renders.
  const draftRef = useRef<Shape | null>(null);
  const origin = useRef<{ x: number; y: number } | null>(null);
  // Blur and the canvas mousedown can both end an edit in the same click.
  const editingRef = useRef(editing);
  const setDraft = (next: Shape | null) => {
    draftRef.current = next;
    setDraftState(next);
  };
  const [busy, setBusy] = useState(false);

  /** The crop being dragged out while the crop tool is active. */
  const [cropDraft, setCropDraft] = useState<Area | null>(null);
  const toolBeforeCrop = useRef<Tool>("select");

  /** `null` fits the image to the window (and keeps fitting it as the window resizes). */
  const [zoom, setZoom] = useState<View | null>(null);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [panning, setPanning] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
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

  // ---- view: crop area, zoom and pan ------------------------------------------

  const iw = background?.naturalWidth ?? 0;
  const ih = background?.naturalHeight ?? 0;
  const dpr = window.devicePixelRatio;
  const cropping = tool === "crop";
  const full: Area = { x: 0, y: 0, width: iw, height: ih };
  /** The part of the image on show: all of it while cropping, so the crop can grow back. */
  const area = cropping ? full : (crop ?? full);

  // Fit to the window, but never larger than the pixels were on screen.
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
  /** Sizes are picked in screen pixels at fit-to-window zoom and stored in image pixels. */
  const px = (value: number) => value / fitScale;

  /** Centres the area when it fits, otherwise keeps it from being panned out of sight. */
  const clampView = (v: View): View => {
    const axis = (pos: number, start: number, length: number, room: number) => {
      const size = length * v.scale;
      const offset = start * v.scale;
      // Whole pixels, or 100% zoom would resample the image and look soft.
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
  // Wheel and drag events can arrive faster than renders; they build on the latest view.
  const viewRef = useRef(view);
  useLayoutEffect(() => {
    viewRef.current = view;
  });

  const setView = (v: View) => {
    const next = clampView(v);
    viewRef.current = next;
    setZoom(next);
  };

  /** Zooms keeping the image point under `anchor` (container pixels) in place. */
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
    // Fitted, the whole image is already in view.
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
    if (!background) return;
    // Ctrl+wheel would otherwise zoom the whole web view.
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

  // ---- export, save, copy -------------------------------------------------

  const exportPng = useCallback(
    async (region: Area | null) => {
      const stage = stageRef.current;
      if (!stage) throw new Error("Editor not ready");
      // Render at the image's own size and scale 1 rather than scaling the on-screen stage
      // back up: its size is rounded to whole screen pixels, which made exports a pixel or
      // two off.
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
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error("Export failed"))),
          "image/png",
        ),
      );
      return new Uint8Array(await blob.arrayBuffer());
    },
    [iw, ih],
  );

  const save = useCallback(
    async (state: DocState) => {
      const saved = await api.saveSnip(await exportPng(state.crop), path);
      setPath(saved);
      setSavedDoc(state);
      onSaved();
    },
    [exportPng, onSaved, path],
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

  // ---- crop -------------------------------------------------------------------

  /** Whole pixels, inside the image. */
  const clampArea = (a: Area): Area => {
    const x0 = clamp(Math.round(a.x), 0, iw);
    const y0 = clamp(Math.round(a.y), 0, ih);
    const x1 = clamp(Math.round(a.x + a.width), 0, iw);
    const y1 = clamp(Math.round(a.y + a.height), 0, ih);
    return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
  };

  const enterCrop = () => {
    toolBeforeCrop.current = tool;
    setSelectedId(null);
    setCropDraft(crop ?? full);
    setZoom(null);
    setToolState("crop");
  };

  /** Ends crop mode, applying the drawn crop unless `cancel`. Returns the resulting doc. */
  const leaveCrop = (
    cancel = false,
    next: Tool = toolBeforeCrop.current,
  ): DocState => {
    let state = history.present;
    if (!cancel && cropDraft) {
      const c = clampArea(cropDraft);
      const value =
        c.width < 1 || c.height < 1 || (c.width === iw && c.height === ih)
          ? null
          : c;
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

  /** The document as it will be exported: a crop in progress is applied first. */
  const settleCrop = () => (cropping ? leaveCrop() : history.present);

  const setTool = (next: Tool) => {
    if (next === tool) return;
    // Shapes can't be picked while drawing, so a leftover selection would only confuse the
    // toolbar about what it is styling.
    if (next !== "select") setSelectedId(null);
    if (next === "crop") enterCrop();
    else if (cropping) leaveCrop(false, next);
    else setToolState(next);
  };

  const copy = () =>
    run(async () => {
      const state = settleCrop();
      await api.copyPng(await exportPng(state.crop));
      if (state !== savedDoc) await save(state);
      notify("Copied to clipboard");
    });

  const saveNow = () =>
    run(async () => {
      await save(settleCrop());
      notify("Saved to gallery");
    });

  const close = () =>
    run(async () => {
      const state = settleCrop();
      if (state !== savedDoc) {
        try {
          await save(state);
        } catch (e) {
          // Close is the only way out of the editor, so a failed save mustn't trap the user.
          const discard = window.confirm(
            `Couldn't save your changes: ${errorMessage(e)}\n\nClose anyway and discard them?`,
          );
          if (!discard) return;
        }
      }
      onClose();
    });

  // A new capture arriving while editing: keep the current work, then switch.
  const saveRef = useRef({ dirty, save: () => save(history.present) });
  useEffect(() => {
    saveRef.current = { dirty, save: () => save(history.present) };
  });
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (saveRef.current.dirty) await saveRef.current.save().catch(() => {});
      const image = await loadImage(doc.png);
      if (cancelled) return;
      const empty: DocState = { shapes: [], crop: null };
      setBackground(image);
      setPath(doc.path);
      history.reset(empty);
      setSavedDoc(empty);
      setSelectedId(null);
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

  // ---- shape edits ----------------------------------------------------------

  const commitShapes = (next: Shape[]) =>
    history.commit({ ...history.present, shapes: next });

  const replaceShapes = (next: Shape[]) =>
    history.replace({ ...history.present, shapes: next });

  const update = (id: string, patch: ShapePatch) =>
    commitShapes(
      shapes.map((s) => (s.id === id ? ({ ...s, ...patch } as Shape) : s)),
    );

  const remove = (id: string) =>
    commitShapes(shapes.filter((s) => s.id !== id));

  const selected = shapes.find((s) => s.id === selectedId);

  const pickColor = (value: string) => {
    if (tool === "highlighter") setHighlight(value);
    else setColor(value);
    if (!selected) return;
    if (selected.type === "text") update(selected.id, { fill: value });
    else if (selected.type === "callout" || selected.type === "step")
      update(selected.id, { fill: value });
    else if ("stroke" in selected) update(selected.id, { stroke: value });
  };

  // The style controls show and change the selected shape, or set up the next one drawn.
  const boxSelected =
    selected?.type === "rect" || selected?.type === "ellipse"
      ? selected
      : undefined;
  const pathSelected =
    selected?.type === "arrow" ||
    selected?.type === "line" ||
    selected?.type === "pen"
      ? selected
      : undefined;
  const styledSelected = boxSelected ?? pathSelected;
  const styleTarget = styledSelected?.type ?? tool;
  const style: ShapeStyle = {
    filled: boxSelected ? boxSelected.filled : filled,
    rounded: boxSelected ? !!boxSelected.rounded : rounded,
    dash: styledSelected ? (styledSelected.dash ?? "solid") : dash,
    bothEnds: pathSelected ? !!pathSelected.bothEnds : bothEnds,
    opacity: styledSelected ? (styledSelected.opacity ?? 1) : opacity,
  };

  const setStyle = (patch: Partial<ShapeStyle>) => {
    if (patch.filled !== undefined) setFilled(patch.filled);
    if (patch.rounded !== undefined) setRounded(patch.rounded);
    if (patch.dash !== undefined) setDash(patch.dash);
    if (patch.bothEnds !== undefined) setBothEnds(patch.bothEnds);
    if (patch.opacity !== undefined) setOpacity(patch.opacity);
    if (styledSelected) update(styledSelected.id, patch);
  };

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
        x: area.x + (area.width - width) / 2,
        y: area.y + (area.height - height) / 2,
        width,
        height,
      };
      commitShapes([...shapes, shape]);
      setTool("select");
      setSelectedId(shape.id);
    });

  // ---- text editing -----------------------------------------------------

  const startEditing = (shape: TextShape | CalloutShape, base: DocState) => {
    setSelectedId(null);
    editingRef.current = { id: shape.id, base };
    setEditing(editingRef.current);
  };

  const editingShape = shapes.find((s) => s.id === editing?.id) as
    TextShape | CalloutShape | undefined;

  const finishEditing = () => {
    const current = editingRef.current;
    if (!current) return;
    editingRef.current = null;
    const shape = shapes.find((s) => s.id === current.id);
    const next =
      shape && "text" in shape && !shape.text.trim()
        ? shapes.filter((s) => s.id !== current.id)
        : shapes;
    const base = current.base;
    setEditing(null);
    const unchanged =
      next.length === base.shapes.length &&
      next.every(
        (s, i) =>
          s === base.shapes[i] ||
          JSON.stringify(s) === JSON.stringify(base.shapes[i]),
      );
    if (unchanged) history.replace(base);
    else history.commit({ ...history.present, shapes: next }, base);
  };

  // ---- drawing --------------------------------------------------------------

  const pointer = () =>
    stageRef.current?.getRelativePointerPosition() ?? { x: 0, y: 0 };

  /** Drag on the image outside the current crop box draws a new one. */
  const startCropDrag = (e: Konva.KonvaEventObject<MouseEvent>) => {
    if (
      e.target.id() === "crop-rect" ||
      e.target.getParent()?.className === "Transformer"
    )
      return;
    e.evt.preventDefault();
    const inside = (p: { x: number; y: number }) => ({
      x: clamp(p.x, 0, iw),
      y: clamp(p.y, 0, ih),
    });
    const start = inside(pointer());
    const previous = cropDraft;
    const areaTo = (evt: PointerEvent): Area => {
      stageRef.current?.setPointersPositions(evt);
      const p = inside(pointer());
      return {
        x: Math.min(start.x, p.x),
        y: Math.min(start.y, p.y),
        width: Math.abs(p.x - start.x),
        height: Math.abs(p.y - start.y),
      };
    };
    trackPointer(
      (evt) => setCropDraft(areaTo(evt)),
      (evt) => {
        const a = areaTo(evt);
        const tiny = 4 / viewRef.current.scale;
        // A click (rather than a drag) leaves the box as it was.
        setCropDraft(
          a.width < tiny || a.height < tiny ? previous : clampArea(a),
        );
      },
    );
  };

  const onStageMouseDown = (e: Konva.KonvaEventObject<MouseEvent>) => {
    if (e.evt.button === 1 || (e.evt.button === 0 && spaceHeld)) {
      // Middle button or Space+drag pans; also stops Windows' middle-click autoscroll.
      e.evt.preventDefault();
      startPan(e.evt);
      return;
    }
    if (editing) {
      finishEditing();
      return;
    }
    if (e.evt.button !== 0) return;
    if (cropping) {
      startCropDrag(e);
      return;
    }
    const onEmpty =
      e.target === e.target.getStage() || e.target.name() === "background";
    if (tool === "select") {
      if (onEmpty) setSelectedId(null);
      return;
    }
    // Keep focus where it is (e.g. on a text box this click creates).
    e.evt.preventDefault();
    setSelectedId(null);
    const p = pointer();
    const base = { id: newId(), x: p.x, y: p.y };
    origin.current = p;

    switch (tool) {
      case "rect":
      case "ellipse":
        setDraft({
          ...base,
          type: tool,
          width: 0,
          height: 0,
          stroke: color,
          strokeWidth: px(STROKE[size]),
          filled,
          dash,
          opacity,
          ...(tool === "rect" && { rounded }),
        });
        break;
      case "pixelate":
      case "blur":
        setDraft({
          ...base,
          type: tool,
          width: 0,
          height: 0,
          amount: px(tool === "blur" ? BLUR[size] : PIXEL[size]),
        });
        break;
      case "arrow":
      case "line":
        setDraft({
          ...base,
          type: tool,
          points: [0, 0, 0, 0],
          stroke: color,
          strokeWidth: px(STROKE[size]),
          dash,
          opacity,
          ...(tool === "arrow" && { bothEnds }),
        });
        break;
      case "pen":
        setDraft({
          ...base,
          type: tool,
          points: [0, 0],
          stroke: color,
          strokeWidth: px(STROKE[size]),
          dash,
          opacity,
        });
        break;
      case "highlighter":
        setDraft({
          ...base,
          type: tool,
          points: [0, 0],
          stroke: highlight,
          strokeWidth: px(HIGHLIGHT[size]),
        });
        break;
      case "callout":
        setDraft({
          ...base,
          type: "callout",
          text: "",
          width: px(220),
          fill: color,
          fontSize: px(FONT[size] * 0.8),
          tailX: 0,
          tailY: 0,
        });
        break;
      case "text": {
        origin.current = null;
        const fontSize = px(FONT[size]);
        const shape: TextShape = {
          ...base,
          y: p.y - (fontSize * TEXT_LINE_HEIGHT) / 2,
          type: "text",
          text: "",
          fill: color,
          fontSize,
        };
        replaceShapes([...shapes, shape]);
        startEditing(shape, history.present);
        break;
      }
      case "step": {
        origin.current = null;
        const n =
          Math.max(0, ...shapes.map((s) => (s.type === "step" ? s.n : 0))) + 1;
        commitShapes([
          ...shapes,
          {
            ...base,
            type: "step",
            n,
            fill: color,
            radius: px(STEP_RADIUS[size]),
          },
        ]);
        break;
      }
    }
  };

  // Track the pointer on the window so drawing continues outside the canvas.
  useEffect(() => {
    if (!draft) return;
    const onMove = (evt: PointerEvent) => {
      const stage = stageRef.current;
      const start = origin.current;
      const current = draftRef.current;
      if (!stage || !start || !current) return;
      stage.setPointersPositions(evt);
      const p = pointer();
      let dx = p.x - start.x;
      let dy = p.y - start.y;

      switch (current.type) {
        case "rect":
        case "ellipse":
        case "pixelate":
        case "blur": {
          if (
            evt.shiftKey &&
            (current.type === "rect" || current.type === "ellipse")
          ) {
            const side = Math.max(Math.abs(dx), Math.abs(dy));
            dx = Math.sign(dx || 1) * side;
            dy = Math.sign(dy || 1) * side;
          }
          setDraft({
            ...current,
            x: Math.min(start.x, start.x + dx),
            y: Math.min(start.y, start.y + dy),
            width: Math.abs(dx),
            height: Math.abs(dy),
          });
          break;
        }
        case "arrow":
        case "line":
          if (evt.shiftKey) [dx, dy] = snap45(dx, dy);
          setDraft({ ...current, points: [0, 0, dx, dy] });
          break;
        case "pen":
          setDraft({ ...current, points: [...current.points, dx, dy] });
          break;
        case "highlighter":
          setDraft({
            ...current,
            points: evt.shiftKey ? [0, 0, dx, 0] : [...current.points, dx, dy],
          });
          break;
        case "callout": {
          // Bubble centred on the pointer, tail pointing back at the press position.
          const height =
            current.fontSize * TEXT_LINE_HEIGHT + CALLOUT_PADDING * 2;
          const x = p.x - current.width / 2;
          const y = p.y - height / 2;
          setDraft({
            ...current,
            x,
            y,
            tailX: start.x - x,
            tailY: start.y - y,
          });
          break;
        }
      }
    };

    const onUp = () => {
      const current = draftRef.current;
      const start = origin.current;
      setDraft(null);
      origin.current = null;
      if (!current || !start) return;

      let shape: Shape | null = current;
      switch (current.type) {
        case "rect":
        case "ellipse":
        case "pixelate":
        case "blur":
          if (current.width < 3 || current.height < 3) shape = null;
          break;
        case "arrow":
        case "line":
          if (Math.hypot(current.points[2], current.points[3]) < 4)
            shape = null;
          break;
        case "pen":
        case "highlighter":
          if (current.points.length < 4) shape = null;
          break;
        case "callout": {
          // A click (or tiny drag) puts the bubble up and to the right of the point.
          const height =
            current.fontSize * TEXT_LINE_HEIGHT + CALLOUT_PADDING * 2;
          const untouched = current.tailX === 0 && current.tailY === 0;
          const drag = Math.hypot(
            current.tailX - current.width / 2,
            current.tailY - height / 2,
          );
          if (untouched || drag < px(40)) {
            const x = start.x + px(30);
            const y = start.y - px(90);
            shape = {
              ...current,
              x,
              y,
              tailX: start.x - x,
              tailY: start.y - y,
            };
          }
          break;
        }
      }
      if (!shape) return;
      if (shape.type === "callout") {
        replaceShapes([...shapes, shape]);
        startEditing(shape, history.present);
      } else {
        commitShapes([...shapes, shape]);
      }
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    // Re-subscribing on every draft change would drop events; refs carry the latest state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft !== null]);

  // ---- selection transformer -------------------------------------------------

  useEffect(() => {
    const tr = trRef.current;
    const stage = stageRef.current;
    if (!tr || !stage) return;
    const node = selectedId ? stage.findOne(`#${selectedId}`) : undefined;
    const type = selected?.type;
    tr.nodes(node ? [node] : []);
    tr.rotateEnabled(
      type !== "pixelate" && type !== "blur" && type !== "callout",
    );
    tr.keepRatio(type === "text" || type === "step" || type === "image");
    tr.enabledAnchors(
      type === "callout"
        ? ["middle-left", "middle-right"]
        : type === "text" || type === "step" || type === "image"
          ? ["top-left", "top-right", "bottom-left", "bottom-right"]
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
  }, [selectedId, selected?.type, shapes]);

  const hasCropDraft = cropDraft !== null;
  useEffect(() => {
    const tr = cropTrRef.current;
    const node = stageRef.current?.findOne("#crop-rect");
    if (!tr) return;
    tr.nodes(cropping && node ? [node] : []);
    tr.getLayer()?.batchDraw();
  }, [cropping, hasCropDraft]);

  // ---- keyboard shortcuts --------------------------------------------------

  const keys = useRef<(e: KeyboardEvent) => void>(() => {});
  const onKeyDown = (e: KeyboardEvent) => {
    const target = e.target as HTMLElement;
    if (["TEXTAREA", "INPUT", "SELECT"].includes(target.tagName)) return;
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();

    if (mod && key === "z" && !e.shiftKey) history.undo();
    else if (mod && (key === "y" || (key === "z" && e.shiftKey)))
      history.redo();
    else if (mod && key === "c") void copy();
    else if (mod && key === "s") void saveNow();
    else if (mod && key === "v") void paste();
    else if (mod && (key === "=" || key === "+")) stepZoom(1);
    else if (mod && key === "-") stepZoom(-1);
    else if (mod && key === "0") fitToWindow();
    else if (mod && key === "1") zoomTo(1 / dpr);
    else if (e.key === " ") setSpaceHeld(true);
    else if (cropping && e.key === "Enter") leaveCrop();
    else if ((e.key === "Delete" || e.key === "Backspace") && selectedId) {
      remove(selectedId);
      setSelectedId(null);
    } else if (e.key === "Escape") {
      if (cropping) leaveCrop(true);
      else if (selectedId) setSelectedId(null);
      else setTool("select");
    } else if (!mod && !e.altKey) {
      const match = TOOLS.find((t) => t.key.toLowerCase() === key);
      if (!match) return;
      setTool(match.tool);
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

  // ---- render ----------------------------------------------------------------

  const activeColor = tool === "highlighter" ? highlight : color;
  const palette = tool === "highlighter" ? HIGHLIGHTER_COLORS : COLORS;
  const visibleShapes = draft ? [...shapes, draft] : shapes;
  const shown = cropping && cropDraft ? cropDraft : area;
  const cursor = panning
    ? "grabbing"
    : spaceHeld && zoom
      ? "grab"
      : tool === "select"
        ? "default"
        : "crosshair";

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-zinc-200 bg-white px-3 py-2 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex gap-0.5">
          {TOOLS.map((t) => (
            <IconButton
              key={t.tool}
              active={tool === t.tool}
              title={`${t.label} (${t.key})`}
              onClick={() => setTool(t.tool)}
            >
              <ToolIcon tool={t.tool} />
            </IconButton>
          ))}
        </div>

        <Divider />

        {cropping ? (
          <div className="flex items-center gap-1.5 text-sm">
            <span className="min-w-24 text-zinc-500 tabular-nums dark:text-zinc-400">
              {Math.round(shown.width)} × {Math.round(shown.height)}
            </span>
            <TextButton
              title="Select the whole image"
              onClick={() => setCropDraft(full)}
            >
              Reset
            </TextButton>
            <TextButton title="Cancel (Esc)" onClick={() => leaveCrop(true)}>
              Cancel
            </TextButton>
            <button
              type="button"
              onClick={() => leaveCrop()}
              title="Apply crop (Enter)"
              className="flex items-center gap-1 rounded-md bg-brand-600 px-2.5 py-1 font-medium text-white hover:bg-brand-500"
            >
              <CheckIcon />
              Apply
            </button>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-1">
              {palette.map((c) => (
                <button
                  key={c}
                  type="button"
                  title={c}
                  onClick={() => pickColor(c)}
                  className={`size-5 rounded-full border border-black/15 dark:border-white/20 ${
                    activeColor === c
                      ? "ring-2 ring-brand-500 ring-offset-1 dark:ring-offset-zinc-900"
                      : ""
                  }`}
                  style={{ background: c }}
                />
              ))}
            </div>

            <div className="flex items-center gap-0.5">
              {(["s", "m", "l"] as const).map((s) => (
                <IconButton
                  key={s}
                  active={size === s}
                  title={`Size ${s.toUpperCase()}`}
                  onClick={() => setSize(s)}
                >
                  <span
                    className="rounded-full bg-current"
                    style={{ width: STROKE[s] + 3, height: STROKE[s] + 3 }}
                  />
                </IconButton>
              ))}
            </div>

            {STYLED_TOOLS.has(styleTarget) && (
              <div className="flex items-center gap-0.5">
                {(styleTarget === "rect" || styleTarget === "ellipse") && (
                  <IconButton
                    active={style.filled}
                    title="Filled shape"
                    onClick={() => setStyle({ filled: !style.filled })}
                  >
                    <span
                      className="size-3.5 rounded-sm border-2 border-current"
                      style={{
                        background: style.filled ? "currentColor" : undefined,
                      }}
                    />
                  </IconButton>
                )}
                {styleTarget === "rect" && (
                  <IconButton
                    active={style.rounded}
                    title="Rounded corners"
                    onClick={() => setStyle({ rounded: !style.rounded })}
                  >
                    <RoundedIcon />
                  </IconButton>
                )}
                {!(
                  (styleTarget === "rect" || styleTarget === "ellipse") &&
                  style.filled
                ) && (
                  <IconButton
                    title={`Line: ${style.dash} (click for ${nextLineStyle(style.dash)})`}
                    onClick={() =>
                      setStyle({ dash: nextLineStyle(style.dash) })
                    }
                  >
                    <LineStyleIcon style={style.dash} />
                  </IconButton>
                )}
                {styleTarget === "arrow" && (
                  <IconButton
                    active={style.bothEnds}
                    title="Arrowhead at both ends"
                    onClick={() => setStyle({ bothEnds: !style.bothEnds })}
                  >
                    <BothEndsIcon />
                  </IconButton>
                )}
                <select
                  title="Opacity"
                  aria-label="Opacity"
                  value={style.opacity}
                  onChange={(e) => {
                    setStyle({ opacity: Number(e.target.value) });
                    // Hand the keyboard back to the tool shortcuts.
                    e.currentTarget.blur();
                  }}
                  className="h-8 rounded-md bg-transparent px-1 text-sm text-zinc-600 tabular-nums hover:bg-zinc-100 dark:text-zinc-300 dark:scheme-dark dark:hover:bg-zinc-800"
                >
                  {OPACITIES.map((o) => (
                    <option key={o} value={o}>
                      {Math.round(o * 100)}%
                    </option>
                  ))}
                </select>
              </div>
            )}
          </>
        )}

        <Divider />

        <div className="flex gap-0.5">
          <IconButton
            title="Undo (Ctrl+Z)"
            disabled={!history.canUndo}
            onClick={history.undo}
          >
            <UndoIcon />
          </IconButton>
          <IconButton
            title="Redo (Ctrl+Y)"
            disabled={!history.canRedo}
            onClick={history.redo}
          >
            <RedoIcon />
          </IconButton>
          <IconButton title="Paste image (Ctrl+V)" onClick={() => void paste()}>
            <PasteIcon />
          </IconButton>
        </div>

        <div className="ml-auto flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => void copy()}
            disabled={busy}
            className="flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-500 disabled:opacity-60"
            title="Copy to clipboard (Ctrl+C)"
          >
            <CopyIcon />
            Copy
          </button>
          <IconButton
            title="Save to gallery (Ctrl+S)"
            disabled={busy}
            onClick={() => void saveNow()}
          >
            <SaveIcon />
          </IconButton>
          <IconButton
            title="Close (saves changes)"
            disabled={busy}
            onClick={() => void close()}
          >
            <CloseIcon />
          </IconButton>
        </div>
      </div>

      <div
        ref={containerRef}
        className="checkerboard relative flex-1 overflow-hidden"
      >
        {background && (
          <>
            <div
              className="pointer-events-none absolute shadow-xl"
              style={{
                left: view.x + area.x * view.scale,
                top: view.y + area.y * view.scale,
                width: area.width * view.scale,
                height: area.height * view.scale,
              }}
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
                clipX={area.x}
                clipY={area.y}
                clipWidth={area.width}
                clipHeight={area.height}
              >
                <KImage
                  image={background}
                  name="background"
                  listening={false}
                />
                {visibleShapes.map((shape) => (
                  <ShapeNode
                    key={shape.id}
                    shape={shape}
                    background={background}
                    selectable={
                      tool === "select" && !spaceHeld && shape !== draft
                    }
                    editing={shape.id === editing?.id}
                    onSelect={setSelectedId}
                    onChange={update}
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
                    imageWidth={iw}
                    imageHeight={ih}
                    viewRef={viewRef}
                    onChange={setCropDraft}
                    onDone={(a) => setCropDraft(clampArea(a))}
                  />
                )}
                <Transformer
                  ref={trRef}
                  rotateAnchorOffset={24}
                  anchorSize={9}
                  anchorCornerRadius={2}
                  borderStroke="#6c6cff"
                  anchorStroke="#6c6cff"
                  ignoreStroke
                />
                <Transformer
                  ref={cropTrRef}
                  rotateEnabled={false}
                  flipEnabled={false}
                  keepRatio={false}
                  borderEnabled={false}
                  anchorSize={10}
                  anchorCornerRadius={2}
                  anchorStroke="#6c6cff"
                  boundBoxFunc={(oldBox, box) => {
                    // Absolute (screen) coordinates: keep the box on the image.
                    const v = viewRef.current;
                    const left = Math.max(v.x, box.x);
                    const top = Math.max(v.y, box.y);
                    const right = Math.min(
                      v.x + iw * v.scale,
                      box.x + box.width,
                    );
                    const bottom = Math.min(
                      v.y + ih * v.scale,
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
                    shapes.map((s) =>
                      s.id === editingShape.id ? ({ ...s, text } as Shape) : s,
                    ),
                  )
                }
                onDone={finishEditing}
              />
            )}
          </>
        )}
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-zinc-200 px-3 py-0.5 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
        <div className="flex items-center gap-2">
          <span className="tabular-nums">
            {Math.round(shown.width)} × {Math.round(shown.height)} px
          </span>
          <div className="flex items-center">
            <SmallButton title="Zoom out (Ctrl+−)" onClick={() => stepZoom(-1)}>
              <ZoomOutIcon />
            </SmallButton>
            <button
              type="button"
              title="Actual size (Ctrl+1)"
              onClick={() => zoomTo(1 / dpr)}
              className="w-11 rounded py-0.5 text-center tabular-nums hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              {Math.round(view.scale * dpr * 100)}%
            </button>
            <SmallButton title="Zoom in (Ctrl+=)" onClick={() => stepZoom(1)}>
              <ZoomInIcon />
            </SmallButton>
            <SmallButton
              title="Fit to window (Ctrl+0)"
              active={!zoom}
              onClick={fitToWindow}
            >
              <FitIcon />
            </SmallButton>
          </div>
        </div>
        <span className="truncate">
          {cropping
            ? "Drag to choose the area · Enter: apply · Esc: cancel"
            : "Shift: straight / square · Double-click text to edit · Del: delete · Ctrl+scroll: zoom · Space+drag: pan"}
          {dirty ? " · Unsaved changes" : ""}
        </span>
      </div>
    </div>
  );
}

/** The crop box: dims everything outside it, with rule-of-thirds guides. */
function CropBox({
  area,
  imageWidth,
  imageHeight,
  viewRef,
  onChange,
  onDone,
}: {
  area: Area;
  imageWidth: number;
  imageHeight: number;
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
  // Covering the whole image there is nowhere to move the box, so a drag inside it draws
  // a new one instead.
  const whole = width >= imageWidth && height >= imageHeight;

  return (
    <>
      <KShape
        listening={false}
        fill="rgba(0,0,0,0.55)"
        fillRule="evenodd"
        sceneFunc={(ctx, node) => {
          ctx.beginPath();
          ctx.rect(0, 0, imageWidth, imageHeight);
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
        // Transparent, but still hit-testable so the box can be dragged.
        fill="rgba(0,0,0,0)"
        stroke="#ffffff"
        strokeWidth={1.5}
        strokeScaleEnabled={false}
        listening={!whole}
        draggable
        dragBoundFunc={(pos) => {
          const v = viewRef.current;
          return {
            x: clamp(pos.x, v.x, v.x + (imageWidth - width) * v.scale),
            y: clamp(pos.y, v.y, v.y + (imageHeight - height) * v.scale),
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
          // Fold the transformer's scale into the size so the stroke stays put.
          const a = fromNode(e.target);
          e.target.setAttrs({ ...a, scaleX: 1, scaleY: 1 });
          onChange(a);
        }}
        onTransformEnd={(e) => onDone(fromNode(e.target))}
      />
    </>
  );
}

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
    // The drawing mousedown is preventDefault-ed, so nothing takes focus back afterwards.
    ref.current?.focus();
  }, []);

  const scale = view.scale * (shape.scaleX ?? 1);
  const isCallout = shape.type === "callout";
  const pad = isCallout ? CALLOUT_PADDING : 0;
  const color = isCallout ? contrastText(shape.fill) : shape.fill;

  return (
    <textarea
      ref={ref}
      value={shape.text}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onDone}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (
          e.key === "Escape" ||
          (e.key === "Enter" && (e.ctrlKey || (!isCallout && !e.shiftKey)))
        ) {
          e.preventDefault();
          onDone();
        }
      }}
      placeholder="Type…"
      spellCheck={false}
      className="absolute resize-none overflow-hidden border-0 bg-transparent p-0 outline-1 outline-brand-500 outline-dashed placeholder:opacity-60"
      style={
        {
          left: view.x + (shape.x + pad) * view.scale,
          top: view.y + (shape.y + pad) * view.scale,
          width: isCallout ? (shape.width - pad * 2) * scale : undefined,
          minWidth: isCallout ? undefined : 40,
          fontFamily: FONT_FAMILY,
          fontSize: shape.fontSize * scale,
          fontWeight: isCallout ? 400 : 600,
          lineHeight: TEXT_LINE_HEIGHT,
          color,
          caretColor: color,
          fieldSizing: "content",
          whiteSpace: isCallout ? "pre-wrap" : "pre",
        } as React.CSSProperties
      }
    />
  );
}

function IconButton({
  children,
  active,
  disabled,
  title,
  onClick,
}: {
  children: React.ReactNode;
  active?: boolean;
  disabled?: boolean;
  title: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={`flex size-8 items-center justify-center rounded-md transition disabled:opacity-35 ${
        active
          ? "bg-brand-500/15 text-brand-600 dark:text-brand-500"
          : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
      }`}
    >
      {children}
    </button>
  );
}

function SmallButton({
  children,
  active,
  title,
  onClick,
}: {
  children: React.ReactNode;
  active?: boolean;
  title: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={active}
      onClick={onClick}
      className={`flex size-6 items-center justify-center rounded [&_svg]:size-3.5 ${
        active
          ? "text-brand-600 dark:text-brand-500"
          : "hover:bg-zinc-100 dark:hover:bg-zinc-800"
      }`}
    >
      {children}
    </button>
  );
}

function TextButton({
  children,
  title,
  onClick,
}: {
  children: React.ReactNode;
  title: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className="rounded-md px-2.5 py-1 text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
    >
      {children}
    </button>
  );
}

function Divider() {
  return <div className="h-6 w-px bg-zinc-200 dark:bg-zinc-700" />;
}
