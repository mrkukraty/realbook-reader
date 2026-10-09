/**
 * Spread model (pure, unit-tested; same contract as the web app's page-flip/spread.ts).
 *  single: spread k = [page k]
 *  double: spread 0 = [blank, page 0]; spread k = [page 2k-1, page 2k]
 */
export type FlipMode = 'single' | 'double';

export function spreadCount(pageCount: number, mode: FlipMode): number {
  const n = Math.max(0, Math.floor(pageCount));
  if (mode === 'single') return Math.max(1, n);
  return Math.floor(n / 2) + 1;
}

export function spreadOfPage(page: number, mode: FlipMode): number {
  const p = Math.max(0, Math.floor(page));
  return mode === 'single' ? p : Math.ceil(p / 2);
}

export function pagesOfSpread(spread: number, mode: FlipMode, pageCount: number): [number | null, number | null] {
  const ok = (p: number) => (p >= 0 && p < pageCount ? p : null);
  if (mode === 'single') return [null, ok(spread)];
  return [ok(2 * spread - 1), ok(2 * spread)];
}

export function primaryPageOfSpread(spread: number, mode: FlipMode, pageCount = Infinity): number {
  const p = mode === 'single' ? spread : spread === 0 ? 0 : 2 * spread - 1;
  return Math.max(0, Math.min(p, Math.max(0, pageCount - 1)));
}

export function visiblePages(spread: number, mode: FlipMode, pageCount: number): number[] {
  const [l, r] = pagesOfSpread(spread, mode, pageCount);
  return [l, r].filter((x): x is number => x !== null);
}

/** Layout decision: two-page spread on tablets / landscape when there is enough width. */
export function chooseFlipMode(width: number, height: number, layout: 'auto' | 'single' | 'double'): FlipMode {
  if (layout === 'single') return 'single';
  if (layout === 'double') return width >= 560 ? 'double' : 'single';
  const landscape = width > height;
  return (landscape && width >= 700) || width >= 900 ? 'double' : 'single';
}

/** Page box size for the book area. Each page keeps a paper-like ratio. */
export function pageBox(areaW: number, areaH: number, mode: FlipMode, aspect = 0.68): { pw: number; ph: number } {
  const cols = mode === 'double' ? 2 : 1;
  let pw = areaW / cols;
  let ph = areaH;
  if (pw / ph > aspect) pw = ph * aspect; // too wide -> limit width
  return { pw: Math.floor(pw), ph: Math.floor(ph) };
}
