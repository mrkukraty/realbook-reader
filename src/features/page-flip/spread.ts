/**
 * Spread model (pure, unit-tested).
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

/** [left, right] page indexes of a spread; null = blank (cover inside / past the end). */
export function pagesOfSpread(spread: number, mode: FlipMode, pageCount: number): [number | null, number | null] {
  const ok = (p: number) => (p >= 0 && p < pageCount ? p : null);
  if (mode === 'single') return [null, ok(spread)];
  return [ok(2 * spread - 1), ok(2 * spread)];
}

/** Page reported to the owner after landing on a spread (left page when present, else the right one). */
export function primaryPageOfSpread(spread: number, mode: FlipMode, pageCount = Infinity): number {
  const p = mode === 'single' ? spread : spread === 0 ? 0 : 2 * spread - 1;
  return Math.max(0, Math.min(p, Math.max(0, pageCount - 1)));
}

export function visiblePages(spread: number, mode: FlipMode, pageCount: number): number[] {
  const [l, r] = pagesOfSpread(spread, mode, pageCount);
  return [l, r].filter((x): x is number => x !== null);
}

/** Pages that must be kept rendered/cached around a spread. */
export function neighborPages(spread: number, mode: FlipMode, pageCount: number, radius: number): number[] {
  const out: number[] = [];
  for (let s = spread - radius; s <= spread + radius; s++) {
    if (s < 0 || s >= spreadCount(pageCount, mode)) continue;
    out.push(...visiblePages(s, mode, pageCount));
  }
  return out;
}
