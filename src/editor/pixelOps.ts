/**
 * Pixel edits on the capture itself (Snagit's Fill, Eraser, Magic Wand, Selection, Move and
 * Cut Out). Each works on a canvas copy; the editor turns the result into a new `BaseImage`
 * so the edit can be undone.
 */
import type { Area, BaseImage } from "./types";

export type FillMode = "transparent" | "auto";
export type CutEdge = "none" | "fade" | "sharktooth" | "saw" | "wave" | "torn";

export function canvasOf(
  image: CanvasImageSource,
  width: number,
  height: number,
) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d", { willReadFrequently: true })!.drawImage(image, 0, 0);
  return canvas;
}

const ctx2d = (canvas: HTMLCanvasElement) =>
  canvas.getContext("2d", { willReadFrequently: true })!;

export function loadImage(png: ArrayBuffer) {
  const url = URL.createObjectURL(new Blob([png], { type: "image/png" }));
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new window.Image();
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

export async function canvasPngBuffer(canvas: HTMLCanvasElement) {
  const blob = await new Promise<Blob | null>((r) =>
    canvas.toBlob(r, "image/png"),
  );
  if (!blob) throw new Error("Export failed");
  return blob.arrayBuffer();
}

export async function toBase(canvas: HTMLCanvasElement): Promise<BaseImage> {
  const png = await canvasPngBuffer(canvas);
  return {
    png,
    image: await loadImage(png),
    width: canvas.width,
    height: canvas.height,
  };
}

function parseColor(color: string): [number, number, number] {
  const hex = color.replace("#", "");
  const full =
    hex.length === 3
      ? hex
          .split("")
          .map((c) => c + c)
          .join("")
      : hex.slice(0, 6);
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) || 0) as [
    number,
    number,
    number,
  ];
}

