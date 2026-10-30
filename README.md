# Snipit

**Capture. Annotate. Share.** — an open-source desktop screen-capture and annotation tool.

> Status: 🚧 planning / early development. See the [roadmap](docs/ROADMAP.md).

## Install

Download `Snipit_x.y.z_x64-setup.exe` from the
[latest release](https://github.com/parthh37/snipit/releases/latest) and run it. It installs
for your user only (no admin prompt), sets up WebView2 if it's missing and adds a Start menu
shortcut. Snipit updates itself from then on. An `.msi` is also attached for
managed/IT deployments.

> Windows may show "Windows protected your PC" because the installer isn't code-signed
> yet — click **More info → Run anyway**.

## Planned features

- **Capture** — region, window, full screen, delayed, scrolling and text (OCR) capture with a global hotkey
- **Record** — screen video with system audio and mic, trim, export to MP4 or GIF
- **Edit** — arrows, shapes, text, callouts, step numbers, highlighter, blur/pixelate, crop, effects
- **Organise** — auto-saved library with search and tags, non-destructive `.snip` project files
- **Share** — clipboard, PNG/JPG/WebP/PDF export, upload integrations

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

## Capturing

| Action                        | How                                                         |
| ----------------------------- | ----------------------------------------------------------- |
| Region or window              | `PrtSc`, then drag a region or click a window               |
| Full screen (current monitor) | `Shift` + `PrtSc`, or `F` while the capture overlay is open |
| Cancel                        | `Esc` or right-click                                        |
| From other tools              | `snipit --capture` or `snipit --capture-fullscreen`         |

Every capture is copied to the clipboard and saved as a PNG in `Pictures\Snipit`.

If `PrtSc` doesn't work, either Windows is using it for Snipping Tool (turn off **Settings →
Accessibility → Keyboard → Use the Print screen key to open screen capture**) or another
screenshot tool has claimed it. Snipit shows a notice in its window when this happens.

## Docs

- [Product & technical analysis](docs/ANALYSIS.md)
- [Roadmap](docs/ROADMAP.md)
- [Releasing & auto-update](docs/RELEASING.md)

## License

[MIT](LICENSE)
