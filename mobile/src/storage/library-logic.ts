// Pure library helpers (unit-tested).
import type { BookRecord, ProgressRecord } from './types';

export type SortKey = 'recent' | 'added' | 'title' | 'author' | 'progress' | 'size';
export const SORT_LABELS: Record<SortKey, string> = {
  recent: 'Recently read', added: 'Recently added', title: 'Title', author: 'Author', progress: 'Progress', size: 'File size',
};

export interface LibraryQuery {
  text?: string;
  sort: SortKey;
  favoritesOnly?: boolean;
  collectionId?: string | null;
}

const norm = (s: string | undefined) => (s ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function filterAndSortBooks(
  books: BookRecord[],
  progress: Map<string, ProgressRecord> | Record<string, ProgressRecord>,
  q: LibraryQuery,
): BookRecord[] {
  const pget = (id: string) => (progress instanceof Map ? progress.get(id) : progress[id]);
  const words = norm(q.text).split(/\s+/).filter(Boolean);
  let out = books.filter((b) => {
    if (q.favoritesOnly && !b.favorite) return false;
    if (q.collectionId && !b.collectionIds.includes(q.collectionId)) return false;
    if (!words.length) return true;
    const hay = norm(`${b.metadata.title} ${b.metadata.author ?? ''} ${b.fileName} ${b.format}`);
    return words.every((w) => hay.includes(w));
  });
  const byTitle = (a: BookRecord, b: BookRecord) => norm(a.metadata.title).localeCompare(norm(b.metadata.title));
  const cmp: Record<SortKey, (a: BookRecord, b: BookRecord) => number> = {
    recent: (a, b) => (b.lastOpenedAt ?? 0) - (a.lastOpenedAt ?? 0) || b.addedAt - a.addedAt,
    added: (a, b) => b.addedAt - a.addedAt,
    title: byTitle,
    author: (a, b) => norm(a.metadata.author ?? '￿').localeCompare(norm(b.metadata.author ?? '￿')) || byTitle(a, b),
    progress: (a, b) => (pget(b.id)?.fraction ?? 0) - (pget(a.id)?.fraction ?? 0) || byTitle(a, b),
    size: (a, b) => b.size - a.size,
  };
  out = [...out].sort(cmp[q.sort] ?? cmp.recent);
  return out;
}

export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '?';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1048576).toFixed(1)} MB`;
  return `${(n / 1073741824).toFixed(2)} GB`;
}

/** Human description of what removing a book deletes (shown in the confirmation dialog). */
export function deletionSummary(b: BookRecord, counts: { bookmarks: number; highlights: number; hasProgress: boolean }): string {
  const parts = [
    `the imported copy of "${b.fileName}" (${formatBytes(b.size)}) and its cached pages/cover`,
    counts.hasProgress ? 'your reading position' : null,
    counts.bookmarks ? `${counts.bookmarks} bookmark${counts.bookmarks === 1 ? '' : 's'}` : null,
    counts.highlights ? `${counts.highlights} highlight${counts.highlights === 1 ? '' : 's'}/note${counts.highlights === 1 ? '' : 's'}` : null,
  ].filter(Boolean);
  return `This permanently deletes ${parts.join(', ')} from this device. The original file you picked (outside the app) is not touched.`;
}

export function uid(): string {
  const r = () => Math.floor(Math.random() * 0x100000000).toString(16).padStart(8, '0');
  return `${Date.now().toString(36)}-${r()}${r()}`;
}
