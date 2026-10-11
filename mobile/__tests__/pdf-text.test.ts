/// <reference types="jest" />
import { PDF_TEXT_JS } from '../src/reader/pdf-text-js';
import { chapterOfPage, joinPdfPages, offsetOfPage, pageAtOffset, pdfChapters } from '../src/reader/pdf-reflow';
import { htmlToText } from '../src/reader/page-html';
import { addReading, dayKey, emptyStats, formatMinutes, lastDays, pagesPerMinute, streak, today } from '../src/stats/reading-stats';

// the WebView-side rebuild code, evaluated as the WebView would run it
// eslint-disable-next-line @typescript-eslint/no-implied-eval
const { toHtml } = new Function(`${PDF_TEXT_JS}; return { toHtml };`)() as { toHtml(items: unknown[]): string };

/** a pdf.js text run: baseline at (x, y), font size h, approximate width */
const run = (str: string, x: number, y: number, h = 11) => ({ str, transform: [h, 0, 0, h, x, y], height: h, width: str.length * h * 0.48, hasEOL: false });
const blocks = (html: string) => [...html.matchAll(/<(p|h2)>([\s\S]*?)<\/\1>/g)].map((m) => `${m[1]}:${m[2]}`);

describe('PDF text rebuild (WebView side)', () => {
  it('joins lines into paragraphs and splits on indents and short last lines', () => {
    const html = toHtml([
      run('Most of the retail investors invest all of their money in', 50, 500),
      run('a single stock, or some of the small investors invest all', 40, 486),
      run('of their savings in popular stocks.', 40, 472),
      run('I think this strategy is not a good investment strategy and', 50, 458),
      run('so I invented a basic idea.', 40, 444),
    ]);
    expect(blocks(html)).toEqual([
      'p:Most of the retail investors invest all of their money in a single stock, or some of the small investors invest all of their savings in popular stocks.',
      'p:I think this strategy is not a good investment strategy and so I invented a basic idea.',
    ]);
  });

  it('keeps a drop cap with its word and does not make the line a heading', () => {
    const html = toHtml([
      run('Treat Your Stock Market', 110, 540, 16),
      run('M', 40, 500, 17),
      run('ost of the retail investors (small investors) invest all of', 57, 500),
      run('their money in a single stock, or some of the small investors.', 40, 486),
    ]);
    expect(blocks(html)).toEqual([
      'h2:Treat Your Stock Market',
      'p:Most of the retail investors (small investors) invest all of their money in a single stock, or some of the small investors.',
    ]);
  });

  it('repairs ligatures, soft hyphens and line-end hyphenation', () => {
    const html = toHtml([
      run('The proﬁt of this sin­gle stock was unfortu-', 40, 500),
      run('nately very small for every investor in the market.', 40, 486),
    ]);
    expect(blocks(html)).toEqual(['p:The profit of this single stock was unfortunately very small for every investor in the market.']);
  });

  it('drops page numbers and running headers, escapes markup', () => {
    const html = toHtml([
      run('Foreword', 180, 575, 9),
      run('Profit & loss <rules> apply to every retail investor in', 40, 500),
      run('the market, and to every shop on the street as well.', 40, 486),
      run('12', 205, 30, 10),
    ]);
    expect(blocks(html)).toEqual(['p:Profit &amp; loss &lt;rules&gt; apply to every retail investor in the market, and to every shop on the street as well.']);
  });

  it('returns nothing for pages without text (scanned)', () => {
    expect(toHtml([])).toBe('');
  });
});

describe('PDF continuous text view', () => {
  it('builds chapters from the outline and splits long ones', () => {
    const ch = pdfChapters(60, [{ title: 'Foreword', page: 2 }, { title: 'One', page: 10 }]);
    expect(ch[0]).toEqual({ start: 0, end: 2, title: 'Beginning' });
    expect(ch[1]).toEqual({ start: 2, end: 10, title: 'Foreword' });
    expect(ch.slice(2).map((c) => [c.start, c.end])).toEqual([[10, 25], [25, 40], [40, 55], [55, 60]]);
    expect(chapterOfPage(ch, 41)).toBe(4);
    // no outline: fixed-size parts, tiny tail folded into the last one
    expect(pdfChapters(32, []).map((c) => [c.start, c.end])).toEqual([[0, 15], [15, 32]]);
    expect(pdfChapters(0, [])).toEqual([]);
  });

  it('stitches a paragraph cut by a page break and keeps page offsets', () => {
    const j = joinPdfPages([
      { page: 4, html: '<h2>Title</h2><p>First paragraph ends here.</p><p>Second one runs over the page and is unfortu-</p>' },
      { page: 5, html: '<p>nately continued on the next page.</p><p>A new paragraph.</p>' },
      { page: 6, html: '<p>Fresh page, fresh paragraph.</p>' },
    ]);
    expect(blocks(j.html)).toEqual([
      'h2:Title',
      'p:First paragraph ends here.',
      'p:Second one runs over the page and is unfortunately continued on the next page.',
      'p:A new paragraph.',
      'p:Fresh page, fresh paragraph.',
    ]);
    const text = htmlToText(j.html);
    expect(j.chars).toBe(text.length);
    const off5 = offsetOfPage(j, 5)!;
    expect(text.slice(off5, off5 + 6)).toBe('nately');
    const off6 = offsetOfPage(j, 6)!;
    expect(text.slice(off6, off6 + 5)).toBe('Fresh');
    expect(pageAtOffset(j, 0)).toBe(4);
    expect(pageAtOffset(j, off5 + 3)).toBe(5);
    expect(pageAtOffset(j, j.chars)).toBe(6);
  });

  it('marks pages without text instead of silently skipping them', () => {
    const j = joinPdfPages([{ page: 0, html: '<p>Hello there.</p>' }, { page: 1, html: '' }]);
    expect(j.html).toContain('Page 2 has no selectable text');
    expect(offsetOfPage(j, 1)).toBe('Hello there.'.length);
  });
});

describe('reading stats', () => {
  const day = (d: number, h = 12) => new Date(2026, 9, d, h);
  it('adds time and pages per day and computes the streak', () => {
    let s = emptyStats();
    s = addReading(s, 20 * 60_000, 12, day(7));
    s = addReading(s, 5 * 60_000, 3, day(8));
    s = addReading(s, 30_000, 0, day(9)); // under a minute: does not count for the streak
    s = addReading(s, 10 * 60_000, 6, day(10, 8));
    expect(today(s, day(10))).toEqual({ ms: 10 * 60_000, pages: 6 });
    expect(streak(s, day(10))).toBe(1);
    expect(streak(s, day(8, 23))).toBe(2);
    // nothing read yet today: the streak up to yesterday still shows
    expect(streak(s, day(9, 7))).toBe(2);
    expect(dayKey(day(7))).toBe('2026-10-07');
  });

  it('summarises the last days and the reading pace', () => {
    let s = emptyStats();
    expect(pagesPerMinute(s, day(10))).toBeNull();
    s = addReading(s, 20 * 60_000, 30, day(9));
    const week = lastDays(s, 7, day(10));
    expect(week).toHaveLength(7);
    expect(week[5]).toMatchObject({ key: '2026-10-09', ms: 20 * 60_000, pages: 30 });
    expect(pagesPerMinute(s, day(10))).toBeCloseTo(1.5);
    expect(formatMinutes(25 * 60_000)).toBe('25 min');
    expect(formatMinutes(135 * 60_000)).toBe('2 h 15 min');
  });
});