export function toHex(r: number, g: number, b: number) {
  return (
    "#" +
    [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")
  );
}

/** The colour of one pixel, as `#rrggbb`. */
export function samplePixel(canvas: HTMLCanvasElement, x: number, y: number) {
  const d = ctx2d(canvas).getImageData(Math.floor(x), Math.floor(y), 1, 1).data;
  return toHex(d[0], d[1], d[2]);
}

/** Pixels similar in colour to the one at (x, y): touching it, or anywhere with `global`. */
export function colorMask(
  canvas: HTMLCanvasElement,
  x: number,
  y: number,
  tolerance: number,
  global = false,
) {
  const { width: w, height: h } = canvas;
  const data = ctx2d(canvas).getImageData(0, 0, w, h).data;
  const mask = new Uint8Array(w * h);
  const sx = Math.floor(x);
  const sy = Math.floor(y);
  if (sx < 0 || sy < 0 || sx >= w || sy >= h) return { mask, bbox: null };
  const i0 = (sy * w + sx) * 4;
  const ref = [data[i0], data[i0 + 1], data[i0 + 2], data[i0 + 3]];
  // Tolerance is a percentage of the largest possible RGBA distance.
  const limit = ((tolerance / 100) * 510) ** 2;
  const near = (p: number) => {
    const i = p * 4;
    const dr = data[i] - ref[0];
    const dg = data[i + 1] - ref[1];
    const db = data[i + 2] - ref[2];
    const da = data[i + 3] - ref[3];
    return dr * dr + dg * dg + db * db + da * da <= limit;
  };
  if (global) {
    for (let p = 0; p < w * h; p++) if (near(p)) mask[p] = 1;
  } else {
    const stack = [sy * w + sx];
    mask[sy * w + sx] = 1;
    while (stack.length) {
      const p = stack.pop()!;
      const px = p % w;
      const py = (p - px) / w;
      const visit = (q: number) => {
        if (!mask[q] && near(q)) {
          mask[q] = 1;
          stack.push(q);
        }
      };
      if (px > 0) visit(p - 1);
      if (px < w - 1) visit(p + 1);
      if (py > 0) visit(p - w);
      if (py < h - 1) visit(p + w);
    }
  }
  return { mask, bbox: maskBounds(mask, w, h) };
}

export function maskBounds(
  mask: Uint8Array,
  w: number,
  h: number,
): Area | null {
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return x1 < 0
    ? null
    : { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
}

/** A mask for a rectangle, ellipse or freehand outline (points in image pixels). */
export function shapeMask(
  w: number,
  h: number,
  shape: "rect" | "ellipse" | "freehand",
  area: Area,
  points: number[] = [],
) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = ctx2d(c);
  g.fillStyle = "#000";
  g.beginPath();
  if (shape === "rect") g.rect(area.x, area.y, area.width, area.height);
  else if (shape === "ellipse")
    g.ellipse(
      area.x + area.width / 2,
      area.y + area.height / 2,
      area.width / 2,
      area.height / 2,
      0,
      0,
      Math.PI * 2,
    );
  else {
    g.moveTo(points[0], points[1]);
    for (let i = 2; i < points.length; i += 2)
      g.lineTo(points[i], points[i + 1]);
    g.closePath();
  }
  g.fill();
  const data = g.getImageData(0, 0, w, h).data;
  const mask = new Uint8Array(w * h);
  for (let p = 0; p < w * h; p++) if (data[p * 4 + 3] > 127) mask[p] = 1;
  return { mask, bbox: maskBounds(mask, w, h) };
}

/** Paints the masked pixels with `color` at `opacity`, in place. */
export function paintMask(
  canvas: HTMLCanvasElement,
  mask: Uint8Array,
  color: string,
  opacity: number,
) {
  const g = ctx2d(canvas);
  const img = g.getImageData(0, 0, canvas.width, canvas.height);
  const d = img.data;
  const [r, gr, b] = parseColor(color);
  const a = Math.max(0, Math.min(1, opacity));
  for (let p = 0; p < mask.length; p++) {
    if (!mask[p]) continue;
    const i = p * 4;
    const srcA = d[i + 3] / 255;
    // Plain "over" compositing of the fill colour onto the pixel.
    const outA = a + srcA * (1 - a);
    const mix = (fg: number, bg: number) =>
      outA ? (fg * a + bg * srcA * (1 - a)) / outA : 0;
    d[i] = mix(r, d[i]);
    d[i + 1] = mix(gr, d[i + 1]);
    d[i + 2] = mix(b, d[i + 2]);
    d[i + 3] = outA * 255;
  }
  g.putImageData(img, 0, 0);
}

/**
 * Cuts the masked pixels out of `canvas` into their own canvas (bbox-sized), leaving a hole
 * that is transparent or filled from its surroundings.
 */
export function liftMask(
  canvas: HTMLCanvasElement,
  mask: Uint8Array,
  bbox: Area,
  fill: FillMode,
) {
  const w = canvas.width;
  const g = ctx2d(canvas);
  const all = g.getImageData(0, 0, w, canvas.height);
  const piece = document.createElement("canvas");
  piece.width = bbox.width;
  piece.height = bbox.height;
  const pg = ctx2d(piece);
  const out = pg.createImageData(bbox.width, bbox.height);
  for (let y = 0; y < bbox.height; y++) {
    for (let x = 0; x < bbox.width; x++) {
      const p = (bbox.y + y) * w + bbox.x + x;
      if (!mask[p]) continue;
      const i = p * 4;
      const o = (y * bbox.width + x) * 4;
      out.data[o] = all.data[i];
      out.data[o + 1] = all.data[i + 1];
      out.data[o + 2] = all.data[i + 2];
      out.data[o + 3] = all.data[i + 3];
    }
  }
  pg.putImageData(out, 0, 0);
  if (fill === "auto") autoFill(all, mask, w, canvas.height);
  else {
    for (let p = 0; p < mask.length; p++) if (mask[p]) all.data[p * 4 + 3] = 0;
  }
  g.putImageData(all, 0, 0);
  return piece;
}

/**
 * Fills the masked hole from the pixels around it: each hole pixel blends the nearest
 * outside pixels left/right and above/below, weighted by distance. A cheap stand-in for
 * content-aware fill that works well on flat UI backgrounds.
 */
function autoFill(img: ImageData, mask: Uint8Array, w: number, h: number) {
  const d = img.data;
  const acc = new Float32Array(w * h * 4);
  const wsum = new Float32Array(w * h);
  const add = (p: number, src: number, weight: number) => {
    const i = src * 4;
    const o = p * 4;
    acc[o] += d[i] * weight;
    acc[o + 1] += d[i + 1] * weight;
    acc[o + 2] += d[i + 2] * weight;
    acc[o + 3] += d[i + 3] * weight;
    wsum[p] += weight;
  };
  // Rows.
  for (let y = 0; y < h; y++) {
    let x = 0;
    while (x < w) {
      if (!mask[y * w + x]) {
        x++;
        continue;
      }
      const start = x;
      while (x < w && mask[y * w + x]) x++;
      const left = start > 0 ? y * w + start - 1 : -1;
      const right = x < w ? y * w + x : -1;
      for (let k = start; k < x; k++) {
        const p = y * w + k;
        if (left >= 0) add(p, left, 1 / (k - start + 1));
        if (right >= 0) add(p, right, 1 / (x - k));
      }
    }
  }
  // Columns.
  for (let x = 0; x < w; x++) {
    let y = 0;
    while (y < h) {
      if (!mask[y * w + x]) {
        y++;
        continue;
      }
      const start = y;
      while (y < h && mask[y * w + x]) y++;
      const top = start > 0 ? (start - 1) * w + x : -1;
      const bottom = y < h ? y * w + x : -1;
      for (let k = start; k < y; k++) {
        const p = k * w + x;
        if (top >= 0) add(p, top, 1 / (k - start + 1));
        if (bottom >= 0) add(p, bottom, 1 / (y - k));
      }
    }
  }
  for (let p = 0; p < mask.length; p++) {
    if (!mask[p]) continue;
    const o = p * 4;
    const s = wsum[p];
    if (!s) {
      d[o + 3] = 0;
      continue;
    }
    d[o] = acc[o] / s;
    d[o + 1] = acc[o + 1] / s;
    d[o + 2] = acc[o + 2] / s;
    d[o + 3] = acc[o + 3] / s;
  }
}

/** Erases along a stroke (to transparency), in place. */
export function eraseStroke(
  canvas: HTMLCanvasElement,
  points: number[],
  width: number,
  opacity: number,
  antialias: boolean,
) {
  const g = ctx2d(canvas);
  g.save();
  g.globalCompositeOperation = "destination-out";
  g.strokeStyle = `rgba(0,0,0,${opacity})`;
  g.lineWidth = width;
  g.lineCap = antialias ? "round" : "square";
  g.lineJoin = "round";
  g.imageSmoothingEnabled = antialias;
  g.beginPath();
  g.moveTo(points[0], points[1]);
  if (points.length === 2) g.lineTo(points[0] + 0.01, points[1]);
  for (let i = 2; i < points.length; i += 2) g.lineTo(points[i], points[i + 1]);
  g.stroke();
  g.restore();
}

/** The most common colour in an area (coarsely quantised), for Simplify blocks. */
export function dominantColor(canvas: HTMLCanvasElement, area: Area) {
  const x = Math.max(0, Math.floor(area.x));
  const y = Math.max(0, Math.floor(area.y));
  const w = Math.max(1, Math.min(canvas.width - x, Math.round(area.width)));
  const h = Math.max(1, Math.min(canvas.height - y, Math.round(area.height)));
  const d = ctx2d(canvas).getImageData(x, y, w, h).data;
  const counts = new Map<number, [number, number, number, number]>();
  const step = Math.max(1, Math.floor(Math.sqrt((w * h) / 20000)));
  for (let yy = 0; yy < h; yy += step) {
    for (let xx = 0; xx < w; xx += step) {
      const i = (yy * w + xx) * 4;
      if (d[i + 3] < 128) continue;
      const key = ((d[i] >> 4) << 8) | ((d[i + 1] >> 4) << 4) | (d[i + 2] >> 4);
      const c = counts.get(key) ?? [0, 0, 0, 0];
      c[0] += d[i];
      c[1] += d[i + 1];
      c[2] += d[i + 2];
      c[3]++;
      counts.set(key, c);
    }
  }
  let best: [number, number, number, number] | null = null;
  for (const c of counts.values()) if (!best || c[3] > best[3]) best = c;
  return best
    ? toHex(best[0] / best[3], best[1] / best[3], best[2] / best[3])
    : "#cccccc";
}

/**
 * Removes the band [from, to) — columns for `vertical`, rows otherwise — and joins the two
 * sides with the chosen seam. Returns the new canvas and how far the far side moved back.
 */
export function cutOut(
  canvas: HTMLCanvasElement,
  vertical: boolean,
  from: number,
  to: number,
  edge: CutEdge,
) {
  // Horizontal cuts reuse the vertical code on a transposed image.
  const src = vertical ? canvas : transpose(canvas);
  const { result, shift } = cutColumns(
    src,
    Math.round(from),
    Math.round(to),
    edge,
  );
  return { canvas: vertical ? result : transpose(result), shift };
}

function transpose(canvas: HTMLCanvasElement) {
  const out = document.createElement("canvas");
  out.width = canvas.height;
  out.height = canvas.width;
  const g = ctx2d(out);
  g.setTransform(0, 1, 1, 0, 0, 0);
  g.drawImage(canvas, 0, 0);
  return out;
}

const GAP = 10;
const AMP = 6;

function cutColumns(
  src: HTMLCanvasElement,
  a: number,
  b: number,
  edge: CutEdge,
) {
  const w = src.width;
  const h = src.height;
  a = Math.max(0, Math.min(w, a));
  b = Math.max(a, Math.min(w, b));
  const cut = b - a;
  if (edge === "none" || edge === "fade") {
    const out = document.createElement("canvas");
    out.width = Math.max(1, w - cut);
    out.height = h;
    const g = ctx2d(out);
    g.drawImage(src, b, 0, w - b, h, a, 0, w - b, h);
    if (edge === "fade") {
      // Cross-fade the left side's next pixels over the join.
      const f = Math.min(24, cut, a, w - b);
      if (f > 0) {
        const tmp = document.createElement("canvas");
        tmp.width = f * 2;
        tmp.height = h;
        const tg = ctx2d(tmp);
        tg.drawImage(src, a - f, 0, f * 2, h, 0, 0, f * 2, h);
        tg.globalCompositeOperation = "destination-in";
        const grad = tg.createLinearGradient(0, 0, f * 2, 0);
        grad.addColorStop(0, "rgba(0,0,0,1)");
        grad.addColorStop(0.5, "rgba(0,0,0,1)");
        grad.addColorStop(1, "rgba(0,0,0,0)");
        tg.fillStyle = grad;
        tg.fillRect(0, 0, f * 2, h);
        g.drawImage(src, 0, 0, a, h, 0, 0, a, h);
        g.drawImage(tmp, a - f, 0);
        return { result: out, shift: cut };
      }
    }
    g.drawImage(src, 0, 0, a, h, 0, 0, a, h);
    return { result: out, shift: cut };
  }
  // Jagged seams leave a transparent gap whose two edges follow the same pattern.
  const out = document.createElement("canvas");
  out.width = Math.max(1, w - cut + GAP);
  out.height = h;
  const g = ctx2d(out);
  const f = seamFn(edge, h);
  const left = new Path2D();
  left.moveTo(0, 0);
  for (let y = 0; y <= h; y += 2) left.lineTo(a + f(y), y);
  left.lineTo(0, h);
  left.closePath();
  g.save();
  g.clip(left);
  g.drawImage(
    src,
    0,
    0,
    Math.min(w, a + AMP),
    h,
    0,
    0,
    Math.min(w, a + AMP),
    h,
  );
  g.restore();
  const right = new Path2D();
  right.moveTo(out.width, 0);
  for (let y = 0; y <= h; y += 2) right.lineTo(a + GAP + f(y), y);
  right.lineTo(out.width, h);
  right.closePath();
  g.save();
  g.clip(right);
  const from = Math.max(0, b - AMP);
  g.drawImage(src, from, 0, w - from, h, a + GAP - (b - from), 0, w - from, h);
  g.restore();
  return { result: out, shift: cut - GAP };
}

function seamFn(edge: CutEdge, h: number): (y: number) => number {
  const period = 14;
  switch (edge) {
    case "sharktooth":
      return (y) => {
        const t = (y % period) / period;
        return (t < 0.5 ? t * 2 : 2 - t * 2) * AMP * 2 - AMP;
      };
    case "saw":
      return (y) => ((y % period) / period) * AMP * 2 - AMP;
    case "wave":
      return (y) => Math.sin((y / period) * Math.PI * 2) * AMP;
    default: {
      // Torn paper: smoothed random walk, fixed per height so redraws match.
      const pts: number[] = [];
      let v = 0;
      let seed = h * 7919;
      const rnd = () => {
        seed = (seed * 16807) % 2147483647;
        return seed / 2147483647;
      };
      for (let y = 0; y <= h + 4; y += 4) {
        v = Math.max(-AMP, Math.min(AMP, v + (rnd() - 0.5) * AMP));
        pts.push(v);
      }
      return (y) => pts[Math.floor(y / 4)] ?? 0;
    }
  }
}
