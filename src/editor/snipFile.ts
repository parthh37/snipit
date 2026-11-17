/**
 * The `.snip` project file: an edited snip that can be reopened with every annotation still
 * editable. It is a ZIP archive (rename it to `.zip` to look inside):
 *
 * ```
 * document.json   format + version, image size, crop, effects, and the shapes
 * metadata.json   facts about the snip (when it was saved); grows with capture details later
 * original.png    the captured pixels, untouched
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
import type { Effects } from "./effects";
import type { Area, ImageShape, Shape } from "./types";

export const SNIP_FORMAT = "snipit";
export const SNIP_VERSION = 1;

/** A pasted image as stored: its pixels live in `asset`, not in the shape. */
export type StoredImageShape = Omit<ImageShape, "image" | "png"> & {
  asset: string;
};
export type StoredShape = Exclude<Shape, ImageShape> | StoredImageShape;

interface DocumentJson {
  format: typeof SNIP_FORMAT;
  version: number;
  image: { file: string; width: number; height: number };
  crop: Area | null;
  /** Border, shadow and torn edges; missing in snips saved before effects existed. */
  effects?: Effects;
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
  crop: Area | null;
  effects: Effects;
  shapes: StoredShape[];
  /** PNG bytes for each image shape's `asset`. */
  assets: Map<string, Uint8Array>;
  metadata: SnipMetadata | null;
}

const SHAPE_TYPES = new Set<string>([
  "rect",
  "ellipse",
  "arrow",
  "line",
  "pen",
  "highlighter",
  "text",
  "callout",
  "step",
  "pixelate",
  "blur",
  "magnify",
  "spotlight",
  "image",
]);

/** Builds a `.snip` archive. Image shapes must carry their PNG bytes in `png`. */
export async function encodeSnip(doc: {
  original: Uint8Array;
  width: number;
  height: number;
  crop: Area | null;
  effects?: Effects;
  shapes: Shape[];
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
    crop: doc.crop,
    ...(doc.effects && { effects: doc.effects }),
    shapes,
  };
  const metadata: SnipMetadata = { savedAt: now.toISOString() };
  const entries: ZipEntry[] = [
    { name: "document.json", data: json(document), deflate: true },
    { name: "metadata.json", data: json(metadata), deflate: true },
    { name: "original.png", data: doc.original },
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
  // Shapes a newer minor version might add are skipped rather than failing the whole file.
  const shapes = (Array.isArray(doc.shapes) ? doc.shapes : []).filter(
    (shape) => {
      if (!shape || !SHAPE_TYPES.has(shape.type)) return false;
      if (shape.type !== "image") return true;
      const data = files.get(shape.asset);
      if (data) assets.set(shape.asset, data);
      return !!data;
    },
  );
  const metaText = text("metadata.json");
  return {
    original,
    width: doc.image!.width,
    height: doc.image!.height,
    crop: doc.crop ?? null,
    effects: doc.effects ?? {},
    shapes,
    assets,
    metadata: metaText ? (JSON.parse(metaText) as SnipMetadata) : null,
  };
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
