import type { Settings, ThemeId } from '../../settings/types';

export interface ReaderTheme {
  id: ThemeId; label: string;
  page: string; text: string; desk: string;
  /** "r,g,b" tint for shadows */
  shadow: string;
  /** paper grain multiplier 0..1 */
  grain: number;
  chrome: string; chromeText: string; chromeBorder: string; accent: string; link: string;
  leather: string;
  dark: boolean;
}

export const THEMES: Record<ThemeId, ReaderTheme> = {
  ivory: { id: 'ivory', label: 'Classic Ivory', page: '#f6efdc', text: '#2a2118', desk: '#3a2a1e', shadow: '40,25,10', grain: 1, chrome: '#fbf6e9', chromeText: '#2a2118', chromeBorder: '#d9ccb0', accent: '#8a4b2a', link: '#7a3b1d', leather: '#5a2f1c', dark: false },
  parchment: { id: 'parchment', label: 'Antique Parchment', page: '#e8d6a8', text: '#3b2a14', desk: '#2b2016', shadow: '60,35,10', grain: 1.3, chrome: '#efe0b8', chromeText: '#3b2a14', chromeBorder: '#c9b17a', accent: '#7a4a14', link: '#6b3a0e', leather: '#4a2a14', dark: false },
  eink: { id: 'eink', label: 'Clean E-Ink', page: '#ececea', text: '#1b1b1b', desk: '#bdbdb9', shadow: '0,0,0', grain: 0.25, chrome: '#f5f5f3', chromeText: '#1b1b1b', chromeBorder: '#c9c9c4', accent: '#333', link: '#222', leather: '#555', dark: false },
  sepia: { id: 'sepia', label: 'Sepia', page: '#f1e4c8', text: '#5b4636', desk: '#6d5740', shadow: '70,45,20', grain: 0.8, chrome: '#f5ead2', chromeText: '#4a382a', chromeBorder: '#d3c09a', accent: '#9a5b2e', link: '#8a4a1e', leather: '#6a4326', dark: false },
  night: { id: 'night', label: 'Night Reading', page: '#1d2026', text: '#c9cbd1', desk: '#0d0f12', shadow: '0,0,0', grain: 0.35, chrome: '#171a1f', chromeText: '#d6d8dd', chromeBorder: '#2d3138', accent: '#d7a85a', link: '#e0b36a', leather: '#222831', dark: true },
  black: { id: 'black', label: 'Pure Black', page: '#000000', text: '#b8b8b8', desk: '#000000', shadow: '0,0,0', grain: 0, chrome: '#0a0a0a', chromeText: '#d0d0d0', chromeBorder: '#222', accent: '#e0b36a', link: '#e0b36a', leather: '#0e0e0e', dark: true },
};

export function resolveTheme(s: Pick<Settings, 'theme' | 'customPageColor' | 'customTextColor' | 'customDeskColor'>): ReaderTheme {
  const t = THEMES[s.theme] ?? THEMES.ivory;
  return { ...t, page: s.customPageColor || t.page, text: s.customTextColor || t.text, desk: s.customDeskColor || t.desk };
}

/** CSS custom properties applied on the reader root: theme changes are instantaneous. */
export function themeVars(s: Settings): Record<string, string> {
  const t = resolveTheme(s);
  return {
    '--rb-page': t.page, '--rb-text': t.text, '--rb-desk': t.desk, '--rb-shadow': t.shadow,
    '--rb-grain': String(s.texture ? Math.min(1, s.textureStrength * t.grain) * 0.55 : 0),
    '--rb-chrome': t.chrome, '--rb-chrome-text': t.chromeText, '--rb-chrome-border': t.chromeBorder,
    '--rb-accent': t.accent, '--rb-link': t.link, '--rb-leather': t.leather,
    '--rb-shade': String(s.shadowStrength),
    '--rb-dark': t.dark ? '1' : '0',
  };
}
