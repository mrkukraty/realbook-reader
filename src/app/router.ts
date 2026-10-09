import { useMemo, useSyncExternalStore } from 'react';

export type Route =
  | { name: 'library' }
  | { name: 'book'; id: string }
  | { name: 'read'; id: string }
  | { name: 'settings' };

export function parseHash(hash: string): Route {
  const path = hash.replace(/^#/, '').split('?')[0].replace(/^\/+|\/+$/g, '');
  const parts = path.split('/').map((p) => { try { return decodeURIComponent(p); } catch { return p; } });
  if (parts[0] === 'book' && parts[1]) return { name: 'book', id: parts[1] };
  if (parts[0] === 'read' && parts[1]) return { name: 'read', id: parts[1] };
  if (parts[0] === 'settings') return { name: 'settings' };
  return { name: 'library' };
}

export const paths = {
  library: () => '#/library',
  book: (id: string) => `#/book/${encodeURIComponent(id)}`,
  read: (id: string) => `#/read/${encodeURIComponent(id)}`,
  settings: () => '#/settings',
};

export function navigate(hash: string) { if (location.hash !== hash) location.hash = hash; }

function subscribe(cb: () => void) { window.addEventListener('hashchange', cb); return () => window.removeEventListener('hashchange', cb); }
const snap = () => location.hash;

export function useRoute(): Route {
  const hash = useSyncExternalStore(subscribe, snap, () => '');
  return useMemo(() => parseHash(hash), [hash]);
}
