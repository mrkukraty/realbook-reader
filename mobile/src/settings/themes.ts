import type { FontFamilyId, PerfMode, ThemeId } from './types';

export interface Theme {
  id: ThemeId;
  label: string;
  page: string;      // paper colour
  text: string;
  muted: string;
  accent: string;    // links, selection
  desk: string;      // background behind the book
  edge: string;      // page-thickness edge colour
  gutter: string;    // spine shadow colour (rgba)
  dark: boolean;
  chrome: string;    // toolbar background
  chromeText: string;
}

export const THEMES: Record<ThemeId, Theme> = {
  ivory: { id: 'ivory', label: 'Classic Ivory', page: '#fbf6e9', text: '#2b2621', muted: '#7a6f62', accent: '#8a4b20', desk: '#5b4636', edge: '#e9dfc8', gutter: 'rgba(60,40,20,0.28)', dark: false, chrome: '#f4ecdb', chromeText: '#2b2621' },
  parchment: { id: 'parchment', label: 'Antique Parchment', page: '#f1e2bf', text: '#3b2e1e', muted: '#806a4a', accent: '#7a3e12', desk: '#4a3524', edge: '#dcc89c', gutter: 'rgba(80,50,15,0.34)', dark: false, chrome: '#e8d6ac', chromeText: '#3b2e1e' },
  eink: { id: 'eink', label: 'Clean E-Ink', page: '#f2f2ef', text: '#111111', muted: '#666666', accent: '#000000', desk: '#bdbdb8', edge: '#dddddb', gutter: 'rgba(0,0,0,0.14)', dark: false, chrome: '#e8e8e5', chromeText: '#111111' },
  sepia: { id: 'sepia', label: 'Sepia', page: '#efe0c6', text: '#4a3826', muted: '#86705a', accent: '#8b5a2b', desk: '#3d2f22', edge: '#d9c6a4', gutter: 'rgba(70,45,20,0.3)', dark: false, chrome: '#e5d3b4', chromeText: '#4a3826' },
  night: { id: 'night', label: 'Night Reading', page: '#22201d', text: '#cfc6b6', muted: '#8d8476', accent: '#d4a463', desk: '#121110', edge: '#2e2b27', gutter: 'rgba(0,0,0,0.55)', dark: true, chrome: '#1b1a18', chromeText: '#d8cfbf' },
  black: { id: 'black', label: 'Pure Black', page: '#000000', text: '#b9b9b9', muted: '#777777', accent: '#c9a36b', desk: '#000000', edge: '#151515', gutter: 'rgba(40,40,40,0.6)', dark: true, chrome: '#0a0a0a', chromeText: '#c8c8c8' },
};
export const THEME_ORDER: ThemeId[] = ['ivory', 'parchment', 'eink', 'sepia', 'night', 'black'];

/** CSS font stacks used inside the WebView (system fonts only - nothing is downloaded). */
export const FONT_STACKS: Record<FontFamilyId, { label: string; css: string }> = {
  serif: { label: 'Book Serif', css: "'Iowan Old Style','Palatino','Noto Serif','Droid Serif',Georgia,serif" },
  georgia: { label: 'Georgia', css: "Georgia,'Noto Serif',serif" },
  garamond: { label: 'Garamond-like', css: "'EB Garamond',Garamond,'Baskerville','Times New Roman','Noto Serif',serif" },
  sans: { label: 'Sans', css: "-apple-system,'Roboto','Helvetica Neue',Arial,sans-serif" },
  mono: { label: 'Monospace', css: "'Menlo','Roboto Mono','Courier New',monospace" },
  dyslexic: { label: 'Readable Sans (wide)', css: "'Verdana','Tahoma','Roboto',sans-serif" },
};

export interface PerfProfile {
  id: PerfMode;
  label: string;
  description: string;
  /** 'flip' = 3D leaf, 'fade' = flat crossfade */
  transition: 'flip' | 'fade';
  curl: boolean;     // shading gradient on the leaf
  specular: boolean; // highlight strip
  cast: boolean;     // shadow on the page underneath
  shadowScale: number;
  edges: number;     // page-thickness edge layers
  duration: number;  // base turn duration ms at speed 1
  preloadNeighbor: boolean;
}

export const PERF_PROFILES: Record<PerfMode, PerfProfile> = {
  balanced: { id: 'balanced', label: 'Balanced', description: '3D page turn with shading and shadow.', transition: 'flip', curl: true, specular: false, cast: true, shadowScale: 0.85, edges: 3, duration: 650, preloadNeighbor: true },
  lightweight: { id: 'lightweight', label: 'Lightweight', description: 'Quick crossfade, one page view in memory. Best for older phones.', transition: 'fade', curl: false, specular: false, cast: false, shadowScale: 0.4, edges: 1, duration: 200, preloadNeighbor: false },
  high: { id: 'high', label: 'High Quality', description: 'Slower, richer turn with highlight and deeper shadows.', transition: 'flip', curl: true, specular: true, cast: true, shadowScale: 1.15, edges: 5, duration: 800, preloadNeighbor: true },
};

export function perfProfile(mode: PerfMode | undefined): PerfProfile {
  return PERF_PROFILES[mode ?? 'balanced'] ?? PERF_PROFILES.balanced;
}
