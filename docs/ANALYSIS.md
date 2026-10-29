# Snipit — Product & Technical Analysis

Snipit is an open-source, desktop screen-capture and annotation tool: grab any part
of the screen (image or video), mark it up, and share it in seconds.

This document captures the feature analysis, the technical approach, and the scope
for each release. See [ROADMAP.md](ROADMAP.md) for the milestone checklist.

---

## 1. Target users & core jobs

| User                         | Job to be done                                                                             |
| ---------------------------- | ------------------------------------------------------------------------------------------ |
| Developers / QA              | Capture bugs with arrows, callouts and step numbers; record short repro videos             |
| Technical writers / trainers | Build step-by-step guides, consistent styled screenshots, scrolling captures of long pages |
| Support teams                | Annotate a screenshot, blur sensitive data, paste into a ticket or chat                    |
| Everyone                     | "Press a key, drag a box, paste it somewhere" — fast and frictionless                      |

The core loop is: **Capture → Edit → Share**, and each step must be fast.

---

## 2. Feature analysis

Priority: **P0** = MVP must-have · **P1** = v1.0 · **P2** = later / stretch.

### 2.1 Capture

| Feature                     | Description                                                                                         | Priority |
| --------------------------- | --------------------------------------------------------------------------------------------------- | -------- |
| Global hotkey               | System-wide shortcut (default `PrintScreen`) launches capture from anywhere                         | P0       |
| Region capture              | Dim overlay across all monitors, drag a rectangle, magnifier loupe + pixel coordinates/size readout | P0       |
| Window capture              | Hover highlights windows/controls under cursor, click to capture                                    | P0       |
| Full screen / monitor       | Capture one monitor or the whole virtual desktop                                                    | P0       |
| Multi-monitor & DPI         | Correct capture across mixed-DPI monitors                                                           | P0       |
| Delayed capture             | 3/5/10 s timer to capture menus and hover states                                                    | P1       |
| Capture cursor              | Optional inclusion of the mouse pointer                                                             | P1       |
| Repeat last capture         | Re-capture the same region                                                                          | P1       |
| Scrolling capture           | Auto-scroll a window/browser and stitch into one tall image                                         | P1       |
| Fixed-size / aspect presets | e.g. 1280×720, 16:9 region presets                                                                  | P2       |
| Text capture (OCR)          | Capture a region and copy the recognised text                                                       | P1       |
| Color picker                | Pick a pixel color (HEX/RGB) from anywhere on screen                                                | P2       |
| Panoramic capture           | Manual scroll-and-stitch for apps that don't auto-scroll                                            | P2       |

### 2.2 Screen recording

| Feature                                | Description                                          | Priority |
| -------------------------------------- | ---------------------------------------------------- | -------- |
| Region / window / screen recording     | MP4 (H.264) output                                   | P1       |
| System audio + microphone              | Toggleable audio tracks                              | P1       |
| Webcam overlay                         | Picture-in-picture webcam bubble                     | P2       |
| Pause / resume                         | During recording                                     | P1       |
| GIF export                             | Short clips to animated GIF with quality/fps control | P1       |
| Trim                                   | Cut start/end of a recording                         | P1       |
| Cursor highlight & click visualisation | Visual emphasis for tutorials                        | P2       |

### 2.3 Image editor

| Feature                      | Description                                                 | Priority |
| ---------------------------- | ----------------------------------------------------------- | -------- |
| Canvas                       | Zoom, pan, fit-to-window, undo/redo (unlimited)             | P0       |
| Arrow                        | Styles, thickness, color, curved arrows                     | P0       |
| Shapes                       | Rectangle, ellipse, line, with fill/stroke                  | P0       |
| Text                         | Plain text + styled text boxes                              | P0       |
| Callout                      | Speech-bubble / box with text                               | P0       |
| Step numbers                 | Auto-incrementing numbered badges (1, 2, 3…)                | P0       |
| Highlighter                  | Semi-transparent marker                                     | P0       |
| Blur / pixelate              | Redact sensitive regions (destructive on export)            | P0       |
| Crop / resize / canvas size  | Basic image operations                                      | P0       |
| Pen / freehand               | Freehand drawing                                            | P1       |
| Magnify                      | Zoom-in lens on a region of the image                       | P1       |
| Spotlight                    | Dim everything except a selected area                       | P1       |
| Stamps / stickers            | Icon library (check, cross, warning…)                       | P2       |
| Borders, shadows, torn edges | Image effects                                               | P1       |
| Cut-out                      | Remove a horizontal/vertical strip and join the rest        | P2       |
| Smart move / text edit       | Detect and move UI objects / edit captured text (OCR-based) | P2       |
| Simplify                     | Replace UI text with abstract blocks                        | P2       |
| Combine / templates          | Merge multiple captures into a layout or step guide         | P2       |
| Styles / presets             | Save tool styles (e.g. "red 4px arrow") as quick styles     | P1       |
| Non-destructive project file | Save annotations as editable objects (`.snip` format)       | P0       |

