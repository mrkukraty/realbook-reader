import { useSettings } from '../../../settings/store';
import type { FontFamilyId, ThemeId } from '../../../settings/types';
import { THEMES } from '../themes';
import { Panel } from './parts';

const FONTS: [FontFamilyId, string][] = [['serif', 'Book serif'], ['georgia', 'Georgia'], ['garamond', 'Garamond'], ['sans', 'Sans'], ['mono', 'Mono'], ['dyslexic', 'Dyslexia-friendly']];

function Range({ label, value, min, max, step, onChange, fmt }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; fmt?: (v: number) => string }) {
  return (
    <label className="rb-field"><span>{label}<b>{fmt ? fmt(value) : value}</b></span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} aria-label={label} /></label>
  );
}

export function SettingsPanel({ reflow, onClose }: { reflow: boolean; onClose: () => void }) {
  const { settings: s, set } = useSettings();
  return (
    <Panel title="Appearance" onClose={onClose}>
      <div className="rb-field"><span>Theme</span>
        <div className="rb-themes" role="radiogroup" aria-label="Theme">
          {(Object.keys(THEMES) as ThemeId[]).map((id) => (
            <button key={id} type="button" role="radio" aria-checked={s.theme === id} className={`rb-theme${s.theme === id ? ' is-active' : ''}`} onClick={() => set({ theme: id, customPageColor: undefined, customTextColor: undefined })}>
              <i style={{ background: THEMES[id].page, color: THEMES[id].text }}>Aa</i>{THEMES[id].label}
            </button>
          ))}
        </div>
      </div>
      {reflow ? (
        <>
          <label className="rb-field"><span>Font</span>
            <select value={s.fontFamily} onChange={(e) => set({ fontFamily: e.target.value as FontFamilyId })}>{FONTS.map(([id, l]) => <option key={id} value={id}>{l}</option>)}</select></label>
          <div className="rb-row">
            <button type="button" aria-label="Smaller text" onClick={() => set({ fontSize: Math.max(14, s.fontSize - 1) })}>A−</button>
            <Range label="Text size" value={s.fontSize} min={14} max={30} step={1} onChange={(v) => set({ fontSize: v })} fmt={(v) => `${v}px`} />
            <button type="button" aria-label="Larger text" onClick={() => set({ fontSize: Math.min(30, s.fontSize + 1) })}>A+</button>
          </div>
          <Range label="Line height" value={s.lineHeight} min={1.2} max={2.2} step={0.05} onChange={(v) => set({ lineHeight: v })} />
          <Range label="Margins" value={s.margin} min={4} max={16} step={1} onChange={(v) => set({ margin: v })} fmt={(v) => `${v}%`} />
          <div className="rb-field"><span>Alignment</span>
            <div className="rb-seg" role="radiogroup" aria-label="Alignment">
              {(['left', 'justify'] as const).map((a) => <button key={a} type="button" role="radio" aria-checked={s.align === a} className={s.align === a ? 'is-active' : ''} onClick={() => set({ align: a })}>{a === 'left' ? 'Left' : 'Justified'}</button>)}
            </div></div>
        </>
      ) : <p className="rb-muted">Text settings apply to reflowable books. PDFs and comics keep their original page layout.</p>}
      <div className="rb-field"><span>Page layout</span>
        <div className="rb-seg" role="radiogroup" aria-label="Page layout">
          {(['auto', 'single', 'double'] as const).map((l) => <button key={l} type="button" role="radio" aria-checked={s.layout === l} className={s.layout === l ? 'is-active' : ''} onClick={() => set({ layout: l })}>{l === 'auto' ? 'Auto' : l === 'single' ? 'Single page' : 'Two pages'}</button>)}
        </div></div>
      <label className="rb-check"><input type="checkbox" checked={s.animations} onChange={(e) => set({ animations: e.target.checked })} /> Page-turn animation</label>
      <Range label="Animation speed" value={s.animationSpeed} min={0.5} max={2} step={0.1} onChange={(v) => set({ animationSpeed: v })} fmt={(v) => `${v.toFixed(1)}×`} />
      <label className="rb-check"><input type="checkbox" checked={s.texture} onChange={(e) => set({ texture: e.target.checked })} /> Paper texture</label>
      <Range label="Shadow strength" value={s.shadowStrength} min={0} max={1} step={0.05} onChange={(v) => set({ shadowStrength: v })} fmt={(v) => `${Math.round(v * 100)}%`} />
      <div className="rb-field"><span>Performance</span>
        <div className="rb-seg" role="radiogroup" aria-label="Performance mode">
          {(['lightweight', 'balanced', 'high'] as const).map((p) => <button key={p} type="button" role="radio" aria-checked={s.perfMode === p} className={s.perfMode === p ? 'is-active' : ''} onClick={() => set({ perfMode: p })}>{p[0].toUpperCase() + p.slice(1)}</button>)}
        </div></div>
    </Panel>
  );
}
