/* Pixelforge - shared utilities */
(function () {
  'use strict';
  const PF = (window.PF = window.PF || {});

  let counter = 0;
  const util = {
    clamp(v, a, b) { return v < a ? a : v > b ? b : v; },
    uid(prefix) { return (prefix || 'id') + '_' + (++counter).toString(36) + Date.now().toString(36); },
    createCanvas(w, h) {
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(w));
      c.height = Math.max(1, Math.round(h));
      return c;
    },
    cloneCanvas(src) {
      const c = util.createCanvas(src.width, src.height);
      c.getContext('2d').drawImage(src, 0, 0);
      return c;
    },
    ctx2d(canvas) { return canvas.getContext('2d', { willReadFrequently: true }); },
    download(blob, filename) {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
    },
    canvasToBlob(canvas, type, quality) {
      return new Promise((resolve, reject) => {
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Encoding failed for ' + type))), type, quality);
      });
    },
    async blobToBytes(blob) { return new Uint8Array(await blob.arrayBuffer()); },
    readFileAsDataURL(file) {
      return new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(r.result);
        r.onerror = rej;
        r.readAsDataURL(file);
      });
    },
    readFileAsText(file) {
      return new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(r.result);
        r.onerror = rej;
        r.readAsText(file);
      });
    },
    loadImage(src) {
      return new Promise((res, rej) => {
        const img = new Image();
        img.onload = () => res(img);
        img.onerror = () => rej(new Error('Could not decode image'));
        img.src = src;
      });
    },
    async loadImageFile(file) {
      // Prefer createImageBitmap (handles EXIF orientation); fall back to <img>.
      if (window.createImageBitmap) {
        try { return await createImageBitmap(file); } catch (e) { /* fall through */ }
      }
      const url = URL.createObjectURL(file);
      try { return await util.loadImage(url); } finally { URL.revokeObjectURL(url); }
    },
    hexToRgb(hex) {
      const h = hex.replace('#', '');
      const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    },
    rgbToHex(r, g, b) {
      return '#' + [r, g, b].map((v) => util.clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('');
    },
    fmtBytes(n) {
      if (n < 1024) return n + ' B';
      if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
      return (n / 1024 / 1024).toFixed(2) + ' MB';
    },
    stripExt(name) { return name.replace(/\.[^.]+$/, ''); },
    el(tag, attrs, children) {
      const e = document.createElement(tag);
      if (attrs) {
        for (const k in attrs) {
          const v = attrs[k];
          if (k === 'class') e.className = v;
          else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
          else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
          else if (k === 'text') e.textContent = v;
          else if (k === 'html') e.innerHTML = v;
          else if (v !== undefined && v !== null && v !== false) e.setAttribute(k, v === true ? '' : v);
        }
      }
      if (children) {
        for (const ch of [].concat(children)) {
          if (ch == null || ch === false) continue;
          e.appendChild(typeof ch === 'string' ? document.createTextNode(ch) : ch);
        }
      }
      return e;
    },
    debounce(fn, ms) {
      let t;
      return function (...a) { clearTimeout(t); t = setTimeout(() => fn.apply(this, a), ms); };
    },
    throttleRAF(fn) {
      let queued = false;
      return function (...a) {
        if (queued) return;
        queued = true;
        requestAnimationFrame(() => { queued = false; fn.apply(this, a); });
      };
    },
    isMac: /Mac|iPhone|iPad/.test(navigator.platform),
    // Find bounding box of non-transparent pixels. Returns null when empty.
    opaqueBounds(canvas) {
      const { width: w, height: h } = canvas;
      const d = util.ctx2d(canvas).getImageData(0, 0, w, h).data;
      let x0 = w, y0 = h, x1 = -1, y1 = -1;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          if (d[(y * w + x) * 4 + 3] !== 0) {
            if (x < x0) x0 = x; if (x > x1) x1 = x;
            if (y < y0) y0 = y; if (y > y1) y1 = y;
          }
        }
      }
      return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
    },
    normRect(a, b) {
      const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
      return { x, y, w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
    },
    intRect(r) {
      const x = Math.floor(r.x), y = Math.floor(r.y);
      return { x, y, w: Math.ceil(r.x + r.w) - x, h: Math.ceil(r.y + r.h) - y };
    },
    clipRect(r, w, h) {
      const x = util.clamp(r.x, 0, w), y = util.clamp(r.y, 0, h);
      const x2 = util.clamp(r.x + r.w, 0, w), y2 = util.clamp(r.y + r.h, 0, h);
      return { x, y, w: Math.max(0, x2 - x), h: Math.max(0, y2 - y) };
    },
  };
  PF.util = util;
})();
