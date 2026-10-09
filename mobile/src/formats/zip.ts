import JSZip from 'jszip';
import { ImportError } from './types';

export async function loadZip(bytes: Uint8Array, what: string): Promise<JSZip> {
  try {
    return await JSZip.loadAsync(bytes);
  } catch {
    throw new ImportError(`This ${what} file is damaged: the ZIP container could not be read.`, 'corrupt');
  }
}

export function findEntry(zip: JSZip, path: string): JSZip.JSZipObject | null {
  const direct = zip.file(path);
  if (direct) return direct;
  const lc = path.toLowerCase();
  for (const name of Object.keys(zip.files)) {
    if (name.toLowerCase() === lc && !zip.files[name].dir) return zip.files[name];
  }
  return null;
}

export async function zipText(zip: JSZip, path: string): Promise<string | undefined> {
  const f = findEntry(zip, path);
  return f ? f.async('string') : undefined;
}
