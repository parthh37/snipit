/* eslint-disable react-refresh/only-export-components -- shares the editor helpers and constants that go with these components */
import { useEffect, useMemo, useRef } from "react";
import Konva from "konva";
import {
  Ellipse,
  Group,
  Image as KImage,
  Line,
  Rect,
  Shape as KShape,
  Text,
} from "react-konva";
import {
  POINTER_BODIES,
  boxPolygon,
  calloutAnchor,
  calloutPath,
  capInset,
  capPath,
  dashArray,
  endDirection,
  linePath,
  shadowProps,
  stepPointer,
  trimPath,
  type Pt,
} from "./geometry";
import {
  TEXT_LINE_HEIGHT,
  stepLabel,
  type BlurShape,
  type BoxShape,
  type CalloutShape,
  type Cap,
  type Dash,
  type LineShape,
  type MagnifyShape,
  type PenShape,
  type ShadowDir,
  type Shape,
  type ShapePatch,
  type SpotlightShape,
  type StepShape,
  type TextShape,
  type TextStyle,
} from "./types";

interface Props {
  shape: Shape;
  background: CanvasImageSource;
  selectable: boolean;
  /** Hidden while its text is being edited in the overlaid textarea. */
  editing?: boolean;
  onSelect?: (id: string, additive: boolean) => void;
  onChange?: (id: string, patch: ShapePatch) => void;
  onEdit?: (id: string) => void;
  onDragMove?: (id: string, node: Konva.Node) => void;
  onDragEnd?: (id: string, node: Konva.Node) => void;
}

export const EMOJI_FONT = '"Segoe UI Emoji", "Apple Color Emoji", sans-serif';

/** Konva font style for text formatting. */
export function fontStyle(t: Pick<TextStyle, "bold" | "italic">) {
  if (t.bold && t.italic) return "italic bold";
  if (t.bold) return "bold";
  if (t.italic) return "italic";
  return "normal";
}

/** Height a text box needs for its wrapped text. */
export function measureText(
  t: Pick<
    TextStyle,
    "text" | "font" | "fontSize" | "bold" | "italic" | "padding"
  >,
  width: number,
) {
  return new Konva.Text({
    text: t.text || " ",
    width: Math.max(10, width),
    fontSize: t.fontSize,
    fontFamily: t.font,
    fontStyle: fontStyle(t),
    lineHeight: TEXT_LINE_HEIGHT,
    padding: t.padding,
    wrap: "word",
  }).height();
}

