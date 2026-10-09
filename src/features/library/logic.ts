import type { BookRecord, ProgressRecord } from '../../storage/StorageAdapter';

export type SortKey = 'title' | 'author' | 'added' | 'opened' | 'progress';
export type FilterKey = 'all' | 'favorites' | 'reading' | 'finished' | `collection:${string}`;

export const FINISHED_AT = 0.98;

export type ProgressMap = Record<string, ProgressRecord | undefined>;

export function bookFraction(p?: ProgressRecord): number { return p ? Math.min(1, Math.max(0, p.fraction || 0)) : 0; }
export const isFinishedBook = (p?: ProgressRecord) => bookFraction(p) >= FINISHED_AT;
export const isInProgress = (p?: ProgressRecord) => { const f = bookFraction(p); return f > 0 && f < FINISHED_AT; };

export function matchesQuery(b: BookRecord, q: string): boolean {
  const s = q.trim().toLowerCase();
  if (!s) return true;
  const hay = `${b.metadata.title} ${b.metadata.author ?? ''}`.toLowerCase();
  return s.split(/\s+/).every((t) => hay.includes(t));
}

export function matchesFilter(b: BookRecord, f: FilterKey, progress: ProgressMap): boolean {
  switch (f) {
    case 'all': return true;
    case 'favorites': return b.favorite;
    case 'reading': return isInProgress(progress[b.id]);
    case 'finished': return isFinishedBook(progress[b.id]);
    default: return f.startsWith('collection:') ? b.collectionIds.includes(f.slice(11)) : true;
  }
}

const coll = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });

export function sortBooks(books: BookRecord[], key: SortKey, progress: ProgressMap): BookRecord[] {
  const arr = [...books];
  const byTitle = (a: BookRecord, b: BookRecord) => coll.compare(a.metadata.title, b.metadata.title);
  switch (key) {
    case 'title': arr.sort(byTitle); break;
    case 'author': arr.sort((a, b) => {
      const aa = a.metadata.author?.trim(), ba = b.metadata.author?.trim();
      if (!aa && !ba) return byTitle(a, b);
      if (!aa) return 1; if (!ba) return -1;
      return coll.compare(aa, ba) || byTitle(a, b);
    }); break;
    case 'added': arr.sort((a, b) => b.addedAt - a.addedAt || byTitle(a, b)); break;
    case 'opened': arr.sort((a, b) => (b.lastOpenedAt ?? 0) - (a.lastOpenedAt ?? 0) || byTitle(a, b)); break;
    case 'progress': arr.sort((a, b) => bookFraction(progress[b.id]) - bookFraction(progress[a.id]) || byTitle(a, b)); break;
  }
  return arr;
}

export function selectBooks(books: BookRecord[], opts: { query: string; filter: FilterKey; sort: SortKey; progress: ProgressMap }): BookRecord[] {
  return sortBooks(books.filter((b) => matchesQuery(b, opts.query) && matchesFilter(b, opts.filter, opts.progress)), opts.sort, opts.progress);
}

/** Recently opened books that are not finished, newest first. */
export function continueReading(books: BookRecord[], progress: ProgressMap, limit = 8): BookRecord[] {
  return books
    .filter((b) => b.lastOpenedAt && !isFinishedBook(progress[b.id]))
    .sort((a, b) => (b.lastOpenedAt ?? 0) - (a.lastOpenedAt ?? 0))
    .slice(0, limit);
}
