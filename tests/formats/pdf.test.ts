import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { configurePdf } from '../../src/formats/pdf';
import { openBook } from '../../src/formats/registry';
import type { FixedDocument } from '../../src/formats/types';
import { fixture } from './helpers';

configurePdf({
  workerSrc: pathToFileURL(path.resolve(__dirname, '../../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs')).href,
  assetBase: null,
});

describe('pdf', () => {
  it('opens sample.pdf: metadata, pages, outline, text', async () => {
    const d = (await openBook(fixture('sample.pdf'), 'sample.pdf')) as FixedDocument;
    expect(d.kind).toBe('fixed');
    expect(d.pageCount).toBe(24);
    expect(d.metadata.title).toBe('Sample PDF Book');
    expect(d.metadata.author).toBe('A. N. Author');
    expect(d.hasText).toBe(true);
    expect(d.aspect).toBeCloseTo(420 / 595, 2);
    expect(d.toc.map((t) => t.title)).toEqual(['Chapter 1', 'Chapter 2', 'Chapter 3', 'Chapter 4', 'Chapter 5']);
    expect(d.toc[2].target).toEqual({ page: 9 });
    expect(await d.getPageText(0)).toContain('Page 1');
    d.dispose();
  }, 30000);
  it('scanned pdf has no text', async () => {
    const d = (await openBook(fixture('scanned.pdf'), 'scanned.pdf')) as FixedDocument;
    expect(d.hasText).toBe(false);
    expect(d.pageCount).toBe(4);
    expect(d.metadata.title).toBe('scanned');
    d.dispose();
  }, 30000);
  it('corrupt and fake pdfs give friendly errors', async () => {
    await expect(openBook(fixture('fake.pdf'), 'fake.pdf')).rejects.toMatchObject({ name: 'ImportError', code: 'corrupt' });
    await expect(openBook(fixture('corrupt.pdf'), 'corrupt.pdf')).rejects.toMatchObject({ name: 'ImportError' });
  }, 30000);
});
