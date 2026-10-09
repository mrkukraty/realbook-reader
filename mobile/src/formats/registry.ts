import JSZip from 'jszip';
import { ImportError, type BookDocument, type Detection, type FixedDocument, type FormatId, type ProgressCb } from './types';
import { ascii, baseName, extOf, finalizeMeta } from './util';
import { unsupportedFor, unsupportedFormats } from './unsupported';
import { openText } from './text';
import { openEpub } from './epub';
import { openFb2 } from './fb2';
import { openHtml, openMarkdown } from './htmlDocs';
import { openRtf } from './rtf';
import { openDocx } from './docx';
import { openCbz, IMG_RE } from './cbz';

export { unsupportedFormats };

export interface SupportedFormatInfo { id: FormatId; label: string; extensions: string[]; notes: string }
export const supportedFormats: SupportedFormatInfo[] = [
  { id: 'epub', label: 'EPUB 2/3', extensions: ['epub'], notes: 'Reflowable, TOC, images, internal links. DRM-protected files are refused.' },
  { id: 'pdf', label: 'PDF', extensions: ['pdf'], notes: 'Rendered page images via pdf.js inside a WebView; text search where the PDF has a text layer.' },
  { id: 'txt', label: 'Plain text', extensions: ['txt', 'text'], notes: 'Chapter detection, Gutenberg header parsing.' },
  { id: 'markdown', label: 'Markdown', extensions: ['md', 'markdown'], notes: 'Remote images are dropped.' },
  { id: 'html', label: 'HTML', extensions: ['html', 'htm', 'xhtml'], notes: 'Sanitized; scripts and remote resources removed.' },
  { id: 'fb2', label: 'FictionBook', extensions: ['fb2', 'fb2.zip'], notes: 'Embedded images and notes.' },
  { id: 'docx', label: 'Word (DOCX)', extensions: ['docx'], notes: 'Text, headings, bold/italic only (no tables/images).' },
  { id: 'rtf', label: 'Rich Text', extensions: ['rtf'], notes: 'Text, bold/italic, heading heuristics.' },
  { id: 'cbz', label: 'Comic (CBZ)', extensions: ['cbz'], notes: 'ZIP of images, natural page order.' },
];

const EXT_TO_FORMAT: Record<string, FormatId> = {
  epub: 'epub', pdf: 'pdf', txt: 'txt', text: 'txt', html: 'html', htm: 'html', xhtml: 'html',
  md: 'markdown', markdown: 'markdown', fb2: 'fb2', 'fb2.zip': 'fb2', docx: 'docx', rtf: 'rtf', cbz: 'cbz',
  cbr: 'cbr', rar: 'cbr', mobi: 'mobi', prc: 'mobi', azw: 'azw', azw3: 'azw', azw4: 'azw', kfx: 'azw',
  djvu: 'djvu', djv: 'djvu',
};

/** Size limits (bytes): everything is parsed in JS memory on the phone. */
export const MAX_SIZE: Partial<Record<FormatId, number>> & { default: number } = {
  default: 60 * 1024 * 1024, pdf: 120 * 1024 * 1024, cbz: 150 * 1024 * 1024, txt: 30 * 1024 * 1024,
};

async function sniffZip(bytes: Uint8Array): Promise<FormatId | 'zip' | null> {
  try {
    const zip = await JSZip.loadAsync(bytes);
    const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir);
    if (zip.file('mimetype') || zip.file('META-INF/container.xml')) return 'epub';
    if (zip.file('word/document.xml')) return 'docx';
    if (names.some((n) => /\.fb2$/i.test(n))) return 'fb2';
    if (names.some((n) => IMG_RE.test(n) && !n.startsWith('__MACOSX/'))) return 'cbz';
    return 'zip';
  } catch {
    return null;
  }
}

function toDetection(id: FormatId, fileName: string): Detection {
  const un = unsupportedFor(id);
  if (un) return { status: 'unsupported', format: un.format, label: un.label, message: un.message(fileName) };
  if (supportedFormats.some((f) => f.id === id)) return { status: 'supported', format: id };
  return { status: 'unknown', message: `"${baseName(fileName)}" is not a recognised book format.` };
}

