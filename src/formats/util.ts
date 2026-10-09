// Shared helpers for format adapters.
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

/** File name without directory and without the (last) extension. */
export function titleFromFileName(fileName: string): string {
  let n = baseName(fileName).replace(/\.fb2\.zip$/i, '');
  n = n.replace(/\.[A-Za-z0-9]{1,6}$/, '');
  n = n.replace(/[_]+/g, ' ').trim();
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

export async function readBytes(blob: Blob): Promise<Uint8Array> {
  if (typeof blob.arrayBuffer === 'function') return new Uint8Array(await blob.arrayBuffer());
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(new Uint8Array(fr.result as ArrayBuffer));
    fr.onerror = () => reject(fr.error);
    fr.readAsArrayBuffer(blob);
  });
}

export async function readHead(blob: Blob, n = 4096): Promise<Uint8Array> {
  return readBytes(blob.slice(0, n));
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function ascii(bytes: Uint8Array, from = 0, to = bytes.length): string {
  let s = '';
  for (let i = from; i < Math.min(to, bytes.length); i++) s += String.fromCharCode(bytes[i]);
  return s;
}

/** Decode bytes to text: BOMs (UTF-8/16), valid UTF-8, UTF-16 without BOM (heuristic), else windows-1252. */
export function decodeText(bytes: Uint8Array): string {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return new TextDecoder('utf-8').decode(bytes.subarray(3));
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  }
  // UTF-16 without BOM: many NUL bytes at alternating positions
  const sample = Math.min(bytes.length, 2000);
  if (sample >= 8) {
    let even = 0;
    let odd = 0;
    for (let i = 0; i < sample; i++) if (bytes[i] === 0) (i % 2 === 0 ? even++ : odd++);
    if (odd > sample * 0.3 && even < sample * 0.02) return new TextDecoder('utf-16le').decode(bytes);
    if (even > sample * 0.3 && odd < sample * 0.02) return new TextDecoder('utf-16be').decode(bytes);
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

/** Natural sort comparator (numbers compared numerically, case-insensitive). */
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
export function naturalCompare(a: string, b: string): number {
  return collator.compare(a, b);
}

export function mimeFromPath(p: string): string {
  const e = p.toLowerCase().split('.').pop() ?? '';
  switch (e) {
    case 'jpg': case 'jpeg': case 'jpe': return 'image/jpeg';
    case 'png': return 'image/png';
    case 'gif': return 'image/gif';
    case 'webp': return 'image/webp';
    case 'avif': return 'image/avif';
    case 'bmp': return 'image/bmp';
    case 'svg': return 'image/svg+xml';
    case 'tif': case 'tiff': return 'image/tiff';
    default: return 'application/octet-stream';
  }
}

export function abortError(): Error {
  if (typeof DOMException !== 'undefined') return new DOMException('Aborted', 'AbortError');
  const e = new Error('Aborted');
  e.name = 'AbortError';
  return e;
}

export function wrapError(e: unknown, what: string): ImportError {
  if (e instanceof ImportError) return e;
  const msg = e instanceof Error ? e.message : String(e);
  return new ImportError(`This ${what} file could not be read: it looks damaged or is not a valid ${what} file. (${msg})`, 'corrupt');
}

/** Resolve a relative path against a base file path (zip-style, forward slashes, no leading slash). */
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

export function textLen(html: string): number {
  return html.replace(/<[^>]*>/g, '').length;
}

export const MAX_UNCOMPRESSED = 500 * 1024 * 1024;
