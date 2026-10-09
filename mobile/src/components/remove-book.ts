import { Alert } from 'react-native';
import type { BookRecord } from '../storage/types';
import { deletionSummary } from '../storage/library-logic';
import { getRepo } from '../state/repo';
import { useLibrary } from '../state/library-store';

/** Asks for confirmation (stating exactly what is deleted) and removes the book. Resolves true when removed. */
export async function confirmRemoveBook(book: BookRecord): Promise<boolean> {
  const repo = await getRepo();
  const [bm, hl, pr] = await Promise.all([repo.listBookmarks(book.id), repo.listHighlights(book.id), repo.getProgress(book.id)]);
  const msg = deletionSummary(book, { bookmarks: bm.length, highlights: hl.length, hasProgress: !!pr });
  return new Promise((resolve) => {
    Alert.alert(`Remove "${book.metadata.title}"?`, msg, [
      { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
      {
        text: 'Remove', style: 'destructive', onPress: () => {
          useLibrary.getState().removeBook(book.id).then(() => resolve(true)).catch((e) => {
            Alert.alert('Could not remove the book', e instanceof Error ? e.message : String(e));
            resolve(false);
          });
        },
      },
    ], { cancelable: true, onDismiss: () => resolve(false) });
  });
}
