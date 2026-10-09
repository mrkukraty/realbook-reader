import DOMPurify from 'dompurify';

export const MAX_SECTION_CHARS = 120_000;

const FORBID_TAGS = [
  'script', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'form', 'input', 'button',
  'textarea', 'select', 'option', 'style', 'link', 'meta', 'base', 'noscript', 'audio', 'video',
  'source', 'track', 'foreignObject', 'title', 'template',
];
const FORBID_ATTR = ['style', 'srcset', 'formaction', 'action', 'ping'];

// default DOMPurify URI regexp + blob: (data: on non-image tags stays blocked by DOMPurify itself)
const ALLOWED_URI = /^(?:(?:https?|mailto|tel|blob):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i;

/** Sanitize an HTML string or fragment. Returns body-level HTML (no html/head/body wrappers). */
export function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true, svg: true },
    FORBID_TAGS,
    FORBID_ATTR,
    ALLOWED_URI_REGEXP: ALLOWED_URI,
    ALLOW_DATA_ATTR: true,
    ALLOW_UNKNOWN_PROTOCOLS: false,
    KEEP_CONTENT: true,
  }) as unknown as string;
}

/** Parse an HTML string into a detached container element belonging to an HTML document. */
export function parseHtmlBody(html: string): HTMLElement {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const holder = document.implementation.createHTMLDocument('');
  const div = holder.createElement('div');
  // importNode copies (it does not move), so iterate a snapshot rather than looping on firstChild
  for (const n of Array.from(doc.body.childNodes)) div.appendChild(holder.importNode(n, true));
  return div;
}

/** Parse XHTML (falls back to tolerant HTML parsing when not well-formed) into a container element. */
export function parseXhtmlBody(text: string): HTMLElement {
  const holder = document.implementation.createHTMLDocument('');
  const div = holder.createElement('div');
  const xml = new DOMParser().parseFromString(text, 'application/xhtml+xml');
  const bad = xml.getElementsByTagName('parsererror').length > 0;
  const body = !bad ? Array.from(xml.getElementsByTagName('body'))[0] : undefined;
  if (body) {
    for (const n of Array.from(body.childNodes)) div.appendChild(holder.importNode(n, true));
    return div;
  }
  return parseHtmlBody(text);
}

function nodeSize(n: Node): number {
  if (n.nodeType === 1) return (n as Element).outerHTML.length;
  return (n.textContent ?? '').length;
}

const WRAPPERS = new Set(['DIV', 'SECTION', 'ARTICLE', 'MAIN', 'BODY']);

/** Split container children into groups, each group roughly <= max chars (split on top-level block boundaries). */
export function splitChildren(container: Element, max = MAX_SECTION_CHARS): Node[][] {
  // unwrap single huge wrapper elements so there are blocks to split on
  for (let guard = 0; guard < 6; guard++) {
    const kids = Array.from(container.childNodes).filter((n) => n.nodeType === 1 || (n.textContent ?? '').trim());
    if (kids.length !== 1 || kids[0].nodeType !== 1) break;
    const only = kids[0] as Element;
    if (!WRAPPERS.has(only.tagName) || only.children.length < 2 || only.outerHTML.length <= max) break;
    const frag = container.ownerDocument.createDocumentFragment();
    if (only.id) {
      const a = container.ownerDocument.createElement('a');
      a.id = only.id;
      frag.appendChild(a);
    }
    while (only.firstChild) frag.appendChild(only.firstChild);
    container.replaceChildren(frag);
  }
  const groups: Node[][] = [];
  let cur: Node[] = [];
  let size = 0;
  for (const n of Array.from(container.childNodes)) {
    const s = nodeSize(n);
    if (cur.length && size + s > max) {
      groups.push(cur);
      cur = [];
      size = 0;
    }
    cur.push(n);
    size += s;
  }
  if (cur.length) groups.push(cur);
  return groups.length ? groups : [[]];
}

export function serializeNodes(nodes: Node[]): string {
  const div = document.createElement('div');
  for (const n of nodes) div.appendChild(n.cloneNode(true));
  return div.innerHTML;
}

/** Split an HTML string larger than ~120k chars at top-level block boundaries. Small input returns [html]. */
export function splitLargeSection(html: string, max = MAX_SECTION_CHARS): string[] {
  if (html.length <= max) return [html];
  const container = parseHtmlBody(html);
  const groups = splitChildren(container, max);
  return groups.map((g) => serializeNodes(g));
}

/** Remove remote (http/https/protocol-relative) images: no network access or tracking from imported books. */
export function dropRemoteImages(root: Element): void {
  for (const img of Array.from(root.querySelectorAll('img'))) {
    const src = img.getAttribute('src') ?? '';
    if (/^(https?:)?\/\//i.test(src) || (!src.startsWith('data:') && !src.startsWith('blob:'))) {
      const alt = img.getAttribute('alt');
      if (alt) img.replaceWith(root.ownerDocument.createTextNode(`[${alt}]`));
      else img.remove();
    }
  }
}

/**
 * For single-document formats (html / markdown / docx): rewrite in-document `#id` links to the reader's
 * `<a href="#" data-sec data-anchor>` scheme, given the containers (one per section, in order).
 */
export function rewriteAnchorLinks(containers: Element[]): void {
  const idToSec = new Map<string, number>();
  containers.forEach((c, i) => {
    for (const el of Array.from(c.querySelectorAll('[id]'))) if (!idToSec.has(el.id)) idToSec.set(el.id, i);
  });
  containers.forEach((c) => {
    for (const a of Array.from(c.querySelectorAll('a[href]'))) {
      const href = a.getAttribute('href') ?? '';
      if (!href.startsWith('#')) continue;
      let id = href.slice(1);
      try { id = decodeURIComponent(id); } catch { /* keep */ }
      const sec = idToSec.get(id);
      if (sec === undefined) {
        a.removeAttribute('href');
        continue;
      }
      a.setAttribute('href', '#');
      a.setAttribute('data-sec', String(sec));
      a.setAttribute('data-anchor', id);
    }
  });
}
