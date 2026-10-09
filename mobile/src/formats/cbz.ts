import type JSZip from 'jszip';
import { ImportError, type FixedDocument } from './types';
import { finalizeMeta, mimeFromPath, naturalCompare, wrapError } from './util';
import { loadZip } from './zip';
import { findAll, parseXmlDoc, textOf } from './markup';

export const IMG_RE = /\.(jpe?g|png|gif|webp|bmp)$/i;

/** Natural order over path segments so "ch2/p10" sorts after "ch2/p9". */
export function sortImagePaths(paths: string[]): string[] {
  return [...paths].sort((a, b) => {
    const sa = a.split('/'), sb = b.split('/');
    for (let i = 0; i < Math.min(sa.length, sb.length); i++) {
      if (sa[i] !== sb[i]) {
        const lastA = i === sa.length - 1, lastB = i === sb.length - 1;
        if (lastA !== lastB) return lastA ? -1 : 1;
        return naturalCompare(sa[i], sb[i]);
      }
    }
    return sa.length - sb.length;
  });
}

export function imagePathsOf(zip: JSZip): string[] {
  return sortImagePaths(
    Object.values(zip.files)
      .filter((f) => !f.dir && IMG_RE.test(f.name) && !f.name.startsWith('__MACOSX/') && !/(^|\/)\./.test(f.name))
      .map((f) => f.name),
  );
}

export async function openCbz(data: Uint8Array, fileName: string): Promise<FixedDocument> {
  try {
    const zip = await loadZip(data, 'comic archive');
    const paths = imagePathsOf(zip);
    if (!paths.length) throw new ImportError('This comic archive contains no page images.', 'corrupt');
    let meta: { title?: string; author?: string } = {};
    const ci = Object.values(zip.files).find((f) => /(^|\/)ComicInfo\.xml$/i.test(f.name));
    if (ci) {
      try {
        const d = parseXmlDoc(await ci.async('string'));
        meta = { title: textOf(findAll(d, 'Title')[0]) || textOf(findAll(d, 'Series')[0]), author: textOf(findAll(d, 'Writer')[0]) };
      } catch { /* ignore bad ComicInfo */ }
    }
    const cover = { bytes: await zip.file(paths[0])!.async('uint8array'), mime: mimeFromPath(paths[0]) };
    return {
      kind: 'fixed',
      metadata: finalizeMeta({ title: meta.title, author: meta.author }, fileName),
      cover, pageCount: paths.length, aspect: 2 / 3, toc: [], hasText: false, imagePaths: paths,
    };
  } catch (e) {
    throw wrapError(e, 'comic');
  }
}
