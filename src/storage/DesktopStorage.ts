import {
  StorageQuotaError,
  type BookRecord, type Bookmark, type Collection, type Highlight, type ProgressRecord,
  type StorageAdapter, type StorageUsage,
} from './StorageAdapter';
import { isTauri } from './desktop/native';

export type InvokeFn = <T = unknown>(cmd: string, args?: unknown, options?: { headers?: Record<string, string> }) => Promise<T>;

const MISSING_MSG =
  "The book file is missing from RealBook Reader's data folder. It may have been deleted or moved. Remove this book from the library and import it again.";

interface StoredCover { type: string; b64: string }
type StoredBook = Omit<BookRecord, 'cover'> & { cover?: StoredCover };

interface LibraryDoc {
  version: 1;
  books: Record<string, StoredBook>;
  progress: Record<string, ProgressRecord>;
  bookmarks: Record<string, Bookmark>;
  highlights: Record<string, Highlight>;
  collections: Record<string, Collection>;
}

const emptyDoc = (): LibraryDoc => ({ version: 1, books: {}, progress: {}, bookmarks: {}, highlights: {}, collections: {} });

async function blobToBytes(b: Blob): Promise<Uint8Array> {
  if (typeof b.arrayBuffer === 'function') return new Uint8Array(await b.arrayBuffer());
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(new Uint8Array(r.result as ArrayBuffer));
    r.onerror = () => rej(r.error);
    r.readAsArrayBuffer(b);
  });
}

function bytesToB64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function b64ToBlob(c: StoredCover): Blob {
  const bin = atob(c.b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: c.type });
}

function mapError(e: unknown): Error {
  const msg = typeof e === 'string' ? e : e instanceof Error ? e.message : String(e);
  if (/no space|disk full|not enough (space|storage)|os error 112|os error 28/i.test(msg)) return new StorageQuotaError();
  return e instanceof Error ? e : new Error(msg);
}

export interface DesktopStorageOptions {
  invoke?: InvokeFn;
  /** Debounce for non-critical writes (progress, bookmarks...). Default 400ms. */
  debounceMs?: number;
}

export class DesktopStorage implements StorageAdapter {
  readonly kind = 'desktop' as const;
  private inv: InvokeFn;
  private debounceMs: number;
  private doc: LibraryDoc = emptyDoc();
  private coverCache = new Map<string, Blob>();
  private loaded: Promise<void> | null = null;
  private listeners = new Set<() => void>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private dirty = false;
  private chain: Promise<void> = Promise.resolve();

  constructor(opts: DesktopStorageOptions = {}) {
    this.inv = opts.invoke ?? (async (cmd, args, options) => {
      const { invoke } = await import('@tauri-apps/api/core');
      return invoke(cmd, args as never, options as never) as never;
    });
    this.debounceMs = opts.debounceMs ?? 400;
    if (typeof window !== 'undefined') {
      window.addEventListener('beforeunload', () => { void this.flush(); });
      window.addEventListener('pagehide', () => { void this.flush(); });
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') void this.flush(); });
    }
  }

  static isAvailable(): boolean { return isTauri(); }

  // ---------- internals ----------
  private load(): Promise<void> {
    return (this.loaded ??= (async () => {
      const text = await this.inv<string | null>('storage_read_json');
      if (!text) return;
      try {
        const parsed = JSON.parse(text) as Partial<LibraryDoc>;
        this.doc = { ...emptyDoc(), ...parsed };
      } catch {
        throw new Error('The library file in RealBook Reader\'s data folder is corrupted and could not be read.');
      }
    })());
  }

  private emit() { for (const cb of [...this.listeners]) { try { cb(); } catch { /* listener errors are not ours */ } } }

