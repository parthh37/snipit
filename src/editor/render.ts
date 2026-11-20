/** Turning editor canvases into files, shared by the editor and by presets that skip it. */
import { api } from "../lib/api";
import { applyEffects, type Effects } from "./effects";
import { canvasPngBuffer, loadImage } from "./pixelOps";
import { encodeSnip } from "./snipFile";

/** Longest side of the preview stored in a `.snip`. */
const THUMBNAIL_SIZE = 400;

export const canvasPng = (canvas: HTMLCanvasElement) =>
  canvasPngBuffer(canvas).then((b) => new Uint8Array(b));

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
  // The bare capture was never shown, so the result replaces it rather than sitting beside it.
  await api.saveSnip(png, path, project, true);
}
