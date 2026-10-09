// Pure progress conversion helpers (unit-tested).

/** Fraction (0..1) of a section at which page `page` (0-based) of `pageCount` starts. */
export function pageToSectionFraction(page: number, pageCount: number): number {
  if (pageCount <= 1) return 0;
  const p = Math.max(0, Math.min(page, pageCount - 1));
  return p / pageCount;
}

/** Page whose range contains the given section fraction. */
export function sectionFractionToPage(fraction: number, pageCount: number): number {
  if (pageCount <= 1 || !Number.isFinite(fraction)) return 0;
  const f = Math.max(0, Math.min(1, fraction));
  return Math.min(pageCount - 1, Math.floor(f * pageCount + 1e-6));
}

/** Cumulative weights so overall progress reflects text length rather than section count. */
export function sectionWeights(lengths: number[]): { starts: number[]; total: number } {
  const starts: number[] = [];
  let total = 0;
  for (const l of lengths) {
    starts.push(total);
    total += Math.max(1, l);
  }
  return { starts, total: Math.max(1, total) };
}

export function overallFraction(section: number, sectionFraction: number, lengths: number[]): number {
  if (!lengths.length) return 0;
  const { starts, total } = sectionWeights(lengths);
  const s = Math.max(0, Math.min(section, lengths.length - 1));
  const f = Math.max(0, Math.min(1, sectionFraction));
  return Math.max(0, Math.min(1, (starts[s] + f * Math.max(1, lengths[s])) / total));
}

export function fromOverallFraction(fraction: number, lengths: number[]): { section: number; sectionFraction: number } {
  if (!lengths.length) return { section: 0, sectionFraction: 0 };
  const { starts, total } = sectionWeights(lengths);
  const pos = Math.max(0, Math.min(1, fraction)) * total;
  let s = 0;
  while (s + 1 < starts.length && starts[s + 1] <= pos) s++;
  const len = Math.max(1, lengths[s]);
  return { section: s, sectionFraction: Math.max(0, Math.min(1, (pos - starts[s]) / len)) };
}

export function fixedFraction(page: number, pageCount: number): number {
  if (pageCount <= 1) return pageCount === 1 ? 1 : 0;
  return Math.max(0, Math.min(1, page / (pageCount - 1)));
}

export function percentLabel(f: number): string {
  return `${Math.round(Math.max(0, Math.min(1, f)) * 100)}%`;
}