### 2.4 Library & workflow

| Feature              | Description                                                                             | Priority |
| -------------------- | --------------------------------------------------------------------------------------- | -------- |
| Recent captures tray | Thumbnails of recent captures in the editor                                             | P0       |
| Library              | Browse all captures by date, search, tag, filter by type                                | P1       |
| Auto-save            | Every capture stored automatically, no "save" dialog required                           | P0       |
| Drag-and-drop out    | Drag a capture from the tray into any app                                               | P1       |
| Capture presets      | Named profiles: capture type + effects + output (e.g. "Region → clipboard with border") | P1       |

### 2.5 Share / export

| Feature            | Description                                                | Priority |
| ------------------ | ---------------------------------------------------------- | -------- |
| Copy to clipboard  | One click / automatic after capture                        | P0       |
| Save as            | PNG, JPG, WebP, BMP, PDF; MP4, GIF for video               | P0       |
| Auto-naming        | Configurable filename template + output folder             | P0       |
| Print              | System print dialog                                        | P2       |
| Share integrations | Plugin outputs: Imgur, S3, custom HTTP upload, Slack, etc. | P2       |
| Shareable link     | Upload and copy URL                                        | P2       |

### 2.6 App shell & settings

| Feature              | Description                                            | Priority |
| -------------------- | ------------------------------------------------------ | -------- |
| System tray icon     | Quick menu: capture modes, open editor, settings, quit | P0       |
| Start with OS        | Optional autostart                                     | P1       |
| Hotkey customisation | Rebind all shortcuts, conflict detection               | P1       |
| Light / dark theme   | Follow OS theme                                        | P1       |
| Auto-update          | Signed update channel                                  | P2       |
| Localisation         | i18n-ready strings                                     | P2       |

---

## 3. Technical approach

### 3.1 Platform target

- **Primary:** Windows 10 (1903+) / Windows 11.
- **Secondary (later):** macOS and Linux (X11/Wayland). The architecture keeps OS-specific
  code behind a `capture` trait so other platforms can be added.

### 3.2 Recommended stack: Tauri 2 (Rust) + React + TypeScript

| Layer         | Choice                                   | Why                                                                                                                                |
| ------------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Shell         | **Tauri 2**                              | Small binaries (~10 MB vs ~150 MB Electron), low memory, native Rust core, tray/global-shortcut/autostart/updater plugins built in |
| Backend       | **Rust**                                 | Fast native capture, image encoding and stitching; direct Windows API access via `windows` crate                                   |
| UI            | **React + TypeScript + Vite**            | Fast iteration on a rich editor UI                                                                                                 |
| Editor canvas | **Konva.js** (`react-konva`)             | Object-model canvas: select/move/resize/rotate shapes, layering, hit testing, export — ideal for non-destructive annotations       |
| State         | **Zustand** + command-pattern undo stack | Simple, predictable, easy undo/redo                                                                                                |
| Styling       | Tailwind CSS + Radix UI primitives       | Accessible components, quick theming                                                                                               |

Alternatives considered:

- **Electron + React** — easiest JS-only path, but heavy footprint and capture via
  `desktopCapturer` is limited (no per-control hover detection, weaker DPI handling).
- **WPF / WinUI 3 (.NET)** — excellent native Windows feel, but Windows-only and the
  .NET SDK isn't installed on this machine; cross-platform later would mean a rewrite.
- **Qt (C++)** — powerful but slower to iterate on the editor UI.

### 3.3 Key native components (Rust)

