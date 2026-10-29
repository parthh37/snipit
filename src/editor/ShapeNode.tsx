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
  type PixelateShape,
  type Shape,
  type ShapePatch,
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
    // Keep the pixelated area showing what is underneath while it moves.
    if (shape.type !== "pixelate") return;
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
          cornerRadius={shape.strokeWidth}
          hitStrokeWidth={Math.max(12, shape.strokeWidth)}
          fillEnabled={shape.filled}
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
          lineCap="round"
          lineJoin="round"
          hitStrokeWidth={Math.max(16, shape.strokeWidth * 2)}
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
      return <Pixelated shape={shape} background={background} />;
    case "image":
      return (
        <KImage image={shape.image} width={shape.width} height={shape.height} />
      );
  }
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

function Pixelated({
  shape,
  background,
}: {
  shape: PixelateShape;
  background: HTMLImageElement;
}) {
  const ref = useRef<Konva.Image>(null);
  useEffect(() => {
    if (shape.width >= 1 && shape.height >= 1) ref.current?.cache();
  }, [shape.x, shape.y, shape.width, shape.height, shape.pixelSize]);

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
      filters={[Konva.Filters.Pixelate]}
      pixelSize={shape.pixelSize}
    />
  );
}
