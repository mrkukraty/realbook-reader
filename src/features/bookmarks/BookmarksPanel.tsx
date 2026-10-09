import { useState } from 'react';
import type { Bookmark } from '../../storage/StorageAdapter';
import type { ReaderContent } from '../reader/content';
import { Icon } from '../reader/ui/parts';

export function BookmarksList({ items, content, onGo, onRename, onRemove }: {
  items: Bookmark[]; content: ReaderContent;
  onGo: (b: Bookmark) => void; onRename: (b: Bookmark, label: string) => void; onRemove: (b: Bookmark) => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const sorted = [...items].sort((a, b) => (content.indexOfAnchor(a) ?? 0) - (content.indexOfAnchor(b) ?? 0));
  if (!sorted.length) return <p className="rb-empty">No bookmarks yet. Use the bookmark button in the top bar to mark this page{content.kind === 'fixed' ? ' (rename it to keep a page note)' : ''}.</p>;
  return (
    <ul className="rb-list">
      {sorted.map((b) => {
        const idx = content.indexOfAnchor(b);
        return (
          <li key={b.id} className="rb-list-item">
            {editing === b.id ? (
              <form onSubmit={(e) => { e.preventDefault(); onRename(b, draft.trim() || b.label); setEditing(null); }}>
                <input autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} aria-label="Bookmark label" maxLength={200} onBlur={() => setEditing(null)} />
              </form>
            ) : (
              <button type="button" className="rb-list-main" onClick={() => onGo(b)}>
                <span className="rb-result-label">{idx !== undefined ? `Page ${idx + 1}` : 'Bookmark'}</span>
                <span>{b.label}</span>
              </button>
            )}
            <button type="button" className="rb-ibtn" aria-label={`Rename bookmark ${b.label}`} title="Rename / add note" onClick={() => { setEditing(b.id); setDraft(b.label); }}><Icon name="notes" /></button>
            <button type="button" className="rb-ibtn" aria-label={`Delete bookmark ${b.label}`} title="Delete" onClick={() => onRemove(b)}><Icon name="trash" /></button>
          </li>
        );
      })}
    </ul>
  );
}
