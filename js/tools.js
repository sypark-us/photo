/* Pixelforge - tools. Each tool receives doc-space points {x,y} and the original pointer event. */
(function () {
  'use strict';
  const PF = window.PF;
  const U = PF.util;
  const app = () => PF.app;
  const doc = () => PF.app.doc;

  const ICONS = {
    move: '<path d="M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3"/>',
    marquee: '<rect x="4" y="4" width="16" height="16" stroke-dasharray="3 2"/>',
    crop: '<path d="M7 3v14h14M3 7h14v14"/>',
    brush: '<path d="M4 20c2-4 3-5 6-5l9-11 1 1-11 9c0 3-1 4-5 6z"/>',
    eraser: '<path d="M4 16l9-9 6 6-6 6H8z M9 21h11"/>',
    fill: '<path d="M5 12l7-7 7 7-7 7z M19 15c0 2 1 3 1 4a1.5 1.5 0 0 1-3 0c0-1 1-2 2-4z"/>',
    gradient: '<rect x="4" y="4" width="16" height="16"/><path d="M8 4v16M12 4v16M16 4v16" opacity=".5"/>',
    eyedropper: '<path d="M4 20l1-4 9-9 3 3-9 9zM14 7l3 3M15 4l5 5"/>',
    text: '<path d="M5 6V4h14v2M12 4v16M9 20h6"/>',
    shape: '<rect x="3" y="5" width="10" height="10"/><circle cx="16" cy="15" r="5"/>',
    transform: '<rect x="5" y="5" width="14" height="14"/><rect x="3" y="3" width="4" height="4" fill="currentColor"/><rect x="17" y="3" width="4" height="4" fill="currentColor"/><rect x="3" y="17" width="4" height="4" fill="currentColor"/><rect x="17" y="17" width="4" height="4" fill="currentColor"/>',
    zoom: '<circle cx="11" cy="11" r="7"/><path d="M16 16l5 5M8 11h6M11 8v6"/>',
    hand: '<path d="M7 11V6a1.5 1.5 0 0 1 3 0v5V4.5a1.5 1.5 0 0 1 3 0V11V6a1.5 1.5 0 0 1 3 0v8l2-2.5a1.4 1.4 0 0 1 2.2 1.7L17 19c-1 2-3 3-5.5 3C8 22 6 20 6 17v-5a1.5 1.5 0 0 1 1 0z"/>',
  };

  function rgba(hex, a) { const [r, g, b] = U.hexToRgb(hex); return `rgba(${r},${g},${b},${a})`; }

  function stamp(ctx, x, y, size, hardness, color) {
    const r = Math.max(0.5, size / 2);
    if (hardness >= 0.99 || r < 1.2) {
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    } else {
      const g = ctx.createRadialGradient(x, y, r * hardness, x, y, r);
      g.addColorStop(0, color); g.addColorStop(1, rgba(color, 0));
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    }
  }
  function stampLine(ctx, a, b, size, hardness, color) {
    const dist = Math.hypot(b.x - a.x, b.y - a.y);
    const spacing = Math.max(0.5, size * (hardness >= 0.99 ? 0.08 : 0.15));
    const n = Math.max(1, Math.ceil(dist / spacing));
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      stamp(ctx, a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, size, hardness, color);
    }
  }
  function clipToSelection(ctx, layer) {
    const sel = doc().selection;
    if (!sel) return;
    const r = U.intRect(sel);
    ctx.beginPath(); ctx.rect(r.x - layer.x, r.y - layer.y, r.w, r.h); ctx.clip();
  }
  function activeEditableLayer() {
    const d = doc(); if (!d) return null;
    const l = d.active;
    if (!l) { app().toast('No layer selected', true); return null; }
    if (l.locked) { app().toast('Layer is locked', true); return null; }
    if (!l.visible) { app().toast('Layer is hidden', true); return null; }
    return l;
  }

  /* ---------- brush / eraser (shared) ---------- */
  function makePaintTool(id, name, key, isEraser) {
    let layer = null, strokeCanvas = null, strokeCtx = null, last = null, preview = null, previewCtx = null, painting = false;
    return {
      id, name, key, icon: ICONS[id], cursor: 'crosshair',
      options: [
        { key: 'size', label: 'Size', type: 'range', min: 1, max: 400, step: 1, def: isEraser ? 30 : 12 },
        { key: 'hardness', label: 'Hardness', type: 'range', min: 0, max: 100, step: 1, def: isEraser ? 100 : 80 },
        { key: 'opacity', label: 'Opacity', type: 'range', min: 1, max: 100, step: 1, def: 100 },
        { key: 'pressure', label: 'Pen pressure', type: 'checkbox', def: true },
      ],
      down(pt, e) {
        layer = activeEditableLayer(); if (!layer) return;
        const d = doc();
        strokeCanvas = U.createCanvas(d.width, d.height); strokeCtx = strokeCanvas.getContext('2d');
        preview = U.createCanvas(d.width, d.height); previewCtx = preview.getContext('2d');
        painting = true;
        last = { x: pt.x - layer.x, y: pt.y - layer.y, p: e.pressure || 0.5 };
        const o = app().opts(id);
        stamp(strokeCtx, last.x, last.y, this.sizeFor(o, e), o.hardness / 100, isEraser ? '#000000' : app().state.fg);
        app().requestRender();
      },
      sizeFor(o, e) {
        if (o.pressure && e && e.pointerType === 'pen' && e.pressure > 0) return Math.max(1, o.size * e.pressure);
        return o.size;
      },
      move(pt, e) {
        if (!painting) return;
        const o = app().opts(id);
        const cur = { x: pt.x - layer.x, y: pt.y - layer.y };
        stampLine(strokeCtx, last, cur, this.sizeFor(o, e), o.hardness / 100, isEraser ? '#000000' : app().state.fg);
        last = cur;
        app().requestRender();
      },
      up() {
        if (!painting) return;
        painting = false;
        const o = app().opts(id);
        const d = doc();
        d.saveState(isEraser ? 'Eraser' : 'Brush');
        const ctx = layer.ctx;
        ctx.save();
        clipToSelection(ctx, layer);
        ctx.globalAlpha = o.opacity / 100;
        ctx.globalCompositeOperation = isEraser ? 'destination-out' : 'source-over';
        ctx.drawImage(strokeCanvas, 0, 0);
        ctx.restore();
        strokeCanvas = preview = null;
        d.invalidate();
        app().afterEdit();
      },
      previewLayer(l) {
        if (!painting || l !== layer) return null;
        const o = app().opts(id);
        previewCtx.save();
        previewCtx.globalCompositeOperation = 'source-over'; previewCtx.globalAlpha = 1;
        previewCtx.clearRect(0, 0, preview.width, preview.height);
        previewCtx.drawImage(layer.canvas, 0, 0);
        clipToSelection(previewCtx, layer);
        previewCtx.globalAlpha = o.opacity / 100;
        previewCtx.globalCompositeOperation = isEraser ? 'destination-out' : 'source-over';
        previewCtx.drawImage(strokeCanvas, 0, 0);
        previewCtx.restore();
        return preview;
      },
      drawCursor(ctx, vpt, zoom) {
        const o = app().opts(id);
        ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(vpt.x, vpt.y, (o.size * zoom) / 2, 0, Math.PI * 2); ctx.stroke();
        ctx.strokeStyle = 'rgba(0,0,0,.6)';
        ctx.beginPath(); ctx.arc(vpt.x, vpt.y, (o.size * zoom) / 2 + 1, 0, Math.PI * 2); ctx.stroke();
      },
      cancel() { painting = false; strokeCanvas = preview = null; app().requestRender(); },
    };
  }

  /* ---------- move ---------- */
  const moveTool = (() => {
    let layer = null, start = null, orig = null, moved = false;
    return {
      id: 'move', name: 'Move', key: 'V', icon: ICONS.move, cursor: 'move',
      options: [{ key: 'autoSelect', label: 'Auto-select layer', type: 'checkbox', def: false }],
      down(pt) {
        const d = doc(); if (!d) return;
        if (app().opts('move').autoSelect) {
          for (let i = d.layers.length - 1; i >= 0; i--) {
            const l = d.layers[i];
            if (!l.visible) continue;
            const x = Math.floor(pt.x - l.x), y = Math.floor(pt.y - l.y);
            if (x < 0 || y < 0 || x >= l.width || y >= l.height) continue;
            if (l.ctx.getImageData(x, y, 1, 1).data[3] > 0) { d.activeId = l.id; app().updatePanels(); break; }
          }
        }
        layer = d.active;
        if (!layer || layer.locked) { layer = null; return; }
        start = pt; orig = { x: layer.x, y: layer.y }; moved = false;
      },
      move(pt) {
        if (!layer) return;
        if (!moved) { doc().saveState('Move layer'); moved = true; }
        layer.x = Math.round(orig.x + pt.x - start.x);
        layer.y = Math.round(orig.y + pt.y - start.y);
        doc().invalidate(); app().requestRender();
      },
      up() { if (moved) app().afterEdit(); layer = null; },
      nudge(dx, dy) {
        const l = activeEditableLayer(); if (!l) return;
        doc().saveState('Nudge layer'); l.x += dx; l.y += dy; doc().invalidate(); app().afterEdit();
      },
    };
  })();

  /* ---------- marquee ---------- */
  const marqueeTool = (() => {
    let start = null;
    return {
      id: 'marquee', name: 'Rectangle Select', key: 'M', icon: ICONS.marquee, cursor: 'crosshair',
      options: [{ key: 'square', label: 'Square (or hold Shift)', type: 'checkbox', def: false }],
      down(pt) { start = pt; },
      move(pt, e) {
        if (!start) return;
        let b = pt;
        if (e.shiftKey || app().opts('marquee').square) {
          const s = Math.max(Math.abs(pt.x - start.x), Math.abs(pt.y - start.y));
          b = { x: start.x + Math.sign(pt.x - start.x || 1) * s, y: start.y + Math.sign(pt.y - start.y || 1) * s };
        }
        const d = doc();
        d.selection = U.intRect(U.clipRect(U.normRect(start, b), d.width, d.height));
        app().requestRender();
      },
      up() {
        const d = doc();
        if (d && d.selection && (d.selection.w < 1 || d.selection.h < 1)) d.selection = null;
        start = null; app().requestRender(); app().updatePanels();
      },
    };
  })();

  /* ---------- crop ---------- */
  const cropTool = (() => {
    let start = null, rect = null;
    return {
      id: 'crop', name: 'Crop', key: 'C', icon: ICONS.crop, cursor: 'crosshair',
      options: [
        { key: 'apply', label: 'Apply (Enter)', type: 'button', onClick: () => cropTool.apply() },
        { key: 'cancel', label: 'Cancel (Esc)', type: 'button', onClick: () => cropTool.cancel() },
      ],
      activate() { rect = doc() && doc().selection ? { ...doc().selection } : null; },
      deactivate() { rect = null; },
      down(pt) { start = pt; },
      move(pt) { if (start) { rect = U.intRect(U.clipRect(U.normRect(start, pt), doc().width, doc().height)); app().requestRender(); } },
      up() { start = null; if (rect && (rect.w < 1 || rect.h < 1)) rect = null; app().requestRender(); },
      drawOverlay(ctx, v) {
        if (!rect) return;
        const d = doc();
        const a = v.docToView(0, 0), b = v.docToView(d.width, d.height), r0 = v.docToView(rect.x, rect.y), r1 = v.docToView(rect.x + rect.w, rect.y + rect.h);
        ctx.save();
        ctx.fillStyle = 'rgba(0,0,0,.55)';
        ctx.beginPath(); ctx.rect(a.x, a.y, b.x - a.x, b.y - a.y); ctx.rect(r0.x, r0.y, r1.x - r0.x, r1.y - r0.y); ctx.fill('evenodd');
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.strokeRect(r0.x + .5, r0.y + .5, r1.x - r0.x, r1.y - r0.y);
        ctx.fillStyle = '#fff'; ctx.font = '11px sans-serif';
        ctx.fillText(`${rect.w} × ${rect.h}`, r0.x + 4, r0.y - 4 < 10 ? r0.y + 14 : r0.y - 4);
        ctx.restore();
      },
      apply() {
        if (!rect) { app().toast('Drag to define a crop area first', true); return; }
        const d = doc(); d.saveState('Crop'); d.crop(rect); rect = null;
        app().afterEdit(); app().fitToScreen();
      },
      cancel() { rect = null; start = null; app().requestRender(); },
    };
  })();

  /* ---------- fill (paint bucket) ---------- */
  const fillTool = {
    id: 'fill', name: 'Paint Bucket', key: 'G', icon: ICONS.fill, cursor: 'crosshair',
    options: [
      { key: 'tolerance', label: 'Tolerance', type: 'range', min: 0, max: 100, step: 1, def: 20 },
      { key: 'contiguous', label: 'Contiguous', type: 'checkbox', def: true },
      { key: 'opacity', label: 'Opacity', type: 'range', min: 1, max: 100, step: 1, def: 100 },
    ],
    down(pt) {
      const layer = activeEditableLayer(); if (!layer) return;
      const d = doc(), o = app().opts('fill');
      PF.Doc.bakeOffset(layer);
      const x = Math.floor(pt.x), y = Math.floor(pt.y);
      const sel = d.selectionRect();
      if (x < sel.x || y < sel.y || x >= sel.x + sel.w || y >= sel.y + sel.h) return;
      d.saveState('Fill');
      const w = layer.width, h = layer.height;
      const img = layer.ctx.getImageData(0, 0, w, h), px = img.data;
      const si = (y * w + x) * 4;
      const seed = [px[si], px[si + 1], px[si + 2], px[si + 3]];
      const tol = (o.tolerance / 100) * 255 * 4;
      const match = (i) => Math.abs(px[i] - seed[0]) + Math.abs(px[i + 1] - seed[1]) + Math.abs(px[i + 2] - seed[2]) + Math.abs(px[i + 3] - seed[3]) <= tol;
      const mask = new Uint8Array(w * h);
      const inSel = (xx, yy) => xx >= sel.x && yy >= sel.y && xx < sel.x + sel.w && yy < sel.y + sel.h;
      if (o.contiguous) {
        const stack = [x, y];
        while (stack.length) {
          const cy = stack.pop(), cx = stack.pop();
          let lx = cx;
          while (lx >= sel.x && !mask[cy * w + lx] && match((cy * w + lx) * 4)) lx--;
          lx++;
          let rx = cx;
          while (rx < sel.x + sel.w && !mask[cy * w + rx] && match((cy * w + rx) * 4)) rx++;
          for (let i = lx; i < rx; i++) {
            mask[cy * w + i] = 1;
            if (cy > sel.y && !mask[(cy - 1) * w + i] && match(((cy - 1) * w + i) * 4)) stack.push(i, cy - 1);
            if (cy < sel.y + sel.h - 1 && !mask[(cy + 1) * w + i] && match(((cy + 1) * w + i) * 4)) stack.push(i, cy + 1);
          }
        }
      } else {
        for (let yy = sel.y; yy < sel.y + sel.h; yy++) for (let xx = sel.x; xx < sel.x + sel.w; xx++) if (match((yy * w + xx) * 4)) mask[yy * w + xx] = 1;
      }
      const [r, g, b] = U.hexToRgb(app().state.fg), a = o.opacity / 100;
      for (let i = 0; i < mask.length; i++) {
        if (!mask[i]) continue;
        const j = i * 4;
        const da = px[j + 3] / 255, oa = a + da * (1 - a);
        if (oa === 0) continue;
        px[j] = (r * a + px[j] * da * (1 - a)) / oa; px[j + 1] = (g * a + px[j + 1] * da * (1 - a)) / oa; px[j + 2] = (b * a + px[j + 2] * da * (1 - a)) / oa;
        px[j + 3] = oa * 255;
      }
      layer.ctx.putImageData(img, 0, 0);
      d.invalidate(); app().afterEdit();
      void inSel;
    },
  };

  /* ---------- gradient ---------- */
  const gradientTool = (() => {
    let a = null, b = null, layer = null, preview = null;
    const build = (ctx, o) => {
      const fg = app().state.fg, bg = app().state.bg;
      const g = o.type === 'radial'
        ? ctx.createRadialGradient(a.x - layer.x, a.y - layer.y, 0, a.x - layer.x, a.y - layer.y, Math.hypot(b.x - a.x, b.y - a.y) || 1)
        : ctx.createLinearGradient(a.x - layer.x, a.y - layer.y, b.x - layer.x, b.y - layer.y);
      g.addColorStop(0, fg);
      g.addColorStop(1, o.mode === 'transparent' ? rgba(fg, 0) : bg);
      return g;
    };
    const paint = (ctx, o) => {
      ctx.save(); clipToSelection(ctx, layer);
      ctx.globalAlpha = o.opacity / 100;
      ctx.fillStyle = build(ctx, o); ctx.fillRect(0, 0, layer.width, layer.height); ctx.restore();
    };
    return {
      id: 'gradient', name: 'Gradient', key: 'Shift+G', icon: ICONS.gradient, cursor: 'crosshair',
      options: [
        { key: 'type', label: 'Type', type: 'select', values: [['linear', 'Linear'], ['radial', 'Radial']], def: 'linear' },
        { key: 'mode', label: 'Colors', type: 'select', values: [['fgbg', 'Foreground → Background'], ['transparent', 'Foreground → Transparent']], def: 'fgbg' },
        { key: 'opacity', label: 'Opacity', type: 'range', min: 1, max: 100, step: 1, def: 100 },
      ],
      down(pt) { layer = activeEditableLayer(); if (!layer) return; a = pt; b = pt; preview = U.createCanvas(layer.width, layer.height); },
      move(pt) { if (a) { b = pt; app().requestRender(); } },
      up() {
        if (!a) return;
        if (Math.hypot(b.x - a.x, b.y - a.y) > 1) {
          doc().saveState('Gradient'); paint(layer.ctx, app().opts('gradient')); doc().invalidate(); app().afterEdit();
        }
        a = b = null; preview = null; app().requestRender();
      },
      previewLayer(l) {
        if (!a || l !== layer) return null;
        const ctx = preview.getContext('2d');
        ctx.clearRect(0, 0, preview.width, preview.height); ctx.drawImage(layer.canvas, 0, 0);
        paint(ctx, app().opts('gradient'));
        return preview;
      },
      drawOverlay(ctx, v) {
        if (!a) return;
        const p = v.docToView(a.x, a.y), q = v.docToView(b.x, b.y);
        ctx.save(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.setLineDash([4, 3]);
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke(); ctx.restore();
      },
      cancel() { a = b = null; preview = null; app().requestRender(); },
    };
  })();

  /* ---------- eyedropper ---------- */
  const eyedropperTool = {
    id: 'eyedropper', name: 'Eyedropper', key: 'I', icon: ICONS.eyedropper, cursor: 'crosshair',
    options: [{ key: 'sample', label: 'Sample', type: 'select', values: [['1', 'Point'], ['3', '3×3 average'], ['5', '5×5 average']], def: '1' }],
    pick(pt, e) {
      const d = doc(); if (!d) return;
      const n = parseInt(app().opts('eyedropper').sample, 10), h = Math.floor(n / 2);
      const x0 = U.clamp(Math.floor(pt.x) - h, 0, d.width - 1), y0 = U.clamp(Math.floor(pt.y) - h, 0, d.height - 1);
      const w = Math.min(n, d.width - x0), hh = Math.min(n, d.height - y0);
      d.render();
      const data = d.compositeCtx.getImageData(x0, y0, w, hh).data;
      let r = 0, g = 0, b = 0, c = 0;
      for (let i = 0; i < data.length; i += 4) { if (data[i + 3] === 0) continue; r += data[i]; g += data[i + 1]; b += data[i + 2]; c++; }
      if (!c) return;
      const hex = U.rgbToHex(r / c, g / c, b / c);
      if (e.altKey) app().setColors(null, hex); else app().setColors(hex, null);
    },
    down(pt, e) { this.pick(pt, e); this.active = true; },
    move(pt, e) { if (this.active) this.pick(pt, e); },
    up() { this.active = false; },
  };

  /* ---------- text ---------- */
  const textTool = (() => {
    let editor = null, anchor = null;
    const fonts = ['Arial', 'Segoe UI', 'Helvetica', 'Times New Roman', 'Georgia', 'Courier New', 'Consolas', 'Verdana', 'Impact', 'Comic Sans MS', 'Trebuchet MS'];
    const fontCss = (o) => `${o.italic ? 'italic ' : ''}${o.bold ? 'bold ' : ''}${o.size}px "${o.font}"`;
    const tool = {
      id: 'text', name: 'Text', key: 'T', icon: ICONS.text, cursor: 'text',
      options: [
        { key: 'font', label: 'Font', type: 'select', values: fonts.map((f) => [f, f]), def: 'Arial' },
        { key: 'size', label: 'Size', type: 'number', min: 4, max: 800, step: 1, def: 48 },
        { key: 'bold', label: 'Bold', type: 'checkbox', def: false },
        { key: 'italic', label: 'Italic', type: 'checkbox', def: false },
        { key: 'align', label: 'Align', type: 'select', values: [['left', 'Left'], ['center', 'Center'], ['right', 'Right']], def: 'left' },
        { key: 'commit', label: 'Place text (Ctrl+Enter)', type: 'button', onClick: () => tool.commit() },
      ],
      onOptionChange() { if (editor) tool.styleEditor(); },
      down(pt) {
        if (!doc()) return;
        if (editor) { tool.commit(); return; }
        anchor = pt;
        editor = document.getElementById('textEditor');
        editor.value = '';
        editor.classList.remove('hidden');
        tool.styleEditor();
        setTimeout(() => editor.focus(), 0);
        editor.oninput = () => tool.autosize();
        editor.onkeydown = (e) => {
          if (e.key === 'Escape') { e.preventDefault(); tool.cancel(); }
          else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); tool.commit(); }
          e.stopPropagation();
        };
      },
      styleEditor() {
        if (!editor || !anchor) return;
        const o = app().opts('text'), v = app().view, z = doc().zoom;
        const p = v.docToView(anchor.x, anchor.y);
        editor.style.left = p.x + 'px'; editor.style.top = p.y + 'px';
        editor.style.font = `${o.italic ? 'italic ' : ''}${o.bold ? 'bold ' : ''}${o.size * z}px "${o.font}"`;
        editor.style.color = app().state.fg;
        editor.style.textAlign = o.align;
        tool.autosize();
      },
      autosize() {
        if (!editor) return;
        const lines = editor.value.split('\n');
        const o = app().opts('text'), z = doc().zoom;
        const c = document.createElement('canvas').getContext('2d');
        c.font = editor.style.font;
        const w = Math.max(60, ...lines.map((l) => c.measureText(l || ' ').width)) + 10;
        editor.style.width = w + 'px';
        editor.style.height = Math.max(1, lines.length) * o.size * z * 1.2 + 6 + 'px';
      },
      commit() {
        if (!editor) return;
        const text = editor.value;
        const o = app().opts('text');
        tool.hide();
        if (!text.trim()) return;
        const d = doc();
        d.saveState('Text');
        const l = d.newLayer('T: ' + text.split('\n')[0].slice(0, 20));
        const ctx = l.ctx;
        ctx.font = fontCss(o); ctx.fillStyle = app().state.fg; ctx.textBaseline = 'top'; ctx.textAlign = o.align;
        const lines = text.split('\n');
        const widths = lines.map((ln) => ctx.measureText(ln).width), maxW = Math.max(...widths);
        const ox = o.align === 'center' ? maxW / 2 : o.align === 'right' ? maxW : 0;
        lines.forEach((ln, i) => ctx.fillText(ln, anchor.x + ox, anchor.y + i * o.size * 1.2));
        d.invalidate(); app().afterEdit();
      },
      hide() { if (editor) { editor.classList.add('hidden'); editor.onkeydown = null; editor = null; } anchor = null; },
      cancel() { tool.hide(); app().requestRender(); },
      deactivate() { if (editor) tool.commit(); },
      onViewChange() { if (editor) tool.styleEditor(); },
    };
    return tool;
  })();

  /* ---------- shapes ---------- */
  const shapeTool = (() => {
    let a = null, b = null, layer = null, preview = null;
    const draw = (ctx, o, shift) => {
      const r = U.normRect(a, b);
      if (shift && o.shape !== 'line') { const s = Math.max(r.w, r.h); r.w = r.h = s; if (b.x < a.x) r.x = a.x - s; if (b.y < a.y) r.y = a.y - s; }
      ctx.save(); clipToSelection(ctx, layer);
      ctx.translate(-layer.x, -layer.y);
      ctx.fillStyle = app().state.fg; ctx.strokeStyle = o.strokeColor === 'bg' ? app().state.bg : app().state.fg; ctx.lineWidth = o.strokeWidth;
      ctx.globalAlpha = o.opacity / 100;
      ctx.beginPath();
      if (o.shape === 'rect') ctx.rect(r.x, r.y, r.w, r.h);
      else if (o.shape === 'ellipse') ctx.ellipse(r.x + r.w / 2, r.y + r.h / 2, r.w / 2, r.h / 2, 0, 0, Math.PI * 2);
      else if (o.shape === 'rounded') { const rad = Math.min(o.radius, r.w / 2, r.h / 2); ctx.roundRect ? ctx.roundRect(r.x, r.y, r.w, r.h, rad) : ctx.rect(r.x, r.y, r.w, r.h); }
      else { ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); }
      if (o.shape === 'line') ctx.stroke();
      else { if (o.mode !== 'stroke') ctx.fill(); if (o.mode !== 'fill' && o.strokeWidth > 0) ctx.stroke(); }
      ctx.restore();
    };
    return {
      id: 'shape', name: 'Shape', key: 'U', icon: ICONS.shape, cursor: 'crosshair',
      options: [
        { key: 'shape', label: 'Shape', type: 'select', values: [['rect', 'Rectangle'], ['rounded', 'Rounded rect'], ['ellipse', 'Ellipse'], ['line', 'Line']], def: 'rect' },
        { key: 'mode', label: 'Mode', type: 'select', values: [['fill', 'Fill'], ['stroke', 'Stroke'], ['both', 'Fill + Stroke']], def: 'fill' },
        { key: 'strokeWidth', label: 'Stroke', type: 'number', min: 0, max: 200, step: 1, def: 4 },
        { key: 'strokeColor', label: 'Stroke color', type: 'select', values: [['fg', 'Foreground'], ['bg', 'Background']], def: 'bg' },
        { key: 'radius', label: 'Corner radius', type: 'number', min: 0, max: 500, step: 1, def: 16 },
        { key: 'opacity', label: 'Opacity', type: 'range', min: 1, max: 100, step: 1, def: 100 },
      ],
      shift: false,
      down(pt) { layer = activeEditableLayer(); if (!layer) return; a = b = pt; preview = U.createCanvas(layer.width, layer.height); },
      move(pt, e) { if (a) { b = pt; this.shift = e.shiftKey; app().requestRender(); } },
      up() {
        if (!a) return;
        if (a.x !== b.x || a.y !== b.y) { doc().saveState('Shape'); draw(layer.ctx, app().opts('shape'), this.shift); doc().invalidate(); app().afterEdit(); }
        a = b = null; preview = null; app().requestRender();
      },
      previewLayer(l) {
        if (!a || l !== layer) return null;
        const ctx = preview.getContext('2d');
        ctx.clearRect(0, 0, preview.width, preview.height); ctx.drawImage(layer.canvas, 0, 0);
        draw(ctx, app().opts('shape'), this.shift);
        return preview;
      },
      cancel() { a = b = null; preview = null; app().requestRender(); },
    };
  })();

  /* ---------- free transform ---------- */
  const transformTool = (() => {
    let layer = null, src = null, box = null, orig = null, mode = null, start = null, startBox = null, startAngle = 0, preview = null, changed = false;
    const HANDLE = 7;
    const handles = () => {
      const { x, y, w, h } = box;
      return [
        ['nw', x, y], ['n', x + w / 2, y], ['ne', x + w, y], ['e', x + w, y + h / 2],
        ['se', x + w, y + h], ['s', x + w / 2, y + h], ['sw', x, y + h], ['w', x, y + h / 2],
      ];
    };
    const center = () => ({ x: box.x + box.w / 2, y: box.y + box.h / 2 });
    const rot = (p, c, ang) => { const s = Math.sin(ang), co = Math.cos(ang); const dx = p.x - c.x, dy = p.y - c.y; return { x: c.x + dx * co - dy * s, y: c.y + dx * s + dy * co }; };
    const tool = {
      id: 'transform', name: 'Free Transform', key: 'Ctrl+T', icon: ICONS.transform, cursor: 'default', hiddenInToolbar: true,
      options: [
        { key: 'w', label: 'W', type: 'number', min: 1, max: 20000, step: 1, def: 0 },
        { key: 'h', label: 'H', type: 'number', min: 1, max: 20000, step: 1, def: 0 },
        { key: 'angle', label: 'Angle', type: 'number', min: -360, max: 360, step: 1, def: 0 },
        { key: 'keepAspect', label: 'Keep aspect', type: 'checkbox', def: true },
        { key: 'apply', label: 'Apply (Enter)', type: 'button', onClick: () => tool.apply() },
        { key: 'cancel', label: 'Cancel (Esc)', type: 'button', onClick: () => tool.cancel() },
      ],
      activate() {
        layer = activeEditableLayer();
        if (!layer) { app().setTool('move'); return; }
        PF.Doc.bakeOffset(layer);
        const b = U.opaqueBounds(layer.canvas);
        if (!b) { app().toast('Layer is empty', true); app().setTool('move'); return; }
        src = U.createCanvas(b.w, b.h);
        src.getContext('2d').drawImage(layer.canvas, -b.x, -b.y);
        box = { x: b.x, y: b.y, w: b.w, h: b.h, angle: 0 };
        orig = { ...box };
        preview = U.createCanvas(layer.width, layer.height);
        changed = false;
        tool.syncOptions();
      },
      syncOptions() {
        const o = app().opts('transform');
        o.w = Math.round(box.w); o.h = Math.round(box.h); o.angle = Math.round((box.angle * 180) / Math.PI);
        app().renderOptions();
      },
      onOptionChange(key) {
        if (!box) return;
        const o = app().opts('transform');
        const c = center();
        if (key === 'w') { const nw = Math.max(1, o.w); if (o.keepAspect) box.h *= nw / box.w; box.w = nw; }
        if (key === 'h') { const nh = Math.max(1, o.h); if (o.keepAspect) box.w *= nh / box.h; box.h = nh; }
        if (key === 'angle') box.angle = (o.angle * Math.PI) / 180;
        box.x = c.x - box.w / 2; box.y = c.y - box.h / 2;
        changed = true; app().requestRender(); tool.syncOptions();
      },
      hitHandle(pt) {
        const z = doc().zoom, c = center();
        const local = rot(pt, c, -box.angle);
        for (const [id, hx, hy] of handles()) if (Math.abs(local.x - hx) * z <= HANDLE && Math.abs(local.y - hy) * z <= HANDLE) return id;
        if (local.x >= box.x && local.x <= box.x + box.w && local.y >= box.y && local.y <= box.y + box.h) return 'move';
        return 'rotate';
      },
      down(pt) {
        if (!box) return;
        mode = tool.hitHandle(pt); start = pt; startBox = { ...box };
        const c = center(); startAngle = Math.atan2(pt.y - c.y, pt.x - c.x) - box.angle;
      },
      move(pt, e) {
        if (!mode) return;
        const o = app().opts('transform');
        if (mode === 'move') { box.x = startBox.x + pt.x - start.x; box.y = startBox.y + pt.y - start.y; }
        else if (mode === 'rotate') {
          const c = { x: startBox.x + startBox.w / 2, y: startBox.y + startBox.h / 2 };
          let ang = Math.atan2(pt.y - c.y, pt.x - c.x) - startAngle;
          if (e.shiftKey) ang = Math.round(ang / (Math.PI / 12)) * (Math.PI / 12);
          box.angle = ang;
        } else {
          const c = { x: startBox.x + startBox.w / 2, y: startBox.y + startBox.h / 2 };
          const lp = rot(pt, c, -startBox.angle), ls = rot(start, c, -startBox.angle);
          const dx = lp.x - ls.x, dy = lp.y - ls.y;
          let { x, y, w, h } = startBox;
          if (mode.includes('e')) w += dx; if (mode.includes('s')) h += dy;
          if (mode.includes('w')) { x += dx; w -= dx; } if (mode.includes('n')) { y += dy; h -= dy; }
          if ((o.keepAspect || e.shiftKey) && mode.length === 2) {
            const k = Math.max(w / startBox.w, h / startBox.h);
            const nw = startBox.w * k, nh = startBox.h * k;
            if (mode.includes('w')) x += w - nw; if (mode.includes('n')) y += h - nh;
            w = nw; h = nh;
          }
          if (w < 1) w = 1; if (h < 1) h = 1;
          // keep the fixed corner fixed after rotation: compensate center shift
          const newC = rot({ x: x + w / 2, y: y + h / 2 }, c, startBox.angle);
          box.w = w; box.h = h; box.x = newC.x - w / 2; box.y = newC.y - h / 2;
        }
        changed = true; app().requestRender(); tool.syncOptions();
      },
      up() { mode = null; },
      render(ctx) {
        const c = center();
        ctx.save(); ctx.translate(c.x, c.y); ctx.rotate(box.angle);
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(src, -box.w / 2, -box.h / 2, box.w, box.h); ctx.restore();
      },
      previewLayer(l) {
        if (!box || l !== layer) return null;
        const ctx = preview.getContext('2d');
        ctx.clearRect(0, 0, preview.width, preview.height);
        tool.render(ctx);
        return preview;
      },
      drawOverlay(ctx, v) {
        if (!box) return;
        const c = center(), z = doc().zoom;
        const corners = [[box.x, box.y], [box.x + box.w, box.y], [box.x + box.w, box.y + box.h], [box.x, box.y + box.h]].map(([x, y]) => v.docToView(...Object.values(rot({ x, y }, c, box.angle))));
        ctx.save(); ctx.strokeStyle = '#3b8eea'; ctx.lineWidth = 1;
        ctx.beginPath(); corners.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.closePath(); ctx.stroke();
        ctx.fillStyle = '#fff';
        for (const [, hx, hy] of handles()) { const p = v.docToView(...Object.values(rot({ x: hx, y: hy }, c, box.angle))); ctx.fillRect(p.x - HANDLE / 2, p.y - HANDLE / 2, HANDLE, HANDLE); ctx.strokeRect(p.x - HANDLE / 2, p.y - HANDLE / 2, HANDLE, HANDLE); }
        ctx.fillStyle = '#fff'; ctx.font = '11px sans-serif';
        const tl = corners[0];
        ctx.fillText(`${Math.round(box.w)} × ${Math.round(box.h)}  ${Math.round((box.angle * 180) / Math.PI)}°`, tl.x, tl.y - 6);
        ctx.restore();
        void z;
      },
      apply() {
        if (!box) return;
        if (changed) {
          const d = doc(); d.saveState('Free Transform');
          const c = U.createCanvas(layer.width, layer.height); tool.render(c.getContext('2d'));
          layer.setCanvas(c); layer.x = layer.y = 0; d.invalidate(); app().afterEdit();
        }
        box = null; app().setTool('move');
      },
      cancel() { box = null; src = null; app().setTool('move'); },
      deactivate() { box = null; src = null; preview = null; },
    };
    return tool;
  })();

  /* ---------- zoom / hand ---------- */
  const zoomTool = {
    id: 'zoom', name: 'Zoom', key: 'Z', icon: ICONS.zoom, cursor: 'zoom-in',
    options: [{ key: 'fit', label: 'Fit to screen', type: 'button', onClick: () => app().fitToScreen() }, { key: 'one', label: '100%', type: 'button', onClick: () => app().setZoom(1) }],
    down(pt, e) { app().zoomAt(e.altKey ? 1 / 1.5 : 1.5, pt); },
  };
  const handTool = (() => {
    let start = null, pan = null;
    return {
      id: 'hand', name: 'Hand', key: 'H', icon: ICONS.hand, cursor: 'grab',
      options: [],
      down(pt, e) { start = { x: e.clientX, y: e.clientY }; pan = { x: doc().panX, y: doc().panY }; },
      move(pt, e) { if (start) { doc().panX = pan.x + e.clientX - start.x; doc().panY = pan.y + e.clientY - start.y; app().onViewChange(); } },
      up() { start = null; },
    };
  })();

  const list = [moveTool, marqueeTool, cropTool, makePaintTool('brush', 'Brush', 'B', false), makePaintTool('eraser', 'Eraser', 'E', true),
    fillTool, gradientTool, eyedropperTool, textTool, shapeTool, transformTool, zoomTool, handTool];
  PF.tools = { list, byId: Object.fromEntries(list.map((t) => [t.id, t])), ICONS };
})();
