# Pixelforge

A free, Photoshop-style image editor that runs entirely in the browser. No build step, no
dependencies, no uploads: open `index.html` (or serve the folder) and edit.

```
# optional local server (any static server works)
node test/serve.mjs 8080        # then open http://localhost:8080/
# or: python -m http.server 8080 / npx serve .
```

Tests (Node 20+; the browser test needs Chrome or Edge installed):

```
node --test test/            # byte-level unit tests for the BMP/TIFF/ICO/PDF/ZIP encoders
node test/run-smoke.mjs      # drives the real app in headless Chrome: layers, adjustments, tools, export, project round-trip
```

Add `?demo` to the URL to open a sample two-layer document.

## Features

### Layers
- Unlimited layers with visibility, opacity, lock, and all 16 canvas blend modes
  (Normal, Multiply, Screen, Overlay, Darken, Lighten, Color Dodge/Burn, Hard/Soft Light,
  Difference, Exclusion, Hue, Saturation, Color, Luminosity)
- New, duplicate, delete, rename (double-click), reorder by drag or Ctrl+[ / Ctrl+]
- Merge down, merge visible, flatten, layer via copy from a selection
- Move layers with the Move tool or arrow keys (Shift = 10 px); auto-select layer under cursor
- Free Transform (Ctrl+T): scale with handles, rotate by dragging outside the box, numeric W/H/angle
- Flip / rotate individual layers; live thumbnails in the Layers panel

### Adjustments (live preview, selection-aware, undoable)
- **Levels** with RGB / per-channel histogram, input black/white, midtone **gamma**, output levels
- **Gamma correction** dialog (master + per-channel R/G/B)
- **Curves** with draggable control points (monotone spline), RGB and per-channel, histogram backdrop
- Brightness/Contrast, Exposure (EV, offset, gamma), Hue/Saturation/Lightness, Vibrance
- Color Balance (temperature, tint, shadows/midtones/highlights), Sepia
- Invert, Desaturate, Threshold, Posterize, Auto Levels, Auto Contrast

### Filters
- Gaussian blur, box blur, sharpen, unsharp mask, emboss, find edges, solarize
- Add noise (color / mono), pixelate, vignette

### Tools
Move (V) · Rectangle Select (M) · Crop (C) · Brush (B) · Eraser (E) · Paint Bucket (G) ·
Gradient (Shift+G) · Eyedropper (I) · Text (T) · Shapes (U: rect / rounded / ellipse / line) ·
Zoom (Z) · Hand (H) · Free Transform (Ctrl+T)

- Brush/eraser: size, hardness, opacity, pen-pressure support, `[` `]` size keys, live cursor outline
- Paint bucket: tolerance, contiguous or global fill, respects selection
- Text: font family, size, bold/italic, alignment; rendered onto its own layer
- Selections constrain painting, fills, gradients, adjustments and filters; marching-ants display
- Image: resize (bicubic / nearest), canvas size with anchor, crop to selection, trim transparent edges,
  rotate 90°/180°, flip
- Undo/redo history (40 steps) with a History panel; multiple open documents in tabs
- Copy/cut/paste within the app and to/from the system clipboard; drag-and-drop and paste to open
- Dark Photoshop-like UI with menu bar, options bar, tool palette, Layers / Histogram / History / Info panels

### File formats
| Direction | Formats |
|---|---|
| Open | PNG, JPEG, GIF, WebP, BMP, SVG, AVIF, ICO (anything the browser decodes), `.pxf` project |
| Export | PNG, JPEG (quality), WebP (quality), AVIF (when the browser can encode it), BMP 24-bit, BMP 32-bit with alpha, TIFF (uncompressed RGBA), ICO (single or multi-size 16–256), PDF (JPEG-embedded) |
| Project | `.pxf` keeps all layers, blend modes, opacity, offsets and names (JSON + PNG) |

- **Export As** dialog: format, quality, scale, icon sizes, background color for non-alpha formats,
  live preview and file-size estimate
- **Batch Convert**: pick many files, choose target format / quality / max dimension, download a ZIP

The BMP, TIFF, ICO, PDF and ZIP writers are implemented from scratch in `js/encoders.js`
and are unit-tested (`node --test test/`).

## Project layout

```
index.html         UI skeleton
css/style.css      dark theme
js/util.js         helpers
js/encoders.js     BMP / TIFF / ICO / PDF / ZIP byte encoders (Node-compatible)
js/document.js     Doc + Layer model, compositing, history, geometry ops
js/adjust.js       pixel adjustments (levels, gamma, curves, HSL…) and filters
js/io.js           import/export, batch conversion, .pxf project format
js/tools.js        interactive tools
js/dialogs.js      dialog framework and all dialogs
js/app.js          app shell: menus, shortcuts, canvas view, panels, actions
test/              Node unit tests for the encoders
```

## Keyboard shortcuts
Help → Keyboard Shortcuts inside the app lists them all. Highlights: Ctrl+Z/Y undo/redo,
Ctrl+L Levels, Ctrl+M Curves, Ctrl+G Gamma, Ctrl+U Hue/Saturation, Ctrl+I Invert, Ctrl+T transform,
Ctrl+J duplicate layer, Ctrl+E merge down, Ctrl+Shift+E export, Ctrl+0 fit, Ctrl+1 100 %,
Space+drag pan, Ctrl+wheel zoom.

## Not (yet) included
PSD import/export, non-destructive adjustment layers and masks, lasso/magic-wand selections,
clone/heal tools, animated GIF export. These are the obvious next steps.
