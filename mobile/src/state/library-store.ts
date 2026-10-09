import { create } from 'zustand';
import { File } from 'expo-file-system';
import * as DocumentPicker from 'expo-document-picker';
import type { BookMetadata } from '../formats/types';
import type { BookRecord, Collection, ProgressRecord } from '../storage/types';
import { uid } from '../storage/library-logic';
import { importMany, summarizeResults, type ImportResult, type PickedFile } from '../import/importer';
import { fileStore, sha256Hex } from '../platform/files';
import { getRepo } from './repo';

export interface ImportStatus { active: boolean; index: number; total: number; fileName: string; progress: number; label?: string }

interface LibraryState {
  books: BookRecord[];
  progress: Record<string, ProgressRecord>;
  collections: Collection[];
  loaded: boolean;
  error: string | null;
  importStatus: ImportStatus | null;
  load(): Promise<void>;
  pickAndImport(): Promise<{ results: ImportResult[]; summary: string } | null>;
  removeBook(id: string): Promise<void>;
  toggleFavorite(id: string): Promise<void>;
  updateMetadata(id: string, meta: BookMetadata): Promise<void>;
  setBookCollections(id: string, collectionIds: string[]): Promise<void>;
  addCollection(name: string): Promise<Collection>;
  renameCollection(id: string, name: string): Promise<void>;
  deleteCollection(id: string): Promise<void>;
  markOpened(id: string): Promise<void>;
  setProgress(p: ProgressRecord): Promise<void>;
  patchBook(id: string, patch: Partial<BookRecord>): Promise<void>;
}

export const useLibrary = create<LibraryState>((set, get) => {
  const saveBook = async (b: BookRecord) => {
    await (await getRepo()).putBook(b);
    set({ books: get().books.map((x) => (x.id === b.id ? b : x)) });
  };
  return {
    books: [], progress: {}, collections: [], loaded: false, error: null, importStatus: null,

    async load() {
      try {
        const r = await getRepo();
        const [books, prog, collections] = await Promise.all([r.listBooks(), r.listProgress(), r.listCollections()]);
        const progress: Record<string, ProgressRecord> = {};
        for (const p of prog) progress[p.bookId] = p;
        set({ books, progress, collections, loaded: true, error: null });
      } catch (e) {
        set({ loaded: true, error: e instanceof Error ? e.message : String(e) });
      }
    },

    async pickAndImport() {
      const res = await DocumentPicker.getDocumentAsync({ multiple: true, copyToCacheDirectory: true, type: '*/*' });
      if (res.canceled || !res.assets?.length) return null;
      const picked: PickedFile[] = res.assets.map((a) => ({
        name: a.name ?? a.uri.split('/').pop() ?? 'book',
        size: a.size ?? undefined,
        readBytes: () => new File(a.uri).bytes(),
      }));
      const repo = await getRepo();
      set({ importStatus: { active: true, index: 0, total: picked.length, fileName: picked[0].name, progress: 0 } });
      let results: ImportResult[] = [];
      try {
        results = await importMany(picked, { repo, files: fileStore, sha256: sha256Hex }, (i, p, label) => {
          set({ importStatus: { active: true, index: i, total: picked.length, fileName: picked[i].name, progress: p, label } });
        });
      } finally {
        // remove the picker's temporary cache copies (the app keeps its own copy in documents)
        for (const a of res.assets) { try { const f = new File(a.uri); if (f.exists) f.delete(); } catch { /* ignore */ } }
        set({ importStatus: null });
      }
      await get().load();
      return { results, summary: summarizeResults(results) };
    },

    async removeBook(id) {
      const r = await getRepo();
      await r.deleteBook(id);
      try { await fileStore.deleteBook(id); } catch { /* files may already be gone */ }
      const progress = { ...get().progress };
      delete progress[id];
      set({ books: get().books.filter((b) => b.id !== id), progress });
    },

    async toggleFavorite(id) {
      const b = get().books.find((x) => x.id === id);
      if (b) await saveBook({ ...b, favorite: !b.favorite });
    },
    async updateMetadata(id, meta) {
      const b = get().books.find((x) => x.id === id);
      if (!b) return;
      const title = meta.title.trim() || b.metadata.title;
      await saveBook({ ...b, metadata: { ...meta, title } });
    },
    async setBookCollections(id, collectionIds) {
      const b = get().books.find((x) => x.id === id);
      if (b) await saveBook({ ...b, collectionIds });
    },
    async addCollection(name) {
      const c: Collection = { id: uid(), name: name.trim() || 'Untitled collection', createdAt: Date.now() };
      await (await getRepo()).putCollection(c);
      set({ collections: [...get().collections, c] });
      return c;
    },
    async renameCollection(id, name) {
      const c = get().collections.find((x) => x.id === id);
      if (!c) return;
      const n = { ...c, name: name.trim() || c.name };
      await (await getRepo()).putCollection(n);
      set({ collections: get().collections.map((x) => (x.id === id ? n : x)) });
    },
    async deleteCollection(id) {
      await (await getRepo()).deleteCollection(id);
      set({
        collections: get().collections.filter((c) => c.id !== id),
        books: get().books.map((b) => (b.collectionIds.includes(id) ? { ...b, collectionIds: b.collectionIds.filter((x) => x !== id) } : b)),
      });
    },
    async markOpened(id) {
      const b = get().books.find((x) => x.id === id);
      if (b) await saveBook({ ...b, lastOpenedAt: Date.now() });
    },
    async setProgress(p) {
      set({ progress: { ...get().progress, [p.bookId]: p } });
      await (await getRepo()).putProgress(p);
    },
    async patchBook(id, patch) {
      const b = get().books.find((x) => x.id === id);
      if (b) await saveBook({ ...b, ...patch });
    },
  };
});
