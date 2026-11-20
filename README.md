# Snipit

**Capture. Annotate. Share.** — an open-source desktop screen-capture and annotation tool.

> Status: 🚧 planning / early development. See the [roadmap](docs/ROADMAP.md).

## Install

**[Download Snipit-Setup.exe](https://github.com/parthh37/snipit/releases/latest/download/Snipit-Setup.exe)**
(Windows 10/11, 64-bit) and run it. It installs for your user only (no admin prompt), sets
up WebView2 if it's missing and adds a Start menu shortcut. Snipit updates itself from then
on. To install for everyone on a PC or deploy with IT tools, use
[Snipit-Setup.msi](https://github.com/parthh37/snipit/releases/latest/download/Snipit-Setup.msi)
(needs admin; `msiexec /i Snipit-Setup.msi /qn` installs silently). All files are on the
[releases page](https://github.com/parthh37/snipit/releases/latest).

> Windows may show "Windows protected your PC" because the installer isn't code-signed
> yet — click **More info → Run anyway**.

## Planned features

- **Capture** — region, window, full screen, delayed, scrolling and text (OCR) capture with a global hotkey
- **Record** — screen video with system audio and mic, trim, export to MP4 or GIF
- **Edit** — arrows, shapes, text, callouts, step numbers, highlighter, blur/pixelate, crop, effects
- **Organise** — auto-saved library with search and tags, non-destructive `.snip` project files
- **Share** — clipboard, PNG/JPG/WebP/PDF export, upload integrations

## Using Snipit

Snipit starts with Windows (in release builds) and waits in the system tray. Windows 11 may
tuck a new tray icon under the **^** arrow; drag it onto the taskbar to keep it in view.

The tray icon shows that Snipit is running (it turns grey while shortcuts are paused) and its
tooltip names the capture key. Left-click opens Snipit; right-click has quick actions:
capture a region, window or full screen, annotate the clipboard image, open one of your recent
captures or the captures folder, show or hide the capture widget, pause shortcuts, switch
launch at login on or off, open Settings, check for updates and quit.

| Action                        | How                                                                                                                                                                           |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Region or window              | `PrtSc`, then drag a region or click a window                                                                                                                                 |
| Full screen (current monitor) | `Shift` + `PrtSc`, or `F` while the capture overlay is open                                                                                                                   |
| Scrolling (whole webpage)     | `Ctrl` + `PrtSc`, then click the window or drag the part that scrolls; Snipit scrolls it from the top and stitches one long image. `Esc` (or moving the mouse) finishes early |
| Cancel                        | `Esc` or right-click                                                                                                                                                          |
| Annotate the clipboard image  | `Ctrl+V` in the main window, or the tray menu                                                                                                                                 |
| Repeat last capture           | The same area again: tray menu, the Capture page, or a shortcut you set in Settings                                                                                           |
| From other tools              | `snipit --capture`, `--capture-fullscreen`, `--capture-scrolling` or `--capture-repeat`                                                                                       |
| Capture widget                | Point at the tab on the edge of the screen, pick a capture                                                                                                                    |

All shortcuts can be changed in **Settings**. Every capture is saved as a PNG in
`Pictures\Snipit` (or a folder you pick in Settings, named by a template such as
`{app}_{date}_{time}`) and listed in the **Gallery**. The gallery groups snips by day, and you
can tag them and search by name, tag, program or window title. Settings also picks:

- whether a new capture opens in the editor (the default), goes straight to the clipboard or
  is only saved;
- a capture delay of 3, 5 or 10 seconds, with a countdown;
- whether the mouse pointer is included;
- a light, dark or system theme.

**Capture presets** on the Capture page save a recipe: region, full screen or scrolling, a
delay, the pointer, effects (border, drop shadow, torn edges) and where the result goes. Run
one from the Capture page, the tray menu or its own shortcut.

The **capture widget** is a small tab docked to the top, left or right edge of the screen.
Point at it and it opens into buttons for region, full-screen and clipboard captures. Drag its
grip to slide it along an edge; pull it towards another edge, or onto another monitor, and it
snaps there. It never takes focus from the app you are in and never shows up in your captures.
Hide it with its **×** button, and turn it back on from the tray menu (**Show capture widget**)
or Settings.

If `PrtSc` doesn't work, either Windows is using it for Snipping Tool (turn off **Settings →
Accessibility → Keyboard → Use the Print screen key to open screen capture**) or another
screenshot tool (Snagit, ShareX, OneDrive…) has claimed it. Snipit shows a notice in its
window when this happens, and you can pick another key in Settings.

The editor follows Snagit's: arrow, text, callout, shape, stamp, fill, move, selection, blur,
simplify, magic wand, crop, cut out, pen, line, highlighter, step, eraser and magnify tools,
plus a spotlight that dims everything around it (the **More** menu holds the ones not on the
bar; single-letter shortcuts are in the tooltips), with Quick Styles and favourites, undo/redo,
and pasting images from the clipboard. The **Effects** button frames the whole image with a
border, a drop shadow or torn edges, and they stay editable in the `.snip`. **Copy All** puts
the annotated image on the clipboard and saves it.

## Tech stack

[Tauri 2](https://tauri.app) (Rust core) + React + TypeScript + Konva.js. Windows first,
macOS/Linux later.

## Development

Prerequisites: [Node.js](https://nodejs.org) 22+, [Rust](https://rustup.rs) (stable, MSVC
toolchain on Windows) and the [Tauri prerequisites](https://tauri.app/start/prerequisites/)
for your OS.

```bash
npm install
npm run tauri dev      # run the app with hot reload
npm run tauri build    # build installers into src-tauri/target/release/bundle
npm run check          # typecheck, lint and format check (TS + Rust)
npm run release -- 0.2.0  # bump version, commit and tag a release
```

Snipit lives in the system tray: closing the window hides it, and **Quit** in the tray
menu exits.

## Docs

- [Product page](https://parthh37.github.io/snipit/) — source in [`site/`](site), deployed by
  the Pages workflow
- [Product & technical analysis](docs/ANALYSIS.md)
- [Roadmap](docs/ROADMAP.md)
- [Releasing & auto-update](docs/RELEASING.md)

## License

[MIT](LICENSE)
