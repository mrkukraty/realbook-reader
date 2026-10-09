import { SqliteRepo } from '../storage/sqlite-repo';
import { MemoryRepo } from '../storage/memory-repo';
import type { LibraryRepo } from '../storage/types';

let repo: LibraryRepo | null = null;
let initPromise: Promise<LibraryRepo> | null = null;
export let repoFallbackReason: string | null = null;

/** Opens the SQLite database once. Falls back to an in-memory store (with a visible warning) if SQLite fails. */
export function getRepo(): Promise<LibraryRepo> {
  if (repo) return Promise.resolve(repo);
  if (!initPromise) {
    initPromise = (async () => {
      const r = new SqliteRepo();
      try {
        await r.init();
        repo = r;
      } catch (e) {
        repoFallbackReason = `The library database could not be opened (${e instanceof Error ? e.message : String(e)}). Changes will not be saved this session.`;
        const m = new MemoryRepo();
        await m.init();
        repo = m;
      }
      return repo;
    })();
  }
  return initPromise;
}
