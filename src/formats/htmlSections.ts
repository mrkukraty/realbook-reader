import type { ReflowSection, Target, TocItem } from './types';
import { dropRemoteImages, rewriteAnchorLinks, sanitizeHtml, splitChildren } from './sanitize';

/**
 * Split a parsed document body into sections at h1/h2 headings (size-split as well), rewrite internal links,
 * sanitize, and build a TOC from the headings.
 */
export function sectionsFromContainer(root: HTMLElement, opts: { dropImages?: boolean } = {}): { sections: ReflowSection[]; toc: TocItem[] } {
  if (opts.dropImages) dropRemoteImages(root);
  const doc = root.ownerDocument;
  const hasHeadings = !!root.querySelector(':scope > h1, :scope > h2');
  const groups: { title?: string; level?: number; nodes: Node[] }[] = [];
  if (hasHeadings) {
    let cur: { title?: string; level?: number; nodes: Node[] } = { nodes: [] };
    for (const n of Array.from(root.childNodes)) {
      if (n.nodeType === 1 && /^H[12]$/.test((n as Element).tagName)) {
        if (cur.nodes.length) groups.push(cur);
        cur = { title: (n.textContent ?? '').replace(/\s+/g, ' ').trim(), level: Number((n as Element).tagName[1]), nodes: [] };
      }
      cur.nodes.push(n);
    }
    if (cur.nodes.length) groups.push(cur);
  } else {
    groups.push({ nodes: Array.from(root.childNodes) });
  }
  // size splitting
  const finalGroups: { title?: string; level?: number; nodes: Node[]; first: boolean }[] = [];
  for (const g of groups) {
    const tmp = doc.createElement('div');
    for (const n of g.nodes) tmp.appendChild(n);
    const parts = splitChildren(tmp);
    parts.forEach((p, i) => finalGroups.push({ title: i === 0 ? g.title : undefined, level: g.level, nodes: p, first: i === 0 }));
  }
  const containers = finalGroups.map((g) => {
    const d = doc.createElement('div');
    for (const n of g.nodes) d.appendChild(n);
    return d;
  });
  rewriteAnchorLinks(containers);
  const sections: ReflowSection[] = [];
  const toc: TocItem[] = [];
  let lastTop: TocItem | undefined;
  containers.forEach((c, i) => {
    const g = finalGroups[i];
    sections.push({ id: `s${i}`, title: g.title, html: sanitizeHtml(c.innerHTML) });
    if (g.title) {
      const item: TocItem = { title: g.title, target: { section: i } as Target };
      if (g.level === 2 && lastTop) (lastTop.children ??= []).push(item);
      else { toc.push(item); if (g.level === 1) lastTop = item; }
    }
  });
  if (sections.length === 0) sections.push({ id: 's0', html: '' });
  return { sections, toc };
}
