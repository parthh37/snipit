# Roadmap

Milestones are ordered; each one ships something usable. Details and priorities in
[ANALYSIS.md](ANALYSIS.md).

## M0 — Project setup

- [x] Scaffold Tauri 2 + React + TypeScript + Vite
- [x] Lint/format (ESLint, Prettier, rustfmt, clippy)
- [x] GitHub Actions CI: lint, test, build Windows installer
- [x] System tray icon with Quit

## M1 — Capture MVP

- [x] Global hotkeys, rebindable in Settings (`PrintScreen` region, `Shift+PrintScreen` full screen)
- [x] Freeze-frame region overlay on the monitor under the cursor
- [ ] Region overlay spanning all monitors at once (mixed DPI)
- [x] Magnifier loupe, size readout, Esc to cancel
- [ ] Window capture (hover highlight)
- [x] Full screen / single-monitor capture
- [x] Copy to clipboard + auto-save PNG to library folder (`Pictures\Snipit`)

## M2 — Editor MVP

- [x] Editor with undo/redo, paste images from the clipboard
- [ ] Editor zoom/pan
- [x] Tools: arrow, rectangle, ellipse, line, pen, text, text bubble (callout), step numbers, highlighter
- [x] Pixelate
- [ ] Blur
- [ ] Crop & resize
- [ ] Recent captures tray
- [ ] `.snip` project file (non-destructive) + export PNG/JPG/WebP/PDF

## M3 — Workflow

- [x] Gallery of saved snips (open, copy, show in folder, delete)
- [ ] Gallery date grouping, search, tags
- [ ] Capture presets (capture type → effects → output)
- [x] Settings: hotkeys, after-capture action, launch at startup
- [ ] Settings: output folder, filename template, theme
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

- [ ] Installer + code signing
- [ ] Auto-update
- [ ] Share plugins (custom HTTP upload, S3, Imgur)
- [ ] Webcam overlay, click visualisation
- [ ] Combine images / step-guide templates
