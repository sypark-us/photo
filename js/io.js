/* Pixelforge - file import/export, format conversion, project files */
(function () {
  'use strict';
  const PF = window.PF;
  const U = PF.util;
  const E = PF.encoders;

  const probe = U.createCanvas(2, 2);
  const supports = {
    webp: probe.toDataURL('image/webp').startsWith('data:image/webp'),
    avif: probe.toDataURL('image/avif').startsWith('data:image/avif'),
  };

  const EXT = { png: 'png', jpeg: 'jpg', webp: 'webp', avif: 'avif', bmp: 'bmp', bmp32: 'bmp', tiff: 'tif', ico: 'ico', pdf: 'pdf', pxf: 'pxf' };
  const NO_ALPHA = new Set(['jpeg', 'bmp', 'pdf']);

  function flattenOnColor(canvas, color) {
    const c = U.createCanvas(canvas.width, canvas.height);
    const ctx = c.getContext('2d');
    ctx.fillStyle = color; ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(canvas, 0, 0);
    return c;
  }
  function scaled(canvas, scale) {
    if (!scale || scale === 1) return canvas;
    const c = U.createCanvas(Math.max(1, Math.round(canvas.width * scale)), Math.max(1, Math.round(canvas.height * scale)));
    const ctx = c.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(canvas, 0, 0, c.width, c.height);
    return c;
  }
  function fitSquare(canvas, size) {
    const c = U.createCanvas(size, size);
    const ctx = c.getContext('2d');
    const k = Math.min(size / canvas.width, size / canvas.height);
    const w = canvas.width * k, h = canvas.height * k;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(canvas, (size - w) / 2, (size - h) / 2, w, h);
    return c;
  }
  const imageDataOf = (canvas) => canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);

  /** Encode a flattened canvas to a Blob in the given format. */
  async function encodeCanvas(canvas, { format = 'png', quality = 90, background = '#ffffff', icoSize = 'multi' } = {}) {
    const q = U.clamp(quality, 1, 100) / 100;
    const src = NO_ALPHA.has(format) ? flattenOnColor(canvas, background) : canvas;
    switch (format) {
      case 'png': return U.canvasToBlob(src, 'image/png');
      case 'jpeg': return U.canvasToBlob(src, 'image/jpeg', q);
      case 'webp': return U.canvasToBlob(src, 'image/webp', q);
      case 'avif':
        if (!supports.avif) throw new Error('This browser cannot encode AVIF');
        return U.canvasToBlob(src, 'image/avif', q);
      case 'bmp': return new Blob([E.bmp(imageDataOf(src), { alpha: false })], { type: 'image/bmp' });
      case 'bmp32': return new Blob([E.bmp(imageDataOf(src), { alpha: true })], { type: 'image/bmp' });
      case 'tiff': return new Blob([E.tiff(imageDataOf(src))], { type: 'image/tiff' });
      case 'ico': {
        const sizes = icoSize === 'multi' ? [16, 32, 48, 64, 128, 256] : [parseInt(icoSize, 10) || 256];
        const images = [];
        for (const s of sizes) {
          const sq = fitSquare(src, s);
          images.push({ width: s, height: s, png: await U.blobToBytes(await U.canvasToBlob(sq, 'image/png')) });
        }
        return new Blob([E.ico(images)], { type: 'image/x-icon' });
      }
      case 'pdf': {
        const jpeg = await U.blobToBytes(await U.canvasToBlob(src, 'image/jpeg', q));
        return new Blob([E.pdf({ jpeg, width: src.width, height: src.height })], { type: 'application/pdf' });
      }
      default: throw new Error('Unknown format ' + format);
    }
  }

  async function exportBlob(doc, opts) {
    const scale = (opts.scale || 100) / 100;
    const canvas = scaled(doc.render(), scale);
    return encodeCanvas(canvas, opts);
  }

  /* ---------- project format (.pxf = JSON with PNG layer data) ---------- */
  function saveProject(doc) {
    const data = {
      app: 'pixelforge', version: 1, name: doc.name, width: doc.width, height: doc.height, activeId: doc.activeId,
      layers: doc.layers.map((l) => ({ id: l.id, name: l.name, visible: l.visible, opacity: l.opacity, blend: l.blend, locked: l.locked, x: l.x, y: l.y, data: l.canvas.toDataURL('image/png') })),
    };
    return new Blob([JSON.stringify(data)], { type: 'application/json' });
  }
  async function loadProject(text, filename) {
    const j = JSON.parse(text);
    if (j.app !== 'pixelforge' || !Array.isArray(j.layers)) throw new Error('Not a Pixelforge project file');
    const doc = new PF.Doc(j.width, j.height, j.name || U.stripExt(filename || 'project'));
    for (const L of j.layers) {
      const img = await U.loadImage(L.data);
      const layer = new PF.Layer(j.width, j.height, L.name);
      layer.ctx.drawImage(img, 0, 0);
      Object.assign(layer, { visible: L.visible !== false, opacity: L.opacity ?? 1, blend: L.blend || 'source-over', locked: !!L.locked, x: L.x || 0, y: L.y || 0 });
      if (L.id) layer.id = L.id;
      doc.layers.push(layer);
    }
    doc.activeId = doc.layers.some((l) => l.id === j.activeId) ? j.activeId : doc.layers[doc.layers.length - 1]?.id || null;
    doc.name = doc.name.replace(/\.pxf$/i, '');
    return doc;
  }

  function isProjectFile(file) { return /\.(pxf|json)$/i.test(file.name); }

  function docFromImage(img, name) {
    const w = img.width || img.naturalWidth, h = img.height || img.naturalHeight;
    const doc = new PF.Doc(w, h, name || 'Image');
    const l = doc.newLayer('Background');
    l.ctx.drawImage(img, 0, 0);
    if (img.close) img.close();
    return doc;
  }
  async function docFromFile(file) {
    if (isProjectFile(file)) return loadProject(await U.readFileAsText(file), file.name);
    const img = await U.loadImageFile(file);
    return docFromImage(img, U.stripExt(file.name));
  }

  /** Batch conversion: file -> {name, blob} */
  async function convertFile(file, { format, quality, maxDim, background }) {
    const doc = await docFromFile(file);
    let scale = 100;
    if (maxDim > 0) { const m = Math.max(doc.width, doc.height); if (m > maxDim) scale = (maxDim / m) * 100; }
    const blob = await exportBlob(doc, { format, quality, scale, background, icoSize: '256' });
    return { name: U.stripExt(file.name) + '.' + EXT[format], blob };
  }

  PF.io = { supports, extFor: (f) => EXT[f] || f, encodeCanvas, exportBlob, saveProject, loadProject, isProjectFile, docFromFile, docFromImage, convertFile };
})();