export default function ShapeNode({
  shape,
  background,
  selectable,
  editing,
  onSelect,
  onChange,
  onEdit,
  onDragMove,
  onDragEnd,
}: Props) {
  const onTransformEnd = (e: Konva.KonvaEventObject<Event>) => {
    const node = e.target;
    const sx = node.scaleX();
    const sy = node.scaleY();
    node.scale({ x: 1, y: 1 });
    const base = { x: node.x(), y: node.y(), rotation: node.rotation() };
    switch (shape.type) {
      case "pen":
        onChange?.(shape.id, {
          ...base,
          points: shape.points.map((v, i) => v * (i % 2 ? sy : sx)),
        });
        return;
      case "step":
        onChange?.(shape.id, {
          ...base,
          size: Math.max(12, shape.size * Math.max(sx, sy)),
        });
        return;
      case "callout":
        onChange?.(shape.id, {
          ...base,
          width: Math.max(30, shape.width * sx),
          height: Math.max(20, shape.height * sy),
          tail: shape.tail && { x: shape.tail.x * sx, y: shape.tail.y * sy },
        });
        return;
      case "text":
        onChange?.(shape.id, {
          ...base,
          width: Math.max(20, shape.width * sx),
          fontSize:
            Math.abs(sy - 1) > 0.001 && Math.abs(sx - 1) > 0.001
              ? Math.max(6, shape.fontSize * sy)
              : shape.fontSize,
        });
        return;
      case "arrow":
      case "line":
        return;
      default:
        onChange?.(shape.id, {
          ...base,
          width: Math.max(2, shape.width * sx),
          height: Math.max(2, shape.height * sy),
        });
    }
  };

  const onMove = (e: Konva.KonvaEventObject<DragEvent>) => {
    const group = e.target as unknown as Konva.Group;
    // Blur, pixelate and magnify show what is under them, so refresh while moving.
    if (shape.type === "blur" && shape.mode !== "redact") {
      const image = group.findOne<Konva.Image>(".obscured");
      if (image) {
        image.crop({
          x: group.x(),
          y: group.y(),
          width: shape.width,
          height: shape.height,
        });
        image.cache();
      }
    } else if (shape.type === "magnify") {
      const image = group.findOne<Konva.Image>(".lens");
      if (image) image.position(lensOffset(shape, group.x(), group.y()));
    }
    onDragMove?.(shape.id, group);
  };

  return (
    <Group
      id={shape.id}
      name="shape"
      x={shape.x}
      y={shape.y}
      rotation={shape.rotation ?? 0}
      // A text label is drawn by the textarea while editing; a bubble keeps its background.
      opacity={editing && shape.type === "text" ? 0 : (shape.opacity ?? 1)}
      draggable={selectable}
      listening={selectable}
      onMouseDown={(e) => {
        e.cancelBubble = true;
        onSelect?.(shape.id, e.evt.shiftKey || e.evt.ctrlKey);
      }}
      onTap={() => onSelect?.(shape.id, false)}
      onDblClick={() => onEdit?.(shape.id)}
      onDragMove={onMove}
      onDragEnd={(e) => {
        onDragEnd?.(shape.id, e.target);
      }}
      onTransformEnd={onTransformEnd}
    >
      <ShapeBody shape={shape} background={background} editing={editing} />
    </Group>
  );
}

function ShapeBody({
  shape,
  background,
  editing,
}: {
  shape: Shape;
  background: CanvasImageSource;
  editing?: boolean;
}) {
  switch (shape.type) {
    case "arrow":
    case "line":
      return <LineBody shape={shape} />;
    case "pen":
      return <PenBody shape={shape} />;
    case "shape":
      return <BoxBody shape={shape} />;
    case "text":
      return <TextBody shape={shape} />;
    case "callout":
      return <CalloutBody shape={shape} editing={editing} />;
    case "step":
      return <StepBody shape={shape} />;
    case "blur":
      return <BlurBody shape={shape} background={background} />;
    case "highlight":
      return (
        <Rect
          width={shape.width}
          height={shape.height}
          fill={shape.color}
          globalCompositeOperation="multiply"
        />
      );
    case "magnify":
      return <MagnifyBody shape={shape} background={background} />;
    case "spotlight":
      // Invisible but hit-testable: the dimming around it is drawn by `SpotlightDim`.
      return (
        <Rect width={shape.width} height={shape.height} fill="rgba(0,0,0,0)" />
      );
    case "block":
      return (
        <Rect
          width={shape.width}
          height={shape.height}
          fill={shape.fill}
          cornerRadius={Math.min(
            shape.radius,
            shape.width / 2,
            shape.height / 2,
          )}
          {...shadowProps(shape.shadow, 6)}
        />
      );
    case "stamp":
      return (
        <Text
          text={shape.glyph}
          width={shape.width}
          height={shape.height}
          align="center"
          verticalAlign="middle"
          fontFamily={EMOJI_FONT}
          // Emoji glyphs are wider than their font size; never let wrapping drop them.
          wrap="none"
          fontSize={Math.min(shape.width, shape.height) * 0.78}
          lineHeight={1}
          fill="#000"
          {...shadowProps(shape.shadow, shape.height / 10)}
        />
      );
    case "image":
      return (
        <KImage
          image={shape.image}
          width={shape.width}
          height={shape.height}
          {...shadowProps(shape.shadow, 8)}
        />
      );
  }
}

// ---- lines and arrows ------------------------------------------------------------------------

