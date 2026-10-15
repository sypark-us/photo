/* Pixelforge - document, layers, history */
(function () {
  'use strict';
  const PF = window.PF;
  const U = PF.util;

  PF.BLEND_MODES = [
    ['source-over', 'Normal'], ['multiply', 'Multiply'], ['screen', 'Screen'], ['overlay', 'Overlay'],
    ['darken', 'Darken'], ['lighten', 'Lighten'], ['color-dodge', 'Color Dodge'], ['color-burn', 'Color Burn'],
    ['hard-light', 'Hard Light'], ['soft-light', 'Soft Light'], ['difference', 'Difference'], ['exclusion', 'Exclusion'],
    ['hue', 'Hue'], ['saturation', 'Saturation'], ['color', 'Color'], ['luminosity', 'Luminosity'],
  ];

  class Layer {
    constructor(w, h, name) {
      this.id = U.uid('layer');
      this.name = name || 'Layer';
      this.visible = true;
      this.opacity = 1;
      this.blend = 'source-over';
      this.locked = false;
      this.x = 0;
      this.y = 0;
      this.canvas = U.createCanvas(w, h);
      this.ctx = U.ctx2d(this.canvas);
    }
    clone(keepId) {
      const l = new Layer(this.canvas.width, this.canvas.height, this.name);
      if (keepId) l.id = this.id;
      l.visible = this.visible; l.opacity = this.opacity; l.blend = this.blend; l.locked = this.locked;
      l.x = this.x; l.y = this.y;
      l.ctx.drawImage(this.canvas, 0, 0);
      return l;
    }
    /** Replace content with a new canvas (same or different size). */
    setCanvas(canvas) {
      this.canvas = canvas;
      this.ctx = U.ctx2d(canvas);
    }
    get width() { return this.canvas.width; }
    get height() { return this.canvas.height; }
  }

  const MAX_HISTORY = 40;

  class Doc {
    constructor(w, h, name) {
      this.id = U.uid('doc');
      this.name = name || 'Untitled';
      this.width = w;
      this.height = h;
      this.layers = [];      // bottom -> top
      this.activeId = null;
      this.selection = null; // {x,y,w,h} in doc pixels, or null
      this.history = [];
      this.future = [];
      this.composite = U.createCanvas(w, h);
      this.compositeCtx = U.ctx2d(this.composite);
      this.dirty = true;
      this.zoom = 1;
      this.panX = 0;
      this.panY = 0;
      this.modified = false;
    }

    get active() { return this.layers.find((l) => l.id === this.activeId) || null; }
    get activeIndex() { return this.layers.findIndex((l) => l.id === this.activeId); }

    addLayer(layer, index) {
      if (index == null) index = this.activeIndex + 1 || this.layers.length;
      if (index < 0) index = this.layers.length;
      this.layers.splice(index, 0, layer);
      this.activeId = layer.id;
      this.invalidate();
      return layer;
    }
    newLayer(name) {
      const n = this.layers.length + 1;
      return this.addLayer(new Layer(this.width, this.height, name || 'Layer ' + n));
    }
    removeLayer(layer) {
      const i = this.layers.indexOf(layer);
      if (i < 0) return;
      this.layers.splice(i, 1);
      if (this.activeId === layer.id) {
        const next = this.layers[Math.min(i, this.layers.length - 1)];
        this.activeId = next ? next.id : null;
      }
      this.invalidate();
    }
    duplicateLayer(layer) {
      const c = layer.clone();
      c.name = layer.name + ' copy';
      this.addLayer(c, this.layers.indexOf(layer) + 1);
      return c;
    }
    moveLayer(from, to) {
      if (to < 0 || to >= this.layers.length || from === to) return false;
      const [l] = this.layers.splice(from, 1);
      this.layers.splice(to, 0, l);
      this.invalidate();
      return true;
    }
    mergeDown(layer) {
      const i = this.layers.indexOf(layer);
      if (i <= 0) return false;
      const below = this.layers[i - 1];
      const ctx = below.ctx;
      ctx.save();
      ctx.globalAlpha = layer.opacity;
      ctx.globalCompositeOperation = layer.blend;
      ctx.drawImage(layer.canvas, layer.x - below.x, layer.y - below.y);
      ctx.restore();
      if (!layer.visible) { /* merged hidden layer contributes nothing visible; still merge pixels */ }
      this.layers.splice(i, 1);
      this.activeId = below.id;
      this.invalidate();
      return true;
    }
    mergeVisible() {
      const vis = this.layers.filter((l) => l.visible);
      if (vis.length < 2) return false;
      const merged = new Layer(this.width, this.height, 'Merged');
      for (const l of vis) {
        merged.ctx.globalAlpha = l.opacity;
        merged.ctx.globalCompositeOperation = l.blend;
        merged.ctx.drawImage(l.canvas, l.x, l.y);
      }
      merged.ctx.globalAlpha = 1; merged.ctx.globalCompositeOperation = 'source-over';
      const idx = this.layers.indexOf(vis[0]);
      this.layers = this.layers.filter((l) => !l.visible);
      this.layers.splice(Math.min(idx, this.layers.length), 0, merged);
      this.activeId = merged.id;
      this.invalidate();
      return true;
    }
    flatten() {
      this.render();
      const flat = new Layer(this.width, this.height, 'Background');
      flat.ctx.drawImage(this.composite, 0, 0);
      this.layers = [flat];
      this.activeId = flat.id;
      this.invalidate();
    }

    /* ---------- history ---------- */
    snapshot() {
      return {
        width: this.width, height: this.height, activeId: this.activeId,
        selection: this.selection ? { ...this.selection } : null,
        layers: this.layers.map((l) => l.clone(true)),
      };
    }
    restore(s) {
      this.width = s.width; this.height = s.height;
      this.layers = s.layers.map((l) => l.clone(true));
      this.activeId = s.activeId;
      this.selection = s.selection ? { ...s.selection } : null;
      this.ensureComposite();
      this.invalidate();
    }
    /** Call BEFORE mutating the document. */
    saveState(label) {
      this.history.push({ label: label || 'Edit', state: this.snapshot() });
      if (this.history.length > MAX_HISTORY) this.history.shift();
      this.future.length = 0;
      this.modified = true;
    }
    /** Drop the most recent saved state (used when a dialog is cancelled). */
    discardState() { this.history.pop(); }
    undo() {
      const h = this.history.pop();
      if (!h) return null;
      this.future.push({ label: h.label, state: this.snapshot() });
      this.restore(h.state);
      return h.label;
    }
    redo() {
      const f = this.future.pop();
      if (!f) return null;
      this.history.push({ label: f.label, state: this.snapshot() });
      this.restore(f.state);
      return f.label;
    }

    /* ---------- geometry ---------- */
    ensureComposite() {
      if (this.composite.width !== this.width || this.composite.height !== this.height) {
        this.composite = U.createCanvas(this.width, this.height);
        this.compositeCtx = U.ctx2d(this.composite);
      }
    }
    /** Resize canvas (no resampling). anchor: {ax,ay} in 0..1 */
    resizeCanvas(w, h, anchor = { ax: 0.5, ay: 0.5 }) {
      const dx = Math.round((w - this.width) * anchor.ax);
      const dy = Math.round((h - this.height) * anchor.ay);
      for (const l of this.layers) {
        const c = U.createCanvas(w, h);
        c.getContext('2d').drawImage(l.canvas, l.x + dx, l.y + dy);
        l.setCanvas(c); l.x = 0; l.y = 0;
      }
      this.width = w; this.height = h;
      this.selection = null;
      this.ensureComposite();
      this.invalidate();
    }
    /** Resample all layers to new size. */
    resizeImage(w, h, smooth = true) {
      const sx = w / this.width, sy = h / this.height;
      for (const l of this.layers) {
        const c = U.createCanvas(w, h);
        const ctx = c.getContext('2d');
        ctx.imageSmoothingEnabled = smooth;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(l.canvas, l.x * sx, l.y * sy, l.width * sx, l.height * sy);
        l.setCanvas(c); l.x = 0; l.y = 0;
      }
      this.width = w; this.height = h;
      this.selection = null;
      this.ensureComposite();
      this.invalidate();
    }
    crop(r) {
      r = U.intRect(U.clipRect(r, this.width, this.height));
      if (r.w < 1 || r.h < 1) return false;
      for (const l of this.layers) {
        const c = U.createCanvas(r.w, r.h);
        c.getContext('2d').drawImage(l.canvas, l.x - r.x, l.y - r.y);
        l.setCanvas(c); l.x = 0; l.y = 0;
      }
      this.width = r.w; this.height = r.h;
      this.selection = null;
      this.ensureComposite();
      this.invalidate();
      return true;
    }
    rotate(deg) { // 90, -90, 180 (whole document)
      const swap = Math.abs(deg) === 90;
      const w = swap ? this.height : this.width, h = swap ? this.width : this.height;
      for (const l of this.layers) {
        const c = U.createCanvas(w, h);
        const ctx = c.getContext('2d');
        ctx.translate(w / 2, h / 2);
        ctx.rotate((deg * Math.PI) / 180);
        ctx.drawImage(l.canvas, l.x - this.width / 2, l.y - this.height / 2);
        l.setCanvas(c); l.x = 0; l.y = 0;
      }
      this.width = w; this.height = h;
      this.selection = null;
      this.ensureComposite();
      this.invalidate();
    }
    flip(horizontal) {
      for (const l of this.layers) PF.Doc.flipLayer(l, horizontal, this.width, this.height);
      this.selection = null;
      this.invalidate();
    }
    static flipLayer(l, horizontal, docW, docH) {
      const c = U.createCanvas(l.width, l.height);
      const ctx = c.getContext('2d');
      if (horizontal) { ctx.translate(docW, 0); ctx.scale(-1, 1); } else { ctx.translate(0, docH); ctx.scale(1, -1); }
      ctx.drawImage(l.canvas, l.x, l.y);
      l.setCanvas(c); l.x = 0; l.y = 0;
    }
    static rotateLayer(l, deg, docW, docH) {
      const c = U.createCanvas(l.width, l.height);
      const ctx = c.getContext('2d');
      ctx.translate(docW / 2, docH / 2);
      ctx.rotate((deg * Math.PI) / 180);
      ctx.drawImage(l.canvas, l.x - docW / 2, l.y - docH / 2);
      l.setCanvas(c); l.x = 0; l.y = 0;
    }
    /** Bake layer offset into pixels so x=y=0 (needed before pixel ops). */
    static bakeOffset(l) {
      if (l.x === 0 && l.y === 0) return;
      const c = U.createCanvas(l.width, l.height);
      c.getContext('2d').drawImage(l.canvas, l.x, l.y);
      l.setCanvas(c); l.x = 0; l.y = 0;
    }

    /* ---------- rendering ---------- */
    invalidate() { this.dirty = true; }
    /** Composite all visible layers. previewFn(layer) may return a replacement canvas for the active layer. */
    render(previewFn) {
      this.ensureComposite();
      const ctx = this.compositeCtx;
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      ctx.clearRect(0, 0, this.width, this.height);
      for (const l of this.layers) {
        if (!l.visible) continue;
        ctx.globalAlpha = l.opacity;
        ctx.globalCompositeOperation = l.blend;
        const src = previewFn ? previewFn(l) || l.canvas : l.canvas;
        ctx.drawImage(src, l.x, l.y);
      }
      ctx.restore();
      this.dirty = false;
      return this.composite;
    }
    /** Flattened RGBA pixels of the whole document (always re-renders). */
    getImageData() {
      this.render();
      return this.compositeCtx.getImageData(0, 0, this.width, this.height);
    }
    selectionRect() {
      return this.selection ? U.intRect(U.clipRect(this.selection, this.width, this.height)) : { x: 0, y: 0, w: this.width, h: this.height };
    }
  }

  PF.Layer = Layer;
  PF.Doc = Doc;
})();
