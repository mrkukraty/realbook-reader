import { useCallback, useEffect, useState } from 'react';
import { storage } from '../storage';
import { openBook } from '../formats/registry';
import type { BookDocument } from '../formats/types';
import type { BookRecord, Bookmark, Highlight, ProgressRecord } from '../storage/StorageAdapter';
import { useSettings } from '../settings/store';
import { themeVars } from '../features/reader/themes';
import { ReaderView } from '../features/reader/ReaderView';
import { ErrorScreen, LoadingScreen } from '../features/reader/ui/ErrorScreen';
import '../styles/themes.css';
import '../styles/reader.css';
import '../styles/reader-book.css';

type Loaded = { record: BookRecord; doc: BookDocument; progress?: ProgressRecord; bookmarks: Bookmark[]; highlights: Highlight[] };
type State =
  | { phase: 'loading' }
  | { phase: 'missing' }
  | { phase: 'error'; message: string }
  | { phase: 'ready'; data: Loaded };

const back = () => { location.hash = '#/'; };

export default function ReaderPage({ bookId }: { bookId: string }) {
  const [state, setState] = useState<State>({ phase: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const settings = useSettings((s) => s.settings);

  useEffect(() => {
    let cancelled = false;
    let doc: BookDocument | null = null;
    setState({ phase: 'loading' });
    (async () => {
      const record = await storage.getBook(bookId);
      if (cancelled) return;
      if (!record) { setState({ phase: 'missing' }); return; }
      let blob: Blob;
      try { blob = await storage.getBookFile(bookId); } catch { if (!cancelled) setState({ phase: 'missing' }); return; }
      if (cancelled) return;
      try {
        doc = await openBook(blob, record.fileName);
      } catch (e) {
        if (!cancelled) setState({ phase: 'error', message: (e as Error)?.message || 'This file could not be opened.' });
        return;
      }
      if (cancelled) { doc.dispose(); doc = null; return; }
      const [progress, bookmarks, highlights] = await Promise.all([
        storage.getProgress(bookId).catch(() => undefined),
        storage.listBookmarks(bookId).catch(() => [] as Bookmark[]),
        storage.listHighlights(bookId).catch(() => [] as Highlight[]),
      ]);
      if (cancelled) { doc.dispose(); doc = null; return; }
      setState({ phase: 'ready', data: { record, doc, progress, bookmarks, highlights } });
    })().catch((e) => { if (!cancelled) setState({ phase: 'error', message: (e as Error)?.message || 'Something went wrong while opening this book.' }); });
    return () => { cancelled = true; if (doc) { doc.dispose(); doc = null; } };
  }, [bookId, attempt]);

  const retry = useCallback(() => setAttempt((a) => a + 1), []);
  const wrap = (children: React.ReactNode) => <div className="rb-root" style={themeVars(settings) as React.CSSProperties}>{children}</div>;

  if (state.phase === 'loading') return wrap(<LoadingScreen label="Opening your book…" />);
  if (state.phase === 'missing') return wrap(<ErrorScreen title="Book not found" message="This book is no longer in your library, or its file is missing. It may have been removed." onBack={back} />);
  if (state.phase === 'error') return wrap(<ErrorScreen title="Couldn’t open this book" message={state.message} onBack={back} onRetry={retry} />);
  return (
    <ReaderView key={bookId + ':' + attempt} bookId={bookId} record={state.data.record} doc={state.data.doc} progress={state.data.progress}
      bookmarks={state.data.bookmarks} highlights={state.data.highlights} onBack={back} />
  );
}