interface StrokeSpec {
  color: string;
  width: number;
  dash: Dash;
  startCap: Cap;
  endCap: Cap;
  startSize: number;
  endSize: number;
  shadow: ShadowDir | null | undefined;
}

/** Draws a line with its caps onto a plain 2D context. */
export function drawStroke(
  ctx: CanvasRenderingContext2D,
  path: Pt[],
  s: StrokeSpec,
) {
  if (path.length < 2) return;
  const inset = (cap: Cap, size: number) => {
    if (cap === "circle" || cap === "square" || cap === "diamond") {
      return Math.max(s.width, s.width * (1 + size * 0.9) * 0.42) * 0.8;
    }
    return capInset(cap, s.width, size);
  };
  const shaft = trimPath(
    path,
    inset(s.startCap, s.startSize),
    inset(s.endCap, s.endSize),
  );
  const shadow = shadowProps(s.shadow, s.width);
  if (shadow.shadowEnabled) {
    ctx.shadowColor = `rgba(0,0,0,${shadow.shadowOpacity})`;
    ctx.shadowBlur = shadow.shadowBlur!;
    ctx.shadowOffsetX = shadow.shadowOffsetX!;
    ctx.shadowOffsetY = shadow.shadowOffsetY!;
  }
  ctx.strokeStyle = s.color;
  ctx.fillStyle = s.color;
  ctx.lineWidth = s.width;
  ctx.lineJoin = "round";
  const roundEnds = s.startCap === "round" || s.endCap === "round";
  ctx.lineCap = roundEnds ? "round" : "butt";
  ctx.setLineDash(dashArray(s.dash, s.width, roundEnds));
  ctx.beginPath();
  ctx.moveTo(shaft[0].x, shaft[0].y);
  for (const p of shaft.slice(1)) ctx.lineTo(p.x, p.y);
  ctx.stroke();
  ctx.setLineDash([]);
  for (const [cap, size, atStart] of [
    [s.startCap, s.startSize, true],
    [s.endCap, s.endSize, false],
  ] as const) {
    if (cap === "none" || cap === "round") continue;
    const tip = atStart ? path[0] : path[path.length - 1];
    const dir = endDirection(path, atStart);
    ctx.beginPath();
    const kind = capPath(ctx, cap, tip, dir, s.width, size);
    if (kind === "fill") ctx.fill();
    else if (kind === "stroke") {
      ctx.lineCap = "round";
      ctx.stroke();
    }
  }
}

function LineBody({ shape }: { shape: LineShape }) {
  const path = useMemo(
    () => linePath(shape),
    [shape.points, shape.control], // eslint-disable-line react-hooks/exhaustive-deps
  );
  return (
    <KShape
      stroke={shape.stroke}
      strokeWidth={shape.strokeWidth}
      hitStrokeWidth={Math.max(16, shape.strokeWidth * 2)}
      sceneFunc={(ctx) =>
        drawStroke(ctx._context, path, {
          color: shape.stroke,
          width: shape.strokeWidth,
          dash: shape.dash,
          startCap: shape.startCap,
          endCap: shape.endCap,
          startSize: shape.startSize,
          endSize: shape.endSize,
          shadow: shape.shadow,
        })
      }
      hitFunc={(ctx, node) => {
        ctx.beginPath();
        ctx.moveTo(path[0].x, path[0].y);
        for (const p of path.slice(1)) ctx.lineTo(p.x, p.y);
        ctx.fillStrokeShape(node);
      }}
    />
  );
}

// ---- pen -------------------------------------------------------------------------------------

/** The offset a calligraphy nib sweeps across, per unit of width. */
const NIB_AXIS: Partial<Record<PenShape["nib"], [number, number]>> = {
  horizontal: [1, 0],
  vertical: [0, 1],
  slash: [Math.SQRT1_2, -Math.SQRT1_2],
  backslash: [Math.SQRT1_2, Math.SQRT1_2],
};

