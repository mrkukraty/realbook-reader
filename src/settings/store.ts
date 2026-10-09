import { create } from 'zustand';
import { defaultSettings, type Settings } from './types';

const KEY = 'realbook.settings.v1'; // small prefs only; books never go in localStorage

function load(): Settings {
  try { return { ...defaultSettings, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return { ...defaultSettings }; }
}

interface SettingsState { settings: Settings; set: (patch: Partial<Settings>) => void; reset: () => void }

export const useSettings = create<SettingsState>((set, get) => ({
  settings: load(),
  set: (patch) => {
    const settings = { ...get().settings, ...patch };
    try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch { /* ignore */ }
    set({ settings });
  },
  reset: () => { try { localStorage.removeItem(KEY); } catch { /* ignore */ } set({ settings: { ...defaultSettings } }); },
}));
