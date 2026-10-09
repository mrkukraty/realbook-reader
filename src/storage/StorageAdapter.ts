import type { BookMetadata, FormatId } from '../formats/types';

export interface BookRecord {
  id: string;               // stable uuid
  hash: string;             // sha-256 hex of file bytes (duplicate detection)
  fileName: string;
  format: FormatId;
  size: number;
  metadata: BookMetadata;   // user-editable
  cover?: Blob;             // small JPEG/PNG thumbnail
  pageCount?: number;       // fixed-layout books only
  hasText?: boolean;
  favorite: boolean;
  collectionIds: string[];
  addedAt: number;
  lastOpenedAt?: number;
}

export interface ProgressRecord {
  bookId: string;
  /** reflow: section index + fraction of that section (0..1); fixed: page index */
  section?: number;
  sectionFraction?: number;
  page?: number;
  /** overall 0..1 */
  fraction: number;
  updatedAt: number;
}

export interface Bookmark {
  id: string; bookId: string; createdAt: number; label: string;
  section?: number; sectionFraction?: number; page?: number;
}

export interface Highlight {
  id: string; bookId: string; createdAt: number;
  section: number; start: number; end: number; // char offsets in section textContent
  text: string; color: 'yellow' | 'green' | 'blue' | 'pink';
  note?: string;
}

export interface Collection { id: string; name: string; createdAt: number }

export interface StorageUsage { used?: number; quota?: number; persisted?: boolean }

export class StorageQuotaError extends Error {
  constructor(message = 'Storage is full. Remove some books or free up disk space, then try again.') { super(message); this.name = 'StorageQuotaError'; }
}

export interface StorageAdapter {
  readonly kind: 'browser' | 'desktop';
  // books
  listBooks(): Promise<BookRecord[]>;
  getBook(id: string): Promise<BookRecord | undefined>;
  findByHash(hash: string): Promise<BookRecord | undefined>;
  /** Stores record + file bytes atomically. Throws StorageQuotaError when full. */
  addBook(record: BookRecord, file: Blob): Promise<void>;
  updateBook(id: string, patch: Partial<BookRecord>): Promise<void>;
  /** Removes file, record, progress, bookmarks, highlights. */
  removeBook(id: string): Promise<void>;
  clearLibrary(): Promise<void>;
  getBookFile(id: string): Promise<Blob>;
  // progress
  getProgress(bookId: string): Promise<ProgressRecord | undefined>;
  listProgress(): Promise<ProgressRecord[]>;
  saveProgress(p: ProgressRecord): Promise<void>;
  // annotations
  listBookmarks(bookId: string): Promise<Bookmark[]>;
  putBookmark(b: Bookmark): Promise<void>;
  removeBookmark(id: string): Promise<void>;
  listHighlights(bookId: string): Promise<Highlight[]>;
  putHighlight(h: Highlight): Promise<void>;
  removeHighlight(id: string): Promise<void>;
  // collections
  listCollections(): Promise<Collection[]>;
  putCollection(c: Collection): Promise<void>;
  removeCollection(id: string): Promise<void>;
  // misc
  usage(): Promise<StorageUsage>;
  /** Subscribe to any change (used by UI hooks to stay in sync). Returns unsubscribe. */
  subscribe(cb: () => void): () => void;
}
