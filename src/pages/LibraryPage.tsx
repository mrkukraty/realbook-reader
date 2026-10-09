import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { navigate, paths } from '../app/router';
import { PromptDialog, toast, useConfirm } from '../app/feedback';
import { ImportPanel } from '../features/import/ImportPanel';
import { ACCEPT_ATTR, SUPPORTED_FORMATS, UNSUPPORTED_FORMATS } from '../features/import/formats';
import { useImportStore } from '../features/import/importManager';
import { BookCover, BookMenu, FormatBadge, Icon, Menu, MenuItem, ProgressBar } from '../features/library/components';
import { confirmAndClear, confirmAndRemove } from '../features/library/confirmations';
import { EmptyShelf } from '../features/library/EmptyShelf';
import { libraryActions, useDebounced, useLibrary } from '../features/library/hooks';
import { bookFraction, continueReading, selectBooks, type FilterKey, type SortKey } from '../features/library/logic';
import type { BookRecord, Collection } from '../storage/StorageAdapter';
import { formatBytes, hashString } from '../utils/format';

const PREF_KEY = 'realbook.library.v1';
function loadPrefs(): { view: 'shelf' | 'list'; sort: SortKey } {
  try { const p = JSON.parse(localStorage.getItem(PREF_KEY) || '{}'); return { view: p.view === 'list' ? 'list' : 'shelf', sort: p.sort ?? 'added' }; } catch { return { view: 'shelf', sort: 'added' }; }
}

const SORTS: [SortKey, string][] = [['added', 'Date added'], ['opened', 'Last opened'], ['title', 'Title'], ['author', 'Author'], ['progress', 'Progress']];

