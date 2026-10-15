/* Pixelforge - pixel adjustments and filters. All functions take an ImageData-like {width,height,data} and mutate in place unless noted. */
(function () {
  'use strict';
  const PF = window.PF;
  const clamp255 = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);

  function applyLUT(img, lr, lg, lb) {
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      d[i] = lr[d[i]]; d[i + 1] = (lg || lr)[d[i + 1]]; d[i + 2] = (lb || lr)[d[i + 2]];
    }
  }
  function makeLUT(fn) {
    const t = new Uint8ClampedArray(256);
    for (let i = 0; i < 256; i++) t[i] = clamp255(Math.round(fn(i)));
    return t;
  }

  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0, s = 0; const l = (max + min) / 2;
    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h /= 6;
    }
    return [h, s, l];
  }
  function hslToRgb(h, s, l) {
    if (s === 0) { const v = l * 255; return [v, v, v]; }
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
    const f = (t) => {
      t = ((t % 1) + 1) % 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255];
  }

  const adjust = {
    histogram(img) {
      const d = img.data;
      const r = new Uint32Array(256), g = new Uint32Array(256), b = new Uint32Array(256), l = new Uint32Array(256);
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] === 0) continue;
        r[d[i]]++; g[d[i + 1]]++; b[d[i + 2]]++;
        l[Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2])]++;
      }
      return { r, g, b, l };
    },
    brightnessContrast(img, { brightness = 0, contrast = 0 }) {
      const f = (259 * (contrast + 255)) / (255 * (259 - contrast));
      applyLUT(img, makeLUT((v) => f * (v - 128) + 128 + brightness));
    },
    gamma(img, { gamma = 1, r = 1, g = 1, b = 1 }) {
      const lut = (gm) => makeLUT((v) => 255 * Math.pow(v / 255, 1 / Math.max(0.01, gm)));
      applyLUT(img, lut(gamma * r), lut(gamma * g), lut(gamma * b));
    },
    levels(img, { inBlack = 0, inWhite = 255, gamma = 1, outBlack = 0, outWhite = 255, channel = 'rgb' }) {
      const lut = makeLUT((v) => {
        let t = (v - inBlack) / Math.max(1, inWhite - inBlack);
        t = Math.min(1, Math.max(0, t));
        t = Math.pow(t, 1 / Math.max(0.01, gamma));
        return outBlack + t * (outWhite - outBlack);
      });
      const id = makeLUT((v) => v);
      if (channel === 'rgb') applyLUT(img, lut);
      else applyLUT(img, channel === 'r' ? lut : id, channel === 'g' ? lut : id, channel === 'b' ? lut : id);
    },
    curves(img, { master, r, g, b }) {
      // each is a 256-entry LUT or undefined
      const id = makeLUT((v) => v);
      const m = master || id;
      const comb = (c) => makeLUT((v) => (c || id)[m[v]]);
      applyLUT(img, comb(r), comb(g), comb(b));
    },
    exposure(img, { exposure = 0, offset = 0, gammaCorrection = 1 }) {
      const mult = Math.pow(2, exposure);
      applyLUT(img, makeLUT((v) => 255 * Math.pow(Math.min(1, Math.max(0, (v / 255) * mult + offset)), 1 / Math.max(0.01, gammaCorrection))));
    },
    hsl(img, { hue = 0, saturation = 0, lightness = 0 }) {
      const d = img.data;
      const dh = hue / 360, ds = saturation / 100, dl = lightness / 100;
      for (let i = 0; i < d.length; i += 4) {
        let [h, s, l] = rgbToHsl(d[i], d[i + 1], d[i + 2]);
        h += dh;
        s = ds >= 0 ? s + (1 - s) * ds : s * (1 + ds);
        l = dl >= 0 ? l + (1 - l) * dl : l * (1 + dl);
        const [r, g, b] = hslToRgb(h, Math.min(1, Math.max(0, s)), Math.min(1, Math.max(0, l)));
        d[i] = r; d[i + 1] = g; d[i + 2] = b;
      }
    },
    vibrance(img, { vibrance = 0 }) {
      const d = img.data, amt = vibrance / 100;
      for (let i = 0; i < d.length; i += 4) {
        const r = d[i], g = d[i + 1], b = d[i + 2];
        const max = Math.max(r, g, b), avg = (r + g + b) / 3;
        const sat = (max - avg) / 255;
        const k = amt * (1 - sat) * 2;
        d[i] = clamp255(r + (r - avg) * k); d[i + 1] = clamp255(g + (g - avg) * k); d[i + 2] = clamp255(b + (b - avg) * k);
      }
    },
    colorBalance(img, { temperature = 0, tint = 0, shadows = 0, midtones = 0, highlights = 0 }) {
      // temperature: warm(+)/cool(-); tint: magenta(+)/green(-). Values -100..100
      const t = temperature * 0.6, ti = tint * 0.6;
      applyLUT(img, makeLUT((v) => v + t + ti * 0.5), makeLUT((v) => v - ti), makeLUT((v) => v - t + ti * 0.5));
      if (shadows || midtones || highlights) {
        applyLUT(img, makeLUT((v) => {
          const x = v / 255;
          const sh = Math.max(0, 1 - x * 2), hi = Math.max(0, x * 2 - 1), mid = 1 - sh - hi;
          return v + shadows * sh + midtones * mid + highlights * hi;
        }));
      }
    },
    invert(img) { applyLUT(img, makeLUT((v) => 255 - v)); },
    grayscale(img) {
      const d = img.data;
      for (let i = 0; i < d.length; i += 4) {
        const l = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
        d[i] = d[i + 1] = d[i + 2] = l;
      }
    },
    sepia(img, { amount = 100 } = {}) {
      const d = img.data, a = amount / 100;
      for (let i = 0; i < d.length; i += 4) {
        const r = d[i], g = d[i + 1], b = d[i + 2];
        const sr = 0.393 * r + 0.769 * g + 0.189 * b, sg = 0.349 * r + 0.686 * g + 0.168 * b, sb = 0.272 * r + 0.534 * g + 0.131 * b;
        d[i] = clamp255(r + (sr - r) * a); d[i + 1] = clamp255(g + (sg - g) * a); d[i + 2] = clamp255(b + (sb - b) * a);
      }
    },
    threshold(img, { level = 128 }) {
      const d = img.data;
      for (let i = 0; i < d.length; i += 4) {
        const l = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
        d[i] = d[i + 1] = d[i + 2] = l >= level ? 255 : 0;
      }
    },
    posterize(img, { levels = 4 }) {
      const n = Math.max(2, levels);
      applyLUT(img, makeLUT((v) => Math.round(Math.floor((v / 256) * n) * (255 / (n - 1)))));
    },
    autoLevels(img, { clip = 0.1 } = {}) {
      const hist = adjust.histogram(img);
      const total = img.data.length / 4;
      const bounds = (h) => {
        let lo = 0, hi = 255, acc = 0;
        const cut = (total * clip) / 100;
        for (acc = 0; lo < 255 && acc + h[lo] <= cut; lo++) acc += h[lo];
        for (acc = 0; hi > 0 && acc + h[hi] <= cut; hi--) acc += h[hi];
        return [lo, Math.max(lo + 1, hi)];
      };
      const [rl, rh] = bounds(hist.r), [gl, gh] = bounds(hist.g), [bl, bh] = bounds(hist.b);
      const lut = (lo, hi) => makeLUT((v) => ((v - lo) * 255) / (hi - lo));
      applyLUT(img, lut(rl, rh), lut(gl, gh), lut(bl, bh));
    },
    autoContrast(img, { clip = 0.1 } = {}) {
      const hist = adjust.histogram(img);
      const total = img.data.length / 4, cut = (total * clip) / 100;
      let lo = 0, hi = 255, acc = 0;
      for (acc = 0; lo < 255 && acc + hist.l[lo] <= cut; lo++) acc += hist.l[lo];
      for (acc = 0; hi > 0 && acc + hist.l[hi] <= cut; hi--) acc += hist.l[hi];
      adjust.levels(img, { inBlack: lo, inWhite: Math.max(lo + 1, hi) });
    },
    /** Monotone cubic interpolation through points [[x,y],...] (0..255) -> 256 LUT */
    curveLUT(points) {
      const pts = points.slice().sort((a, b) => a[0] - b[0]);
      const n = pts.length;
      if (n === 0) return makeLUT((v) => v);
      if (n === 1) return makeLUT(() => pts[0][1]);
      const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
      const dx = [], dy = [], m = [];
      for (let i = 0; i < n - 1; i++) { dx.push(xs[i + 1] - xs[i] || 1e-6); dy.push(ys[i + 1] - ys[i]); m.push(dy[i] / dx[i]); }
      const t = [m[0]];
      for (let i = 1; i < n - 1; i++) t.push(m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2);
      t.push(m[n - 2]);
      for (let i = 0; i < n - 1; i++) {
        if (m[i] === 0) { t[i] = t[i + 1] = 0; continue; }
        const a = t[i] / m[i], b = t[i + 1] / m[i], s = a * a + b * b;
        if (s > 9) { const tau = 3 / Math.sqrt(s); t[i] = tau * a * m[i]; t[i + 1] = tau * b * m[i]; }
      }
      return makeLUT((x) => {
        if (x <= xs[0]) return ys[0];
        if (x >= xs[n - 1]) return ys[n - 1];
        let i = 0;
        while (x > xs[i + 1]) i++;
        const h = dx[i], s = (x - xs[i]) / h;
        const h00 = 2 * s * s * s - 3 * s * s + 1, h10 = s * s * s - 2 * s * s + s, h01 = -2 * s * s * s + 3 * s * s, h11 = s * s * s - s * s;
        return h00 * ys[i] + h10 * h * t[i] + h01 * ys[i + 1] + h11 * h * t[i + 1];
      });
    },
  };

  /* ---------------- filters ---------------- */
  function convolve(img, kernel, divisor, bias = 0, preserveAlpha = true) {
    const { width: w, height: h } = img;
    const src = img.data, out = new Uint8ClampedArray(src.length);
    const side = Math.round(Math.sqrt(kernel.length)), half = Math.floor(side / 2);
    divisor = divisor || kernel.reduce((a, b) => a + b, 0) || 1;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let r = 0, g = 0, b = 0, a = 0;
        for (let ky = 0; ky < side; ky++) {
          const sy = Math.min(h - 1, Math.max(0, y + ky - half));
          for (let kx = 0; kx < side; kx++) {
            const sx = Math.min(w - 1, Math.max(0, x + kx - half));
            const wgt = kernel[ky * side + kx];
            const i = (sy * w + sx) * 4;
            r += src[i] * wgt; g += src[i + 1] * wgt; b += src[i + 2] * wgt; a += src[i + 3] * wgt;
          }
        }
        const o = (y * w + x) * 4;
        out[o] = r / divisor + bias; out[o + 1] = g / divisor + bias; out[o + 2] = b / divisor + bias;
        out[o + 3] = preserveAlpha ? src[o + 3] : a / divisor;
      }
    }
    src.set(out);
  }

  function boxBlurPass(src, dst, w, h, r) {
    // horizontal pass src->dst then caller swaps for vertical with transposed dims handled by iterating
    const iarr = 1 / (r + r + 1);
    for (let y = 0; y < h; y++) {
      let ti = y * w, li = ti, ri = ti + r;
      const fv = [src[ti * 4], src[ti * 4 + 1], src[ti * 4 + 2], src[ti * 4 + 3]];
      const lv = [src[(ti + w - 1) * 4], src[(ti + w - 1) * 4 + 1], src[(ti + w - 1) * 4 + 2], src[(ti + w - 1) * 4 + 3]];
      const val = [(r + 1) * fv[0], (r + 1) * fv[1], (r + 1) * fv[2], (r + 1) * fv[3]];
      for (let j = 0; j < r; j++) { const i = (ti + Math.min(j, w - 1)) * 4; for (let c = 0; c < 4; c++) val[c] += src[i + c]; }
      for (let j = 0; j <= r; j++) {
        const ii = Math.min(ri, ti + w - 1) * 4; ri++;
        for (let c = 0; c < 4; c++) { val[c] += src[ii + c] - fv[c]; dst[ti * 4 + c] = val[c] * iarr; }
        ti++;
      }
      for (let j = r + 1; j < w - r; j++) {
        for (let c = 0; c < 4; c++) { val[c] += src[ri * 4 + c] - src[li * 4 + c]; dst[ti * 4 + c] = val[c] * iarr; }
        ri++; li++; ti++;
      }
      for (let j = Math.max(w - r, r + 1); j < w; j++) {
        for (let c = 0; c < 4; c++) { val[c] += lv[c] - src[li * 4 + c]; dst[ti * 4 + c] = val[c] * iarr; }
        li++; ti++;
      }
    }
  }
  function transpose(src, dst, w, h) {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4, o = (x * h + y) * 4;
      dst[o] = src[i]; dst[o + 1] = src[i + 1]; dst[o + 2] = src[i + 2]; dst[o + 3] = src[i + 3];
    }
  }
  function premultiply(d) { for (let i = 0; i < d.length; i += 4) { const a = d[i + 3] / 255; d[i] *= a; d[i + 1] *= a; d[i + 2] *= a; } }
  function unpremultiply(d) { for (let i = 0; i < d.length; i += 4) { const a = d[i + 3] / 255; if (a > 0) { d[i] /= a; d[i + 1] /= a; d[i + 2] /= a; } } }

  function boxBlur(img, radius, passes = 1) {
    const { width: w, height: h } = img;
    const r = Math.max(0, Math.round(radius));
    if (r === 0) return;
    const a = new Float32Array(img.data), b = new Float32Array(a.length), t = new Float32Array(a.length);
    premultiply(a);
    for (let p = 0; p < passes; p++) {
      boxBlurPass(a, b, w, h, r);     // horizontal
      transpose(b, t, w, h);
      boxBlurPass(t, b, h, w, r);     // vertical (on transposed)
      transpose(b, a, h, w);
    }
    unpremultiply(a);
    img.data.set(a);
  }

  const filters = {
    gaussianBlur(img, { radius = 4 }) {
      if (radius <= 0) return;
      // three box blurs approximate a gaussian
      const ideal = Math.sqrt((12 * radius * radius) / 3 + 1);
      let wl = Math.floor(ideal); if (wl % 2 === 0) wl--;
      const wu = wl + 2;
      const m = Math.round((12 * radius * radius - 3 * wl * wl - 12 * wl - 9) / (-4 * wl - 4));
      for (let i = 0; i < 3; i++) boxBlur(img, ((i < m ? wl : wu) - 1) / 2, 1);
    },
    boxBlur(img, { radius = 3 }) { boxBlur(img, radius, 1); },
    sharpen(img, { amount = 50 }) {
      const a = amount / 100;
      convolve(img, [0, -a, 0, -a, 1 + 4 * a, -a, 0, -a, 0], 1);
    },
    unsharpMask(img, { radius = 2, amount = 100, threshold = 0 }) {
      const blurred = { width: img.width, height: img.height, data: new Uint8ClampedArray(img.data) };
      filters.gaussianBlur(blurred, { radius });
      const d = img.data, b = blurred.data, k = amount / 100;
      for (let i = 0; i < d.length; i += 4) for (let c = 0; c < 3; c++) {
        const diff = d[i + c] - b[i + c];
        if (Math.abs(diff) >= threshold) d[i + c] = clamp255(d[i + c] + diff * k);
      }
    },
    emboss(img, { strength = 1 }) { convolve(img, [-2 * strength, -strength, 0, -strength, 1, strength, 0, strength, 2 * strength], 1); },
    findEdges(img) { convolve(img, [-1, -1, -1, -1, 8, -1, -1, -1, -1], 1); },
    noise(img, { amount = 20, monochrome = false }) {
      const d = img.data, a = (amount / 100) * 255;
      for (let i = 0; i < d.length; i += 4) {
        if (monochrome) { const n = (Math.random() - 0.5) * a; d[i] = clamp255(d[i] + n); d[i + 1] = clamp255(d[i + 1] + n); d[i + 2] = clamp255(d[i + 2] + n); }
        else for (let c = 0; c < 3; c++) d[i + c] = clamp255(d[i + c] + (Math.random() - 0.5) * a);
      }
    },
    pixelate(img, { size = 8 }) {
      const { width: w, height: h, data: d } = img, s = Math.max(1, Math.round(size));
      for (let y = 0; y < h; y += s) for (let x = 0; x < w; x += s) {
        let r = 0, g = 0, b = 0, a = 0, n = 0;
        for (let yy = y; yy < Math.min(h, y + s); yy++) for (let xx = x; xx < Math.min(w, x + s); xx++) {
          const i = (yy * w + xx) * 4; r += d[i]; g += d[i + 1]; b += d[i + 2]; a += d[i + 3]; n++;
        }
        r /= n; g /= n; b /= n; a /= n;
        for (let yy = y; yy < Math.min(h, y + s); yy++) for (let xx = x; xx < Math.min(w, x + s); xx++) {
          const i = (yy * w + xx) * 4; d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = a;
        }
      }
    },
    vignette(img, { amount = 50, size = 50 }) {
      const { width: w, height: h, data: d } = img;
      const cx = w / 2, cy = h / 2, maxR = Math.sqrt(cx * cx + cy * cy);
      const start = (size / 100) * 0.9, k = amount / 100;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const r = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2) / maxR;
        const f = r <= start ? 1 : 1 - k * Math.min(1, (r - start) / Math.max(0.01, 1 - start));
        const i = (y * w + x) * 4; d[i] *= f; d[i + 1] *= f; d[i + 2] *= f;
      }
    },
    solarize(img, { threshold = 128 }) { applyLUT(img, makeLUT((v) => (v > threshold ? 255 - v : v))); },
    convolve,
  };

  PF.adjust = adjust;
  PF.filters = filters;
  PF.color = { rgbToHsl, hslToRgb };
})();
