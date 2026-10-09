import type { Settings } from '../../settings/types';
import type { FlipMode } from '../page-flip/spread';

export function resolveMode(layout: Settings['layout'], w: number, h: number): FlipMode {
  if (layout === 'single') return 'single';
  if (layout === 'double') return 'double';
  return w >= 900 && w > h ? 'double' : 'single';
}

export interface SizeInput {
  stageW: number; stageH: number; mode: FlipMode;
  /** page width/height; for reflow pass flex=true to let pages grow taller when width-limited */
  aspect: number; flex?: boolean; minAspect?: number;
  readingWidth: number; framePad: number; edge: number; reserveY: number;
}

export function computeBookSize(i: SizeInput): { pageW: number; pageH: number } {
  const across = i.mode === 'double' ? 2 : 1;
  const availW = Math.max(120, (i.stageW * i.readingWidth) / 100 - 2 * (i.framePad + i.edge) - 12);
  const availH = Math.max(120, i.stageH - i.reserveY - 2 * i.framePad - 8);
  const wLimit = availW / across;
  let pw = Math.min(wLimit, availH * i.aspect);
  let ph = pw / i.aspect;
  if (i.flex && pw >= wLimit - 0.5) ph = Math.min(availH, pw / (i.minAspect ?? 0.5));
  return { pageW: Math.max(100, Math.floor(pw)), pageH: Math.max(140, Math.floor(ph)) };
}

export interface FlowGeom { cw: number; ch: number; padX: number; padY: number }
export function flowGeometry(pageW: number, pageH: number, marginPct: number): FlowGeom {
  const padX = Math.round((pageW * marginPct) / 100);
  const padY = Math.max(14, Math.round(padX * 0.9));
  return { padX, padY, cw: Math.max(60, Math.floor(pageW - 2 * padX)), ch: Math.max(60, Math.floor(pageH - 2 * padY)) };
}

export const FONT_STACKS: Record<Settings['fontFamily'], string> = {
  serif: "'Iowan Old Style','Palatino Linotype',Palatino,'Book Antiqua',Georgia,serif",
  georgia: "Georgia,'Times New Roman',serif",
  garamond: "'EB Garamond',Garamond,'Cormorant Garamond','Times New Roman',serif",
  sans: "system-ui,'Segoe UI',Roboto,Helvetica,Arial,sans-serif",
  mono: "'SFMono-Regular',Consolas,'Liberation Mono',Menlo,monospace",
  dyslexic: "'OpenDyslexic','Atkinson Hyperlegible',Lexend,'Comic Sans MS','Trebuchet MS',sans-serif",
};

export interface Typo { fontFamily: string; fontSize: number; lineHeight: number; align: 'left' | 'justify'; lang?: string }

export function layoutKey(mode: FlipMode, g: FlowGeom, t: Typo): string {
  return [mode, g.cw, g.ch, t.fontFamily, t.fontSize, t.lineHeight, t.align, t.lang ?? ''].join('|');
}
