import { useEffect, useRef, useState } from 'react';
import type { Highlight } from '../../storage/StorageAdapter';
import { Icon } from '../reader/ui/parts';

export const HL_COLORS: Highlight['color'][] = ['yellow', 'green', 'blue', 'pink'];

export function exportHighlights(items: Highlight[], title: string, chapterOf: (h: Highlight) => string): string {
  const lines = [`Highlights and notes — ${title}`, ''];
  for (const h of [...items].sort((a, b) => a.section - b.section || a.start - b.start)) {
    const ch = chapterOf(h);
    lines.push(`${ch ? `[${ch}] ` : ''}(${h.color}) “${h.text.trim()}”`);
    if (h.note) lines.push(`   Note: ${h.note}`);
    lines.push('');
  }
  return lines.join('\n');
}

export function HighlightsList({ items, reflow, title, chapterOf, onGo, onRemove, onToast }: {
  items: Highlight[]; reflow: boolean; title: string; chapterOf: (h: Highlight) => string;
  onGo: (h: Highlight) => void; onRemove: (h: Highlight) => void; onToast: (m: string) => void;
}) {
  if (!reflow) return <p className="rb-empty">Highlights and inline notes are available for reflowable books (EPUB, text, etc.). For PDFs and comics, use bookmarks — rename a bookmark to keep a page note.</p>;
  const sorted = [...items].sort((a, b) => a.section - b.section || a.start - b.start);
  return (
    <>
      <div className="rb-row">
        <button type="button" disabled={!items.length} onClick={async () => {
          try { await navigator.clipboard.writeText(exportHighlights(items, title, chapterOf)); onToast('Highlights copied to clipboard'); } catch { onToast('Could not access the clipboard'); }
        }}><Icon name="copy" /> Export to clipboard</button>
      </div>
      {!sorted.length ? <p className="rb-empty">Select text on a page to highlight it or add a note.</p> : (
        <ul className="rb-list">
          {sorted.map((h) => (
            <li key={h.id} className="rb-list-item">
              <button type="button" className="rb-list-main" onClick={() => onGo(h)}>
                <span className="rb-result-label"><i className={`rb-dot rb-hl-${h.color}`} /> {chapterOf(h)}</span>
                <span className="rb-quote">{h.text.length > 160 ? h.text.slice(0, 160) + '…' : h.text}</span>
                {h.note && <span className="rb-note">{h.note}</span>}
              </button>
              <button type="button" className="rb-ibtn" aria-label="Delete highlight" title="Delete" onClick={() => onRemove(h)}><Icon name="trash" /></button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/** Floating toolbar shown over a text selection. */
export function SelectionToolbar({ rect, onColor, onNote, onCopy }: { rect: DOMRect; onColor: (c: Highlight['color']) => void; onNote: () => void; onCopy: () => void }) {
  const top = Math.max(8, rect.top - 46);
  const left = Math.min(window.innerWidth - 8, Math.max(8, rect.left + rect.width / 2));
  return (
    <div className="rb-seltool" role="toolbar" aria-label="Selection actions" style={{ top, left }} onPointerDown={(e) => e.preventDefault()} onMouseDown={(e) => e.preventDefault()}>
      {HL_COLORS.map((c) => <button key={c} type="button" className={`rb-swatch rb-hl-${c}`} aria-label={`Highlight ${c}`} title={`Highlight ${c}`} onClick={() => onColor(c)} />)}
      <button type="button" className="rb-ibtn" aria-label="Add note" title="Add note" onClick={onNote}><Icon name="notes" /></button>
      <button type="button" className="rb-ibtn" aria-label="Copy" title="Copy" onClick={onCopy}><Icon name="copy" /></button>
    </div>
  );
}

/** Edit popover for an existing highlight (note, colour, delete). */
export function HighlightPopover({ hl, rect, autoFocusNote, onChange, onDelete, onClose }: {
  hl: Highlight; rect: DOMRect; autoFocusNote?: boolean; onChange: (h: Highlight) => void; onDelete: () => void; onClose: () => void;
}) {
  const [note, setNote] = useState(hl.note ?? '');
  const ta = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { if (autoFocusNote) ta.current?.focus(); }, [autoFocusNote]);
  const top = Math.min(window.innerHeight - 220, Math.max(8, rect.bottom + 8));
  const left = Math.min(window.innerWidth - 150, Math.max(150, rect.left + rect.width / 2));
  return (
    <div className="rb-hlpop" role="dialog" aria-label="Edit highlight" style={{ top, left }} onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }}>
      <div className="rb-row">
        {HL_COLORS.map((c) => <button key={c} type="button" className={`rb-swatch rb-hl-${c}${hl.color === c ? ' is-active' : ''}`} aria-label={`Colour ${c}`} onClick={() => onChange({ ...hl, color: c, note })} />)}
        <button type="button" className="rb-ibtn" aria-label="Delete highlight" title="Delete highlight" onClick={onDelete}><Icon name="trash" /></button>
      </div>
      <textarea ref={ta} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a note…" aria-label="Note" rows={3} maxLength={2000} />
      <div className="rb-row"><button type="button" onClick={() => { onChange({ ...hl, note: note.trim() || undefined }); onClose(); }}>Save</button><button type="button" onClick={onClose}>Close</button></div>
    </div>
  );
}
