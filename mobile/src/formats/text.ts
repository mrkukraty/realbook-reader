import { ImportError, type ReflowDocument } from './types';
import { decodeText, escapeHtml, finalizeMeta, titleFromFileName, wrapError } from './util';
import { demoteTocLikeHeadings, groupBlocks, headingBlock, looksLikeChapterHeading, type Block } from './blocks';

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

export function openText(data: Uint8Array, fileName: string): ReflowDocument {
  try {
    const raw = decodeText(data);
    if (!raw.trim()) throw new ImportError('This text file is empty, so there is nothing to read.', 'corrupt');
    const g = parseGutenberg(raw);
    const { sections, toc } = groupBlocks(textToBlocks(g.body), {});
    return {
      kind: 'reflow',
      metadata: finalizeMeta({ title: g.title ?? titleFromFileName(fileName), author: g.author, language: g.language, published: g.published }, fileName),
      sections,
      toc,
    };
  } catch (e) {
    throw wrapError(e, 'text');
  }
}