function PenBody({ shape }: { shape: PenShape }) {
  const axis = NIB_AXIS[shape.nib];
  if (shape.marker) {
    return (
      <Line
        points={shape.points}
        stroke={shape.stroke}
        strokeWidth={shape.strokeWidth}
        opacity={0.45}
        lineCap="square"
        lineJoin="round"
        tension={0.2}
        globalCompositeOperation="multiply"
      />
    );
  }
  if (!axis) {
    return (
      <Line
        points={shape.points}
        stroke={shape.stroke}
        strokeWidth={shape.strokeWidth}
        lineCap={shape.nib === "square" ? "square" : "round"}
        lineJoin={shape.nib === "square" ? "miter" : "round"}
        tension={shape.smooth ? 0.4 : 0}
        hitStrokeWidth={Math.max(16, shape.strokeWidth * 2)}
        {...shadowProps(shape.shadow, shape.strokeWidth)}
      />
    );
  }
  // Flat nibs: sweep thin strokes across the nib's width, like a calligraphy pen.
  const pts = shape.points;
  return (
    <KShape
      stroke={shape.stroke}
      strokeWidth={shape.strokeWidth}
      hitStrokeWidth={Math.max(16, shape.strokeWidth * 2)}
      sceneFunc={(konvaCtx) => {
        const ctx = konvaCtx._context;
        const shadow = shadowProps(shape.shadow, shape.strokeWidth);
        if (shadow.shadowEnabled) {
          ctx.shadowColor = `rgba(0,0,0,${shadow.shadowOpacity})`;
          ctx.shadowBlur = shadow.shadowBlur!;
          ctx.shadowOffsetX = shadow.shadowOffsetX!;
          ctx.shadowOffsetY = shadow.shadowOffsetY!;
        }
        ctx.fillStyle = shape.stroke;
        const half = shape.strokeWidth / 2;
        const [ax, ay] = axis;
        // Each segment becomes a filled parallelogram between the nib's two corners.
        ctx.beginPath();
        for (let i = 0; i + 3 < pts.length; i += 2) {
          const x0 = pts[i];
          const y0 = pts[i + 1];
          const x1 = pts[i + 2];
          const y1 = pts[i + 3];
          ctx.moveTo(x0 - ax * half, y0 - ay * half);
          ctx.lineTo(x0 + ax * half, y0 + ay * half);
          ctx.lineTo(x1 + ax * half, y1 + ay * half);
          ctx.lineTo(x1 - ax * half, y1 - ay * half);
          ctx.closePath();
        }
        if (pts.length === 2) {
          ctx.rect(pts[0] - half, pts[1] - 1, shape.strokeWidth, 2);
        }
        ctx.fill("nonzero");
      }}
      hitFunc={(ctx, node) => {
        ctx.beginPath();
        ctx.moveTo(pts[0], pts[1]);
        for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
        ctx.fillStrokeShape(node);
      }}
    />
  );
}

// ---- shapes ----------------------------------------------------------------------------------

function BoxBody({ shape }: { shape: BoxShape }) {
  const { width: w, height: h } = shape;
  const common = {
    fill: shape.fill ?? undefined,
    fillEnabled: shape.fill !== null,
    stroke: shape.outline ?? undefined,
    strokeEnabled: shape.outline !== null && shape.strokeWidth > 0,
    strokeWidth: shape.strokeWidth,
    dash: dashArray(shape.dash, shape.strokeWidth, false),
    dashEnabled: shape.dash !== "solid",
    hitStrokeWidth: Math.max(12, shape.strokeWidth),
    ...shadowProps(shape.shadow, shape.strokeWidth),
  };
  if (shape.kind === "rect" || shape.kind === "rounded") {
    const r =
      shape.kind === "rounded"
        ? Math.min(shape.radius ?? Math.min(w, h) * 0.15, w / 2, h / 2)
        : 0;
    return <Rect width={w} height={h} cornerRadius={r} {...common} />;
  }
  if (shape.kind === "ellipse") {
    return (
      <Ellipse
        x={w / 2}
        y={h / 2}
        radiusX={w / 2}
        radiusY={h / 2}
        {...common}
      />
    );
  }
  return (
    <Line
      points={boxPolygon(shape.kind, w, h).flatMap((p) => [p.x, p.y])}
      closed
      lineJoin="round"
      {...common}
    />
  );
}

