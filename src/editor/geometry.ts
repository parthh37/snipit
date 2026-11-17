/** Pure drawing maths for the editor's objects: no Konva or React here. */
import type {
  BoxKind,
  CalloutShape,
  Cap,
  Dash,
  LineShape,
  ShadowDir,
} from "./types";

export interface Pt {
  x: number;
  y: number;
}

/** A line's centre path: straight, or a quadratic Bezier through `control`, as a polyline. */
export function linePath(shape: Pick<LineShape, "points" | "control">): Pt[] {
  const [x0, y0, x1, y1] = shape.points;
  const c = shape.control;
  if (!c)
    return [
      { x: x0, y: y0 },
      { x: x1, y: y1 },
    ];
  // `control` is the point the curve passes through at its middle; the Bezier control point
  // that achieves that is twice as far from the chord.
  const cx = 2 * c.x - (x0 + x1) / 2;
  const cy = 2 * c.y - (y0 + y1) / 2;
  const out: Pt[] = [];
  const steps = 40;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const a = (1 - t) * (1 - t);
    const b = 2 * (1 - t) * t;
    const d = t * t;
    out.push({ x: a * x0 + b * cx + d * x1, y: a * y0 + b * cy + d * y1 });
  }
  return out;
}

const dist = (a: Pt, b: Pt) => Math.hypot(b.x - a.x, b.y - a.y);

export function pathLength(path: Pt[]) {
  let n = 0;
  for (let i = 1; i < path.length; i++) n += dist(path[i - 1], path[i]);
  return n;
}

/** Cuts `fromStart` and `fromEnd` length off a polyline, so caps can sit on its ends. */
export function trimPath(path: Pt[], fromStart: number, fromEnd: number): Pt[] {
  const total = pathLength(path);
  if (total <= fromStart + fromEnd + 0.5) {
    const mid = pointAt(path, Math.min(total, fromStart));
    return [mid, mid];
  }
  const out: Pt[] = [pointAt(path, fromStart)];
  let acc = 0;
  for (let i = 1; i < path.length; i++) {
    acc += dist(path[i - 1], path[i]);
    if (acc > fromStart && acc < total - fromEnd) out.push(path[i]);
  }
  out.push(pointAt(path, total - fromEnd));
  return out;
}

function pointAt(path: Pt[], at: number): Pt {
  let acc = 0;
  for (let i = 1; i < path.length; i++) {
    const seg = dist(path[i - 1], path[i]);
    if (acc + seg >= at) {
      const t = seg ? (at - acc) / seg : 0;
      return {
        x: path[i - 1].x + (path[i].x - path[i - 1].x) * t,
        y: path[i - 1].y + (path[i].y - path[i - 1].y) * t,
      };
    }
    acc += seg;
  }
  return path[path.length - 1];
}

/** Unit direction the path travels at its end (or, with `atStart`, away from its start). */
export function endDirection(path: Pt[], atStart: boolean): Pt {
  const total = pathLength(path);
  const probe = Math.min(total, 6);
  const [tip, back] = atStart
    ? [path[0], pointAt(path, probe)]
    : [path[path.length - 1], pointAt(path, total - probe)];
  const len = dist(back, tip) || 1;
  return { x: (tip.x - back.x) / len, y: (tip.y - back.y) / len };
}

/** How far a cap's shape reaches back along the line from its tip, so the shaft stops there. */
export function capInset(cap: Cap, width: number, size: number) {
  const s = capLength(width, size);
  switch (cap) {
    case "arrow":
      return s * 0.9;
    case "barbed":
      return s * 0.6;
    case "circle":
    case "square":
    case "diamond":
      return 0;
    default:
      return 0;
  }
}

export const capLength = (width: number, size: number) =>
  Math.max(width * 1.2, width * (1 + size * 0.9));

/**
 * Draws a cap at `tip`, pointing along `dir`, into `ctx` as a filled (or for open/tbar,
 * stroked) path. Returns whether it needs a stroke rather than a fill.
 */
