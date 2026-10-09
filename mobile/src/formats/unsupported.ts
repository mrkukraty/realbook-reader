import type { FormatId } from './types';
import { baseName, titleFromFileName } from './util';

export interface UnsupportedFormat { format: FormatId; label: string; extensions: string[]; message(fileName: string): string }

const n = (f: string) => `"${baseName(f) || titleFromFileName(f)}"`;

export const unsupportedFormats: UnsupportedFormat[] = [
  {
    format: 'cbr', label: 'CBR (RAR comic archive)', extensions: ['cbr', 'rar'],
    message: (f) => `${n(f)} is a CBR (RAR-compressed comic) file. RealBook Reader cannot open RAR archives. Re-save it as CBZ (a ZIP of the same images) with 7-Zip or Calibre: extract the RAR, zip the images, rename the .zip to .cbz, then import it again.`,
  },
  {
    format: 'mobi', label: 'MOBI', extensions: ['mobi', 'prc'],
    message: (f) => `${n(f)} is a MOBI file, which RealBook Reader does not support. Convert it to EPUB with Calibre (ebook-convert book.mobi book.epub) and import the EPUB. DRM-protected files cannot be converted, and we do not bypass DRM.`,
  },
  {
    format: 'azw', label: 'AZW / AZW3 (Kindle)', extensions: ['azw', 'azw3', 'azw4', 'kfx'],
    message: (f) => `${n(f)} is a Kindle (AZW/AZW3) file, which RealBook Reader does not support. If it is DRM-free, convert it to EPUB with Calibre (ebook-convert book.azw3 book.epub). DRM-protected Kindle books cannot be converted, and we do not bypass DRM.`,
  },
  {
    format: 'djvu', label: 'DjVu', extensions: ['djvu', 'djv'],
    message: (f) => `${n(f)} is a DjVu file, which RealBook Reader does not support. Convert it to PDF or EPUB with DjVuLibre (ddjvu -format=pdf) or Calibre, then import the result.`,
  },
];

export function unsupportedFor(format: FormatId): UnsupportedFormat | undefined {
  return unsupportedFormats.find((u) => u.format === format);
}
