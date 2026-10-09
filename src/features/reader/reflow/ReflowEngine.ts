import type { Chunk } from './chunks';
import { offsetToPosition } from '../../highlights/apply';

export interface FlowStyle {
  cw: number; ch: number;
  fontFamily: string; fontSize: number; lineHeight: number; align: 'left' | 'justify'; lang?: string;
}

/** CSS custom props + sizes shared by the visible pages and the hidden measuring element. */
export function flowCss(f: FlowStyle): Record<string, string | number> {
  return {
    width: f.cw, height: f.ch, columnWidth: f.cw,
    ['--f-family' as string]: f.fontFamily, ['--f-size' as string]: `${f.fontSize}px`, ['--f-lh' as string]: String(f.lineHeight),
    ['--f-align' as string]: f.align, ['--f-ch' as string]: `${f.ch}px`,
  };
}

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

/**
 * Hidden measuring element with the exact page inner size. Column layout (column-width = page width, gap 0)
 * lays a chunk out as N pages; page count = scrollWidth / width. Everything is injectable-free DOM, kept
 * out of the pure logic modules (jsdom has no layout).
 */
export class ReflowEngine {
  private el: HTMLElement;
  private loaded = -1;
  private style: FlowStyle | null = null;
  constructor(host: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'rb-flow rb-flow-measure';
    this.el.setAttribute('aria-hidden', 'true');
    host.appendChild(this.el);
  }
  dispose() { this.el.remove(); this.loaded = -1; }

  setStyle(f: FlowStyle) {
    this.style = f;
    const css = flowCss(f);
    for (const [k, v] of Object.entries(css)) {
      if (k.startsWith('--')) this.el.style.setProperty(k, String(v));
      else (this.el.style as unknown as Record<string, string>)[k] = typeof v === 'number' ? `${v}px` : String(v);
    }
    if (f.lang) this.el.lang = f.lang;
    this.loaded = -1;
  }

  private async load(chunk: Chunk, signal?: AbortSignal) {
    if (this.loaded === chunk.index) return;
    this.el.innerHTML = chunk.html;
    this.loaded = chunk.index;
    const imgs = Array.from(this.el.querySelectorAll('img'));
    const pending = imgs.filter((i) => !i.complete);
    if (pending.length) {
      await Promise.race([
        Promise.all(pending.map((i) => new Promise<void>((res) => { i.addEventListener('load', () => res(), { once: true }); i.addEventListener('error', () => res(), { once: true }); }))),
        new Promise<void>((r) => setTimeout(r, 1500)),
      ]);
    }
    if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
  }

  async countPages(chunk: Chunk, signal?: AbortSignal): Promise<number> {
    await this.load(chunk, signal);
    const cw = this.style!.cw;
    return Math.max(1, Math.round(this.el.scrollWidth / cw));
  }

  /** Page (within chunk) containing an anchor id or a chunk-local text offset. */
  async locate(chunk: Chunk, target: { anchor?: string; offset?: number }, signal?: AbortSignal): Promise<number> {
    await this.load(chunk, signal);
    const cw = this.style!.cw;
    const origin = this.el.getBoundingClientRect().left;
    let left: number | null = null;
    if (target.anchor) {
      let node: Element | null = null;
      try { node = this.el.querySelector(`[id="${CSS.escape(target.anchor)}"], a[name="${CSS.escape(target.anchor)}"]`); } catch { /* bad selector */ }
      if (node) { const r = node.getClientRects()[0] ?? node.getBoundingClientRect(); left = r.left - origin; }
    }
    if (left === null && target.offset !== undefined) {
      const a = offsetToPosition(this.el, target.offset);
      if (a) {
        const range = document.createRange();
        range.setStart(a.node, a.offset);
        range.setEnd(a.node, Math.min(a.node.data.length, a.offset + 1));
        const r = range.getClientRects()[0] ?? range.getBoundingClientRect();
        left = r.left - origin;
      }
    }
    const total = Math.max(1, Math.round(this.el.scrollWidth / cw));
    if (left === null) return 0;
    return Math.max(0, Math.min(total - 1, Math.floor((left + 1) / cw)));
  }

  /** Paginate chunks in the given order, yielding to the UI between slices. */
  async paginate(chunks: Chunk[], order: number[], onCount: (chunk: number, count: number, done: number) => void, signal: AbortSignal) {
    let sliceStart = performance.now();
    let done = 0;
    for (const i of order) {
      if (signal.aborted) return;
      try {
        const n = await this.countPages(chunks[i], signal);
        if (signal.aborted) return;
        onCount(i, n, ++done);
      } catch (e) {
        if ((e as Error).name === 'AbortError') return;
        throw e;
      }
      if (performance.now() - sliceStart > 12) { await tick(); sliceStart = performance.now(); }
    }
  }
}
