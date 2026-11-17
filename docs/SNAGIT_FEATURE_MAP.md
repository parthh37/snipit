# Snagit feature map and `.snagx` format

What Snagit does, how its native file format works, and where Snipit stands against each feature.
Written 2026-11-17 from the copy of Snagit installed on the dev machine.

## How this was gathered

- **Install examined:** `C:\Program Files\TechSmith\Snagit`. The assemblies report version **26.4.0.12714** (Snagit 2026.4).
- **Static metadata:** read without running any Snagit code, from the .NET assemblies `EditorDotNet.dll`, `CaptureDotNet.dll` and `SnagitCommonDotNet.dll`. This produced:
  - 2,017 type names
  - 159 enums with all their values (the tool, capture-mode, shape, effect and file-type lists below come from these)
  - the UI view-model names
- **File-format samples:** the three sample `.snagx` files Snagit ships in `en-US\`, unzipped and parsed field by field. There were no user-made `.snagx` files on the machine.
- **Other files read:**
  - `SnagxProperties.propdesc`: Windows Search properties for `.snagx`
  - `%LOCALAPPDATA%\TechSmith\Snagit\Presets9.xml`: capture presets
  - the `EnhancedTooltips\`, `Stamps\`, `Themes\` and `Templates\` folders

**Limits:** this is inventory from static evidence. Snagit's capture and editor were not run or observed. The native editor (`SnagitEditor.exe`, MFC/C++) holds the canvas and render code, which was not decompiled. Where the enum value names alone define a behaviour (for example `BlurTypePixelate`), the description below is inferred from those names.

---

## 1. The `.snagx` format

### Structure

A `.snagx` file is an ordinary **ZIP archive** (deflate). Rename it to `.zip` and it opens.

```
capture.snagx
├── index.json            { "Pages": ["{GUID}.json"], "Version": "1.0" }
├── metadata.json         capture context (see below)
├── thumbnail.png         pre-rendered, flattened preview
├── {GUID}.png            the ORIGINAL captured pixels, untouched
└── {GUID}.json           the page: canvas settings + list of vector objects
```

**`metadata.json`** records where the capture came from:

- `CaptureDate`
- `AppName`, `AppVersion`, and `AppCompany` (from the property schema)
- `WindowName`
- `WebURL`
- `OperatingSystemVersion`, `LanguageCode`
- `OcrText`
- `CalloutText`
- `Tags[]`

**Page JSON (`{GUID}.json`)** holds the canvas and its objects:

- **Canvas:**
  - `CaptureCanvasWidth`/`Height`, `DPI`, `CaptureColorSpace` (a base64 ICC profile)
  - `CaptureBackgroundImage` (which PNG to use) and `CaptureBackgroundLocation`/`BackgroundSize`, which place the capture inside a larger canvas
  - `GradientBackgroundColor`
- **`CaptureObjects[]`:** one entry per annotation, all sharing a base set of fields:
  - Identity and ordering: `ObjectID` (GUID), `ToolMode`, `ObjectPriority` (z-order)
  - Geometry: `PointsArray`, `StartPoint`/`EndPoint`, `RotationAngle`, `AspectRatio`
  - Style: `ForegroundColor`/`BackgroundColor` (`#AARRGGBB`), `Opacity`, `StrokeWidth`, `DashType`
  - Shadow: `DropShadowEnabled`, `ShadowColor`/`Blur`/`Opacity`/`DirectionX`/`Y`
  - Editing flags: `IsLocked`, `IsFlattened`, `IgnoresUndoAll`, `Anchored`
  - Plus fields specific to each tool. For example, a callout adds `CalloutShape`, `CalloutTails[]`, `TailStyle`, `RTFEncodedText` (base64 RTF), `FontFamily`/`FontSize`, `ToolPadding` and alignment.
