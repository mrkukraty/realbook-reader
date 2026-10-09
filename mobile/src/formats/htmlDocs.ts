// HTML + Markdown (+ shared section splitting)
import { marked } from 'marked';
import { isTag, type ChildNode, type Element } from 'domhandler';
import { ImportError, type ReflowDocument, type ReflowSection, type Target, type TocItem } from './types';
import { decodeText, finalizeMeta, wrapError } from './util';
import { attr, bodyNodes, chunkNodes, findAll, findFirst, parseHtml, textOf } from './markup';

export function sectionsFromNodes(nodes: ChildNode[]): { sections: ReflowSection[]; toc: TocItem[] } {
  const isHead = (n: ChildNode): n is Element => isTag(n) && /^h[12]$/.test(n.name);
  const hasHeadings = nodes.some(isHead);
  interface G { title?: string; level?: number; nodes: ChildNode[] }
  const groups: G[] = [];
  if (hasHeadings) {
    let cur: G = { nodes: [] };
    for (const n of nodes) {
      if (isHead(n)) {
        if (cur.nodes.length) groups.push(cur);
        cur = { title: textOf(n), level: Number(n.name[1]), nodes: [] };
      }
      cur.nodes.push(n);
    }
    if (cur.nodes.length) groups.push(cur);
  } else groups.push({ nodes });

  const anchors = new Map<string, number>();
  const raw: { html: string; title?: string; level?: number }[] = [];
  for (const g of groups) {
    const chunks = chunkNodes(g.nodes, {
      imageSrc: (s) => (s.startsWith('data:image/') ? s : null),
      link: (href) => {
        if (href.startsWith('#')) return { kind: 'path', path: '', frag: href.slice(1) };
        if (/^(https?:|mailto:)/i.test(href)) return { kind: 'external', url: href };
        return { kind: 'drop' };
      },
    });
    chunks.forEach((c, i) => {
      const idx = raw.length;
      for (const id of c.ids) if (!anchors.has(id)) anchors.set(id, idx);
      raw.push({ html: c.html, title: i === 0 ? g.title : undefined, level: g.level });
    });
  }
  const sections: ReflowSection[] = [];
  const toc: TocItem[] = [];
  let lastTop: TocItem | undefined;
  const unesc = (s: string) => s.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  raw.forEach((r, i) => {
    const html = r.html.replace(/data-lp="[^"]*" data-lf="([^"]*)"/g, (_m, f: string) => {
      const sec = anchors.get(unesc(f));
      return sec === undefined ? 'data-sec="" data-anchor=""' : `data-sec="${sec}" data-anchor="${f}"`;
    });
    sections.push({ id: `s${i}`, title: r.title, html });
    if (r.title) {
      const item: TocItem = { title: r.title, target: { section: i } as Target };
      if (r.level === 2 && lastTop) (lastTop.children ??= []).push(item);
      else { toc.push(item); if (r.level === 1) lastTop = item; }
    }
  });
  if (sections.length === 0) sections.push({ id: 's0', html: '<p></p>' });
  return { sections, toc };
}

export function openHtml(data: Uint8Array, fileName: string): ReflowDocument {
  try {
    const text = decodeText(data);
    if (!text.trim()) throw new ImportError('This HTML file is empty.', 'corrupt');
    const doc = parseHtml(text);
    const { sections, toc } = sectionsFromNodes(bodyNodes(doc));
    const title = textOf(findFirst(doc, 'title')) || textOf(findFirst(doc, 'h1'));
    const metaOf = (n: string) => {
      const m = findAll(doc, 'meta').find((e) => (attr(e, 'name') ?? '').toLowerCase() === n);
      return m ? attr(m, 'content') : undefined;
    };
    const html = findFirst(doc, 'html');
    return {
      kind: 'reflow',
      metadata: finalizeMeta({ title, author: metaOf('author'), description: metaOf('description'), language: html ? attr(html, 'lang') : undefined }, fileName),
      sections, toc,
    };
  } catch (e) {
    throw wrapError(e, 'HTML');
  }
}

function slug(s: string): string {
  return s.toLowerCase().replace(/<[^>]*>/g, '').replace(/[^\p{L}\p{N}\s-]/gu, '').trim().replace(/\s+/g, '-');
}

export function openMarkdown(data: Uint8Array, fileName: string): ReflowDocument {
  try {
    let text = decodeText(data);
    if (!text.trim()) throw new ImportError('This Markdown file is empty.', 'corrupt');
    const fm: Record<string, string> = {};
    const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(text);
    if (m) {
      for (const line of m[1].split(/\r?\n/)) {
        const kv = /^(\w+):\s*(.+)$/.exec(line);
        if (kv) fm[kv[1].toLowerCase()] = kv[2].replace(/^["']|["']$/g, '').trim();
      }
      text = text.slice(m[0].length);
    }
    let html = marked.parse(text, { async: false, gfm: true }) as string;
    const used = new Set<string>();
    html = html.replace(/<h([1-6])>([\s\S]*?)<\/h\1>/g, (_all, lvl: string, inner: string) => {
      const base = slug(inner) || 'section';
      let id = base;
      for (let i = 2; used.has(id); i++) id = `${base}-${i}`;
      used.add(id);
      return `<h${lvl} id="${id}">${inner}</h${lvl}>`;
    });
    const doc = parseHtml(html);
    const { sections, toc } = sectionsFromNodes(bodyNodes(doc));
    const title = fm.title ?? (textOf(findFirst(doc, 'h1')) || undefined);
    return {
      kind: 'reflow',
      metadata: finalizeMeta({ title, author: fm.author, language: fm.language ?? fm.lang, description: fm.description }, fileName),
      sections, toc,
    };
  } catch (e) {
    throw wrapError(e, 'Markdown');
  }
}
