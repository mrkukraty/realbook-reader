import JSZip from 'jszip';
import type { File } from 'expo-file-system';
import { pageCacheFileExt } from '../platform/files';
import { imagePathsOf } from '../formats/cbz';

/** Extracts comic pages lazily from the imported archive into the cache directory. */
export async function createCbzProvider(bookId: string, original: File, knownPaths?: string[]) {
  const zip = await JSZip.loadAsync(await original.bytes());
  const paths = knownPaths?.length ? knownPaths : imagePathsOf(zip);
  const inflight = new Map<number, Promise<string>>();
  const getPageUri = (page: number): Promise<string> => {
    const hit = inflight.get(page);
    if (hit) return hit;
    const pr = (async () => {
      const path = paths[page];
      if (!path) throw new Error('Page not found in archive.');
      const ext = (path.split('.').pop() ?? 'jpg').toLowerCase();
      const f = pageCacheFileExt(bookId, page, ext);
      if (!f.exists) {
        const entry = zip.file(path);
        if (!entry) throw new Error('Page image is missing from the archive.');
        f.write(await entry.async('uint8array'));
      }
      return f.uri;
    })();
    inflight.set(page, pr);
    pr.catch(() => inflight.delete(page));
    if (inflight.size > 40) inflight.delete(inflight.keys().next().value as number);
    return pr;
  };
  return { pageCount: paths.length, getPageUri };
}
