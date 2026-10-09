import { beforeAll, describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { detectFormat, openBook, supportedAdapters, unsupportedFormats } from '../../src/formats/registry';
import { sanitizeHtml, splitLargeSection } from '../../src/formats/sanitize';
import { ImportError, type ReflowDocument, type FixedDocument } from '../../src/formats/types';
import { sortImagePaths } from '../../src/formats/cbz';
import { textToBlocks } from '../../src/formats/text';
import { fixture, blobOf, stubObjectUrls } from './helpers';

beforeAll(() => stubObjectUrls());

const reflow = async (f: string) => (await openBook(fixture(f), f)) as ReflowDocument;
const fmt = async (f: string, as = f) => {
  const d = await detectFormat(fixture(f), as);
  return d.status === 'supported' ? d.adapter.id : d.status === 'unsupported' ? d.format : 'unknown';
};

describe('detection', () => {
  it('detects by content and extension', async () => {
    expect(await fmt('sample.epub')).toBe('epub');
    expect(await fmt('sample.pdf')).toBe('pdf');
    expect(await fmt('sample.txt')).toBe('txt');
    expect(await fmt('sample.md')).toBe('markdown');
    expect(await fmt('sample.html')).toBe('html');
    expect(await fmt('sample.fb2')).toBe('fb2');
    expect(await fmt('sample.docx')).toBe('docx');
    expect(await fmt('sample.rtf')).toBe('rtf');
    expect(await fmt('sample.cbz')).toBe('cbz');
  });
  it('content wins over a wrong extension', async () => {
    expect(await fmt('sample.epub', 'book.zip')).toBe('epub');
    expect(await fmt('sample.pdf', 'book.txt')).toBe('pdf');
    expect(await fmt('sample.docx', 'x.bin')).toBe('docx');
    expect(await fmt('sample.cbz', 'comic.zip')).toBe('cbz');
    expect(await fmt('sample.rtf', 'a.txt')).toBe('rtf');
  });
  it('lists adapters and unsupported formats', () => {
    expect(supportedAdapters.map((a) => a.id)).toEqual(expect.arrayContaining(['epub', 'pdf', 'txt', 'cbz']));
    expect(unsupportedFormats.map((u) => u.format).sort()).toEqual(['azw', 'cbr', 'djvu', 'mobi']);
  });
  it('unsupported formats give honest messages naming the file', async () => {
    for (const [f, word] of [['book.mobi', 'Calibre'], ['book.djvu', 'DjVuLibre'], ['book.cbr', 'CBZ']] as const) {
      const d = await detectFormat(fixture(f), f);
      expect(d.status).toBe('unsupported');
      if (d.status === 'unsupported') { expect(d.message).toContain(f); expect(d.message).toContain(word); }
      await expect(openBook(fixture(f), f)).rejects.toMatchObject({ code: 'unsupported' });
    }
    const azw = await detectFormat(blobOf('x'), 'my.azw3');
    expect(azw.status === 'unsupported' && azw.message).toMatch(/DRM/);
  });
});

describe('epub', () => {
  it('parses EPUB3 metadata, toc, cover, links, images', async () => {
    const d = await reflow('sample.epub');
    expect(d.metadata.title).toBe('The Lighthouse at Marrow Point');
    expect(d.metadata.author).toBe('A. N. Author');
    expect(d.metadata.language).toBe('en');
    expect(d.metadata.publisher).toBe('Fixture Press');
    expect(d.cover).toBeInstanceOf(Blob);
    expect(d.sections.length).toBe(6);
    expect(d.toc.length).toBe(6);
    expect(d.toc[0].children?.[0].title).toBe('Opening');
    expect(d.toc[3].target).toEqual({ section: 3 });
    const s0 = d.sections[0].html;
    expect(s0).toContain('data-sec="1"');
    expect(s0).toMatch(/data-sec="3" data-anchor="p4-start"|data-anchor="p4-start"[^>]*data-sec="3"/);
    expect(s0).toMatch(/data-sec="0"[^>]*data-anchor="p1-start"|data-anchor="p1-start"[^>]*data-sec="0"/);
    expect(s0).toContain('src="blob:test/');
    expect(s0).toContain('id="p1-start"');
    expect(s0).not.toMatch(/<script/i);
    expect(s0).not.toMatch(/ch2\.xhtml/);
    expect(s0).toContain('href="http://example.com/x"');
    d.dispose();
  });
  it('parses EPUB2 with ncx and meta cover', async () => {
    const d = await reflow('sample-epub2.epub');
    expect(d.metadata.title).toContain('EPUB2');
    expect(d.toc.map((t) => t.title)[1]).toBe('A Stranger on the Shore');
    expect(d.cover).toBeInstanceOf(Blob);
  });
  it('rejects corrupt epub', async () => {
    await expect(openBook(fixture('corrupt.epub'), 'corrupt.epub')).rejects.toMatchObject({ name: 'ImportError', code: 'corrupt' });
  });
  async function epubWith(extra: Record<string, string>): Promise<Blob> {
    const zip = await JSZip.loadAsync(await (fixture('sample.epub') as Blob).arrayBuffer());
    for (const [k, v] of Object.entries(extra)) zip.file(k, v);
    return new Blob([await zip.generateAsync({ type: "arraybuffer" })]);
  }
  it('rejects DRM (rights.xml / non-font encryption)', async () => {
    await expect(openBook(await epubWith({ 'META-INF/rights.xml': '<rights/>' }), 'a.epub')).rejects.toMatchObject({ code: 'drm' });
    const enc = '<encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container" xmlns:enc="http://www.w3.org/2001/04/xmlenc#"><enc:EncryptedData><enc:EncryptionMethod Algorithm="http://www.w3.org/2001/04/xmlenc#aes128-cbc"/></enc:EncryptedData></encryption>';
    await expect(openBook(await epubWith({ 'META-INF/encryption.xml': enc }), 'a.epub')).rejects.toMatchObject({ code: 'drm' });
    const font = enc.replace('http://www.w3.org/2001/04/xmlenc#aes128-cbc', 'http://www.idpf.org/2008/embedding');
    await expect(openBook(await epubWith({ 'META-INF/encryption.xml': font }), 'a.epub')).resolves.toBeTruthy();
  });
  it('rejects path traversal', async () => {
    await expect(openBook(await epubWith({ '../evil.txt': 'x' }), 'a.epub')).rejects.toBeInstanceOf(ImportError);
  });
});

describe('sanitize', () => {
  it('removes scripts, handlers, javascript: urls; keeps ids, images, tables', () => {
    const out = sanitizeHtml('<h1 id="a" onclick="x()">T</h1><script>alert(1)</script><img src="blob:x/1" onerror="alert(1)"><a href="javascript:alert(1)">l</a><iframe src="x"></iframe><form><input></form><table><tr><td>1</td></tr></table><style>@import url(x)</style>');
    expect(out).not.toMatch(/script|onerror|onclick|javascript:|iframe|form|style|input/i);
    expect(out).toContain('id="a"');
    expect(out).toContain('<img src="blob:x/1"');
    expect(out).toContain('<table>');
  });
  it('splitLargeSection splits at block boundaries', () => {
    const html = Array.from({ length: 50 }, (_, i) => `<p>${'x'.repeat(5000)}${i}</p>`).join('');
    const parts = splitLargeSection(html);
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) { expect(p.length).toBeLessThanOrEqual(130_000); expect(p.startsWith('<p>')).toBe(true); }
    expect(parts.join('').match(/<p>/g)?.length).toBe(50);
    expect(splitLargeSection('<p>small</p>')).toEqual(['<p>small</p>']);
  });
  it('splitLargeSection unwraps a single huge wrapper div', () => {
    const html = '<div>' + Array.from({ length: 40 }, () => `<p>${'y'.repeat(5000)}</p>`).join('') + '</div>';
    expect(splitLargeSection(html).length).toBeGreaterThan(1);
  });
});

