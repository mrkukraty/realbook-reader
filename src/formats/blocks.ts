import type { ReflowSection, Target, TocItem } from './types';
import { escapeHtml } from './util';

/** A pre-rendered block of HTML (already safe/escaped). `heading` marks a chapter start. */
export interface Block { html: string; chars: number; heading?: string }

export function paragraphBlock(text: string): Block {
  return { html: `<p>${escapeHtml(text)}</p>`, chars: text.length };
}
export function headingBlock(text: string, level = 2): Block {
  return { html: `<h${level}>${escapeHtml(text)}</h${level}>`, chars: text.length, heading: text };
}

/** Demote headings that are followed by another heading within `minGap` chars (typical table-of-contents lists). */
export function demoteTocLikeHeadings(blocks: Block[], minGap = 300): void {
  let lastHeadingIdx = -1;
  let gap = 0;
  for (let i = 0; i < blocks.length; i++) {
    if (blocks[i].heading !== undefined) {
      if (lastHeadingIdx >= 0 && gap < minGap) {
        const b = blocks[lastHeadingIdx];
        blocks[lastHeadingIdx] = { html: `<p>${escapeHtml(b.heading!)}</p>`, chars: b.chars };
      }
      lastHeadingIdx = i;
      gap = 0;
    } else if (lastHeadingIdx >= 0) {
      gap += blocks[i].chars;
    }
  }
}

/** Group blocks into sections: new section at every heading, plus size-based splits. */
export function groupBlocks(
  blocks: Block[],
  opts: { maxChars?: number; frontTitle?: string } = {},
): { sections: ReflowSection[]; toc: TocItem[] } {
  const hasHeadings = blocks.some((b) => b.heading !== undefined);
  const max = opts.maxChars ?? (hasHeadings ? 60_000 : 30_000);
  const sections: ReflowSection[] = [];
  const toc: TocItem[] = [];
  let cur: string[] = [];
  let size = 0;
  let title: string | undefined;
  let tocPending = false;
  const flush = () => {
    if (!cur.length) return;
    const idx = sections.length;
    sections.push({ id: `s${idx}`, title, html: cur.join('\n') });
    if (tocPending && title) toc.push({ title, target: { section: idx } as Target });
    cur = [];
    size = 0;
    title = undefined;
    tocPending = false;
  };
  for (const b of blocks) {
    if (b.heading !== undefined) {
      flush();
      title = b.heading;
      tocPending = true;
    } else if (cur.length && size + b.chars > max) {
      const t = title;
      flush();
      title = t ? `${t} (cont.)` : undefined;
    }
    cur.push(b.html);
    size += b.chars;
  }
  flush();
  if (sections.length > 1 && toc.length === 0) {
    sections.forEach((s, i) => toc.push({ title: `Part ${i + 1}`, target: { section: i } as Target }));
  }
  if (sections.length === 0) sections.push({ id: 's0', html: '<p></p>' });
  return { sections, toc };
}

const NUM_WORDS =
  '(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|last|final)';
const ROMAN_STRICT = /^M{0,3}(CM|CD|D?C{0,3})(XC|XL|L?X{0,3})(IX|IV|V?I{0,3})$/;

/** Does this (trimmed) single line look like a chapter heading? */
export function looksLikeChapterHeading(line: string): boolean {
  const t = line.trim();
  if (!t || t.length > 80) return false;
  const kw = new RegExp(
    `^(?:chapter|book|part|section|letter|canto|act|volume|stave|tale)\\s+(?:[ivxlcdm]{1,8}|\\d{1,4}|${NUM_WORDS})\\b(?:[.:)\\-\\u2014\\u2013]|\\s|$)`,
    'i',
  );
  if (kw.test(t)) return true;
  if (/^(?:prologue|epilogue|preface|foreword|introduction|afterword|appendix(?:\s+[A-Z0-9]+)?|contents|dedication|acknowledg(?:e)?ments)\.?$/i.test(t)) return true;
  const m = /^([IVXLCDM]{1,8})(?:[.)](?:\s+\S.{0,60})?)?$/.exec(t);
  if (m && ROMAN_STRICT.test(m[1])) return true;
  return false;
}
