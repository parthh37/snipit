/**
 * The `.snip` project file: an edited snip that can be reopened with every annotation still
 * editable. It is a ZIP archive (rename it to `.zip` to look inside):
 *
 * ```
 * document.json   format + version, image size, crop, and the shapes
 * metadata.json   facts about the snip (when it was saved); grows with capture details later
 * original.png    the captured pixels, untouched
 * base.png        the capture after pixel edits (fill, eraser, cut out…), when there are any
 * thumbnail.png   small flattened preview
 * assets/<id>.png images pasted onto the snip
 * ```
 *
 * The gallery keeps showing the flattened `<name>_edited.png`; the `.snip` sits beside it with
 * the same name. A blur or pixelate in a `.snip` can be undone, because the original pixels
 * are inside: share the PNG, never the `.snip`, when something must stay hidden.
 *
 * Nothing here touches the DOM, so it can be checked outside the app.
 */
import { contrastText, type Area, type ImageShape, type Shape } from "./types";

export const SNIP_FORMAT = "snipit";
/** 2: Snagit-style shapes and a pixel-edited base image. Version 1 files are migrated. */
export const SNIP_VERSION = 2;

/** A pasted image as stored: its pixels live in `asset`, not in the shape. */
export type StoredImageShape = Omit<ImageShape, "image" | "png"> & {
  asset: string;
};
export type StoredShape = Exclude<Shape, ImageShape> | StoredImageShape;

interface DocumentJson {
  format: typeof SNIP_FORMAT;
  version: number;
  image: { file: string; width: number; height: number };
  /** The edited background, when pixel tools changed it. */
  base?: { file: string; width: number; height: number } | null;
  crop: Area | null;
  shapes: StoredShape[];
}

export interface SnipMetadata {
  /** ISO 8601. */
  savedAt: string;
}

export interface SnipProject {
  /** PNG bytes of the untouched capture. */
  original: Uint8Array;
  width: number;
  height: number;
  /** The pixel-edited background, if any. */
  base: { png: Uint8Array; width: number; height: number } | null;
  crop: Area | null;
  shapes: StoredShape[];
  /** PNG bytes for each image shape's `asset`. */
  assets: Map<string, Uint8Array>;
  metadata: SnipMetadata | null;
}

const SHAPE_TYPES = new Set<string>([
  "arrow",
  "line",
  "pen",
  "shape",
  "text",
  "callout",
  "step",
  "blur",
  "highlight",
  "magnify",
  "block",
  "stamp",
  "image",
]);

/** Builds a `.snip` archive. Image shapes must carry their PNG bytes in `png`. */
export async function encodeSnip(doc: {
  original: Uint8Array;
  width: number;
  height: number;
  crop: Area | null;
  shapes: Shape[];
  base?: { png: Uint8Array; width: number; height: number } | null;
  thumbnail?: Uint8Array;
  now?: Date;
}): Promise<Uint8Array> {
  const now = doc.now ?? new Date();
  const assets: ZipEntry[] = [];
  const shapes: StoredShape[] = doc.shapes.map((shape) => {
    if (shape.type !== "image") return shape;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- dropped from the JSON
    const { image, png, ...rest } = shape;
    const asset = `assets/${safeName(shape.id)}.png`;
    assets.push({ name: asset, data: new Uint8Array(png) });
    return { ...rest, asset };
  });
  const document: DocumentJson = {
    format: SNIP_FORMAT,
    version: SNIP_VERSION,
    image: { file: "original.png", width: doc.width, height: doc.height },
    base: doc.base
      ? { file: "base.png", width: doc.base.width, height: doc.base.height }
      : null,
    crop: doc.crop,
    shapes,
  };
  const metadata: SnipMetadata = { savedAt: now.toISOString() };
  const entries: ZipEntry[] = [
    { name: "document.json", data: json(document), deflate: true },
    { name: "metadata.json", data: json(metadata), deflate: true },
    { name: "original.png", data: doc.original },
    ...(doc.base ? [{ name: "base.png", data: doc.base.png }] : []),
    ...(doc.thumbnail ? [{ name: "thumbnail.png", data: doc.thumbnail }] : []),
    ...assets,
  ];
  return writeZip(entries, now);
}

