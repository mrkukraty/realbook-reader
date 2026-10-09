import { useState, type ReactNode } from 'react';
import { paths } from '../app/router';
import { toast, useConfirm } from '../app/feedback';
import { SUPPORTED_FORMATS, UNSUPPORTED_FORMATS } from '../features/import/formats';
import { Icon } from '../features/library/components';
import { confirmAndClear } from '../features/library/confirmations';
import { useLibrary, useStorageUsage } from '../features/library/hooks';
import { useSettings } from '../settings/store';
import type { FontFamilyId, PerfMode, Settings, ThemeId } from '../settings/types';
import { requestPersistence, storage } from '../storage';
import { formatBytes } from '../utils/format';

const THEMES: { id: ThemeId; label: string; page: string; text: string }[] = [
  { id: 'ivory', label: 'Ivory', page: '#f8f3e6', text: '#2a241c' },
  { id: 'parchment', label: 'Parchment', page: '#ecdcb5', text: '#3b2c17' },
  { id: 'eink', label: 'E-ink', page: '#d9d9d4', text: '#1a1a1a' },
  { id: 'sepia', label: 'Sepia', page: '#f1e4c8', text: '#5b4636' },
  { id: 'night', label: 'Night', page: '#1c1f26', text: '#c9ccd3' },
  { id: 'black', label: 'Black', page: '#000000', text: '#b8b8b8' },
];

const PERF: { id: PerfMode; label: string; desc: string }[] = [
  { id: 'balanced', label: 'Balanced', desc: 'Smooth page turns with soft shadows. Best for most devices.' },
  { id: 'lightweight', label: 'Lightweight', desc: 'Simple, fast page turns with minimal effects. Best for older or low-power devices.' },
  { id: 'high', label: 'High quality', desc: 'Richer curl, lighting and paper texture. Needs a capable device.' },
];

const FONTS: [FontFamilyId, string][] = [['serif', 'Book serif'], ['georgia', 'Georgia'], ['garamond', 'Garamond'], ['sans', 'Sans serif'], ['mono', 'Monospace'], ['dyslexic', 'Dyslexia-friendly']];

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return <section className="panel" aria-labelledby={id}><h2 id={id}>{title}</h2>{children}</section>;
}

