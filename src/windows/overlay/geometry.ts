import type { Point, Rect } from "../../lib/capture";

export function contains(r: Rect, p: Point): boolean {
  return (
    p.x >= r.x && p.x < r.x + r.width && p.y >= r.y && p.y < r.y + r.height
  );
}

/** The pixel rectangle spanning both points, inclusive of each. */
export function rectFromPoints(a: Point, b: Point): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x) + 1,
    height: Math.abs(a.y - b.y) + 1,
  };
}

/**
 * The square region from `anchor` towards `p`, as large as the longer side of the drag allows
 * while staying inside `bounds`.
 */
export function squareFrom(anchor: Point, p: Point, bounds: Rect): Rect {
  const dx = p.x >= anchor.x ? 1 : -1;
  const dy = p.y >= anchor.y ? 1 : -1;
  const room = (from: number, dir: number, lo: number, len: number) =>
    dir > 0 ? lo + len - 1 - from : from - lo;
  const side = Math.min(
    Math.max(Math.abs(p.x - anchor.x), Math.abs(p.y - anchor.y)),
    room(anchor.x, dx, bounds.x, bounds.width),
    room(anchor.y, dy, bounds.y, bounds.height),
  );
  return rectFromPoints(anchor, {
    x: anchor.x + dx * side,
    y: anchor.y + dy * side,
  });
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