- **`Effects[]`:** whole-image effects (border, shadow, torn edge, and so on), stored as settings rather than baked into the pixels.
- **`Sections[]`, `AddSectionCount`, `ShowSectionGuides`:** the template and "combine images" layout.
- **`StepToolSequenceNumeric`/`UppercaseLetter`/`LowercaseLetter`:** the next step-badge number for each sequence.
- **`SimplifySettings`:** the colour palette and detail level for the "Simplify" tool.
- **Format and app version:** `Version` ("1.0"), `SoftwareVersion`, `ExportedFromPlatform` (`mac`/`win`). The same file opens on both Windows and Mac.

**Embedded assets** are stored inside the object as base64: PNG for pasted images and drop-zone images, and **PDF** (so vector) for step badges and stamps.

The older format was `.snag`, a binary format; both `SNAG` and `SNAGX` are in the `FileType` enum. Snagit also ships `SnagThumbnailProvider.dll` and `SnagxPropertyHandler64.dll`. These let Windows Explorer show `.snagx` thumbnails, and make the OCR text, URL, window name and app name searchable from the Start menu and Explorer search.

### Why use it instead of PNG

| Advantage                             | How the format delivers it                                                                                                                                                                           |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Non-destructive editing**           | Original pixels live in their own PNG, and annotations are separate objects. You can move, restyle or delete an arrow months later, and undo a blur or crop. A PNG flattens all of that permanently. |
| **Hiding information can be undone**  | A blur or pixelate is an object over the original. That is convenient, but the original is still in the file, so **never share a `.snagx` as a redaction**. Export a flattened PNG instead.          |
| **Searchable library**                | OCR text, source app, window title and URL are saved with each capture and indexed by Windows Search.                                                                                                |
| **Instant thumbnails**                | `thumbnail.png` means galleries and Explorer show previews without rendering the objects.                                                                                                            |
| **Resolution-independent marks**      | Arrows, shapes, text and stamps are vectors (stamps are embedded PDFs), so they scale cleanly when the canvas is resized.                                                                            |
| **Templates and multi-image layouts** | `Sections` and `DropZone` objects let one document hold a laid-out guide with several screenshots.                                                                                                   |
| **Portable and debuggable**           | It is ZIP plus JSON plus PNG, so any language can read or write it.                                                                                                                                  |
| **Downsides**                         | Only Snagit opens it (others see a ZIP). It is bigger than a PNG, and you must export to share. Rich text is stored as RTF, an awkward choice for web tools.                                         |

### Snipit's `.snip` (built)

Snipit now has its own **`.snip`** project format on the same design. The format is documented in `src/editor/snipFile.ts`.

```
Snipit_…_edited.snip  (ZIP)
├── document.json   { format: "snipit", version: 1, image:{file,width,height}, crop, shapes:[…] }
├── metadata.json   { savedAt }  (to grow: app, window title, URL, OCR text, tags)
├── original.png    (untouched capture)
├── thumbnail.png   (≤ 400 px, flattened)
└── assets/<id>.png (images pasted onto the snip)
```

**How saving works:**

- Each save writes the flattened `<name>_edited.png`, which is what the gallery, Copy and sharing use.
- It also writes `<name>_edited.snip` beside it.
- Opening that PNG again restores the original image plus every shape and the crop, so the annotations can be edited again.

**Gallery:** cards that have a project show an **Editable** badge. Deleting a card moves both files to the Recycle Bin.

**Version handling:**

- A file from a newer format version is refused with a message.
- Shape types Snipit doesn't recognise are skipped.

**Possible next steps:**

- Add capture metadata (window title, app, URL).
- Import `.snagx`. Snipit's ZIP reader already opens Snagit's files, so what's left is mapping `ToolMode` objects to Snipit shapes. This would let Snagit users bring their libraries across.

---

## 2. UI layout map

The view-model and window class names come from the assemblies. Snipit locations come from the current code.

