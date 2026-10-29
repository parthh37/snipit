import { convertFileSrc, invoke } from "@tauri-apps/api/core";

export type ShortcutAction =
  "captureRegion" | "captureFullscreen" | "annotateClipboard";
export type AfterCapture = "edit" | "copy";

export interface Settings {
  shortcuts: Partial<Record<ShortcutAction, string>>;
  afterCapture: AfterCapture;
  autostartInitialized: boolean;
}

export interface SettingsView {
  settings: Settings;
  shortcutErrors: Partial<Record<ShortcutAction, string>>;
  autostart: boolean;
}

export interface Snip {
  path: string;
  name: string;
  modified: number;
  size: number;
}

export interface Region {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const api = {
  startCapture: (mode: "region" | "fullscreen") =>
    invoke<void>("start_capture", { mode }),
  annotateClipboard: () => invoke<void>("annotate_clipboard_cmd"),

  getFrozen: () => invoke<ArrayBuffer>("get_frozen"),
  overlayReady: () => invoke<void>("overlay_ready"),
  finishRegion: (region: Region | null, action: AfterCapture | null) =>
    invoke<void>("finish_region", { region, action }),

  copyPng: (png: Uint8Array) => invoke<void>("copy_png", png),
  /** PNG bytes of the clipboard image; empty when it holds no image. */
  pasteImage: () => invoke<ArrayBuffer>("paste_image"),

  listSnips: () => invoke<Snip[]>("list_snips"),
  readSnip: (path: string) => invoke<ArrayBuffer>("read_snip", { path }),
  /** Overwrites `path`, or saves a new snip when it is null. Returns the path. */
  saveSnip: (png: Uint8Array, path: string | null) =>
    invoke<string>("save_snip", png, {
      headers: path ? { "x-snip-path": encodeURIComponent(path) } : {},
    }),
  deleteSnip: (path: string) => invoke<void>("delete_snip", { path }),
  revealSnip: (path: string) => invoke<void>("reveal_snip", { path }),
  openGalleryFolder: () => invoke<void>("open_gallery_folder"),

  getSettings: () => invoke<SettingsView>("get_settings"),
  setShortcut: (action: ShortcutAction, accelerator: string | null) =>
    invoke<SettingsView>("set_shortcut", { action, accelerator }),
  pauseShortcuts: (paused: boolean) =>
    invoke<void>("pause_shortcuts", { paused }),
  setAfterCapture: (mode: AfterCapture) =>
    invoke<Settings>("set_after_capture", { mode }),
  setAutostart: (enabled: boolean) =>
    invoke<SettingsView>("set_autostart", { enabled }),
};

/** URL for showing a gallery file in an `<img>`; `version` busts the cache after edits. */
export function snipUrl(snip: Snip) {
  return `${convertFileSrc(snip.path)}?v=${snip.modified}`;
}

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
