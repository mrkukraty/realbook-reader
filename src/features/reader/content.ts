import type { ReactNode } from 'react';
import type { Target } from '../../formats/types';
import type { Snippet } from '../search/snippets';

export interface Chapter { page: number; title: string; depth: number }
export interface Anchor { section?: number; sectionFraction?: number; page?: number }
export interface SavedPosition extends Anchor { fraction: number }

export interface SearchHit {
  id: string;
  label: string;
  snippet: Snippet;
  ref: { chunk: number; start: number; length: number } | { page: number };
}

export interface SearchOptions {
  signal: AbortSignal;
  onProgress: (fraction: number) => void;
  onResults: (batch: SearchHit[]) => void;
  max?: number;
}

/** Common surface the reader UI uses for reflow and fixed documents. */
export interface ReaderContent {
  readonly kind: 'reflow' | 'fixed';
  subscribe: (cb: () => void) => () => void;
  getVersion: () => number;
  /** false until the first visible page can be shown */
  readonly ready: boolean;
  /** all page counts known */
  readonly complete: boolean;
  /** pagination progress 0..1 */
  readonly progress: number;
  readonly pageCount: number;
  readonly pageIndex: number;
  readonly chapters: Chapter[];
  readonly hasText: boolean;
  renderPage(index: number): ReactNode;
  setPageIndex(index: number): void;
  savedPosition(): SavedPosition;
  anchorAt(index: number): Anchor;
  indexOfAnchor(a: Anchor): number | undefined;
  resolveTarget(t: Target): Promise<number | undefined>;
  chapterAt(index: number): string;
  fractionAt(index: number): number;
  search(query: string, opts: SearchOptions): Promise<void>;
  resolveHit(hit: SearchHit): Promise<number | undefined>;
  clearHit(): void;
  dispose(): void;
}

export class Emitter {
  private listeners = new Set<() => void>();
  protected version = 0;
  subscribe = (cb: () => void) => { this.listeners.add(cb); return () => { this.listeners.delete(cb); }; };
  getVersion = () => this.version;
  protected emit() { this.version++; this.listeners.forEach((l) => l()); }
}
