import type { StorageAdapter } from './StorageAdapter';
import { BrowserStorage } from './BrowserStorage';
import { isTauri } from './desktop/native';

export { StorageQuotaError } from './StorageAdapter';
export type * from './StorageAdapter';
export { requestPersistence } from './BrowserStorage';

async function create(): Promise<StorageAdapter> {
  if (typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || isTauri())) {
    try {
      // Written by the desktop agent; resolved at runtime only on Tauri.
      const mod = await import('./DesktopStorage');
      return new mod.DesktopStorage();
    } catch (e) {
      console.error('Desktop storage unavailable, falling back to browser storage', e);
    }
  }
  return new BrowserStorage();
}

export const storageReady: Promise<StorageAdapter> = create();

// Thin proxy: every method awaits the real adapter, so callers just use `storage.x()`.
// subscribe() is synchronous, so it attaches once the adapter resolves.
let resolved: StorageAdapter | undefined;
storageReady.then((s) => { resolved = s; });

export const storage: StorageAdapter = new Proxy({} as StorageAdapter, {
  get(_t, prop: string) {
    if (prop === 'kind') return resolved?.kind ?? 'browser';
    if (prop === 'subscribe') {
      return (cb: () => void) => {
        let off: (() => void) | undefined; let cancelled = false;
        storageReady.then((s) => { if (!cancelled) { off = s.subscribe(cb); cb(); } });
        return () => { cancelled = true; off?.(); };
      };
    }
    if (prop === 'then') return undefined;
    return async (...args: unknown[]) => {
      const s = await storageReady;
      return (s as any)[prop](...args);
    };
  },
});
