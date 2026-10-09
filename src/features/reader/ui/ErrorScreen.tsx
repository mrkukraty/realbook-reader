export function ErrorScreen({ title, message, onBack, onRetry }: { title: string; message: string; onBack: () => void; onRetry?: () => void }) {
  return (
    <div className="rb-reader rb-fullscreen-msg" role="alert">
      <div className="rb-msg-card">
        <h1>{title}</h1>
        <p>{message}</p>
        <div className="rb-row">
          <button type="button" onClick={onBack} autoFocus>Back to library</button>
          {onRetry && <button type="button" onClick={onRetry}>Try again</button>}
        </div>
      </div>
    </div>
  );
}

export function LoadingScreen({ label, fraction }: { label: string; fraction?: number }) {
  return (
    <div className="rb-reader rb-fullscreen-msg" role="status" aria-live="polite">
      <div className="rb-msg-card">
        <div className="spinner" aria-hidden="true" />
        <p>{label}</p>
        {fraction !== undefined && <div className="rb-progress"><i style={{ width: `${Math.round(fraction * 100)}%` }} /></div>}
      </div>
    </div>
  );
}
