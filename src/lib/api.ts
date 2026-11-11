import { convertFileSrc, invoke } from "@tauri-apps/api/core";

export type ShortcutAction =
  | "captureRegion"
  | "captureFullscreen"
  | "captureScrolling"
  | "annotateClipboard";
export type AfterCapture = "edit" | "copy";

export interface Settings {
  shortcuts: Partial<Record<ShortcutAction, string>>;
  afterCapture: AfterCapture;
  autostartInitialized: boolean;
  trayHintShown: boolean;
  /** The floating capture widget docked to the top or a side of the screen. */
  showWidget: boolean;
  widgetPosition: {
    edge: "top" | "left" | "right";
    x: number;
    y: number;
  } | null;
}

export interface SettingsView {
  settings: Settings;
  shortcutErrors: Partial<Record<ShortcutAction, string>>;
  autostart: boolean;
  /** Windows' "Use the Print screen key to open screen capture" is on. */
  printscreenReservedByWindows: boolean;
}

/** The settings view changed outside the main window (e.g. from the tray); payload `SettingsView`. */
export const SETTINGS_VIEW_EVENT = "settings-view";
/** The tray asks the main window to switch view; payload is the view name. */
export const NAVIGATE_EVENT = "navigate";
/** Settings changed outside the main window (e.g. the widget was hidden); payload `Settings`. */
export const SETTINGS_CHANGED_EVENT = "settings-changed";

export interface Snip {
  path: string;
  name: string;
  modified: number;
  size: number;
}

export const api = {
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
  openKeyboardSettings: () => invoke<void>("open_keyboard_settings"),
  setWidgetVisible: (visible: boolean) =>
    invoke<Settings>("set_widget_visible", { visible }),
  openMainWindow: () => invoke<void>("open_main_window"),
};

/** URL for showing a gallery file in an `<img>`; `version` busts the cache after edits. */
export function snipUrl(snip: Snip) {
  return `${convertFileSrc(snip.path)}?v=${snip.modified}`;
}

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
