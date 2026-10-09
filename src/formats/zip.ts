import JSZip from 'jszip';
import { ImportError } from './types';
import { MAX_UNCOMPRESSED, readBytes } from './util';

export const MAX_ENTRIES = 20_000;

function unsafePath(name: string): boolean {
  if (name.startsWith('/') || name.startsWith('\\') || /^[a-zA-Z]:/.test(name)) return true;
  return name.split(/[\\/]/).some((s) => s === '..');
}

/** Load a ZIP and validate it (entry count, declared uncompressed size, path traversal). */
export async function loadZip(blob: Blob, label = 'archive'): Promise<JSZip> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(await readBytes(blob));
  } catch (e) {
    throw new ImportError(
      `This ${label} is damaged or incomplete (it is not a readable ZIP archive). Try downloading or exporting it again.`,
      'corrupt',
    );
  }
  validateZip(zip, label);
  return zip;
}

export function validateZip(zip: JSZip, label = 'archive'): void {
  let total = 0;
  let count = 0;
  for (const [name, entry] of Object.entries(zip.files)) {
    count++;
    if (count > MAX_ENTRIES) {
      throw new ImportError(`This ${label} contains too many files (more than ${MAX_ENTRIES}) and was rejected for safety.`, 'too-large');
    }
    if (unsafePath(name)) {
      throw new ImportError(`This ${label} contains unsafe file paths (path traversal) and was rejected.`, 'corrupt');
    }
    const size = (entry as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize;
    if (typeof size === 'number' && !entry.dir) {
      total += size;
      if (total > MAX_UNCOMPRESSED) {
        throw new ImportError(
          `This ${label} would expand to more than ${Math.round(MAX_UNCOMPRESSED / 1048576)} MB and was rejected (possible zip bomb).`,
          'too-large',
        );
      }
    }
  }
}

export async function zipText(zip: JSZip, path: string): Promise<string | undefined> {
  const f = findEntry(zip, path);
  if (!f) return undefined;
  return f.async('string');
}

/** Case-insensitive fallback lookup. */
export function findEntry(zip: JSZip, path: string): JSZip.JSZipObject | undefined {
  const direct = zip.file(path);
  if (direct) return direct;
  const lower = path.toLowerCase();
  for (const name of Object.keys(zip.files)) {
    if (name.toLowerCase() === lower && !zip.files[name].dir) return zip.files[name];
  }
  return undefined;
}