/** Reads a `.snip` archive, rejecting files from a newer Snipit or that aren't snips. */
export async function decodeSnip(bytes: Uint8Array): Promise<SnipProject> {
  const files = await readZip(bytes);
  const text = (name: string) => {
    const data = files.get(name);
    return data && new TextDecoder().decode(data);
  };
  const docText = text("document.json");
  if (!docText)
    throw new Error("Not a Snipit project: document.json is missing");
  const doc = JSON.parse(docText) as Partial<DocumentJson>;
  if (doc.format !== SNIP_FORMAT) throw new Error("Not a Snipit project");
  if (typeof doc.version !== "number" || doc.version > SNIP_VERSION) {
    throw new Error(
      "This snip was saved by a newer version of Snipit. Update Snipit to edit it.",
    );
  }
  const original = doc.image && files.get(doc.image.file);
  if (!original) throw new Error("The snip's original image is missing");

  const assets = new Map<string, Uint8Array>();
  const raw = Array.isArray(doc.shapes) ? doc.shapes : [];
  const upgraded = doc.version < 2 ? raw.map(migrateV1) : raw;
  // Shapes a newer minor version might add are skipped rather than failing the whole file.
  const shapes = upgraded.filter((shape) => {
    if (!shape || !SHAPE_TYPES.has(shape.type)) return false;
    if (shape.type !== "image") return true;
    const data = files.get(shape.asset);
    if (data) assets.set(shape.asset, data);
    return !!data;
  });
  const metaText = text("metadata.json");
  const basePng = doc.base ? files.get(doc.base.file) : undefined;
  return {
    original,
    width: doc.image!.width,
    height: doc.image!.height,
    base:
      doc.base && basePng
        ? { png: basePng, width: doc.base.width, height: doc.base.height }
        : null,
    crop: doc.crop ?? null,
    shapes,
    assets,
    metadata: metaText ? (JSON.parse(metaText) as SnipMetadata) : null,
  };
}

type Loose = Record<string, unknown> & { type: string };

const V1_DASH: Record<string, string> = {
  solid: "solid",
  dashed: "dash",
  dotted: "dot",
};

/** Folds a v1 transformer scale and rotation into a flat point list. */
const scaled = (s: Loose) => {
  const sx = (s.scaleX as number) ?? 1;
  const sy = (s.scaleY as number) ?? 1;
  const a = (((s.rotation as number) ?? 0) * Math.PI) / 180;
  const pts = (s.points as number[]) ?? [];
  const out: number[] = [];
  for (let i = 0; i + 1 < pts.length; i += 2) {
    const x = pts[i] * sx;
    const y = pts[i + 1] * sy;
    out.push(
      x * Math.cos(a) - y * Math.sin(a),
      x * Math.sin(a) + y * Math.cos(a),
    );
  }
  return out;
};

