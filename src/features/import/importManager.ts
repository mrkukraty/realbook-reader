import { create } from 'zustand';
import { detectFormat, openBook } from '../../formats/registry';
import { ImportError, type BookDocument, type BookMetadata } from '../../formats/types';
import { storage as defaultStorage } from '../../storage';
import { StorageQuotaError, type BookRecord, type StorageAdapter } from '../../storage/StorageAdapter';
import { makePlaceholderCover, makeThumbnail, renderFixedCover } from '../../utils/cover';
import { fileExt, stripExt, uid } from '../../utils/format';
import { hashBlob } from '../../utils/hash';
import { unsupportedHint } from './formats';

export type ImportStatus =
  | 'queued' | 'hashing' | 'parsing' | 'saving' | 'done' | 'duplicate' | 'error' | 'unsupported';

export interface ImportItem {
  id: string;
  name: string;
  size: number;
  status: ImportStatus;
  /** 0..1 within the current step, when known */
  progress?: number;
  message?: string;
  /** set for done and duplicate so the UI can offer "Open" */
  bookId?: string;
}

export const MAX_FILE_BYTES = 2 * 1024 * 1024 * 1024;

export const QUOTA_MESSAGE =
  'There is not enough storage space for this book. Remove some books you no longer need (Library > Remove) or free disk space, then try again. ' +
  'Note: clearing your browser\'s site data deletes every book stored locally, so export or keep your originals.';

export const isFinished = (s: ImportStatus) => s === 'done' || s === 'duplicate' || s === 'error' || s === 'unsupported';

export interface ImportOptions {
  storage?: StorageAdapter;
  signal?: AbortSignal;
}

function friendlyError(e: unknown): string {
  if (e instanceof StorageQuotaError || (e as any)?.name === 'StorageQuotaError') return QUOTA_MESSAGE;
  if (e instanceof ImportError) return e.message;
  const m = e instanceof Error ? e.message : String(e);
  return `This file could not be imported: ${m || 'unknown error'}`;
}

async function buildCover(doc: BookDocument, meta: BookMetadata): Promise<Blob | undefined> {
  if (doc.cover) { const t = await makeThumbnail(doc.cover); if (t) return t; }
  if (doc.kind === 'fixed') { const t = await renderFixedCover(doc); if (t) return t; }
  return makePlaceholderCover(meta);
}

async function importOne(file: File, item: ImportItem, update: (p: Partial<ImportItem>) => void, opts: ImportOptions) {
  const store = opts.storage ?? defaultStorage;
  // 1. size sanity
  if (file.size === 0) throw new ImportError('This file is empty (0 bytes).', 'corrupt');
  if (file.size > MAX_FILE_BYTES) throw new ImportError('This file is larger than 2 GB, which is too big to store in the library.', 'too-large');

  // 2. fingerprint (see hashBlob: huge files use first+last 8MB + size)
  update({ status: 'hashing', progress: undefined });
  const hash = await hashBlob(file);
  const dup = await store.findByHash(hash);
  if (dup) {
    update({ status: 'duplicate', bookId: dup.id, message: `Already in your library as "${dup.metadata.title}".` });
    return;
  }

  // 3. format detection
  update({ status: 'parsing', progress: 0 });
  const det = await detectFormat(file, file.name);
  if (det.status !== 'supported') {
    const hint = unsupportedHint(fileExt(file.name));
    update({ status: 'unsupported', message: [det.message, hint && !det.message.includes(hint) ? hint : ''].filter(Boolean).join(' ') });
    return;
  }

  let doc: BookDocument | undefined;
  try {
    doc = await openBook(file, file.name, (f) => update({ progress: f }));
    const metadata: BookMetadata = {
      ...doc.metadata,
      title: doc.metadata.title?.trim() || stripExt(file.name),
    };
    const cover = await buildCover(doc, metadata);
    update({ status: 'saving', progress: undefined });
    const record: BookRecord = {
      id: uid(), hash, fileName: file.name, format: det.adapter.id, size: file.size, metadata, cover,
      pageCount: doc.kind === 'fixed' ? doc.pageCount : undefined,
      hasText: doc.kind === 'fixed' ? doc.hasText : true,
      favorite: false, collectionIds: [], addedAt: Date.now(),
    };
    await store.addBook(record, file);
    update({ status: 'done', bookId: record.id, message: undefined });
  } finally {
    try { doc?.dispose(); } catch { /* ignore */ }
  }
}

/**
 * Imports files one after another. A failure in one file never stops the rest.
 * onProgress receives a fresh snapshot of all items after each change.
 */
export async function importFiles(
  files: File[],
  onProgress: (items: ImportItem[]) => void = () => {},
  opts: ImportOptions = {},
  /** items may be pre-created by the UI store so ids stay stable */
  preset?: ImportItem[],
): Promise<ImportItem[]> {
  const items: ImportItem[] = preset ?? files.map((f) => ({ id: uid(), name: f.name, size: f.size, status: 'queued' as const }));
  const emit = () => onProgress(items.map((i) => ({ ...i })));
  emit();
  for (let i = 0; i < files.length; i++) {
    const item = items[i];
    const update = (p: Partial<ImportItem>) => { Object.assign(item, p); emit(); };
    if (opts.signal?.aborted) { update({ status: 'error', message: 'Import cancelled.' }); continue; }
    try {
      await importOne(files[i], item, update, opts);
    } catch (e) {
      update({ status: 'error', progress: undefined, message: friendlyError(e) });
    }
  }
  return items;
}

interface ImportUi {
  items: ImportItem[];
  running: boolean;
  panelOpen: boolean;
  start: (files: File[]) => Promise<void>;
  dismiss: (id: string) => void;
  dismissFinished: () => void;
  setPanelOpen: (v: boolean) => void;
}

let chain: Promise<unknown> = Promise.resolve(); // imports from separate drops/picks run strictly one after another

export const useImportStore = create<ImportUi>((set, get) => ({
  items: [], running: false, panelOpen: false,
  start: async (files) => {
    if (!files.length) return;
    const fresh: ImportItem[] = files.map((f) => ({ id: uid(), name: f.name, size: f.size, status: 'queued' }));
    const base = get().items;
    set({ items: [...base, ...fresh], panelOpen: true, running: true });
    const ids = new Set(fresh.map((f) => f.id));
    const run = async () => {
      try {
        await importFiles(files, (snap) => {
          const byId = new Map(snap.map((s) => [s.id, s]));
          set((st) => ({ items: st.items.map((i) => (ids.has(i.id) ? byId.get(i.id) ?? i : i)) }));
        }, {}, fresh);
      } finally {
        set((st) => ({ running: st.items.some((i) => !isFinished(i.status)) }));
      }
    };
    chain = chain.then(run, run);
    await chain;
  },
  dismiss: (id) => set((s) => ({ items: s.items.filter((i) => i.id !== id) })),
  dismissFinished: () => set((s) => ({ items: s.items.filter((i) => !isFinished(i.status)) })),
  setPanelOpen: (v) => set({ panelOpen: v }),
}));
