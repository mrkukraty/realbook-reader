/// <reference types="jest" />
/// <reference types="node" />
import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import { MemoryRepo } from '../src/storage/memory-repo';
import { deletionSummary, filterAndSortBooks, formatBytes } from '../src/storage/library-logic';
import { importMany, summarizeResults, type BookFileStore, type PickedFile } from '../src/import/importer';
import type { BookRecord, ContentManifest } from '../src/storage/types';
import { normalizeSettings, defaultSettings } from '../src/settings/types';

const fx = (n: string) => new Uint8Array(fs.readFileSync(path.join(__dirname, 'fixtures', n)));
const picked = (name: string, bytes?: Uint8Array): PickedFile => ({ name, size: bytes?.length, readBytes: async () => bytes ?? fx(name) });

class FakeFiles implements BookFileStore {
  saved = new Map<string, { manifest?: ContentManifest; sections?: string[]; original?: number; cover?: boolean }>();
  failOnSave = false;
  async saveOriginal(id: string, _ext: string, bytes: Uint8Array) {
    if (this.failOnSave) throw new Error('disk full');
    this.saved.set(id, { ...this.saved.get(id), original: bytes.length });
  }
  async saveCover(id: string) { this.saved.set(id, { ...this.saved.get(id), cover: true }); return `file:///covers/${id}.jpg`; }
  async saveContent(id: string, manifest: ContentManifest, sections: string[]) { this.saved.set(id, { ...this.saved.get(id), manifest, sections }); }
  async deleteBook(id: string) { this.saved.delete(id); }
}

