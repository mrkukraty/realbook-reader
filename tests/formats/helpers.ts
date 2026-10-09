import fs from 'node:fs';
import path from 'node:path';

export function fixture(name: string): Blob {
  const buf = fs.readFileSync(path.resolve(__dirname, '../../fixtures', name));
  return new Blob([new Uint8Array(buf)]);
}
export function blobOf(text: string | Uint8Array): Blob {
  return new Blob([text as BlobPart]);
}

let counter = 0;
export function stubObjectUrls(): void {
  (URL as unknown as Record<string, unknown>).createObjectURL = () => `blob:test/${++counter}`;
  (URL as unknown as Record<string, unknown>).revokeObjectURL = () => {};
}
