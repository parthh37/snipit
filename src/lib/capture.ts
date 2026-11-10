import { invoke } from "@tauri-apps/api/core";

/** A point in physical pixels. */
export interface Point {
  x: number;
  y: number;
}

/** A rectangle in physical pixels. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type CaptureMode = "interactive" | "fullscreen" | "scrolling";

export interface OverlayInfo {
  /** "scrolling" when the picked area is going to be scrolled and stitched. */
  mode: CaptureMode;
  width: number;
  height: number;
  /** Windows on this monitor in local coordinates, topmost first. */
  windows: Rect[];
  /** Cursor position if it is on this monitor. */
  cursor: Point | null;
}

/** Payload of {@link CAPTURE_SAVED_EVENT}. */
export interface CaptureSaved {
  path: string;
  copied: boolean;
}

/** A new snip was saved to the gallery (from a capture or the clipboard). */
export const CAPTURE_SAVED_EVENT = "capture-saved";
/** Asks the main window to open a snip in the editor; payload `{ path }`. */
export const EDITOR_OPEN_EVENT = "editor:open";
/** A capture or clipboard import failed; payload is the message. */
export const ERROR_EVENT = "app:error";

export const startCapture = (mode: CaptureMode) =>
  invoke<void>("start_capture", { mode });

export const annotateClipboard = () => invoke<void>("annotate_clipboard_cmd");

export const getOverlayInfo = () => invoke<OverlayInfo>("overlay_info");

/** The frozen frame for this overlay's monitor, as raw RGBA bytes. */
export const getOverlayFrame = () => invoke<ArrayBuffer>("overlay_frame");

export const finishCapture = (rect: Rect) =>
  invoke<void>("finish_capture", { rect });

export const cancelCapture = () => invoke<void>("cancel_capture");

/** Progress of a running scrolling capture, sent to its status pill. */
export interface ScrollProgress {
  phase: "starting" | "top" | "capturing";
  /** Height of the stitched image so far, in pixels. */
  height: number;
  /** Moving the mouse also finishes the capture. */
  mouseStops: boolean;
}

export const SCROLL_PROGRESS_EVENT = "scroll:progress";
