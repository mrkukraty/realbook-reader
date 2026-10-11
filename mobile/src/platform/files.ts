// expo-file-system (SDK 57 object API) storage for book files. Layout:
//   <documents>/books/<id>/original.<ext>   imported copy of the user's file
//   <documents>/books/<id>/content.json     ContentManifest (sections meta + TOC)
//   <documents>/books/<id>/s/<n>.html       sanitized section HTML (reflowable formats)
//   <documents>/books/<id>/cover.<ext>      cover image
//   <cache>/pages/<id>/<page>-<w>.jpg       rendered PDF / extracted CBZ pages (re-creatable)
import { Directory, File, Paths } from 'expo-file-system';
import * as Crypto from 'expo-crypto';
import type { BookFileStore } from '../import/importer';
import type { ContentManifest } from '../storage/types';

const booksDir = () => new Directory(Paths.document, 'books');
const bookDir = (id: string) => new Directory(Paths.document, 'books', id);
const pagesDir = (id: string) => new Directory(Paths.cache, 'pages', id);

function ensureDir(d: Directory) {
  if (!d.exists) d.create({ intermediates: true, idempotent: true } as never);
}

const extForMime = (mime: string) => (/png/.test(mime) ? 'png' : /gif/.test(mime) ? 'gif' : /webp/.test(mime) ? 'webp' : 'jpg');

export const fileStore: BookFileStore = {
  async saveOriginal(id, ext, bytes) {
    const d = bookDir(id);
    ensureDir(d);
    new File(d, `original.${ext.replace(/[^a-z0-9.]/gi, '') || 'bin'}`).write(bytes);
  },
  async saveCover(id, bytes, mime) {
    const d = bookDir(id);
    ensureDir(d);
    const f = new File(d, `cover.${extForMime(mime)}`);
    f.write(bytes);
    return f.uri;
  },
  async saveContent(id, manifest, sectionsHtml) {
    const d = bookDir(id);
    ensureDir(d);
    new File(d, 'content.json').write(JSON.stringify(manifest));
    if (sectionsHtml.length) {
      const s = new Directory(d, 's');
      ensureDir(s);
      sectionsHtml.forEach((h, i) => new File(s, `${i}.html`).write(h));
    }
  },
  async deleteBook(id) {
    const d = bookDir(id);
    if (d.exists) d.delete();
    const p = pagesDir(id);
    if (p.exists) p.delete();
  },
};

export function originalFile(id: string, fileName: string): File {
  const ext = (fileName.toLowerCase().endsWith('.fb2.zip') ? 'fb2.zip' : fileName.split('.').pop() ?? 'bin').replace(/[^a-z0-9.]/gi, '') || 'bin';
  return new File(bookDir(id), `original.${ext}`);
}

export async function readManifest(id: string): Promise<ContentManifest> {
  const f = new File(bookDir(id), 'content.json');
  if (!f.exists) throw new Error('The book content is missing on this device. Remove the book and import it again.');
  return JSON.parse(await f.text()) as ContentManifest;
}

const sectionCache = new Map<string, string>();
export async function readSection(id: string, n: number): Promise<string> {
  const key = `${id}:${n}`;
  const hit = sectionCache.get(key);
  if (hit !== undefined) return hit;
  const f = new File(bookDir(id), 's', `${n}.html`);
  const html = f.exists ? await f.text() : '<p>(This part of the book is missing.)</p>';
  sectionCache.set(key, html);
  if (sectionCache.size > 12) sectionCache.delete(sectionCache.keys().next().value as string);
  return html;
}

export function pageCacheFile(id: string, page: number, width: number, tag = ''): File {
  const d = pagesDir(id);
  ensureDir(d);
  return new File(d, `${page}-${width}${tag ? `-${tag}` : ''}.jpg`);
}
export function pageCacheFileExt(id: string, page: number, ext: string): File {
  const d = pagesDir(id);
  ensureDir(d);
  return new File(d, `${page}.${ext}`);
}

export function clearPageCache(): void {
  const d = new Directory(Paths.cache, 'pages');
  if (d.exists) d.delete();
}

function dirSize(d: Directory): number {
  if (!d.exists) return 0;
  let total = 0;
  for (const e of d.list()) {
    if (e instanceof Directory) total += dirSize(e);
    else total += (e as File).size ?? 0;
  }
  return total;
}

export function storageUsage(): { books: number; cache: number; free: number | null; total: number | null } {
  let free: number | null = null;
  let total: number | null = null;
  try { free = Paths.availableDiskSpace; total = Paths.totalDiskSpace; } catch { /* not available */ }
  let books = 0;
  let cache = 0;
  try { books = dirSize(booksDir()); } catch { /* ignore */ }
  try { cache = dirSize(new Directory(Paths.cache, 'pages')); } catch { /* ignore */ }
  return { books, cache, free, total };
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const buf = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, bytes as unknown as ArrayBuffer);
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}
