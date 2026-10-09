import JSZip from 'jszip';
import {
  ImportError, type BookDocument, type Detection, type FormatAdapter, type FormatId, type ProgressCb,
} from './types';
import { ascii, baseName, extOf, finalizeMeta, readBytes, readHead } from './util';
import { unsupportedFor, unsupportedFormats } from './unsupported';
import { epubAdapter } from './epub';
import { pdfAdapter } from './pdf';
import { textAdapter } from './text';
import { htmlAdapter } from './html';
import { markdownAdapter } from './markdown';
import { fb2Adapter } from './fb2';
import { docxAdapter } from './docx';
import { rtfAdapter } from './rtf';
import { cbzAdapter } from './cbz';

export { unsupportedFormats };
export const supportedAdapters: FormatAdapter[] = [
  epubAdapter, pdfAdapter, textAdapter, htmlAdapter, markdownAdapter, fb2Adapter, docxAdapter, rtfAdapter, cbzAdapter,
];

const IMG_RE = /\.(jpe?g|png|gif|webp|avif|bmp)$/i;

const EXT_TO_FORMAT: Record<string, FormatId> = {
  epub: 'epub', pdf: 'pdf', txt: 'txt', text: 'txt', html: 'html', htm: 'html', xhtml: 'html',
  md: 'markdown', markdown: 'markdown', fb2: 'fb2', 'fb2.zip': 'fb2', docx: 'docx', rtf: 'rtf', cbz: 'cbz',
  cbr: 'cbr', rar: 'cbr', mobi: 'mobi', prc: 'mobi', azw: 'azw', azw3: 'azw', azw4: 'azw', kfx: 'azw',
  djvu: 'djvu', djv: 'djvu',
};

async function sniffZip(file: Blob): Promise<FormatId | 'zip' | null> {
  try {
    const zip = await JSZip.loadAsync(await readBytes(file));
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
  const adapter = supportedAdapters.find((a) => a.id === id);
  if (adapter) return { status: 'supported', adapter };
  return { status: 'unknown', message: `"${baseName(fileName)}" is not a recognised book format.` };
}

export async function detectFormat(file: Blob & { name?: string }, fileName?: string): Promise<Detection> {
  const name = fileName ?? file.name ?? 'book';
  const ext = extOf(name);
  const extFmt = EXT_TO_FORMAT[ext];
  const head = await readHead(file, 4096);
  const h = (i: number) => head[i];

  if (ascii(head, 0, 1024).includes('%PDF-')) return toDetection('pdf', name);
  if (ascii(head, 0, 4) === 'Rar!') return toDetection('cbr', name);
  if (ascii(head, 0, 8) === 'AT&TFORM') return toDetection('djvu', name);
  if (ascii(head, 60, 68) === 'BOOKMOBI' || ascii(head, 60, 68) === 'TEXtREAd') {
    return toDetection(extFmt === 'azw' ? 'azw' : 'mobi', name);
  }
  if (ascii(head, 0, 5) === '{\\rtf') return toDetection('rtf', name);
  if (h(0) === 0x50 && h(1) === 0x4b) {
    const z = await sniffZip(file);
    if (z && z !== 'zip') return toDetection(z, name);
    if (extFmt && ['epub', 'docx', 'cbz', 'fb2', 'azw'].includes(extFmt)) return toDetection(extFmt, name);
    return { status: 'unknown', message: `"${baseName(name)}" is a ZIP archive that does not contain a book (no EPUB, DOCX, FB2 or comic images).` };
  }
  // text-like content
  const looksBinary = head.subarray(0, 2000).includes(0) && !(h(0) === 0xff && h(1) === 0xfe) && !(h(0) === 0xfe && h(1) === 0xff);
  if (!looksBinary) {
    const probe = ascii(head, 0, 2000);
    if (/<FictionBook/i.test(probe)) return toDetection('fb2', name);
    if (extFmt === 'markdown') return toDetection('markdown', name);
    if (extFmt === 'html' || /^\s*(<!doctype html|<html)/i.test(probe)) return toDetection('html', name);
    // extension claims a binary format but content is text: let that adapter report a friendly error
    if (extFmt && !['txt', 'html', 'markdown'].includes(extFmt)) return toDetection(extFmt, name);
    return toDetection('txt', name);
  }
  if (extFmt) return toDetection(extFmt, name);
  return { status: 'unknown', message: `"${baseName(name)}" is not a recognised book format.` };
}

export async function openBook(file: Blob, fileName: string, onProgress?: ProgressCb): Promise<BookDocument> {
  const det = await detectFormat(file, fileName);
  if (det.status === 'unsupported') throw new ImportError(det.message, 'unsupported');
  if (det.status === 'unknown') throw new ImportError(det.message, 'unsupported');
  let doc: BookDocument;
  try {
    doc = await det.adapter.open(file, fileName, onProgress);
  } catch (e) {
    if (e instanceof ImportError) throw e;
    throw new ImportError(`"${baseName(fileName)}" could not be opened: ${e instanceof Error ? e.message : String(e)}`, 'corrupt');
  }
  if (!doc.metadata.title?.trim()) doc.metadata = finalizeMeta(doc.metadata, fileName);
  return doc;
}
