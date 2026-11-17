import { api } from "../lib/api";
import { applyEffects, type Effects } from "./effects";
import { encodeSnip } from "./snipFile";

/** Longest side of the preview stored in a `.snip`. */
const THUMBNAIL_SIZE = 400;

export function canvasPng(canvas: HTMLCanvasElement) {
  return new Promise<Uint8Array>((resolve, reject) =>
    canvas.toBlob(
      (b) =>
        b
          ? b.arrayBuffer().then((buf) => resolve(new Uint8Array(buf)), reject)
          : reject(new Error("Export failed")),
      "image/png",
    ),
  );
}

export function thumbnailOf(canvas: HTMLCanvasElement) {
  const scale = Math.min(
    1,
    THUMBNAIL_SIZE / Math.max(canvas.width, canvas.height, 1),
  );
  const thumb = document.createElement("canvas");
  thumb.width = Math.max(1, Math.round(canvas.width * scale));
  thumb.height = Math.max(1, Math.round(canvas.height * scale));
  const ctx = thumb.getContext("2d");
  if (ctx) {
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(canvas, 0, 0, thumb.width, thumb.height);
  }
  return thumb;
}

/** An `ArrayBuffer` holding exactly `bytes`. */
export const bufferOf = (bytes: Uint8Array): ArrayBuffer =>
  bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
    ? (bytes.buffer as ArrayBuffer)
    : (bytes.slice().buffer as ArrayBuffer);

export function loadImage(png: ArrayBuffer) {
  const url = URL.createObjectURL(new Blob([png], { type: "image/png" }));
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new window.Image();
    // A loaded image keeps its pixels, so the blob can go; otherwise every opened snip and
    // paste would stay in memory for as long as Snipit sits in the tray.
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

/**
 * Adds a preset's effects to a new capture without opening the editor: saves the result as an
 * edited copy (with a `.snip`, so the effects can still be changed) and copies it if asked.
 */
export async function processCapture(
  path: string,
  effects: Effects,
  copy: boolean,
) {
  const original = new Uint8Array(await api.readSnip(path));
  const image = await loadImage(bufferOf(original));
  const canvas = applyEffects(
    image,
    image.naturalWidth,
    image.naturalHeight,
    effects,
  );
  const png = await canvasPng(canvas);
  if (copy) await api.copyPng(png);
  const project = await encodeSnip({
    original,
    width: image.naturalWidth,
    height: image.naturalHeight,
    crop: null,
    shapes: [],
    effects,
    thumbnail: await canvasPng(thumbnailOf(canvas)),
  });
  await api.saveSnip(png, path, project);
}