export function capPath(
  ctx: CanvasRenderingContext2D | Path2D,
  cap: Cap,
  tip: Pt,
  dir: Pt,
  width: number,
  size: number,
): "fill" | "stroke" | null {
  const len = capLength(width, size);
  const half = len * 0.55;
  const nx = -dir.y;
  const ny = dir.x;
  const back = (d: number, side = 0) => ({
    x: tip.x - dir.x * d + nx * side,
    y: tip.y - dir.y * d + ny * side,
  });
  const poly = (pts: Pt[]) => {
    ctx.moveTo(pts[0].x, pts[0].y);
    for (const p of pts.slice(1)) ctx.lineTo(p.x, p.y);
    ctx.closePath();
  };
  switch (cap) {
    case "arrow":
      poly([tip, back(len, half), back(len, -half)]);
      return "fill";
    case "barbed":
      poly([tip, back(len, half), back(len * 0.62), back(len, -half)]);
      return "fill";
    case "open": {
      const a = back(len, half);
      const b = back(len, -half);
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(tip.x, tip.y);
      ctx.lineTo(b.x, b.y);
      return "stroke";
    }
    case "circle": {
      const r = Math.max(width, len * 0.42);
      const c = back(0);
      ctx.moveTo(c.x + r, c.y);
      ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
      return "fill";
    }
    case "square": {
      const r = Math.max(width, len * 0.4);
      poly([back(-r, r), back(r, r), back(r, -r), back(-r, -r)]);
      return "fill";
    }
    case "diamond": {
      const r = Math.max(width * 1.2, len * 0.5);
      poly([back(-r), back(0, r), back(r), back(0, -r)]);
      return "fill";
    }
    case "tbar": {
      const r = Math.max(width * 1.5, len * 0.5);
      const a = back(0, r);
      const b = back(0, -r);
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      return "stroke";
    }
    default:
      return null;
  }
}

/** Canvas dash pattern for a line of `width`, given its cap style. */
export function dashArray(dash: Dash, width: number, round: boolean): number[] {
  const w = Math.max(1, width);
  const gap = round ? w * 2.2 : w * 1.2;
  const dot = round ? 0.001 : w;
  const long = round ? w * 2 : w * 3;
  switch (dash) {
    case "dash":
      return [long, gap];
    case "dot":
      return [dot, gap];
    case "dashdot":
      return [long, gap, dot, gap];
    case "dashdotdot":
      return [long, gap, dot, gap, dot, gap];
    default:
      return [];
  }
}

const SHADOW_DIR: Record<ShadowDir, [number, number]> = {
  tl: [-1, -1],
  t: [0, -1],
  tr: [1, -1],
  l: [-1, 0],
  center: [0, 0],
  r: [1, 0],
  bl: [-1, 1],
  b: [0, 1],
  br: [1, 1],
};

/** Konva props for a drop shadow in direction `dir`, sized to the object. */
export function shadowProps(dir: ShadowDir | null | undefined, size: number) {
  if (!dir) return { shadowEnabled: false };
  const [dx, dy] = SHADOW_DIR[dir];
  const offset = Math.max(2, Math.min(12, size * 0.35));
  return {
    shadowEnabled: true,
    shadowColor: "#000000",
    shadowOpacity: dir === "center" ? 0.55 : 0.4,
    shadowBlur: Math.max(4, Math.min(18, size * 0.8)),
    shadowOffsetX: dx * offset,
    shadowOffsetY: dy * offset,
  };
}

