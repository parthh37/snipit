import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import Konva from "konva";
import { Image as KImage, Layer, Stage, Transformer } from "react-konva";
import { api, errorMessage } from "../lib/api";
import ShapeNode from "./ShapeNode";
import {
  CloseIcon,
  CopyIcon,
  PasteIcon,
  RedoIcon,
  SaveIcon,
  UndoIcon,
  ToolIcon,
} from "./icons";
import {
  CALLOUT_PADDING,
  FONT_FAMILY,
  TEXT_LINE_HEIGHT,
  contrastText,
  type CalloutShape,
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

type Size = "s" | "m" | "l";
const STROKE = { s: 3, m: 5, l: 9 };
const FONT = { s: 16, m: 22, l: 32 };
const STEP_RADIUS = { s: 12, m: 16, l: 22 };
const HIGHLIGHT = { s: 14, m: 22, l: 34 };

const newId = () => crypto.randomUUID();

function loadImage(png: ArrayBuffer) {
  const url = URL.createObjectURL(new Blob([png], { type: "image/png" }));
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new window.Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Could not load the image"));
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
  const history = useHistory<Shape[]>([]);
  const shapes = history.present;
  const [savedShapes, setSavedShapes] = useState<Shape[]>(shapes);
  const dirty = shapes !== savedShapes;

  const [tool, setTool] = useState<Tool>("arrow");
  const [color, setColor] = useState(COLORS[0]);
  const [highlight, setHighlight] = useState(HIGHLIGHTER_COLORS[0]);
  const [size, setSize] = useState<Size>("m");
  const [filled, setFilled] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraftState] = useState<Shape | null>(null);
  const [editing, setEditing] = useState<{ id: string; base: Shape[] } | null>(
    null,
  );
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

  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const trRef = useRef<Konva.Transformer>(null);
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

  const iw = background?.naturalWidth ?? 0;
  const ih = background?.naturalHeight ?? 0;
  // Fit to the window, but never larger than the pixels were on screen.
  const viewScale =
    iw && viewport.width
      ? Math.min(
          1 / window.devicePixelRatio,
          (viewport.width - 48) / iw,
          (viewport.height - 48) / ih,
        )
      : 1;
  /** Sizes are picked in screen pixels and stored in image pixels. */
  const px = (value: number) => value / viewScale;

  // ---- export, save, copy -------------------------------------------------

  const exportPng = useCallback(async () => {
    const stage = stageRef.current;
    if (!stage) throw new Error("Editor not ready");
    trRef.current?.visible(false);
    const canvas = stage.toCanvas({ pixelRatio: 1 / viewScale });
    trRef.current?.visible(true);
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("Export failed"))),
        "image/png",
      ),
    );
    return new Uint8Array(await blob.arrayBuffer());
  }, [viewScale]);

  const save = useCallback(async () => {
    const saved = await api.saveSnip(await exportPng(), path);
    setPath(saved);
    setSavedShapes(shapes);
    onSaved();
  }, [exportPng, onSaved, path, shapes]);

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

  const copy = () =>
    run(async () => {
      await api.copyPng(await exportPng());
      if (dirty) await save();
      notify("Copied to clipboard");
    });

  const saveNow = () =>
    run(async () => {
      await save();
      notify("Saved to gallery");
    });

  const close = () =>
    run(async () => {
      if (dirty) await save();
      onClose();
    });

  // A new capture arriving while editing: keep the current work, then switch.
  const saveRef = useRef({ dirty, save });
  useEffect(() => {
    saveRef.current = { dirty, save };
  });
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (saveRef.current.dirty) await saveRef.current.save().catch(() => {});
      const image = await loadImage(doc.png);
      if (cancelled) return;
      const empty: Shape[] = [];
      setBackground(image);
      setPath(doc.path);
      history.reset(empty);
      setSavedShapes(empty);
      setSelectedId(null);
      editingRef.current = null;
      setEditing(null);
    })().catch((e) => notify(errorMessage(e)));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the document changes
  }, [doc]);

  // ---- shape edits ----------------------------------------------------------

  const update = (id: string, patch: ShapePatch) =>
    history.commit(
      shapes.map((s) => (s.id === id ? ({ ...s, ...patch } as Shape) : s)),
    );

  const remove = (id: string) =>
    history.commit(shapes.filter((s) => s.id !== id));

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
        (iw * 0.8) / image.width,
        (ih * 0.8) / image.height,
      );
      const width = image.width * fit;
      const height = image.height * fit;
      const shape: Shape = {
        id: newId(),
        type: "image",
        image,
        x: (iw - width) / 2,
        y: (ih - height) / 2,
        width,
        height,
      };
      history.commit([...shapes, shape]);
      setTool("select");
      setSelectedId(shape.id);
    });

  // ---- text editing -----------------------------------------------------

  const startEditing = (shape: TextShape | CalloutShape, base: Shape[]) => {
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
      next.length === base.length &&
      next.every(
        (s, i) =>
          s === base[i] || JSON.stringify(s) === JSON.stringify(base[i]),
      );
    if (unchanged) history.replace(base);
    else history.commit(next, base);
  };

  // ---- drawing --------------------------------------------------------------

  const pointer = () =>
    stageRef.current?.getRelativePointerPosition() ?? { x: 0, y: 0 };

  const onStageMouseDown = (e: Konva.KonvaEventObject<MouseEvent>) => {
    if (editing) {
      finishEditing();
      return;
    }
    if (e.evt.button !== 0) return;
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
        });
        break;
      case "pixelate":
        setDraft({
          ...base,
          type: "pixelate",
          width: 0,
          height: 0,
          pixelSize: px(10),
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
        });
        break;
      case "pen":
      case "highlighter":
        setDraft({
          ...base,
          type: tool,
          points: [0, 0],
          stroke: tool === "pen" ? color : highlight,
          strokeWidth: px(tool === "pen" ? STROKE[size] : HIGHLIGHT[size]),
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
        history.replace([...shapes, shape]);
        startEditing(shape, shapes);
        break;
      }
      case "step": {
        origin.current = null;
        const n =
          Math.max(0, ...shapes.map((s) => (s.type === "step" ? s.n : 0))) + 1;
        history.commit([
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
        case "pixelate": {
          if (evt.shiftKey && current.type !== "pixelate") {
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
        history.replace([...shapes, shape]);
        startEditing(shape, shapes);
      } else {
        history.commit([...shapes, shape]);
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
    tr.rotateEnabled(type !== "pixelate" && type !== "callout");
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

  // ---- keyboard shortcuts --------------------------------------------------

  const keys = useRef<(e: KeyboardEvent) => void>(() => {});
  const onKeyDown = (e: KeyboardEvent) => {
    const target = e.target as HTMLElement;
    if (target.tagName === "TEXTAREA" || target.tagName === "INPUT") return;
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();

    if (mod && key === "z" && !e.shiftKey) history.undo();
    else if (mod && (key === "y" || (key === "z" && e.shiftKey)))
      history.redo();
    else if (mod && key === "c") void copy();
    else if (mod && key === "s") void saveNow();
    else if (mod && key === "v") void paste();
    else if ((e.key === "Delete" || e.key === "Backspace") && selectedId) {
      remove(selectedId);
      setSelectedId(null);
    } else if (e.key === "Escape") {
      if (selectedId) setSelectedId(null);
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
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ---- render ----------------------------------------------------------------

  const activeColor = tool === "highlighter" ? highlight : color;
  const palette = tool === "highlighter" ? HIGHLIGHTER_COLORS : COLORS;
  const stageWidth = Math.round(iw * viewScale);
  const stageHeight = Math.round(ih * viewScale);
  const visibleShapes = draft ? [...shapes, draft] : shapes;

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
          {(tool === "rect" || tool === "ellipse") && (
            <IconButton
              active={filled}
              title="Filled shape"
              onClick={() => setFilled(!filled)}
            >
              <span
                className="size-3.5 rounded-sm border-2 border-current"
                style={{ background: filled ? "currentColor" : undefined }}
              />
            </IconButton>
          )}
        </div>

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
        className="checkerboard relative flex flex-1 items-center justify-center overflow-hidden"
      >
        {background && (
          <div
            className="relative shadow-xl"
            style={{ width: stageWidth, height: stageHeight }}
          >
            <Stage
              ref={stageRef}
              width={stageWidth}
              height={stageHeight}
              scaleX={viewScale}
              scaleY={viewScale}
              onMouseDown={onStageMouseDown}
              style={{ cursor: tool === "select" ? "default" : "crosshair" }}
            >
              <Layer>
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
                    selectable={tool === "select" && shape !== draft}
                    editing={shape.id === editing?.id}
                    onSelect={setSelectedId}
                    onChange={update}
                    onEdit={(id) => {
                      const s = shapes.find((x) => x.id === id);
                      if (s && (s.type === "text" || s.type === "callout"))
                        startEditing(s, shapes);
                    }}
                  />
                ))}
                <Transformer
                  ref={trRef}
                  rotateAnchorOffset={24}
                  anchorSize={9}
                  anchorCornerRadius={2}
                  borderStroke="#6c6cff"
                  anchorStroke="#6c6cff"
                  ignoreStroke
                />
              </Layer>
            </Stage>

            {editingShape && (
              <TextEditor
                shape={editingShape}
                viewScale={viewScale}
                onChange={(text) =>
                  history.replace(
                    shapes.map((s) =>
                      s.id === editingShape.id ? ({ ...s, text } as Shape) : s,
                    ),
                  )
                }
                onDone={finishEditing}
              />
            )}
          </div>
        )}
      </div>

      <div className="flex justify-between border-t border-zinc-200 px-3 py-1 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
        <span>
          {iw} × {ih} px ·{" "}
          {Math.round(viewScale * window.devicePixelRatio * 100)}%
        </span>
        <span>
          Shift: straight / square · Double-click text to edit · Del: delete
          {dirty ? " · Unsaved changes" : ""}
        </span>
      </div>
    </div>
  );
}

function TextEditor({
  shape,
  viewScale,
  onChange,
  onDone,
}: {
  shape: TextShape | CalloutShape;
  viewScale: number;
  onChange: (text: string) => void;
  onDone: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    // The drawing mousedown is preventDefault-ed, so nothing takes focus back afterwards.
    ref.current?.focus();
  }, []);

  const scale = viewScale * (shape.scaleX ?? 1);
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
          left: (shape.x + pad) * viewScale,
          top: (shape.y + pad) * viewScale,
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

function Divider() {
  return <div className="h-6 w-px bg-zinc-200 dark:bg-zinc-700" />;
}
