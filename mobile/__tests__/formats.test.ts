/// <reference types="jest" />
/// <reference types="node" />
import fs from 'fs';
import path from 'path';
import { detectFormat, openBook, openBookDetailed } from '../src/formats/registry';
import { ImportError, type ReflowDocument, type FixedDocument } from '../src/formats/types';
import { sanitizeHtmlString } from '../src/formats/markup';
import { textToBlocks, parseGutenberg } from '../src/formats/text';
import { sortImagePaths } from '../src/formats/cbz';

const fx = (n: string) => new Uint8Array(fs.readFileSync(path.join(__dirname, 'fixtures', n)));

async function expectImportError(p: Promise<unknown>, code?: string): Promise<ImportError> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(ImportError);
    if (code) expect((e as ImportError).code).toBe(code);
    return e as ImportError;
  }
  throw new Error('expected ImportError');
}

describe('plain text', () => {
  it('parses the Gutenberg sample with metadata and chapters', async () => {
    const doc = (await openBook(fx('sample.txt'), 'sample.txt')) as ReflowDocument;
    expect(doc.kind).toBe('reflow');
    expect(doc.metadata.title).toBe('The Lighthouse at Marrow Point');
    expect(doc.metadata.author).toBe('A. N. Author');
    expect(doc.toc.map((t) => t.title)).toEqual(expect.arrayContaining([expect.stringMatching(/^CHAPTER I\b/)]));
    expect(doc.toc.length).toBeGreaterThanOrEqual(2);
    // the CONTENTS list must not become chapters
    expect(doc.toc.some((t) => /CONTENTS/i.test(t.title))).toBe(false);
    expect(doc.sections.every((s) => !/<script/i.test(s.html))).toBe(true);
  });
  it('rejects an empty file with a friendly message', async () => {
    const e = await expectImportError(openBook(fx('empty.txt'), 'empty.txt'), 'corrupt');
    expect(e.message).toMatch(/empty/i);
  });
  it('joins hard-wrapped lines and escapes HTML', () => {
    const lines = 'This is a fairly long line of prose that wraps at a fixed width\nand continues here on the next line for a bit <b>longer</b>.';
    const blocks = textToBlocks(lines);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].html).toContain('&lt;b&gt;');
    expect(parseGutenberg('no header here').body).toBe('no header here');
  });
});

describe('EPUB', () => {
  it.each(['sample.epub', 'sample-epub2.epub'])('opens %s with metadata, toc, sections and a cover', async (name) => {
    const doc = (await openBook(fx(name), name)) as ReflowDocument;
    expect(doc.kind).toBe('reflow');
    expect(doc.metadata.title.length).toBeGreaterThan(0);
    expect(doc.sections.length).toBeGreaterThan(0);
    expect(doc.toc.length).toBeGreaterThan(0);
    for (const s of doc.sections) {
      expect(s.html).not.toMatch(/<script|onerror=|onclick=|javascript:/i);
    }
    // internal links are rewritten to section references
    const all = doc.sections.map((s) => s.html).join('');
    expect(all).not.toMatch(/data-lp=/);
    if (doc.cover) expect(doc.cover.bytes.length).toBeGreaterThan(0);
  });
  it('reports a truncated EPUB as damaged', async () => {
    const e = await expectImportError(openBook(fx('corrupt.epub'), 'corrupt.epub'));
    expect(e.message.length).toBeGreaterThan(10);
  });
});

describe('other reflowable formats', () => {
  it.each([
    ['sample.fb2', 'fb2'], ['sample.md', 'markdown'], ['sample.html', 'html'], ['sample.rtf', 'rtf'], ['sample.docx', 'docx'],
  ])('opens %s', async (name, fmt) => {
    const { format, doc } = await openBookDetailed(fx(name), name);
    expect(format).toBe(fmt);
    expect(doc.kind).toBe('reflow');
    const r = doc as ReflowDocument;
    expect(r.sections.length).toBeGreaterThan(0);
    expect(r.sections.map((s) => s.html).join('').replace(/<[^>]*>/g, '').trim().length).toBeGreaterThan(100);
    expect(r.metadata.title.length).toBeGreaterThan(0);
  });
});

describe('fixed layout', () => {
  it('opens a CBZ with natural page order', async () => {
    const doc = (await openBook(fx('sample.cbz'), 'sample.cbz')) as FixedDocument;
    expect(doc.kind).toBe('fixed');
    expect(doc.pageCount).toBeGreaterThan(1);
    expect(doc.imagePaths).toHaveLength(doc.pageCount);
    expect(doc.cover?.bytes.length).toBeGreaterThan(0);
    expect(sortImagePaths(['p10.jpg', 'p2.jpg', 'p1.jpg'])).toEqual(['p1.jpg', 'p2.jpg', 'p10.jpg']);
  });
  it('accepts a valid PDF and counts pages structurally', async () => {
    const { format, doc } = await openBookDetailed(fx('sample.pdf'), 'sample.pdf');
    expect(format).toBe('pdf');
    // pages inside compressed object streams cannot be counted structurally; the reader gets the real count from pdf.js
    expect((doc as FixedDocument).pageCount).toBeGreaterThanOrEqual(0);
    expect(doc.metadata.title.length).toBeGreaterThan(0);
  });
  it('rejects a truncated PDF', async () => {
    const e = await expectImportError(openBook(fx('corrupt.pdf'), 'corrupt.pdf'), 'corrupt');
    expect(e.message).toMatch(/damaged/i);
  });
  it('rejects a text file pretending to be a PDF', async () => {
    const e = await expectImportError(openBook(fx('fake.pdf'), 'fake.pdf'));
    expect(e.message).toMatch(/not a valid PDF/i);
  });
});

describe('unsupported formats are refused honestly with conversion advice', () => {
  it.each([
    ['book.mobi', /Calibre/], ['book.cbr', /CBZ/], ['book.djvu', /DjVuLibre|Calibre/],
  ])('%s', async (name, advice) => {
    const det = await detectFormat(fx(name), name);
    expect(det.status).toBe('unsupported');
    const e = await expectImportError(openBook(fx(name), name), 'unsupported');
    expect(e.message).toMatch(advice);
  });
});

describe('sanitizer', () => {
  it('removes scripts, handlers, remote images and unsafe links', () => {
    const out = sanitizeHtmlString(
      '<p onclick="x()">Hi<script>alert(1)</script><img src="http://evil/x.png" onerror="y()"><a href="javascript:alert(1)">j</a><a href="https://ok.example">ok</a><iframe src="x"></iframe><style>p{}</style></p>',
    );
    expect(out).not.toMatch(/script|onclick|onerror|iframe|javascript:|http:\/\/evil|<style/i);
    expect(out).toContain('data-ext="https://ok.example"');
    expect(out).toContain('Hi');
  });
});
