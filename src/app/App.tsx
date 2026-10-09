import { lazy, Suspense } from 'react';
import { ConfirmProvider, ToastHost } from './feedback';
import { ErrorBoundary } from './ErrorBoundary';
import { useRoute } from './router';
import LibraryPage from '../pages/LibraryPage';
import BookDetailsPage from '../pages/BookDetailsPage';
import SettingsPage from '../pages/SettingsPage';

const ReaderPage = lazy(() => import('../pages/ReaderPage'));

function Loading({ label }: { label: string }) {
  return <div className="page-loading" role="status" aria-live="polite"><div className="spinner" aria-hidden="true" />{label}</div>;
}

export default function App() {
  const route = useRoute();
  const key = route.name + ('id' in route ? route.id : '');
  return (
    <ConfirmProvider>
      <ErrorBoundary resetKey={key}>
        {route.name === 'library' && <LibraryPage />}
        {route.name === 'book' && <BookDetailsPage bookId={route.id} />}
        {route.name === 'settings' && <SettingsPage />}
        {route.name === 'read' && (
          <Suspense fallback={<Loading label="Opening your book..." />}>
            <ReaderPage bookId={route.id} key={route.id} />
          </Suspense>
        )}
      </ErrorBoundary>
      <ToastHost />
    </ConfirmProvider>
  );
}
