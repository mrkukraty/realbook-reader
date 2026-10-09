export type ThemeId = 'ivory' | 'parchment' | 'eink' | 'sepia' | 'night' | 'black';
export type PerfMode = 'balanced' | 'lightweight' | 'high';
export type FontFamilyId = 'serif' | 'georgia' | 'garamond' | 'sans' | 'mono' | 'dyslexic';

/** Same shape as the web app's Settings (some desktop-only fields are kept for compatibility). */
export interface Settings {
  theme: ThemeId;
  perfMode: PerfMode;
  layout: 'auto' | 'single' | 'double';
  fontFamily: FontFamilyId;
  fontSize: number;       // px 14..30
  lineHeight: number;     // 1.2..2.2
  margin: number;         // % 4..16
  align: 'left' | 'justify';
  readingWidth: number;
  animationSpeed: number; // 0.5..2
  animations: boolean;
  frame: 'hardcover' | 'none';
  texture: boolean;
  textureStrength: number;
  shadowStrength: number; // 0..1
  customPageColor?: string;
  customTextColor?: string;
  customDeskColor?: string;
}

export const defaultSettings: Settings = {
  theme: 'ivory', perfMode: 'balanced', layout: 'auto', fontFamily: 'serif', fontSize: 19, lineHeight: 1.6,
  margin: 8, align: 'justify', readingWidth: 100, animationSpeed: 1, animations: true, frame: 'hardcover',
  texture: true, textureStrength: 0.5, shadowStrength: 0.6,
};

export const LIMITS = {
  fontSize: [14, 30] as const,
  lineHeight: [1.2, 2.2] as const,
  margin: [4, 16] as const,
  animationSpeed: [0.5, 2] as const,
};

/** Merge persisted (possibly old/partial/garbage) settings with defaults and clamp numbers. */
export function normalizeSettings(raw: unknown): Settings {
  const s = { ...defaultSettings, ...(raw && typeof raw === 'object' ? (raw as Partial<Settings>) : {}) };
  const num = (v: unknown, [a, b]: readonly [number, number], d: number) =>
    typeof v === 'number' && Number.isFinite(v) ? Math.min(b, Math.max(a, v)) : d;
  s.fontSize = num(s.fontSize, LIMITS.fontSize, defaultSettings.fontSize);
  s.lineHeight = num(s.lineHeight, LIMITS.lineHeight, defaultSettings.lineHeight);
  s.margin = num(s.margin, LIMITS.margin, defaultSettings.margin);
  s.animationSpeed = num(s.animationSpeed, LIMITS.animationSpeed, defaultSettings.animationSpeed);
  s.shadowStrength = num(s.shadowStrength, [0, 1], defaultSettings.shadowStrength);
  if (!['ivory', 'parchment', 'eink', 'sepia', 'night', 'black'].includes(s.theme)) s.theme = 'ivory';
  if (!['balanced', 'lightweight', 'high'].includes(s.perfMode)) s.perfMode = 'balanced';
  if (!['auto', 'single', 'double'].includes(s.layout)) s.layout = 'auto';
  if (!['serif', 'georgia', 'garamond', 'sans', 'mono', 'dyslexic'].includes(s.fontFamily)) s.fontFamily = 'serif';
  if (s.align !== 'left' && s.align !== 'justify') s.align = 'justify';
  s.animations = s.animations !== false;
  return s;
}
