import type { ReactNode } from 'react';
import type { ReflowDocument, Target, TocItem } from '../../../formats/types';
import { Emitter, type Anchor, type Chapter, type ReaderContent, type SavedPosition, type SearchHit, type SearchOptions } from '../content';
import { buildChunks, type Chunk } from './chunks';
import { PageMap, type PageLoc } from './pageMap';
import { ReflowEngine } from './ReflowEngine';
import { ReflowPage, type ReflowInfo } from './ReflowPage';
import { chunkForSection, fromSectionFraction, overallFraction, toSectionFraction } from '../progress';
import { findMatches } from '../../search/snippets';
import type { HlItem } from '../../highlights/apply';
import type { Highlight } from '../../../storage/StorageAdapter';

const countCache = new Map<string, number[]>();
const tick = () => new Promise<void>((r) => setTimeout(r, 0));

interface FlatToc { title: string; depth: number; target: Target }
function flatten(items: TocItem[], depth = 0, out: FlatToc[] = []) {
  for (const it of items) { out.push({ title: it.title, depth, target: it.target }); if (it.children) flatten(it.children, depth + 1, out); }
  return out;
}

export class ReflowContent extends Emitter implements ReaderContent {
  readonly kind = 'reflow' as const;
  readonly hasText = true;
  readonly chunks: Chunk[];
  readonly sectionChunks: number[][];
  private engine: ReflowEngine;
  private map: PageMap;
  private info: ReflowInfo | null = null;
  private anchor: { chunk: number; frac: number } = { chunk: 0, frac: 0 };
  private loc: PageLoc = { chunk: 0, page: 0 };
  private abort: AbortController | null = null;
  private run = 0;
  private _ready = false;
  private _complete = false;
  private _progress = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  private toc: FlatToc[];
  private anchorPages = new Map<string, number>();
  private chapCache: { v: number; list: Chapter[] } | null = null;
  private hlByChunk = new Map<number, HlItem[]>();
  private highlights: Highlight[] = [];
  private hit: { chunk: number; start: number; end: number } | null = null;
  private sectionTitles = new Map<number, string>();
  /** resolves when the current pagination run is finished */
  idle: Promise<void> = Promise.resolve();

  constructor(private bookId: string, private doc: ReflowDocument, host: HTMLElement) {
    super();
    const set = buildChunks(doc);
    this.chunks = set.chunks;
    this.sectionChunks = set.sectionChunks;
    this.map = new PageMap(this.chunks.length);
    this.engine = new ReflowEngine(host);
    this.toc = flatten(doc.toc);
    doc.sections.forEach((s, i) => { if (s.title) this.sectionTitles.set(i, s.title); });
    for (const t of this.toc) if ('section' in t.target && !this.sectionTitles.has(t.target.section)) this.sectionTitles.set(t.target.section, t.title);
  }

  // ---------- state ----------
  get ready() { return this._ready; }
  get complete() { return this._complete; }
  get progress() { return this._progress; }
  get pageCount() { return Math.max(1, this.map.total()); }
  get pageIndex() { return this.map.toIndex(this.loc); }
  get layoutInfo() { return this.info; }
  chunkInfo(i: number) { return this.chunks[i]; }

  private emitSoon() {
    if (this.timer || this.disposed) return;
    this.timer = setTimeout(() => { this.timer = null; if (!this.disposed) this.emit(); }, 120);
  }

  // ---------- layout / pagination ----------
  /** Start (or restart) pagination for a layout. `start` positions the book on first call. */
  setLayout(info: ReflowInfo, start?: { section?: number; sectionFraction?: number }): Promise<void> {
    if (this.disposed) return Promise.resolve();
    if (start && (start.section !== undefined)) {
      const ci = chunkForSection(this.sectionChunks, start.section);
      if (ci !== undefined) {
        const sc = this.sectionChunks[this.chunks[ci].section];
        this.anchor = fromSectionFraction(this.chunks, sc, start.sectionFraction ?? 0);
      }
    }
    this.abort?.abort();
    const ctrl = new AbortController();
    this.abort = ctrl;
    const run = ++this.run;
    this.engine.setStyle(info.style);
    const n = this.chunks.length;
    const key = `${this.bookId}|${info.key}`;
    this._complete = false;
    this.idle = (async () => {
      if (n === 0) { this.commit(info, new PageMap(0)); this._complete = true; this._progress = 1; this.emit(); return; }
      const cached = countCache.get(key);
      if (cached && cached.length === n) {
        this.commit(info, new PageMap(n, cached));
        this._complete = true; this._progress = 1; this.emit();
        void this.resolveChapterAnchors(run);
        return;
      }
      const map = new PageMap(n);
      let committed = false;
      const order: number[] = [];
      const a = Math.min(this.anchor.chunk, n - 1);
      order.push(a);
      for (let d = 1; order.length < n; d++) { if (a + d < n) order.push(a + d); if (a - d >= 0) order.push(a - d); }
      this._progress = 0;
      await this.engine.paginate(this.chunks, order, (ci, count, done) => {
        map.set(ci, count);
        this._progress = done / n;
        if (!committed && ci === a) { committed = true; this.commit(info, map); this.emit(); } else if (committed) {
          // map is shared and mutated in place; keep index of the current location stable
          this.emitSoon();
        }
      }, ctrl.signal);
      if (ctrl.signal.aborted || run !== this.run) return;
      if (!committed) { this.commit(info, map); }
      countCache.set(key, map.counts.map((c) => c ?? 1));
      this._complete = true; this._progress = 1;
      this.emit();
      void this.resolveChapterAnchors(run);
    })();
    return this.idle;
  }

