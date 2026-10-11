// Continuous text view for PDFs (pure, unit-tested). PDF pages are grouped into chapters (from the PDF outline,
// or fixed-size chunks), and each chapter's pages are joined into one flowing document: a paragraph cut by a
// printed page break is stitched back together. Every chapter remembers where each source page starts in its
// text, so position, bookmarks and the "page N" label still refer to the original PDF page.
import { htmlToText } from './page-html';

export interface PdfChapter { start: number; end: number; title: string } // pages [start, end)
export interface JoinedChapter { html: string; chars: number; pageOffsets: { page: number; offset: number }[] }

const CHUNK = 15;

/** Chapters from outline entries (page numbers, 0-based). Long or missing chapters are cut into CHUNK-page parts. */
export function pdfChapters(pageCount: number, outline: { title: string; page: number }[]): PdfChapter[] {
  const n = Math.max(0, Math.floor(pageCount));
  if (!n) return [];
  const starts = new Map<number, string>();
  for (const o of outline) {
    if (Number.isInteger(o.page) && o.page >= 0 && o.page < n && !starts.has(o.page)) starts.set(o.page, o.title.trim() || `Page ${o.page + 1}`);
  }
  if (!starts.has(0)) starts.set(0, starts.size ? 'Beginning' : 'Page 1');
  const sorted = [...starts.entries()].sort((a, b) => a[0] - b[0]);
  const out: PdfChapter[] = [];
  sorted.forEach(([start, title], i) => {
    const end = i + 1 < sorted.length ? sorted[i + 1][0] : n;
    for (let s = start; s < end; s += CHUNK) {
      const e = Math.min(end, s + CHUNK);
      // fold a tiny tail into the previous part instead of leaving a 1-2 page chapter
      if (s > start && e - s < 4 && out.length) { out[out.length - 1].end = e; break; }
      out.push({ start: s, end: e, title: s === start ? title : `${title} (p. ${s + 1})` });
    }
  });
  return out;
}

export function chapterOfPage(chapters: PdfChapter[], page: number): number {
  const i = chapters.findIndex((c) => page >= c.start && page < c.end);
  return i >= 0 ? i : Math.max(0, chapters.length - 1);
}

const BLOCK = /<(p|h2)>([\s\S]*?)<\/\1>/g;
const ENDS_SENTENCE = /[.!?:;"'”’)\]…]\s*$/;

/** Join the rebuilt HTML of consecutive PDF pages into one flowing chapter. */
export function joinPdfPages(pages: { page: number; html: string }[]): JoinedChapter {
  const blocks: { tag: string; text: string; page: number }[] = [];
  const pageOffsets: { page: number; offset: number }[] = [];
  let chars = 0;
  for (const { page, html } of pages) {
    const found = [...html.matchAll(BLOCK)].map((m) => ({ tag: m[1], text: m[2].trim() })).filter((b) => b.text);
    if (!found.length) {
      pageOffsets.push({ page, offset: chars });
      const note = `[Page ${page + 1} has no selectable text - it may be a picture or scanned. See it in Pages view.]`;
      blocks.push({ tag: 'note', text: note, page });
      chars += note.length;
      continue;
    }
    found.forEach((b, i) => {
      const prev = blocks[blocks.length - 1];
      const prevText = prev ? htmlToText(prev.text) : '';
      // first paragraph on a page continuing the last one of the previous page
      const continues = i === 0 && prev && prev.tag === 'p' && b.tag === 'p' && prev.page !== page && !ENDS_SENTENCE.test(prevText);
      if (continues) {
        const hyphen = /[A-Za-z]-$/.test(prevText) && /^[a-z]/.test(htmlToText(b.text));
        pageOffsets.push({ page, offset: hyphen ? chars - 1 : chars + 1 });
        if (hyphen) { prev.text = prev.text.slice(0, -1) + b.text; chars += htmlToText(b.text).length - 1; } else { prev.text += ` ${b.text}`; chars += htmlToText(b.text).length + 1; }
        return;
      }
      if (i === 0) pageOffsets.push({ page, offset: chars });
      blocks.push({ tag: b.tag, text: b.text, page });
      chars += htmlToText(b.text).length;
    });
  }
  const html = blocks.map((b) => (b.tag === 'note'
    ? `<p style="text-indent:0;text-align:center;opacity:.6;font-style:italic">${b.text}</p>`
    : `<${b.tag}>${b.text}</${b.tag}>`)).join('');
  return { html, chars, pageOffsets };
}

/** The source PDF page shown at a character offset of a joined chapter. */
export function pageAtOffset(j: Pick<JoinedChapter, 'pageOffsets'>, offset: number): number {
  let page = j.pageOffsets[0]?.page ?? 0;
  for (const p of j.pageOffsets) { if (p.offset <= offset) page = p.page; else break; }
  return page;
}

/** Character offset where a PDF page starts in a joined chapter (or null if it is not in it). */
export function offsetOfPage(j: Pick<JoinedChapter, 'pageOffsets'>, page: number): number | null {
  return j.pageOffsets.find((p) => p.page === page)?.offset ?? null;
}