  private schedule() {
    this.dirty = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => { void this.flush().catch(() => undefined); }, this.debounceMs);
  }

  /** Writes the library document now (atomic temp+rename in Rust). Serialized. */
  async flush(): Promise<void> {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (!this.dirty || !this.loaded) return this.chain;
    this.dirty = false;
    const data = JSON.stringify(this.doc);
    const run = this.chain.then(() => this.inv<void>('storage_write_json', { data })).catch((e) => { this.dirty = true; throw mapError(e); });
    this.chain = run.catch(() => undefined);
    return run;
  }

  private hydrate(s: StoredBook): BookRecord {
    const { cover, ...rest } = s;
    const rec: BookRecord = { ...rest, metadata: { ...s.metadata }, collectionIds: [...s.collectionIds] };
    if (cover) {
      let b = this.coverCache.get(s.id);
      if (!b) { b = b64ToBlob(cover); this.coverCache.set(s.id, b); }
      rec.cover = b;
    }
    return rec;
  }

  private async dehydrate(r: BookRecord): Promise<StoredBook> {
    const { cover, ...rest } = r;
    const out: StoredBook = { ...rest, metadata: { ...r.metadata }, collectionIds: [...r.collectionIds] };
    if (cover) {
      out.cover = { type: cover.type || 'image/jpeg', b64: bytesToB64(await blobToBytes(cover)) };
      this.coverCache.set(r.id, cover);
    }
    return out;
  }

  // ---------- books ----------
  async listBooks(): Promise<BookRecord[]> {
    await this.load();
    return Object.values(this.doc.books).map((b) => this.hydrate(b));
  }
  async getBook(id: string) {
    await this.load();
    const b = this.doc.books[id];
    return b ? this.hydrate(b) : undefined;
  }
  async findByHash(hash: string) {
    await this.load();
    const b = Object.values(this.doc.books).find((x) => x.hash === hash);
    return b ? this.hydrate(b) : undefined;
  }

  async addBook(record: BookRecord, file: Blob): Promise<void> {
    await this.load();
    const bytes = await blobToBytes(file);
    try {
      await this.inv('book_file_write', bytes, { headers: { 'x-id': record.id } });
    } catch (e) { throw mapError(e); }
    const stored = await this.dehydrate(record);
    this.doc.books[record.id] = stored;
    try {
      this.dirty = true;
      await this.flush();
    } catch (e) {
      delete this.doc.books[record.id];
      this.coverCache.delete(record.id);
      await this.inv('book_file_delete', { id: record.id }).catch(() => undefined);
      throw e;
    }
    this.emit();
  }

  async updateBook(id: string, patch: Partial<BookRecord>): Promise<void> {
    await this.load();
    const cur = this.doc.books[id];
    if (!cur) return;
    const { id: _ignore, cover, ...rest } = patch;
    void _ignore;
    const next: StoredBook = { ...cur, ...rest } as StoredBook;
    if ('cover' in patch) {
      if (cover) next.cover = (await this.dehydrate({ ...this.hydrate(cur), cover })).cover;
      else { delete next.cover; this.coverCache.delete(id); }
    }
    this.doc.books[id] = next;
    this.schedule();
    this.emit();
  }

  async removeBook(id: string): Promise<void> {
    await this.load();
    await this.inv('book_file_delete', { id }).catch((e) => { throw mapError(e); });
    delete this.doc.books[id];
    delete this.doc.progress[id];
    this.coverCache.delete(id);
    for (const k of Object.keys(this.doc.bookmarks)) if (this.doc.bookmarks[k].bookId === id) delete this.doc.bookmarks[k];
    for (const k of Object.keys(this.doc.highlights)) if (this.doc.highlights[k].bookId === id) delete this.doc.highlights[k];
    this.dirty = true;
    await this.flush();
    this.emit();
  }

  async clearLibrary(): Promise<void> {
    await this.load();
    for (const id of Object.keys(this.doc.books)) await this.inv('book_file_delete', { id }).catch(() => undefined);
    this.doc = emptyDoc();
    this.coverCache.clear();
    this.dirty = true;
    await this.flush();
    this.emit();
  }

  async getBookFile(id: string): Promise<Blob> {
    await this.load();
    const rec = this.doc.books[id];
    try {
      const buf = await this.inv<ArrayBuffer | number[]>('book_file_read', { id });
      return new Blob([buf instanceof ArrayBuffer ? buf : new Uint8Array(buf)], { type: rec ? mimeFor(rec.format) : '' });
    } catch (e) {
      const msg = typeof e === 'string' ? e : e instanceof Error ? e.message : '';
      if (msg.includes('NOT_FOUND')) throw new Error(MISSING_MSG);
      throw mapError(e);
    }
  }

  // ---------- progress ----------
  async getProgress(bookId: string) { await this.load(); const p = this.doc.progress[bookId]; return p ? { ...p } : undefined; }
  async listProgress() { await this.load(); return Object.values(this.doc.progress).map((p) => ({ ...p })); }
  async saveProgress(p: ProgressRecord) { await this.load(); this.doc.progress[p.bookId] = { ...p }; this.schedule(); this.emit(); }

  // ---------- annotations ----------
  async listBookmarks(bookId: string) {
    await this.load();
    return Object.values(this.doc.bookmarks).filter((b) => b.bookId === bookId).map((b) => ({ ...b }));
  }
  async putBookmark(b: Bookmark) { await this.load(); this.doc.bookmarks[b.id] = { ...b }; this.schedule(); this.emit(); }
  async removeBookmark(id: string) { await this.load(); delete this.doc.bookmarks[id]; this.schedule(); this.emit(); }
  async listHighlights(bookId: string) {
    await this.load();
    return Object.values(this.doc.highlights).filter((h) => h.bookId === bookId).map((h) => ({ ...h }));
  }
  async putHighlight(h: Highlight) { await this.load(); this.doc.highlights[h.id] = { ...h }; this.schedule(); this.emit(); }
  async removeHighlight(id: string) { await this.load(); delete this.doc.highlights[id]; this.schedule(); this.emit(); }

  // ---------- collections ----------
  async listCollections() { await this.load(); return Object.values(this.doc.collections).map((c) => ({ ...c })); }
  async putCollection(c: Collection) { await this.load(); this.doc.collections[c.id] = { ...c }; this.schedule(); this.emit(); }
  async removeCollection(id: string) {
    await this.load();
    delete this.doc.collections[id];
    for (const b of Object.values(this.doc.books)) b.collectionIds = b.collectionIds.filter((c) => c !== id);
    this.schedule();
    this.emit();
  }

  // ---------- misc ----------
  async usage(): Promise<StorageUsage> {
    try {
      const u = await this.inv<{ used: number; free: number | null }>('storage_usage');
      return { used: u.used, quota: u.free != null ? u.used + u.free : undefined, persisted: true };
    } catch {
      return { persisted: true };
    }
  }

  subscribe(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => { this.listeners.delete(cb); };
  }
}

function mimeFor(format: string): string {
  const m: Record<string, string> = {
    epub: 'application/epub+zip', pdf: 'application/pdf', txt: 'text/plain', html: 'text/html', markdown: 'text/markdown',
    fb2: 'application/x-fictionbook+xml', rtf: 'application/rtf', cbz: 'application/vnd.comicbook+zip',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  };
  return m[format] ?? '';
}
