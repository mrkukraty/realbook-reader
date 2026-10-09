import { memo, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { FixedDocument, PageLink, Target, TocItem } from '../../../formats/types';
import { Emitter, type Anchor, type Chapter, type ReaderContent, type SavedPosition, type SearchHit, type SearchOptions } from '../content';
import { findMatches } from '../../search/snippets';

interface Entry { host: HTMLElement; links: PageLink[]; ctrl: AbortController }

/** Copy canvases' bitmaps when cloning rendered page DOM. */
function cloneRendered(src: HTMLElement): HTMLElement {
  const copy = src.cloneNode(true) as HTMLElement;
  const a = src.querySelectorAll('canvas'), b = copy.querySelectorAll('canvas');
  a.forEach((c, i) => {
    const d = b[i] as HTMLCanvasElement;
    d.width = c.width; d.height = c.height;
    d.getContext('2d')?.drawImage(c, 0, 0);
  });
  return copy;
}

/** Render-once cache of fixed pages. Pages are rendered into an off-screen host and cloned for display. */
export class FixedPageCache {
  private entries = new Map<number, Promise<Entry>>();
  private done = new Map<number, Entry>();
  size = { w: 0, h: 0 };
  constructor(private doc: FixedDocument, private offscreen: HTMLElement) {}

  setSize(w: number, h: number) {
    if (w === this.size.w && h === this.size.h) return;
    this.size = { w, h };
    this.clear();
  }
  clear() {
    this.entries.forEach((_, i) => this.drop(i));
  }
  private drop(i: number) {
    this.entries.delete(i);
    const e = this.done.get(i);
    this.done.delete(i);
    if (e) { e.ctrl.abort(); e.host.remove(); }
    else pendingCtrl.get(this)?.get(i)?.abort();
  }
  /** abort + free everything farther than radius pages from center */
  evictOutside(center: number, radius: number) {
    for (const i of Array.from(this.entries.keys())) if (Math.abs(i - center) > radius) this.drop(i);
  }
  ensure(index: number): Promise<Entry> {
    const hit = this.entries.get(index);
    if (hit) return hit;
    const ctrl = new AbortController();
    let m = pendingCtrl.get(this); if (!m) { m = new Map(); pendingCtrl.set(this, m); }
    m.set(index, ctrl);
    const host = document.createElement('div');
    host.className = 'rb-fixed-host';
    host.style.cssText = `width:${this.size.w}px;height:${this.size.h}px;position:relative`;
    this.offscreen.appendChild(host);
    let p!: Promise<Entry>;
    p = (async () => {
      try {
        const links = (await this.doc.renderPage(index, host, { width: this.size.w, height: this.size.h, signal: ctrl.signal })) || [];
        if (ctrl.signal.aborted) throw new DOMException('aborted', 'AbortError');
        const e: Entry = { host, links, ctrl };
        this.done.set(index, e);
        return e;
      } catch (err) {
        host.remove();
        if (this.entries.get(index) === p) this.entries.delete(index);
        throw err;
      } finally { m!.delete(index); }
    })();
    this.entries.set(index, p);
    p.catch(() => { /* handled by consumers */ });
    return p;
  }
  /** Fresh DOM copy of a rendered page. */
  async clone(index: number): Promise<{ el: HTMLElement; links: PageLink[] }> {
    const e = await this.ensure(index);
    return { el: cloneRendered(e.host), links: e.links };
  }
  dispose() { this.clear(); }
}
const pendingCtrl = new WeakMap<FixedPageCache, Map<number, AbortController>>();

export interface FixedCtx { openLink(l: PageLink): void }

const FixedPage = memo(function FixedPage({ cache, index, ctx, sizeKey }: { cache: FixedPageCache; index: number; ctx: FixedCtx; sizeKey: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<{ links: PageLink[]; ok: boolean } | null>(null);
  useLayoutEffect(() => {
    let alive = true;
    const run = (attempt: number) => {
      cache.clone(index).then(({ el, links }) => {
        if (!alive || !hostRef.current) return;
        el.style.width = '100%'; el.style.height = '100%';
        hostRef.current.replaceChildren(el);
        setState({ links, ok: true });
      }).catch((e) => {
        if (!alive) return;
        if ((e as Error).name === 'AbortError' && attempt < 2) { run(attempt + 1); return; }
        if ((e as Error).name !== 'AbortError') setState({ links: [], ok: false });
      });
    };
    run(0);
    return () => { alive = false; };
  }, [cache, index, sizeKey]);
  return (
    <div className="rb-fixed">
      <div className="rb-fixed-host" ref={hostRef} />
      {!state && <div className="rb-fixed-loading" role="status">Rendering page…</div>}
      {state && !state.ok && <div className="rb-fixed-loading">This page could not be drawn.</div>}
      {state?.links.length ? (
        <div className="rb-fixed-links">
          {state.links.map((l, i) => (
            <a key={i} href={l.url || '#'} role="link" aria-label={l.url || 'Go to page'}
              style={{ left: `${l.rect[0] * 100}%`, top: `${l.rect[1] * 100}%`, width: `${l.rect[2] * 100}%`, height: `${l.rect[3] * 100}%` }}
              onClick={(e) => { e.preventDefault(); ctx.openLink(l); }} />
          ))}
        </div>
      ) : null}
    </div>
  );
});

function flatten(items: TocItem[], depth = 0, out: { title: string; depth: number; target: Target }[] = []) {
  for (const it of items) { out.push({ title: it.title, depth, target: it.target }); if (it.children) flatten(it.children, depth + 1, out); }
  return out;
}

export class FixedContent extends Emitter implements ReaderContent {
  readonly kind = 'fixed' as const;
  readonly ready = true;
  readonly complete = true;
  readonly progress = 1;
  readonly cache: FixedPageCache;
  private page = 0;
  private size = { w: 0, h: 0 };
  private radius = 2;
  private disposed = false;
  private offscreen: HTMLElement;
  private pageTexts = new Map<number, string>();

  constructor(private doc: FixedDocument, host: HTMLElement, private ctx: FixedCtx) {
    super();
    this.offscreen = document.createElement('div');
    this.offscreen.className = 'rb-offscreen';
    host.appendChild(this.offscreen);
    this.cache = new FixedPageCache(doc, this.offscreen);
  }
  get hasText() { return this.doc.hasText; }
  get pageCount() { return this.doc.pageCount; }
  get pageIndex() { return this.page; }
  get chapters(): Chapter[] {
    const out: Chapter[] = [];
    for (const t of flatten(this.doc.toc)) if ('page' in t.target) out.push({ page: t.target.page, title: t.title, depth: t.depth });
    return out.sort((a, b) => a.page - b.page);
  }

  setLayout(w: number, h: number, radius: number) {
    this.radius = radius;
    this.size = { w, h };
    this.cache.setSize(w, h);
    this.emit();
    this.prefetch();
  }
  sizeKey() { return `${this.size.w}x${this.size.h}`; }

  /** keep ±radius spreads warm; abort and free the rest */
  prefetch(visible: number[] = [this.page]) {
    if (this.disposed || !this.size.w) return;
    const r = this.radius * 2 + 1;
    for (const v of visible) {
      this.cache.evictOutside(v, r + 1);
      for (let d = 0; d <= r; d++) for (const i of [v + d, v - d]) if (i >= 0 && i < this.doc.pageCount) this.cache.ensure(i).catch(() => {});
    }
  }

  renderPage(index: number): ReactNode {
    if (!this.size.w) return null;
    return <FixedPage cache={this.cache} index={index} ctx={this.ctx} sizeKey={this.sizeKey()} />;
  }

  setPageIndex(i: number) {
    this.page = Math.max(0, Math.min(this.doc.pageCount - 1, i));
    this.prefetch();
    this.emit();
  }
  savedPosition(): SavedPosition { return { page: this.page, fraction: this.fractionAt(this.page) }; }
  anchorAt(i: number): Anchor { return { page: i }; }
  indexOfAnchor(a: Anchor) { return a.page; }
  async resolveTarget(t: Target) { return 'page' in t ? Math.max(0, Math.min(this.doc.pageCount - 1, t.page)) : undefined; }
  chapterAt(index: number) {
    let t = '';
    for (const c of this.chapters) { if (c.page <= index) t = c.title; else break; }
    return t;
  }
  fractionAt(i: number) { return this.doc.pageCount > 1 ? i / (this.doc.pageCount - 1) : 0; }

  async search(query: string, o: SearchOptions): Promise<void> {
    if (!this.doc.hasText) return;
    const n = this.doc.pageCount;
    let total = 0;
    const max = o.max ?? 500;
    for (let i = 0; i < n; i++) {
      if (o.signal.aborted) return;
      let text = this.pageTexts.get(i);
      if (text === undefined) {
        try { text = await this.doc.getPageText(i); } catch { text = ''; }
        if (this.pageTexts.size < 400) this.pageTexts.set(i, text);
      }
      const ms = findMatches(text, query, { max: Math.min(5, max - total), context: 45 });
      if (ms.length) {
        o.onResults(ms.map((m) => ({ id: `${i}:${m.index}`, label: `Page ${i + 1}`, snippet: m.snippet, ref: { page: i } })));
        total += ms.length;
      }
      o.onProgress((i + 1) / n);
      if (total >= max) break;
    }
  }
  async resolveHit(hit: SearchHit) { return 'page' in hit.ref ? hit.ref.page : undefined; }
  clearHit() {}
  dispose() { this.disposed = true; this.cache.dispose(); this.offscreen.remove(); }
}
