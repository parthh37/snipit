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

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
