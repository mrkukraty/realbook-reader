import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { create } from 'zustand';

/* ---------------- Toasts ---------------- */
export interface Toast { id: number; kind: 'info' | 'success' | 'error'; text: string; action?: { label: string; run: () => void } }
interface ToastState { toasts: Toast[]; push: (t: Omit<Toast, 'id'>, ms?: number) => void; dismiss: (id: number) => void }
let nextId = 1;
export const useToasts = create<ToastState>((set, get) => ({
  toasts: [],
  push: (t, ms = 5000) => {
    const id = nextId++;
    set((s) => ({ toasts: [...s.toasts.slice(-3), { ...t, id }] }));
    if (ms > 0) setTimeout(() => get().dismiss(id), t.kind === 'error' ? Math.max(ms, 8000) : ms);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));
export const toast = {
  info: (text: string, action?: Toast['action']) => useToasts.getState().push({ kind: 'info', text, action }),
  success: (text: string, action?: Toast['action']) => useToasts.getState().push({ kind: 'success', text, action }),
  error: (text: string) => useToasts.getState().push({ kind: 'error', text }),
};

export function ToastHost() {
  const { toasts, dismiss } = useToasts();
  return (
    <div className="toast-host" role="region" aria-label="Notifications" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.kind}`} role={t.kind === 'error' ? 'alert' : 'status'}>
          <span>{t.text}</span>
          {t.action && <button className="btn btn-small" onClick={() => { t.action!.run(); dismiss(t.id); }}>{t.action.label}</button>}
          <button className="icon-btn" aria-label="Dismiss notification" onClick={() => dismiss(t.id)}>×</button>
        </div>
      ))}
    </div>
  );
}

/* ---------------- Confirm dialog ---------------- */
export interface ConfirmOptions { title: string; body: ReactNode; confirmLabel?: string; danger?: boolean }
type Ask = (o: ConfirmOptions) => Promise<boolean>;
const ConfirmCtx = createContext<Ask>(async () => false);
export const useConfirm = () => useContext(ConfirmCtx);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<(ConfirmOptions & { resolve: (v: boolean) => void }) | null>(null);
  const ask = useCallback<Ask>((o) => new Promise<boolean>((resolve) => setState({ ...o, resolve })), []);
  const close = (v: boolean) => { state?.resolve(v); setState(null); };
  return (
    <ConfirmCtx.Provider value={ask}>
      {children}
      {state && <Dialog title={state.title} onClose={() => close(false)}
        footer={<>
          <button className="btn" onClick={() => close(false)} autoFocus>Cancel</button>
          <button className={`btn ${state.danger ? 'btn-danger' : 'btn-primary'}`} onClick={() => close(true)}>{state.confirmLabel ?? 'Confirm'}</button>
        </>}>
        {state.body}
      </Dialog>}
    </ConfirmCtx.Provider>
  );
}

export function Dialog({ title, children, footer, onClose }: { title: string; children: ReactNode; footer?: ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const el = ref.current;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
      if (e.key === 'Tab' && el) {
        const f = [...el.querySelectorAll<HTMLElement>('button,input,select,textarea,a[href],[tabindex]:not([tabindex="-1"])')].filter((x) => !x.hasAttribute('disabled'));
        if (!f.length) return;
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', onKey, true);
    if (el && !el.contains(document.activeElement)) el.querySelector<HTMLElement>('input,button,select,textarea')?.focus();
    return () => { document.removeEventListener('keydown', onKey, true); prev?.focus?.(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <h2 className="modal-title">{title}</h2>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  );
}

/** Prompt for a single line of text (collection names). */
export function PromptDialog({ title, label, initial = '', confirmLabel = 'Save', onSubmit, onClose }: {
  title: string; label: string; initial?: string; confirmLabel?: string; onSubmit: (v: string) => void; onClose: () => void;
}) {
  const [v, setV] = useState(initial);
  const ok = v.trim().length > 0;
  return (
    <Dialog title={title} onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Cancel</button>
      <button className="btn btn-primary" disabled={!ok} onClick={() => ok && onSubmit(v.trim())}>{confirmLabel}</button>
    </>}>
      <form onSubmit={(e) => { e.preventDefault(); if (ok) onSubmit(v.trim()); }}>
        <label className="field"><span>{label}</span>
          <input value={v} onChange={(e) => setV(e.target.value)} maxLength={60} autoFocus />
        </label>
      </form>
    </Dialog>
  );
}
