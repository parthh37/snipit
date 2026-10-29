# Roadmap

Milestones are ordered; each one ships something usable. Details and priorities in
[ANALYSIS.md](ANALYSIS.md).

## M0 — Project setup

- [x] Scaffold Tauri 2 + React + TypeScript + Vite
- [x] Lint/format (ESLint, Prettier, rustfmt, clippy)
- [x] GitHub Actions CI: lint, test, build Windows installer
- [x] System tray icon with Quit
- [x] Release workflow (tag or "Run workflow" → GitHub release)
- [x] Auto-update (signed, from GitHub Releases)
- [x] Per-user installer with WebView2 bootstrapper

## M1 — Capture MVP

- [ ] Global hotkey (`PrintScreen` default)
- [ ] Freeze-frame region overlay across all monitors (mixed DPI)
- [ ] Magnifier loupe, size readout, Esc to cancel
- [ ] Window capture (hover highlight)
- [ ] Full screen / single-monitor capture
- [ ] Copy to clipboard + auto-save PNG to library folder

## M2 — Editor MVP

- [ ] Editor window with zoom/pan, undo/redo
- [ ] Tools: arrow, rectangle, ellipse, line, text, callout, step numbers, highlighter
- [ ] Blur / pixelate
- [ ] Crop & resize
- [ ] Recent captures tray
- [ ] `.snip` project file (non-destructive) + export PNG/JPG/WebP/PDF

## M3 — Workflow

- [ ] Library window (date grouping, search, tags)
- [ ] Capture presets (capture type → effects → output)
- [ ] Settings: hotkeys, output folder, filename template, theme, autostart
- [ ] Delayed capture, cursor capture, repeat last capture
- [ ] Quick styles for tools
- [ ] Effects: border, shadow, torn edge; magnify, spotlight, pen

## M4 — Video

- [ ] Region/window/screen recording to MP4 (hardware encoder)
- [ ] System audio + microphone
- [ ] Pause / resume, trim
- [ ] GIF export

## M5 — Advanced capture

- [ ] Scrolling capture with auto-stitch
- [ ] OCR text capture
- [ ] Color picker
- [ ] Panoramic (manual scroll) capture

## M6 — Polish & release

- [ ] Authenticode code signing (SmartScreen)
- [ ] winget / Scoop packages
- [ ] Share plugins (custom HTTP upload, S3, Imgur)
- [ ] Webcam overlay, click visualisation
- [ ] Combine images / step-guide templates
