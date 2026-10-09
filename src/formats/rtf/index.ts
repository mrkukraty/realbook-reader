import { ImportError, type FormatAdapter, type ReflowDocument } from '../types';
import { ascii, escapeHtml, extOf, finalizeMeta, readBytes, wrapError } from '../util';
import { demoteTocLikeHeadings, groupBlocks, headingBlock, looksLikeChapterHeading, type Block } from '../blocks';

const SKIP_DEST = new Set([
  'fonttbl', 'colortbl', 'stylesheet', 'pict', 'header', 'footer', 'headerl', 'headerr', 'footerl', 'footerr',
  'object', 'themedata', 'listtable', 'listoverridetable', 'generator', 'latentstyles', 'datastore', 'colorschememapping',
  'rsidtbl', 'fldinst', 'xmlnstbl', 'revtbl', 'filetbl', 'mmathPr', 'private', 'wgrffmtfilter',
]);
const SYMBOLS: Record<string, string> = {
  emdash: '—', endash: '–', lquote: '‘', rquote: '’', ldblquote: '“', rdblquote: '”',
  bullet: '•', tab: '\t', emspace: ' ', enspace: ' ', nbsp: ' ',
};

interface Run { t: string; b: boolean; i: boolean }
interface Para { runs: Run[]; maxFs: number }
interface State { skip: boolean; b: boolean; i: boolean; fs: number; uc: number; info?: string }

export function parseRtf(src: string): { paras: Para[]; title?: string; author?: string } {
  const paras: Para[] = [];
  let cur: Para = { runs: [], maxFs: 0 };
  const stack: State[] = [];
  let st: State = { skip: false, b: false, i: false, fs: 24, uc: 1 };
  let cp = 'windows-1252';
  const cpm = /\\ansicpg(\d+)/.exec(src.slice(0, 2000));
  if (cpm) cp = cpm[1] === '65001' ? 'utf-8' : `windows-${cpm[1]}`;
  let dec: TextDecoder;
  try { dec = new TextDecoder(cp); } catch { dec = new TextDecoder('windows-1252'); }
  const info: Record<string, string> = {};
  let infoKey: string | undefined;
  let pendingBytes: number[] = [];
  let skipChars = 0;

  const emit = (t: string) => {
    if (st.skip && !infoKey) return;
    if (infoKey) { info[infoKey] = (info[infoKey] ?? '') + t; return; }
    if (!t) return;
    const last = cur.runs[cur.runs.length - 1];
    cur.maxFs = Math.max(cur.maxFs, st.fs);
    if (last && last.b === st.b && last.i === st.i) last.t += t;
    else cur.runs.push({ t, b: st.b, i: st.i });
  };
  const flushBytes = () => {
    if (pendingBytes.length) { emit(dec.decode(new Uint8Array(pendingBytes))); pendingBytes = []; }
  };
  const endPara = () => { flushBytes(); paras.push(cur); cur = { runs: [], maxFs: 0 }; };

  let i = 0;
  const n = src.length;
  let depth = 0;
  while (i < n) {
    const c = src[i];
    if (c === '{') {
      flushBytes(); stack.push({ ...st }); depth++; i++;
      // ignorable destination?
      const m = /^\\\*?\s*\\?([a-zA-Z]+)/.exec(src.slice(i, i + 40));
      if (src[i] === '\\' && src[i + 1] === '*') st.skip = true;
      else if (m && SKIP_DEST.has(m[1])) st.skip = true;
      else if (m && /^(title|author)$/.test(m[1]) && stack.length >= 2) {
        // \info group children
        infoKey = m[1];
      }
      continue;
    }
    if (c === '}') {
      flushBytes(); st = stack.pop() ?? st; depth--; i++;
      if (infoKey) infoKey = undefined;
      continue;
    }
    if (c === '\\') {
      const nx = src[i + 1];
      if (nx === undefined) break;
      if (nx === "'") {
        const hex = src.slice(i + 2, i + 4);
        i += 4;
        if (skipChars > 0) { skipChars--; continue; }
        if (!st.skip || infoKey) pendingBytes.push(parseInt(hex, 16));
        continue;
      }
      if (!/[a-zA-Z]/.test(nx)) {
        i += 2;
        flushBytes();
        if (nx === '~') emit(' ');
        else if (nx === '_') emit('‑');
        else if (nx === '-') emit('');
        else if (nx === '\\' || nx === '{' || nx === '}') { if (skipChars > 0) skipChars--; else emit(nx); }
        else if (nx === '\n' || nx === '\r') { if (!st.skip) endPara(); }
        continue;
      }
      let j = i + 1;
      while (j < n && /[a-zA-Z]/.test(src[j])) j++;
      const word = src.slice(i + 1, j);
      let k = j;
      if (src[k] === '-') k++;
      while (k < n && /\d/.test(src[k])) k++;
      const numStr = src.slice(j, k);
      const num = numStr === '' ? undefined : parseInt(numStr, 10);
      if (src[k] === ' ') k++;
      i = k;
      switch (word) {
        case 'par': case 'sect': if (!st.skip) endPara(); break;
        case 'line': flushBytes(); emit('\n'); break;
        case 'tab': flushBytes(); emit('\t'); break;
        case 'b': flushBytes(); st.b = num !== 0; break;
        case 'i': flushBytes(); st.i = num !== 0; break;
        case 'plain': flushBytes(); st.b = false; st.i = false; st.fs = 24; break;
        case 'pard': break;
        case 'fs': if (num) st.fs = num; break;
        case 'uc': st.uc = num ?? 1; break;
        case 'u': {
          flushBytes();
          let cpt = num ?? 0;
          if (cpt < 0) cpt += 65536;
          emit(String.fromCharCode(cpt));
          skipChars = st.uc;
          // skip fallback chars (plain characters) immediately
          while (skipChars > 0 && i < n) {
            if (src[i] === '\\' && src[i + 1] === "'") { i += 4; skipChars--; }
            else if (src[i] === '\\' || src[i] === '{' || src[i] === '}') break;
            else { i++; skipChars--; }
          }
          skipChars = 0;
          break;
        }
        default:
          if (word in SYMBOLS) { flushBytes(); emit(SYMBOLS[word]); }
      }
      continue;
    }
    if (c === '\r' || c === '\n') { i++; continue; }
    if (skipChars > 0) { skipChars--; i++; continue; }
    // plain run of text
    let j = i;
    while (j < n && src[j] !== '\\' && src[j] !== '{' && src[j] !== '}' && src[j] !== '\r' && src[j] !== '\n') j++;
    flushBytes();
    emit(src.slice(i, j));
    i = j;
  }
  flushBytes();
  if (cur.runs.length) paras.push(cur);
  void depth;
  return { paras, title: info.title?.trim(), author: info.author?.trim() };
}

