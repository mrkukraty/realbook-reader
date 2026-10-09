import type { ReactNode } from 'react';

const PATHS: Record<string, string> = {
  back: 'M15 5l-7 7 7 7',
  toc: 'M4 6h16M4 12h16M4 18h10',
  search: 'M11 4a7 7 0 100 14 7 7 0 000-14zM21 21l-5-5',
  bookmark: 'M7 4h10v16l-5-4-5 4z',
  notes: 'M5 4h14v12H9l-4 4zM9 8h6M9 11h4',
  text: 'M4 19l6-14 6 14M6.5 14h7M17 9h4M19 7v4',
  expand: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  layout: 'M3 5h8v14H3zM13 5h8v14h-8z',
  layout1: 'M7 4h10v16H7z',
  prev: 'M14 6l-6 6 6 6',
  next: 'M10 6l6 6-6 6',
  close: 'M6 6l12 12M18 6L6 18',
  help: 'M9.5 9a2.5 2.5 0 115 0c0 2-2.5 2-2.5 4M12 17h.01',
  trash: 'M5 7h14M9 7V4h6v3M7 7l1 13h8l1-13',
  copy: 'M8 8h11v12H8zM5 16V4h11',
  check: 'M5 13l4 4 10-10',
};

export function Icon({ name, filled }: { name: keyof typeof PATHS | string; filled?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d={PATHS[name] ?? ''} />
    </svg>
  );
}

export function IconButton(p: { icon: string; label: string; onClick: () => void; active?: boolean; filled?: boolean; disabled?: boolean }) {
  return (
    <button type="button" className={`rb-ibtn${p.active ? ' is-active' : ''}`} aria-label={p.label} title={p.label} aria-pressed={p.active} disabled={p.disabled} onClick={p.onClick}>
      <Icon name={p.icon} filled={p.filled} />
    </button>
  );
}

export function Panel({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  return (
    <aside className={`rb-panel${wide ? ' rb-panel-wide' : ''}`} role="dialog" aria-label={title}>
      <header className="rb-panel-head">
        <h2>{title}</h2>
        <IconButton icon="close" label={`Close ${title}`} onClick={onClose} />
      </header>
      <div className="rb-panel-body">{children}</div>
    </aside>
  );
}
