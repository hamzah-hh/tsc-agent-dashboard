// Draws the app icons (public/icon-192.png, icon-512.png): navy tile with two overlapping outlined squares.
// Run once: node scripts/make-icons.cjs
const fs = require('fs');
const zlib = require('zlib');
function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};
function png(size) {
  const bg = [0x1a, 0x2b, 0x58], fg = [0xff, 0xff, 0xff];
  const px = (x, y) => {
    const u = x / size, v = y / size;
    const ring = (x0, y0, w, t) => {
      const inOuter = u >= x0 && u <= x0 + w && v >= y0 && v <= y0 + w;
      const inInner = u >= x0 + t && u <= x0 + w - t && v >= y0 + t && v <= y0 + w - t;
      return inOuter && !inInner;
    };
    const t = 0.05;
    // Maskable safe zone: everything stays inside the middle 60%
    return ring(0.24, 0.24, 0.34, t) || ring(0.42, 0.42, 0.34, t) ? fg : bg;
  };
  const raw = Buffer.alloc((size * 3 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const c = px(x, y), o = y * (size * 3 + 1) + 1 + x * 3;
      raw[o] = c[0]; raw[o + 1] = c[1]; raw[o + 2] = c[2];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
fs.mkdirSync('public', { recursive: true });
fs.writeFileSync('public/icon-192.png', png(192));
fs.writeFileSync('public/icon-512.png', png(512));
console.log('icons written');