/** Turns a version 1 shape into its version 2 equivalent. */
export function migrateV1(input: StoredShape): StoredShape {
  const s = input as unknown as Loose;
  const base = {
    id: s.id,
    x: s.x,
    y: s.y,
    rotation: s.rotation,
    opacity: (s.opacity as number) ?? 1,
    shadow: s.shadow ? "br" : null,
  };
  const dash = V1_DASH[(s.dash as string) ?? "solid"] ?? "solid";
  let out: Record<string, unknown>;
  switch (s.type) {
    case "rect":
    case "ellipse":
      out = {
        ...base,
        type: "shape",
        kind: s.type === "ellipse" ? "ellipse" : s.rounded ? "rounded" : "rect",
        width: s.width,
        height: s.height,
        fill: s.filled ? s.stroke : null,
        outline: s.filled ? null : s.stroke,
        strokeWidth: s.strokeWidth,
        dash,
      };
      break;
    case "arrow":
    case "line":
      out = {
        ...base,
        rotation: 0,
        type: s.type,
        points: scaled(s),
        control: null,
        stroke: s.stroke,
        strokeWidth: s.strokeWidth,
        dash,
        startCap: s.type === "line" ? "round" : s.bothEnds ? "arrow" : "none",
        endCap: s.type === "line" ? "round" : "arrow",
        startSize: 2,
        endSize: 2,
      };
      break;
    case "pen":
    case "highlighter":
      out = {
        ...base,
        rotation: 0,
        type: "pen",
        points: scaled(s),
        stroke: s.stroke,
        strokeWidth: s.strokeWidth,
        nib: "round",
        smooth: true,
        ...(s.type === "highlighter" && { marker: true }),
      };
      break;
    case "text": {
      const size = ((s.fontSize as number) ?? 22) * ((s.scaleY as number) ?? 1);
      const lines = String(s.text ?? "").split("\n");
      const longest = Math.max(1, ...lines.map((l) => l.length));
      out = {
        ...base,
        shadow: "br",
        type: "text",
        text: s.text,
        width: longest * size * 0.62 + 8,
        height: lines.length * size * 1.2 + 8,
        font: "Segoe UI",
        fontSize: size,
        textColor: s.fill,
        bold: true,
        align: "left",
        valign: "top",
        padding: 4,
        outline: null,
        outlineWidth: 0,
      };
      break;
    }
    case "callout": {
      const size = (s.fontSize as number) ?? 18;
      const lines = String(s.text ?? "").split("\n").length;
      out = {
        ...base,
        shadow: "br",
        type: "callout",
        body: "speechRound",
        text: s.text,
        width: s.width,
        height: lines * size * 1.2 + 24,
        font: "Segoe UI",
        fontSize: size,
        textColor: contrastText(s.fill as string),
        align: "left",
        valign: "top",
        padding: 12,
        fill: s.fill,
        outline: null,
        strokeWidth: 2,
        dash: "solid",
        tail: { x: s.tailX, y: s.tailY },
        arrowColor: s.fill,
        arrowWidth: 6,
        arrowDash: "solid",
        arrowCap: "arrow",
      };
      break;
    }
    case "step":
      out = {
        ...base,
        shadow: "br",
        type: "step",
        n: s.n,
        sequence: "123",
        style: "circle",
        size: ((s.radius as number) ?? 16) * 2,
        fill: s.fill,
        textColor: contrastText(s.fill as string),
      };
      break;
    case "pixelate":
    case "blur":
      out = {
        ...base,
        type: "blur",
        mode: s.type === "pixelate" ? "pixelate" : "blur",
        ellipse: false,
        width: s.width,
        height: s.height,
        intensity: Math.min(100, Math.max(1, ((s.amount as number) ?? 10) * 2)),
        color: "#111111",
      };
      break;
    default:
      return input;
  }
  return out as unknown as StoredShape;
}

const json = (value: unknown) =>
  new TextEncoder().encode(JSON.stringify(value, null, 2));

/** Shape ids are UUIDs, but keep archive paths tame whatever they are. */
const safeName = (id: string) => id.replace(/[^A-Za-z0-9_-]/g, "_");

// ---- ZIP ----------------------------------------------------------------------------------
// Just enough of the format for snips: stored or deflated entries, no ZIP64, no encryption.
// Deflate uses the WebView's built-in CompressionStream.