| Snagit surface                                                                   | What it contains                                                                                                                                                    | Snipit today                                                                                |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| **Capture window** (`UniversalCaptureWindow`)                                    | Three tabs: **All-in-One / Image / Video**. Saved presets list. Each preset has its own selection, effects and share settings. One big Capture button.              | Main window has a **Capture** tab with buttons for the three modes. No presets.             |
| **OneClick widget** (`OneClickWindow`, dockable `Top/Bottom/Left/Right`)         | Collapsed tab on a screen edge that expands to capture buttons and options.                                                                                         | ✅ **Capture widget**, top edge only                                                        |
| **Selection overlay**                                                            | Crosshair, magnifier, size readout, auto-detect window and region. In All-in-One mode, a post-selection toolbar picks Image / Video / Panoramic / Scrolling arrows. | ✅ Overlay with loupe and size readout. 🟡 No post-selection mode toolbar or scroll arrows. |
| **Recording HUDs**                                                               | Ready-to-record HUD, recording HUD, mini HUD, webcam swap window, panoramic HUD, step-capture HUD, ScreenDraw HUD                                                   | ❌ (only a scroll-status pill)                                                              |
| **Editor: top toolbar** (`ToolBar`, items `Tool/Effect/Output/Command/EditMore`) | Customisable tool row with a **More** overflow; Undo/Redo, Share and Copy buttons on the right; **Create** menu (new image, template, video from images, combine).  | 🟡 Tool row, no customisation or More overflow, no Create menu                              |
| **Editor: right side panel** (`SidePanelState = Effects / Properties`)           | **Quick Styles gallery** (themes) on top, then a **tool properties** panel with colour, size, shadow, opacity, line ends and so on. A separate **Effects** panel.   | 🟡 Inline properties (8 colours, S/M/L), no quick styles, no effects panel                  |
| **Editor: bottom tray** (`TrayControl`, thumbnail size S/M/L)                    | Strip of recent captures (images, videos, GIFs). Drag to reorder, multi-select, then _Combine images_. Includes a **tags** control.                                 | ❌ The ROADMAP lists "Recent captures tray".                                                |
| **Library view** (`ViewType.LibraryView`)                                        | Full grid filtered by date, application, website and tags, with a search box.                                                                                       | 🟡 Gallery grid only                                                                        |
| **Video view**                                                                   | Player, trim selection, cut, "Create GIF"                                                                                                                           | ❌                                                                                          |
| **Options dialog** (`EditorOptionsTab`)                                          | Tabs: General, Editor, Outputs, Library, Advanced, Experiments                                                                                                      | 🟡 Settings: hotkeys, after-capture action, widget, startup                                 |
| **Learning Center / onboarding**                                                 | Getting Started / Learn / What's New tabs, coachmarks, enhanced tooltips with video clips                                                                           | ❌                                                                                          |

**A note on "same UI":** matching the layout and workflow (top tool row, right properties panel, bottom tray, capture window with presets) is a reasonable goal. Do **not** copy TechSmith's actual assets into Snipit: icons, stamp PDFs, tooltip videos, `.snagtheme` files, ML models, or the "Snagit" names. Those are their copyrighted files. Use your own icons (Snipit already uses its own) and your own wording.

---

## 3. Capture features

Legend: ✅ have · 🟡 partial · ❌ missing

| Snagit (`SelectionMode` / settings) | Details found                                                                                                                                                         | Snipit                                       |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| Region                              | Prompt or **fixed region** (`RegionSelectionFixed` with x/y/w/h)                                                                                                      | ✅ prompt only                               |
| Window                              | Active window or prompt. **Fixed window size**. Title-bar transparency: Actual / Transparent / Clean                                                                  | 🟡 top-level windows only, no child controls |
| Fullscreen                          | (none recorded)                                                                                                                                                       | ✅ per-monitor. ❌ all monitors at once      |
| Scrolling window                    | Auto-scroll arrows (vertical, horizontal or both). Error types: capture failed, stitch out of memory                                                                  | ✅ vertical, mouse-wheel driven              |
| **Panoramic**                       | Manual scroll while frames are stitched live. Preview statuses: no overlap, zero translation                                                                          | ❌                                           |
| **Menu**                            | Captures open menus and their cascades                                                                                                                                | ❌                                           |
| **Freehand**                        | Lasso-shaped capture                                                                                                                                                  | ❌                                           |
| **Multiple area**                   | Several regions combined into one capture                                                                                                                             | ❌                                           |
| **Object**                          | UI element capture through UI Automation (`Interop.UIAutomationClient.dll`)                                                                                           | ❌                                           |
| **Grab text (OCR)**                 | Captures text, not an image. ABBYY FineReader plus Windows OCR; paragraph or word granularity; **table → Excel** detection (`SuccessTable`)                           | ❌                                           |
| Clipboard / File                    | Uses the clipboard image or a file as the "capture"                                                                                                                   | ✅ clipboard image. ❌ file                  |
| **Step capture**                    | Each click becomes a step image with a numbered badge, gathered into one guide                                                                                        | ❌                                           |
| **Timed capture**                   | **Delay**, **Interval** (seconds/min/hours, can skip identical frames), **Schedule** (at a set time)                                                                  | ❌                                           |
| Capture cursor                      | (none recorded)                                                                                                                                                       | ❌                                           |
| **Presets**                         | Each preset stores mode, selection, effects, a hotkey, an output (file, email, FTP, program, cloud…), auto-naming (`<Prefix><AutoNum>`), and preview in editor yes/no | ❌                                           |
| HDR capture                         | `HdrCapture.dll`, feature flag `NEW_HDR_CAPTURE`                                                                                                                      | ❌                                           |
| Copy to clipboard / open in editor  | (none recorded)                                                                                                                                                       | ✅                                           |

