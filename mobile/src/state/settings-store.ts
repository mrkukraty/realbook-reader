import { create } from 'zustand';
import { defaultSettings, normalizeSettings, type Settings } from '../settings/types';
import { getRepo } from './repo';

interface SettingsState {
  settings: Settings;
  loaded: boolean;
  load(): Promise<void>;
  update(patch: Partial<Settings>): void;
  reset(): void;
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
function persist(s: Settings) {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    getRepo().then((r) => r.setKV('settings', JSON.stringify(s))).catch(() => { /* non-fatal */ });
  }, 250);
}

export const useSettings = create<SettingsState>((set, get) => ({
  settings: defaultSettings,
  loaded: false,
  async load() {
    if (get().loaded) return;
    try {
      const raw = await (await getRepo()).getKV('settings');
      set({ settings: normalizeSettings(raw ? JSON.parse(raw) : {}), loaded: true });
    } catch {
      set({ loaded: true });
    }
  },
  update(patch) {
    const next = normalizeSettings({ ...get().settings, ...patch });
    set({ settings: next });
    persist(next);
  },
  reset() {
    set({ settings: defaultSettings });
    persist(defaultSettings);
  },
}));
