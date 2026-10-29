# Snipit

**Capture. Annotate. Share.** — an open-source desktop screen-capture and annotation tool.

> Status: 🚧 planning / early development. See the [roadmap](docs/ROADMAP.md).

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
```

Snipit lives in the system tray: closing the window hides it, and **Quit** in the tray
menu exits.

## Docs

- [Product & technical analysis](docs/ANALYSIS.md)
- [Roadmap](docs/ROADMAP.md)

## License

[MIT](LICENSE)
