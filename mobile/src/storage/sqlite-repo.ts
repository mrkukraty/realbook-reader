import * as SQLite from 'expo-sqlite';
import type { Bookmark, BookRecord, Collection, Highlight, LibraryRepo, ProgressRecord } from './types';

type Row = { json: string };
const parse = <T>(rows: Row[]): T[] => rows.map((r) => JSON.parse(r.json) as T);

/** SQLite-backed repository. Records are stored as JSON with indexed key columns (schema v1). */
export class SqliteRepo implements LibraryRepo {
  private db: SQLite.SQLiteDatabase | null = null;

  private get d(): SQLite.SQLiteDatabase {
    if (!this.db) throw new Error('Database not initialised');
    return this.db;
  }

  async init() {
    if (this.db) return;
    this.db = await SQLite.openDatabaseAsync('realbook.db');
    await this.db.execAsync(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS books (id TEXT PRIMARY KEY NOT NULL, hash TEXT NOT NULL UNIQUE, json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS progress (book_id TEXT PRIMARY KEY NOT NULL, json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS bookmarks (id TEXT PRIMARY KEY NOT NULL, book_id TEXT NOT NULL, json TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS bookmarks_book ON bookmarks(book_id);
      CREATE TABLE IF NOT EXISTS highlights (id TEXT PRIMARY KEY NOT NULL, book_id TEXT NOT NULL, json TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS highlights_book ON highlights(book_id);
      CREATE TABLE IF NOT EXISTS collections (id TEXT PRIMARY KEY NOT NULL, json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);
    `);
  }

  async listBooks() { return parse<BookRecord>(await this.d.getAllAsync<Row>('SELECT json FROM books')); }
  async getBook(id: string) { return parse<BookRecord>(await this.d.getAllAsync<Row>('SELECT json FROM books WHERE id = ?', id))[0]; }
  async findByHash(hash: string) { return parse<BookRecord>(await this.d.getAllAsync<Row>('SELECT json FROM books WHERE hash = ?', hash))[0]; }
  async putBook(r: BookRecord) {
    await this.d.runAsync('INSERT OR REPLACE INTO books (id, hash, json) VALUES (?, ?, ?)', r.id, r.hash, JSON.stringify(r));
  }
  async deleteBook(id: string) {
    await this.d.withTransactionAsync(async () => {
      await this.d.runAsync('DELETE FROM books WHERE id = ?', id);
      await this.d.runAsync('DELETE FROM progress WHERE book_id = ?', id);
      await this.d.runAsync('DELETE FROM bookmarks WHERE book_id = ?', id);
      await this.d.runAsync('DELETE FROM highlights WHERE book_id = ?', id);
    });
  }
  async getProgress(bookId: string) { return parse<ProgressRecord>(await this.d.getAllAsync<Row>('SELECT json FROM progress WHERE book_id = ?', bookId))[0]; }
  async listProgress() { return parse<ProgressRecord>(await this.d.getAllAsync<Row>('SELECT json FROM progress')); }
  async putProgress(p: ProgressRecord) {
    await this.d.runAsync('INSERT OR REPLACE INTO progress (book_id, json) VALUES (?, ?)', p.bookId, JSON.stringify(p));
  }
  async listBookmarks(bookId: string) {
    return parse<Bookmark>(await this.d.getAllAsync<Row>('SELECT json FROM bookmarks WHERE book_id = ?', bookId)).sort((a, b) => a.createdAt - b.createdAt);
  }
  async putBookmark(b: Bookmark) { await this.d.runAsync('INSERT OR REPLACE INTO bookmarks (id, book_id, json) VALUES (?, ?, ?)', b.id, b.bookId, JSON.stringify(b)); }
  async deleteBookmark(id: string) { await this.d.runAsync('DELETE FROM bookmarks WHERE id = ?', id); }
  async listHighlights(bookId: string) {
    return parse<Highlight>(await this.d.getAllAsync<Row>('SELECT json FROM highlights WHERE book_id = ?', bookId)).sort((a, b) => a.section - b.section || a.start - b.start);
  }
  async putHighlight(h: Highlight) { await this.d.runAsync('INSERT OR REPLACE INTO highlights (id, book_id, json) VALUES (?, ?, ?)', h.id, h.bookId, JSON.stringify(h)); }
  async deleteHighlight(id: string) { await this.d.runAsync('DELETE FROM highlights WHERE id = ?', id); }
  async listCollections() { return parse<Collection>(await this.d.getAllAsync<Row>('SELECT json FROM collections')).sort((a, b) => a.createdAt - b.createdAt); }
  async putCollection(c: Collection) { await this.d.runAsync('INSERT OR REPLACE INTO collections (id, json) VALUES (?, ?)', c.id, JSON.stringify(c)); }
  async deleteCollection(id: string) {
    const books = await this.listBooks();
    await this.d.withTransactionAsync(async () => {
      await this.d.runAsync('DELETE FROM collections WHERE id = ?', id);
      for (const b of books) {
        if (b.collectionIds.includes(id)) await this.putBook({ ...b, collectionIds: b.collectionIds.filter((x) => x !== id) });
      }
    });
  }
  async getKV(key: string) {
    const r = await this.d.getFirstAsync<{ value: string }>('SELECT value FROM kv WHERE key = ?', key);
    return r?.value;
  }
  async setKV(key: string, value: string) { await this.d.runAsync('INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)', key, value); }
}