export default function LibraryPage() {
  const { books, progress, collections, loading, error } = useLibrary();
  const confirm = useConfirm();
  const startImport = useImportStore((s) => s.start);
  const fileInput = useRef<HTMLInputElement>(null);
  const [{ view, sort }, setPrefs] = useState(loadPrefs);
  const [query, setQuery] = useState('');
  const dq = useDebounced(query, 120);
  const [filter, setFilter] = useState<FilterKey>('all');
  const [dragging, setDragging] = useState(false);
  const [prompt, setPrompt] = useState<null | { kind: 'new'; forBook?: BookRecord } | { kind: 'rename'; c: Collection }>(null);

  const setPref = (p: Partial<{ view: 'shelf' | 'list'; sort: SortKey }>) => {
    const next = { view, sort, ...p }; setPrefs(next);
    try { localStorage.setItem(PREF_KEY, JSON.stringify(next)); } catch { /* ignore */ }
  };

  // if the selected collection disappears, fall back to All
  useEffect(() => {
    if (filter.startsWith('collection:') && !collections.some((c) => `collection:${c.id}` === filter)) setFilter('all');
  }, [collections, filter]);

  const handleFiles = useCallback((list: FileList | File[] | null | undefined) => {
    const files = [...(list ?? [])];
    if (files.length) void startImport(files);
  }, [startImport]);

  // whole-window drag and drop
  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent) => !!e.dataTransfer && [...e.dataTransfer.types].includes('Files');
    const enter = (e: DragEvent) => { if (!hasFiles(e)) return; e.preventDefault(); depth++; setDragging(true); };
    const over = (e: DragEvent) => { if (!hasFiles(e)) return; e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'; };
    const leave = (e: DragEvent) => { if (!hasFiles(e)) return; depth = Math.max(0, depth - 1); if (!depth) setDragging(false); };
    const drop = (e: DragEvent) => { if (!hasFiles(e)) return; e.preventDefault(); depth = 0; setDragging(false); handleFiles(e.dataTransfer?.files); };
    window.addEventListener('dragenter', enter); window.addEventListener('dragover', over);
    window.addEventListener('dragleave', leave); window.addEventListener('drop', drop);
    return () => { window.removeEventListener('dragenter', enter); window.removeEventListener('dragover', over); window.removeEventListener('dragleave', leave); window.removeEventListener('drop', drop); };
  }, [handleFiles]);

  const visible = useMemo(() => selectBooks(books, { query: dq, filter, sort, progress }), [books, dq, filter, sort, progress]);
  const recent = useMemo(() => continueReading(books, progress), [books, progress]);
  const activeCollection = filter.startsWith('collection:') ? collections.find((c) => `collection:${c.id}` === filter) : undefined;

  const open = (b: BookRecord) => { void libraryActions.markOpened(b.id).catch(() => {}); navigate(paths.read(b.id)); };
  const actions = (b: BookRecord) => (
    <BookMenu book={b} collections={collections}
      onOpen={() => open(b)} onDetails={() => navigate(paths.book(b.id))}
      onFavorite={() => void libraryActions.toggleFavorite(b)}
      onToggleCollection={(c) => void libraryActions.toggleInCollection(b, c.id)}
      onNewCollection={() => setPrompt({ kind: 'new', forBook: b })}
      onRemove={() => void confirmAndRemove(confirm, b)} />
  );

  const filterChips: [FilterKey, string][] = [['all', 'All'], ['favorites', 'Favorites'], ['reading', 'In progress'], ['finished', 'Finished']];

  return (
    <div className="lib">
      <header className="lib-header">
        <h1 className="brand"><Icon name="book" size={26} /> RealBook <span>Reader</span></h1>
        <div className="lib-tools">
          <button className="btn btn-primary" onClick={() => fileInput.current?.click()}><Icon name="plus" size={16} /> Import books</button>
          <a className="icon-btn" href={paths.settings()} aria-label="Settings" title="Settings"><Icon name="gear" /></a>
          <Menu label="Library menu" trigger={<Icon name="more" />}>
            {(close) => (
              <>
                <MenuItem onClick={() => { close(); setPrompt({ kind: 'new' }); }}>New collection...</MenuItem>
                <MenuItem onClick={() => { close(); navigate(paths.settings()); }}>Settings</MenuItem>
                <div className="menu-sep" role="separator" />
                <MenuItem danger onClick={() => { close(); if (books.length) void confirmAndClear(confirm, books.length); else toast.info('The library is already empty.'); }}>Clear library...</MenuItem>
              </>
            )}
          </Menu>
        </div>
        <input ref={fileInput} type="file" multiple accept={ACCEPT_ATTR} hidden aria-hidden="true" tabIndex={-1} data-testid="file-input" id="import-input"
          onChange={(e) => { handleFiles(e.target.files); e.target.value = ''; }} />
      </header>

      <main className="lib-main" id="main">
        {error && <div className="notice notice-error" role="alert">Could not read the library: {error}</div>}

        {books.length === 0 && !loading ? (
          <div className="empty">
            <EmptyShelf />
            <h2>Your shelf is empty</h2>
            <p>Add a book to begin. Drag files anywhere onto this window, or choose them from your device. Books stay on this device only.</p>
            <button className="btn btn-primary btn-large" onClick={() => fileInput.current?.click()}><Icon name="plus" size={18} /> Import books</button>
            <details className="formats">
              <summary>Which formats work?</summary>
              <p><strong>Supported:</strong> {SUPPORTED_FORMATS.map((f) => f.label).join(', ')}.</p>
              <p><strong>Not supported:</strong> {UNSUPPORTED_FORMATS.map((f) => f.label).join(', ')}. {UNSUPPORTED_FORMATS.map((f) => f.reason).join(' ')}</p>
            </details>
          </div>
        ) : (
          <>
            {recent.length > 0 && filter === 'all' && !dq && (
              <section className="continue" aria-label="Continue reading">
                <h2 className="section-title">Continue reading</h2>
                <ul className="continue-row">
                  {recent.map((b) => (
                    <li key={b.id}>
                      <a href={paths.read(b.id)} onClick={() => void libraryActions.markOpened(b.id)} className="continue-card" aria-label={`Continue reading ${b.metadata.title}, ${Math.round(bookFraction(progress[b.id]) * 100)} percent`}>
                        <BookCover book={b} className="cover-sm" />
                        <span className="continue-info"><strong>{b.metadata.title}</strong><span className="muted">{b.metadata.author ?? 'Unknown author'}</span><ProgressBar value={bookFraction(progress[b.id])} /></span>
                      </a>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <div className="toolbar">
              <label className="search">
                <Icon name="search" size={16} />
                <input type="search" placeholder="Search title or author" aria-label="Search library by title or author" value={query} onChange={(e) => setQuery(e.target.value)} />
              </label>
              <label className="select-label">Sort
                <select value={sort} onChange={(e) => setPref({ sort: e.target.value as SortKey })} aria-label="Sort books by">
                  {SORTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
              </label>
              <div className="seg" role="group" aria-label="View">
                <button className={view === 'shelf' ? 'on' : ''} aria-pressed={view === 'shelf'} onClick={() => setPref({ view: 'shelf' })} aria-label="Bookshelf view" title="Bookshelf view"><Icon name="grid" /></button>
                <button className={view === 'list' ? 'on' : ''} aria-pressed={view === 'list'} onClick={() => setPref({ view: 'list' })} aria-label="List view" title="List view"><Icon name="list" /></button>
              </div>
            </div>

            <div className="chips" role="group" aria-label="Filter books">
              {filterChips.map(([k, l]) => <button key={k} className={`chip${filter === k ? ' on' : ''}`} aria-pressed={filter === k} onClick={() => setFilter(k)}>{l}</button>)}
              {collections.map((c) => {
                const k = `collection:${c.id}` as FilterKey;
                return <button key={c.id} className={`chip${filter === k ? ' on' : ''}`} aria-pressed={filter === k} onClick={() => setFilter(k)}>{c.name}</button>;
              })}
              <button className="chip chip-add" onClick={() => setPrompt({ kind: 'new' })}>+ Collection</button>
            </div>
            {activeCollection && (
              <div className="collection-bar">
                <span>Collection: <strong>{activeCollection.name}</strong></span>
                <button className="btn btn-small" onClick={() => setPrompt({ kind: 'rename', c: activeCollection })}>Rename</button>
                <button className="btn btn-small btn-danger-outline" onClick={async () => {
                  const ok = await confirm({ title: 'Delete collection?', danger: true, confirmLabel: 'Delete collection', body: <p>The collection "{activeCollection.name}" will be deleted. The books inside it stay in your library.</p> });
                  if (ok) { await libraryActions.deleteCollection(activeCollection.id); setFilter('all'); }
                }}>Delete</button>
              </div>
            )}

            <p className="result-count" aria-live="polite">{visible.length} of {books.length} book{books.length === 1 ? '' : 's'}</p>

            {visible.length === 0 ? (
              <div className="no-results"><p>No books match{dq ? <> "<strong>{dq}</strong>"</> : ' this filter'}.</p>
                <button className="btn" onClick={() => { setQuery(''); setFilter('all'); }}>Clear search and filters</button></div>
            ) : view === 'shelf' ? (
              <ul className="shelf" aria-label="Books">
                {visible.map((b) => {
                  const k = 0.9 + (hashString(b.id) % 11) / 100;
                  return (
                    <li key={b.id} className="shelf-item" style={{ ['--k' as string]: k }}>
                      <a className="book-link" href={paths.read(b.id)} onClick={() => void libraryActions.markOpened(b.id)}
                        aria-label={`${b.metadata.title}${b.metadata.author ? ` by ${b.metadata.author}` : ''}, ${b.format.toUpperCase()}, ${Math.round(bookFraction(progress[b.id]) * 100)} percent read. Open`}>
                        <BookCover book={b} className="cover-shelf" />
                      </a>
                      <div className="caption">
                        <span className="cap-title" title={b.metadata.title}>{b.metadata.title}</span>
                        <span className="cap-author muted">{b.metadata.author ?? 'Unknown author'}</span>
                        <ProgressBar value={bookFraction(progress[b.id])} />
                        <span className="cap-meta"><FormatBadge format={b.format} /><span className="muted">{formatBytes(b.size)}</span></span>
                      </div>
                      <div className="cap-actions">
                        <button className="icon-btn fav" aria-pressed={b.favorite} aria-label={b.favorite ? `Remove ${b.metadata.title} from favorites` : `Add ${b.metadata.title} to favorites`} onClick={() => void libraryActions.toggleFavorite(b)}><Icon name={b.favorite ? 'star-fill' : 'star'} size={16} /></button>
                        {actions(b)}
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <ul className="rows" aria-label="Books">
                {visible.map((b) => (
                  <li key={b.id} className="row-item">
                    <a className="row-link" href={paths.read(b.id)} onClick={() => void libraryActions.markOpened(b.id)} aria-label={`Open ${b.metadata.title}`}>
                      <BookCover book={b} className="cover-sm" />
                      <span className="row-info">
                        <strong>{b.metadata.title}</strong>
                        <span className="muted">{b.metadata.author ?? 'Unknown author'}</span>
                        <span className="cap-meta"><FormatBadge format={b.format} /><span className="muted">{formatBytes(b.size)}</span><span className="muted">{Math.round(bookFraction(progress[b.id]) * 100)}%</span></span>
                        <ProgressBar value={bookFraction(progress[b.id])} />
                      </span>
                    </a>
                    <div className="cap-actions">
                      <button className="icon-btn fav" aria-pressed={b.favorite} aria-label={b.favorite ? `Remove ${b.metadata.title} from favorites` : `Add ${b.metadata.title} to favorites`} onClick={() => void libraryActions.toggleFavorite(b)}><Icon name={b.favorite ? 'star-fill' : 'star'} size={16} /></button>
                      {actions(b)}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </main>

      <ImportPanel />

      {dragging && (
        <div className="drop-overlay" aria-hidden="true"><div><Icon name="plus" size={40} /><p>Drop books to add them to your shelf</p></div></div>
      )}

      {prompt && (
        <PromptDialog
          title={prompt.kind === 'new' ? 'New collection' : 'Rename collection'} label="Collection name"
          initial={prompt.kind === 'rename' ? prompt.c.name : ''} confirmLabel={prompt.kind === 'new' ? 'Create' : 'Rename'}
          onClose={() => setPrompt(null)}
          onSubmit={async (name) => {
            const p = prompt; setPrompt(null);
            try {
              if (p.kind === 'rename') await libraryActions.renameCollection(p.c, name);
              else {
                const c = await libraryActions.createCollection(name);
                if (p.forBook) await libraryActions.toggleInCollection(p.forBook, c.id);
              }
            } catch (e) { toast.error((e as Error).message); }
          }} />
      )}
    </div>
  );
}
