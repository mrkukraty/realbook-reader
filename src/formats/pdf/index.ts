import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'; // legacy build: ships polyfills for older Safari/Firefox
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import {
  ImportError, type FixedDocument, type FormatAdapter, type PageLink, type RenderPageOptions, type Target, type TocItem,
} from '../types';
import { abortError, ascii, extOf, finalizeMeta, readBytes } from '../util';

/** Where pdf.js should load its worker from. Override (e.g. in Node tests) with configurePdf(). */
let workerSrc: string = workerUrl;
/** Base URL (ending with '/') that serves pdfjs-dist's cmaps/, standard_fonts/, wasm/, iccs/ folders. Optional. */
let assetBase: string | undefined;
try {
  const b = (import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL;
  if (typeof document !== 'undefined' && b !== undefined) assetBase = `${b.endsWith('/') ? b : b + '/'}pdfjs/`;
} catch { /* ignore */ }

export function configurePdf(opts: { workerSrc?: string; assetBase?: string | null }): void {
  if (opts.workerSrc) workerSrc = opts.workerSrc;
  if (opts.assetBase !== undefined) assetBase = opts.assetBase ?? undefined;
  sharedWorker = null;
}

let sharedWorker: pdfjs.PDFWorker | null = null;
function getWorker(): pdfjs.PDFWorker | undefined {
  pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;
  if (!sharedWorker || sharedWorker.destroyed) {
    try { sharedWorker = new pdfjs.PDFWorker(); } catch { sharedWorker = null; }
  }
  return sharedWorker ?? undefined;
}

const TEXT_CSS = `
.rb-pdf-page{position:relative;margin:0 auto;background:#fff;overflow:hidden}
.rb-pdf-page canvas{position:absolute;inset:0;display:block}
.rb-pdf-text{position:absolute;inset:0;overflow:clip;line-height:1;text-align:initial;transform-origin:0 0;
 --min-font-size:1;--text-scale-factor:calc(var(--total-scale-factor)*var(--min-font-size));--min-font-size-inv:calc(1/var(--min-font-size))}
.rb-pdf-text :is(span,br){color:transparent;position:absolute;white-space:pre;cursor:text;transform-origin:0% 0%;user-select:text;-webkit-user-select:text}
.rb-pdf-text>:not(.markedContent),.rb-pdf-text .markedContent span:not(.markedContent){--font-height:0;font-size:calc(var(--text-scale-factor)*var(--font-height));--scale-x:1;--rotate:0deg;transform:rotate(var(--rotate)) scaleX(var(--scale-x)) scale(var(--min-font-size-inv))}
.rb-pdf-text .markedContent{display:contents}
.rb-pdf-text ::selection{background:rgba(0,100,255,.3)}
.rb-pdf-text .endOfContent{display:block;position:absolute;inset:100% 0 0;user-select:none}
`;
function ensureCss(): void {
  if (typeof document === 'undefined' || document.getElementById('rb-pdf-css')) return;
  const s = document.createElement('style');
  s.id = 'rb-pdf-css';
  s.textContent = TEXT_CSS;
  document.head.appendChild(s);
}

function parsePdfDate(d?: string): string | undefined {
  const m = /^D:(\d{4})(\d{2})?(\d{2})?/.exec(d ?? '');
  if (!m) return undefined;
  return [m[1], m[2], m[3]].filter(Boolean).join('-');
}

function isNamed(e: unknown, name: string): boolean {
  return !!e && typeof e === 'object' && (e as { name?: string }).name === name;
}

type Dest = string | unknown[] | null;

export async function openPdf(data: Blob, fileName: string, onProgress?: (f: number, l?: string) => void): Promise<FixedDocument> {
  const bytes = await readBytes(data);
  if (ascii(bytes, 0, 1024).indexOf('%PDF') < 0) {
    throw new ImportError('This file is not a valid PDF (it does not start with a PDF header).', 'corrupt');
  }
  const params: Record<string, unknown> = { data: bytes, worker: getWorker(), isEvalSupported: false, enableXfa: false };
  if (assetBase) {
    params.cMapUrl = `${assetBase}cmaps/`;
    params.cMapPacked = true;
    params.standardFontDataUrl = `${assetBase}standard_fonts/`;
    params.wasmUrl = `${assetBase}wasm/`;
    params.iccUrl = `${assetBase}iccs/`;
  }
  const task = pdfjs.getDocument(params as unknown as Parameters<typeof pdfjs.getDocument>[0]);
  let doc: pdfjs.PDFDocumentProxy;
  try {
    doc = await task.promise;
  } catch (e) {
    task.destroy().catch(() => {});
    if (isNamed(e, 'PasswordException')) {
      throw new ImportError(
        'This PDF is password-protected (encrypted). Remove the password with another tool (e.g. print to PDF) and import it again.',
        'drm',
      );
    }
    if (isNamed(e, 'InvalidPDFException') || isNamed(e, 'FormatError') || isNamed(e, 'MissingPDFException')) {
      throw new ImportError('This PDF is damaged or incomplete and cannot be read.', 'corrupt');
    }
    throw new ImportError(`This PDF could not be opened: ${e instanceof Error ? e.message : String(e)}`, 'corrupt');
  }
  onProgress?.(0.2, 'Reading PDF');

  try {
    const pageCount = doc.numPages;
    if (!pageCount) throw new ImportError('This PDF has no pages.', 'corrupt');

    // metadata
    let info: Record<string, string> = {};
    try { info = ((await doc.getMetadata()).info ?? {}) as Record<string, string>; } catch { /* none */ }
    const metadata = finalizeMeta({
      title: info.Title,
      author: info.Author,
      description: info.Subject,
      publisher: undefined,
      published: parsePdfDate(info.CreationDate),
    }, fileName);

    // aspect from page 1
    const p1 = await doc.getPage(1);
    const v1 = p1.getViewport({ scale: 1 });
    const aspect = v1.width && v1.height ? v1.width / v1.height : 0.707;
    p1.cleanup();

    // text detection: sample up to 10 pages spread across the book
    const sampleCount = Math.min(10, pageCount);
    const sample = new Set<number>();
    for (let i = 0; i < sampleCount; i++) sample.add(Math.floor((i * pageCount) / sampleCount) + 1);
    let chars = 0;
    for (const n of sample) {
      try {
        const page = await doc.getPage(n);
        const tc = await page.getTextContent();
        for (const it of tc.items) chars += ('str' in it ? it.str : '').replace(/\s/g, '').length;
        page.cleanup();
      } catch { /* ignore page */ }
      if (chars > 200) break;
    }
    const hasText = chars >= 20;
    onProgress?.(0.5, 'Scanning text');

    // destinations
    const destCache = new Map<string, number | null>();
    const resolveDest = async (dest: Dest): Promise<number | null> => {
      try {
        let arr: unknown[] | null = null;
        const key = typeof dest === 'string' ? dest : null;
        if (key !== null && destCache.has(key)) return destCache.get(key)!;
        if (typeof dest === 'string') arr = await doc.getDestination(dest);
        else arr = dest;
        let result: number | null = null;
        if (arr && arr.length) {
          const ref = arr[0];
          if (typeof ref === 'number') result = ref;
          else if (ref && typeof ref === 'object') result = await doc.getPageIndex(ref as Parameters<typeof doc.getPageIndex>[0]);
        }
        if (key !== null) destCache.set(key, result);
        return result;
      } catch { return null; }
    };

    // outline -> toc
    let toc: TocItem[] = [];
    try {
      const outline = await doc.getOutline();
      let budget = 3000;
      const conv = async (items: NonNullable<typeof outline>): Promise<TocItem[]> => {
        const out: TocItem[] = [];
        for (const it of items) {
          if (budget-- <= 0) break;
          const page = it.dest ? await resolveDest(it.dest as Dest) : null;
          const children = it.items?.length ? await conv(it.items as NonNullable<typeof outline>) : [];
          const title = (it.title ?? '').replace(/\s+/g, ' ').trim();
          if (page !== null && title) out.push({ title, target: { page } as Target, children: children.length ? children : undefined });
          else out.push(...children);
        }
        return out;
      };
      if (outline) toc = await conv(outline);
    } catch { /* no outline */ }

    // cover (best effort, browser only)
    let cover: Blob | undefined;
    if (typeof document !== 'undefined' && typeof HTMLCanvasElement !== 'undefined') {
      try {
        const page = await doc.getPage(1);
        const vp = page.getViewport({ scale: 360 / v1.width });
        const canvas = document.createElement('canvas');
        canvas.width = Math.ceil(vp.width);
        canvas.height = Math.ceil(vp.height);
        await page.render({ canvas, viewport: vp }).promise;
        cover = await new Promise<Blob | undefined>((res) => canvas.toBlob((b) => res(b ?? undefined), 'image/jpeg', 0.8));
        page.cleanup();
      } catch { /* no cover */ }
    }

    let disposed = false;
    const fixed: FixedDocument = {
      kind: 'fixed',
      metadata,
      cover,
      pageCount,
      aspect,
      toc,
      hasText,
      async renderPage(index: number, host: HTMLElement, opts: RenderPageOptions): Promise<PageLink[] | void> {
        if (disposed) throw new Error('Document disposed');
        if (opts.signal.aborted) throw abortError();
        ensureCss();
        const page = await doc.getPage(index + 1);
        let renderTask: pdfjs.RenderTask | undefined;
        let textLayer: pdfjs.TextLayer | undefined;
        const onAbort = () => { renderTask?.cancel(); textLayer?.cancel(); };
        opts.signal.addEventListener('abort', onAbort, { once: true });
        try {
          if (opts.signal.aborted) throw abortError();
          const base = page.getViewport({ scale: 1 });
          const fit = Math.max(0.01, Math.min(opts.width / base.width, opts.height / base.height));
          const css = page.getViewport({ scale: fit });
          const dpr = Math.max(1, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);
          // cap backing store to ~24 megapixels
          const maxScale = Math.sqrt(24_000_000 / (css.width * css.height));
          const pxScale = Math.min(dpr, maxScale);
          const hi = page.getViewport({ scale: fit * pxScale });

          const wrap = document.createElement('div');
          wrap.className = 'rb-pdf-page';
          wrap.style.width = `${css.width}px`;
          wrap.style.height = `${css.height}px`;
          const canvas = document.createElement('canvas');
          canvas.width = Math.ceil(hi.width);
          canvas.height = Math.ceil(hi.height);
          canvas.style.width = `${css.width}px`;
          canvas.style.height = `${css.height}px`;
          wrap.appendChild(canvas);

          renderTask = page.render({ canvas, viewport: hi });
          try {
            await renderTask.promise;
          } catch (e) {
            if (isNamed(e, 'RenderingCancelledException') || opts.signal.aborted) throw abortError();
            throw e;
          }
          if (opts.signal.aborted) throw abortError();

          if (hasText) {
            const tdiv = document.createElement('div');
            tdiv.className = 'rb-pdf-text';
            tdiv.style.setProperty('--total-scale-factor', String(fit));
            tdiv.style.setProperty('--scale-round-x', '1px');
            tdiv.style.setProperty('--scale-round-y', '1px');
            wrap.appendChild(tdiv);
            try {
              textLayer = new pdfjs.TextLayer({ textContentSource: page.streamTextContent(), container: tdiv, viewport: css });
              await textLayer.render();
            } catch (e) {
              if (opts.signal.aborted) throw abortError();
              tdiv.remove(); // text layer is optional
            }
            if (opts.signal.aborted) throw abortError();
          }

          // links
          const links: PageLink[] = [];
          try {
            const annots = await page.getAnnotations({ intent: 'display' });
            for (const a of annots as Array<Record<string, any>>) {
              if (a.subtype !== 'Link' || !a.rect) continue;
              const r0 = a.rect as number[];
              const [x1, y1] = css.convertToViewportPoint(r0[0], r0[1]) as number[];
              const [x2, y2] = css.convertToViewportPoint(r0[2], r0[3]) as number[];
              const x = Math.min(x1, x2) / css.width;
              const y = Math.min(y1, y2) / css.height;
              const w = Math.abs(x2 - x1) / css.width;
              const h = Math.abs(y2 - y1) / css.height;
              const rect: [number, number, number, number] = [x, y, w, h];
              const url: string | undefined = a.url || a.unsafeUrl;
              if (url) links.push({ rect, url });
              else if (a.dest) {
                const pg = await resolveDest(a.dest as Dest);
                if (pg !== null) links.push({ rect, target: { page: pg } });
              }
            }
          } catch { /* links optional */ }

          if (opts.signal.aborted) throw abortError();
          host.replaceChildren(wrap);
          return links;
        } finally {
          opts.signal.removeEventListener('abort', onAbort);
          try { page.cleanup(); } catch { /* ignore */ }
        }
      },
      async getPageText(index: number): Promise<string> {
        const page = await doc.getPage(index + 1);
        try {
          const tc = await page.getTextContent();
          let s = '';
          for (const it of tc.items) {
            if (!('str' in it)) continue;
            s += it.str + (it.hasEOL ? '\n' : '');
          }
          return s.replace(/[ \t]+\n/g, '\n').trim();
        } finally {
          page.cleanup();
        }
      },
      dispose() {
        if (disposed) return;
        disposed = true;
        task.destroy().catch(() => {});
      },
    };
    onProgress?.(1);
    return fixed;
  } catch (e) {
    task.destroy().catch(() => {});
    throw e;
  }
}

export const pdfAdapter: FormatAdapter = {
  id: 'pdf',
  label: 'PDF',
  extensions: ['pdf'],
  detect(head, fileName) {
    return ascii(head, 0, 1024).includes('%PDF') || extOf(fileName) === 'pdf';
  },
  async open(data, fileName, onProgress) {
    try {
      return await openPdf(data, fileName, onProgress);
    } catch (e) {
      if (e instanceof ImportError) throw e;
      throw new ImportError(`This PDF could not be read: ${e instanceof Error ? e.message : String(e)}`, 'corrupt');
    }
  },
};