export async function openRtf(data: Blob, fileName: string): Promise<ReflowDocument> {
  const bytes = await readBytes(data);
  const head = ascii(bytes, 0, 10);
  if (!head.startsWith('{\\rtf')) throw new ImportError('This file is not a valid RTF document.', 'corrupt');
  const src = new TextDecoder('latin1').decode(bytes);
  const { paras, title, author } = parseRtf(src);

  const blocks: Block[] = [];
  for (const p of paras) {
    const text = p.runs.map((r) => r.t).join('').trim();
    if (!text) continue;
    const allBold = p.runs.every((r) => r.b || !r.t.trim());
    const big = p.maxFs >= 32;
    if (text.length <= 100 && !text.includes('\n') && (looksLikeChapterHeading(text.split(/\s*[.:]\s/)[0]) || ((allBold || big) && text.length <= 80 && !/[.,;]$/.test(text)))) {
      blocks.push(headingBlock(text));
      continue;
    }
    const html = p.runs.map((r) => {
      let h = escapeHtml(r.t).replace(/\n/g, '<br>');
      if (r.b) h = `<strong>${h}</strong>`;
      if (r.i) h = `<em>${h}</em>`;
      return h;
    }).join('');
    blocks.push({ html: `<p>${html}</p>`, chars: text.length });
  }
  if (!blocks.length) throw new ImportError('This RTF document contains no readable text.', 'corrupt');
  demoteTocLikeHeadings(blocks);
  const { sections, toc } = groupBlocks(blocks);
  return { kind: 'reflow', metadata: finalizeMeta({ title, author }, fileName), sections, toc, dispose() {} };
}

export const rtfAdapter: FormatAdapter = {
  id: 'rtf',
  label: 'Rich Text (RTF)',
  extensions: ['rtf'],
  detect: (head, fileName) => ascii(head, 0, 5) === '{\\rtf' || extOf(fileName) === 'rtf',
  async open(data, fileName) {
    try { return await openRtf(data, fileName); } catch (e) { throw wrapError(e, 'RTF'); }
  },
};
