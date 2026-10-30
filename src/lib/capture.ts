import { convertFileSrc, invoke } from "@tauri-apps/api/core";

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

export type CaptureMode = "interactive" | "fullscreen";

export interface OverlayInfo {
  width: number;
  height: number;
  /** Windows on this monitor in local coordinates, topmost first. */
  windows: Rect[];
  /** Cursor position if it is on this monitor. */
  cursor: Point | null;
}

export interface CaptureEntry {
  path: string;
  name: string;
  width: number;
  height: number;
  createdMs: number;
}

export interface CaptureSaved {
  entry: CaptureEntry;
  copied: boolean;
}

export interface HotkeyStatus {
  registered: boolean;
  reservedByWindows: boolean;
}

export const CAPTURE_SAVED_EVENT = "capture-saved";
export const CAPTURE_FAILED_EVENT = "capture-failed";

export const startCapture = (mode: CaptureMode) =>
  invoke<void>("start_capture", { mode });

export const getOverlayInfo = () => invoke<OverlayInfo>("overlay_info");

/** The frozen frame for this overlay's monitor, as raw RGBA bytes. */
export const getOverlayFrame = () => invoke<ArrayBuffer>("overlay_frame");

export const finishCapture = (rect: Rect) =>
  invoke<void>("finish_capture", { rect });

export const cancelCapture = () => invoke<void>("cancel_capture");

export const listRecentCaptures = (limit: number) =>
  invoke<CaptureEntry[]>("list_recent_captures", { limit });

export const copyCapture = (path: string) =>
  invoke<void>("copy_capture", { path });

export const revealCapture = (path: string) =>
  invoke<void>("reveal_capture", { path });

export const getHotkeyStatus = () => invoke<HotkeyStatus>("hotkey_status");

export const openKeyboardSettings = () =>
  invoke<void>("open_keyboard_settings");

export const captureSrc = (entry: CaptureEntry) => convertFileSrc(entry.path);
