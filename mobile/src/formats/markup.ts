// DOM-less HTML/XML handling (htmlparser2) + allow-list sanitizer. React Native has no DOMParser.
import { parseDocument } from 'htmlparser2';
import { isTag, isText, type ChildNode, type Document, type Element } from 'domhandler';
import { escapeHtml } from './util';

export function parseHtml(text: string): Document {
  return parseDocument(text, { decodeEntities: true, lowerCaseTags: true, lowerCaseAttributeNames: true });
}
export function parseXmlDoc(text: string): Document {
  return parseDocument(text, { xmlMode: true, decodeEntities: true });
}

const localName = (e: Element) => e.name.replace(/^.*:/, '').toLowerCase();

export function walk(nodes: ChildNode[], fn: (e: Element) => void): void {
  for (const n of nodes) {
    if (isTag(n)) {
      fn(n);
      walk(n.children as ChildNode[], fn);
    }
  }
}
export function findAll(root: Document | Element, name: string): Element[] {
  const out: Element[] = [];
  const lc = name.toLowerCase();
  walk(root.children as ChildNode[], (e) => { if (localName(e) === lc) out.push(e); });
  return out;
}
export function findFirst(root: Document | Element | undefined, name: string): Element | undefined {
  if (!root) return undefined;
  return findAll(root, name)[0];
}
export function childEls(e: Element | Document | undefined, name?: string): Element[] {
  if (!e) return [];
  return (e.children as ChildNode[]).filter(isTag).filter((c) => !name || localName(c) === name.toLowerCase());
}
export function textContent(n: ChildNode | Document | undefined): string {
  if (!n) return '';
  if (isText(n)) return n.data;
  const kids = (n as Element).children as ChildNode[] | undefined;
  if (!kids) return '';
  if (isTag(n as ChildNode) && /^(script|style)$/i.test((n as Element).name)) return '';
  return kids.map((k) => textContent(k)).join('');
}
export function textOf(n: Element | Document | undefined): string {
  return textContent(n).replace(/\s+/g, ' ').trim();
}
export function attr(e: Element, name: string): string | undefined {
  if (name in e.attribs) return e.attribs[name];
  const lc = name.toLowerCase();
  for (const k of Object.keys(e.attribs)) if (k.toLowerCase() === lc || k.replace(/^.*:/, '').toLowerCase() === lc) return e.attribs[k];
  return undefined;
}
export function stripTags(s: string): string {
  return s.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

const ALLOWED = new Set([
  'p', 'div', 'span', 'br', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'pre', 'code', 'em', 'i', 'strong', 'b', 'u', 's',
  'strike', 'del', 'ins', 'sub', 'sup', 'small', 'big', 'mark', 'cite', 'q', 'abbr', 'ul', 'ol', 'li', 'dl', 'dt', 'dd', 'table', 'thead',
  'tbody', 'tfoot', 'tr', 'td', 'th', 'caption', 'colgroup', 'col', 'a', 'img', 'figure', 'figcaption', 'section', 'article', 'aside', 'header',
  'footer', 'nav', 'main', 'center', 'font', 'ruby', 'rt', 'rp', 'details', 'summary',
]);
const DROP_WITH_CONTENT = new Set(['script', 'style', 'iframe', 'object', 'embed', 'applet', 'form', 'noscript', 'template', 'svg', 'math', 'audio', 'video', 'canvas', 'head', 'title', 'link', 'meta', 'base', 'input', 'button', 'select', 'textarea']);
const VOID = new Set(['br', 'hr', 'img', 'col']);

export type LinkRewrite =
  | { kind: 'path'; path: string; frag?: string }
  | { kind: 'internal'; section: number; anchor?: string }
  | { kind: 'external'; url: string }
  | { kind: 'drop' };

export interface SanitizeOptions {
  /** Return a safe (data:) URL for an <img src>, or null to drop the image. */
  imageSrc?: (src: string) => string | null;
  link?: (href: string) => LinkRewrite;
}

const SAFE_EXT = /^(https?:|mailto:)/i;

function ser(nodes: ChildNode[], o: SanitizeOptions, out: string[]): void {
  for (const n of nodes) {
    if (isText(n)) { out.push(escapeHtml(n.data).replace(/"/g, '&quot;')); continue; }
    if (!isTag(n)) continue;
    const name = localName(n);
    if (DROP_WITH_CONTENT.has(name)) continue;
    const id = attr(n, 'id') ?? (name === 'a' ? attr(n, 'name') : undefined);
    const idAttr = id ? ` id="${escapeHtml(id)}"` : '';
    if (name === 'img' || name === 'image') {
      const src = attr(n, 'src') ?? attr(n, 'href');
      const url = src && o.imageSrc ? o.imageSrc(src) : null;
      if (url) out.push(`<img${idAttr} src="${url}" alt="${escapeHtml(attr(n, 'alt') ?? '')}">`);
      continue;
    }
    if (name === 'a') {
      const href = attr(n, 'href');
      let open = `<a${idAttr}`;
      const ds = attr(n, 'data-sec');
      if (href === '#' && ds !== undefined && /^\d{1,6}$/.test(ds)) {
        open += ` href="#" data-sec="${ds}" data-anchor="${escapeHtml(attr(n, 'data-anchor') ?? '')}"`;
      } else if (href !== undefined) {
        const r: LinkRewrite = o.link ? o.link(href) : SAFE_EXT.test(href) ? { kind: 'external', url: href } : { kind: 'drop' };
        if (r.kind === 'path') open += ` href="#" data-lp="${escapeHtml(r.path)}" data-lf="${escapeHtml(r.frag ?? '')}"`;
        else if (r.kind === 'internal') open += ` href="#" data-sec="${r.section}" data-anchor="${escapeHtml(r.anchor ?? '')}"`;
        else if (r.kind === 'external' && SAFE_EXT.test(r.url)) open += ` href="#" data-ext="${escapeHtml(r.url)}"`;
      }
      out.push(open + '>');
      ser(n.children as ChildNode[], o, out);
      out.push('</a>');
      continue;
    }
    if (!ALLOWED.has(name)) { ser(n.children as ChildNode[], o, out); continue; }
    let extra = '';
    if (name === 'td' || name === 'th') {
      const cs = attr(n, 'colspan'); const rs = attr(n, 'rowspan');
      if (cs && /^\d{1,3}$/.test(cs)) extra += ` colspan="${cs}"`;
      if (rs && /^\d{1,3}$/.test(rs)) extra += ` rowspan="${rs}"`;
    }
    const cls = attr(n, 'class');
    if (cls && /\b(poem|author|epigraph)\b/.test(cls)) extra += ` class="${escapeHtml(cls.match(/\b(poem|author|epigraph)\b/)![1])}"`;
    if (VOID.has(name)) { out.push(`<${name}${idAttr}${extra}>`); continue; }
    out.push(`<${name}${idAttr}${extra}>`);
    ser(n.children as ChildNode[], o, out);
    out.push(`</${name}>`);
  }
}

export function sanitizeNodes(nodes: ChildNode[], o: SanitizeOptions = {}): string {
  const out: string[] = [];
  ser(nodes, o, out);
  return out.join('');
}

/** Sanitize an HTML string end to end (parse -> allow-list serialize). */
export function sanitizeHtmlString(html: string, o: SanitizeOptions = {}): string {
  const doc = parseHtml(html);
  const body = findFirst(doc, 'body');
  return sanitizeNodes(((body ?? doc).children as ChildNode[]), o);
}

export function bodyNodes(doc: Document): ChildNode[] {
  const body = findFirst(doc, 'body');
  return (body ?? doc).children as ChildNode[];
}

export interface Chunk { html: string; chars: number; ids: string[] }

/** Serialize top-level nodes one at a time and group into chunks <= maxChars of text (splitting only at top level). */
export function chunkNodes(nodes: ChildNode[], o: SanitizeOptions, maxChars = 60_000): Chunk[] {
  const chunks: Chunk[] = [];
  let cur: Chunk = { html: '', chars: 0, ids: [] };
  const push = () => { if (cur.html) chunks.push(cur); cur = { html: '', chars: 0, ids: [] }; };
  for (const n of nodes) {
    const h = sanitizeNodes([n], o);
    if (!h.trim()) continue;
    // oversized wrapper (<div> around the whole chapter): descend so we can still split
    if (isTag(n) && h.length > maxChars * 1.5 && /^(div|section|article|main|body|blockquote)$/.test(localName(n)) && n.children.length > 1) {
      const sub = chunkNodes(n.children as ChildNode[], o, maxChars);
      for (const s of sub) {
        if (cur.html && cur.chars + s.chars > maxChars) push();
        cur.html += s.html; cur.chars += s.chars; cur.ids.push(...s.ids);
      }
      continue;
    }
    const chars = h.replace(/<[^>]*>/g, '').length;
    if (cur.html && cur.chars + chars > maxChars) push();
    cur.html += h;
    cur.chars += chars;
    const re = / id="([^"]*)"/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(h))) cur.ids.push(m[1].replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'));
  }
  push();
  return chunks;
}
