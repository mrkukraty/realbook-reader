// Types kept compatible with the web app (../src/formats/types.ts), adapted to bytes (no Blob/DOM on RN).
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
  /** Sanitized HTML (no scripts/handlers). Images are data: URIs. Internal links: <a href="#" data-sec="N" data-anchor="id"> */
  html: string;
}

export interface ReflowDocument {
  kind: 'reflow';
  metadata: BookMetadata;
  /** cover image bytes + mime */
  cover?: { bytes: Uint8Array; mime: string };
  sections: ReflowSection[];
  toc: TocItem[];
}

/** Fixed layout (comics, PDF). For CBZ pages are image entries in the archive; PDF is rendered by the reader. */
export interface FixedDocument {
  kind: 'fixed';
  metadata: BookMetadata;
  cover?: { bytes: Uint8Array; mime: string };
  pageCount: number;
  aspect: number;
  toc: TocItem[];
  hasText: boolean;
  /** CBZ: ordered image paths inside the archive. PDF: undefined */
  imagePaths?: string[];
}

export type BookDocument = ReflowDocument | FixedDocument;

export type ProgressCb = (fraction: number, label?: string) => void;

export type ImportErrorCode = 'corrupt' | 'unsupported' | 'drm' | 'too-large' | 'unknown';
export class ImportError extends Error {
  code: ImportErrorCode;
  constructor(message: string, code: ImportErrorCode = 'corrupt') {
    super(message);
    this.name = 'ImportError';
    this.code = code;
  }
}

export type Detection =
  | { status: 'supported'; format: FormatId }
  | { status: 'unsupported'; format: FormatId; label: string; message: string }
  | { status: 'unknown'; message: string };
