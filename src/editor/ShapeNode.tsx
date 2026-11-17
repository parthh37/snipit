import { useEffect, useMemo, useRef } from "react";
import Konva from "konva";
import {
  Arrow,
  Circle,
  Ellipse,
  Group,
  Image as KImage,
  Line,
  Rect,
  Shape as KShape,
  Text,
} from "react-konva";
import {
  CALLOUT_PADDING,
  FONT_FAMILY,
  TEXT_LINE_HEIGHT,
  contrastText,
  type CalloutShape,
  type LineStyle,
  type MagnifyShape,
  type ObscureShape,
  type Shape,
  type ShapePatch,
  type SpotlightShape,
} from "./types";

interface Props {
  shape: Shape;
  background: HTMLImageElement;
  selectable: boolean;
  /** Hidden while its text is being edited in the overlaid textarea. */
  editing?: boolean;
  onSelect?: (id: string) => void;
  onChange?: (id: string, patch: ShapePatch) => void;
  onEdit?: (id: string) => void;
}

/** Shapes whose transformer scale is folded back into width/height. */
const BAKES_SCALE = new Set<Shape["type"]>([
  "rect",
  "ellipse",
  "pixelate",
  "blur",
  "magnify",
  "spotlight",
  "image",
  "callout",
]);

export default function ShapeNode({
  shape,
  background,
  selectable,
  editing,
  onSelect,
  onChange,
  onEdit,
}: Props) {
  const onTransformEnd = (e: Konva.KonvaEventObject<Event>) => {
    const node = e.target;
    const sx = node.scaleX();
    const sy = node.scaleY();
    const base = { x: node.x(), y: node.y(), rotation: node.rotation() };
    if (!BAKES_SCALE.has(shape.type)) {
      onChange?.(shape.id, { ...base, scaleX: sx, scaleY: sy });
      return;
    }
    node.scale({ x: 1, y: 1 });
    if (shape.type === "callout") {
      onChange?.(shape.id, {
        ...base,
        width: Math.max(40, shape.width * sx),
        tailX: shape.tailX * sx,
        tailY: shape.tailY * sy,
      });
    } else if ("height" in shape) {
      onChange?.(shape.id, {
        ...base,
        width: Math.max(2, shape.width * sx),
        height: Math.max(2, shape.height * sy),
      });
    }
  };

  const onDragMove = (e: Konva.KonvaEventObject<DragEvent>) => {
    // Keep the pixelated/blurred area showing what is underneath while it moves.
    if (shape.type !== "pixelate" && shape.type !== "blur") return;
    const group = e.target;
    if (!(group instanceof Konva.Group)) return;
    const image = group.findOne<Konva.Image>("Image");
    if (!image) return;
    image.crop({
      x: e.target.x(),
      y: e.target.y(),
      width: shape.width,
      height: shape.height,
    });
    image.cache();
  };

  return (
    <Group
      id={shape.id}
      x={shape.x}
      y={shape.y}
      rotation={shape.rotation ?? 0}
      scaleX={shape.scaleX ?? 1}
      scaleY={shape.scaleY ?? 1}
      // A text label is drawn by the textarea while editing; a bubble keeps its background.
      opacity={editing && shape.type === "text" ? 0 : 1}
      draggable={selectable}
      listening={selectable}
      onMouseDown={() => onSelect?.(shape.id)}
      onTap={() => onSelect?.(shape.id)}
      onDblClick={() => onEdit?.(shape.id)}
      onDragMove={onDragMove}
      onDragEnd={(e) =>
        onChange?.(shape.id, { x: e.target.x(), y: e.target.y() })
      }
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
  background: HTMLImageElement;
  editing?: boolean;
}) {
  switch (shape.type) {
    case "rect":
      return (
        <Rect
          width={shape.width}
          height={shape.height}
          stroke={shape.filled ? undefined : shape.stroke}
          fill={shape.filled ? shape.stroke : undefined}
          strokeWidth={shape.strokeWidth}
          cornerRadius={
            shape.rounded
              ? Math.min(
                  shape.strokeWidth * 4,
                  shape.width / 2,
                  shape.height / 2,
                )
              : shape.strokeWidth
          }
          hitStrokeWidth={Math.max(12, shape.strokeWidth)}
          fillEnabled={shape.filled}
          opacity={shape.opacity ?? 1}
          {...shadowProps(shape.shadow, shape.strokeWidth)}
          {...(!shape.filled && dashProps(shape.dash, shape.strokeWidth))}
        />
      );
    case "ellipse":
      return (
        <Ellipse
          x={shape.width / 2}
          y={shape.height / 2}
          radiusX={shape.width / 2}
          radiusY={shape.height / 2}
          stroke={shape.filled ? undefined : shape.stroke}
          fill={shape.filled ? shape.stroke : undefined}
          strokeWidth={shape.strokeWidth}
          hitStrokeWidth={Math.max(12, shape.strokeWidth)}
          fillEnabled={shape.filled}
          opacity={shape.opacity ?? 1}
          {...shadowProps(shape.shadow, shape.strokeWidth)}
          {...(!shape.filled && dashProps(shape.dash, shape.strokeWidth))}
        />
      );
    case "arrow":
      return (
        <Arrow
          points={shape.points}
          stroke={shape.stroke}
          fill={shape.stroke}
          strokeWidth={shape.strokeWidth}
          pointerLength={shape.strokeWidth * 3.5}
          pointerWidth={shape.strokeWidth * 3.5}
          pointerAtBeginning={!!shape.bothEnds}
          lineCap="round"
          lineJoin="round"
          hitStrokeWidth={Math.max(16, shape.strokeWidth * 2)}
          // A see-through arrow is drawn as one piece, so the head and shaft don't overlap.
          opacity={shape.opacity ?? 1}
          {...shadowProps(shape.shadow, shape.strokeWidth)}
          {...dashProps(shape.dash, shape.strokeWidth, true)}
        />
      );
    case "line":
    case "pen":
      return (
        <Line
          points={shape.points}
          stroke={shape.stroke}
          strokeWidth={shape.strokeWidth}
          lineCap="round"
          lineJoin="round"
          tension={shape.type === "pen" ? 0.4 : 0}
          hitStrokeWidth={Math.max(16, shape.strokeWidth * 2)}
          opacity={shape.opacity ?? 1}
          {...shadowProps(shape.shadow, shape.strokeWidth)}
          {...dashProps(shape.dash, shape.strokeWidth, true)}
        />
      );
    case "highlighter":
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
    case "text":
      return (
        <Text
          text={shape.text || " "}
          fill={shape.fill}
          fontSize={shape.fontSize}
          fontFamily={FONT_FAMILY}
          fontStyle="600"
          lineHeight={TEXT_LINE_HEIGHT}
          shadowColor="rgba(0,0,0,0.35)"
          shadowBlur={shape.fontSize / 6}
        />
      );
    case "callout":
      return <Callout shape={shape} editing={editing} />;
    case "step":
      return (
        <>
          <Circle
            radius={shape.radius}
            fill={shape.fill}
            stroke="#ffffff"
            strokeWidth={shape.radius / 8}
            shadowColor="rgba(0,0,0,0.35)"
            shadowBlur={shape.radius / 3}
          />
          <Text
            text={String(shape.n)}
            width={shape.radius * 2}
            height={shape.radius * 2}
            offsetX={shape.radius}
            offsetY={shape.radius}
            align="center"
            verticalAlign="middle"
            fill={contrastText(shape.fill)}
            fontSize={shape.radius * 1.1}
            fontStyle="bold"
            fontFamily={FONT_FAMILY}
          />
        </>
      );
    case "pixelate":
    case "blur":
      return <Obscured shape={shape} background={background} />;
    case "magnify":
      return <Lens shape={shape} background={background} />;
    case "spotlight":
      // Invisible but hit-testable: the dimming around it is drawn by `SpotlightDim`.
      return (
        <Rect width={shape.width} height={shape.height} fill="rgba(0,0,0,0)" />
      );
    case "image":
      return (
        <KImage image={shape.image} width={shape.width} height={shape.height} />
      );
  }
}

