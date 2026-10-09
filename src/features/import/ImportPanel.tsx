import { formatBytes } from '../../utils/format';
import { navigate, paths } from '../../app/router';
import { isFinished, useImportStore, type ImportItem } from './importManager';

const LABEL: Record<ImportItem['status'], string> = {
  queued: 'Waiting', hashing: 'Checking file', parsing: 'Reading book', saving: 'Saving',
  done: 'Added', duplicate: 'Already in library', error: 'Failed', unsupported: 'Not supported',
};

export function ImportPanel() {
  const { items, panelOpen, running, dismiss, dismissFinished, setPanelOpen } = useImportStore();
  if (!items.length) return null;
  const active = items.filter((i) => !isFinished(i.status)).length;
  const hasFinished = items.some((i) => isFinished(i.status));
  return (
    <section className="import-panel" aria-label="Import progress">
      <header>
        <strong>{running ? `Importing... ${active} left` : 'Import finished'}</strong>
        <span className="spacer" />
        {hasFinished && <button className="btn btn-small" onClick={dismissFinished}>Clear finished</button>}
        <button className="icon-btn" aria-label={panelOpen ? 'Collapse import panel' : 'Expand import panel'} aria-expanded={panelOpen} onClick={() => setPanelOpen(!panelOpen)}>{panelOpen ? '−' : '+'}</button>
      </header>
      {panelOpen && (
        <ul>
          {items.map((i) => (
            <li key={i.id} className={`imp imp-${i.status}`}>
              <div className="imp-main">
                <span className="imp-name" title={i.name}>{i.name}</span>
                <span className="imp-status" aria-live="polite">{LABEL[i.status]}{i.progress != null && i.status === 'parsing' ? ` ${Math.round(i.progress * 100)}%` : ''} <span className="muted">({formatBytes(i.size)})</span></span>
                {i.message && <span className="imp-msg">{i.message}</span>}
                {!isFinished(i.status) && i.status !== 'queued' && (
                  <div className="progress"><span className={i.progress == null ? 'indeterminate' : ''} style={i.progress != null ? { width: `${Math.round(i.progress * 100)}%` } : undefined} /></div>
                )}
              </div>
              <div className="imp-actions">
                {i.bookId && (i.status === 'duplicate' || i.status === 'done') && <button className="btn btn-small" onClick={() => navigate(paths.read(i.bookId!))}>Open</button>}
                {isFinished(i.status) && <button className="icon-btn" aria-label={`Dismiss ${i.name}`} onClick={() => dismiss(i.id)}>×</button>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
