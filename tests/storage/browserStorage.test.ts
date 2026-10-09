import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BrowserStorage, isQuotaError } from '../../src/storage/BrowserStorage';
import { StorageQuotaError, type BookRecord } from '../../src/storage/StorageAdapter';

let n = 0;
let s: BrowserStorage;
beforeEach(() => { s = new BrowserStorage(`test-db-${++n}-${Math.random()}`); });
afterEach(() => { s.close(); });

const rec = (id: string, over: Partial<BookRecord> = {}): BookRecord => ({
  id, hash: 'h-' + id, fileName: id + '.epub', format: 'epub', size: 10, metadata: { title: 'T ' + id },
  favorite: false, collectionIds: [], addedAt: 1, ...over,
});
const blob = (t = 'data') => new Blob([t]);

describe('BrowserStorage', () => {
  it('adds, lists, gets, and reads back the file', async () => {
    await s.addBook(rec('a'), blob('hello'));
    expect((await s.listBooks()).map((b) => b.id)).toEqual(['a']);
    expect((await s.getBook('a'))?.metadata.title).toBe('T a');
    const f = await s.getBookFile('a');
    expect(f).toBeTruthy();
  });

  it('listBooks does not carry the file blob', async () => {
    await s.addBook(rec('a'), blob('x'.repeat(1000)));
    const b = (await s.listBooks())[0] as any;
    expect(b.blob).toBeUndefined();
    expect(b.file).toBeUndefined();
  });

  it('getBookFile throws a friendly error when missing', async () => {
    await expect(s.getBookFile('nope')).rejects.toThrow(/missing/i);
  });

  it('updates a book', async () => {
    await s.addBook(rec('a'), blob());
    await s.updateBook('a', { favorite: true, metadata: { title: 'New' } });
    const b = await s.getBook('a');
    expect(b?.favorite).toBe(true);
    expect(b?.metadata.title).toBe('New');
  });

  it('finds by hash (duplicate detection)', async () => {
    await s.addBook(rec('a', { hash: 'same' }), blob());
    expect((await s.findByHash('same'))?.id).toBe('a');
    expect(await s.findByHash('other')).toBeUndefined();
  });

  it('removeBook cascades to file, progress, bookmarks, highlights but leaves other books', async () => {
    await s.addBook(rec('a'), blob()); await s.addBook(rec('b'), blob());
    await s.saveProgress({ bookId: 'a', fraction: 0.5, updatedAt: 1 });
    await s.saveProgress({ bookId: 'b', fraction: 0.2, updatedAt: 1 });
    await s.putBookmark({ id: 'm1', bookId: 'a', createdAt: 1, label: 'x' });
    await s.putBookmark({ id: 'm2', bookId: 'b', createdAt: 1, label: 'y' });
    await s.putHighlight({ id: 'h1', bookId: 'a', createdAt: 1, section: 0, start: 0, end: 3, text: 'abc', color: 'yellow' });
    await s.removeBook('a');
    expect(await s.getBook('a')).toBeUndefined();
    await expect(s.getBookFile('a')).rejects.toThrow();
    expect(await s.getProgress('a')).toBeUndefined();
    expect(await s.listBookmarks('a')).toEqual([]);
    expect(await s.listHighlights('a')).toEqual([]);
    expect((await s.listBookmarks('b')).length).toBe(1);
    expect((await s.getProgress('b'))?.fraction).toBe(0.2);
    expect(await s.getBookFile('b')).toBeTruthy();
  });

  it('saves and restores progress, and lists all', async () => {
    await s.saveProgress({ bookId: 'a', section: 2, sectionFraction: 0.4, fraction: 0.33, updatedAt: 5 });
    await s.saveProgress({ bookId: 'a', section: 3, sectionFraction: 0.1, fraction: 0.4, updatedAt: 6 });
    const p = await s.getProgress('a');
    expect(p).toMatchObject({ section: 3, fraction: 0.4 });
    expect((await s.listProgress()).length).toBe(1);
  });

  it('bookmarks and highlights CRUD', async () => {
    await s.putBookmark({ id: 'm', bookId: 'a', createdAt: 1, label: 'one', page: 3 });
    expect((await s.listBookmarks('a'))[0].page).toBe(3);
    await s.removeBookmark('m');
    expect(await s.listBookmarks('a')).toEqual([]);
    await s.putHighlight({ id: 'h', bookId: 'a', createdAt: 1, section: 0, start: 1, end: 2, text: 'x', color: 'blue', note: 'n' });
    expect((await s.listHighlights('a'))[0].note).toBe('n');
    await s.removeHighlight('h');
    expect(await s.listHighlights('a')).toEqual([]);
  });

  it('collections: removing one detaches it from books', async () => {
    await s.putCollection({ id: 'c1', name: 'Fav', createdAt: 1 });
    await s.addBook(rec('a', { collectionIds: ['c1', 'c2'] }), blob());
    await s.removeCollection('c1');
    expect(await s.listCollections()).toEqual([]);
    expect((await s.getBook('a'))?.collectionIds).toEqual(['c2']);
  });

  it('clearLibrary empties everything', async () => {
    await s.addBook(rec('a'), blob());
    await s.saveProgress({ bookId: 'a', fraction: 1, updatedAt: 1 });
    await s.putCollection({ id: 'c', name: 'x', createdAt: 1 });
    await s.clearLibrary();
    expect(await s.listBooks()).toEqual([]);
    expect(await s.listProgress()).toEqual([]);
    expect(await s.listCollections()).toEqual([]);
  });

  it('addBook is atomic: a failing file write leaves no book record', async () => {
    const db = (s as any).db;
    vi.spyOn(db.files, 'put').mockRejectedValue(new Error('disk exploded'));
    await expect(s.addBook(rec('a'), blob())).rejects.toThrow('disk exploded');
    expect(await s.listBooks()).toEqual([]);
  });

  it('maps QuotaExceededError (including Dexie wrapped) to StorageQuotaError', async () => {
    const db = (s as any).db;
    const quota = Object.assign(new Error('The quota has been exceeded.'), { name: 'QuotaExceededError' });
    vi.spyOn(db.files, 'put').mockRejectedValue(Object.assign(new Error('wrapped'), { name: 'AbortError', inner: quota }));
    await expect(s.addBook(rec('a'), blob())).rejects.toBeInstanceOf(StorageQuotaError);
    expect(await s.listBooks()).toEqual([]);
    expect(isQuotaError(quota)).toBe(true);
    expect(isQuotaError(new Error('nope'))).toBe(false);
  });

  it('subscribe notifies on writes and stops after unsubscribe', async () => {
    const cb = vi.fn();
    const off = s.subscribe(cb);
    await s.addBook(rec('a'), blob());
    await s.updateBook('a', { favorite: true });
    await s.saveProgress({ bookId: 'a', fraction: 0.1, updatedAt: 1 });
    await s.removeBook('a');
    expect(cb.mock.calls.length).toBeGreaterThanOrEqual(4);
    off();
    cb.mockClear();
    await s.saveProgress({ bookId: 'a', fraction: 0.2, updatedAt: 2 });
    expect(cb).not.toHaveBeenCalled();
  });

  it('notifies a second instance (cross-tab) through BroadcastChannel', async () => {
    const name = `shared-${Math.random()}`;
    const a = new BrowserStorage(name); const b = new BrowserStorage(name);
    const cb = vi.fn(); b.subscribe(cb);
    await a.saveProgress({ bookId: 'x', fraction: 0.1, updatedAt: 1 });
    await new Promise((r) => setTimeout(r, 50));
    expect(cb).toHaveBeenCalled();
    a.close(); b.close();
  });

  it('usage() does not throw without navigator.storage', async () => {
    const u = await s.usage();
    expect(typeof u).toBe('object');
  });
});
