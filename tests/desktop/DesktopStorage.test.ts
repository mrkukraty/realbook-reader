import { describe, it, expect, beforeEach } from 'vitest';
import { DesktopStorage, type InvokeFn } from '../../src/storage/DesktopStorage';
import type { BookRecord } from '../../src/storage/StorageAdapter';
import { StorageQuotaError } from '../../src/storage/StorageAdapter';

/** In-memory fake of the Rust backend. */
function fakeBackend() {
  const files = new Map<string, Uint8Array>();
  let json: string | null = null;
  const writes: string[] = [];
  const state = { failJson: null as string | null, failFile: null as string | null };
  const invoke: InvokeFn = async (cmd: string, args?: unknown, options?: { headers?: Record<string, string> }) => {
    const a = (args ?? {}) as Record<string, string>;
    const validId = (id: string) => /^[A-Za-z0-9_-]{1,128}$/.test(id);
    switch (cmd) {
      case 'storage_read_json': return json as never;
      case 'storage_write_json':
        if (state.failJson) throw state.failJson;
        JSON.parse(a.data); json = a.data; writes.push(a.data); return undefined as never;
      case 'book_file_write': {
        if (state.failFile) throw state.failFile;
        const id = options?.headers?.['x-id'] ?? '';
        if (!validId(id)) throw 'Invalid book id';
        files.set(id, args as Uint8Array); return undefined as never;
      }
      case 'book_file_read': {
        if (!validId(a.id)) throw 'Invalid book id';
        const f = files.get(a.id); if (!f) throw 'NOT_FOUND';
        return f.buffer.slice(f.byteOffset, f.byteOffset + f.byteLength) as never;
      }
      case 'book_file_delete': files.delete(a.id); return undefined as never;
      case 'storage_usage': return { used: [...files.values()].reduce((n, f) => n + f.length, 0), free: 1000 } as never;
      default: throw new Error('unknown command ' + cmd);
    }
  };
  return { invoke, files, writes, state, getJson: () => json };
}

const rec = (id: string, hash = 'h' + id, extra: Partial<BookRecord> = {}): BookRecord => ({
  id, hash, fileName: id + '.txt', format: 'txt', size: 5, metadata: { title: 'T' + id },
  favorite: false, collectionIds: [], addedAt: 1, ...extra,
});
const blob = (s: string) => new Blob([new TextEncoder().encode(s)], { type: 'text/plain' });
const textOf = (b: Blob) => new Promise<string>((res) => { const r = new FileReader(); r.onload = () => res(r.result as string); r.readAsText(b); });

