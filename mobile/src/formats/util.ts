import { ImportError, type BookMetadata, type TocItem } from './types';

export function baseName(fileName: string): string {
  const parts = fileName.split(/[\\/]/);
  return parts[parts.length - 1] || fileName;
}

export function extOf(fileName: string): string {
  const n = baseName(fileName).toLowerCase();
  if (n.endsWith('.fb2.zip')) return 'fb2.zip';
  const i = n.lastIndexOf('.');
  return i < 0 ? '' : n.slice(i + 1);
}

export function titleFromFileName(fileName: string): string {
  let n = baseName(fileName).replace(/\.fb2\.zip$/i, '');
  n = n.replace(/\.[A-Za-z0-9]{1,6}$/, '');
  n = n.replace(/_+/g, ' ').trim();
  return n || 'Untitled';
}

export function finalizeMeta(meta: Partial<BookMetadata>, fileName: string): BookMetadata {
  const clean = (s?: string) => (s ?? '').replace(/\s+/g, ' ').trim() || undefined;
  return {
    title: clean(meta.title) ?? titleFromFileName(fileName),
    author: clean(meta.author),
    language: clean(meta.language),
    publisher: clean(meta.publisher),
    published: clean(meta.published),
    description: clean(meta.description),
  };
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function ascii(bytes: Uint8Array, from = 0, to = bytes.length): string {
  let s = '';
  for (let i = from; i < Math.min(to, bytes.length); i++) s += String.fromCharCode(bytes[i]);
  return s;
}

function latin1(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x4000) s += String.fromCharCode(...bytes.subarray(i, i + 0x4000));
  return s;
}

function utf8Decode(bytes: Uint8Array, fatal: boolean): string {
  if (typeof TextDecoder !== 'undefined') {
    try {
      return new TextDecoder('utf-8', { fatal }).decode(bytes);
    } catch (e) {
      if (fatal && e instanceof TypeError) throw e;
      // engines without the `fatal` option fall through to the manual decoder
    }
  }
  return utf8DecodeManual(bytes, fatal);
}

/** Small UTF-8 decoder used when the JS engine lacks a (complete) TextDecoder. */
export function utf8DecodeManual(bytes: Uint8Array, fatal: boolean): string {
  const out: string[] = [];
  let chunk: number[] = [];
  const flush = () => { if (chunk.length) { out.push(String.fromCharCode(...chunk)); chunk = []; } };
  const bad = () => { if (fatal) throw new TypeError('invalid utf-8'); return 0xfffd; };
  for (let i = 0; i < bytes.length;) {
    const b = bytes[i];
    let cp: number;
    let need = 0;
    if (b < 0x80) { cp = b; } else if (b >= 0xc2 && b < 0xe0) { cp = b & 0x1f; need = 1; } else if (b >= 0xe0 && b < 0xf0) { cp = b & 0x0f; need = 2; } else if (b >= 0xf0 && b < 0xf5) { cp = b & 0x07; need = 3; } else { cp = bad(); i++; chunk.push(cp); continue; }
    let ok = true;
    for (let k = 1; k <= need; k++) {
      const c = bytes[i + k];
      if (c === undefined || (c & 0xc0) !== 0x80) { ok = false; break; }
      cp = (cp << 6) | (c & 0x3f);
    }
    if (!ok) { chunk.push(bad()); i++; continue; }
    i += need + 1;
    if (cp > 0xffff) { cp -= 0x10000; chunk.push(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff)); } else chunk.push(cp);
    if (chunk.length > 8000) flush();
  }
  flush();
  return out.join('');
}

function utf16(bytes: Uint8Array, le: boolean): string {
  let s = '';
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    s += String.fromCharCode(le ? bytes[i] | (bytes[i + 1] << 8) : (bytes[i] << 8) | bytes[i + 1]);
  }
  return s;
}

