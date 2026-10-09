/** Extensions the file picker offers. The registry (src/formats) is the source of truth for parsing. */
export const SUPPORTED_FORMATS: { label: string; ext: string[] }[] = [
  { label: 'EPUB', ext: ['epub'] },
  { label: 'PDF', ext: ['pdf'] },
  { label: 'Plain text', ext: ['txt', 'text'] },
  { label: 'HTML', ext: ['html', 'htm', 'xhtml'] },
  { label: 'Markdown', ext: ['md', 'markdown'] },
  { label: 'FictionBook', ext: ['fb2'] },
  { label: 'Word (DOCX)', ext: ['docx'] },
  { label: 'Rich Text', ext: ['rtf'] },
  { label: 'Comic archive (CBZ)', ext: ['cbz'] },
];

export const UNSUPPORTED_FORMATS: { label: string; ext: string[]; reason: string }[] = [
  { label: 'Comic archive (CBR)', ext: ['cbr'], reason: 'RAR archives cannot be opened safely in the browser. Re-save the comic as CBZ.' },
  { label: 'Kindle (MOBI/AZW)', ext: ['mobi', 'azw', 'azw3'], reason: 'Proprietary and often DRM-protected. Convert to EPUB first (for example with Calibre) if you own the book.' },
  { label: 'DjVu', ext: ['djvu', 'djv'], reason: 'No safe decoder is available. Convert to PDF first.' },
];

export const ACCEPT_EXTENSIONS = SUPPORTED_FORMATS.flatMap((f) => f.ext.map((e) => '.' + e));
export const ACCEPT_ATTR = ACCEPT_EXTENSIONS.join(',');

export function unsupportedHint(ext: string): string | undefined {
  const e = ext.toLowerCase().replace(/^\./, '');
  const u = UNSUPPORTED_FORMATS.find((f) => f.ext.includes(e));
  return u ? `${u.label}: ${u.reason}` : undefined;
}
