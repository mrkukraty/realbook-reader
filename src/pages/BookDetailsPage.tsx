import { useEffect, useState } from 'react';
import { navigate, paths } from '../app/router';
import { toast, useConfirm } from '../app/feedback';
import { BookCover, FormatBadge, Icon, ProgressBar } from '../features/library/components';
import { confirmAndRemove } from '../features/library/confirmations';
import { libraryActions, useAnnotationCounts, useBook, useBookProgress, useLibrary } from '../features/library/hooks';
import { bookFraction } from '../features/library/logic';
import type { BookMetadata } from '../formats/types';
import { formatBytes, formatDate, formatPercent } from '../utils/format';

type Form = { title: string; author: string; language: string; publisher: string; published: string; description: string };
const toForm = (m: BookMetadata): Form => ({
  title: m.title ?? '', author: m.author ?? '', language: m.language ?? '', publisher: m.publisher ?? '',
  published: m.published ?? '', description: m.description ?? '',
});

export default function BookDetailsPage({ bookId }: { bookId: string }) {
  const { data: book, loading } = useBook(bookId);
  const progress = useBookProgress(bookId);
  const counts = useAnnotationCounts(bookId);
  const { collections } = useLibrary();
  const confirm = useConfirm();
  const [form, setForm] = useState<Form | null>(null);
  const [saving, setSaving] = useState(false);

  // initialise form once the book loads; keep user edits across live updates
  useEffect(() => { if (book && !form) setForm(toForm(book.metadata)); }, [book, form]);

  if (loading && !book) return <div className="page-loading" role="status">Loading...</div>;
  if (!book) {
    return (
      <div className="page-simple">
        <a className="back" href={paths.library()}><Icon name="back" /> Library</a>
        <h1>Book not found</h1>
        <p>This book is no longer in your library. It may have been removed.</p>
        <a className="btn btn-primary" href={paths.library()}>Back to library</a>
      </div>
    );
  }

  const f = form ?? toForm(book.metadata);
  const dirty = JSON.stringify(f) !== JSON.stringify(toForm(book.metadata));
  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm({ ...f, [k]: e.target.value });

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!f.title.trim()) { toast.error('A title is required.'); return; }
    setSaving(true);
    try {
      const patch: BookMetadata = {
        title: f.title.trim(), author: f.author.trim() || undefined, language: f.language.trim() || undefined,
        publisher: f.publisher.trim() || undefined, published: f.published.trim() || undefined, description: f.description.trim() || undefined,
      };
      await libraryActions.updateMetadata(book, patch);
      setForm(toForm(patch));
      toast.success('Details saved.');
    } catch (err) { toast.error(`Could not save: ${(err as Error).message}`); }
    finally { setSaving(false); }
  };

  const open = () => { void libraryActions.markOpened(book.id); navigate(paths.read(book.id)); };
  const frac = bookFraction(progress);

  return (
    <div className="details">
      <header className="details-top">
        <a className="back" href={paths.library()}><Icon name="back" /> Library</a>
        <a className="icon-btn" href={paths.settings()} aria-label="Settings"><Icon name="gear" /></a>
      </header>
      <main className="details-main" id="main">
        <section className="details-hero">
          <BookCover book={book} className="cover-large" />
          <div className="details-summary">
            <h1>{book.metadata.title}</h1>
            <p className="author">{book.metadata.author ?? 'Unknown author'}</p>
            <div className="cap-meta"><FormatBadge format={book.format} /><span className="muted">{formatBytes(book.size)}</span>
              {book.pageCount ? <span className="muted">{book.pageCount} pages</span> : null}</div>
            <div className="progress-line"><ProgressBar value={frac} /><span>{formatPercent(frac)} read</span></div>
            <div className="row">
              <button className="btn btn-primary btn-large" onClick={open}>{frac > 0 && frac < 0.98 ? 'Continue reading' : frac >= 0.98 ? 'Read again' : 'Start reading'}</button>
              <button className="btn" aria-pressed={book.favorite} onClick={() => void libraryActions.toggleFavorite(book)}>
                <Icon name={book.favorite ? 'star-fill' : 'star'} size={16} /> {book.favorite ? 'Favorite' : 'Add to favorites'}
              </button>
              <button className="btn btn-danger-outline" onClick={async () => { if (await confirmAndRemove(confirm, book)) navigate(paths.library()); }}><Icon name="trash" size={16} /> Remove</button>
            </div>
          </div>
        </section>

        <section className="panel" aria-labelledby="facts">
          <h2 id="facts">About this copy</h2>
          <dl className="facts">
            <div><dt>File</dt><dd>{book.fileName}</dd></div>
            <div><dt>Added</dt><dd>{formatDate(book.addedAt)}</dd></div>
            <div><dt>Last read</dt><dd>{formatDate(book.lastOpenedAt)}</dd></div>
            <div><dt>Bookmarks</dt><dd>{counts.bookmarks}</dd></div>
            <div><dt>Highlights</dt><dd>{counts.highlights}</dd></div>
            <div><dt>Notes</dt><dd>{counts.notes}</dd></div>
          </dl>
        </section>

        <section className="panel" aria-labelledby="collections-h">
          <h2 id="collections-h">Collections</h2>
          {collections.length === 0 ? <p className="muted">No collections yet. Create one from the library screen.</p> : (
            <div className="chips">
              {collections.map((c) => {
                const on = book.collectionIds.includes(c.id);
                return <button key={c.id} className={`chip${on ? ' on' : ''}`} aria-pressed={on} onClick={() => void libraryActions.toggleInCollection(book, c.id)}>{on ? '✓ ' : ''}{c.name}</button>;
              })}
            </div>
          )}
        </section>

        <form className="panel" onSubmit={save} aria-labelledby="edit-h">
          <h2 id="edit-h">Edit details</h2>
          <div className="form-grid">
            <label className="field"><span>Title</span><input value={f.title} onChange={set('title')} required /></label>
            <label className="field"><span>Author</span><input value={f.author} onChange={set('author')} /></label>
            <label className="field"><span>Language</span><input value={f.language} onChange={set('language')} placeholder="en" /></label>
            <label className="field"><span>Publisher</span><input value={f.publisher} onChange={set('publisher')} /></label>
            <label className="field"><span>Published</span><input value={f.published} onChange={set('published')} placeholder="2020 or 2020-05-01" /></label>
            <label className="field wide"><span>Description</span><textarea rows={5} value={f.description} onChange={set('description')} /></label>
          </div>
          <div className="row">
            <button className="btn btn-primary" type="submit" disabled={!dirty || saving}>{saving ? 'Saving...' : 'Save details'}</button>
            <button className="btn" type="button" disabled={!dirty} onClick={() => setForm(toForm(book.metadata))}>Discard changes</button>
          </div>
        </form>
      </main>
    </div>
  );
}
