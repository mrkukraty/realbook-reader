/** Page bookkeeping for chunked reflow content. Pure; unknown counts are estimated. */
export interface PageLoc { chunk: number; page: number }

export class PageMap {
  counts: (number | undefined)[];
  constructor(n: number, counts?: number[]) {
    this.counts = counts ? counts.slice() : new Array(n).fill(undefined);
  }
  get length() { return this.counts.length; }
  set(i: number, c: number) { this.counts[i] = Math.max(1, c); }
  known(i: number) { return this.counts[i] !== undefined; }
  knownCount() { return this.counts.filter((c) => c !== undefined).length; }
  complete() { return this.counts.every((c) => c !== undefined); }
  estimate() {
    const k = this.counts.filter((c): c is number => c !== undefined);
    return k.length ? Math.max(1, Math.round(k.reduce((a, b) => a + b, 0) / k.length)) : 1;
  }
  count(i: number) { return this.counts[i] ?? this.estimate(); }
  start(i: number) { let s = 0; for (let j = 0; j < i && j < this.counts.length; j++) s += this.count(j); return s; }
  total() { return this.start(this.counts.length); }
  toLoc(index: number): PageLoc {
    const n = this.counts.length;
    if (!n) return { chunk: 0, page: 0 };
    let idx = Math.max(0, Math.floor(index));
    for (let i = 0; i < n; i++) {
      const c = this.count(i);
      if (idx < c) return { chunk: i, page: idx };
      idx -= c;
    }
    return { chunk: n - 1, page: this.count(n - 1) - 1 };
  }
  toIndex(loc: PageLoc) {
    return this.start(loc.chunk) + Math.max(0, Math.min(loc.page, this.count(loc.chunk) - 1));
  }
  /** page within chunk that contains fraction f (0..1) of the chunk */
  pageForFraction(chunk: number, f: number) {
    const c = this.count(chunk);
    return Math.max(0, Math.min(c - 1, Math.floor(f * c + 1e-6)));
  }
}
