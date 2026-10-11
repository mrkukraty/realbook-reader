export type ThemeId = 'ivory' | 'parchment' | 'eink' | 'kindle' | 'sepia' | 'night' | 'black';
export type PerfMode = 'balanced' | 'lightweight' | 'high';
export const FONT_IDS = [
  'serif', 'georgia', 'garamond', 'baskerville', 'charter', 'didot', 'cochin',
  'sans', 'avenir', 'optima', 'futura', 'gill', 'dyslexic',
  'handwritten', 'notebook', 'marker', 'chalkboard', 'script', 'calligraphy',
  'typewriter', 'mono',
] as const;
export type FontFamilyId = (typeof FONT_IDS)[number];

/** Same shape as the web app's Settings (some desktop-only fields are kept for compatibility). */
export interface Settings {
  theme: ThemeId;
  perfMode: PerfMode;
  layout: 'auto' | 'single' | 'double';
  fontFamily: FontFamilyId;
  fontSize: number;       // px 12..40
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
  /** PDFs: 'page' shows the printed page, 'text' re-flows its text so fonts and sizes apply */
  pdfView: 'page' | 'text';
  /** PDF pages in 'page' view: painted with the theme's paper/ink colours, or left as printed */
  pdfColors: 'theme' | 'original';
  /** extra space after paragraphs, in em */
  paraSpacing: number;
  /** dims the page (0 = off .. 0.7) and adds a warm tint (0 .. 0.6) for night reading */
  dim: number;
  warmth: number;
  /** keep the screen on while the reader is open */
  keepAwake: boolean;
  /**
   * read aloud: 'auto' reads each passage in its own language with the reader's accent; otherwise a language
   * tag such as 'en-GB' or 'es-MX' that everything is read in
   */
  speechLang: string;
  /** a specific installed voice for speechLang ('' = the best one) */
  speechVoice: string;
  /** read-aloud speed (1 = normal) */
  speechRate: number;
}

export const defaultSettings: Settings = {
  theme: 'ivory', perfMode: 'balanced', layout: 'auto', fontFamily: 'serif', fontSize: 19, lineHeight: 1.6,
  margin: 8, align: 'justify', readingWidth: 100, animationSpeed: 1, animations: true, frame: 'hardcover',
  texture: true, textureStrength: 0.5, shadowStrength: 0.6, pdfView: 'page', pdfColors: 'theme',
  paraSpacing: 0.2, dim: 0, warmth: 0, keepAwake: true, speechLang: 'auto', speechVoice: '', speechRate: 1,
};

export const LIMITS = {
  fontSize: [12, 40] as const,
  lineHeight: [1.2, 2.2] as const,
  margin: [4, 16] as const,
  animationSpeed: [0.5, 2] as const,
  paraSpacing: [0, 1.5] as const,
  dim: [0, 0.7] as const,
  warmth: [0, 0.6] as const,
  speechRate: [0.5, 2] as const,
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
  if (!['ivory', 'parchment', 'eink', 'kindle', 'sepia', 'night', 'black'].includes(s.theme)) s.theme = 'ivory';
  if (!['balanced', 'lightweight', 'high'].includes(s.perfMode)) s.perfMode = 'balanced';
  if (!['auto', 'single', 'double'].includes(s.layout)) s.layout = 'auto';
  if (!(FONT_IDS as readonly string[]).includes(s.fontFamily)) s.fontFamily = 'serif';
  if (s.align !== 'left' && s.align !== 'justify') s.align = 'justify';
  s.animations = s.animations !== false;
  s.paraSpacing = num(s.paraSpacing, LIMITS.paraSpacing, defaultSettings.paraSpacing);
  s.dim = num(s.dim, LIMITS.dim, 0);
  s.warmth = num(s.warmth, LIMITS.warmth, 0);
  s.keepAwake = s.keepAwake !== false;
  if (s.pdfView !== 'page' && s.pdfView !== 'text') s.pdfView = 'page';
  if (s.pdfColors !== 'theme' && s.pdfColors !== 'original') s.pdfColors = 'theme';
  if (typeof s.speechLang !== 'string' || !/^[A-Za-z]{2,3}([-_][A-Za-z0-9]{1,8})*$/.test(s.speechLang)) s.speechLang = 'auto';
  if (typeof s.speechVoice !== 'string' || s.speechVoice.length > 200 || s.speechLang === 'auto') s.speechVoice = '';
  s.speechRate = num(s.speechRate, LIMITS.speechRate, 1);
  return s;
}
