import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { BookRecord, Collection } from '../../storage/StorageAdapter';
import { hashString } from '../../utils/format';
import { useCoverUrl } from './hooks';

export function Icon({ name, size = 18 }: { name: 'plus' | 'star' | 'star-fill' | 'more' | 'search' | 'grid' | 'list' | 'gear' | 'book' | 'back' | 'trash' | 'check'; size?: number }) {
  const p: Record<string, ReactNode> = {
    plus: <path d="M12 5v14M5 12h14" />,
    star: <path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1.1 5.9L12 16.9 6.7 19.7l1.1-5.9L3.5 9.7l5.9-.8z" />,
    'star-fill': <path fill="currentColor" d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1.1 5.9L12 16.9 6.7 19.7l1.1-5.9L3.5 9.7l5.9-.8z" />,
    more: <><circle cx="5" cy="12" r="1.4" fill="currentColor" /><circle cx="12" cy="12" r="1.4" fill="currentColor" /><circle cx="19" cy="12" r="1.4" fill="currentColor" /></>,
    search: <><circle cx="11" cy="11" r="6" /><path d="M20 20l-4.2-4.2" /></>,
    grid: <><rect x="4" y="4" width="6.5" height="6.5" rx="1" /><rect x="13.5" y="4" width="6.5" height="6.5" rx="1" /><rect x="4" y="13.5" width="6.5" height="6.5" rx="1" /><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1" /></>,
    list: <path d="M4 7h16M4 12h16M4 17h16" />,
    gear: <><circle cx="12" cy="12" r="3" /><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M5.6 18.4l1.8-1.8M16.6 7.4l1.8-1.8" /></>,
    book: <path d="M5 4.5h10a3 3 0 013 3V20H8a3 3 0 01-3-3zM5 17a3 3 0 013-3h10" />,
    back: <path d="M15 5l-7 7 7 7" />,
    trash: <path d="M5 7h14M10 7V4.5h4V7M7 7l1 13h8l1-13" />,
    check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{p[name]}</svg>;
}

export function BookCover({ book, className = '' }: { book: BookRecord; className?: string }) {
  const url = useCoverUrl(book.cover);
  const hue = hashString(book.metadata.title) % 360;
  return (
    <div className={`cover ${className}`} style={{ ['--h' as string]: hue }}>
      {url
        ? <img src={url} alt="" draggable={false} loading="lazy" />
        : <div className="cover-fallback" aria-hidden="true"><span>{book.metadata.title}</span></div>}
      <span className="cover-spine" aria-hidden="true" />
    </div>
  );
}

export function FormatBadge({ format }: { format: string }) { return <span className="badge">{format.toUpperCase()}</span>; }

export function ProgressBar({ value, label }: { value: number; label?: string }) {
  const pct = Math.round(Math.min(1, Math.max(0, value)) * 100);
  return (
    <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={label ?? 'Reading progress'}>
      <span style={{ width: `${pct}%` }} />
    </div>
  );
}

/** Small popover menu; items render as buttons. */
export function Menu({ label, children, align = 'right', trigger }: { label: string; children: (close: () => void) => ReactNode; align?: 'left' | 'right'; trigger?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setOpen(false); ref.current?.querySelector<HTMLElement>('.menu-trigger')?.focus(); }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        const items = [...(ref.current?.querySelectorAll<HTMLElement>('[role=menuitem],[role=menuitemcheckbox]') ?? [])];
        if (!items.length) return;
        e.preventDefault();
        const i = items.indexOf(document.activeElement as HTMLElement);
        items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length].focus();
      }
    };
    document.addEventListener('mousedown', onDoc); document.addEventListener('keydown', onKey);
    ref.current?.querySelector<HTMLElement>('[role=menuitem],[role=menuitemcheckbox]')?.focus();
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [open]);
  return (
    <div className="menu" ref={ref}>
      <button className="icon-btn menu-trigger" aria-label={label} aria-haspopup="menu" aria-expanded={open} onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}>
        {trigger ?? <Icon name="more" />}
      </button>
      {open && <div className={`menu-pop ${align}`} role="menu" aria-label={label}>{children(() => setOpen(false))}</div>}
    </div>
  );
}

export function MenuItem({ children, onClick, danger, checked }: { children: ReactNode; onClick: () => void; danger?: boolean; checked?: boolean }) {
  return (
    <button role={checked === undefined ? 'menuitem' : 'menuitemcheckbox'} aria-checked={checked} className={`menu-item${danger ? ' danger' : ''}`} onClick={(e) => { e.stopPropagation(); onClick(); }}>
      <span className="menu-check">{checked ? <Icon name="check" size={14} /> : null}</span>{children}
    </button>
  );
}

export function BookMenu({ book, collections, onOpen, onDetails, onFavorite, onToggleCollection, onRemove, onNewCollection }: {
  book: BookRecord; collections: Collection[];
  onOpen: () => void; onDetails: () => void; onFavorite: () => void;
  onToggleCollection: (c: Collection) => void; onRemove: () => void; onNewCollection: () => void;
}) {
  return (
    <Menu label={`Actions for ${book.metadata.title}`}>
      {(close) => (
        <>
          <MenuItem onClick={() => { close(); onOpen(); }}>Open</MenuItem>
          <MenuItem onClick={() => { close(); onDetails(); }}>Details and edit</MenuItem>
          <MenuItem onClick={() => { close(); onFavorite(); }}>{book.favorite ? 'Remove from favorites' : 'Add to favorites'}</MenuItem>
          <div className="menu-sep" role="separator" />
          <div className="menu-heading" aria-hidden="true">Collections</div>
          {collections.map((c) => (
            <MenuItem key={c.id} checked={book.collectionIds.includes(c.id)} onClick={() => onToggleCollection(c)}>{c.name}</MenuItem>
          ))}
          <MenuItem onClick={() => { close(); onNewCollection(); }}>New collection...</MenuItem>
          <div className="menu-sep" role="separator" />
          <MenuItem danger onClick={() => { close(); onRemove(); }}>Remove from library...</MenuItem>
        </>
      )}
    </Menu>
  );
}