export interface ZipEntry {
  name: string;
  data: Uint8Array;
  /** PNGs are already compressed, so only text is worth deflating. */
  deflate?: boolean;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(data: Uint8Array) {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

async function pipe(
  data: Uint8Array,
  stream: CompressionStream | DecompressionStream,
) {
  const out = new Blob([data as BlobPart]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

const deflateRaw = (data: Uint8Array) =>
  pipe(data, new CompressionStream("deflate-raw"));
const inflateRaw = (data: Uint8Array) =>
  pipe(data, new DecompressionStream("deflate-raw"));

/** MS-DOS date and time, as ZIP headers store them (local time, 2-second steps). */
function dosDateTime(date: Date) {
  const time =
    (date.getHours() << 11) |
    (date.getMinutes() << 5) |
    Math.floor(date.getSeconds() / 2);
  const day =
    (Math.max(0, date.getFullYear() - 1980) << 9) |
    ((date.getMonth() + 1) << 5) |
    date.getDate();
  return { time, day };
}

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_END = 0x06054b50;
const UTF8_FLAG = 1 << 11;

export async function writeZip(entries: ZipEntry[], date = new Date()) {
  const { time, day } = dosDateTime(date);
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const crc = crc32(entry.data);
    const body = entry.deflate ? await deflateRaw(entry.data) : entry.data;
    const method = entry.deflate ? 8 : 0;

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, SIG_LOCAL, true);
    local.setUint16(4, 20, true); // version needed: 2.0
    local.setUint16(6, UTF8_FLAG, true);
    local.setUint16(8, method, true);
    local.setUint16(10, time, true);
    local.setUint16(12, day, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, body.length, true);
    local.setUint32(22, entry.data.length, true);
    local.setUint16(26, name.length, true);
    local.setUint16(28, 0, true);

    const dir = new DataView(new ArrayBuffer(46));
    dir.setUint32(0, SIG_CENTRAL, true);
    dir.setUint16(4, 20, true); // made by
    dir.setUint16(6, 20, true); // needed
    dir.setUint16(8, UTF8_FLAG, true);
    dir.setUint16(10, method, true);
    dir.setUint16(12, time, true);
    dir.setUint16(14, day, true);
    dir.setUint32(16, crc, true);
    dir.setUint32(20, body.length, true);
    dir.setUint32(24, entry.data.length, true);
    dir.setUint16(28, name.length, true);
    dir.setUint32(42, offset, true);

    const header = new Uint8Array(local.buffer);
    chunks.push(header, name, body);
    central.push(new Uint8Array(dir.buffer), name);
    offset += header.length + name.length + body.length;
  }

  const dirSize = central.reduce((n, c) => n + c.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, SIG_END, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, dirSize, true);
  end.setUint32(16, offset, true);

  const parts = [...chunks, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/** Every file in a ZIP archive, by name. Directories are skipped. */
export async function readZip(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const bad = (why: string) => new Error(`Not a valid snip file (${why})`);

  // The end record is last, possibly followed by a comment of up to 64 KiB.
  let end = -1;
  for (
    let i = bytes.length - 22;
    i >= Math.max(0, bytes.length - 22 - 0xffff);
    i--
  ) {
    if (view.getUint32(i, true) === SIG_END) {
      end = i;
      break;
    }
  }
  if (end < 0) throw bad("no ZIP directory");
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  if (at === 0xffffffff) throw bad("ZIP64 is not supported");

  const decoder = new TextDecoder();
  const files = new Map<string, Uint8Array>();
  for (let i = 0; i < count; i++) {
    if (at + 46 > bytes.length || view.getUint32(at, true) !== SIG_CENTRAL) {
      throw bad("damaged directory");
    }
    const method = view.getUint16(at + 10, true);
    const crc = view.getUint32(at + 16, true);
    const packed = view.getUint32(at + 20, true);
    const nameLen = view.getUint16(at + 28, true);
    const extraLen = view.getUint16(at + 30, true);
    const commentLen = view.getUint16(at + 32, true);
    const localAt = view.getUint32(at + 42, true);
    const name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLen));
    at += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith("/")) continue;

    if (view.getUint32(localAt, true) !== SIG_LOCAL) throw bad("damaged entry");
    const start =
      localAt +
      30 +
      view.getUint16(localAt + 26, true) +
      view.getUint16(localAt + 28, true);
    if (start + packed > bytes.length) throw bad("truncated");
    const raw = bytes.subarray(start, start + packed);
    let data: Uint8Array;
    if (method === 0) data = raw.slice();
    else if (method === 8) data = await inflateRaw(raw);
    else throw bad(`unsupported compression in ${name}`);
    if (crc32(data) !== crc) throw bad(`${name} is corrupt`);
    files.set(name, data);
  }
  return files;
}
