/* Pixelforge - dialogs (generic builder + adjustment / image / export dialogs) */
(function () {
  'use strict';
  const PF = window.PF;
  const U = PF.util;
  const el = U.el;
  const app = () => PF.app;
  const doc = () => PF.app.doc;

  let current = null;

  /**
   * spec: { title, fields: [{key,label,type:'range'|'number'|'checkbox'|'select'|'color'|'text'|'custom', min,max,step,value,values,node}],
   *         content?: HTMLElement[], onChange(values, key), onOk(values), onCancel(), okLabel, extraButtons:[{label,onClick}] }
   */
  function open(spec) {
    close();
    const values = {};
    const inputs = {};
    const content = el('div', { class: 'content' });
    const fire = (key) => spec.onChange && spec.onChange(values, key);
    for (const f of spec.fields || []) {
      values[f.key] = f.value;
      if (f.type === 'custom') { content.appendChild(f.node); continue; }
      const row = el('div', { class: 'row' + (f.type === 'checkbox' || f.type === 'select' || f.type === 'text' || f.type === 'color' ? ' wide' : '') });
      row.appendChild(el('label', { text: f.label }));
      if (f.type === 'range') {
        const range = el('input', { type: 'range', min: f.min, max: f.max, step: f.step || 1, value: f.value });
        const num = el('input', { type: 'number', min: f.min, max: f.max, step: f.step || 1, value: f.value });
        range.addEventListener('input', () => { values[f.key] = parseFloat(range.value); num.value = range.value; fire(f.key); });
        num.addEventListener('change', () => { values[f.key] = U.clamp(parseFloat(num.value) || 0, f.min, f.max); range.value = num.value = values[f.key]; fire(f.key); });
        inputs[f.key] = { set(v) { values[f.key] = v; range.value = num.value = v; } };
        row.appendChild(range); row.appendChild(num);
      } else if (f.type === 'number') {
        const num = el('input', { type: 'number', min: f.min, max: f.max, step: f.step || 1, value: f.value });
        num.addEventListener('input', () => { values[f.key] = parseFloat(num.value); fire(f.key); });
        inputs[f.key] = { set(v) { values[f.key] = v; num.value = v; } };
        row.classList.add('wide'); row.appendChild(num);
      } else if (f.type === 'checkbox') {
        const cb = el('input', { type: 'checkbox' }); cb.checked = !!f.value;
        cb.addEventListener('change', () => { values[f.key] = cb.checked; fire(f.key); });
        row.appendChild(el('span', { class: 'check' }, [cb, el('span', { text: f.hint || '' })]));
      } else if (f.type === 'select') {
        const sel = el('select');
        for (const [v, label] of f.values) sel.appendChild(el('option', { value: v, text: label }));
        sel.value = f.value;
        sel.addEventListener('change', () => { values[f.key] = sel.value; fire(f.key); });
        inputs[f.key] = { set(v) { values[f.key] = v; sel.value = v; } };
        row.appendChild(sel);
      } else if (f.type === 'color') {
        const c = el('input', { type: 'color', value: f.value });
        c.addEventListener('input', () => { values[f.key] = c.value; fire(f.key); });
        row.appendChild(c);
      } else if (f.type === 'text') {
        const t = el('input', { type: 'text', value: f.value });
        t.addEventListener('input', () => { values[f.key] = t.value; fire(f.key); });
        inputs[f.key] = { set(v) { values[f.key] = v; t.value = v; } };
        row.appendChild(t);
      }
      content.appendChild(row);
    }
    for (const c of spec.content || []) content.appendChild(c);
    const buttons = el('div', { class: 'buttons' });
    if (spec.extraButtons) {
      const left = el('div', { class: 'left' });
      for (const b of spec.extraButtons) left.appendChild(el('button', { text: b.label, onclick: () => b.onClick(values, inputs) }));
      buttons.appendChild(left);
    }
    const okBtn = el('button', { class: 'primary', text: spec.okLabel || 'OK', onclick: () => { const r = spec.onOk && spec.onOk(values); if (r !== false) close(); } });
    if (spec.onCancel !== null) buttons.appendChild(el('button', { text: 'Cancel', onclick: () => { spec.onCancel && spec.onCancel(); close(); } }));
    buttons.appendChild(okBtn);
    const dlg = el('div', { class: 'dialog', role: 'dialog' }, [el('h2', { text: spec.title }), content, buttons]);
    const modal = el('div', { id: 'modal' }, [dlg]);
    modal.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); spec.onCancel && spec.onCancel(); close(); }
      else if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA' && e.target.tagName !== 'BUTTON') { e.preventDefault(); okBtn.click(); }
      e.stopPropagation();
    });
    document.body.appendChild(modal);
    current = { modal, spec };
    const first = content.querySelector('input,select,button');
    if (first) first.focus(); else okBtn.focus();
    return { values, inputs, close };
  }
  function close() { if (current) { current.modal.remove(); current = null; } }
  function isOpen() { return !!current; }

  /* -------- adjustment dialog with live preview on active layer -------- */
  function adjustment(title, fields, fn, extras) {
    const d = doc(); if (!d) return;
    const layer = d.active;
    if (!layer) return app().toast('No layer selected', true);
    if (layer.locked) return app().toast('Layer is locked', true);
    PF.Doc.bakeOffset(layer);
    const r = d.selectionRect();
    const snap = layer.ctx.getImageData(r.x, r.y, r.w, r.h);
    d.saveState(title);
    let applied = false;
    const apply = U.throttleRAF((values) => {
      const img = new ImageData(new Uint8ClampedArray(snap.data), snap.width, snap.height);
      fn(img, values);
      layer.ctx.putImageData(img, r.x, r.y);
      d.invalidate(); app().requestRender();
      applied = true;
    });
    const dlg = open({
      title, fields,
      content: extras && extras.content,
      onChange: (values) => apply(values),
      onOk: (values) => { if (!applied) apply(values); app().afterEdit(); },
      onCancel: () => { layer.ctx.putImageData(snap, r.x, r.y); d.discardState(); d.invalidate(); app().requestRender(); },
      extraButtons: [{ label: 'Reset', onClick: (values, inputs) => { for (const f of fields) if (inputs[f.key]) inputs[f.key].set(f.value); apply(values); if (extras && extras.onReset) extras.onReset(); } }],
    });
    if (extras && extras.init) extras.init(dlg, snap, apply);
    apply(dlg.values);
    return dlg;
  }

  function drawHistogram(canvas, hist, opts = {}) {
    const ctx = canvas.getContext('2d');
    const w = canvas.width = canvas.clientWidth * (window.devicePixelRatio || 1) || 256, h = canvas.height = canvas.clientHeight * (window.devicePixelRatio || 1) || 100;
    ctx.clearRect(0, 0, w, h);
    const channels = opts.channel && opts.channel !== 'rgb' ? [[hist[opts.channel], opts.channel === 'r' ? '#e55' : opts.channel === 'g' ? '#5d5' : '#59f']] : [[hist.r, 'rgba(255,80,80,.55)'], [hist.g, 'rgba(80,255,80,.55)'], [hist.b, 'rgba(80,140,255,.55)'], [hist.l, 'rgba(230,230,230,.8)']];
    let max = 1;
    for (const [arr] of channels) for (let i = 1; i < 255; i++) max = Math.max(max, arr[i]);
    ctx.globalCompositeOperation = 'lighter';
    for (const [arr, color] of channels) {
      ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(0, h);
      for (let i = 0; i < 256; i++) ctx.lineTo((i / 255) * w, h - Math.min(1, arr[i] / max) * (h - 4));
      ctx.lineTo(w, h); ctx.closePath(); ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  const dialogs = {
    open, close, isOpen, adjustment, drawHistogram,

    brightnessContrast() {
      adjustment('Brightness / Contrast', [
        { key: 'brightness', label: 'Brightness', type: 'range', min: -150, max: 150, value: 0 },
        { key: 'contrast', label: 'Contrast', type: 'range', min: -100, max: 100, value: 0 },
      ], (img, v) => PF.adjust.brightnessContrast(img, v));
    },
    gamma() {
      adjustment('Gamma Correction', [
        { key: 'gamma', label: 'Gamma', type: 'range', min: 0.1, max: 5, step: 0.01, value: 1 },
        { key: 'r', label: 'Red', type: 'range', min: 0.1, max: 3, step: 0.01, value: 1 },
        { key: 'g', label: 'Green', type: 'range', min: 0.1, max: 3, step: 0.01, value: 1 },
        { key: 'b', label: 'Blue', type: 'range', min: 0.1, max: 3, step: 0.01, value: 1 },
      ], (img, v) => PF.adjust.gamma(img, v), {
        content: [el('div', { class: 'note', text: 'Gamma > 1 brightens midtones, < 1 darkens them. Per-channel sliders multiply the master value.' })],
      });
    },
    levels() {
      const hist = el('canvas', { class: 'hist' });
      let snapData = null, channel = 'rgb';
      adjustment('Levels', [
        { key: 'channel', label: 'Channel', type: 'select', values: [['rgb', 'RGB'], ['r', 'Red'], ['g', 'Green'], ['b', 'Blue']], value: 'rgb' },
        { key: 'inBlack', label: 'Input black', type: 'range', min: 0, max: 254, value: 0 },
        { key: 'gamma', label: 'Midtone (gamma)', type: 'range', min: 0.1, max: 9.99, step: 0.01, value: 1 },
        { key: 'inWhite', label: 'Input white', type: 'range', min: 1, max: 255, value: 255 },
        { key: 'outBlack', label: 'Output black', type: 'range', min: 0, max: 255, value: 0 },
        { key: 'outWhite', label: 'Output white', type: 'range', min: 0, max: 255, value: 255 },
      ], (img, v) => {
        if (v.channel !== channel) { channel = v.channel; drawHistogram(hist, PF.adjust.histogram(snapData), { channel }); }
        PF.adjust.levels(img, v);
      }, {
        content: [hist],
        init(dlg, snap) { snapData = snap; requestAnimationFrame(() => drawHistogram(hist, PF.adjust.histogram(snap), { channel })); },
      });
    },
    curves() {
      const cv = el('canvas', { class: 'curve', width: 256, height: 256 });
      const points = { rgb: [[0, 0], [255, 255]], r: [[0, 0], [255, 255]], g: [[0, 0], [255, 255]], b: [[0, 0], [255, 255]] };
      let channel = 'rgb', dragging = -1, snapData = null, applyFn = null, vals = null;
      const luts = () => ({ master: PF.adjust.curveLUT(points.rgb), r: PF.adjust.curveLUT(points.r), g: PF.adjust.curveLUT(points.g), b: PF.adjust.curveLUT(points.b) });
      const draw = () => {
        const ctx = cv.getContext('2d');
        ctx.clearRect(0, 0, 256, 256);
        if (snapData) {
          const h = PF.adjust.histogram(snapData)[channel === 'rgb' ? 'l' : channel];
          let max = 1; for (let i = 1; i < 255; i++) max = Math.max(max, h[i]);
          ctx.fillStyle = 'rgba(255,255,255,.12)';
          for (let i = 0; i < 256; i++) { const v = Math.min(1, h[i] / max) * 250; ctx.fillRect(i, 256 - v, 1, v); }
        }
        ctx.strokeStyle = '#444'; ctx.lineWidth = 1;
        for (let i = 1; i < 4; i++) { ctx.beginPath(); ctx.moveTo(i * 64, 0); ctx.lineTo(i * 64, 256); ctx.moveTo(0, i * 64); ctx.lineTo(256, i * 64); ctx.stroke(); }
        const lut = PF.adjust.curveLUT(points[channel]);
        ctx.strokeStyle = channel === 'rgb' ? '#eee' : channel === 'r' ? '#f66' : channel === 'g' ? '#6f6' : '#6af'; ctx.lineWidth = 2;
        ctx.beginPath(); for (let i = 0; i < 256; i++) ctx.lineTo(i, 255 - lut[i]); ctx.stroke();
        ctx.fillStyle = '#fff';
        for (const [x, y] of points[channel]) { ctx.beginPath(); ctx.arc(x, 255 - y, 4, 0, Math.PI * 2); ctx.fill(); }
      };
      const pos = (e) => { const r = cv.getBoundingClientRect(); return [U.clamp(Math.round(((e.clientX - r.left) / r.width) * 255), 0, 255), U.clamp(Math.round(255 - ((e.clientY - r.top) / r.height) * 255), 0, 255)]; };
      cv.addEventListener('pointerdown', (e) => {
        const [x, y] = pos(e);
        const pts = points[channel];
        dragging = pts.findIndex((p) => Math.abs(p[0] - x) < 8 && Math.abs(p[1] - y) < 8);
        if (dragging < 0) { pts.push([x, y]); pts.sort((a, b) => a[0] - b[0]); dragging = pts.findIndex((p) => p[0] === x && p[1] === y); }
        cv.setPointerCapture(e.pointerId);
      });
      cv.addEventListener('pointermove', (e) => {
        if (dragging < 0) return;
        const [x, y] = pos(e); const pts = points[channel];
        const lo = dragging > 0 ? pts[dragging - 1][0] + 1 : 0, hi = dragging < pts.length - 1 ? pts[dragging + 1][0] - 1 : 255;
        pts[dragging] = [U.clamp(x, lo, hi), y];
        draw(); if (applyFn) applyFn(vals);
      });
      cv.addEventListener('pointerup', () => { dragging = -1; });
      cv.addEventListener('dblclick', (e) => {
        const [x, y] = pos(e); const pts = points[channel];
        const i = pts.findIndex((p) => Math.abs(p[0] - x) < 8 && Math.abs(p[1] - y) < 8);
        if (i > 0 && i < pts.length - 1) { pts.splice(i, 1); draw(); applyFn(vals); }
      });
      adjustment('Curves', [
        { key: 'channel', label: 'Channel', type: 'select', values: [['rgb', 'RGB'], ['r', 'Red'], ['g', 'Green'], ['b', 'Blue']], value: 'rgb' },
      ], (img, v) => { if (v.channel !== channel) { channel = v.channel; draw(); } PF.adjust.curves(img, luts()); }, {
        content: [cv, el('div', { class: 'note', text: 'Click to add a point, drag to move, double-click to remove.' })],
        init(dlg, snap, apply) { snapData = snap; applyFn = apply; vals = dlg.values; draw(); },
        onReset() { for (const k in points) points[k] = [[0, 0], [255, 255]]; draw(); },
      });
    },
    exposure() {
      adjustment('Exposure', [
        { key: 'exposure', label: 'Exposure (EV)', type: 'range', min: -4, max: 4, step: 0.05, value: 0 },
        { key: 'offset', label: 'Offset', type: 'range', min: -0.5, max: 0.5, step: 0.005, value: 0 },
        { key: 'gammaCorrection', label: 'Gamma', type: 'range', min: 0.1, max: 3, step: 0.01, value: 1 },
      ], (img, v) => PF.adjust.exposure(img, v));
    },
    hsl() {
      adjustment('Hue / Saturation', [
        { key: 'hue', label: 'Hue', type: 'range', min: -180, max: 180, value: 0 },
        { key: 'saturation', label: 'Saturation', type: 'range', min: -100, max: 100, value: 0 },
        { key: 'lightness', label: 'Lightness', type: 'range', min: -100, max: 100, value: 0 },
      ], (img, v) => PF.adjust.hsl(img, v));
    },
    vibrance() {
      adjustment('Vibrance', [{ key: 'vibrance', label: 'Vibrance', type: 'range', min: -100, max: 100, value: 0 }], (img, v) => PF.adjust.vibrance(img, v));
    },
    colorBalance() {
      adjustment('Color Balance', [
        { key: 'temperature', label: 'Temperature', type: 'range', min: -100, max: 100, value: 0 },
        { key: 'tint', label: 'Tint', type: 'range', min: -100, max: 100, value: 0 },
        { key: 'shadows', label: 'Shadows', type: 'range', min: -100, max: 100, value: 0 },
        { key: 'midtones', label: 'Midtones', type: 'range', min: -100, max: 100, value: 0 },
        { key: 'highlights', label: 'Highlights', type: 'range', min: -100, max: 100, value: 0 },
      ], (img, v) => PF.adjust.colorBalance(img, v));
    },
    sepia() { adjustment('Sepia', [{ key: 'amount', label: 'Amount', type: 'range', min: 0, max: 100, value: 100 }], (img, v) => PF.adjust.sepia(img, v)); },
    threshold() { adjustment('Threshold', [{ key: 'level', label: 'Level', type: 'range', min: 1, max: 255, value: 128 }], (img, v) => PF.adjust.threshold(img, v)); },
    posterize() { adjustment('Posterize', [{ key: 'levels', label: 'Levels', type: 'range', min: 2, max: 32, value: 4 }], (img, v) => PF.adjust.posterize(img, v)); },

    gaussianBlur() { adjustment('Gaussian Blur', [{ key: 'radius', label: 'Radius (px)', type: 'range', min: 0, max: 100, step: 0.5, value: 4 }], (img, v) => PF.filters.gaussianBlur(img, v)); },
    boxBlur() { adjustment('Box Blur', [{ key: 'radius', label: 'Radius (px)', type: 'range', min: 0, max: 100, value: 3 }], (img, v) => PF.filters.boxBlur(img, v)); },
    sharpen() { adjustment('Sharpen', [{ key: 'amount', label: 'Amount', type: 'range', min: 0, max: 300, value: 50 }], (img, v) => PF.filters.sharpen(img, v)); },
    unsharpMask() {
      adjustment('Unsharp Mask', [
        { key: 'amount', label: 'Amount %', type: 'range', min: 0, max: 500, value: 100 },
        { key: 'radius', label: 'Radius', type: 'range', min: 0.5, max: 50, step: 0.5, value: 2 },
        { key: 'threshold', label: 'Threshold', type: 'range', min: 0, max: 255, value: 0 },
      ], (img, v) => PF.filters.unsharpMask(img, v));
    },
    emboss() { adjustment('Emboss', [{ key: 'strength', label: 'Strength', type: 'range', min: 0, max: 5, step: 0.1, value: 1 }], (img, v) => PF.filters.emboss(img, v)); },
    noise() {
      adjustment('Add Noise', [
        { key: 'amount', label: 'Amount', type: 'range', min: 0, max: 100, value: 20 },
        { key: 'monochrome', label: 'Monochrome', type: 'checkbox', value: false },
      ], (img, v) => PF.filters.noise(img, v));
    },
    pixelate() { adjustment('Pixelate', [{ key: 'size', label: 'Cell size', type: 'range', min: 2, max: 100, value: 8 }], (img, v) => PF.filters.pixelate(img, v)); },
    vignette() {
      adjustment('Vignette', [
        { key: 'amount', label: 'Amount', type: 'range', min: 0, max: 100, value: 50 },
        { key: 'size', label: 'Size', type: 'range', min: 0, max: 100, value: 50 },
      ], (img, v) => PF.filters.vignette(img, v));
    },
    solarize() { adjustment('Solarize', [{ key: 'threshold', label: 'Threshold', type: 'range', min: 0, max: 255, value: 128 }], (img, v) => PF.filters.solarize(img, v)); },

    /* -------- document dialogs -------- */
    newDoc() {
      const presets = [['custom', 'Custom'], ['1920x1080', 'Full HD 1920 × 1080'], ['1280x720', 'HD 1280 × 720'], ['1080x1080', 'Square 1080 × 1080'], ['1080x1920', 'Story 1080 × 1920'], ['800x600', '800 × 600'], ['2480x3508', 'A4 300dpi 2480 × 3508'], ['3840x2160', '4K 3840 × 2160']];
      const real = open({
        title: 'New Document',
        fields: [
          { key: 'name', label: 'Name', type: 'text', value: 'Untitled' },
          { key: 'preset', label: 'Preset', type: 'select', values: presets, value: '1280x720' },
          { key: 'width', label: 'Width (px)', type: 'number', min: 1, max: 16384, value: 1280 },
          { key: 'height', label: 'Height (px)', type: 'number', min: 1, max: 16384, value: 720 },
          { key: 'bgMode', label: 'Background', type: 'select', values: [['white', 'White'], ['transparent', 'Transparent'], ['bg', 'Background color'], ['fg', 'Foreground color']], value: 'white' },
        ],
        onChange(v, key) {
          if (key === 'preset' && v.preset !== 'custom') { const [w, h] = v.preset.split('x').map(Number); real.inputs.width.set(w); real.inputs.height.set(h); }
          else if (key === 'width' || key === 'height') real.inputs.preset.set('custom');
        },
        okLabel: 'Create',
        onOk(v) {
          const w = U.clamp(Math.round(v.width) || 1, 1, 16384), h = U.clamp(Math.round(v.height) || 1, 1, 16384);
          const d = new PF.Doc(w, h, v.name || 'Untitled');
          const l = d.newLayer('Background');
          if (v.bgMode !== 'transparent') { l.ctx.fillStyle = v.bgMode === 'white' ? '#ffffff' : v.bgMode === 'bg' ? app().state.bg : app().state.fg; l.ctx.fillRect(0, 0, w, h); }
          app().openDocument(d);
        },
      });
      void real;
    },
    imageSize() {
      const d = doc(); if (!d) return;
      const ratio = d.width / d.height;
      let lock = true;
      const dlg = open({
        title: 'Image Size',
        fields: [
          { key: 'width', label: 'Width (px)', type: 'number', min: 1, max: 16384, value: d.width },
          { key: 'height', label: 'Height (px)', type: 'number', min: 1, max: 16384, value: d.height },
          { key: 'percent', label: 'Scale (%)', type: 'number', min: 1, max: 1000, step: 1, value: 100 },
          { key: 'lock', label: 'Constrain proportions', type: 'checkbox', value: true },
          { key: 'smooth', label: 'Resample', type: 'select', values: [['smooth', 'Bicubic (smooth)'], ['nearest', 'Nearest neighbor (hard edges)']], value: 'smooth' },
        ],
        onChange(v, key) {
          lock = v.lock;
          if (key === 'width' && lock) dlg.inputs.height.set(Math.max(1, Math.round(v.width / ratio)));
          if (key === 'height' && lock) dlg.inputs.width.set(Math.max(1, Math.round(v.height * ratio)));
          if (key === 'percent') { dlg.inputs.width.set(Math.max(1, Math.round((d.width * v.percent) / 100))); dlg.inputs.height.set(Math.max(1, Math.round((d.height * v.percent) / 100))); }
          else if (key === 'width' || key === 'height') dlg.inputs.percent.set(Math.round((v.width / d.width) * 100));
        },
        onOk(v) {
          const w = Math.round(v.width), h = Math.round(v.height);
          if (!(w > 0 && h > 0)) return false;
          d.saveState('Image Size'); d.resizeImage(w, h, v.smooth === 'smooth'); app().afterEdit(); app().fitToScreen();
        },
      });
    },
    canvasSize() {
      const d = doc(); if (!d) return;
      let anchor = { ax: 0.5, ay: 0.5 };
      const grid = el('div', { class: 'anchor' });
      const btns = [];
      for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) {
        const b = el('button', { class: x === 1 && y === 1 ? 'on' : '', text: '·', onclick: () => { anchor = { ax: x / 2, ay: y / 2 }; btns.forEach((q) => q.classList.remove('on')); b.classList.add('on'); } });
        btns.push(b); grid.appendChild(b);
      }
      open({
        title: 'Canvas Size',
        fields: [
          { key: 'width', label: 'Width (px)', type: 'number', min: 1, max: 16384, value: d.width },
          { key: 'height', label: 'Height (px)', type: 'number', min: 1, max: 16384, value: d.height },
          { key: 'anchor', label: 'Anchor', type: 'custom', node: el('div', { class: 'row wide' }, [el('label', { text: 'Anchor' }), grid]) },
        ],
        onOk(v) { d.saveState('Canvas Size'); d.resizeCanvas(Math.round(v.width), Math.round(v.height), anchor); app().afterEdit(); app().fitToScreen(); },
      });
    },

    /* -------- export -------- */
    exportAs() {
      const d = doc(); if (!d) return;
      const formats = [['png', 'PNG (lossless, alpha)'], ['jpeg', 'JPEG'], ['webp', 'WebP'], ['bmp', 'BMP (24-bit)'], ['bmp32', 'BMP (32-bit, alpha)'], ['tiff', 'TIFF (uncompressed RGBA)'], ['ico', 'ICO (Windows icon)'], ['pdf', 'PDF (JPEG-embedded)']];
      if (PF.io.supports.avif) formats.splice(3, 0, ['avif', 'AVIF']);
      const note = el('div', { class: 'note', text: '' });
      const preview = el('img', { class: 'preview' });
      let pending = null;
      const update = U.debounce(async (v) => {
        try {
          const blob = await PF.io.exportBlob(d, v);
          pending = blob;
          note.textContent = `${d.width} × ${d.height} px · ${U.fmtBytes(blob.size)} · ${blob.type || v.format}`;
          if (['png', 'jpeg', 'webp', 'avif'].includes(v.format)) { preview.src = URL.createObjectURL(blob); preview.classList.remove('hidden'); } else preview.classList.add('hidden');
        } catch (e) { note.textContent = 'Error: ' + e.message; }
      }, 150);
      const dlg = open({
        title: 'Export As',
        fields: [
          { key: 'name', label: 'File name', type: 'text', value: U.stripExt(d.name) },
          { key: 'format', label: 'Format', type: 'select', values: formats, value: 'png' },
          { key: 'quality', label: 'Quality', type: 'range', min: 1, max: 100, value: 90 },
          { key: 'scale', label: 'Scale (%)', type: 'range', min: 1, max: 400, value: 100 },
          { key: 'icoSize', label: 'Icon size', type: 'select', values: [['16', '16'], ['32', '32'], ['48', '48'], ['64', '64'], ['128', '128'], ['256', '256'], ['multi', 'Multi-size (16-256)']], value: 'multi' },
          { key: 'background', label: 'Background (no-alpha formats)', type: 'color', value: '#ffffff' },
        ],
        content: [note, preview],
        okLabel: 'Download',
        onChange: (v) => update(v),
        onOk(v) { const blob = pending; const name = (v.name || 'image') + '.' + PF.io.extFor(v.format); if (blob) U.download(blob, name); else PF.io.exportBlob(d, v).then((b) => U.download(b, name)); },
      });
      update(dlg.values);
    },
    batchConvert() {
      const formats = [['png', 'PNG'], ['jpeg', 'JPEG'], ['webp', 'WebP'], ['bmp', 'BMP (24-bit)'], ['bmp32', 'BMP (32-bit)'], ['tiff', 'TIFF'], ['ico', 'ICO (256px)'], ['pdf', 'PDF']];
      const input = el('input', { type: 'file', multiple: true, accept: 'image/*,.pxf,.json' });
      const list = el('div', { class: 'filelist', text: 'No files chosen.' });
      const prog = el('progress', { value: 0, max: 1, class: 'hidden' });
      let files = [];
      input.addEventListener('change', () => { files = [...input.files]; list.textContent = files.map((f) => `${f.name} (${U.fmtBytes(f.size)})`).join('\n') || 'No files chosen.'; list.style.whiteSpace = 'pre'; });
      open({
        title: 'Batch Convert',
        fields: [
          { key: 'files', label: 'Files', type: 'custom', node: el('div', { class: 'row wide' }, [el('label', { text: 'Source files' }), input]) },
          { key: 'list', label: '', type: 'custom', node: list },
          { key: 'format', label: 'Target format', type: 'select', values: formats, value: 'png' },
          { key: 'quality', label: 'Quality', type: 'range', min: 1, max: 100, value: 90 },
          { key: 'maxDim', label: 'Max dimension (0 = keep)', type: 'number', min: 0, max: 16384, value: 0 },
          { key: 'background', label: 'Background (no-alpha formats)', type: 'color', value: '#ffffff' },
          { key: 'prog', label: '', type: 'custom', node: prog },
        ],
        okLabel: 'Convert & download ZIP',
        async onOk(v) {
          if (!files.length) { app().toast('Choose files first', true); return false; }
          prog.classList.remove('hidden'); prog.max = files.length; prog.value = 0;
          const out = [];
          for (const f of files) {
            try { out.push(await PF.io.convertFile(f, v)); } catch (e) { app().toast(`${f.name}: ${e.message}`, true); }
            prog.value++;
          }
          if (!out.length) return false;
          if (out.length === 1) U.download(out[0].blob, out[0].name);
          else { const bytes = PF.encoders.zip(await Promise.all(out.map(async (o) => ({ name: o.name, bytes: await U.blobToBytes(o.blob) })))); U.download(new Blob([bytes], { type: 'application/zip' }), 'converted-' + v.format + '.zip'); }
          app().toast(`Converted ${out.length} file(s)`);
        },
      });
    },
    shortcuts() {
      const rows = [
        ['Ctrl+N / Ctrl+O', 'New document / Open images'], ['Ctrl+S', 'Save project (.pxf)'], ['Ctrl+Shift+E', 'Export as…'], ['Ctrl+Z / Ctrl+Y', 'Undo / Redo'],
        ['Ctrl+C / Ctrl+V / Ctrl+X', 'Copy / Paste (also from system clipboard) / Cut'], ['Ctrl+A / Ctrl+D', 'Select all / Deselect'], ['Delete', 'Clear selection'],
        ['Ctrl+T', 'Free transform active layer'], ['Ctrl+J', 'Duplicate layer'], ['Ctrl+E', 'Merge down'], ['Ctrl+Shift+N', 'New layer'], ['Ctrl+] / Ctrl+[', 'Move layer up / down'],
        ['Ctrl+L / Ctrl+M / Ctrl+U', 'Levels / Curves / Hue-Saturation'], ['Ctrl+I', 'Invert'], ['Ctrl+Shift+U', 'Desaturate'],
        ['V M C B E G I T U Z H', 'Tools: Move, Marquee, Crop, Brush, Eraser, Fill, Eyedropper, Text, Shape, Zoom, Hand'],
        ['[ / ]', 'Decrease / increase brush size'], ['X / D', 'Swap colors / default colors'], ['Space + drag', 'Pan'], ['Ctrl + wheel', 'Zoom at cursor'],
        ['Ctrl+0 / Ctrl+1 / Ctrl+= / Ctrl+-', 'Fit / 100% / Zoom in / Zoom out'], ['Arrow keys', 'Nudge layer (Shift = 10px)'], ['Enter / Esc', 'Apply / cancel crop, transform, text'],
      ];
      open({ title: 'Keyboard Shortcuts', fields: [], onCancel: null, content: [el('table', {}, rows.map(([k, v]) => el('tr', {}, [el('td', {}, [el('kbd', { text: k })]), el('td', { text: v })])))] });
    },
    about() {
      open({
        title: 'About Pixelforge', fields: [], onCancel: null,
        content: [el('div', { html: '<p><b>Pixelforge</b> is a free, dependency-free, browser-based image editor inspired by Photoshop and Photopea.</p><p>Everything runs locally in your browser; no files are uploaded anywhere.</p><p>Formats: open PNG, JPEG, GIF, WebP, BMP, SVG, AVIF, ICO (browser-decodable). Export PNG, JPEG, WebP, AVIF*, BMP, TIFF, ICO, PDF, and the native .pxf project format.</p><p class="note">* when the browser supports AVIF encoding.</p>' })],
      });
    },
    confirm(title, message) {
      return new Promise((res) => open({ title, fields: [], content: [el('p', { text: message })], onOk: () => res(true), onCancel: () => res(false) }));
    },
    prompt(title, label, value) {
      return new Promise((res) => open({ title, fields: [{ key: 'v', label, type: 'text', value }], onOk: (v) => res(v.v), onCancel: () => res(null) }));
    },
  };
  PF.dialogs = dialogs;
})();
