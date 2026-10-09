import { marked } from 'marked';
import { ImportError, type FormatAdapter, type ReflowDocument } from '../types';
import { decodeText, extOf, finalizeMeta, readBytes, wrapError } from '../util';
import { parseHtmlBody } from '../sanitize';
import { sectionsFromContainer } from '../htmlSections';

function slug(s: string): string {
  return s.toLowerCase().replace(/<[^>]*>/g, '').replace(/[^\p{L}\p{N}\s-]/gu, '').trim().replace(/\s+/g, '-');
}

export async function openMarkdown(data: Blob, fileName: string): Promise<ReflowDocument> {
  let text = decodeText(await readBytes(data));
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
  const html = marked.parse(text, { async: false, gfm: true }) as string;
  const root = parseHtmlBody(html);
  const used = new Set<string>();
  for (const h of Array.from(root.querySelectorAll('h1,h2,h3,h4,h5,h6'))) {
    let id = slug(h.textContent ?? '') || 'section';
    const base = id;
    for (let i = 2; used.has(id); i++) id = `${base}-${i}`;
    used.add(id);
    if (!h.id) h.id = id;
  }
  const title = fm.title ?? root.querySelector('h1')?.textContent?.trim();
  const { sections, toc } = sectionsFromContainer(root, { dropImages: true });
  return {
    kind: 'reflow',
    metadata: finalizeMeta({ title, author: fm.author, language: fm.language ?? fm.lang, description: fm.description }, fileName),
    sections, toc, dispose() {},
  };
}

export const markdownAdapter: FormatAdapter = {
  id: 'markdown',
  label: 'Markdown',
  extensions: ['md', 'markdown'],
  detect: (_h, fileName) => ['md', 'markdown'].includes(extOf(fileName)),
  async open(data, fileName) {
    try { return await openMarkdown(data, fileName); } catch (e) { throw wrapError(e, 'Markdown'); }
  },
};
