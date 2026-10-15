// Run with: node --test test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const E = require('../js/encoders.js');

const img = (w, h) => {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) { data[i * 4] = i & 255; data[i * 4 + 1] = (i * 7) & 255; data[i * 4 + 2] = (i * 13) & 255; data[i * 4 + 3] = 255 - (i & 15); }
  return { width: w, height: h, data };
};
const u16 = (b, o) => b[o] | (b[o + 1] << 8);
const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

test('crc32 matches known vector', () => {
  assert.equal(E.crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
  assert.equal(E.crc32(new Uint8Array(0)), 0);
});

test('BMP 24-bit header, row padding and bottom-up BGR order', () => {
  const im = img(3, 2); // 3*3 = 9 bytes/row -> padded to 12
  const b = E.bmp(im);
  assert.equal(String.fromCharCode(b[0], b[1]), 'BM');
  assert.equal(u32(b, 2), b.length);
  assert.equal(u32(b, 10), 54);
  assert.equal(u32(b, 14), 40);
  assert.equal(u32(b, 18), 3); assert.equal(u32(b, 22), 2);
  assert.equal(u16(b, 28), 24);
  assert.equal(b.length, 54 + 12 * 2);
  // first stored row is the bottom row (y=1), pixel 0 -> index 3 in data
  const i = (1 * 3 + 0) * 4;
  assert.deepEqual([b[54], b[55], b[56]], [im.data[i + 2], im.data[i + 1], im.data[i]]);
});

test('BMP 32-bit uses V4 header with BITFIELDS and alpha', () => {
  const im = img(2, 2);
  const b = E.bmp(im, { alpha: true });
  assert.equal(u32(b, 10), 14 + 108);
  assert.equal(u32(b, 14), 108);
  assert.equal(u16(b, 28), 32);
  assert.equal(u32(b, 30), 3); // BI_BITFIELDS
  assert.equal(u32(b, 54), 0x00ff0000); assert.equal(u32(b, 66), 0xff000000);
  assert.equal(b.length, 122 + 2 * 2 * 4);
  const i = (1 * 2 + 0) * 4;
  assert.equal(b[122 + 3], im.data[i + 3]);
});

test('TIFF has valid header, IFD and strip data', () => {
  const im = img(4, 3);
  const b = E.tiff(im);
  assert.equal(String.fromCharCode(b[0], b[1]), 'II');
  assert.equal(u16(b, 2), 42);
  const ifd = u32(b, 4);
  assert.equal(ifd, 8 + 4 * 3 * 4);
  assert.equal(u16(b, ifd), 14);
  // first entry: ImageWidth
  assert.equal(u16(b, ifd + 2), 256); assert.equal(u32(b, ifd + 10), 4);
  // tags strictly ascending
  let prev = 0;
  for (let i = 0; i < 14; i++) { const tag = u16(b, ifd + 2 + i * 12); assert.ok(tag > prev); prev = tag; }
  // strip offset 8, strip bytes
  assert.equal(b[8], im.data[0]);
  assert.equal(u32(b, ifd + 2 + 12 * 8 + 8), 4 * 3 * 4);
});

test('ICO directory and PNG payload offsets', () => {
  const png1 = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
  const png2 = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 9]);
  const b = E.ico([{ width: 16, height: 16, png: png1 }, { width: 256, height: 256, png: png2 }]);
  assert.equal(u16(b, 2), 1); assert.equal(u16(b, 4), 2);
  assert.equal(b[6], 16); assert.equal(b[22], 0); // 256 encoded as 0
  assert.equal(u32(b, 14), png1.length); assert.equal(u32(b, 18), 6 + 32);
  assert.equal(u32(b, 34), 6 + 32 + png1.length);
  assert.equal(b[6 + 32], 0x89);
  assert.equal(b.length, 38 + png1.length + png2.length);
});

test('PDF structure with correct xref offsets', () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
  const b = E.pdf({ jpeg, width: 96, height: 48 });
  const s = new TextDecoder('latin1').decode(b);
  assert.ok(s.startsWith('%PDF-1.4'));
  assert.ok(s.includes('/MediaBox [0 0 72 36]'));
  assert.ok(s.includes('/Filter /DCTDecode /Length 4'));
  const startxref = parseInt(s.match(/startxref\n(\d+)/)[1], 10);
  assert.equal(s.slice(startxref, startxref + 4), 'xref');
  const offsets = [...s.matchAll(/^(\d{10}) 00000 n/gm)].map((m) => parseInt(m[1], 10));
  assert.equal(offsets.length, 5);
  offsets.forEach((o, i) => assert.ok(s.slice(o).startsWith(`${i + 1} 0 obj`), `object ${i + 1} offset`));
  assert.ok(s.endsWith('%%EOF\n'));
});

test('ZIP stored archive: local headers, central directory, EOCD', () => {
  const a = new TextEncoder().encode('hello'), c = new Uint8Array([1, 2, 3]);
  const b = E.zip([{ name: 'a.txt', bytes: a }, { name: 'dir/c.bin', bytes: c }], new Date(2026, 0, 2, 3, 4, 6));
  assert.equal(u32(b, 0), 0x04034b50);
  assert.equal(u16(b, 8), 0); // stored
  assert.equal(u32(b, 14), E.crc32(a));
  assert.equal(u32(b, 18), 5); assert.equal(u16(b, 26), 5);
  assert.equal(String.fromCharCode(...b.subarray(30, 35)), 'a.txt');
  const local2 = 30 + 5 + 5;
  assert.equal(u32(b, local2), 0x04034b50);
  const eocd = b.length - 22;
  assert.equal(u32(b, eocd), 0x06054b50);
  assert.equal(u16(b, eocd + 10), 2);
  const cdSize = u32(b, eocd + 12), cdOff = u32(b, eocd + 16);
  assert.equal(u32(b, cdOff), 0x02014b50);
  assert.equal(cdOff + cdSize, eocd);
  assert.equal(u32(b, cdOff + 42), 0); // offset of first local header
  assert.equal(u32(b, cdOff + 46 + 5 + 42), local2);
  // DOS time 03:04:06 -> (3<<11)|(4<<5)|3
  assert.equal(u16(b, 10), (3 << 11) | (4 << 5) | 3);
});
