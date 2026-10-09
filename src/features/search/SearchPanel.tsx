import { useEffect, useRef, useState } from 'react';
import type { ReaderContent, SearchHit } from '../reader/content';
import { Panel } from '../reader/ui/parts';

export const NO_TEXT_MESSAGE = 'This book has no searchable text layer (scanned/images). OCR is not available.';

export function SearchPanel({ content, onClose, onJump }: { content: ReaderContent; onClose: () => void; onJump: (h: SearchHit) => void }) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [progress, setProgress] = useState(0);
  const [running, setRunning] = useState(false);
  const [searched, setSearched] = useState('');
  const [active, setActive] = useState<string | null>(null);
  const ctrl = useRef<AbortController | null>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); return () => ctrl.current?.abort(); }, []);

  const run = async () => {
    const query = q.trim();
    if (!query) return;
    ctrl.current?.abort();
    const c = new AbortController();
    ctrl.current = c;
    setHits([]); setProgress(0); setRunning(true); setSearched(query);
    try {
      await content.search(query, {
        signal: c.signal, onProgress: (f) => !c.signal.aborted && setProgress(f),
        onResults: (b) => !c.signal.aborted && setHits((h) => h.length > 500 ? h : [...h, ...b]),
      });
    } finally { if (ctrl.current === c) setRunning(false); }
  };
  const cancel = () => { ctrl.current?.abort(); setRunning(false); };

  return (
    <Panel title="Search" onClose={onClose}>
      {!content.hasText ? <p className="rb-empty" role="note">{NO_TEXT_MESSAGE}</p> : (
        <>
          <form className="rb-search-form" onSubmit={(e) => { e.preventDefault(); void run(); }} role="search">
            <input ref={input} type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search in this book" aria-label="Search text" />
            {running ? <button type="button" onClick={cancel}>Cancel</button> : <button type="submit" disabled={!q.trim()}>Search</button>}
          </form>
          {running && <div className="rb-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}><i style={{ width: `${progress * 100}%` }} /></div>}
          <p className="rb-muted" aria-live="polite">
            {searched ? `${hits.length}${hits.length >= 500 ? '+' : ''} result${hits.length === 1 ? '' : 's'} for “${searched}”${running ? ` — searching ${Math.round(progress * 100)}%` : ''}` : 'Type a word or phrase and press Enter.'}
          </p>
          <ul className="rb-results">
            {hits.map((h) => (
              <li key={h.id}>
                <button type="button" className={`rb-result${active === h.id ? ' is-current' : ''}`} onClick={() => { setActive(h.id); onJump(h); }}>
                  <span className="rb-result-label">{h.label}</span>
                  <span className="rb-result-text">{h.snippet.before}<mark>{h.snippet.match}</mark>{h.snippet.after}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </Panel>
  );
}
