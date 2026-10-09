import Dexie, { type Table } from 'dexie';
import {
  StorageQuotaError,
  type Bookmark, type BookRecord, type Collection, type Highlight, type ProgressRecord,
  type StorageAdapter, type StorageUsage,
} from './StorageAdapter';

type StoredBook = Omit<BookRecord, 'cover'> & { cover?: Blob };
interface FileRow { id: string; blob: Blob }

class RealBookDB extends Dexie {
  books!: Table<StoredBook, string>;
  files!: Table<FileRow, string>;
  progress!: Table<ProgressRecord, string>;
  bookmarks!: Table<Bookmark, string>;
  highlights!: Table<Highlight, string>;
  collections!: Table<Collection, string>;
  constructor(name: string) {
    super(name);
    this.version(1).stores({
      books: 'id, hash, addedAt, lastOpenedAt',
      files: 'id',
      progress: 'bookId, updatedAt',
      bookmarks: 'id, bookId',
      highlights: 'id, bookId',
      collections: 'id, createdAt',
    });
  }
}

/** True for QuotaExceededError, including Dexie wrappers (inner/cause chains). */
export function isQuotaError(e: unknown): boolean {
  const seen = new Set<unknown>();
  let cur: any = e;
  while (cur && typeof cur === 'object' && !seen.has(cur)) {
    seen.add(cur);
    if (cur.name === 'QuotaExceededError' || cur.code === 22 || /quota/i.test(String(cur.message ?? ''))) return true;
    cur = cur.inner ?? cur.cause;
  }
  return false;
}

export async function requestPersistence(): Promise<boolean> {
  try { return (await navigator.storage?.persist?.()) ?? false; } catch { return false; }
}

export class BrowserStorage implements StorageAdapter {
  readonly kind = 'browser' as const;
  private db: RealBookDB;
  private listeners = new Set<() => void>();
  private channel?: BroadcastChannel;

  constructor(dbName = 'realbook-reader') {
    this.db = new RealBookDB(dbName);
    try {
      if (typeof BroadcastChannel !== 'undefined') {
        this.channel = new BroadcastChannel(`${dbName}-changes`);
        this.channel.onmessage = () => this.emit();
      }
    } catch { /* optional */ }
  }

  private emit() { for (const cb of [...this.listeners]) { try { cb(); } catch { /* listener errors never break storage */ } } }
  private changed() { this.emit(); try { this.channel?.postMessage(1); } catch { /* ignore */ } }

  private async write<T>(fn: () => Promise<T>): Promise<T> {
    try {
      const r = await fn();
      this.changed();
      return r;
    } catch (e) {
      if (isQuotaError(e)) throw new StorageQuotaError();
      throw e;
    }
  }

  async listBooks() { return this.db.books.toArray() as Promise<BookRecord[]>; }
  async getBook(id: string) { return this.db.books.get(id) as Promise<BookRecord | undefined>; }
  async findByHash(hash: string) { return this.db.books.where('hash').equals(hash).first() as Promise<BookRecord | undefined>; }

  addBook(record: BookRecord, file: Blob) {
    return this.write(() => this.db.transaction('rw', this.db.books, this.db.files, async () => {
      await this.db.books.add(record);
      await this.db.files.put({ id: record.id, blob: file });
    }));
  }

  updateBook(id: string, patch: Partial<BookRecord>) {
    return this.write(async () => {
      const { id: _ignore, ...rest } = patch;
      const n = await this.db.books.update(id, rest);
      if (!n) { /* missing book: nothing to update */ }
    });
  }

  removeBook(id: string) {
    return this.write(() => this.db.transaction('rw',
      [this.db.books, this.db.files, this.db.progress, this.db.bookmarks, this.db.highlights], async () => {
        await this.db.books.delete(id);
        await this.db.files.delete(id);
        await this.db.progress.delete(id);
        await this.db.bookmarks.where('bookId').equals(id).delete();
        await this.db.highlights.where('bookId').equals(id).delete();
      }));
  }

  clearLibrary() {
    return this.write(() => this.db.transaction('rw',
      [this.db.books, this.db.files, this.db.progress, this.db.bookmarks, this.db.highlights, this.db.collections], async () => {
        await Promise.all([this.db.books.clear(), this.db.files.clear(), this.db.progress.clear(),
          this.db.bookmarks.clear(), this.db.highlights.clear(), this.db.collections.clear()]);
      }));
  }

  async getBookFile(id: string): Promise<Blob> {
    const row = await this.db.files.get(id);
    if (!row) throw new Error('The stored file for this book is missing. Remove it from the library and import it again.');
    return row.blob;
  }

  getProgress(bookId: string) { return this.db.progress.get(bookId); }
  listProgress() { return this.db.progress.toArray(); }
  saveProgress(p: ProgressRecord) { return this.write(async () => { await this.db.progress.put(p); }); }

  listBookmarks(bookId: string) { return this.db.bookmarks.where('bookId').equals(bookId).sortBy('createdAt'); }
  putBookmark(b: Bookmark) { return this.write(async () => { await this.db.bookmarks.put(b); }); }
  removeBookmark(id: string) { return this.write(() => this.db.bookmarks.delete(id)); }
  listHighlights(bookId: string) { return this.db.highlights.where('bookId').equals(bookId).sortBy('createdAt'); }
  putHighlight(h: Highlight) { return this.write(async () => { await this.db.highlights.put(h); }); }
  removeHighlight(id: string) { return this.write(() => this.db.highlights.delete(id)); }

  listCollections() { return this.db.collections.orderBy('createdAt').toArray(); }
  putCollection(c: Collection) { return this.write(async () => { await this.db.collections.put(c); }); }
  removeCollection(id: string) {
    return this.write(() => this.db.transaction('rw', this.db.collections, this.db.books, async () => {
      await this.db.collections.delete(id);
      await this.db.books.toCollection().modify((b) => {
        if (b.collectionIds?.includes(id)) b.collectionIds = b.collectionIds.filter((c) => c !== id);
      });
    }));
  }

  async usage(): Promise<StorageUsage> {
    const out: StorageUsage = {};
    try {
      const est = await navigator.storage?.estimate?.();
      if (est) { out.used = est.usage; out.quota = est.quota; }
    } catch { /* ignore */ }
    try { out.persisted = await navigator.storage?.persisted?.(); } catch { /* ignore */ }
    return out;
  }

  subscribe(cb: () => void) {
    this.listeners.add(cb);
    return () => { this.listeners.delete(cb); };
  }

  /** Test helper / shutdown. */
  close() { this.channel?.close(); this.db.close(); }
}
