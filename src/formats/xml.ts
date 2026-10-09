import { ImportError } from './types';

export function parseXml(text: string, what = 'XML'): Document {
  const doc = new DOMParser().parseFromString(text.replace(/^﻿/, ''), 'application/xml');
  if (doc.getElementsByTagName('parsererror').length > 0 || !doc.documentElement) {
    throw new ImportError(`This file contains malformed ${what} and cannot be read.`, 'corrupt');
  }
  return doc;
}

export function tryParseXml(text: string): Document | null {
  try { return parseXml(text); } catch { return null; }
}

/** Direct element children with the given local name (namespace-agnostic). */
export function kids(el: Element | Document | null | undefined, local?: string): Element[] {
  if (!el) return [];
  const out: Element[] = [];
  for (const c of Array.from(el.children)) if (!local || c.localName === local) out.push(c);
  return out;
}

export function kid(el: Element | null | undefined, local: string): Element | undefined {
  return kids(el, local)[0];
}

/** All descendant elements with the given local name. */
export function all(el: Element | Document, local: string): Element[] {
  return Array.from(el.getElementsByTagName('*')).filter((e) => e.localName === local);
}

export function textOf(el: Element | null | undefined): string {
  return (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
}

export function stripTags(s: string): string {
  return s.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();
}
