import type { BookRecord } from '../../storage/StorageAdapter';
import { formatBytes } from '../../utils/format';
import { libraryActions } from './hooks';
import { toast, type ConfirmOptions } from '../../app/feedback';

type Ask = (o: ConfirmOptions) => Promise<boolean>;

export async function confirmAndRemove(ask: Ask, book: BookRecord): Promise<boolean> {
  const ok = await ask({
    title: 'Remove this book?',
    danger: true, confirmLabel: 'Remove book',
    body: (
      <>
        <p><strong>{book.metadata.title}</strong> will be removed from this device. This permanently deletes:</p>
        <ul>
          <li>the stored copy of the book file ({formatBytes(book.size)})</li>
          <li>your reading progress</li>
          <li>all bookmarks</li>
          <li>all highlights and notes</li>
        </ul>
        <p>Your original file elsewhere on your computer is not touched. This cannot be undone.</p>
      </>
    ),
  });
  if (!ok) return false;
  try { await libraryActions.remove(book.id); toast.success(`Removed "${book.metadata.title}".`); return true; }
  catch (e) { toast.error(`Could not remove the book: ${(e as Error).message}`); return false; }
}

export async function confirmAndClear(ask: Ask, count: number): Promise<boolean> {
  const ok = await ask({
    title: 'Clear the whole library?',
    danger: true, confirmLabel: 'Delete everything',
    body: (
      <>
        <p>This permanently deletes <strong>all {count} book{count === 1 ? '' : 's'}</strong> stored in RealBook Reader, together with every reading position, bookmark, highlight, note and collection.</p>
        <p>Original files on your computer are not touched. This cannot be undone.</p>
      </>
    ),
  });
  if (!ok) return false;
  try { await libraryActions.clear(); toast.success('Library cleared.'); return true; }
  catch (e) { toast.error(`Could not clear the library: ${(e as Error).message}`); return false; }
}
