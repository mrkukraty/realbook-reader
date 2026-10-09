export type ThemeId = 'ivory' | 'parchment' | 'eink' | 'sepia' | 'night' | 'black';
export type PerfMode = 'balanced' | 'lightweight' | 'high';
export type FontFamilyId = 'serif' | 'georgia' | 'garamond' | 'sans' | 'mono' | 'dyslexic';

export interface Settings {
  theme: ThemeId;
  perfMode: PerfMode;              // default 'balanced'
  layout: 'auto' | 'single' | 'double';
  fontFamily: FontFamilyId;
  fontSize: number;                // px, 14..30, default 19
  lineHeight: number;              // 1.2..2.2, default 1.6
  margin: number;                  // page inner padding %, 4..16, default 8
  align: 'left' | 'justify';
  readingWidth: number;            // book width as % of available area, 60..100, default 100
  animationSpeed: number;          // 0.5 (slow) .. 2 (fast), default 1
  animations: boolean;             // false = no page-turn animation (also forced by prefers-reduced-motion)
  frame: 'hardcover' | 'none';
  texture: boolean;
  textureStrength: number;         // 0..1
  shadowStrength: number;          // 0..1
  customPageColor?: string;        // overrides theme
  customTextColor?: string;
  customDeskColor?: string;
}

export const defaultSettings: Settings = {
  theme: 'ivory', perfMode: 'balanced', layout: 'auto', fontFamily: 'serif', fontSize: 19, lineHeight: 1.6,
  margin: 8, align: 'justify', readingWidth: 100, animationSpeed: 1, animations: true, frame: 'hardcover',
  texture: true, textureStrength: 0.5, shadowStrength: 0.6,
};