// ---- text ------------------------------------------------------------------------------------

function TextBody({ shape }: { shape: TextShape }) {
  const outline = shape.outline && shape.outlineWidth > 0;
  return (
    <>
      {/* Lets the whole box be grabbed, not just the letters. */}
      <Rect width={shape.width} height={shape.height} fill="rgba(0,0,0,0)" />
      <Text
        text={shape.text || " "}
        width={shape.width}
        height={shape.height}
        padding={shape.padding}
        fontFamily={shape.font}
        fontSize={shape.fontSize}
        fontStyle={fontStyle(shape)}
        textDecoration={shape.underline ? "underline" : ""}
        align={shape.align}
        verticalAlign={shape.valign}
        lineHeight={TEXT_LINE_HEIGHT}
        wrap="word"
        fill={shape.textColor}
        stroke={outline ? shape.outline! : undefined}
        strokeWidth={outline ? shape.outlineWidth * 2 : 0}
        fillAfterStrokeEnabled
        lineJoin="round"
        {...shadowProps(shape.shadow, shape.fontSize / 5)}
      />
    </>
  );
}

// ---- callouts --------------------------------------------------------------------------------

function CalloutBody({
  shape,
  editing,
}: {
  shape: CalloutShape;
  editing?: boolean;
}) {
  const pointer = POINTER_BODIES.has(shape.body);
  const anchor = calloutAnchor(shape);
  const shadow = shadowProps(shape.shadow, 6);
  return (
    <>
      {!pointer && shape.tail && (
        <KShape
          stroke={shape.arrowColor}
          strokeWidth={shape.arrowWidth}
          hitStrokeWidth={Math.max(14, shape.arrowWidth * 2)}
          sceneFunc={(ctx) =>
            drawStroke(ctx._context, [anchor, shape.tail!], {
              color: shape.arrowColor,
              width: shape.arrowWidth,
              dash: shape.arrowDash,
              startCap: "none",
              endCap: shape.arrowCap,
              startSize: 3,
              endSize: 3,
              shadow: shape.shadow,
            })
          }
          hitFunc={(ctx, node) => {
            ctx.beginPath();
            ctx.moveTo(anchor.x, anchor.y);
            ctx.lineTo(shape.tail!.x, shape.tail!.y);
            ctx.fillStrokeShape(node);
          }}
        />
      )}
      <KShape
        fill={shape.fill ?? undefined}
        fillEnabled={shape.fill !== null}
        stroke={shape.outline ?? undefined}
        strokeEnabled={shape.outline !== null && shape.strokeWidth > 0}
        strokeWidth={shape.strokeWidth}
        dash={dashArray(shape.dash, shape.strokeWidth, false)}
        dashEnabled={shape.dash !== "solid"}
        lineJoin="round"
        {...shadow}
        sceneFunc={(ctx, node) => {
          ctx.beginPath();
          calloutPath(ctx._context, {
            ...shape,
            tail: pointer ? shape.tail : null,
          });
          ctx.fillStrokeShape(node);
        }}
        hitFunc={(ctx, node) => {
          ctx.beginPath();
          ctx.rect(0, 0, shape.width, shape.height);
          ctx.fillStrokeShape(node);
        }}
      />
      <Text
        text={shape.text || " "}
        width={shape.width}
        height={shape.height}
        padding={shape.padding}
        visible={!editing}
        fontFamily={shape.font}
        fontSize={shape.fontSize}
        fontStyle={fontStyle(shape)}
        textDecoration={shape.underline ? "underline" : ""}
        align={shape.align}
        verticalAlign={shape.valign}
        lineHeight={TEXT_LINE_HEIGHT}
        wrap="word"
        fill={shape.textColor}
        listening={false}
      />
    </>
  );
}

// ---- steps -----------------------------------------------------------------------------------

