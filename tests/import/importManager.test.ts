import { beforeEach, describe, expect, it, vi } from 'vitest';

const dispose = vi.fn();
const openBookMock = vi.fn();
const detectMock = vi.fn();

vi.mock('../../src/formats/registry', () => ({
  detectFormat: (...a: unknown[]) => detectMock(...a),
  openBook: (...a: unknown[]) => openBookMock(...a),
}));
vi.mock('../../src/utils/cover', () => ({
  makeThumbnail: vi.fn(async () => undefined),
  renderFixedCover: vi.fn(async () => undefined),
  makePlaceholderCover: vi.fn(async () => new Blob(['cover'])),
}));
// the module-level singleton is not used: tests pass their own storage
vi.mock('../../src/storage', () => ({ storage: {} }));

import { importFiles, QUOTA_MESSAGE } from '../../src/features/import/importManager';
import { BrowserStorage } from '../../src/storage/BrowserStorage';
import { ImportError } from '../../src/formats/types';
import { StorageQuotaError } from '../../src/storage/StorageAdapter';

let store: BrowserStorage; let n = 0;
beforeEach(() => {
  store = new BrowserStorage(`imp-${++n}-${Math.random()}`);
  dispose.mockReset(); openBookMock.mockReset(); detectMock.mockReset();
  detectMock.mockImplementation(async (f: File) => {
    if (f.name.endsWith('.mobi')) return { status: 'unsupported', format: 'mobi', label: 'MOBI', message: 'MOBI is not supported.' };
    if (f.name.endsWith('.zzz')) return { status: 'unknown', message: 'Unknown file type.' };
    return { status: 'supported', adapter: { id: f.name.endsWith('.pdf') ? 'pdf' : 'epub' } };
  });
  openBookMock.mockImplementation(async (b: Blob, name: string) => {
    const text = await b.text();
    if (text.includes('CORRUPT')) throw new ImportError('This EPUB is damaged.', 'corrupt');
    return { kind: 'reflow', metadata: { title: name.startsWith('untitled') ? '' : 'Title of ' + name, author: 'A' }, sections: [], toc: [], dispose };
  });
});

const file = (name: string, content: string) => new File([content], name);

describe('importFiles', () => {
  it('imports a book: stores record, file, cover, and disposes the doc', async () => {
    const [it1] = await importFiles([file('a.epub', 'alpha')], undefined, { storage: store });
    expect(it1.status).toBe('done');
    const books = await store.listBooks();
    expect(books).toHaveLength(1);
    expect(books[0]).toMatchObject({ format: 'epub', fileName: 'a.epub', size: 5, metadata: { title: 'Title of a.epub' } });
    expect(books[0].cover).toBeTruthy();
    expect(books[0].hash).toMatch(/^[0-9a-f]{64}$/);
    expect(await store.getBookFile(books[0].id)).toBeTruthy();
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('falls back to file name when title is empty', async () => {
    await importFiles([file('untitled-book.epub', 'zz')], undefined, { storage: store });
    expect((await store.listBooks())[0].metadata.title).toBe('untitled-book');
  });

  it('reports duplicates by content hash with the existing book id', async () => {
    const [first] = await importFiles([file('a.epub', 'same')], undefined, { storage: store });
    const [dup] = await importFiles([file('copy.epub', 'same')], undefined, { storage: store });
    expect(dup.status).toBe('duplicate');
    expect(dup.bookId).toBe(first.bookId);
    expect(dup.message).toMatch(/already in your library/i);
    expect(await store.listBooks()).toHaveLength(1);
  });

  it('flags unsupported and unknown formats with friendly messages', async () => {
    const res = await importFiles([file('k.mobi', 'x'), file('w.zzz', 'x')], undefined, { storage: store });
    expect(res.map((r) => r.status)).toEqual(['unsupported', 'unsupported']);
    expect(res[0].message).toContain('MOBI is not supported');
    expect(res[0].message).toMatch(/Calibre|EPUB/);
    expect(await store.listBooks()).toHaveLength(0);
  });

  it('reports corrupt files and still disposes nothing bogus', async () => {
    const [r] = await importFiles([file('bad.epub', 'CORRUPT')], undefined, { storage: store });
    expect(r.status).toBe('error');
    expect(r.message).toBe('This EPUB is damaged.');
  });

  it('rejects empty files', async () => {
    const [r] = await importFiles([file('e.epub', '')], undefined, { storage: store });
    expect(r.status).toBe('error');
    expect(r.message).toMatch(/empty/i);
  });

  it('one failure never stops the others, and progress is reported per file', async () => {
    const snaps: string[] = [];
    const res = await importFiles(
      [file('ok1.epub', 'one'), file('bad.epub', 'CORRUPT'), file('k.mobi', 'x'), file('ok2.pdf', 'two')],
      (items) => snaps.push(items.map((i) => i.status[0]).join('')),
      { storage: store },
    );
    expect(res.map((r) => r.status)).toEqual(['done', 'error', 'unsupported', 'done']);
    expect(await store.listBooks()).toHaveLength(2);
    expect(snaps[0]).toBe('qqqq');
    expect(new Set(snaps.flatMap((s) => [...s])).has('h')).toBe(true); // hashing seen
  });

  it('maps quota errors to recovery guidance and keeps going', async () => {
    const real = store.addBook.bind(store);
    let calls = 0;
    store.addBook = async (r, f) => { if (++calls === 1) throw new StorageQuotaError(); return real(r, f); };
    const res = await importFiles([file('a.epub', 'aa'), file('b.epub', 'bb')], undefined, { storage: store });
    expect(res[0].status).toBe('error');
    expect(res[0].message).toBe(QUOTA_MESSAGE);
    expect(res[0].message).toMatch(/clearing/i);
    expect(res[1].status).toBe('done');
  });

  it('disposes the document even when saving fails', async () => {
    store.addBook = async () => { throw new Error('boom'); };
    const [r] = await importFiles([file('a.epub', 'aa')], undefined, { storage: store });
    expect(r.status).toBe('error');
    expect(dispose).toHaveBeenCalledTimes(1);
  });
});