## 4. Video and GIF

| Snagit                                                                                                                                                                                          | Snipit |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| Screen recording to MP4, region or window                                                                                                                                                       | ❌     |
| System audio, microphone, **AI background-noise removal** (`deepfilternet3_minimal.onnx`)                                                                                                       | ❌     |
| Webcam with **picture-in-picture** (shapes: circle, rectangle, rounded rectangle, square, rounded square) and placement in a corner or full screen. Can swap screen and camera while recording. | ❌     |
| **Multi-track** recording to separate files or TREC (for Camtasia)                                                                                                                              | ❌     |
| Cursor highlight, click animation (colour settings)                                                                                                                                             | ❌     |
| **ScreenDraw**: arrow, rectangle and step drawn live while recording, fading after a delay                                                                                                      | ❌     |
| Pause/resume, countdown, disk-space warning                                                                                                                                                     | ❌     |
| Trim and cut, combine videos                                                                                                                                                                    | ❌     |
| **Video from images**: narrate over a set of images                                                                                                                                             | ❌     |
| **Create GIF**: presets for screen video, high-motion and reduced size; scale in pixels or %                                                                                                    | ❌     |

## 5. Editor tools (`ToolMode`)

Snagit's editor has 22 tools (the `ToolMode` enum minus `None` and `LastTool`). Twenty of them are on its toolbar: Favorites, Arrow, Text, Callout, Shape, Stamp, Fill, Move and Selection by default, and Blur, Simplify, Magic Wand, Crop, Cut Out, Pen, Line, Highlighter, Step, Eraser and Magnify under **More**. The last tool picked from More stays on the bar. This order and the per-tool properties below were checked against the activated Snagit 2026.4 editor on 2026-11-17.

Snipit's editor (rebuilt 2026-11-17) has the same twenty tools, toolbar, More menu with Customize Toolbar, Quick Styles panel with themes and favourite stars, Tool Properties panel and "Select All (tool)" button.