  private commit(info: ReflowInfo, map: PageMap) {
    this.info = info;
    this.map = map;
    this.anchorPages = new Map();
    const c = Math.min(this.anchor.chunk, Math.max(0, this.chunks.length - 1));
    this.loc = { chunk: c, page: map.known(c) ? map.pageForFraction(c, this.anchor.frac) : 0 };
    this._ready = true;
    this.rebuildHl();
  }

  private async resolveChapterAnchors(run: number) {
    // locate anchored TOC entries (needs a finished layout), grouped by chunk, in time slices
    const jobs: { key: string; chunk: number; anchor: string }[] = [];
    for (const t of this.toc) {
      if (!('section' in t.target) || !t.target.anchor) continue;
      const ci = this.chunkOfAnchor(t.target.section, t.target.anchor);
      if (ci === undefined) continue;
      jobs.push({ key: `${ci}#${t.target.anchor}`, chunk: ci, anchor: t.target.anchor });
    }
    jobs.sort((a, b) => a.chunk - b.chunk);
    let t0 = performance.now();
    for (const j of jobs) {
      if (run !== this.run || this.disposed) return;
      try { this.anchorPages.set(j.key, await this.engine.locate(this.chunks[j.chunk], { anchor: j.anchor })); } catch { /* ignore */ }
      if (performance.now() - t0 > 12) { await tick(); t0 = performance.now(); }
    }
    if (run === this.run && !this.disposed) { this.emit(); }
  }

  private chunkOfAnchor(section: number, anchor?: string): number | undefined {
    const first = chunkForSection(this.sectionChunks, section);
    if (first === undefined) return undefined;
    if (!anchor) return first;
    const s = this.chunks[first].section;
    for (const ci of this.sectionChunks[s]) if (this.chunks[ci].ids.includes(anchor)) return ci;
    return first;
  }

  // ---------- navigation model ----------
  setPageIndex(index: number) {
    const loc = this.map.toLoc(index);
    this.loc = loc;
    this.anchor = { chunk: loc.chunk, frac: this.map.known(loc.chunk) ? loc.page / this.map.count(loc.chunk) : 0 };
    this.emit();
  }

  anchorAt(index: number): Anchor {
    const loc = this.map.toLoc(index);
    const frac = loc.page / this.map.count(loc.chunk);
    const c = this.chunks[loc.chunk];
    if (!c) return { section: 0, sectionFraction: 0 };
    return { section: c.section, sectionFraction: toSectionFraction(this.chunks, this.sectionChunks[c.section], loc.chunk, frac) };
  }

  indexOfAnchor(a: Anchor): number | undefined {
    if (a.section === undefined) return undefined;
    const first = chunkForSection(this.sectionChunks, a.section);
    if (first === undefined) return undefined;
    const sc = this.sectionChunks[this.chunks[first].section];
    const { chunk, frac } = fromSectionFraction(this.chunks, sc, a.sectionFraction ?? 0);
    return this.map.start(chunk) + this.map.pageForFraction(chunk, frac);
  }

  savedPosition(): SavedPosition {
    const idx = this.pageIndex;
    const a = this.anchorAt(idx);
    const loc = this.map.toLoc(idx);
    return { ...a, fraction: overallFraction(this.chunks, loc.chunk, loc.page / this.map.count(loc.chunk)) };
  }

  fractionAt(index: number) {
    const loc = this.map.toLoc(index);
    return overallFraction(this.chunks, loc.chunk, loc.page / this.map.count(loc.chunk));
  }

  async resolveTarget(t: Target): Promise<number | undefined> {
    if (!('section' in t)) return undefined;
    const ci = this.chunkOfAnchor(t.section, t.anchor);
    if (ci === undefined) return undefined;
    let page = 0;
    if (t.anchor) page = await this.engine.locate(this.chunks[ci], { anchor: t.anchor });
    return this.map.start(ci) + Math.min(page, this.map.count(ci) - 1);
  }

