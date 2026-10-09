const MB = 1024 * 1024;
/** Above this size we do not hash the whole file. */
export const FULL_HASH_LIMIT = 200 * MB;
const EDGE = 8 * MB;

function hex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function readBlob(b: Blob): Promise<ArrayBuffer> {
  if (typeof b.arrayBuffer === 'function') return b.arrayBuffer();
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result as ArrayBuffer);
    r.onerror = () => rej(r.error);
    r.readAsArrayBuffer(b);
  });
}

/**
 * SHA-256 of the file bytes (hex).
 * For files larger than 200 MB we hash only the first 8 MB + last 8 MB + the exact size
 * (prefixed "p:") to stay fast and memory-safe; collisions are practically impossible for
 * real books yet duplicates are still detected reliably.
 */
export async function hashBlob(blob: Blob): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error('This browser cannot compute file fingerprints (secure context required).');
  if (blob.size <= FULL_HASH_LIMIT) {
    return hex(await subtle.digest('SHA-256', await readBlob(blob)));
  }
  const head = new Uint8Array(await readBlob(blob.slice(0, EDGE)));
  const tail = new Uint8Array(await readBlob(blob.slice(blob.size - EDGE)));
  const size = new TextEncoder().encode(String(blob.size));
  const all = new Uint8Array(head.length + tail.length + size.length);
  all.set(head, 0); all.set(tail, head.length); all.set(size, head.length + tail.length);
  return 'p:' + hex(await subtle.digest('SHA-256', all));
}
