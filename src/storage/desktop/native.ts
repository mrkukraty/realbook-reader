// Thin wrappers around Tauri commands. Safe to import in the browser: nothing touches Tauri until called.
import { invoke } from '@tauri-apps/api/core';

/** True when running inside the Tauri desktop shell. */
export function isTauri(): boolean {
  return typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);
}

interface PickedInfo { path: string; name: string; size: number }

const MIME: Record<string, string> = {
  epub: 'application/epub+zip', pdf: 'application/pdf', txt: 'text/plain', html: 'text/html', htm: 'text/html',
  md: 'text/markdown', markdown: 'text/markdown', fb2: 'application/x-fictionbook+xml', rtf: 'application/rtf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', cbz: 'application/vnd.comicbook+zip',
};

/**
 * Opens the native multi-select file dialog and returns the chosen files as `File` objects, ready
 * for the same import pipeline used for browser file inputs. Returns [] if cancelled.
 */
export async function pickBooksNative(): Promise<File[]> {
  const picked = await invoke<PickedInfo[]>('pick_book_files');
  const files: File[] = [];
  for (const p of picked) {
    const buf = await invoke<ArrayBuffer>('read_picked_file', { path: p.path });
    const ext = p.name.split('.').pop()?.toLowerCase() ?? '';
    files.push(new File([buf], p.name, { type: MIME[ext] ?? '' }));
  }
  return files;
}

/** Reveals the app data folder in the OS file manager. */
export function openDataDir(): Promise<void> {
  return invoke('open_data_dir');
}