/** Detect from content (magic bytes) first, then extension. */
export async function detectFormat(bytes: Uint8Array, name: string): Promise<Detection> {
  const ext = extOf(name);
  const extFmt = EXT_TO_FORMAT[ext];
  const head = bytes.subarray(0, 4096);
  if (ascii(head, 0, 1024).includes('%PDF-')) return toDetection('pdf', name);
  if (ascii(head, 0, 4) === 'Rar!') return toDetection('cbr', name);
  if (ascii(head, 0, 8) === 'AT&TFORM') return toDetection('djvu', name);
  if (ascii(head, 60, 68) === 'BOOKMOBI' || ascii(head, 60, 68) === 'TEXtREAd') return toDetection(extFmt === 'azw' ? 'azw' : 'mobi', name);
  if (ascii(head, 0, 5) === '{\\rtf') return toDetection('rtf', name);
  if (head[0] === 0x50 && head[1] === 0x4b) {
    const z = await sniffZip(bytes);
    if (z && z !== 'zip') return toDetection(z, name);
    if (z === null && extFmt && ['epub', 'docx', 'cbz', 'fb2'].includes(extFmt)) return toDetection(extFmt, name);
    return { status: 'unknown', message: `"${baseName(name)}" is a ZIP archive that does not contain a book (no EPUB, DOCX, FB2 or comic images).` };
  }
  const looksBinary = head.subarray(0, 2000).includes(0) && !(head[0] === 0xff && head[1] === 0xfe) && !(head[0] === 0xfe && head[1] === 0xff);
  if (!looksBinary) {
    const probe = ascii(head, 0, 2000);
    if (/<FictionBook/i.test(probe)) return toDetection('fb2', name);
    if (extFmt === 'markdown') return toDetection('markdown', name);
    if (extFmt === 'html' || /^\s*(<!doctype html|<html)/i.test(probe)) return toDetection('html', name);
    if (extFmt && !['txt', 'html', 'markdown'].includes(extFmt)) {
      // extension claims a binary format but content is plain text
      const un = unsupportedFor(extFmt);
      if (un) return toDetection(extFmt, name);
      return { status: 'unknown', message: `"${baseName(name)}" has a .${ext} extension but is not a valid ${ext.toUpperCase()} file (it contains plain text). It may be damaged or misnamed.` };
    }
    return toDetection('txt', name);
  }
  if (extFmt) return toDetection(extFmt, name);
  return { status: 'unknown', message: `"${baseName(name)}" is not a recognised book format.` };
}

/** Structural PDF check (full rendering happens in the reader through pdf.js). */
export function inspectPdf(bytes: Uint8Array, fileName: string): FixedDocument {
  const len = bytes.length;
  const tail = ascii(bytes, Math.max(0, len - 2048), len);
  if (!tail.includes('%%EOF')) {
    throw new ImportError(`"${baseName(fileName)}" is a damaged PDF (the file is truncated or incomplete). Try downloading it again.`, 'corrupt');
  }
  // count page objects in the uncompressed parts (may be 0 when pages live in object streams; then the reader counts)
  let s = '';
  const step = 1 << 16;
  let pages = 0;
  let title: string | undefined;
  for (let i = 0; i < len; i += step) {
    s = ascii(bytes, Math.max(0, i - 32), Math.min(len, i + step));
    const m = s.match(/\/Type\s*\/Page(?![s\w])/g);
    if (m) pages += m.length;
    if (!title) { const t = /\/Title\s*\(([^)]{1,200})\)/.exec(s); if (t) title = t[1]; }
  }
  return {
    kind: 'fixed', metadata: finalizeMeta({ title }, fileName), pageCount: pages, aspect: 0.707, toc: [], hasText: true,
  };
}

export async function openBook(bytes: Uint8Array, fileName: string, onProgress?: ProgressCb): Promise<BookDocument> {
  return (await openBookDetailed(bytes, fileName, onProgress)).doc;
}

export async function openBookDetailed(bytes: Uint8Array, fileName: string, onProgress?: ProgressCb): Promise<{ format: FormatId; doc: BookDocument }> {
  const det = await detectFormat(bytes, fileName);
  if (det.status !== 'supported') throw new ImportError(det.message, 'unsupported');
  const limit = MAX_SIZE[det.format] ?? MAX_SIZE.default;
  if (bytes.length > limit) {
    throw new ImportError(`"${baseName(fileName)}" is too large (${Math.round(bytes.length / 1048576)} MB). The phone version supports ${det.format.toUpperCase()} files up to ${Math.round(limit / 1048576)} MB.`, 'too-large');
  }
  let doc: BookDocument;
  try {
    switch (det.format) {
      case 'epub': doc = await openEpub(bytes, fileName, onProgress); break;
      case 'txt': doc = openText(bytes, fileName); break;
      case 'html': doc = openHtml(bytes, fileName); break;
      case 'markdown': doc = openMarkdown(bytes, fileName); break;
      case 'fb2': doc = await openFb2(bytes, fileName); break;
      case 'rtf': doc = openRtf(bytes, fileName); break;
      case 'docx': doc = await openDocx(bytes, fileName); break;
      case 'cbz': doc = await openCbz(bytes, fileName); break;
      case 'pdf': doc = inspectPdf(bytes, fileName); break;
      default: throw new ImportError(`"${baseName(fileName)}" is not supported.`, 'unsupported');
    }
  } catch (e) {
    if (e instanceof ImportError) throw e;
    throw new ImportError(`"${baseName(fileName)}" could not be opened: ${e instanceof Error ? e.message : String(e)}`, 'corrupt');
  }
  if (!doc.metadata.title?.trim()) doc.metadata = finalizeMeta(doc.metadata, fileName);
  return { format: det.format, doc };
}

export const formatLabel = (f: FormatId) =>
  supportedFormats.find((s) => s.id === f)?.label ?? unsupportedFormats.find((u) => u.format === f)?.label ?? f.toUpperCase();