  /** page index of a char offset inside a doc section */
  async resolveOffset(section: number, offset: number): Promise<number | undefined> {
    const list = this.sectionChunks[section];
    if (!list?.length) return undefined;
    let ci = list[0];
    for (const c of list) if (offset >= this.chunks[c].textStart) ci = c;
    const ch = this.chunks[ci];
    const page = await this.engine.locate(ch, { offset: Math.max(0, offset - ch.textStart) });
    return this.map.start(ci) + Math.min(page, this.map.count(ci) - 1);
  }

  // ---------- chapters ----------
  get chapters(): Chapter[] {
    if (this.chapCache && this.chapCache.v === this.version) return this.chapCache.list;
    const list: Chapter[] = [];
    for (const t of this.toc) {
      if (!('section' in t.target)) continue;
      const ci = this.chunkOfAnchor(t.target.section, t.target.anchor);
      if (ci === undefined) continue;
      const ap = t.target.anchor ? this.anchorPages.get(`${ci}#${t.target.anchor}`) : 0;
      list.push({ page: this.map.start(ci) + (ap ?? 0), title: t.title, depth: t.depth });
    }
    list.sort((a, b) => a.page - b.page);
    this.chapCache = { v: this.version, list };
    return list;
  }

  chapterAt(index: number): string {
    const ch = this.chapters;
    let title = '';
    for (const c of ch) { if (c.page <= index) title = c.title; else break; }
    if (title) return title;
    const loc = this.map.toLoc(index);
    const sec = this.chunks[loc.chunk]?.section;
    return (sec !== undefined && this.sectionTitles.get(sec)) || '';
  }

  // ---------- rendering ----------
  renderPage(index: number): ReactNode {
    const info = this.info;
    if (!info) return null;
    const loc = this.map.toLoc(index);
    const chunk = this.chunks[loc.chunk];
    if (!chunk) return null;
    if (!this.map.known(loc.chunk)) return <div className="rb-fixed-loading">Paginating…</div>;
    return <ReflowPage chunk={chunk} page={loc.page} info={info} hl={this.hlByChunk.get(chunk.index) ?? EMPTY} />;
  }

  // ---------- highlights ----------
  setHighlights(list: Highlight[]) { this.highlights = list; this.rebuildHl(); this.emit(); }
  private rebuildHl() {
    const by = new Map<number, HlItem[]>();
    const add = (ci: number, it: HlItem) => { const a = by.get(ci) ?? []; a.push(it); by.set(ci, a); };
    for (const h of this.highlights) {
      for (const ci of this.sectionChunks[h.section] ?? []) {
        const c = this.chunks[ci];
        const s = Math.max(h.start, c.textStart), e = Math.min(h.end, c.textStart + c.textLen);
        if (e > s) add(ci, { id: h.id, start: s - c.textStart, end: e - c.textStart, color: h.color, note: !!h.note });
      }
    }
    if (this.hit) add(this.hit.chunk, { id: 'hit', start: this.hit.start, end: this.hit.end, color: 'hit' });
    this.hlByChunk = by;
  }
  clearHit() { if (this.hit) { this.hit = null; this.rebuildHl(); this.emit(); } }

  // ---------- search ----------
  async search(query: string, o: SearchOptions): Promise<void> {
    const max = o.max ?? 500;
    let total = 0;
    let t0 = performance.now();
    for (let i = 0; i < this.chunks.length; i++) {
      if (o.signal.aborted) return;
      const c = this.chunks[i];
      const ms = findMatches(c.text, query, { max: max - total, context: 45 });
      if (ms.length) {
        const label = this.chapterLabel(c);
        o.onResults(ms.map((m) => ({ id: `${i}:${m.index}`, label, snippet: m.snippet, ref: { chunk: i, start: m.index, length: m.length } })));
        total += ms.length;
      }
      o.onProgress((i + 1) / this.chunks.length);
      if (total >= max) break;
      if (performance.now() - t0 > 12) { await tick(); t0 = performance.now(); }
    }
    o.onProgress(1);
  }
  private chapterLabel(c: Chunk) {
    return this.sectionTitles.get(c.section) || `Section ${c.section + 1}`;
  }

  async resolveHit(hit: SearchHit): Promise<number | undefined> {
    if (!('chunk' in hit.ref)) return undefined;
    const { chunk, start, length } = hit.ref;
    const c = this.chunks[chunk];
    const page = await this.engine.locate(c, { offset: start });
    this.hit = { chunk, start, end: start + length };
    this.rebuildHl();
    return this.map.start(chunk) + Math.min(page, this.map.count(chunk) - 1);
  }

  dispose() {
    this.disposed = true;
    this.abort?.abort();
    if (this.timer) clearTimeout(this.timer);
    this.engine.dispose();
  }
}

const EMPTY: HlItem[] = [];
