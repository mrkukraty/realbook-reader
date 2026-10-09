import type { FormatAdapter, ReflowDocument } from '../types';
import { ImportError } from '../types';
import { decodeText, escapeHtml, extOf, finalizeMeta, readBytes, titleFromFileName, wrapError } from '../util';
import {
  demoteTocLikeHeadings, groupBlocks, headingBlock, looksLikeChapterHeading, type Block,
} from '../blocks';

interface GutenbergInfo { title?: string; author?: string; language?: string; published?: string; body: string }

export function parseGutenberg(text: string): GutenbergInfo {
  const start = /\*\*\*\s*START OF (?:THE|THIS) PROJECT GUTENBERG EBOOK[^\n]*\*\*\*[^\n]*\n/i.exec(text);
  if (!start) return { body: text };
  const header = text.slice(0, start.index);
  let body = text.slice(start.index + start[0].length);
  const end = /\*\*\*\s*END OF (?:THE|THIS) PROJECT GUTENBERG EBOOK/i.exec(body);
  if (end) body = body.slice(0, end.index);
  const field = (name: string) => {
    const m = new RegExp(`^${name}:[ \\t]*(.+(?:\\n[ \\t]+\\S.*)*)`, 'im').exec(header);
    return m?.[1].replace(/\s+/g, ' ').trim();
  };
  return {
    title: field('Title'),
    author: field('Author'),
    language: field('Language'),
    published: field('Release date')?.replace(/\s*\[.*$/, ''),
    body,
  };
}

/** Convert plain text into blocks (paragraphs + detected chapter headings). */
export function textToBlocks(text: string): Block[] {
  const lines = text.replace(/\r\n?/g, '\n').replace(/ /g, ' ').split('\n');
  const blocks: Block[] = [];
  let para: string[] = [];

  const flushPara = () => {
    if (!para.length) return;
    const ls = para.map((l) => l.replace(/\s+$/, ''));
    para = [];
    // chapter heading: single line, or "CHAPTER I." + short title line
    if (ls.length === 1 && looksLikeChapterHeading(ls[0])) {
      blocks.push(headingBlock(ls[0].trim()));
      return;
    }
    if (ls.length === 2 && looksLikeChapterHeading(ls[0]) && ls[1].trim().length <= 70 && !/[.,;:]$/.test(ls[1].trim())) {
      blocks.push(headingBlock(`${ls[0].trim()} ${ls[1].trim()}`));
      return;
    }
    const lens = ls.map((l) => l.trim().length).sort((a, b) => a - b);
    const median = lens[Math.floor(lens.length / 2)];
    const hardWrapped = ls.length > 1 && median >= 35 && lens[lens.length - 1] <= 110;
    if (hardWrapped) {
      const joined = ls.map((l) => l.trim()).join(' ');
      blocks.push({ html: `<p>${escapeHtml(joined)}</p>`, chars: joined.length });
    } else if (ls.length > 1 && lens[lens.length - 1] <= 110) {
      // short lines: poetry/addresses -> keep line breaks
      const h = ls.map((l) => escapeHtml(l.trim())).join('<br>');
      blocks.push({ html: `<p>${h}</p>`, chars: ls.join('').length });
    } else {
      for (const l of ls) {
        const t = l.trim();
        if (t) blocks.push({ html: `<p>${escapeHtml(t)}</p>`, chars: t.length });
      }
    }
  };

  for (const line of lines) {
    if (line.trim() === '') flushPara();
    else para.push(line);
  }
  flushPara();
  demoteTocLikeHeadings(blocks);
  return blocks;
}

export async function openText(data: Blob, fileName: string): Promise<ReflowDocument> {
  const raw = decodeText(await readBytes(data));
  if (!raw.trim()) throw new ImportError('This text file is empty, so there is nothing to read.', 'corrupt');
  const g = parseGutenberg(raw);
  const blocks = textToBlocks(g.body);
  const { sections, toc } = groupBlocks(blocks, {});
  const title = g.title ?? titleFromFileName(fileName);
  return {
    kind: 'reflow',
    metadata: finalizeMeta({ title, author: g.author, language: g.language, published: g.published }, fileName),
    sections,
    toc,
    dispose() {},
  };
}

export const textAdapter: FormatAdapter = {
  id: 'txt',
  label: 'Plain text',
  extensions: ['txt', 'text'],
  detect(head, fileName) {
    if (['txt', 'text'].includes(extOf(fileName))) return true;
    return !head.subarray(0, 2000).includes(0) || (head[0] === 0xff && head[1] === 0xfe);
  },
  async open(data, fileName) {
    try { return await openText(data, fileName); } catch (e) { throw wrapError(e, 'text'); }
  },
};
