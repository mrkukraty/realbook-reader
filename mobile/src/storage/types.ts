import type { BookMetadata, FormatId, TocItem } from '../formats/types';

/** Compatible with the web StorageAdapter's BookRecord; `cover` (Blob) becomes `coverPath` (file URI). */
export interface BookRecord {
  id: string;
  hash: string;             // sha-256 hex of file bytes (duplicate detection)
  fileName: string;
  format: FormatId;
  size: number;
  metadata: BookMetadata;   // user-editable
  coverPath?: string;       // file:// URI of the cover image inside the app documents dir
  pageCount?: number;       // fixed-layout books only
  hasText?: boolean;
  favorite: boolean;
  collectionIds: string[];
  addedAt: number;
  lastOpenedAt?: number;
  /** reflow: number of sections; stored for progress weighting */
  sectionCount?: number;
}

export interface ProgressRecord {
  bookId: string;
  section?: number;
  sectionFraction?: number;
  page?: number;
  fraction: number;
  updatedAt: number;
}

export interface Bookmark {
  id: string; bookId: string; createdAt: number; label: string;
  section?: number; sectionFraction?: number; page?: number;
}

export type HighlightColor = 'yellow' | 'green' | 'blue' | 'pink';
export interface Highlight {
  id: string; bookId: string; createdAt: number;
  section: number; start: number; end: number; // char offsets in section textContent
  text: string; color: HighlightColor;
  note?: string;
}

export interface Collection { id: string; name: string; createdAt: number }

/** Parsed reflow content manifest stored next to the book file. */
export interface ContentManifest {
  version: 1;
  kind: 'reflow' | 'fixed';
  sections: { id: string; title?: string; chars: number }[];
  toc: TocItem[];
  /** CBZ only */
  imagePaths?: string[];
}

export interface LibraryRepo {
  init(): Promise<void>;
  listBooks(): Promise<BookRecord[]>;
  getBook(id: string): Promise<BookRecord | undefined>;
  findByHash(hash: string): Promise<BookRecord | undefined>;
  putBook(record: BookRecord): Promise<void>;
  deleteBook(id: string): Promise<void>; // also deletes progress, bookmarks, highlights
  getProgress(bookId: string): Promise<ProgressRecord | undefined>;
  listProgress(): Promise<ProgressRecord[]>;
  putProgress(p: ProgressRecord): Promise<void>;
  listBookmarks(bookId: string): Promise<Bookmark[]>;
  putBookmark(b: Bookmark): Promise<void>;
  deleteBookmark(id: string): Promise<void>;
  listHighlights(bookId: string): Promise<Highlight[]>;
  putHighlight(h: Highlight): Promise<void>;
  deleteHighlight(id: string): Promise<void>;
  listCollections(): Promise<Collection[]>;
  putCollection(c: Collection): Promise<void>;
  deleteCollection(id: string): Promise<void>; // removes the id from books too
  getKV(key: string): Promise<string | undefined>;
  setKV(key: string, value: string): Promise<void>;
}
