// Text and voice preparation for read-aloud (pure, unit-tested): which language a passage is in, which of the
// phone's voices should read it (the reader's own accent when there is a choice), and how a page is cut into
// pieces the speech engine reads one after another.

/** A voice installed on the phone (the fields of expo-speech's Voice that are used here). */
export interface VoiceInfo { identifier: string; language: string; name: string; quality?: string }

/** 'en_IN' / 'EN-in' -> 'en-IN' */
export function normTag(tag: string): string {
  const [lang, ...rest] = tag.replace(/_/g, '-').split('-');
  return [lang.toLowerCase(), ...rest.map((p) => (p.length === 2 ? p.toUpperCase() : p))].join('-');
}
const baseOf = (tag: string) => normTag(tag).split('-')[0];
const regionOf = (tag: string) => normTag(tag).split('-').find((p, i) => i > 0 && /^([A-Z]{2}|\d{3})$/.test(p)) ?? '';

// Writing systems by Unicode block: [first, last, languages written in it - the first is the default]
const SCRIPTS: [number, number, string[]][] = [
  [0x0370, 0x03ff, ['el']],
  [0x0400, 0x04ff, ['ru', 'uk', 'bg', 'sr', 'be', 'mk', 'kk', 'mn']],
  [0x0530, 0x058f, ['hy']],
  [0x0590, 0x05ff, ['he', 'yi']],
  [0x0600, 0x06ff, ['ar', 'ur', 'fa', 'ps']],
  [0x0900, 0x097f, ['hi', 'mr', 'ne']],
  [0x0980, 0x09ff, ['bn', 'as']],
  [0x0a00, 0x0a7f, ['pa']],
  [0x0a80, 0x0aff, ['gu']],
  [0x0b00, 0x0b7f, ['or']],
  [0x0b80, 0x0bff, ['ta']],
  [0x0c00, 0x0c7f, ['te']],
  [0x0c80, 0x0cff, ['kn']],
  [0x0d00, 0x0d7f, ['ml']],
  [0x0d80, 0x0dff, ['si']],
  [0x0e00, 0x0e7f, ['th']],
  [0x0e80, 0x0eff, ['lo']],
  [0x1000, 0x109f, ['my']],
  [0x10a0, 0x10ff, ['ka']],
  [0x1200, 0x137f, ['am']],
  [0x1780, 0x17ff, ['km']],
  [0x3040, 0x30ff, ['ja']],
  [0x4e00, 0x9fff, ['zh', 'ja']],
  [0xac00, 0xd7af, ['ko']],
];
const NON_LATIN = new Set(SCRIPTS.flatMap((s) => s[2]));

/**
 * The language (a bare code such as 'en', 'hi', 'ja') a passage should be read in. The writing system decides;
 * where several languages share one (Latin, Cyrillic, Arabic...), the hints decide - the book's own language
 * first, then the languages the phone is set to.
 */
export function detectSpeechLanguage(text: string, hints: (string | undefined | null)[] = []): string {
  const hint = hints.filter((h): h is string => !!h).map(baseOf);
  const counts = new Map<number, number>();
  let latin = 0;
  let kana = false;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if ((c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 0xc0 && c <= 0x24f)) { latin++; continue; }
    if (c < 0x0370) continue;
    const k = SCRIPTS.findIndex((r) => c >= r[0] && c <= r[1]);
    if (k < 0) continue;
    if (SCRIPTS[k][0] === 0x3040) kana = true;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  let best = -1;
  let n = 0;
  counts.forEach((v, k) => { if (v > n) { n = v; best = k; } });
  // a Latin-script page quoting a few foreign words stays in its own language
  if (best < 0 || n < latin * 0.5) return hint.find((h) => !NON_LATIN.has(h)) ?? 'en';
  const langs = SCRIPTS[best][2];
  if (langs[0] === 'zh' && kana) return 'ja'; // Japanese mixes kanji with kana
  return hint.find((h) => langs.includes(h)) ?? langs[0];
}

/**
 * The installed voice to read `want` with. `want` is a bare language ('en') or a full tag ('en-GB'); with a bare
 * language the reader's own accent wins: the phone's locale for that language, else a voice from the phone's
 * region. `missing` means the phone has no voice for the language at all.
 */