const sha256 = async (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

function book(partial: Partial<BookRecord> & { id: string }): BookRecord {
  return {
    hash: partial.id, fileName: `${partial.id}.epub`, format: 'epub', size: 1000, metadata: { title: partial.id },
    favorite: false, collectionIds: [], addedAt: 0, ...partial,
  };
}

describe('MemoryRepo', () => {
  it('stores books, progress, bookmarks, highlights; deleting a book cascades', async () => {
    const r = new MemoryRepo();
    await r.putBook(book({ id: 'a' }));
    await r.putProgress({ bookId: 'a', fraction: 0.5, updatedAt: 1, section: 2, sectionFraction: 0.1 });
    await r.putBookmark({ id: 'b1', bookId: 'a', createdAt: 1, label: 'x', section: 1 });
    await r.putHighlight({ id: 'h1', bookId: 'a', createdAt: 1, section: 0, start: 1, end: 5, text: 'abcd', color: 'yellow' });
    expect((await r.findByHash('a'))?.id).toBe('a');
    expect(await r.listBookmarks('a')).toHaveLength(1);
    await r.deleteBook('a');
    expect(await r.getBook('a')).toBeUndefined();
    expect(await r.getProgress('a')).toBeUndefined();
    expect(await r.listBookmarks('a')).toHaveLength(0);
    expect(await r.listHighlights('a')).toHaveLength(0);
  });
  it('deleting a collection removes it from books', async () => {
    const r = new MemoryRepo();
    await r.putCollection({ id: 'c', name: 'Shelf', createdAt: 1 });
    await r.putBook(book({ id: 'a', collectionIds: ['c'] }));
    await r.deleteCollection('c');
    expect((await r.getBook('a'))?.collectionIds).toEqual([]);
  });
  it('enforces unique hashes', async () => {
    const r = new MemoryRepo();
    await r.putBook(book({ id: 'a', hash: 'h' }));
    await expect(r.putBook(book({ id: 'b', hash: 'h' }))).rejects.toThrow();
  });
});

describe('importer', () => {
  it('imports several files, detects duplicates by hash, and isolates failures', async () => {
    const repo = new MemoryRepo();
    const files = new FakeFiles();
    const results = await importMany([
      picked('sample.txt'), picked('book.mobi'), picked('copy-of-sample.txt', fx('sample.txt')), picked('corrupt.epub'), picked('sample.epub'),
      picked('empty.txt'),
    ], { repo, files, sha256 });
    expect(results.map((r) => r.status)).toEqual(['imported', 'failed', 'duplicate', 'failed', 'imported', 'failed']);
    const books = await repo.listBooks();
    expect(books).toHaveLength(2);
    const epub = books.find((b) => b.format === 'epub')!;
    expect(epub.sectionCount).toBeGreaterThan(0);
    expect(files.saved.get(epub.id)?.manifest?.sections.length).toBe(epub.sectionCount);
    const summary = summarizeResults(results);
    expect(summary).toMatch(/Imported 2 books/);
    expect(summary).toMatch(/already in your library/);
    expect(summary).toMatch(/Calibre/);
  });
  it('cleans up stored files when saving fails', async () => {
    const repo = new MemoryRepo();
    const files = new FakeFiles();
    files.failOnSave = true;
    const [r] = await importMany([picked('sample.txt')], { repo, files, sha256 });
    expect(r.status).toBe('failed');
    expect(files.saved.size).toBe(0);
    expect(await repo.listBooks()).toHaveLength(0);
  });
});

describe('library logic', () => {
  const books = [
    book({ id: 'b', metadata: { title: 'Beta', author: 'Zed' }, addedAt: 2, lastOpenedAt: 10, favorite: true, size: 50 }),
    book({ id: 'a', metadata: { title: 'Alpha', author: 'Émile' }, addedAt: 3, size: 500, collectionIds: ['c'] }),
    book({ id: 'c', metadata: { title: 'Gamma' }, addedAt: 1, lastOpenedAt: 20, size: 5 }),
  ];
  const progress = { a: { bookId: 'a', fraction: 0.9, updatedAt: 0 }, b: { bookId: 'b', fraction: 0.1, updatedAt: 0 } };
  it('sorts', () => {
    expect(filterAndSortBooks(books, progress, { sort: 'title' }).map((b) => b.id)).toEqual(['a', 'b', 'c']);
    expect(filterAndSortBooks(books, progress, { sort: 'recent' }).map((b) => b.id)).toEqual(['c', 'b', 'a']);
    expect(filterAndSortBooks(books, progress, { sort: 'added' }).map((b) => b.id)).toEqual(['a', 'b', 'c']);
    expect(filterAndSortBooks(books, progress, { sort: 'progress' }).map((b) => b.id)).toEqual(['a', 'b', 'c']);
    expect(filterAndSortBooks(books, progress, { sort: 'size' }).map((b) => b.id)).toEqual(['a', 'b', 'c']);
    expect(filterAndSortBooks(books, progress, { sort: 'author' }).map((b) => b.id)).toEqual(['a', 'b', 'c']);
  });
  it('filters by text (accent-insensitive), favorites and collection', () => {
    expect(filterAndSortBooks(books, progress, { sort: 'title', text: 'emile' }).map((b) => b.id)).toEqual(['a']);
    expect(filterAndSortBooks(books, progress, { sort: 'title', favoritesOnly: true }).map((b) => b.id)).toEqual(['b']);
    expect(filterAndSortBooks(books, progress, { sort: 'title', collectionId: 'c' }).map((b) => b.id)).toEqual(['a']);
  });
  it('describes exactly what removal deletes', () => {
    const s = deletionSummary(books[0], { bookmarks: 2, highlights: 1, hasProgress: true });
    expect(s).toMatch(/b\.epub/);
    expect(s).toMatch(/2 bookmarks/);
    expect(s).toMatch(/1 highlight/);
    expect(s).toMatch(/reading position/);
    expect(s).toMatch(/not touched/);
    expect(formatBytes(1536)).toBe('1.5 KB');
  });
});

describe('settings', () => {
  it('normalizes garbage and clamps values', () => {
    expect(normalizeSettings(null)).toEqual(defaultSettings);
    const s = normalizeSettings({ fontSize: 99, lineHeight: 'x', theme: 'neon', perfMode: 'high', animations: false });
    expect(s.fontSize).toBe(40);
    expect(s.lineHeight).toBe(defaultSettings.lineHeight);
    expect(s.theme).toBe('ivory');
    expect(s.perfMode).toBe('high');
    expect(s.animations).toBe(false);
  });
});
