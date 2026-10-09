// Generates PWA + Tauri icons (a simple open-book glyph) with no external dependencies.
// Usage: npm run desktop:icons
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const BG = [0x2b, 0x1d, 0x14];
const PAGE = [0xf4, 0xe8, 0xd0];
const SPINE = [0xc9, 0x8b, 0x3c];

/** Coverage test in unit square (0..1). Returns [r,g,b,a] or null. */
function shade(x, y, maskable) {
  // rounded-square background (full bleed for maskable)
  if (!maskable) {
    const r = 0.18, cx = Math.min(Math.max(x, r), 1 - r), cy = Math.min(Math.max(y, r), 1 - r);
    if ((x - cx) ** 2 + (y - cy) ** 2 > r * r) return null;
  }
  const s = maskable ? 0.62 : 0.78; // glyph scale (maskable keeps the safe zone)
  const u = (x - 0.5) / s + 0.5, v = (y - 0.5) / s + 0.5;
  const left = u > 0.14 && u < 0.495 && v > 0.26 + (0.495 - u) * 0.0 && v < 0.74 - Math.abs(0.495 - u) * 0.0;
  const right = u > 0.505 && u < 0.86 && v > 0.26 && v < 0.74;
  // curved top edge: pages rise towards the spine
  const lift = (uu) => 0.05 * (1 - Math.abs(uu - 0.5) * 2);
  const inL = u > 0.14 && u < 0.492 && v > 0.26 - lift(u) && v < 0.74;
  const inR = u > 0.508 && u < 0.86 && v > 0.26 - lift(u) && v < 0.74;
  void left; void right;
  if (u >= 0.492 && u <= 0.508 && v > 0.24 && v < 0.76) return [...SPINE, 255];
  if (inL || inR) {
    // text lines
    const lines = [0.36, 0.45, 0.54, 0.63];
    for (const ly of lines) if (Math.abs(v - ly) < 0.012 && ((u > 0.2 && u < 0.45) || (u > 0.55 && u < 0.8))) return [...SPINE, 255];
    return [...PAGE, 255];
  }
  return [...BG, 255];
}

function render(size, maskable = false) {
  const ss = 3;
  const px = Buffer.alloc(size * size * 4);
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let sj = 0; sj < ss; sj++) for (let si = 0; si < ss; si++) {
      const c = shade((i + (si + 0.5) / ss) / size, (j + (sj + 0.5) / ss) / size, maskable);
      if (c) { r += c[0]; g += c[1]; b += c[2]; a += 255; }
    }
    const n = ss * ss, o = (j * size + i) * 4;
    const cov = a / 255;
    px[o] = cov ? Math.round(r / cov) : 0;
    px[o + 1] = cov ? Math.round(g / cov) : 0;
    px[o + 2] = cov ? Math.round(b / cov) : 0;
    px[o + 3] = Math.round(a / n);
  }
  return px;
}

const crcTable = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc = (buf) => { let c = -1; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
function chunk(type, data) {
  const t = Buffer.from(type), len = Buffer.alloc(4), c = Buffer.alloc(4);
  len.writeUInt32BE(data.length); c.writeUInt32BE(crc(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, c]);
}
function png(size, maskable) {
  const px = render(size, maskable);
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) { raw[y * (size * 4 + 1)] = 0; px.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
function ico(sizes) {
  const imgs = sizes.map((s) => png(s, false));
  const head = Buffer.alloc(6); head.writeUInt16LE(1, 2); head.writeUInt16LE(sizes.length, 4);
  let off = 6 + 16 * sizes.length;
  const dir = sizes.map((s, i) => {
    const e = Buffer.alloc(16);
    e[0] = s >= 256 ? 0 : s; e[1] = s >= 256 ? 0 : s; e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6);
    e.writeUInt32LE(imgs[i].length, 8); e.writeUInt32LE(off, 12); off += imgs[i].length; return e;
  });
  return Buffer.concat([head, ...dir, ...imgs]);
}

const out = (rel, data) => { const p = join(root, rel); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, data); console.log('wrote', rel); };

out('public/icons/icon-192.png', png(192));
out('public/icons/icon-512.png', png(512));
out('public/icons/maskable-512.png', png(512, true));
out('public/icons/apple-touch-icon.png', png(180, true));
out('public/favicon.png', png(64));
out('src-tauri/icons/32x32.png', png(32));
out('src-tauri/icons/128x128.png', png(128));
out('src-tauri/icons/128x128@2x.png', png(256));
out('src-tauri/icons/icon.png', png(512));
out('src-tauri/icons/icon.ico', ico([16, 32, 48, 64, 128, 256]));
