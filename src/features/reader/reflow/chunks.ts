import type { ReflowDocument } from '../../../formats/types';

export interface Chunk {
  index: number;
  section: number;
  html: string;
  text: string;
  textStart: number; // offset in the doc section's textContent
  textLen: number;
  ids: string[];
}

export interface ChunkSet { chunks: Chunk[]; sectionChunks: number[][] }

const REMOVE = 'script,iframe,object,embed,link,meta,base,style,noscript,applet,frame,frameset,foreignObject';

/** Defensive re-sanitize (formats already sanitize). Mutates the tree. Never executes anything. */
export function sanitizeTree(root: ParentNode) {
  root.querySelectorAll(REMOVE).forEach((n) => n.remove());
  root.querySelectorAll('*').forEach((el) => {
    for (const a of Array.from(el.attributes)) {
      const name = a.name.toLowerCase();
      const v = a.value.trim().toLowerCase();
      if (name.startsWith('on') || name === 'srcdoc') el.removeAttribute(a.name);
      else if ((name === 'href' || name === 'xlink:href' || name === 'src') && /^(javascript|vbscript):/.test(v)) el.removeAttribute(a.name);
      else if (name === 'src' && !/^(blob:|data:)/.test(v)) el.removeAttribute(a.name);
      else if (name === 'style' && /(expression\(|javascript:|position\s*:\s*fixed)/.test(v)) el.removeAttribute(a.name);
    }
  });
  root.querySelectorAll('a[href]').forEach((a) => {
    const href = a.getAttribute('href') || '';
    if (a.hasAttribute('data-sec')) return;
    if (/^(https?:|mailto:)/i.test(href)) { a.setAttribute('target', '_blank'); a.setAttribute('rel', 'noopener noreferrer'); }
    else if (href !== '#') a.removeAttribute('href');
  });
}

function serialize(n: Node): string {
  if (n.nodeType === 1) return (n as Element).outerHTML;
  if (n.nodeType === 3) {
    const d = document.createElement('div');
    d.textContent = n.textContent;
    return d.innerHTML;
  }
  return '';
}

function hasContent(frag: ParentNode, text: string): boolean {
  return text.trim().length > 0 || !!frag.querySelector('img,svg,hr,video,canvas,table');
}

export const SPLIT_TEXT = 40000;

export function buildChunks(doc: Pick<ReflowDocument, 'sections'>, splitAt = SPLIT_TEXT): ChunkSet {
  const chunks: Chunk[] = [];
  const sectionChunks: number[][] = [];
  const parser = new DOMParser();
  doc.sections.forEach((sec, si) => {
    sectionChunks[si] = [];
    const parsed = parser.parseFromString(`<!doctype html><body>${sec.html}</body>`, 'text/html');
    sanitizeTree(parsed.body);
    const nodes = Array.from(parsed.body.childNodes);
    const total = parsed.body.textContent?.length ?? 0;
    const groups: Node[][] = [];
    if (total <= splitAt || nodes.length < 2) groups.push(nodes);
    else {
      let cur: Node[] = [], len = 0;
      for (const n of nodes) {
        const l = n.textContent?.length ?? 0;
        if (len > 0 && len + l > splitAt) { groups.push(cur); cur = []; len = 0; }
        cur.push(n); len += l;
      }
      if (cur.length) groups.push(cur);
    }
    let start = 0;
    for (const g of groups) {
      const holder = parsed.createElement('div');
      g.forEach((n) => holder.appendChild(n.cloneNode(true)));
      const text = holder.textContent ?? '';
      const len = text.length;
      if (hasContent(holder, text)) {
        const idx = chunks.length;
        const ids: string[] = [];
        holder.querySelectorAll('[id],a[name]').forEach((e) => { const v = e.getAttribute('id') || e.getAttribute('name'); if (v) ids.push(v); });
        chunks.push({ index: idx, section: si, html: g.map(serialize).join(''), text, textStart: start, textLen: len, ids });
        sectionChunks[si].push(idx);
      }
      start += len;
    }
  });
  return { chunks, sectionChunks };
}
