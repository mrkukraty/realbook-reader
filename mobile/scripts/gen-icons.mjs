// Generates the app icon, Android adaptive icon layers, splash icon and favicon (open-book glyph). No dependencies.
// Usage: node scripts/gen-icons.mjs
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets');
const BG = [0x5b, 0x46, 0x36];
const PAGE = [0xfb, 0xf6, 0xe9];
const INK = [0x8a, 0x4b, 0x20];

/** returns [r,g,b,a] for unit-square coords. mode: 'full' | 'fg' (transparent bg) | 'bg' | 'mono' */
function px(x, y, mode, scale) {
  const u = (x - 0.5) / scale + 0.5, v = (y - 0.5) / scale + 0.5;
  const lift = (uu) => 0.06 * (1 - Math.abs(uu - 0.5) * 2);
  const inL = u > 0.12 && u < 0.49 && v > 0.27 - lift(u) && v < 0.75;
  const inR = u > 0.51 && u < 0.88 && v > 0.27 - lift(u) && v < 0.75;
  const spine = u >= 0.49 && u <= 0.51 && v > 0.24 && v < 0.77;
  const cover = u > 0.1 && u < 0.9 && v > 0.73 && v < 0.79;
  const bg = mode === 'full' || mode === 'bg' ? [...BG, 255] : [0, 0, 0, 0];
  if (mode === 'bg') return bg;
  const fg = (c) => (mode === 'mono' ? [255, 255, 255, 255] : [...c, 255]);
  if (spine || cover) return fg(INK);
  if (inL || inR) {
    for (const ly of [0.37, 0.45, 0.53, 0.61]) {
      if (Math.abs(v - ly) < 0.011 && ((u > 0.18 && u < 0.45) || (u > 0.55 && u < 0.82))) return mode === 'mono' ? [0, 0, 0, 0] : [...INK, 255];
    }
    return fg(PAGE);
  }
  return bg;
}

function png(size, mode, scale) {
  const ss = 3;
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const acc = [0, 0, 0, 0];
      for (let sy = 0; sy < ss; sy++) for (let sx = 0; sx < ss; sx++) {
        const c = px((x + (sx + 0.5) / ss) / size, (y + (sy + 0.5) / ss) / size, mode, scale);
        acc[0] += c[0] * c[3]; acc[1] += c[1] * c[3]; acc[2] += c[2] * c[3]; acc[3] += c[3];
      }
      const o = y * (size * 4 + 1) + 1 + x * 4;
      const a = acc[3] / (ss * ss);
      raw[o] = acc[3] ? Math.round(acc[0] / acc[3]) : 0;
      raw[o + 1] = acc[3] ? Math.round(acc[1] / acc[3]) : 0;
      raw[o + 2] = acc[3] ? Math.round(acc[2] / acc[3]) : 0;
      raw[o + 3] = Math.round(a);
    }
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const files = [
  ['icon.png', 1024, 'full', 0.82],
  ['android-icon-foreground.png', 512, 'fg', 0.6],
  ['android-icon-background.png', 512, 'bg', 1],
  ['android-icon-monochrome.png', 432, 'mono', 0.6],
  ['splash-icon.png', 512, 'fg', 0.9],
  ['favicon.png', 48, 'full', 0.9],
];
for (const [name, size, mode, scale] of files) {
  writeFileSync(join(out, name), png(size, mode, scale));
  console.log('wrote', name);
}
