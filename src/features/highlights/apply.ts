export type HlColor = 'yellow' | 'green' | 'blue' | 'pink' | 'hit';
export interface HlItem { id: string; start: number; end: number; color: HlColor; note?: boolean }

function textNodes(root: Node): Text[] {
  const out: Text[] = [];
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let n: Node | null;
  while ((n = w.nextNode())) out.push(n as Text);
  return out;
}

export function clearHighlights(root: HTMLElement) {
  root.querySelectorAll('mark[data-hl]').forEach((m) => {
    const p = m.parentNode;
    if (!p) return;
    while (m.firstChild) p.insertBefore(m.firstChild, m);
    p.removeChild(m);
  });
  root.normalize();
}

/** Wrap text ranges [start,end) (offsets in root.textContent) in <mark data-hl>. Offsets are local to root. */
export function applyHighlights(root: HTMLElement, items: HlItem[]) {
  clearHighlights(root);
  if (!items.length) return;
  const nodes = textNodes(root);
  const starts: number[] = [];
  let pos = 0;
  for (const n of nodes) { starts.push(pos); pos += n.data.length; }
  // process items from the end so earlier offsets remain valid per node
  const jobs: { node: Text; s: number; e: number; it: HlItem }[] = [];
  for (const it of items) {
    if (it.end <= it.start) continue;
    nodes.forEach((n, i) => {
      const ns = starts[i], ne = ns + n.data.length;
      const s = Math.max(it.start, ns), e = Math.min(it.end, ne);
      if (e > s) jobs.push({ node: n, s: s - ns, e: e - ns, it });
    });
  }
  // group by node, apply right-to-left; overlapping items on the same node are nested by skipping covered parts
  const byNode = new Map<Text, typeof jobs>();
  for (const j of jobs) { const a = byNode.get(j.node) ?? []; a.push(j); byNode.set(j.node, a); }
  for (const [node, list] of byNode) {
    list.sort((a, b) => b.s - a.s);
    let limit = Infinity;
    let cur = node;
    for (const j of list) {
      const e = Math.min(j.e, limit);
      if (e <= j.s) continue;
      const mid = cur.splitText(j.s);
      mid.splitText(e - j.s);
      const mark = document.createElement('mark');
      mark.dataset.hl = j.it.id;
      mark.className = `rb-hl rb-hl-${j.it.color}${j.it.note ? ' rb-hl-note' : ''}`;
      mid.parentNode!.insertBefore(mark, mid);
      mark.appendChild(mid);
      limit = j.s;
    }
  }
}

/** Offsets of a DOM range relative to root.textContent, or null when not inside root. */
export function rangeToOffsets(root: HTMLElement, range: Range): { start: number; end: number } | null {
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;
  const pre = document.createRange();
  pre.selectNodeContents(root);
  pre.setEnd(range.startContainer, range.startOffset);
  const start = pre.toString().length;
  const len = range.toString().length;
  return len > 0 ? { start, end: start + len } : null;
}

/** Find DOM position for a text offset. */
export function offsetToPosition(root: HTMLElement, offset: number): { node: Text; offset: number } | null {
  let pos = 0;
  let last: Text | null = null;
  for (const n of textNodes(root)) {
    last = n;
    if (offset <= pos + n.data.length) return { node: n, offset: Math.max(0, offset - pos) };
    pos += n.data.length;
  }
  return last ? { node: last, offset: last.data.length } : null;
}

/** Clip global highlight offsets to a chunk window and make them local. */
export function localizeHighlights<T extends { start: number; end: number }>(items: T[], textStart: number, textLen: number): (T & { start: number; end: number })[] {
  const out: (T & { start: number; end: number })[] = [];
  for (const h of items) {
    const s = Math.max(h.start, textStart), e = Math.min(h.end, textStart + textLen);
    if (e > s) out.push({ ...h, start: s - textStart, end: e - textStart });
  }
  return out;
}
