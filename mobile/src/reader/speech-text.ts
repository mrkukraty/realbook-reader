// Text preparation for read-aloud (pure, unit-tested): which Indian voice a passage needs, and how a page is
// cut into pieces the speech engine reads one after another.
import type { SpeechLangId } from '../settings/types';

/** Voices offered for reading aloud. English uses the Indian accent; the rest are picked by script in 'auto'. */
export const SPEECH_LANG_LABELS: Record<SpeechLangId, string> = {
  auto: 'Auto (match the text)',
  'en-IN': 'English (India)',
  'hi-IN': 'हिन्दी · Hindi',
  'mr-IN': 'मराठी · Marathi',
  'bn-IN': 'বাংলা · Bengali',
  'ta-IN': 'தமிழ் · Tamil',
  'te-IN': 'తెలుగు · Telugu',
  'kn-IN': 'ಕನ್ನಡ · Kannada',
  'ml-IN': 'മലയാളം · Malayalam',
  'gu-IN': 'ગુજરાતી · Gujarati',
  'pa-IN': 'ਪੰਜਾਬੀ · Punjabi',
  'ur-IN': 'اردو · Urdu',
};

type Lang = Exclude<SpeechLangId, 'auto'>;

// Unicode blocks of the scripts above: [first, last, language]
const SCRIPTS: [number, number, Lang][] = [
  [0x0900, 0x097f, 'hi-IN'], // Devanagari (Hindi unless the book says Marathi)
  [0x0980, 0x09ff, 'bn-IN'],
  [0x0a00, 0x0a7f, 'pa-IN'],
  [0x0a80, 0x0aff, 'gu-IN'],
  [0x0b80, 0x0bff, 'ta-IN'],
  [0x0c00, 0x0c7f, 'te-IN'],
  [0x0c80, 0x0cff, 'kn-IN'],
  [0x0d00, 0x0d7f, 'ml-IN'],
  [0x0600, 0x06ff, 'ur-IN'],
];

/** The voice a passage should be read with: its Indian language when written in that script, else Indian English. */
export function detectSpeechLang(text: string, bookLang?: string): Lang {
  const counts = new Map<Lang, number>();
  let latin = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if ((c >= 65 && c <= 90) || (c >= 97 && c <= 122)) { latin++; continue; }
    if (c < 0x0600 || c > 0x0d7f) continue;
    const s = SCRIPTS.find((r) => c >= r[0] && c <= r[1]);
    if (s) counts.set(s[2], (counts.get(s[2]) ?? 0) + 1);
  }
  let best: Lang | null = null;
  let n = 0;
  counts.forEach((v, k) => { if (v > n) { n = v; best = k; } });
  // an English page quoting a few Hindi words stays English
  if (!best || n < latin * 0.5) return 'en-IN';
  if (best === 'hi-IN' && /^mr\b/i.test(bookLang ?? '')) return 'mr-IN';
  return best;
}

const TERMINATORS = '.!?।॥…';
const CLOSERS = '"\'”’)]»';

/** Sentences of a text. A full stop only ends one when followed by a space, so "3.14" and "e.g." survive mostly intact. */
function sentences(text: string): string[] {
  const out: string[] = [];
  let start = 0;
  const push = (end: number) => { const s = text.slice(start, end).replace(/\s+/g, ' ').trim(); if (s) out.push(s); start = end; };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '\n') { push(i + 1); continue; }
    if (!TERMINATORS.includes(ch)) continue;
    let j = i + 1;
    while (j < text.length && (TERMINATORS.includes(text[j]) || CLOSERS.includes(text[j]))) j++;
    if (j >= text.length || /\s/.test(text[j])) { push(j); i = j - 1; }
  }
  push(text.length);
  return out;
}

/**
 * Cut a page into pieces of at most `max` characters for the speech engine. Sentences are kept whole and
 * grouped, so the voice flows; a sentence longer than `max` is cut at a comma or space.
 */
export function splitForSpeech(text: string, max = 220): string[] {
  const out: string[] = [];
  let cur = '';
  const flush = () => { if (cur) out.push(cur); cur = ''; };
  for (let s of sentences(text)) {
    while (s.length > max) {
      flush();
      let cut = Math.max(s.lastIndexOf(', ', max), s.lastIndexOf('; ', max));
      cut = cut > max * 0.4 ? cut + 1 : s.lastIndexOf(' ', max);
      if (cut <= 0) cut = max;
      out.push(s.slice(0, cut).trim());
      s = s.slice(cut).trim();
    }
    if (!s) continue;
    if (cur && cur.length + 1 + s.length > max) flush();
    cur = cur ? `${cur} ${s}` : s;
  }
  flush();
  return out;
}