/**
 * Konva props for a dashed or dotted stroke. Round caps grow each dash by a stroke width,
 * so `roundCap` strokes get shorter dashes and longer gaps to look the same.
 */
function dashProps(
  style: LineStyle | undefined,
  width: number,
  roundCap = false,
) {
  switch (style) {
    case "dashed":
      return {
        dash: roundCap ? [width * 2, width * 3] : [width * 3, width * 2],
        dashEnabled: true,
      };
    case "dotted":
      // Near-zero dashes with round caps draw as dots, one stroke width across.
      return {
        dash: [0.001, width * 2],
        dashEnabled: true,
        lineCap: "round" as const,
      };
    default:
      return { dashEnabled: false };
  }
}

/** Konva props for an annotation's optional drop shadow, scaled to its stroke. */
function shadowProps(on: boolean | undefined, width: number) {
  if (!on) return { shadowEnabled: false };
  return {
    shadowEnabled: true,
    shadowColor: "#000000",
    shadowOpacity: 0.35,
    shadowBlur: Math.max(2, width * 1.2),
    shadowOffsetX: Math.max(1, width * 0.3),
    shadowOffsetY: Math.max(1, width * 0.45),
  };
}

/** Height of the wrapped text inside a callout bubble. */
function calloutTextHeight(
  shape: Pick<CalloutShape, "text" | "width" | "fontSize">,
) {
  return new Konva.Text({
    text: shape.text || " ",
    width: shape.width - CALLOUT_PADDING * 2,
    fontSize: shape.fontSize,
    fontFamily: FONT_FAMILY,
    lineHeight: TEXT_LINE_HEIGHT,
    wrap: "word",
  }).height();
}