describe('text formats', () => {
  it('txt: gutenberg metadata, chapters, header/footer stripped', async () => {
    const d = await reflow('sample.txt');
    expect(d.metadata.title).toBe('The Lighthouse at Marrow Point');
    expect(d.metadata.author).toBe('A. N. Author');
    expect(d.toc.length).toBeGreaterThanOrEqual(6);
    expect(d.toc.some((t) => /The Lighthouse Keeper/.test(t.title))).toBe(true);
    const all = d.sections.map((s) => s.html).join('');
    expect(all).not.toContain('License text');
    expect(all).not.toContain('START OF THE PROJECT');
  });
  it('txt: encodings', async () => {
    const utf16 = new Uint8Array([0xff, 0xfe, ...Array.from('Hello wörld', (c) => [c.charCodeAt(0), 0]).flat()]);
    const d = (await openBook(blobOf(utf16), 'u16.txt')) as ReflowDocument;
    expect(d.sections[0].html).toContain('Hello wörld');
    const latin = (await openBook(blobOf(new Uint8Array([0x63, 0x61, 0x66, 0xe9])), 'l.txt')) as ReflowDocument;
    expect(latin.sections[0].html).toContain('café');
    expect(latin.metadata.title).toBe('l');
  });
  it('txt: chapter heading detection and size splitting', () => {
    const body = 'body text here that is long enough '.repeat(12);
    const t = ['CHAPTER I', 'word '.repeat(100), 'Chapter 2', body, 'III.', 'more'].join(String.fromCharCode(10, 10));
    const heads = textToBlocks(t).filter((b) => b.heading).map((b) => b.heading);
    expect(heads).toEqual(['CHAPTER I', 'Chapter 2', 'III.']);
  });
  it('txt: empty file rejected, large file fast and split', async () => {
    await expect(openBook(fixture('empty.txt'), 'empty.txt')).rejects.toBeInstanceOf(ImportError);
    const d = await reflow('large.txt');
    expect(d.sections.length).toBeGreaterThan(50);
    expect(Math.max(...d.sections.map((s) => s.html.length))).toBeLessThan(130_000);
  }, 60_000);
  it('markdown: splits on h1/h2, front matter, anchors, sanitizes', async () => {
    const d = await reflow('sample.md');
    expect(d.metadata.title).toBe('The Lighthouse (Markdown)');
    expect(d.sections.length).toBe(7);
    expect(d.toc.length).toBe(6);
    expect(d.toc[0].children?.[0].title).toBe('A quiet beginning');
    const all = d.sections.map((s) => s.html).join('');
    expect(all).not.toMatch(/<script/);
    expect(all).toMatch(/data-sec="6"[^>]*data-anchor="marrow-point-at-dusk"|data-anchor="marrow-point-at-dusk"[^>]*data-sec="6"/);
    expect(all).toContain('<table>');
  });
  it('html: sanitizes and splits', async () => {
    const d = await reflow('sample.html');
    expect(d.metadata.title).toBe('The Lighthouse (HTML)');
    const all = d.sections.map((s) => s.html).join('');
    expect(all).not.toMatch(/script|onerror|onload|javascript:|@import/i);
    expect(d.sections.length).toBe(6);
    expect(all).toContain('data-anchor="c3"');
  });
  it('fb2: metadata, cover, chapters, notes links, images', async () => {
    const d = await reflow('sample.fb2');
    expect(d.metadata.title).toBe('The Lighthouse (FB2)');
    expect(d.metadata.author).toBe('A. N. Author');
    expect(d.metadata.publisher).toBe('Fixture Press');
    expect(d.cover).toBeInstanceOf(Blob);
    expect(d.sections.length).toBe(7);
    expect(d.sections[0].html).toMatch(/data-sec="6"/);
    expect(d.sections[0].html).toContain('<img src="blob:test/');
    expect(d.toc[0].title).toBe('The Lighthouse Keeper');
  });
  it('fb2.zip', async () => {
    const zip = new JSZip();
    zip.file('book.fb2', await (fixture('sample.fb2') as Blob).arrayBuffer());
    const blob = new Blob([await zip.generateAsync({ type: "arraybuffer" })]);
    const d = (await openBook(blob, 'book.fb2.zip')) as ReflowDocument;
    expect(d.metadata.title).toBe('The Lighthouse (FB2)');
  });
  it('docx: metadata and heading toc', async () => {
    const d = await reflow('sample.docx');
    expect(d.metadata.title).toBe('The Lighthouse (DOCX)');
    expect(d.metadata.author).toBe('A. N. Author');
    expect(d.toc.length).toBe(6);
    expect(d.sections[0].html).toContain('lighthouse at Marrow Point');
  });
  it('rtf: text, unicode, hex escapes, info, chapters', async () => {
    const d = await reflow('sample.rtf');
    expect(d.metadata.title).toBe('The Lighthouse (RTF)');
    expect(d.metadata.author).toBe('A. N. Author');
    expect(d.toc.length).toBe(6);
    const all = d.sections.map((s) => s.html).join('');
    expect(all).toContain('café');
    expect(all).toContain('—');
    expect(all).toContain('<em>');
    expect(all).not.toMatch(/Times New Roman|fonttbl/);
  });
});

describe('cbz', () => {
  it('natural page order', () => {
    expect(sortImagePaths(['p10.png', 'p2.png', 'p1.png', 'a/p3.png'])).toEqual(['p1.png', 'p2.png', 'p10.png', 'a/p3.png']);
  });
  it('opens fixed document without text', async () => {
    const d = (await openBook(fixture('sample.cbz'), 'sample.cbz')) as FixedDocument;
    expect(d.kind).toBe('fixed');
    expect(d.pageCount).toBe(10);
    expect(d.hasText).toBe(false);
    expect(d.metadata.title).toBe('Test Comic');
    expect(d.cover).toBeInstanceOf(Blob);
    expect(await d.getPageText(0)).toBe('');
    const host = document.createElement('div');
    await d.renderPage(2, host, { width: 200, height: 300, signal: new AbortController().signal });
    expect(host.querySelector('img')).toBeTruthy();
    const ac = new AbortController(); ac.abort();
    await expect(d.renderPage(1, host, { width: 1, height: 1, signal: ac.signal })).rejects.toMatchObject({ name: 'AbortError' });
    d.dispose();
  });
});
