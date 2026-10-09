// Import orchestration. Platform services (files, hashing) are injected so the logic is unit-testable.
import { ImportError, type BookDocument } from '../formats/types';
import { openBookDetailed } from '../formats/registry';
import { baseName, extOf } from '../formats/util';
import type { BookRecord, ContentManifest, LibraryRepo } from '../storage/types';
import { uid } from '../storage/library-logic';

export interface BookFileStore {
  saveOriginal(id: string, ext: string, bytes: Uint8Array): Promise<void>;
  saveCover(id: string, bytes: Uint8Array, mime: string): Promise<string | undefined>;
  saveContent(id: string, manifest: ContentManifest, sectionsHtml: string[]): Promise<void>;
  deleteBook(id: string): Promise<void>;
}

export interface PickedFile {
  name: string;
  size?: number;
  readBytes(): Promise<Uint8Array>;
}

export interface ImportDeps {
  repo: LibraryRepo;
  files: BookFileStore;
  sha256(bytes: Uint8Array): Promise<string>;
  now?: () => number;
}

export type ImportResult =
  | { status: 'imported'; fileName: string; book: BookRecord }
  | { status: 'duplicate'; fileName: string; existing: BookRecord }
  | { status: 'failed'; fileName: string; message: string; code: ImportError['code'] };

export function contentManifestOf(doc: BookDocument): { manifest: ContentManifest; html: string[] } {
  if (doc.kind === 'reflow') {
    return {
      manifest: {
        version: 1, kind: 'reflow', toc: doc.toc,
        sections: doc.sections.map((s) => ({ id: s.id, title: s.title, chars: s.html.replace(/<[^>]*>/g, '').length })),
      },
      html: doc.sections.map((s) => s.html),
    };
  }
  return { manifest: { version: 1, kind: 'fixed', toc: doc.toc, sections: [], imagePaths: doc.imagePaths }, html: [] };
}

export async function importOne(file: PickedFile, deps: ImportDeps, onProgress?: (f: number, label?: string) => void): Promise<ImportResult> {
  const fileName = baseName(file.name || 'book');
  const now = deps.now ?? Date.now;
  let id: string | null = null;
  try {
    if (file.size === 0) throw new ImportError(`"${fileName}" is empty (0 bytes), so there is nothing to import.`, 'corrupt');
    onProgress?.(0.02, 'Reading file');
    let bytes: Uint8Array;
    try {
      bytes = await file.readBytes();
    } catch (e) {
      throw new ImportError(`"${fileName}" could not be read from the device (${e instanceof Error ? e.message : String(e)}).`, 'unknown');
    }
    if (bytes.length === 0) throw new ImportError(`"${fileName}" is empty (0 bytes), so there is nothing to import.`, 'corrupt');
    onProgress?.(0.08, 'Checking for duplicates');
    const hash = await deps.sha256(bytes);
    const existing = await deps.repo.findByHash(hash);
    if (existing) return { status: 'duplicate', fileName, existing };

    onProgress?.(0.12, 'Parsing');
    const { doc, format } = await openBookDetailed(bytes, fileName, (f, l) => onProgress?.(0.12 + f * 0.7, l));
    id = uid();
    onProgress?.(0.85, 'Saving');
    const { manifest, html } = contentManifestOf(doc);
    await deps.files.saveOriginal(id, extOf(fileName) || 'bin', bytes);
    await deps.files.saveContent(id, manifest, html);
    let coverPath: string | undefined;
    if (doc.cover) {
      try { coverPath = await deps.files.saveCover(id, doc.cover.bytes, doc.cover.mime); } catch { /* cover is optional */ }
    }
    const book: BookRecord = {
      id, hash, fileName, format, size: bytes.length, metadata: doc.metadata, coverPath,
      pageCount: doc.kind === 'fixed' ? doc.pageCount || undefined : undefined,
      hasText: doc.kind === 'fixed' ? doc.hasText : true,
      favorite: false, collectionIds: [], addedAt: now(),
      sectionCount: doc.kind === 'reflow' ? doc.sections.length : undefined,
    };
    await deps.repo.putBook(book);
    onProgress?.(1, 'Done');
    return { status: 'imported', fileName, book };
  } catch (e) {
    if (id) { try { await deps.files.deleteBook(id); } catch { /* best effort cleanup */ } }
    const err = e instanceof ImportError ? e : new ImportError(`"${fileName}" could not be imported: ${e instanceof Error ? e.message : String(e)}`, 'unknown');
    return { status: 'failed', fileName, message: err.message, code: err.code };
  }
}

/** Imports files one after another; a failure in one never stops the others. */
export async function importMany(
  files: PickedFile[], deps: ImportDeps,
  onEach?: (index: number, progress: number, label?: string) => void,
): Promise<ImportResult[]> {
  const results: ImportResult[] = [];
  for (let i = 0; i < files.length; i++) {
    results.push(await importOne(files[i], deps, (f, l) => onEach?.(i, f, l)));
  }
  return results;
}

export function summarizeResults(results: ImportResult[]): string {
  const ok = results.filter((r) => r.status === 'imported').length;
  const dup = results.filter((r) => r.status === 'duplicate');
  const failed = results.filter((r) => r.status === 'failed');
  const lines: string[] = [];
  if (ok) lines.push(`Imported ${ok} book${ok === 1 ? '' : 's'}.`);
  for (const d of dup) if (d.status === 'duplicate') lines.push(`"${d.fileName}" is already in your library as "${d.existing.metadata.title}".`);
  for (const f of failed) if (f.status === 'failed') lines.push(f.message);
  return lines.join('\n\n');
}