describe('DesktopStorage (mocked Tauri backend)', () => {
  let be: ReturnType<typeof fakeBackend>;
  let s: DesktopStorage;
  beforeEach(() => { be = fakeBackend(); s = new DesktopStorage({ invoke: be.invoke, debounceMs: 5 }); });

  it('has kind desktop', () => expect(s.kind).toBe('desktop'));

  it('adds, reads, updates books and returns file bytes', async () => {
    await s.addBook(rec('a'), blob('hello'));
    expect((await s.listBooks()).map((b) => b.id)).toEqual(['a']);
    expect(await textOf(await s.getBookFile('a'))).toBe('hello');
    await s.updateBook('a', { favorite: true, metadata: { title: 'New' } });
    const b = await s.getBook('a');
    expect(b?.favorite).toBe(true);
    expect(b?.metadata.title).toBe('New');
    expect(b?.id).toBe('a');
  });

  it('persists to library.json and a fresh instance sees the data (incl. cover)', async () => {
    const cover = new Blob([new Uint8Array([1, 2, 3, 255])], { type: 'image/png' });
    await s.addBook(rec('a', 'h', { cover }), blob('x'));
    await s.saveProgress({ bookId: 'a', fraction: 0.5, updatedAt: 2 });
    await s.flush();
    const s2 = new DesktopStorage({ invoke: be.invoke });
    const b = await s2.getBook('a');
    expect(b?.cover?.type).toBe('image/png');
    expect(b?.cover?.size).toBe(4);
    expect((await s2.getProgress('a'))?.fraction).toBe(0.5);
  });

  it('debounces progress writes', async () => {
    await s.addBook(rec('a'), blob('x'));
    const before = be.writes.length;
    for (let i = 0; i < 10; i++) await s.saveProgress({ bookId: 'a', fraction: i / 10, updatedAt: i });
    expect(be.writes.length).toBe(before);
    await new Promise((r) => setTimeout(r, 40));
    expect(be.writes.length).toBe(before + 1);
    expect((await s.getProgress('a'))?.fraction).toBeCloseTo(0.9);
  });

  it('cascade deletes file, progress, bookmarks and highlights', async () => {
    await s.addBook(rec('a'), blob('x'));
    await s.addBook(rec('b'), blob('y'));
    await s.saveProgress({ bookId: 'a', fraction: 0.1, updatedAt: 1 });
    await s.putBookmark({ id: 'm1', bookId: 'a', createdAt: 1, label: 'l', page: 1 });
    await s.putBookmark({ id: 'm2', bookId: 'b', createdAt: 1, label: 'l', page: 1 });
    await s.putHighlight({ id: 'h1', bookId: 'a', createdAt: 1, section: 0, start: 0, end: 1, text: 't', color: 'yellow' });
    await s.removeBook('a');
    expect(be.files.has('a')).toBe(false);
    expect(await s.getBook('a')).toBeUndefined();
    expect(await s.getProgress('a')).toBeUndefined();
    expect(await s.listBookmarks('a')).toEqual([]);
    expect(await s.listHighlights('a')).toEqual([]);
    expect((await s.listBookmarks('b')).length).toBe(1);
    expect(JSON.parse(be.getJson()!).books.a).toBeUndefined();
  });

  it('finds duplicates by hash', async () => {
    await s.addBook(rec('a', 'samehash'), blob('x'));
    expect((await s.findByHash('samehash'))?.id).toBe('a');
    expect(await s.findByHash('nope')).toBeUndefined();
  });

  it('notifies subscribers and supports unsubscribe', async () => {
    let n = 0;
    const off = s.subscribe(() => n++);
    await s.addBook(rec('a'), blob('x'));
    await s.putCollection({ id: 'c', name: 'C', createdAt: 1 });
    expect(n).toBeGreaterThanOrEqual(2);
    off();
    const k = n;
    await s.removeBook('a');
    expect(n).toBe(k);
  });

  it('collections: put/list/remove strips id from books', async () => {
    await s.addBook(rec('a', 'h', { collectionIds: ['c'] }), blob('x'));
    await s.putCollection({ id: 'c', name: 'C', createdAt: 1 });
    expect((await s.listCollections()).length).toBe(1);
    await s.removeCollection('c');
    expect((await s.getBook('a'))?.collectionIds).toEqual([]);
  });

  it('throws a friendly error when the book file is missing', async () => {
    await s.addBook(rec('a'), blob('x'));
    be.files.delete('a');
    await expect(s.getBookFile('a')).rejects.toThrow(/missing from RealBook Reader's data folder/);
  });

  it('rejects path-traversal ids at the backend boundary', async () => {
    await expect(s.addBook(rec('../evil'), blob('x'))).rejects.toThrow(/Invalid book id/);
    expect(await s.listBooks()).toEqual([]);
  });

  it('maps disk-full to StorageQuotaError and keeps no record', async () => {
    be.state.failFile = 'There is not enough space on the disk. (os error 112)';
    await expect(s.addBook(rec('a'), blob('x'))).rejects.toBeInstanceOf(StorageQuotaError);
    expect(await s.listBooks()).toEqual([]);
  });

  it('rolls back the file if the library write fails', async () => {
    be.state.failJson = 'boom';
    await expect(s.addBook(rec('a'), blob('x'))).rejects.toThrow('boom');
    expect(be.files.has('a')).toBe(false);
    expect(await s.listBooks()).toEqual([]);
  });

  it('clearLibrary removes everything', async () => {
    await s.addBook(rec('a'), blob('x'));
    await s.clearLibrary();
    expect(await s.listBooks()).toEqual([]);
    expect(be.files.size).toBe(0);
  });

  it('usage reports used and quota', async () => {
    await s.addBook(rec('a'), blob('12345'));
    expect(await s.usage()).toEqual({ used: 5, quota: 1005, persisted: true });
  });
});