/** Outline of a Shape-tool object of the given size, as polygon points (except rect/ellipse). */
export function boxPolygon(kind: BoxKind, w: number, h: number): Pt[] {
  switch (kind) {
    case "triangle":
      return [
        { x: w / 2, y: 0 },
        { x: w, y: h },
        { x: 0, y: h },
      ];
    case "diamond":
      return [
        { x: w / 2, y: 0 },
        { x: w, y: h / 2 },
        { x: w / 2, y: h },
        { x: 0, y: h / 2 },
      ];
    case "hexagon":
      return [
        { x: w * 0.25, y: 0 },
        { x: w * 0.75, y: 0 },
        { x: w, y: h / 2 },
        { x: w * 0.75, y: h },
        { x: w * 0.25, y: h },
        { x: 0, y: h / 2 },
      ];
    case "star": {
      const pts: Pt[] = [];
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        const r = i % 2 ? 0.42 : 1;
        pts.push({
          x: w / 2 + Math.cos(a) * (w / 2) * r,
          y: h / 2 + Math.sin(a) * (h / 2) * r * 1.05 + h * 0.03,
        });
      }
      return pts;
    }
    default:
      return [
        { x: 0, y: 0 },
        { x: w, y: 0 },
        { x: w, y: h },
        { x: 0, y: h },
      ];
  }
}

/** Callout bodies with a pointer built into their outline (the rest get a line arrow). */
export const POINTER_BODIES = new Set<CalloutShape["body"]>([
  "speech",
  "speechRound",
  "cloud",
]);

/**
 * Traces a callout's body (and, for speech/cloud bodies, its pointer) into `ctx`.
 * Coordinates are relative to the callout's top-left.
 */
export function calloutPath(
  ctx: CanvasRenderingContext2D | Path2D,
  shape: Pick<CalloutShape, "body" | "width" | "height" | "tail">,
) {
  const { width: w, height: h, tail } = shape;
  switch (shape.body) {
    case "oval":
      ctx.moveTo(w, h / 2);
      ctx.ellipse(w / 2, h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
      return;
    case "rounded":
    case "speechRound": {
      const r = Math.min(h / 2, w / 2, Math.max(8, h * 0.35));
      roundRect(ctx, w, h, r, shape.body === "speechRound" ? tail : null);
      return;
    }
    case "speech":
      roundRect(ctx, w, h, Math.min(4, w / 2, h / 2), tail);
      return;
    case "cloud":
      cloud(ctx, w, h);
      if (tail) {
        // Thought bubbles: shrinking puffs out towards the tail.
        const cx = w / 2;
        const cy = h / 2;
        for (const [t, r] of [
          [0.62, 0.075],
          [0.8, 0.05],
          [0.94, 0.03],
        ]) {
          const px = cx + (tail.x - cx) * t;
          const py = cy + (tail.y - cy) * t;
          const rr = Math.max(3, Math.min(w, h) * r);
          ctx.moveTo(px + rr, py);
          ctx.arc(px, py, rr, 0, Math.PI * 2);
        }
      }
      return;
    case "arrowRight":
    case "arrowLeft": {
      const head = Math.min(w * 0.35, h * 0.6);
      const inset = h * 0.18;
      const pts: Pt[] =
        shape.body === "arrowRight"
          ? [
              { x: 0, y: inset },
              { x: w - head, y: inset },
              { x: w - head, y: 0 },
              { x: w, y: h / 2 },
              { x: w - head, y: h },
              { x: w - head, y: h - inset },
              { x: 0, y: h - inset },
            ]
          : [
              { x: w, y: inset },
              { x: head, y: inset },
              { x: head, y: 0 },
              { x: 0, y: h / 2 },
              { x: head, y: h },
              { x: head, y: h - inset },
              { x: w, y: h - inset },
            ];
      ctx.moveTo(pts[0].x, pts[0].y);
      for (const p of pts.slice(1)) ctx.lineTo(p.x, p.y);
      ctx.closePath();
      return;
    }
    default:
      ctx.rect(0, 0, w, h);
  }
}

/** Rounded rectangle, with a wedge out to `tail` merged into its outline when given. */
function roundRect(
  ctx: CanvasRenderingContext2D | Path2D,
  w: number,
  h: number,
  r: number,
  tail: Pt | null,
) {
  const inside = tail && tail.x > 0 && tail.x < w && tail.y > 0 && tail.y < h;
  if (!tail || inside) {
    ctx.moveTo(r, 0);
    ctx.arcTo(w, 0, w, h, r);
    ctx.arcTo(w, h, 0, h, r);
    ctx.arcTo(0, h, 0, 0, r);
    ctx.arcTo(0, 0, w, 0, r);
    ctx.closePath();
    return;
  }
  // The wedge leaves from the edge facing the tail, a fifth of that edge wide.
  const cx = w / 2;
  const cy = h / 2;
  const dx = (tail.x - cx) / w;
  const dy = (tail.y - cy) / h;
  const side: "t" | "b" | "l" | "r" =
    Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "r" : "l") : dy > 0 ? "b" : "t";
  const base = side === "t" || side === "b" ? w : h;
  const half = Math.max(6, base * 0.1);
  const at =
    side === "t" || side === "b"
      ? clampNum(tail.x, r + half, w - r - half)
      : clampNum(tail.y, r + half, h - r - half);
  ctx.moveTo(r, 0);
  if (side === "t") {
    ctx.lineTo(at - half, 0);
    ctx.lineTo(tail.x, tail.y);
    ctx.lineTo(at + half, 0);
  }
  ctx.arcTo(w, 0, w, h, r);
  if (side === "r") {
    ctx.lineTo(w, at - half);
    ctx.lineTo(tail.x, tail.y);
    ctx.lineTo(w, at + half);
  }
  ctx.arcTo(w, h, 0, h, r);
  if (side === "b") {
    ctx.lineTo(at + half, h);
    ctx.lineTo(tail.x, tail.y);
    ctx.lineTo(at - half, h);
  }
  ctx.arcTo(0, h, 0, 0, r);
  if (side === "l") {
    ctx.lineTo(0, at + half);
    ctx.lineTo(tail.x, tail.y);
    ctx.lineTo(0, at - half);
  }
  ctx.arcTo(0, 0, w, 0, r);
  ctx.closePath();
}

