export interface Snippet { before: string; match: string; after: string }
export interface TextMatch { index: number; length: number; snippet: Snippet }

const norm = (s: string) => s.toLocaleLowerCase();

/** Case-insensitive literal search with context snippets. Whitespace in snippets is collapsed. */
export function findMatches(text: string, query: string, opts: { max?: number; context?: number } = {}): TextMatch[] {
  const q = query.trim();
  if (!q) return [];
  const max = opts.max ?? 200;
  const ctx = opts.context ?? 40;
  const hay = norm(text);
  const needle = norm(q);
  const out: TextMatch[] = [];
  let from = 0;
  while (out.length < max) {
    const i = hay.indexOf(needle, from);
    if (i < 0) break;
    out.push({ index: i, length: needle.length, snippet: makeSnippet(text, i, needle.length, ctx) });
    from = i + Math.max(1, needle.length);
  }
  return out;
}

export function makeSnippet(text: string, index: number, length: number, ctx = 40): Snippet {
  const clean = (s: string) => s.replace(/\s+/g, ' ');
  let b = text.slice(Math.max(0, index - ctx), index);
  let a = text.slice(index + length, index + length + ctx);
  b = clean(b); a = clean(a);
  if (index - ctx > 0) b = '…' + b.replace(/^\S*\s/, '');
  if (index + length + ctx < text.length) a = a.replace(/\s\S*$/, '') + '…';
  return { before: b, match: clean(text.slice(index, index + length)), after: a };
}