function Callout({
  shape,
  editing,
}: {
  shape: CalloutShape;
  editing?: boolean;
}) {
  const height = useMemo(
    () => calloutTextHeight(shape) + CALLOUT_PADDING * 2,
    [shape],
  );
  const { width, tailX, tailY, fill } = shape;

  return (
    <>
      <KShape
        fill={fill}
        shadowColor="rgba(0,0,0,0.3)"
        shadowBlur={10}
        shadowOffsetY={2}
        sceneFunc={(ctx, node) => {
          const r = Math.min(10, width / 2, height / 2);
          // Tail: a triangle from the bubble centre out to the tip; same fill, so the part
          // inside the bubble is invisible.
          const cx = width / 2;
          const cy = height / 2;
          const dx = tailX - cx;
          const dy = tailY - cy;
          const len = Math.hypot(dx, dy) || 1;
          const half = Math.min(14, width / 4, height / 3);
          const px = (-dy / len) * half;
          const py = (dx / len) * half;

          ctx.beginPath();
          ctx.moveTo(r, 0);
          ctx.arcTo(width, 0, width, height, r);
          ctx.arcTo(width, height, 0, height, r);
          ctx.arcTo(0, height, 0, 0, r);
          ctx.arcTo(0, 0, width, 0, r);
          ctx.closePath();
          // Clockwise like the rectangle, or the non-zero fill rule cuts a notch out.
          ctx.moveTo(cx - px, cy - py);
          ctx.lineTo(tailX, tailY);
          ctx.lineTo(cx + px, cy + py);
          ctx.closePath();
          ctx.fillStrokeShape(node);
        }}
        hitFunc={(ctx, node) => {
          ctx.beginPath();
          ctx.rect(0, 0, width, height);
          ctx.moveTo(width / 2, height / 2);
          ctx.lineTo(tailX, tailY);
          ctx.closePath();
          ctx.fillStrokeShape(node);
        }}
      />
      <Text
        x={CALLOUT_PADDING}
        y={CALLOUT_PADDING}
        width={width - CALLOUT_PADDING * 2}
        visible={!editing}
        text={shape.text || " "}
        fill={contrastText(fill)}
        fontSize={shape.fontSize}
        fontFamily={FONT_FAMILY}
        lineHeight={TEXT_LINE_HEIGHT}
        wrap="word"
      />
    </>
  );
}

function Obscured({
  shape,
  background,
}: {
  shape: ObscureShape;
  background: HTMLImageElement;
}) {
  const ref = useRef<Konva.Image>(null);
  useEffect(() => {
    if (shape.width >= 1 && shape.height >= 1) ref.current?.cache();
  }, [shape.x, shape.y, shape.width, shape.height, shape.amount, shape.type]);

  const blur = shape.type === "blur";

  return (
    <KImage
      ref={ref}
      image={background}
      crop={{
        x: shape.x,
        y: shape.y,
        width: shape.width,
        height: shape.height,
      }}
      width={shape.width}
      height={shape.height}
      filters={[blur ? Konva.Filters.Blur : Konva.Filters.Pixelate]}
      pixelSize={blur ? undefined : shape.amount}
      blurRadius={blur ? shape.amount : undefined}
    />
  );
}

/** The canvas context Konva draws through, for what its wrapper can't do (clip, drawImage). */
const native = (ctx: Konva.Context) =>
  (ctx as unknown as { _context: CanvasRenderingContext2D })._context;

/**
 * The magnifier: the background under the lens, drawn `zoom` times larger inside a ring. It
 * reads its group's live position, so it keeps magnifying what is underneath while dragged.
 */
function Lens({
  shape,
  background,
}: {
  shape: MagnifyShape;
  background: HTMLImageElement;
}) {
  const { width: w, height: h, zoom } = shape;
  return (
    <KShape
      width={w}
      height={h}
      stroke={shape.stroke}
      strokeWidth={shape.strokeWidth}
      {...shadowProps(true, shape.strokeWidth)}
      sceneFunc={(ctx, node) => {
        const group = node.getParent();
        const cx = (group?.x() ?? shape.x) + w / 2;
        const cy = (group?.y() ?? shape.y) + h / 2;
        const sw = w / zoom;
        const sh = h / zoom;
        const c = native(ctx);
        c.save();
        c.beginPath();
        c.ellipse(w / 2, h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
        c.clip();
        c.fillStyle = "#ffffff";
        c.fillRect(0, 0, w, h);
        c.imageSmoothingQuality = "high";
        c.drawImage(background, cx - sw / 2, cy - sh / 2, sw, sh, 0, 0, w, h);
        c.restore();
        ctx.beginPath();
        ctx.ellipse(w / 2, h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
        ctx.closePath();
        ctx.strokeShape(node);
      }}
      hitFunc={(ctx, node) => {
        ctx.beginPath();
        ctx.ellipse(w / 2, h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
        ctx.closePath();
        ctx.fillStrokeShape(node);
      }}
    />
  );
}

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
  const dim = Math.max(...spotlights.map((s) => s.dim));
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
        native(ctx).drawImage(canvas, 0, 0);
      }}
    />
  );
}