function StepBody({ shape }: { shape: StepShape }) {
  const r = shape.size / 2;
  const pointed =
    shape.style === "circlePoint" || shape.style === "squarePoint";
  const square = shape.style === "square" || shape.style === "squarePoint";
  const label = stepLabel(shape.n, shape.sequence);
  return (
    <>
      <KShape
        fill={shape.fill}
        {...shadowProps(shape.shadow, shape.size / 6)}
        sceneFunc={(ctx, node) => {
          ctx.beginPath();
          if (square) {
            const c = r * 0.25;
            ctx.moveTo(-r + c, -r);
            ctx.arcTo(r, -r, r, r, c);
            ctx.arcTo(r, r, -r, r, c);
            ctx.arcTo(-r, r, -r, -r, c);
            ctx.arcTo(-r, -r, r, -r, c);
            ctx.closePath();
          } else {
            ctx.arc(0, 0, r, 0, Math.PI * 2);
          }
          if (pointed) {
            const [a, tip, b] = stepPointer(
              shape.size,
              shape.pointAngle ?? 135,
            );
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(tip.x, tip.y);
            ctx.lineTo(b.x, b.y);
            ctx.closePath();
          }
          ctx.fillStrokeShape(node);
        }}
      />
      <Text
        text={label}
        width={shape.size}
        height={shape.size}
        offsetX={r}
        offsetY={r}
        align="center"
        verticalAlign="middle"
        fill={shape.textColor}
        fontSize={
          shape.size * (label.length > 2 ? 0.4 : label.length > 1 ? 0.48 : 0.58)
        }
        fontStyle="bold"
        fontFamily='"Segoe UI", Arial, sans-serif'
        listening={false}
      />
    </>
  );
}

// ---- blur / pixelate / redact ----------------------------------------------------------------

function BlurBody({
  shape,
  background,
}: {
  shape: BlurShape;
  background: CanvasImageSource;
}) {
  const ref = useRef<Konva.Image>(null);
  useEffect(() => {
    if (shape.mode !== "redact" && shape.width >= 1 && shape.height >= 1) {
      ref.current?.cache();
    }
  }, [
    shape.x,
    shape.y,
    shape.width,
    shape.height,
    shape.intensity,
    shape.mode,
    background,
  ]);
  const clip = shape.ellipse
    ? (ctx: Konva.Context) => {
        ctx.ellipse(
          shape.width / 2,
          shape.height / 2,
          shape.width / 2,
          shape.height / 2,
          0,
          0,
          Math.PI * 2,
        );
      }
    : undefined;
  if (shape.mode === "redact") {
    return shape.ellipse ? (
      <Ellipse
        x={shape.width / 2}
        y={shape.height / 2}
        radiusX={shape.width / 2}
        radiusY={shape.height / 2}
        fill={shape.color}
      />
    ) : (
      <Rect width={shape.width} height={shape.height} fill={shape.color} />
    );
  }
  const blur = shape.mode === "blur";
  return (
    <Group clipFunc={clip}>
      {/* Catches clicks on the blurred area itself. */}
      <Rect width={shape.width} height={shape.height} fill="rgba(0,0,0,0)" />
      <KImage
        ref={ref}
        name="obscured"
        image={background as HTMLImageElement}
        crop={{
          x: shape.x,
          y: shape.y,
          width: shape.width,
          height: shape.height,
        }}
        width={shape.width}
        height={shape.height}
        filters={[blur ? Konva.Filters.Blur : Konva.Filters.Pixelate]}
        pixelSize={
          blur ? undefined : Math.max(2, Math.round(shape.intensity * 0.5))
        }
        blurRadius={
          blur ? Math.max(1, Math.round(shape.intensity * 0.6)) : undefined
        }
        listening={false}
      />
    </Group>
  );
}

// ---- magnify ---------------------------------------------------------------------------------

