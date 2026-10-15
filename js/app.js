/* Pixelforge - application shell: state, view, events, panels, menus, actions */
(function () {
  'use strict';
  const PF = window.PF;
  const U = PF.util;
  const el = U.el;
  const D = () => PF.dialogs;

  const state = {
    docs: [], docIndex: -1, toolId: 'move', toolOpts: {}, fg: '#000000', bg: '#ffffff',
    clipboard: null, checkerboard: true, space: false, cursor: null,
  };
  const $ = (id) => document.getElementById(id);
  let view, vctx, viewport, dpr = 1;
  let antsTimer = null;

  const app = {
    state,
    get doc() { return state.docs[state.docIndex] || null; },
    get tool() { return PF.tools.byId[state.toolId]; },
    opts(toolId) { return state.toolOpts[toolId]; },
    view: {
      docToView(x, y) { const d = app.doc; return { x: x * d.zoom + d.panX, y: y * d.zoom + d.panY }; },
      viewToDoc(vx, vy) { const d = app.doc; return { x: (vx - d.panX) / d.zoom, y: (vy - d.panY) / d.zoom }; },
    },
    toast(msg, isError) {
      const t = $('toast');
      t.textContent = msg; t.classList.toggle('error', !!isError); t.classList.remove('hidden'); t.style.opacity = 1;
      clearTimeout(t._timer);
      t._timer = setTimeout(() => { t.style.opacity = 0; setTimeout(() => t.classList.add('hidden'), 300); }, isError ? 3500 : 2000);
    },
  };
  PF.app = app;

  /* ================= tools / options ================= */
  for (const t of PF.tools.list) {
    state.toolOpts[t.id] = {};
    for (const o of t.options || []) state.toolOpts[t.id][o.key] = o.def;
  }
  app.setTool = function (id) {
    const prev = app.tool;
    if (prev && prev.id !== id && prev.deactivate) prev.deactivate();
    state.toolId = id;
    const t = app.tool;
    document.querySelectorAll('.tool-btn').forEach((b) => b.classList.toggle('active', b.dataset.tool === id));
    if (view) view.style.cursor = t.cursor || 'default';
    if (t.activate) t.activate();
    app.renderOptions();
    app.requestRender();
  };
  app.renderOptions = function () {
    const bar = $('optionsbar');
    bar.innerHTML = '';
    const t = app.tool;
    bar.appendChild(el('span', { class: 'tool-name', text: t.name }));
    const o = state.toolOpts[t.id];
    for (const f of t.options || []) {
      const notify = () => { if (t.onOptionChange) t.onOptionChange(f.key); app.requestRender(); };
      if (f.type === 'range') {
        const val = el('b', { text: o[f.key] });
        const inp = el('input', { type: 'range', min: f.min, max: f.max, step: f.step, value: o[f.key] });
        inp.addEventListener('input', () => { o[f.key] = parseFloat(inp.value); val.textContent = inp.value; notify(); });
        bar.appendChild(el('label', {}, [f.label, inp, val]));
      } else if (f.type === 'number') {
        const inp = el('input', { type: 'number', min: f.min, max: f.max, step: f.step, value: o[f.key] });
        inp.addEventListener('change', () => { o[f.key] = parseFloat(inp.value) || 0; notify(); });
        bar.appendChild(el('label', {}, [f.label, inp]));
      } else if (f.type === 'checkbox') {
        const inp = el('input', { type: 'checkbox' }); inp.checked = !!o[f.key];
        inp.addEventListener('change', () => { o[f.key] = inp.checked; notify(); });
        bar.appendChild(el('label', {}, [inp, f.label]));
      } else if (f.type === 'select') {
        const sel = el('select');
        for (const [v, label] of f.values) sel.appendChild(el('option', { value: v, text: label }));
        sel.value = o[f.key];
        sel.addEventListener('change', () => { o[f.key] = sel.value; notify(); });
        bar.appendChild(el('label', {}, [f.label, sel]));
      } else if (f.type === 'button') {
        bar.appendChild(el('button', { text: f.label, onclick: f.onClick }));
      }
    }
  };
  function buildToolbar() {
    const tb = $('toolbar');
    for (const t of PF.tools.list) {
      if (t.hiddenInToolbar) continue;
      const b = el('div', { class: 'tool-btn', 'data-tool': t.id, title: `${t.name} (${t.key})`, onclick: () => app.setTool(t.id) });
      b.innerHTML = `<svg viewBox="0 0 24 24">${t.icon}</svg><span class="key">${t.key.replace('Shift+', '⇧')}</span>`;
      tb.appendChild(b);
    }
    const colors = el('div', { id: 'colors' });
    const fgSw = el('div', { class: 'swatch', id: 'fg', title: 'Foreground color' });
    const bgSw = el('div', { class: 'swatch', id: 'bg', title: 'Background color' });
    const fgIn = el('input', { type: 'color', value: state.fg }); const bgIn = el('input', { type: 'color', value: state.bg });
    fgIn.addEventListener('input', () => app.setColors(fgIn.value, null)); bgIn.addEventListener('input', () => app.setColors(null, bgIn.value));
    fgSw.appendChild(fgIn); bgSw.appendChild(bgIn); colors.appendChild(bgSw); colors.appendChild(fgSw);
    tb.appendChild(colors);
    tb.appendChild(el('button', { id: 'swapColors', title: 'Swap colors (X)', text: '⇄', onclick: () => app.setColors(state.bg, state.fg) }));
    tb.appendChild(el('button', { id: 'defaultColors', title: 'Default colors (D)', text: 'D', onclick: () => app.setColors('#000000', '#ffffff') }));
    app.setColors(state.fg, state.bg);
  }
  app.setColors = function (fg, bg) {
    if (fg) state.fg = fg; if (bg) state.bg = bg;
    const f = $('fg'), b = $('bg');
    if (f) { f.style.background = state.fg; f.querySelector('input').value = state.fg; }
    if (b) { b.style.background = state.bg; b.querySelector('input').value = state.bg; }
    if (app.tool.onOptionChange) app.tool.onOptionChange('color');
    app.requestRender();
  };

  /* ================= view / rendering ================= */
  let checker = null;
  function checkerPattern() {
    if (checker) return checker;
    const c = U.createCanvas(16, 16), ctx = c.getContext('2d');
    ctx.fillStyle = '#4a4a4a'; ctx.fillRect(0, 0, 16, 16);
    ctx.fillStyle = '#6a6a6a'; ctx.fillRect(0, 0, 8, 8); ctx.fillRect(8, 8, 8, 8);
    checker = vctx.createPattern(c, 'repeat');
    return checker;
  }
  function resizeView() {
    dpr = window.devicePixelRatio || 1;
    const r = viewport.getBoundingClientRect();
    view.width = Math.max(1, Math.round(r.width * dpr)); view.height = Math.max(1, Math.round(r.height * dpr));
    app.requestRender();
  }
  function draw() {
    const d = app.doc;
    vctx.setTransform(1, 0, 0, 1, 0, 0);
    vctx.clearRect(0, 0, view.width, view.height);
    $('empty').classList.toggle('hidden', !!d);
    if (!d) return;
    vctx.scale(dpr, dpr);
    const t = app.tool;
    const p0 = app.view.docToView(0, 0);
    const w = d.width * d.zoom, h = d.height * d.zoom;
    if (state.checkerboard) { vctx.fillStyle = checkerPattern(); vctx.fillRect(p0.x, p0.y, w, h); }
    else { vctx.fillStyle = '#000'; vctx.fillRect(p0.x, p0.y, w, h); }
    const comp = d.render(t.previewLayer ? (l) => t.previewLayer(l) : null);
    vctx.imageSmoothingEnabled = d.zoom < 1;
    vctx.imageSmoothingQuality = 'high';
    vctx.drawImage(comp, p0.x, p0.y, w, h);
    vctx.strokeStyle = 'rgba(255,255,255,.25)'; vctx.lineWidth = 1; vctx.strokeRect(p0.x - .5, p0.y - .5, w + 1, h + 1);
    if (d.selection && d.selection.w > 0 && d.selection.h > 0) {
      const s = d.selection, a = app.view.docToView(s.x, s.y), b = app.view.docToView(s.x + s.w, s.y + s.h);
      vctx.save(); vctx.lineWidth = 1;
      vctx.strokeStyle = '#000'; vctx.strokeRect(a.x + .5, a.y + .5, b.x - a.x, b.y - a.y);
      vctx.strokeStyle = '#fff'; vctx.setLineDash([5, 5]); vctx.lineDashOffset = -((Date.now() / 60) % 10);
      vctx.strokeRect(a.x + .5, a.y + .5, b.x - a.x, b.y - a.y); vctx.restore();
    }
    if (t.drawOverlay) t.drawOverlay(vctx, app.view);
    if (t.drawCursor && state.cursor && state.cursor.inside) t.drawCursor(vctx, state.cursor.view, d.zoom);
    updateHistogram();
  }
  app.requestRender = U.throttleRAF(draw);
  app.onViewChange = function () { if (app.tool.onViewChange) app.tool.onViewChange(); app.requestRender(); updateStatus(); };
  app.setZoom = function (z, anchor) {
    const d = app.doc; if (!d) return;
    z = U.clamp(z, 0.02, 64);
    const r = viewport.getBoundingClientRect();
    const av = anchor || { x: r.width / 2, y: r.height / 2 };
    const before = app.view.viewToDoc(av.x, av.y);
    d.zoom = z;
    d.panX = av.x - before.x * z; d.panY = av.y - before.y * z;
    app.onViewChange();
  };
  app.zoomAt = function (factor, docPt) {
    const v = app.view.docToView(docPt.x, docPt.y);
    app.setZoom(app.doc.zoom * factor, v);
  };
  app.fitToScreen = function () {
    const d = app.doc; if (!d) return;
    const r = viewport.getBoundingClientRect();
    const z = Math.min((r.width - 40) / d.width, (r.height - 40) / d.height);
    d.zoom = U.clamp(z, 0.02, 8);
    d.panX = (r.width - d.width * d.zoom) / 2; d.panY = (r.height - d.height * d.zoom) / 2;
    app.onViewChange();
  };
  const ZOOM_STEPS = [0.05, 0.1, 0.15, 0.25, 0.33, 0.5, 0.67, 1, 1.5, 2, 3, 4, 6, 8, 12, 16, 24, 32];
  function stepZoom(dir) {
    const d = app.doc; if (!d) return;
    const z = d.zoom;
    const next = dir > 0 ? ZOOM_STEPS.find((s) => s > z + 1e-6) : [...ZOOM_STEPS].reverse().find((s) => s < z - 1e-6);
    if (next) app.setZoom(next);
  }

  /* ================= pointer events ================= */
  function bindView() {
    let panning = null, down = false;
    const toDoc = (e) => { const r = view.getBoundingClientRect(); const vx = e.clientX - r.left, vy = e.clientY - r.top; return { view: { x: vx, y: vy }, doc: app.view.viewToDoc(vx, vy) }; };
    view.addEventListener('pointerdown', (e) => {
      if (!app.doc) return;
      view.setPointerCapture(e.pointerId);
      const p = toDoc(e);
      if (state.space || e.button === 1) { panning = { x: e.clientX, y: e.clientY, px: app.doc.panX, py: app.doc.panY }; return; }
      if (e.button !== 0) return;
      down = true;
      if (app.tool.down) app.tool.down(p.doc, e);
      app.requestRender();
    });
    view.addEventListener('pointermove', (e) => {
      if (!app.doc) return;
      const p = toDoc(e);
      state.cursor = { view: p.view, doc: p.doc, inside: true };
      if (panning) { app.doc.panX = panning.px + e.clientX - panning.x; app.doc.panY = panning.py + e.clientY - panning.y; app.onViewChange(); return; }
      if (down && app.tool.move) app.tool.move(p.doc, e);
      updateStatus();
      if (app.tool.drawCursor || down) app.requestRender();
    });
    const end = (e) => {
      if (panning) { panning = null; return; }
      if (!down) return;
      down = false;
      if (app.doc && app.tool.up) app.tool.up(toDoc(e).doc, e);
      app.requestRender();
    };
    view.addEventListener('pointerup', end);
    view.addEventListener('pointercancel', end);
    view.addEventListener('pointerleave', () => { state.cursor = null; app.requestRender(); });
    view.addEventListener('wheel', (e) => {
      if (!app.doc) return;
      e.preventDefault();
      const r = view.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) {
        const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
        app.setZoom(app.doc.zoom * factor, { x: e.clientX - r.left, y: e.clientY - r.top });
      } else {
        app.doc.panX -= e.shiftKey ? e.deltaY : e.deltaX; app.doc.panY -= e.shiftKey ? 0 : e.deltaY;
        app.onViewChange();
      }
    }, { passive: false });
    view.addEventListener('contextmenu', (e) => e.preventDefault());
    view.addEventListener('dblclick', () => { if (app.tool.id === 'hand') app.fitToScreen(); });
  }

  /* ================= documents ================= */
  app.openDocument = function (doc) {
    state.docs.push(doc);
    state.docIndex = state.docs.length - 1;
    app.fitToScreen();
    app.updateAll();
  };
  app.switchDocument = function (i) {
    if (i < 0 || i >= state.docs.length) return;
    if (app.tool.cancel) app.tool.cancel();
    state.docIndex = i;
    if (app.tool.activate) app.tool.activate();
    app.updateAll(); app.onViewChange();
  };
  app.closeDocument = async function (i) {
    const d = state.docs[i]; if (!d) return;
    if (d.modified && !(await D().confirm('Close document', `"${d.name}" has unsaved changes. Close anyway?`))) return;
    state.docs.splice(i, 1);
    state.docIndex = Math.min(state.docIndex, state.docs.length - 1);
    app.updateAll(); app.requestRender();
  };
  app.openFiles = async function (files, asLayer) {
    for (const f of files) {
      try {
        if (asLayer && app.doc) {
          if (PF.io.isProjectFile(f)) { const p = await PF.io.loadProject(await U.readFileAsText(f), f.name); const d = app.doc; d.saveState('Place project layers'); for (const l of p.layers) d.addLayer(l); app.afterEdit(); }
          else { const img = await U.loadImageFile(f); app.addImageAsLayer(img, U.stripExt(f.name)); }
        } else app.openDocument(await PF.io.docFromFile(f));
      } catch (e) { app.toast(`${f.name}: ${e.message}`, true); }
    }
  };
  app.addImageAsLayer = function (img, name) {
    const d = app.doc; if (!d) { app.openDocument(PF.io.docFromImage(img, name)); return; }
    d.saveState('Place image');
    const l = d.newLayer(name || 'Placed image');
    const w = img.width || img.naturalWidth, h = img.height || img.naturalHeight;
    const k = Math.min(1, d.width / w, d.height / h);
    l.ctx.drawImage(img, (d.width - w * k) / 2, (d.height - h * k) / 2, w * k, h * k);
    if (img.close) img.close();
    app.afterEdit();
  };
  function pickFiles(multiple, accept) {
    return new Promise((res) => {
      const inp = el('input', { type: 'file', accept: accept || 'image/*,.pxf,.json', multiple });
      inp.addEventListener('change', () => res([...inp.files]));
      inp.click();
    });
  }
  app.afterEdit = function () {
    const d = app.doc; if (d) { d.modified = true; d.invalidate(); }
    app.requestRender(); app.updatePanels();
  };
  app.updateAll = function () { renderTabs(); app.updatePanels(); updateStatus(); app.requestRender(); };

  /* ================= panels ================= */
  function renderTabs() {
    const tabs = $('tabs'); tabs.innerHTML = '';
    state.docs.forEach((d, i) => {
      const t = el('div', { class: 'tab' + (i === state.docIndex ? ' active' : ''), onclick: () => app.switchDocument(i) }, [
        el('span', { text: (d.modified ? '• ' : '') + d.name }),
        el('span', { class: 'close', text: '×', title: 'Close', onclick: (e) => { e.stopPropagation(); app.closeDocument(i); } }),
      ]);
      tabs.appendChild(t);
    });
  }
  function layerThumb(l, d) {
    const c = U.createCanvas(44, 34), ctx = c.getContext('2d');
    const k = Math.min(44 / d.width, 34 / d.height);
    ctx.drawImage(l.canvas, (44 - d.width * k) / 2 + l.x * k, (34 - d.height * k) / 2 + l.y * k, l.width * k, l.height * k);
    c.className = 'thumb';
    return c;
  }
  function renderLayers() {
    const d = app.doc;
    const list = $('layerList'); list.innerHTML = '';
    const blend = $('layerBlend'), op = $('layerOpacity'), opv = $('layerOpacityVal');
    if (!d || !d.active) { blend.disabled = op.disabled = true; return; }
    blend.disabled = op.disabled = false;
    blend.value = d.active.blend; op.value = Math.round(d.active.opacity * 100); opv.textContent = op.value + '%';
    for (let i = d.layers.length - 1; i >= 0; i--) {
      const l = d.layers[i];
      const row = el('li', { class: 'layer-row' + (l.id === d.activeId ? ' active' : ''), draggable: true, 'data-index': i });
      const eye = el('span', { class: 'eye' + (l.visible ? '' : ' off'), text: '👁', title: 'Toggle visibility', onclick: (e) => { e.stopPropagation(); d.saveState('Toggle visibility'); l.visible = !l.visible; app.afterEdit(); } });
      const name = el('span', { class: 'name', text: l.name, title: 'Double-click to rename' });
      name.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        const inp = el('input', { type: 'text', value: l.name });
        name.textContent = ''; name.appendChild(inp); inp.focus(); inp.select();
        const done = () => { if (inp.value.trim()) l.name = inp.value.trim(); app.updatePanels(); };
        inp.addEventListener('blur', done);
        inp.addEventListener('keydown', (ev) => { ev.stopPropagation(); if (ev.key === 'Enter') inp.blur(); if (ev.key === 'Escape') { inp.value = l.name; inp.blur(); } });
      });
      const lock = el('span', { class: 'lock' + (l.locked ? ' on' : ''), text: '🔒', title: 'Lock / unlock', onclick: (e) => { e.stopPropagation(); l.locked = !l.locked; app.updatePanels(); } });
      row.appendChild(eye); row.appendChild(layerThumb(l, d)); row.appendChild(name); row.appendChild(lock);
      row.addEventListener('click', () => { d.activeId = l.id; app.updatePanels(); });
      row.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', String(i)); e.dataTransfer.effectAllowed = 'move'; });
      row.addEventListener('dragover', (e) => { e.preventDefault(); row.classList.add('dragover'); });
      row.addEventListener('dragleave', () => row.classList.remove('dragover'));
      row.addEventListener('drop', (e) => {
        e.preventDefault(); row.classList.remove('dragover');
        const from = parseInt(e.dataTransfer.getData('text/plain'), 10);
        if (!isNaN(from) && from !== i) { d.saveState('Reorder layers'); d.moveLayer(from, i); app.afterEdit(); }
      });
      list.appendChild(row);
    }
  }
  function renderHistory() {
    const d = app.doc, ul = $('historyList'); ul.innerHTML = '';
    if (!d) return;
    ul.appendChild(el('li', { text: 'Open' }));
    d.history.forEach((h) => ul.appendChild(el('li', { text: h.label })));
    ul.appendChild(el('li', { class: 'current', text: '▸ Current state' }));
    [...d.future].reverse().forEach((f) => ul.appendChild(el('li', { text: f.label + ' (redo)', style: { opacity: .5 } })));
    ul.scrollTop = ul.scrollHeight;
  }
  const updateHistogram = U.debounce(() => {
    const d = app.doc, c = $('histogram'); if (!c) return;
    if (!d) { c.getContext('2d').clearRect(0, 0, c.width, c.height); return; }
    if ($('histogramPanel').classList.contains('collapsed')) return;
    D().drawHistogram(c, PF.adjust.histogram(d.compositeCtx.getImageData(0, 0, d.width, d.height)));
  }, 250);
  function updateStatus() {
    const d = app.doc;
    $('stZoom').textContent = d ? Math.round(d.zoom * 100) + '%' : '';
    $('stSize').textContent = d ? `${d.width} × ${d.height} px` : 'No document';
    let pos = '';
    if (d && state.cursor) {
      const x = Math.floor(state.cursor.doc.x), y = Math.floor(state.cursor.doc.y);
      pos = `X: ${x}  Y: ${y}`;
      if (x >= 0 && y >= 0 && x < d.width && y < d.height) {
        const px = d.compositeCtx.getImageData(x, y, 1, 1).data;
        pos += `   RGBA(${px[0]}, ${px[1]}, ${px[2]}, ${px[3]})  ${U.rgbToHex(px[0], px[1], px[2])}`;
      }
    }
    $('stPos').textContent = pos;
    $('stSel').textContent = d && d.selection ? `Selection: ${d.selection.w} × ${d.selection.h} at (${d.selection.x}, ${d.selection.y})` : '';
    const info = $('infoBody');
    if (info) {
      info.innerHTML = d
        ? `Document: <b>${d.name}</b><br>Size: <b>${d.width} × ${d.height}</b><br>Layers: <b>${d.layers.length}</b> · Active: <b>${d.active ? d.active.name : '—'}</b><br>Zoom: <b>${Math.round(d.zoom * 100)}%</b><br>${pos ? pos.replace(/ {2,}/g, '<br>') : ''}`
        : 'Open or create a document.';
    }
    if (d && d.selection && !antsTimer) antsTimer = setInterval(() => app.requestRender(), 100);
    if ((!d || !d.selection) && antsTimer) { clearInterval(antsTimer); antsTimer = null; }
  }
  app.updatePanels = function () { renderLayers(); renderHistory(); renderTabs(); updateStatus(); app.requestRender(); };

  function buildPanels() {
    const blend = $('layerBlend');
    for (const [v, label] of PF.BLEND_MODES) blend.appendChild(el('option', { value: v, text: label }));
    blend.addEventListener('change', () => { const d = app.doc; if (d && d.active) { d.saveState('Blend mode'); d.active.blend = blend.value; app.afterEdit(); } });
    const op = $('layerOpacity');
    let opSaved = false;
    op.addEventListener('input', () => { const d = app.doc; if (d && d.active) { if (!opSaved) { d.saveState('Layer opacity'); opSaved = true; } d.active.opacity = op.value / 100; $('layerOpacityVal').textContent = op.value + '%'; d.invalidate(); d.modified = true; app.requestRender(); } });
    op.addEventListener('change', () => { opSaved = false; app.updatePanels(); });
    document.querySelectorAll('.panel > h3').forEach((h) => h.addEventListener('click', () => { h.parentElement.classList.toggle('collapsed'); updateHistogram(); }));
    const btns = $('layerButtons');
    const mk = (label, title, action) => btns.appendChild(el('button', { text: label, title, onclick: () => run(action) }));
    mk('＋', 'New layer (Ctrl+Shift+N)', 'layerNew'); mk('⧉', 'Duplicate (Ctrl+J)', 'layerDuplicate'); mk('▲', 'Move up (Ctrl+])', 'layerUp'); mk('▼', 'Move down (Ctrl+[)', 'layerDown');
    mk('⤓', 'Merge down (Ctrl+E)', 'layerMergeDown'); mk('🗑', 'Delete layer', 'layerDelete');
  }

  /* ================= actions ================= */
  function withLayer(label, fn) {
    const d = app.doc; if (!d) return app.toast('No document open', true);
    const l = d.active; if (!l) return app.toast('No layer selected', true);
    if (l.locked) return app.toast('Layer is locked', true);
    d.saveState(label); fn(d, l); app.afterEdit();
  }
  /** Apply a pixel function to the active layer within the selection. */
  function applyPixels(label, fn) {
    withLayer(label, (d, l) => {
      PF.Doc.bakeOffset(l);
      const r = d.selectionRect();
      const img = l.ctx.getImageData(r.x, r.y, r.w, r.h);
      fn(img); l.ctx.putImageData(img, r.x, r.y);
    });
  }
  function needDoc(fn) { return () => { if (!app.doc) return app.toast('No document open', true); fn(app.doc); }; }
  function copySelection(cut) {
    const d = app.doc; if (!d || !d.active) return;
    const l = d.active;
    PF.Doc.bakeOffset(l);
    const r = d.selection ? d.selectionRect() : U.opaqueBounds(l.canvas) || { x: 0, y: 0, w: d.width, h: d.height };
    const c = U.createCanvas(r.w, r.h);
    c.getContext('2d').drawImage(l.canvas, -r.x, -r.y);
    state.clipboard = { canvas: c, x: r.x, y: r.y };
    if (navigator.clipboard && window.ClipboardItem) {
      U.canvasToBlob(c, 'image/png').then((b) => navigator.clipboard.write([new ClipboardItem({ 'image/png': b })])).catch(() => { });
    }
    if (cut) withLayer('Cut', () => l.ctx.clearRect(r.x, r.y, r.w, r.h));
    app.toast(cut ? 'Cut to clipboard' : 'Copied');
  }
  function pasteInternal() {
    const cb = state.clipboard; if (!cb) return app.toast('Clipboard is empty', true);
    const d = app.doc;
    if (!d) { const nd = PF.io.docFromImage(cb.canvas, 'Pasted'); app.openDocument(nd); return; }
    d.saveState('Paste');
    const l = d.newLayer('Pasted layer');
    l.ctx.drawImage(cb.canvas, cb.x, cb.y);
    app.afterEdit();
  }

  const actions = {
    new: () => D().newDoc(),
    open: async () => app.openFiles(await pickFiles(true)),
    openAsLayer: async () => app.openFiles(await pickFiles(true), true),
    saveProject: needDoc((d) => { U.download(PF.io.saveProject(d), U.stripExt(d.name) + '.pxf'); d.modified = false; app.updatePanels(); app.toast('Project saved'); }),
    exportAs: needDoc(() => D().exportAs()),
    quickPng: needDoc(async (d) => U.download(await PF.io.exportBlob(d, { format: 'png' }), U.stripExt(d.name) + '.png')),
    batchConvert: () => D().batchConvert(),
    close: needDoc(() => app.closeDocument(state.docIndex)),

    undo: needDoc((d) => { if (app.tool.cancel) app.tool.cancel(); const l = d.undo(); if (l) { app.toast('Undo: ' + l); app.afterEdit(); } }),
    redo: needDoc((d) => { const l = d.redo(); if (l) { app.toast('Redo: ' + l); app.afterEdit(); } }),
    cut: () => copySelection(true),
    copy: () => copySelection(false),
    paste: () => pasteInternal(),
    clear: () => withLayer('Clear', (d, l) => { const r = d.selectionRect(); l.ctx.clearRect(r.x - l.x, r.y - l.y, r.w, r.h); }),
    fillFg: () => withLayer('Fill', (d, l) => { const r = d.selectionRect(); l.ctx.fillStyle = state.fg; l.ctx.fillRect(r.x - l.x, r.y - l.y, r.w, r.h); }),
    fillBg: () => withLayer('Fill', (d, l) => { const r = d.selectionRect(); l.ctx.fillStyle = state.bg; l.ctx.fillRect(r.x - l.x, r.y - l.y, r.w, r.h); }),
    transform: needDoc(() => app.setTool('transform')),

    imageSize: needDoc(() => D().imageSize()),
    canvasSize: needDoc(() => D().canvasSize()),
    cropToSelection: needDoc((d) => { if (!d.selection) return app.toast('Make a selection first', true); d.saveState('Crop'); d.crop(d.selection); app.afterEdit(); app.fitToScreen(); }),
    trim: needDoc((d) => { const b = U.opaqueBounds(d.render()); if (!b) return app.toast('Image is empty', true); d.saveState('Trim'); d.crop(b); app.afterEdit(); app.fitToScreen(); }),
    rotate90: needDoc((d) => { d.saveState('Rotate 90° CW'); d.rotate(90); app.afterEdit(); app.fitToScreen(); }),
    rotate270: needDoc((d) => { d.saveState('Rotate 90° CCW'); d.rotate(-90); app.afterEdit(); app.fitToScreen(); }),
    rotate180: needDoc((d) => { d.saveState('Rotate 180°'); d.rotate(180); app.afterEdit(); }),
    flipH: needDoc((d) => { d.saveState('Flip Horizontal'); d.flip(true); app.afterEdit(); }),
    flipV: needDoc((d) => { d.saveState('Flip Vertical'); d.flip(false); app.afterEdit(); }),

    brightnessContrast: needDoc(() => D().brightnessContrast()),
    levels: needDoc(() => D().levels()),
    curves: needDoc(() => D().curves()),
    gamma: needDoc(() => D().gamma()),
    exposure: needDoc(() => D().exposure()),
    hsl: needDoc(() => D().hsl()),
    vibrance: needDoc(() => D().vibrance()),
    colorBalance: needDoc(() => D().colorBalance()),
    sepia: needDoc(() => D().sepia()),
    threshold: needDoc(() => D().threshold()),
    posterize: needDoc(() => D().posterize()),
    invert: () => applyPixels('Invert', (img) => PF.adjust.invert(img)),
    grayscale: () => applyPixels('Desaturate', (img) => PF.adjust.grayscale(img)),
    autoLevels: () => applyPixels('Auto Levels', (img) => PF.adjust.autoLevels(img)),
    autoContrast: () => applyPixels('Auto Contrast', (img) => PF.adjust.autoContrast(img)),

    gaussianBlur: needDoc(() => D().gaussianBlur()), boxBlur: needDoc(() => D().boxBlur()), sharpen: needDoc(() => D().sharpen()),
    unsharpMask: needDoc(() => D().unsharpMask()), emboss: needDoc(() => D().emboss()), noise: needDoc(() => D().noise()),
    pixelate: needDoc(() => D().pixelate()), vignette: needDoc(() => D().vignette()), solarize: needDoc(() => D().solarize()),
    findEdges: () => applyPixels('Find Edges', (img) => PF.filters.findEdges(img)),

    layerNew: needDoc((d) => { d.saveState('New Layer'); d.newLayer(); app.afterEdit(); }),
    layerDuplicate: needDoc((d) => { if (!d.active) return; d.saveState('Duplicate Layer'); d.duplicateLayer(d.active); app.afterEdit(); }),
    layerDelete: needDoc((d) => { if (!d.active) return; if (d.layers.length === 1) return app.toast('Cannot delete the only layer', true); d.saveState('Delete Layer'); d.removeLayer(d.active); app.afterEdit(); }),
    layerRename: needDoc(async (d) => { if (!d.active) return; const n = await D().prompt('Rename Layer', 'Name', d.active.name); if (n && n.trim()) { d.active.name = n.trim(); app.updatePanels(); } }),
    layerMergeDown: needDoc((d) => { if (!d.active) return; if (d.activeIndex === 0) return app.toast('No layer below', true); d.saveState('Merge Down'); d.mergeDown(d.active); app.afterEdit(); }),
    layerMergeVisible: needDoc((d) => { d.saveState('Merge Visible'); if (!d.mergeVisible()) d.discardState(); app.afterEdit(); }),
    layerFlatten: needDoc((d) => { d.saveState('Flatten Image'); d.flatten(); app.afterEdit(); }),
    layerUp: needDoc((d) => { const i = d.activeIndex; if (i < d.layers.length - 1) { d.saveState('Layer Up'); d.moveLayer(i, i + 1); app.afterEdit(); } }),
    layerDown: needDoc((d) => { const i = d.activeIndex; if (i > 0) { d.saveState('Layer Down'); d.moveLayer(i, i - 1); app.afterEdit(); } }),
    layerFlipH: () => withLayer('Flip Layer Horizontal', (d, l) => PF.Doc.flipLayer(l, true, d.width, d.height)),
    layerFlipV: () => withLayer('Flip Layer Vertical', (d, l) => PF.Doc.flipLayer(l, false, d.width, d.height)),
    layerRotate90: () => withLayer('Rotate Layer 90°', (d, l) => PF.Doc.rotateLayer(l, 90, d.width, d.height)),
    layerRotate180: () => withLayer('Rotate Layer 180°', (d, l) => PF.Doc.rotateLayer(l, 180, d.width, d.height)),
    layerToggleLock: needDoc((d) => { if (d.active) { d.active.locked = !d.active.locked; app.updatePanels(); } }),
    layerToggleVisible: needDoc((d) => { if (d.active) { d.saveState('Toggle visibility'); d.active.visible = !d.active.visible; app.afterEdit(); } }),
    layerFromSelection: needDoc((d) => {
      const l = d.active; if (!l) return;
      const r = d.selectionRect(); d.saveState('Layer via Copy');
      const n = d.newLayer(l.name + ' copy'); n.ctx.drawImage(l.canvas, l.x, l.y);
      const c = U.createCanvas(d.width, d.height); c.getContext('2d').drawImage(n.canvas, r.x, r.y, r.w, r.h, r.x, r.y, r.w, r.h); n.setCanvas(c);
      app.afterEdit();
    }),

    selectAll: needDoc((d) => { d.selection = { x: 0, y: 0, w: d.width, h: d.height }; app.updatePanels(); }),
    deselect: needDoc((d) => { d.selection = null; app.updatePanels(); }),
    selectLayerBounds: needDoc((d) => { if (!d.active) return; const b = U.opaqueBounds(d.active.canvas); d.selection = b ? U.clipRect({ x: b.x + d.active.x, y: b.y + d.active.y, w: b.w, h: b.h }, d.width, d.height) : null; app.updatePanels(); }),

    zoomIn: () => stepZoom(1), zoomOut: () => stepZoom(-1), zoomFit: () => app.fitToScreen(), zoom100: () => app.setZoom(1),
    toggleChecker: () => { state.checkerboard = !state.checkerboard; app.requestRender(); },
    shortcuts: () => D().shortcuts(), about: () => D().about(),
  };
  function run(id) { const a = actions[id]; if (a) a(); }
  app.run = run;

  const menus = [
    ['File', [['New…', 'Ctrl+N', 'new'], ['Open…', 'Ctrl+O', 'open'], ['Open as Layer (Place)…', '', 'openAsLayer'], '-', ['Save Project (.pxf)', 'Ctrl+S', 'saveProject'], ['Export As…', 'Ctrl+Shift+E', 'exportAs'], ['Quick Export as PNG', '', 'quickPng'], ['Batch Convert…', '', 'batchConvert'], '-', ['Close', 'Ctrl+W', 'close']]],
    ['Edit', [['Undo', 'Ctrl+Z', 'undo'], ['Redo', 'Ctrl+Y', 'redo'], '-', ['Cut', 'Ctrl+X', 'cut'], ['Copy', 'Ctrl+C', 'copy'], ['Paste', 'Ctrl+V', 'paste'], ['Clear', 'Delete', 'clear'], '-', ['Fill with Foreground', 'Alt+Backspace', 'fillFg'], ['Fill with Background', 'Ctrl+Backspace', 'fillBg'], '-', ['Free Transform', 'Ctrl+T', 'transform']]],
    ['Image', [['Image Size…', 'Ctrl+Alt+I', 'imageSize'], ['Canvas Size…', 'Ctrl+Alt+C', 'canvasSize'], ['Crop to Selection', '', 'cropToSelection'], ['Trim Transparent Edges', '', 'trim'], '-', ['Rotate 90° Clockwise', '', 'rotate90'], ['Rotate 90° Counter-clockwise', '', 'rotate270'], ['Rotate 180°', '', 'rotate180'], ['Flip Horizontal', '', 'flipH'], ['Flip Vertical', '', 'flipV']]],
    ['Adjust', [['Brightness / Contrast…', '', 'brightnessContrast'], ['Levels…', 'Ctrl+L', 'levels'], ['Curves…', 'Ctrl+M', 'curves'], ['Gamma…', 'Ctrl+G', 'gamma'], ['Exposure…', '', 'exposure'], '-', ['Hue / Saturation…', 'Ctrl+U', 'hsl'], ['Vibrance…', '', 'vibrance'], ['Color Balance…', 'Ctrl+B', 'colorBalance'], ['Sepia…', '', 'sepia'], '-', ['Invert', 'Ctrl+I', 'invert'], ['Desaturate', 'Ctrl+Shift+U', 'grayscale'], ['Threshold…', '', 'threshold'], ['Posterize…', '', 'posterize'], '-', ['Auto Levels', 'Ctrl+Shift+L', 'autoLevels'], ['Auto Contrast', 'Ctrl+Alt+Shift+L', 'autoContrast']]],
    ['Layer', [['New Layer', 'Ctrl+Shift+N', 'layerNew'], ['Duplicate Layer', 'Ctrl+J', 'layerDuplicate'], ['Layer via Copy (selection)', 'Ctrl+Shift+J', 'layerFromSelection'], ['Delete Layer', '', 'layerDelete'], ['Rename Layer…', '', 'layerRename'], '-', ['Move Up', 'Ctrl+]', 'layerUp'], ['Move Down', 'Ctrl+[', 'layerDown'], ['Toggle Visibility', '', 'layerToggleVisible'], ['Lock / Unlock', 'Ctrl+/', 'layerToggleLock'], '-', ['Flip Layer Horizontal', '', 'layerFlipH'], ['Flip Layer Vertical', '', 'layerFlipV'], ['Rotate Layer 90°', '', 'layerRotate90'], ['Rotate Layer 180°', '', 'layerRotate180'], '-', ['Merge Down', 'Ctrl+E', 'layerMergeDown'], ['Merge Visible', 'Ctrl+Shift+E', 'layerMergeVisible'], ['Flatten Image', '', 'layerFlatten']]],
    ['Select', [['All', 'Ctrl+A', 'selectAll'], ['Deselect', 'Ctrl+D', 'deselect'], ['Select Layer Contents', 'Ctrl+Shift+A', 'selectLayerBounds'], '-', ['Crop to Selection', '', 'cropToSelection']]],
    ['Filter', [['Gaussian Blur…', '', 'gaussianBlur'], ['Box Blur…', '', 'boxBlur'], '-', ['Sharpen…', '', 'sharpen'], ['Unsharp Mask…', '', 'unsharpMask'], '-', ['Emboss…', '', 'emboss'], ['Find Edges', '', 'findEdges'], ['Solarize…', '', 'solarize'], '-', ['Add Noise…', '', 'noise'], ['Pixelate…', '', 'pixelate'], ['Vignette…', '', 'vignette']]],
    ['View', [['Zoom In', 'Ctrl+=', 'zoomIn'], ['Zoom Out', 'Ctrl+-', 'zoomOut'], ['Fit to Screen', 'Ctrl+0', 'zoomFit'], ['Actual Pixels (100%)', 'Ctrl+1', 'zoom100'], '-', ['Toggle Transparency Checkerboard', '', 'toggleChecker']]],
    ['Help', [['Keyboard Shortcuts', 'F1', 'shortcuts'], ['About Pixelforge', '', 'about']]],
  ];
  // Export As wins the Ctrl+Shift+E shortcut; Merge Visible is menu-only.
  const shortcutMap = {};
  function buildMenus() {
    const bar = $('menubar');
    let openMenu = null;
    const closeAll = () => { document.querySelectorAll('.menu.open').forEach((m) => m.classList.remove('open')); openMenu = null; };
    for (const [label, items] of menus) {
      const dd = el('div', { class: 'dropdown' });
      for (const it of items) {
        if (it === '-') { dd.appendChild(el('div', { class: 'sep' })); continue; }
        const [text, sc, action] = it;
        if (sc && !shortcutMap[sc]) shortcutMap[sc] = action;
        dd.appendChild(el('div', { class: 'item', onclick: () => { closeAll(); run(action); } }, [el('span', { text }), el('span', { class: 'sc', text: sc.replace('Ctrl', U.isMac ? '⌘' : 'Ctrl') })]));
      }
      const m = el('div', { class: 'menu' }, [el('div', { class: 'label', text: label }), dd]);
      m.querySelector('.label').addEventListener('click', (e) => { e.stopPropagation(); const was = m.classList.contains('open'); closeAll(); if (!was) { m.classList.add('open'); openMenu = m; } });
      m.querySelector('.label').addEventListener('mouseenter', () => { if (openMenu && openMenu !== m) { closeAll(); m.classList.add('open'); openMenu = m; } });
      bar.appendChild(m);
    }
    document.addEventListener('click', closeAll);
  }

  /* ================= keyboard ================= */
  function comboOf(e) {
    let k = e.key;
    if (k === ' ') k = 'Space';
    else if (k.length === 1) k = k.toUpperCase();
    if (k === '+') k = '=';
    const parts = [];
    if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
    if (e.altKey) parts.push('Alt');
    if (e.shiftKey) parts.push('Shift');
    parts.push(k);
    return parts.join('+');
  }
  const normalizeSc = (sc) => { const p = sc.split('+'); const key = p.pop(); const mods = ['Ctrl', 'Alt', 'Shift'].filter((m) => p.includes(m)); return [...mods, key.length === 1 ? key.toUpperCase() : key].join('+'); };
  function bindKeys() {
    const scLookup = {};
    for (const sc in shortcutMap) scLookup[normalizeSc(sc)] = shortcutMap[sc];
    document.addEventListener('keydown', (e) => {
      const tag = (e.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || D().isOpen()) return;
      if (e.key === ' ' && !e.repeat) { state.space = true; if (view) view.style.cursor = 'grab'; e.preventDefault(); return; }
      const combo = comboOf(e);
      if (combo === 'Shift+Ctrl+Z' || combo === 'Ctrl+Shift+Z') { e.preventDefault(); run('redo'); return; }
      const action = scLookup[combo];
      if (action) { e.preventDefault(); run(action); return; }
      const t = app.tool;
      if (e.key === 'Enter') { if (t.apply) { e.preventDefault(); t.apply(); } return; }
      if (e.key === 'Escape') { if (t.cancel) t.cancel(); if (app.doc && !t.cancel) { app.doc.selection = null; app.updatePanels(); } return; }
      if (e.key === 'Delete' || (e.key === 'Backspace' && !e.ctrlKey && !e.altKey)) { e.preventDefault(); run('clear'); return; }
      if (e.key.startsWith('Arrow') && app.doc) {
        e.preventDefault();
        const s = e.shiftKey ? 10 : 1;
        const dx = e.key === 'ArrowLeft' ? -s : e.key === 'ArrowRight' ? s : 0, dy = e.key === 'ArrowUp' ? -s : e.key === 'ArrowDown' ? s : 0;
        PF.tools.byId.move.nudge(dx, dy); return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const key = e.key.length === 1 ? e.key.toUpperCase() : e.key;
      if (key === '[' || key === ']') {
        const id = state.toolId === 'eraser' ? 'eraser' : 'brush'; const o = state.toolOpts[id];
        o.size = U.clamp(Math.round(o.size * (key === ']' ? 1.25 : 0.8)) + (key === ']' ? 1 : -1), 1, 400);
        app.renderOptions(); app.requestRender(); return;
      }
      if (key === 'X') { app.setColors(state.bg, state.fg); return; }
      if (key === 'D' && !e.shiftKey) { app.setColors('#000000', '#ffffff'); return; }
      const want = (e.shiftKey ? 'Shift+' : '') + key;
      const tool = PF.tools.list.find((tt) => tt.key === want && !tt.hiddenInToolbar);
      if (tool) { e.preventDefault(); app.setTool(tool.id); }
    });
    document.addEventListener('keyup', (e) => { if (e.key === ' ') { state.space = false; if (view) view.style.cursor = app.tool.cursor || 'default'; } });
    document.addEventListener('paste', (e) => {
      const tag = (e.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea') return;
      const items = [...(e.clipboardData && e.clipboardData.items || [])];
      const img = items.find((i) => i.type.startsWith('image/'));
      if (img) { e.preventDefault(); const f = img.getAsFile(); U.loadImageFile(f).then((im) => app.addImageAsLayer(im, 'Pasted image')).catch(() => app.toast('Could not read pasted image', true)); return; }
      if (state.clipboard) { e.preventDefault(); pasteInternal(); }
    });
    window.addEventListener('beforeunload', (e) => { if (state.docs.some((d) => d.modified)) { e.preventDefault(); e.returnValue = ''; } });
  }

  /* ================= drag & drop ================= */
  function bindDrop() {
    const ov = $('dropOverlay');
    let depth = 0;
    document.addEventListener('dragenter', (e) => { if ([...e.dataTransfer.types].includes('Files')) { depth++; ov.classList.remove('hidden'); } });
    document.addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; ov.classList.add('hidden'); } });
    document.addEventListener('dragover', (e) => e.preventDefault());
    document.addEventListener('drop', (e) => { e.preventDefault(); depth = 0; ov.classList.add('hidden'); if (e.dataTransfer.files.length) app.openFiles([...e.dataTransfer.files], e.shiftKey || (e.target.closest && e.target.closest('#layersPanel'))); });
  }

  /* ================= init ================= */
  function init() {
    view = $('view'); vctx = view.getContext('2d'); viewport = $('viewport');
    buildMenus(); buildToolbar(); buildPanels(); bindView(); bindKeys(); bindDrop();
    $('emptyNew').addEventListener('click', () => run('new'));
    $('emptyOpen').addEventListener('click', () => run('open'));
    new ResizeObserver(resizeView).observe(viewport);
    resizeView();
    app.setTool('move');
    app.updateAll();
    const params = new URLSearchParams(location.search);
    if (params.has('demo')) {
      const d = new PF.Doc(1280, 720, 'Demo');
      const bg = d.newLayer('Background');
      const g = bg.ctx.createLinearGradient(0, 0, 1280, 720); g.addColorStop(0, '#1b2a49'); g.addColorStop(1, '#f2a65a');
      bg.ctx.fillStyle = g; bg.ctx.fillRect(0, 0, 1280, 720);
      const l2 = d.newLayer('Shapes');
      l2.ctx.fillStyle = 'rgba(255,255,255,.85)'; l2.ctx.beginPath(); l2.ctx.arc(640, 360, 180, 0, Math.PI * 2); l2.ctx.fill();
      l2.ctx.fillStyle = '#e5534b'; l2.ctx.fillRect(200, 150, 220, 220);
      app.openDocument(d);
    }
  }
  document.addEventListener('DOMContentLoaded', init);
})();