export function pickVoice(want: string, voices: VoiceInfo[], deviceTags: string[], preferredId?: string): { language: string; voice?: string; missing: boolean } {
  const tag = normTag(want);
  const base = baseOf(tag);
  const device = deviceTags.map(normTag);
  const regions = device.map(regionOf).filter(Boolean);
  const own = device.find((d) => baseOf(d) === base);
  const fallback = tag.includes('-') ? tag : own ?? tag;
  const pool = voices.filter((v) => baseOf(v.language) === base);
  if (!pool.length) return { language: fallback, missing: voices.length > 0 };
  const score = (v: VoiceInfo) => {
    const t = normTag(v.language);
    return (v.identifier === preferredId && t === tag ? 1000 : 0)
      + (tag.includes('-') && t === tag ? 400 : 0)
      + (own && t === own ? 200 : 0)
      + (regions.includes(regionOf(t)) ? 100 - regions.indexOf(regionOf(t)) : 0)
      + (v.quality === 'Enhanced' ? 10 : 0);
  };
  const best = pool.reduce((a, b) => (score(b) > score(a) ? b : a));
  return { language: normTag(best.language), voice: best.identifier, missing: false };
}

// Names of languages in themselves, for the voice list (the JS engine on phones has no Intl.DisplayNames).
const LANGUAGE_NAMES: Record<string, string> = {
  af: 'Afrikaans', am: 'አማርኛ', ar: 'العربية', as: 'অসমীয়া', bg: 'Български', bn: 'বাংলা', ca: 'Català', cs: 'Čeština', cy: 'Cymraeg',
  da: 'Dansk', de: 'Deutsch', el: 'Ελληνικά', en: 'English', es: 'Español', et: 'Eesti', eu: 'Euskara', fa: 'فارسی', fi: 'Suomi',
  fil: 'Filipino', fr: 'Français', ga: 'Gaeilge', gl: 'Galego', gu: 'ગુજરાતી', he: 'עברית', hi: 'हिन्दी', hr: 'Hrvatski', hu: 'Magyar',
  hy: 'Հայերեն', id: 'Bahasa Indonesia', is: 'Íslenska', it: 'Italiano', ja: '日本語', jv: 'Basa Jawa', ka: 'ქართული', kk: 'Қазақ', km: 'ខ្មែរ',
  kn: 'ಕನ್ನಡ', ko: '한국어', lo: 'ລາວ', lt: 'Lietuvių', lv: 'Latviešu', mk: 'Македонски', ml: 'മലയാളം', mn: 'Монгол', mr: 'मराठी',
  ms: 'Bahasa Melayu', my: 'မြန်မာ', nb: 'Norsk bokmål', ne: 'नेपाली', nl: 'Nederlands', no: 'Norsk', or: 'ଓଡ଼ିଆ', pa: 'ਪੰਜਾਬੀ', pl: 'Polski',
  ps: 'پښتو', pt: 'Português', ro: 'Română', ru: 'Русский', si: 'සිංහල', sk: 'Slovenčina', sl: 'Slovenščina', sq: 'Shqip', sr: 'Српски',
  su: 'Basa Sunda', sv: 'Svenska', sw: 'Kiswahili', ta: 'தமிழ்', te: 'తెలుగు', th: 'ไทย', tr: 'Türkçe', uk: 'Українська', ur: 'اردو',
  uz: 'Oʻzbek', vi: 'Tiếng Việt', yue: '粵語', zh: '中文', zu: 'isiZulu',
};

/** 'en-IN' -> 'English (IN)' */
export function localeLabel(tag: string): string {
  const t = normTag(tag);
  const rest = t.split('-').slice(1).join('-');
  const name = LANGUAGE_NAMES[baseOf(t)] ?? baseOf(t);
  return rest ? `${name} (${rest})` : name;
}

export interface VoiceLocale { tag: string; label: string; voices: VoiceInfo[] }

/** Every language and accent the phone can speak, the reader's own languages first. */
export function voiceLocales(voices: VoiceInfo[], deviceTags: string[]): VoiceLocale[] {
  const by = new Map<string, VoiceInfo[]>();
  voices.forEach((v) => { const t = normTag(v.language); by.set(t, [...(by.get(t) ?? []), v]); });
  const device = deviceTags.map(normTag);
  const bases = device.map(baseOf);
  const rank = (t: string) => {
    if (device.includes(t)) return device.indexOf(t);
    if (bases.includes(baseOf(t))) return 100 + bases.indexOf(baseOf(t));
    return 1000;
  };
  return [...by.entries()]
    .map(([tag, list]) => ({ tag, label: localeLabel(tag), voices: list }))
    .sort((a, b) => rank(a.tag) - rank(b.tag) || (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));
}

const TERMINATORS = '.!?।॥…。！？';
const CLOSERS = '"\'”’)]»」』';
// these end a sentence without a following space
const WIDE = '。！？';

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
    if (j >= text.length || /\s/.test(text[j]) || WIDE.includes(ch)) { push(j); i = j - 1; }
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
      let cut = Math.max(s.lastIndexOf(', ', max), s.lastIndexOf('; ', max), s.lastIndexOf('、', max), s.lastIndexOf('，', max));
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