function Range({ label, value, min, max, step, onChange, fmt }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; fmt?: (v: number) => string }) {
  return (
    <label className="field range">
      <span>{label}<output>{fmt ? fmt(value) : value}</output></span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}

function ColorField({ label, value, fallback, onChange }: { label: string; value?: string; fallback: string; onChange: (v: string | undefined) => void }) {
  return (
    <div className="field color">
      <span>{label}</span>
      <div className="row">
        <input type="color" aria-label={label} value={value ?? fallback} onChange={(e) => onChange(e.target.value)} />
        <button className="btn btn-small" disabled={!value} onClick={() => onChange(undefined)}>Reset</button>
      </div>
    </div>
  );
}

export default function SettingsPage() {
  const { settings: s, set, reset } = useSettings();
  const { books } = useLibrary();
  const confirm = useConfirm();
  const { usage, refresh } = useStorageUsage();
  const [busy, setBusy] = useState(false);
  const up = <K extends keyof Settings>(k: K) => (v: Settings[K]) => set({ [k]: v } as Partial<Settings>);
  const theme = THEMES.find((t) => t.id === s.theme) ?? THEMES[0];
  const pct = usage.used != null && usage.quota ? Math.min(100, (usage.used / usage.quota) * 100) : undefined;
  const desktop = storage.kind === 'desktop';

  return (
    <div className="settings">
      <header className="details-top"><a className="back" href={paths.library()}><Icon name="back" /> Library</a><h1 className="page-title">Settings</h1></header>
      <main className="details-main" id="main">
        <Section id="s-theme" title="Theme">
          <div className="swatches" role="radiogroup" aria-label="Reading theme">
            {THEMES.map((t) => (
              <button key={t.id} role="radio" aria-checked={s.theme === t.id} className={`swatch${s.theme === t.id ? ' on' : ''}`} onClick={() => set({ theme: t.id })}>
                <span className="swatch-chip" style={{ background: t.page, color: t.text }}>Aa</span>{t.label}
              </button>
            ))}
          </div>
        </Section>

        <Section id="s-perf" title="Performance mode">
          <div className="radio-cards" role="radiogroup" aria-label="Performance mode">
            {PERF.map((p) => (
              <button key={p.id} role="radio" aria-checked={s.perfMode === p.id} className={`radio-card${s.perfMode === p.id ? ' on' : ''}`} onClick={() => set({ perfMode: p.id })}>
                <strong>{p.label}</strong><span>{p.desc}</span>
              </button>
            ))}
          </div>
        </Section>

        <Section id="s-layout" title="Layout and text">
          <div className="form-grid">
            <label className="field"><span>Page layout</span>
              <select value={s.layout} onChange={(e) => set({ layout: e.target.value as Settings['layout'] })}>
                <option value="auto">Automatic (two pages on wide screens)</option><option value="single">Single page</option><option value="double">Two-page spread</option>
              </select></label>
            <label className="field"><span>Font</span>
              <select value={s.fontFamily} onChange={(e) => set({ fontFamily: e.target.value as FontFamilyId })}>{FONTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
            <label className="field"><span>Text alignment</span>
              <select value={s.align} onChange={(e) => set({ align: e.target.value as Settings['align'] })}><option value="justify">Justified</option><option value="left">Left</option></select></label>
            <Range label="Font size" value={s.fontSize} min={14} max={30} step={1} onChange={up('fontSize')} fmt={(v) => `${v}px`} />
            <Range label="Line height" value={s.lineHeight} min={1.2} max={2.2} step={0.05} onChange={up('lineHeight')} fmt={(v) => v.toFixed(2)} />
            <Range label="Page margins" value={s.margin} min={4} max={16} step={1} onChange={up('margin')} fmt={(v) => `${v}%`} />
            <Range label="Reading width" value={s.readingWidth} min={60} max={100} step={1} onChange={up('readingWidth')} fmt={(v) => `${v}%`} />
          </div>
          <p className="preview" style={{ background: s.customPageColor ?? theme.page, color: s.customTextColor ?? theme.text, fontSize: s.fontSize, lineHeight: s.lineHeight, textAlign: s.align, fontFamily: FONT_CSS[s.fontFamily] }}>
            The quiet hours belong to the reader. A page turns, and the room falls away.
          </p>
        </Section>

        <Section id="s-look" title="Book appearance and animation">
          <div className="form-grid">
            <label className="field check"><input type="checkbox" checked={s.animations} onChange={(e) => set({ animations: e.target.checked })} /><span>Page-turn animation</span></label>
            <Range label="Animation speed" value={s.animationSpeed} min={0.5} max={2} step={0.1} onChange={up('animationSpeed')} fmt={(v) => `${v.toFixed(1)}x`} />
            <label className="field"><span>Frame</span>
              <select value={s.frame} onChange={(e) => set({ frame: e.target.value as Settings['frame'] })}><option value="hardcover">Hardcover</option><option value="none">None</option></select></label>
            <label className="field check"><input type="checkbox" checked={s.texture} onChange={(e) => set({ texture: e.target.checked })} /><span>Paper texture</span></label>
            <Range label="Texture strength" value={s.textureStrength} min={0} max={1} step={0.05} onChange={up('textureStrength')} fmt={(v) => `${Math.round(v * 100)}%`} />
            <Range label="Shadow strength" value={s.shadowStrength} min={0} max={1} step={0.05} onChange={up('shadowStrength')} fmt={(v) => `${Math.round(v * 100)}%`} />
          </div>
          <h3>Custom colors</h3>
          <div className="form-grid">
            <ColorField label="Page color" value={s.customPageColor} fallback={theme.page} onChange={up('customPageColor')} />
            <ColorField label="Text color" value={s.customTextColor} fallback={theme.text} onChange={up('customTextColor')} />
            <ColorField label="Desk color" value={s.customDeskColor} fallback="#2b1d14" onChange={up('customDeskColor')} />
          </div>
          <div className="row"><button className="btn" onClick={() => { reset(); toast.info('Reading preferences reset to defaults.'); }}>Reset all reading preferences</button></div>
        </Section>

        <Section id="s-a11y" title="Accessibility">
          <ul className="plain">
            <li>Everything is reachable with the keyboard; focus is always visible. In the reader, arrow keys and Page Up/Down turn pages.</li>
            <li>If your system asks for reduced motion, page-turn animation is switched off automatically.</li>
            <li>Choose the dyslexia-friendly font, larger text, wider line spacing or a high-contrast theme above.</li>
            <li>Page content is real text where the book allows it, so screen readers and browser zoom keep working.</li>
          </ul>
        </Section>

        <Section id="s-storage" title="Storage">
          <p>{desktop ? 'Books are saved in the app\'s data folder on this computer.' : 'Books are saved inside this browser, on this device only.'}</p>
          {usage.used != null ? (
            <>
              <div className="progress progress-thick" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct ?? 0)} aria-label="Storage used"><span style={{ width: `${pct ?? 0}%` }} /></div>
              <p className="muted">{formatBytes(usage.used)} used{usage.quota ? ` of about ${formatBytes(usage.quota)} available to this site` : ''}. {books.length} book{books.length === 1 ? '' : 's'} in library.</p>
            </>
          ) : <p className="muted">Usage information is not available in this environment.</p>}
          {!desktop && (
            <>
              <p>Persistent storage: <strong>{usage.persisted ? 'granted' : 'not granted'}</strong>. {usage.persisted ? 'The browser will not evict your books when space is low.' : 'Ask the browser not to delete your books automatically when disk space runs low.'}</p>
              <div className="row">
                {!usage.persisted && <button className="btn" onClick={async () => { const ok = await requestPersistence(); refresh(); toast[ok ? 'success' : 'info'](ok ? 'Persistent storage granted.' : 'The browser declined. It may grant it after you install the app or use it more often.'); }}>Request persistent storage</button>}
              </div>
              <p className="notice">Clearing your browser's site data or cookies for this site <strong>deletes every stored book</strong>, along with progress, bookmarks and notes. Keep your original files.</p>
            </>
          )}
          {desktop && <p className="notice">The desktop app keeps books in its own data folder, so clearing browser data does not affect it. Uninstalling may remove the folder.</p>}
        </Section>

        <Section id="s-lib" title="Library management">
          <p>{books.length} book{books.length === 1 ? '' : 's'} stored.</p>
          <button className="btn btn-danger-outline" disabled={busy || books.length === 0} onClick={async () => { setBusy(true); try { await confirmAndClear(confirm, books.length); } finally { setBusy(false); refresh(); } }}>Clear library...</button>
        </Section>

        <Section id="s-about" title="About RealBook Reader">
          <p><strong>Private by design.</strong> Your books are processed and stored only on this device. Nothing is uploaded, no accounts, no analytics, no network requests with your content.</p>
          <h3>Supported formats</h3>
          <p>{SUPPORTED_FORMATS.map((f) => `${f.label} (${f.ext.map((e) => '.' + e).join(', ')})`).join('; ')}.</p>
          <h3>Not supported</h3>
          <ul className="plain">{UNSUPPORTED_FORMATS.map((f) => <li key={f.label}><strong>{f.label}</strong>: {f.reason}</li>)}</ul>
          <p className="muted">DRM-protected files cannot be opened.</p>
        </Section>
      </main>
    </div>
  );
}

const FONT_CSS: Record<FontFamilyId, string> = {
  serif: '"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif',
  georgia: 'Georgia, "Times New Roman", serif',
  garamond: 'Garamond, "EB Garamond", "Palatino Linotype", serif',
  sans: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  mono: 'ui-monospace, "Cascadia Mono", Consolas, monospace',
  dyslexic: '"OpenDyslexic", "Comic Sans MS", "Trebuchet MS", sans-serif',
};