| Concern                    | Approach                                                                                                                                                   |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Screenshot                 | `Windows.Graphics.Capture` (WGC) via `windows-capture` crate, fallback to DXGI Desktop Duplication / GDI `BitBlt`; `xcap` crate as cross-platform baseline |
| Region overlay             | Transparent, borderless, always-on-top Tauri window per monitor, showing a frozen screenshot so the user selects on a still image                          |
| Window / control detection | `EnumWindows` + `WindowFromPoint` + UI Automation for child-control rectangles                                                                             |
| DPI                        | Per-monitor DPI awareness v2; convert all rects to physical pixels in Rust                                                                                 |
| Global hotkeys             | `tauri-plugin-global-shortcut`; low-level keyboard hook for `PrintScreen` override                                                                         |
| Screen recording           | WGC frames → H.264 via Media Foundation hardware encoder (`windows-capture` encoder) or bundled **FFmpeg** sidecar; WASAPI loopback for system audio       |
| GIF                        | `gifski` crate (high-quality GIF encoding)                                                                                                                 |
| Scrolling capture          | Send scroll events (`SendInput` / UIA ScrollPattern), capture frames, stitch by finding overlap with row-hash matching                                     |
| OCR                        | `Windows.Media.Ocr` (built into Windows, offline) ; Tesseract as cross-platform fallback                                                                   |
| Clipboard                  | `arboard` crate (image + text)                                                                                                                             |
| Image I/O                  | `image` crate (PNG/JPG/WebP/BMP), `printpdf` for PDF                                                                                                       |
| Storage                    | Captures in `%USERPROFILE%\Pictures\Snipit`, metadata + library index in SQLite (`rusqlite`)                                                               |

### 3.4 Architecture

```
┌──────────────────────────── Tauri app ─────────────────────────────┐
│                                                                     │
│  React UI (WebView2)                                               │
│  ├── Overlay window   — region/window selection, loupe, toolbar     │
│  ├── Editor window    — Konva canvas, tools, properties, tray       │
│  ├── Library window   — grid, search, tags                          │
│  └── Settings window  — hotkeys, output, presets                    │
│            ▲   invoke() commands / events   │                       │
│            │                                ▼                       │
│  Rust core                                                          │
│  ├── capture/   (trait Capturer; windows.rs, xcap fallback)         │
│  ├── record/    (encoder pipeline, audio, gif)                      │
│  ├── scroll/    (auto-scroll + stitcher)                            │
│  ├── ocr/                                                           │
│  ├── library/   (SQLite index, thumbnails, file store)              │
│  ├── export/    (formats, clipboard, uploaders)                     │
│  ├── hotkeys/  tray/  settings/                                     │
└─────────────────────────────────────────────────────────────────────┘
```

**Capture flow (region):**

1. Hotkey fires in Rust → capture every monitor to an in-memory bitmap (instant freeze).
2. Overlay windows open showing the frozen frame; React handles selection + loupe.
3. User confirms → Rust crops at physical-pixel precision → saves original PNG to library.
4. Editor opens with the capture (or it goes straight to clipboard, per preset).

**Project file (`.snip`):** a zip containing `original.png`, `annotations.json`
(Konva scene graph: typed objects with style + geometry) and `thumb.png`.
Flattened export is rendered from this, so edits are always reversible.

### 3.5 Repository layout (planned)

```
snipit/
├── src/                 # React + TS frontend
│   ├── windows/         # overlay, editor, library, settings entry points
│   ├── editor/          # canvas, tools, commands (undo/redo), styles
│   ├── components/      # shared UI
│   └── lib/             # tauri bindings, types
├── src-tauri/           # Rust backend
│   ├── src/capture/ record/ scroll/ ocr/ library/ export/ ...
│   └── tauri.conf.json
├── docs/
└── .github/workflows/   # CI: lint, test, build installers
```

---

## 4. Risks & open questions

| Risk                                         | Mitigation                                                                     |
| -------------------------------------------- | ------------------------------------------------------------------------------ |
| Mixed-DPI multi-monitor selection bugs       | Do all geometry in physical pixels in Rust; test 100%/150% setups early        |
| Overlay latency on hotkey                    | Pre-create hidden overlay windows at startup; capture with WGC/DXGI (ms-level) |
| Scrolling capture reliability                | Start with browsers + standard scrollbars; manual "panoramic" mode as fallback |
| Video encoder licensing/size                 | Prefer OS hardware encoder (Media Foundation) to avoid shipping FFmpeg         |
| WebView canvas performance on 4K/8K captures | Konva layer caching; downscaled preview, full-res export in Rust               |
| Code signing for SmartScreen                 | Plan for a signing cert before public releases                                 |

Open questions for the team:

1. Windows-only for v1, or cross-platform from day one?
2. Any cloud sharing target required for v1 (S3 / Imgur / custom server)?
3. License — MIT is the default chosen here; switch if needed.