function cloud(ctx: CanvasRenderingContext2D | Path2D, w: number, h: number) {
  // Puffs around an ellipse.
  const n = 10;
  const rx = w / 2;
  const ry = h / 2;
  const pts: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    pts.push({
      x: rx + Math.cos(a) * rx * 0.86,
      y: ry + Math.sin(a) * ry * 0.8,
    });
  }
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const ox = mid.x - rx;
    const oy = mid.y - ry;
    const len = Math.hypot(ox / rx, oy / ry) || 1;
    ctx.quadraticCurveTo(
      rx + (ox / len) * 1.18,
      ry + (oy / len) * 1.18,
      b.x,
      b.y,
    );
  }
  ctx.closePath();
}

const clampNum = (v: number, lo: number, hi: number) =>
  hi < lo ? (lo + hi) / 2 : Math.min(hi, Math.max(lo, v));

/** Where a callout's line arrow leaves its body: the edge point facing the tail. */
export function calloutAnchor(
  shape: Pick<CalloutShape, "width" | "height" | "tail">,
): Pt {
  const { width: w, height: h, tail } = shape;
  const c = { x: w / 2, y: h / 2 };
  if (!tail) return c;
  const dx = tail.x - c.x;
  const dy = tail.y - c.y;
  if (!dx && !dy) return c;
  const t = Math.min(
    dx ? w / 2 / Math.abs(dx) : Infinity,
    dy ? h / 2 / Math.abs(dy) : Infinity,
  );
  return { x: c.x + dx * t, y: c.y + dy * t };
}

/** Points of a step badge's outline when it has a point. */
export function stepPointer(size: number, angleDeg: number): Pt[] {
  const r = size / 2;
  const a = (angleDeg * Math.PI) / 180;
  const tip = { x: Math.cos(a) * r * 1.55, y: Math.sin(a) * r * 1.55 };
  const spread = 0.5;
  return [
    { x: Math.cos(a - spread) * r, y: Math.sin(a - spread) * r },
    tip,
    { x: Math.cos(a + spread) * r, y: Math.sin(a + spread) * r },
  ];
}
