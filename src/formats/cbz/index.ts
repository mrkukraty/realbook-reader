import type JSZip from 'jszip';
import { ImportError, type FixedDocument, type FormatAdapter, type RenderPageOptions } from '../types';
import { abortError, extOf, finalizeMeta, mimeFromPath, naturalCompare, wrapError } from '../util';
import { loadZip } from '../zip';
import { all, tryParseXml, textOf } from '../xml';

const IMG_RE = /\.(jpe?g|png|gif|webp|avif|bmp)$/i;
const LRU_SIZE = 6;

/** Natural order over path segments so "ch2/p10" sorts after "ch2/p9" and directories group together. */
export function sortImagePaths(paths: string[]): string[] {
  return [...paths].sort((a, b) => {
    const sa = a.split('/'), sb = b.split('/');
    for (let i = 0; i < Math.min(sa.length, sb.length); i++) {
      if (sa[i] !== sb[i]) {
        const lastA = i === sa.length - 1, lastB = i === sb.length - 1;
        if (lastA !== lastB) return lastA ? -1 : 1; // files before sub-folders at the same level
        return naturalCompare(sa[i], sb[i]);
      }
    }
    return sa.length - sb.length;
  });
}

async function measure(url: string): Promise<number | null> {
  if (typeof Image === 'undefined') return null;
  return new Promise((resolve) => {
    const img = new Image();
    const t = setTimeout(() => resolve(null), 1500);
    img.onload = () => { clearTimeout(t); resolve(img.naturalWidth && img.naturalHeight ? img.naturalWidth / img.naturalHeight : null); };
    img.onerror = () => { clearTimeout(t); resolve(null); };
    img.src = url;
  });
}

export async function openCbz(data: Blob, fileName: string): Promise<FixedDocument> {
  const zip: JSZip = await loadZip(data, 'comic archive');
  const paths = sortImagePaths(
    Object.values(zip.files)
      .filter((f) => !f.dir && IMG_RE.test(f.name) && !f.name.startsWith('__MACOSX/') && !/(^|\/)\./.test(f.name))
      .map((f) => f.name),
  );
  if (!paths.length) throw new ImportError('This comic archive contains no page images.', 'corrupt');

  let meta: { title?: string; author?: string } = {};
  const ci = Object.values(zip.files).find((f) => /(^|\/)ComicInfo\.xml$/i.test(f.name));
  if (ci) {
    const d = tryParseXml(await ci.async('string'));
    if (d) meta = { title: textOf(all(d, 'Title')[0]) || textOf(all(d, 'Series')[0]), author: textOf(all(d, 'Writer')[0]) };
  }

  const pageBlob = async (i: number) => {
    const bytes = await zip.file(paths[i])!.async('uint8array');
    return new Blob([bytes as BlobPart], { type: mimeFromPath(paths[i]) });
  };
  const cover = await pageBlob(0);
  const cache = new Map<number, string>();
  const getUrl = async (i: number): Promise<string> => {
    const hit = cache.get(i);
    if (hit) { cache.delete(i); cache.set(i, hit); return hit; }
    const url = URL.createObjectURL(await pageBlob(i));
    cache.set(i, url);
    while (cache.size > LRU_SIZE) {
      const oldest = cache.keys().next().value as number;
      URL.revokeObjectURL(cache.get(oldest)!);
      cache.delete(oldest);
    }
    return url;
  };
  let aspect = 2 / 3;
  if (typeof URL.createObjectURL === 'function') {
    const u = URL.createObjectURL(cover);
    aspect = (await measure(u)) ?? aspect;
    URL.revokeObjectURL(u);
  }

  return {
    kind: 'fixed',
    metadata: finalizeMeta({ title: meta.title, author: meta.author }, fileName),
    cover,
    pageCount: paths.length,
    aspect,
    toc: [],
    hasText: false,
    async renderPage(index: number, host: HTMLElement, opts: RenderPageOptions) {
      if (opts.signal.aborted) throw abortError();
      const url = await getUrl(index);
      if (opts.signal.aborted) throw abortError();
      const img = document.createElement('img');
      img.src = url;
      img.alt = `Page ${index + 1}`;
      img.draggable = false;
      img.style.cssText = `display:block;margin:0 auto;width:${opts.width}px;height:${opts.height}px;object-fit:contain`;
      if (typeof img.decode === 'function') {
        try { await img.decode(); } catch { /* shown anyway */ }
      }
      if (opts.signal.aborted) throw abortError();
      host.replaceChildren(img);
    },
    async getPageText() { return ''; },
    dispose() {
      for (const u of cache.values()) URL.revokeObjectURL(u);
      cache.clear();
    },
  };
}

export const cbzAdapter: FormatAdapter = {
  id: 'cbz',
  label: 'Comic book (CBZ)',
  extensions: ['cbz', 'zip'],
  detect: (head, fileName) => head[0] === 0x50 && head[1] === 0x4b && ['cbz', 'zip'].includes(extOf(fileName)),
  async open(data, fileName) {
    try { return await openCbz(data, fileName); } catch (e) { throw wrapError(e, 'comic'); }
  },
};