| Tool                    | Snagit options                                                                                     | Snipit                                                                      |
| ----------------------- | -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| **Favorites**           | Starred Quick Styles from every tool                                                               | ✅                                                                          |
| **Arrow**               | Colour, shadow direction, start/end style, dash, width, opacity, start/end size, Bezier curve      | ✅ 9 end styles, 5 dashes, curve handle                                     |
| **Text**                | Fill, outline, shadow, font, size, bold/italic/underline, alignment, line width, padding           | ✅                                                                          |
| **Callout**             | Fill, outline, shape, shadow, font and text colour, outline size, arrow style/colour/size, padding | ✅ 8 bodies; pointer or line-arrow tail with a yellow tail handle           |
| **Shape**               | Fill, outline, shape, shadow, line style, width, opacity                                           | ✅ rect, rounded (radius handle), ellipse, triangle, diamond, hexagon, star |
| **Stamp**               | Searchable categorised library                                                                     | ✅ emoji stamps in six categories, searchable                               |
| **Fill**                | Colour, tolerance, opacity                                                                         | ✅ flood fill on the image                                                  |
| **Move**                | Selects objects (Snagit also does Smart Move)                                                      | 🟡 object select, marquee, multi-move; no Smart Move                        |
| **Selection**           | Rectangle, ellipse, freehand, magic lasso; background fill transparent or auto                     | 🟡 rectangle, ellipse, freehand; transparent or auto-fill; no lasso         |
| **Blur**                | Blur, pixelate, solid; rectangle or ellipse; intensity; Smart Redact                               | 🟡 all but Smart Redact                                                     |
| **Simplify**            | Manual and automatic simplify                                                                      | 🟡 manual blocks with sampled colour; no auto simplify                      |
| **Magic Wand**          | Tolerance, all matching colours, background fill                                                   | ✅                                                                          |
| **Crop**                | Crop floaty                                                                                        | ✅                                                                          |
| **Cut Out**             | Vertical or horizontal; none, fade, sharktooth, saw, wave, torn                                    | ✅                                                                          |
| **Pen**                 | Colour, shadow, nib shape, width, opacity, smoothing                                               | ✅ six nibs                                                                 |
| **Line**                | As Arrow                                                                                           | ✅                                                                          |
| **Highlighter**         | Colour, opacity (draws a rectangle)                                                                | ✅                                                                          |
| **Step**                | Fill, text colour, style (circle, square, pointed), sequence 1/A/a, reset, opacity, shadow         | ✅ with a handle for the point's direction                                  |
| **Eraser**              | Width, opacity, anti-alias                                                                         | ✅ erases to transparency                                                   |
| **Magnify**             | Outline colour, shape, magnification, width                                                        | ✅                                                                          |
| Not on Snagit's toolbar | Cursor, Drop Zone                                                                                  | ❌                                                                          |

**Selection handles** follow Snagit: lines and arrows show a dot at each end (and a yellow curve handle when curved), boxed objects show eight square handles and a round rotate handle, and shape-specific adjustments (callout tail, corner radius, step point) use yellow diamond handles.

**Features shared by every tool:**

- **Quick Styles**: saved presets for each tool, plus colour **themes** (`.snagtheme`) that generate a matching style set.
- Drop shadow on every object (colour, blur, opacity, direction).
- Lock objects; flatten selected or flatten all.
- Z-order.
- Select all.
- An undo stack that stays in the file. Snipit's undo history is in memory only.

## 6. Image effects (`EffectType`)

Snagit has 15 whole-image effects (the `EffectType` enum minus `EffectNone`). Snipit has none of them.

| Effect                 | Options                                                      |
| ---------------------- | ------------------------------------------------------------ |
| Border                 | width, colour                                                |
| Shadow                 | (none recorded)                                              |
| Edges                  | torn, wave, saw, sharktooth, fade, bevel                     |
| Perspective / shear    | (none recorded)                                              |
| Page curl              | (none recorded)                                              |
| Spotlight & magnify    | (none recorded)                                              |
| Caption                | inside or outside (left/right/top/bottom), timestamp formats |
| Watermark              | image and position                                           |
| Filters                | soften, sharpen, opacity, monochrome, grayscale, invert      |
| Colour adjustment      | (none recorded)                                              |
| Colour replacement     | replace or swap                                              |
| Scale                  | by %, to width, to height, or both                           |
| Rotation               | (none recorded)                                              |
| Trim                   | auto-trim borders                                            |
| Image resolution (DPI) | (none recorded)                                              |

Snagit also has these image commands:

- **Resize image** in px, in, cm or %, with locked aspect ratio
- **Resize canvas** with an anchor among 9 positions
- Rotate and flip
- Canvas colour

**Snipit:** none of the effects exist yet. Resize image/canvas is on the ROADMAP (M2).

## 7. Library, organise and search

