import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { storage } from '../../storage';
import type { Bookmark, BookRecord, Collection, Highlight, ProgressRecord, StorageUsage } from '../../storage/StorageAdapter';
import { uid } from '../../utils/format';
import type { ProgressMap } from './logic';

/** Re-runs `load` on mount and after every storage write (also from other tabs). */
export function useStorageQuery<T>(load: () => Promise<T>, initial: T, deps: unknown[] = []): { data: T; loading: boolean; error?: string } {
  const [state, setState] = useState<{ data: T; loading: boolean; error?: string }>({ data: initial, loading: true });
  const loadRef = useRef(load); loadRef.current = load;
  useEffect(() => {
    let alive = true; let seq = 0;
    const run = () => {
      const my = ++seq;
      loadRef.current().then(
        (data) => { if (alive && my === seq) setState({ data, loading: false }); },
        (e) => { if (alive && my === seq) setState((s) => ({ ...s, loading: false, error: e instanceof Error ? e.message : String(e) })); },
      );
    };
    run();
    const off = storage.subscribe(run);
    return () => { alive = false; off(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return state;
}

export interface LibraryData {
  books: BookRecord[];
  progress: ProgressMap;
  collections: Collection[];
  loading: boolean;
  error?: string;
}

const EMPTY: Omit<LibraryData, 'loading' | 'error'> = { books: [], progress: {}, collections: [] };

export function useLibrary(): LibraryData {
  const { data, loading, error } = useStorageQuery(async () => {
    const [books, prog, collections] = await Promise.all([storage.listBooks(), storage.listProgress(), storage.listCollections()]);
    const progress: ProgressMap = {};
    for (const p of prog) progress[p.bookId] = p;
    return { books, progress, collections };
  }, EMPTY);
  return { ...data, loading, error };
}

export function useBook(id: string | undefined) {
  return useStorageQuery(async () => (id ? storage.getBook(id) : undefined), undefined as BookRecord | undefined, [id]);
}

export function useBookProgress(id: string | undefined): ProgressRecord | undefined {
  return useStorageQuery(async () => (id ? storage.getProgress(id) : undefined), undefined as ProgressRecord | undefined, [id]).data;
}

export function useAnnotationCounts(id: string | undefined): { bookmarks: number; notes: number; highlights: number } {
  return useStorageQuery(async () => {
    if (!id) return { bookmarks: 0, notes: 0, highlights: 0 };
    const [b, h]: [Bookmark[], Highlight[]] = await Promise.all([storage.listBookmarks(id), storage.listHighlights(id)]);
    return { bookmarks: b.length, highlights: h.length, notes: h.filter((x) => x.note?.trim()).length };
  }, { bookmarks: 0, notes: 0, highlights: 0 }, [id]).data;
}

/** Object URL for a cover blob, revoked automatically. */
export function useCoverUrl(blob?: Blob): string | undefined {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    if (!blob) { setUrl(undefined); return; }
    const u = URL.createObjectURL(blob); setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);
  return url;
}

export function useStorageUsage(): { usage: StorageUsage; refresh: () => void } {
  const [usage, setUsage] = useState<StorageUsage>({});
  const [tick, setTick] = useState(0);
  useEffect(() => { let a = true; storage.usage().then((u) => a && setUsage(u)).catch(() => {}); return () => { a = false; }; }, [tick]);
  useEffect(() => storage.subscribe(() => setTick((t) => t + 1)), []);
  return { usage, refresh: useCallback(() => setTick((t) => t + 1), []) };
}

/** Mutations used by the UI. Business logic lives here, not in components. */
export const libraryActions = {
  toggleFavorite: (b: BookRecord) => storage.updateBook(b.id, { favorite: !b.favorite }),
  markOpened: (id: string) => storage.updateBook(id, { lastOpenedAt: Date.now() }),
  updateMetadata: (b: BookRecord, patch: Partial<BookRecord['metadata']>) => storage.updateBook(b.id, { metadata: { ...b.metadata, ...patch } }),
  remove: (id: string) => storage.removeBook(id),
  clear: () => storage.clearLibrary(),
  createCollection: async (name: string) => { const c: Collection = { id: uid(), name: name.trim(), createdAt: Date.now() }; await storage.putCollection(c); return c; },
  renameCollection: (c: Collection, name: string) => storage.putCollection({ ...c, name: name.trim() }),
  deleteCollection: (id: string) => storage.removeCollection(id),
  toggleInCollection: (b: BookRecord, collectionId: string) => {
    const has = b.collectionIds.includes(collectionId);
    return storage.updateBook(b.id, { collectionIds: has ? b.collectionIds.filter((c) => c !== collectionId) : [...b.collectionIds, collectionId] });
  },
};

export function useDebounced<T>(value: T, ms = 150): T {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

export function useMemoCount<T>(items: T[], pred: (t: T) => boolean) { return useMemo(() => items.filter(pred).length, [items, pred]); }