/** Where the enlarged background goes inside a lens at (x, y). */
function lensOffset(shape: MagnifyShape, x: number, y: number) {
  const s = shape.scale / 100;
  const cx = x + shape.width / 2;
  const cy = y + shape.height / 2;
  return { x: shape.width / 2 - cx * s, y: shape.height / 2 - cy * s };
}

function lensPath(
  ctx: Konva.Context | CanvasRenderingContext2D,
  shape: MagnifyShape,
) {
  const { width: w, height: h } = shape;
  if (shape.lens === "oval") {
    ctx.ellipse(w / 2, h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
  } else if (shape.lens === "rounded") {
    const r = Math.min(w, h) * 0.18;
    ctx.moveTo(r, 0);
    ctx.arcTo(w, 0, w, h, r);
    ctx.arcTo(w, h, 0, h, r);
    ctx.arcTo(0, h, 0, 0, r);
    ctx.arcTo(0, 0, w, 0, r);
    ctx.closePath();
  } else {
    ctx.rect(0, 0, w, h);
  }
}

function MagnifyBody({
  shape,
  background,
}: {
  shape: MagnifyShape;
  background: CanvasImageSource;
}) {
  const s = shape.scale / 100;
  const off = lensOffset(shape, shape.x, shape.y);
  return (
    <>
      <Group clipFunc={(ctx) => lensPath(ctx, shape)}>
        <KImage
          name="lens"
          image={background as HTMLImageElement}
          x={off.x}
          y={off.y}
          scaleX={s}
          scaleY={s}
          listening={false}
        />
      </Group>
      <KShape
        stroke={shape.outline}
        strokeWidth={shape.strokeWidth}
        strokeEnabled={shape.strokeWidth > 0}
        fill="rgba(0,0,0,0)"
        shadowEnabled
        shadowColor="#000"
        shadowOpacity={0.35}
        shadowBlur={10}
        shadowOffsetY={3}
        shadowForStrokeEnabled
        sceneFunc={(ctx, node) => {
          ctx.beginPath();
          lensPath(ctx, shape);
          ctx.strokeShape(node);
        }}
        hitFunc={(ctx, node) => {
          ctx.beginPath();
          lensPath(ctx, shape);
          ctx.fillStrokeShape(node);
        }}
      />
    </>
  );
}

// ---- spotlight -------------------------------------------------------------------------------

/**
 * Dims the whole image except the spotlights, at the stacking position of the first one. The
 * holes follow the spotlights' live positions, so they track drags and resizes.
 */
export function SpotlightDim({
  spotlights,
  width,
  height,
}: {
  spotlights: SpotlightShape[];
  width: number;
  height: number;
}) {
  const scratch = useRef<HTMLCanvasElement>(null);
  const dim = Math.max(...spotlights.map((s) => s.dim)) / 100;
  return (
    <KShape
      listening={false}
      sceneFunc={(ctx, node) => {
        const canvas = (scratch.current ??= document.createElement("canvas"));
        if (canvas.width !== width || canvas.height !== height) {
          canvas.width = width;
          canvas.height = height;
        }
        const o = canvas.getContext("2d");
        if (!o) return;
        o.globalCompositeOperation = "source-over";
        o.clearRect(0, 0, width, height);
        o.fillStyle = `rgba(0, 0, 0, ${dim})`;
        o.fillRect(0, 0, width, height);
        o.globalCompositeOperation = "destination-out";
        o.fillStyle = "#000";
        const layer = node.getLayer();
        for (const s of spotlights) {
          const live = layer?.findOne(`#${s.id}`);
          const x = live?.x() ?? s.x;
          const y = live?.y() ?? s.y;
          const w = s.width * (live?.scaleX() ?? 1);
          const h = s.height * (live?.scaleY() ?? 1);
          o.beginPath();
          o.roundRect(
            Math.min(x, x + w),
            Math.min(y, y + h),
            Math.abs(w),
            Math.abs(h),
            Math.min(12, Math.abs(w) / 6, Math.abs(h) / 6),
          );
          o.fill();
        }
        ctx._context.drawImage(canvas, 0, 0);
      }}
    />
  );
}