| Snagit                                                                                                      | Snipit                                                                           |
| ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Auto-saves every capture (as `.snagx`)                                                                      | ✅ auto-saves a PNG                                                              |
| Recent-captures **tray** in the editor; rename; delete                                                      | ✅ gallery, a recent strip on the Capture tab and a tray menu. ❌ in-editor tray |
| **Tags**, filters by date, app and website, and search                                                      | ❌                                                                               |
| **Background OCR** of every capture, so you can search by the text inside images (`FEATURE_BACKGROUND_OCR`) | ❌                                                                               |
| Windows Explorer thumbnails and search properties for `.snagx`                                              | ❌                                                                               |
| **Combine images** (classic reorder or into a template)                                                     | ❌                                                                               |
| **Templates**: step guides, before/after and similar layouts, built from `Sections` and `DropZones`         | ❌                                                                               |
| Share history (sort by date, name or destination)                                                           | ❌                                                                               |

## 8. Output, share and file types

**Save formats** (`FileType`):

- PNG, JPEG, GIF, BMP, TIFF, **WebP**, **PDF**, PSD, ICO, CUR, TGA, EMF, WMF, EPS, MHT, SNAG, SNAGX
- Multipage PDF with page size, margins and landscape
- JPEG quality and PNG transparency settings

**Snipit:** PNG only.

**Share destinations:** these are plug-in DLLs in the install folder.

- Clipboard
- File (auto-naming)
- **Email** (MimeKit)
- **FTP**
- **Printer**
- **Any program** (user-managed list)
- **Screencast / share link**
- Camtasia / Camtasia Online
- Microsoft: Word, Excel, PowerPoint, OneNote, OneDrive, SharePoint, Teams
- Cloud and apps: Box, Dropbox, Google Drive, Slack, YouTube, Evernote

**Snipit:** clipboard and a PNG in the library folder. The ROADMAP M6 lists custom HTTP upload, S3 and Imgur.

**Other features found:**

- Mobile Connect (send from a phone)
- Deep links and an asset store
- Colour themes (Dark / Light / System)
- Localisation into 6 languages
- Microsoft ink support for stylus input (`ruiSDK`)

---

## 9. Suggested build order for Snipit

Ordered by value per effort. Each item notes the existing Snipit code it builds on.

1. ~~**`.snip` project format.**~~ **Done:** see section 1. The metadata it stores will later feed search.
2. **Capture metadata.** Record the window title and process name at capture time. The window list already knows both (`capture/window_list.rs`).
3. **Delay timer, cursor capture, all-monitors fullscreen, repeat last capture.** These are small changes to `capture/mod.rs`.
4. ~~**Editor depth:**~~ **Done** (2026-11-17), apart from Smart Redact and auto Simplify:
   - shadow on objects
   - arrow end styles and curved arrows
   - step letter sequences and pointed badges
   - solid redaction box
   - magnify tool
   - z-order controls
   - **quick styles**
5. **Effects panel:** border, shadow, torn/wave edges, resize image or canvas, auto-trim.
6. **Export formats:** JPG, WebP and PDF, plus Save As and a filename template.
7. **OCR:** a "grab text" capture mode, then background OCR of the library so captures are searchable by the text in them. Windows' built-in OCR (`Windows.Media.Ocr`) is free and runs on the device.
8. **Library:** tags, date grouping, search, and an in-editor recent tray.
9. **Capture presets:** mode, effects and output, each with its own hotkey.
10. **Smart redact.** OCR plus regexes for email, phone and card numbers, plus face detection.
11. **Video:** MP4 recording, audio, webcam PiP and GIF export (ROADMAP M4).
12. **Other capture modes:** panoramic, freehand, multi-area, menu, object, and step capture.
13. **Further features:** templates and combine images, Simplify, Cut Out, and the stamp library (built from your own art).

## Open questions

- **Search filters:** the exact filter set of Snagit's library search was not observed. It is inferred from the tag and metadata fields.
- **Effects inside `.snagx`:** the sample files had empty `Effects[]` and `Sections[]` arrays, so the stored shape of effects and sections in the JSON is unconfirmed. Saving a test capture in Snagit with an effect applied would confirm it.
- **Rendering details:** how the native editor draws the canvas (anti-aliasing, how shadows are drawn) was not examined.