/** Decode bytes to text: BOMs, UTF-16 heuristic, valid UTF-8, else windows-1252 (approximated by latin1). */
export function decodeText(bytes: Uint8Array): string {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return utf8Decode(bytes.subarray(3), false);
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return utf16(bytes.subarray(2), true);
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return utf16(bytes.subarray(2), false);
  const sample = Math.min(bytes.length, 2000);
  if (sample >= 8) {
    let even = 0;
    let odd = 0;
    for (let i = 0; i < sample; i++) if (bytes[i] === 0) (i % 2 === 0 ? even++ : odd++);
    if (odd > sample * 0.3 && even < sample * 0.02) return utf16(bytes, true);
    if (even > sample * 0.3 && odd < sample * 0.02) return utf16(bytes, false);
  }
  try {
    return utf8Decode(bytes, true);
  } catch {
    return latin1(bytes);
  }
}

export function naturalCompare(a: string, b: string): number {
  const ra = a.toLowerCase().split(/(\d+)/);
  const rb = b.toLowerCase().split(/(\d+)/);
  for (let i = 0; i < Math.min(ra.length, rb.length); i++) {
    if (ra[i] === rb[i]) continue;
    if (i % 2 === 1) return Number(ra[i]) - Number(rb[i]);
    return ra[i] < rb[i] ? -1 : 1;
  }
  return ra.length - rb.length;
}

export function mimeFromPath(p: string): string {
  const e = p.toLowerCase().split('.').pop() ?? '';
  switch (e) {
    case 'jpg': case 'jpeg': case 'jpe': return 'image/jpeg';
    case 'png': return 'image/png';
    case 'gif': return 'image/gif';
    case 'webp': return 'image/webp';
    case 'bmp': return 'image/bmp';
    case 'svg': return 'image/svg+xml';
    default: return 'application/octet-stream';
  }
}

export function wrapError(e: unknown, what: string): ImportError {
  if (e instanceof ImportError) return e;
  const msg = e instanceof Error ? e.message : String(e);
  return new ImportError(`This ${what} file could not be read: it looks damaged or is not a valid ${what} file. (${msg})`, 'corrupt');
}

export function resolvePath(baseFile: string, href: string): string {
  let h = href;
  try { h = decodeURIComponent(href); } catch { /* keep */ }
  if (h.startsWith('/')) return normalizePath(h.slice(1));
  const dir = baseFile.includes('/') ? baseFile.slice(0, baseFile.lastIndexOf('/') + 1) : '';
  return normalizePath(dir + h);
}

export function normalizePath(p: string): string {
  const out: string[] = [];
  for (const seg of p.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') out.pop();
    else out.push(seg);
  }
  return out.join('/');
}

export function countTocItems(toc: TocItem[]): number {
  let n = 0;
  for (const t of toc) n += 1 + (t.children ? countTocItems(t.children) : 0);
  return n;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
export function toBase64(bytes: Uint8Array): string {
  let out = '';
  const n = bytes.length;
  for (let i = 0; i < n; i += 3) {
    const a = bytes[i], b = i + 1 < n ? bytes[i + 1] : 0, c = i + 2 < n ? bytes[i + 2] : 0;
    out += B64[a >> 2] + B64[((a & 3) << 4) | (b >> 4)];
    out += i + 1 < n ? B64[((b & 15) << 2) | (c >> 6)] : '=';
    out += i + 2 < n ? B64[c & 63] : '=';
  }
  return out;
}

export function fromBase64(s: string): Uint8Array {
  const clean = s.replace(/[^A-Za-z0-9+/]/g, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const v = [0, 1, 2, 3].map((k) => (i + k < clean.length ? B64.indexOf(clean[i + k]) : 0));
    const n = (v[0] << 18) | (v[1] << 12) | (v[2] << 6) | v[3];
    if (o < out.length) out[o++] = (n >> 16) & 255;
    if (o < out.length) out[o++] = (n >> 8) & 255;
    if (o < out.length) out[o++] = n & 255;
  }
  return out;
}

export function dataUri(bytes: Uint8Array, mime: string): string {
  return `data:${mime};base64,${toBase64(bytes)}`;
}
