import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import type { Effects } from "../editor/effects";
import type { CaptureMode, Rect } from "./capture";

export type ShortcutAction =
  | "captureRegion"
  | "captureFullscreen"
  | "captureScrolling"
  | "annotateClipboard"
  | "repeatLastCapture";
export type AfterCapture = "edit" | "copy" | "save";
export type Theme = "system" | "light" | "dark";

/** Seconds a capture can wait before freezing the screen; mirrors `CAPTURE_DELAYS`. */
export const CAPTURE_DELAYS = [0, 3, 5, 10] as const;

/** A named capture recipe; mirrors `CapturePreset` in `settings.rs`. */
export interface CapturePreset {
  /** Empty for a preset that hasn't been saved yet. */
  id: string;
  name: string;
  mode: CaptureMode;
  delay: number;
  cursor: boolean;
  effects: Effects;
  after: AfterCapture;
  shortcut: string | null;
}

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
  /** Look for new releases on launch and every few hours. */
  autoCheckUpdates: boolean;
  /** `null` saves in Pictures\Snipit. */
  outputFolder: string | null;
  filenameTemplate: string;
  theme: Theme;
  captureDelay: number;
  captureCursor: boolean;
  lastCapture: { mode: CaptureMode; rect: Rect } | null;
  presets: CapturePreset[];
}

/** Mirrors `UpdateStatus` in `src-tauri/src/updater.rs`. */
export type UpdateStatus =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "up-to-date" }
  | { status: "available"; version: string; currentVersion: string }
  /** `progress` is 0–1, once the download size is known. */
  | { status: "installing"; version: string; progress: number | null }
  | { status: "error"; message: string };

/** The updater's status changed; payload `UpdateStatus`. */
export const UPDATE_STATUS_EVENT = "update-status";

export interface SettingsView {
  settings: Settings;
  shortcutErrors: Partial<Record<ShortcutAction, string>>;
  /** Preset shortcuts that could not be registered, by preset id. */
  presetErrors: Record<string, string>;
  autostart: boolean;
  /** Windows' "Use the Print screen key to open screen capture" is on. */
  printscreenReservedByWindows: boolean;
  /** The folder snips are saved in. */
  galleryDir: string | null;
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
  /** A `.snip` project sits beside it, so its annotations can still be edited. */
  editable: boolean;
  tags: string[];
  /** The program it was captured from, e.g. "chrome". */
  app: string | null;
  /** The title of the window it was captured from. */
  title: string | null;
}

export const api = {
  copyPng: (png: Uint8Array) => invoke<void>("copy_png", png),
  /** PNG bytes of the clipboard image; empty when it holds no image. */
  pasteImage: () => invoke<ArrayBuffer>("paste_image"),

  listSnips: () => invoke<Snip[]>("list_snips"),
  readSnip: (path: string) => invoke<ArrayBuffer>("read_snip", { path }),
  /** The `.snip` project saved beside `path`; empty when it has none. */
  readSnipProject: (path: string) =>
    invoke<ArrayBuffer>("read_snip_project", { path }),
  /**
   * Saves the flattened PNG as an edit of `path` (or as a new snip when it is null), plus the
   * `.snip` project beside it. Returns the PNG's path.
   *
   * With `replace`, a capture that has no project yet is overwritten instead of getting an
   * `_edited` copy (a preset adding its effects); the project keeps its original pixels.
   */
  saveSnip: (
    png: Uint8Array,
    path: string | null,
    project?: Uint8Array,
    replace = false,
  ) => {
    // One request carries both files: the PNG, then the project.
    const body = project ? concat(png, project) : png;
    return invoke<string>("save_snip", body, {
      headers: {
        ...(path ? { "x-snip-path": encodeURIComponent(path) } : {}),
        ...(project ? { "x-png-length": String(png.length) } : {}),
        ...(replace ? { "x-snip-replace": "1" } : {}),
      },
    });
  },
  deleteSnip: (path: string) => invoke<void>("delete_snip", { path }),
  revealSnip: (path: string) => invoke<void>("reveal_snip", { path }),
  openGalleryFolder: () => invoke<void>("open_gallery_folder"),
  /** Replaces a snip's tags; resolves with them tidied up. */
  setSnipTags: (path: string, tags: string[]) =>
    invoke<string[]>("set_snip_tags", { path, tags }),
  /** Asks for a new snips folder; `null` when cancelled. */
  chooseOutputFolder: () => invoke<SettingsView | null>("choose_output_folder"),
  resetOutputFolder: () => invoke<SettingsView>("reset_output_folder"),
  setFilenameTemplate: (template: string) =>
    invoke<Settings>("set_filename_template", { template }),
  /** The file name `template` gives, or an error explaining what is wrong with it. */
  previewFilename: (template: string) =>
    invoke<string>("preview_filename", { template }),

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
  setTheme: (theme: Theme) => invoke<Settings>("set_theme", { theme }),
  setCaptureOptions: (delay: number, cursor: boolean) =>
    invoke<Settings>("set_capture_options", { delay, cursor }),
  savePreset: (preset: CapturePreset) =>
    invoke<SettingsView>("save_preset", { preset }),
  deletePreset: (id: string) => invoke<SettingsView>("delete_preset", { id }),
  setWidgetVisible: (visible: boolean) =>
    invoke<Settings>("set_widget_visible", { visible }),
  openMainWindow: () => invoke<void>("open_main_window"),

  getUpdateStatus: () => invoke<UpdateStatus>("get_update_status"),
  /** Resolves when the check is done; the result arrives as an `UPDATE_STATUS_EVENT`. */
  checkForUpdates: () => invoke<void>("check_for_updates"),
  installUpdate: () => invoke<void>("install_update"),
  setAutoCheckUpdates: (enabled: boolean) =>
    invoke<Settings>("set_auto_check_updates", { enabled }),
};

/** URL for showing a gallery file in an `<img>`; `version` busts the cache after edits. */
export function snipUrl(snip: Snip) {
  return `${convertFileSrc(snip.path)}?v=${snip.modified}`;
}

function concat(a: Uint8Array, b: Uint8Array) {
  const out = new Uint8Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
}

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
