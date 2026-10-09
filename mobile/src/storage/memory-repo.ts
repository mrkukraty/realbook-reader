import type { Bookmark, BookRecord, Collection, Highlight, LibraryRepo, ProgressRecord } from './types';

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** In-memory repository: used by unit tests and as a fallback if SQLite cannot be opened. */
export class MemoryRepo implements LibraryRepo {
  private books = new Map<string, BookRecord>();
  private progress = new Map<string, ProgressRecord>();
  private bookmarks = new Map<string, Bookmark>();
  private highlights = new Map<string, Highlight>();
  private collections = new Map<string, Collection>();
  private kv = new Map<string, string>();

  async init() {}
  async listBooks() { return [...this.books.values()].map(clone); }
  async getBook(id: string) { const b = this.books.get(id); return b ? clone(b) : undefined; }
  async findByHash(hash: string) { const b = [...this.books.values()].find((x) => x.hash === hash); return b ? clone(b) : undefined; }
  async putBook(r: BookRecord) {
    const dup = [...this.books.values()].find((x) => x.hash === r.hash && x.id !== r.id);
    if (dup) throw new Error('UNIQUE constraint failed: books.hash');
    this.books.set(r.id, clone(r));
  }
  async deleteBook(id: string) {
    this.books.delete(id);
    this.progress.delete(id);
    for (const [k, v] of this.bookmarks) if (v.bookId === id) this.bookmarks.delete(k);
    for (const [k, v] of this.highlights) if (v.bookId === id) this.highlights.delete(k);
  }
  async getProgress(bookId: string) { const p = this.progress.get(bookId); return p ? clone(p) : undefined; }
  async listProgress() { return [...this.progress.values()].map(clone); }
  async putProgress(p: ProgressRecord) { this.progress.set(p.bookId, clone(p)); }
  async listBookmarks(bookId: string) { return [...this.bookmarks.values()].filter((b) => b.bookId === bookId).sort((a, b) => a.createdAt - b.createdAt).map(clone); }
  async putBookmark(b: Bookmark) { this.bookmarks.set(b.id, clone(b)); }
  async deleteBookmark(id: string) { this.bookmarks.delete(id); }
  async listHighlights(bookId: string) { return [...this.highlights.values()].filter((h) => h.bookId === bookId).sort((a, b) => a.section - b.section || a.start - b.start).map(clone); }
  async putHighlight(h: Highlight) { this.highlights.set(h.id, clone(h)); }
  async deleteHighlight(id: string) { this.highlights.delete(id); }
  async listCollections() { return [...this.collections.values()].sort((a, b) => a.createdAt - b.createdAt).map(clone); }
  async putCollection(c: Collection) { this.collections.set(c.id, clone(c)); }
  async deleteCollection(id: string) {
    this.collections.delete(id);
    for (const b of this.books.values()) b.collectionIds = b.collectionIds.filter((c) => c !== id);
  }
  async getKV(key: string) { return this.kv.get(key); }
  async setKV(key: string, value: string) { this.kv.set(key, value); }
}
