// Pure navigation over (section, page) locations for reflowable books and page indexes for fixed books.
import type { PageRef } from './page-html';
import { pagesOfSpread, spreadCount, spreadOfPage, type FlipMode } from './spread';

export interface Loc { section: number; page: number }
export interface LocRef { section: number; page: PageRef }

/** Reflow: next location (first page of the next view) or null at the end. */
export function reflowNext(loc: Loc, pageCount: number, sectionCount: number, mode: FlipMode): LocRef | null {
  const step = mode === 'double' ? 2 : 1;
  if (loc.page + step < pageCount) return { section: loc.section, page: loc.page + step };
  if (loc.section + 1 < sectionCount) return { section: loc.section + 1, page: 0 };
  return null;
}

export function reflowPrev(loc: Loc, mode: FlipMode): LocRef | null {
  const step = mode === 'double' ? 2 : 1;
  if (loc.page - step >= 0) return { section: loc.section, page: loc.page - step };
  if (loc.page > 0) return { section: loc.section, page: 0 };
  if (loc.section > 0) return { section: loc.section - 1, page: mode === 'double' ? 'lastEven' : 'last' };
  return null;
}

/** The right-hand page of a double spread whose left page is `left`. */
export function rightOf(left: PageRef): PageRef {
  if (left === 'lastEven') return 'lastEven1';
  if (left === 'last') return 'last';
  if (left === 'lastEven1') return 'lastEven1';
  return left + 1;
}

/** Fixed: the spread index for a page, and the neighbouring spread's pages. */
export function fixedSpreadPages(page: number, mode: FlipMode, pageCount: number): [number | null, number | null] {
  return pagesOfSpread(spreadOfPage(page, mode), mode, pageCount);
}

export function fixedNeighbor(page: number, dir: 1 | -1, mode: FlipMode, pageCount: number): number | null {
  const s = spreadOfPage(page, mode) + dir;
  if (s < 0 || s >= spreadCount(pageCount, mode)) return null;
  const [l, r] = pagesOfSpread(s, mode, pageCount);
  return (l ?? r) as number;
}
