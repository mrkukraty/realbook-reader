// Shared contract between format adapters (src/formats/*) and the reader (src/features/reader/*).
export type FormatId =
  | 'epub' | 'pdf' | 'txt' | 'html' | 'markdown' | 'fb2' | 'docx' | 'rtf' | 'cbz'
  | 'cbr' | 'mobi' | 'azw' | 'djvu';

export interface BookMetadata {
  title: string;
  author?: string;
  language?: string;
  publisher?: string;
  published?: string;
  description?: string;
}

/** Location inside a book. Reflowable books use section(+anchor); fixed-layout use page (0-based). */
export type Target = { section: number; anchor?: string } | { page: number };

export interface TocItem { title: string; target: Target; children?: TocItem[] }

export interface ReflowSection {
  id: string;
  title?: string;
  /** Already sanitized (no scripts, no event handlers). Images use blob:/data: URLs.
   *  Internal links are rewritten to <a href="#" data-sec="N" data-anchor="id">. Anchors keep their id attribute. */
  html: string;
}

export interface ReflowDocument {
  kind: 'reflow';
  metadata: BookMetadata;
  cover?: Blob;
  sections: ReflowSection[];
  toc: TocItem[];
  /** Revoke blob URLs etc. */
  dispose(): void;
}

export interface RenderPageOptions { width: number; height: number; signal: AbortSignal }
/** rect fractions 0..1 of the page: x, y, w, h */
export interface PageLink { rect: [number, number, number, number]; url?: string; target?: Target }

export interface FixedDocument {
  kind: 'fixed';
  metadata: BookMetadata;
  cover?: Blob;
  pageCount: number;
  /** width/height of the first page; the reader sizes page boxes with this */
  aspect: number;
  toc: TocItem[];
  /** true only if a real text layer exists (PDF with text, never for scans/comics) */
  hasText: boolean;
  /** Draw page `index` into host (replaces host children). Must honour signal (abort => stop, throw AbortError). */
  renderPage(index: number, host: HTMLElement, opts: RenderPageOptions): Promise<PageLink[] | void>;
  getPageText(index: number): Promise<string>;
  dispose(): void;
}

export type BookDocument = ReflowDocument | FixedDocument;

export type ProgressCb = (fraction: number, label?: string) => void;

export interface FormatAdapter {
  id: FormatId;
  label: string;
  extensions: string[];
  /** Cheap sniff on first bytes + filename. */
  detect(head: Uint8Array, fileName: string): boolean;
  /** Fully parse. Must throw ImportError with a friendly message on corrupt input. */
  open(data: Blob, fileName: string, onProgress?: ProgressCb): Promise<BookDocument>;
}

export class ImportError extends Error {
  code: 'corrupt' | 'unsupported' | 'drm' | 'too-large' | 'unknown';
  constructor(message: string, code: 'corrupt' | 'unsupported' | 'drm' | 'too-large' | 'unknown' = 'corrupt') {
    super(message);
    this.name = 'ImportError';
    this.code = code;
  }
}

export type Detection =
  | { status: 'supported'; adapter: FormatAdapter }
  | { status: 'unsupported'; format: FormatId; label: string; message: string }
  | { status: 'unknown'; message: string };
