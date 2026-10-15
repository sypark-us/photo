/* Pixelforge - pure binary encoders (BMP, TIFF, ICO, PDF, ZIP). No DOM dependencies; also loadable in Node for tests. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else (root.PF = root.PF || {}).encoders = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  class ByteWriter {
    constructor(size) { this.buf = new Uint8Array(size); this.view = new DataView(this.buf.buffer); this.pos = 0; }
    u8(v) { this.buf[this.pos++] = v & 255; }
    u16(v) { this.view.setUint16(this.pos, v, true); this.pos += 2; }
    u32(v) { this.view.setUint32(this.pos, v >>> 0, true); this.pos += 4; }
    bytes(arr) { this.buf.set(arr, this.pos); this.pos += arr.length; }
    ascii(s) { for (let i = 0; i < s.length; i++) this.buf[this.pos++] = s.charCodeAt(i) & 255; }
    result() { return this.buf.subarray(0, this.pos); }
  }

  const CRC_TABLE = (() => {
    const t = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c;
    }
    return t;
  })();
  function crc32(bytes) {
    let c = -1;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 255] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
  }

  /** imageData: {width,height,data(RGBA)}. opts.alpha=true -> 32-bit BITFIELDS BMP (V4 header), else 24-bit. */
  function bmp(imageData, opts = {}) {
    const { width: w, height: h, data } = imageData;
    const alpha = !!opts.alpha;
    const bpp = alpha ? 4 : 3;
    const rowSize = Math.ceil((w * bpp) / 4) * 4;
    const headerSize = 14 + (alpha ? 108 : 40);
    const pixelBytes = rowSize * h;
    const wr = new ByteWriter(headerSize + pixelBytes);
    wr.ascii('BM'); wr.u32(headerSize + pixelBytes); wr.u32(0); wr.u32(headerSize);
    wr.u32(alpha ? 108 : 40); wr.u32(w); wr.u32(h); wr.u16(1); wr.u16(bpp * 8);
    wr.u32(alpha ? 3 : 0); wr.u32(pixelBytes); wr.u32(2835); wr.u32(2835); wr.u32(0); wr.u32(0);
    if (alpha) {
      wr.u32(0x00ff0000); wr.u32(0x0000ff00); wr.u32(0x000000ff); wr.u32(0xff000000);
      wr.ascii('BGRs');
      for (let i = 0; i < 12; i++) wr.u32(0); // CIEXYZ endpoints + gammas (unused)
    }
    for (let y = h - 1; y >= 0; y--) {
      const rowStart = wr.pos;
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        wr.u8(data[i + 2]); wr.u8(data[i + 1]); wr.u8(data[i]);
        if (alpha) wr.u8(data[i + 3]);
      }
      while (wr.pos - rowStart < rowSize) wr.u8(0);
    }
    return wr.result();
  }

  /** Uncompressed 8-bit RGBA TIFF, little endian, single strip. */
  function tiff(imageData) {
    const { width: w, height: h, data } = imageData;
    const dataLen = w * h * 4;
    const entries = 14;
    const ifdOffset = 8 + dataLen;
    const ifdLen = 2 + entries * 12 + 4;
    const extraOffset = ifdOffset + ifdLen;
    const wr = new ByteWriter(extraOffset + 8 + 8 + 8);
    wr.ascii('II'); wr.u16(42); wr.u32(ifdOffset);
    wr.bytes(data);
    wr.u16(entries);
    const SHORT = 3, LONG = 4, RATIONAL = 5;
    const entry = (tag, type, count, value) => {
      wr.u16(tag); wr.u16(type); wr.u32(count);
      if (type === SHORT && count === 1) { wr.u16(value); wr.u16(0); } else wr.u32(value);
    };
    entry(256, LONG, 1, w);             // ImageWidth
    entry(257, LONG, 1, h);             // ImageLength
    entry(258, SHORT, 4, extraOffset);  // BitsPerSample -> [8,8,8,8]
    entry(259, SHORT, 1, 1);            // Compression: none
    entry(262, SHORT, 1, 2);            // Photometric: RGB
    entry(273, LONG, 1, 8);             // StripOffsets
    entry(277, SHORT, 1, 4);            // SamplesPerPixel
    entry(278, LONG, 1, h);             // RowsPerStrip
    entry(279, LONG, 1, dataLen);       // StripByteCounts
    entry(282, RATIONAL, 1, extraOffset + 8);  // XResolution
    entry(283, RATIONAL, 1, extraOffset + 16); // YResolution
    entry(284, SHORT, 1, 1);            // PlanarConfiguration: chunky
    entry(296, SHORT, 1, 2);            // ResolutionUnit: inch
    entry(338, SHORT, 1, 2);            // ExtraSamples: unassociated alpha
    wr.u32(0);                          // next IFD
    wr.u16(8); wr.u16(8); wr.u16(8); wr.u16(8);
    wr.u32(72); wr.u32(1); wr.u32(72); wr.u32(1);
    return wr.result();
  }

  /** images: [{width,height,png:Uint8Array}] -> ICO with PNG-compressed entries. */
  function ico(images) {
    const dirLen = 6 + images.length * 16;
    const total = dirLen + images.reduce((s, im) => s + im.png.length, 0);
    const wr = new ByteWriter(total);
    wr.u16(0); wr.u16(1); wr.u16(images.length);
    let offset = dirLen;
    for (const im of images) {
      wr.u8(im.width >= 256 ? 0 : im.width); wr.u8(im.height >= 256 ? 0 : im.height);
      wr.u8(0); wr.u8(0); wr.u16(1); wr.u16(32); wr.u32(im.png.length); wr.u32(offset);
      offset += im.png.length;
    }
    for (const im of images) wr.bytes(im.png);
    return wr.result();
  }

  /** Single-page PDF embedding a JPEG (DCTDecode). Page size derived from pixel size at `dpi`. */
  function pdf({ jpeg, width, height, dpi = 96 }) {
    const pw = (width * 72) / dpi, ph = (height * 72) / dpi;
    const fmt = (n) => (Math.round(n * 100) / 100).toString();
    const content = 'q ' + fmt(pw) + ' 0 0 ' + fmt(ph) + ' 0 0 cm /Im0 Do Q';
    const enc = new TextEncoder();
    const parts = [];
    const offsets = [];
    let pos = 0;
    const push = (s) => { const b = typeof s === 'string' ? enc.encode(s) : s; parts.push(b); pos += b.length; };
    push('%PDF-1.4\n');
    const obj = (n, body) => {
      offsets[n] = pos;
      push(n + ' 0 obj\n');
      if (typeof body === 'string') push(body); else body();
      push('\nendobj\n');
    };
    obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
    obj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
    obj(3, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + fmt(pw) + ' ' + fmt(ph) + '] /Contents 4 0 R /Resources << /XObject << /Im0 5 0 R >> >> >>');
    obj(4, '<< /Length ' + content.length + ' >>\nstream\n' + content + '\nendstream');
    obj(5, () => {
      push('<< /Type /XObject /Subtype /Image /Width ' + width + ' /Height ' + height +
        ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + jpeg.length + ' >>\nstream\n');
      push(jpeg);
      push('\nendstream');
    });
    const xref = pos;
    let x = 'xref\n0 6\n0000000000 65535 f \n';
    for (let i = 1; i <= 5; i++) x += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
    x += 'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n';
    push(x);
    const out = new Uint8Array(pos);
    let p = 0;
    for (const b of parts) { out.set(b, p); p += b.length; }
    return out;
  }

  function dosDateTime(d) {
    const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    return { time, date };
  }

  /** files: [{name, bytes:Uint8Array}] -> stored (uncompressed) ZIP archive with UTF-8 names. */
  function zip(files, now = new Date()) {
    const enc = new TextEncoder();
    const { time, date } = dosDateTime(now);
    const items = files.map((f) => ({ name: enc.encode(f.name), bytes: f.bytes, crc: crc32(f.bytes) }));
    const localSize = items.reduce((s, it) => s + 30 + it.name.length + it.bytes.length, 0);
    const cdSize = items.reduce((s, it) => s + 46 + it.name.length, 0);
    const wr = new ByteWriter(localSize + cdSize + 22);
    const offsets = [];
    for (const it of items) {
      offsets.push(wr.pos);
      wr.u32(0x04034b50); wr.u16(20); wr.u16(0x0800); wr.u16(0); wr.u16(time); wr.u16(date);
      wr.u32(it.crc); wr.u32(it.bytes.length); wr.u32(it.bytes.length); wr.u16(it.name.length); wr.u16(0);
      wr.bytes(it.name); wr.bytes(it.bytes);
    }
    const cdStart = wr.pos;
    items.forEach((it, i) => {
      wr.u32(0x02014b50); wr.u16(20); wr.u16(20); wr.u16(0x0800); wr.u16(0); wr.u16(time); wr.u16(date);
      wr.u32(it.crc); wr.u32(it.bytes.length); wr.u32(it.bytes.length); wr.u16(it.name.length);
      wr.u16(0); wr.u16(0); wr.u16(0); wr.u16(0); wr.u32(0); wr.u32(offsets[i]); wr.bytes(it.name);
    });
    const cdEnd = wr.pos;
    wr.u32(0x06054b50); wr.u16(0); wr.u16(0); wr.u16(items.length); wr.u16(items.length);
    wr.u32(cdEnd - cdStart); wr.u32(cdStart); wr.u16(0);
    return wr.result();
  }

  return { bmp, tiff, ico, pdf, zip, crc32 };
});
