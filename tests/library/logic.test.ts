import { describe, expect, it } from 'vitest';
import { continueReading, matchesQuery, selectBooks, sortBooks } from '../../src/features/library/logic';
import type { BookRecord, ProgressRecord } from '../../src/storage/StorageAdapter';

const b = (id: string, title: string, author: string | undefined, over: Partial<BookRecord> = {}): BookRecord => ({
  id, hash: id, fileName: id, format: 'epub', size: 1, metadata: { title, author }, favorite: false, collectionIds: [], addedAt: 0, ...over,
});
const p = (bookId: string, fraction: number): ProgressRecord => ({ bookId, fraction, updatedAt: 0 });

const books = [
  b('1', 'Zebra Tales', 'Alice', { addedAt: 10, lastOpenedAt: 100, favorite: true, collectionIds: ['c1'] }),
  b('2', 'apple pie', 'Bob', { addedAt: 30 }),
  b('3', 'Moby Dick', undefined, { addedAt: 20, lastOpenedAt: 300, collectionIds: ['c1'] }),
  b('4', 'Book 10', 'Carol', { addedAt: 5, lastOpenedAt: 200 }),
  b('5', 'Book 2', 'Carol', { addedAt: 6 }),
];
const prog = { '1': p('1', 0.5), '3': p('3', 1), '4': p('4', 0.1) };

describe('library logic', () => {
  it('searches title and author, all terms, case-insensitive', () => {
    expect(matchesQuery(books[0], 'zebra')).toBe(true);
    expect(matchesQuery(books[0], 'alice tales')).toBe(true);
    expect(matchesQuery(books[0], 'bob')).toBe(false);
    expect(matchesQuery(books[0], '  ')).toBe(true);
  });

  it('sorts by title (natural, case-insensitive)', () => {
    expect(sortBooks(books, 'title', prog).map((x) => x.id)).toEqual(['2', '5', '4', '3', '1']);
  });

  it('sorts by author with missing authors last', () => {
    expect(sortBooks(books, 'author', prog).map((x) => x.id)).toEqual(['1', '2', '5', '4', '3']);
  });

  it('sorts by added (newest first), opened, and progress', () => {
    expect(sortBooks(books, 'added', prog).map((x) => x.id)).toEqual(['2', '3', '1', '5', '4']);
    expect(sortBooks(books, 'opened', prog).slice(0, 3).map((x) => x.id)).toEqual(['3', '4', '1']);
    expect(sortBooks(books, 'progress', prog).slice(0, 3).map((x) => x.id)).toEqual(['3', '1', '4']);
  });

  it('does not mutate input', () => {
    const copy = [...books]; sortBooks(books, 'title', prog);
    expect(books).toEqual(copy);
  });

  it('filters', () => {
    const ids = (f: any) => selectBooks(books, { query: '', filter: f, sort: 'title', progress: prog }).map((x) => x.id).sort();
    expect(ids('all')).toHaveLength(5);
    expect(ids('favorites')).toEqual(['1']);
    expect(ids('reading')).toEqual(['1', '4']);
    expect(ids('finished')).toEqual(['3']);
    expect(ids('collection:c1')).toEqual(['1', '3']);
    expect(ids('collection:none')).toEqual([]);
  });

  it('combines query and filter', () => {
    expect(selectBooks(books, { query: 'book', filter: 'reading', sort: 'title', progress: prog }).map((x) => x.id)).toEqual(['4']);
  });

  it('continue reading excludes finished and unopened, newest first', () => {
    expect(continueReading(books, prog).map((x) => x.id)).toEqual(['4', '1']);
    expect(continueReading(books, prog, 1)).toHaveLength(1);
  });
});
