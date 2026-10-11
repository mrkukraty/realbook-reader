/// <reference types="jest" />
import { detectSpeechLanguage, localeLabel, normTag, pickVoice, splitForSpeech, voiceLocales, type VoiceInfo } from '../src/reader/speech-text';
import { BRIDGE_JS } from '../src/reader/page-html';
import { defaultSettings, normalizeSettings } from '../src/settings/types';

const v = (language: string, name: string, quality = 'Default'): VoiceInfo => ({ identifier: `${language}/${name}`, language, name, quality });
const VOICES = [
  v('en-US', 'Samantha'), v('en-GB', 'Daniel'), v('en-GB', 'Kate', 'Enhanced'), v('en-IN', 'Rishi'), v('en-AU', 'Karen'),
  v('es-ES', 'Monica'), v('es-MX', 'Paulina'), v('fr-FR', 'Thomas'), v('fr-CA', 'Amelie'), v('hi-IN', 'Lekha'),
  v('pt_BR', 'Luciana'), v('zh-CN', 'Tingting'), v('zh-TW', 'Meijia'), v('ja-JP', 'Kyoko'), v('ar-SA', 'Maged'),
];

describe('read-aloud language detection', () => {
  it('picks the language from the writing system', () => {
    expect(detectSpeechLanguage('यह एक बहुत अच्छी किताब है।')).toBe('hi');
    expect(detectSpeechLanguage('இது ஒரு நல்ல புத்தகம்.')).toBe('ta');
    expect(detectSpeechLanguage('Это очень хорошая книга.')).toBe('ru');
    expect(detectSpeechLanguage('هذا كتاب جيد جدا')).toBe('ar');
    expect(detectSpeechLanguage('이것은 좋은 책입니다')).toBe('ko');
    expect(detectSpeechLanguage('这是一本很好的书。')).toBe('zh');
    expect(detectSpeechLanguage('これはとても良い本です。')).toBe('ja');
    expect(detectSpeechLanguage('Αυτό είναι ένα καλό βιβλίο')).toBe('el');
    expect(detectSpeechLanguage('นี่คือหนังสือที่ดี')).toBe('th');
  });

  it('uses the book and phone languages where a script is shared', () => {
    expect(detectSpeechLanguage('The quick brown fox.')).toBe('en');
    expect(detectSpeechLanguage('El zorro marrón salta.', ['es'])).toBe('es');
    expect(detectSpeechLanguage('Le renard brun saute.', [undefined, 'fr-CA', 'en-CA'])).toBe('fr');
    // the book's language wins over the phone's
    expect(detectSpeechLanguage('Der schnelle braune Fuchs.', ['de', 'en-US'])).toBe('de');
    expect(detectSpeechLanguage('Це дуже гарна книга.', ['uk-UA'])).toBe('uk');
    expect(detectSpeechLanguage('یہ ایک اچھی کتاب ہے', ['en-PK', 'ur-PK'])).toBe('ur');
    expect(detectSpeechLanguage('यह एक बहुत अच्छी किताब है।', ['mr'])).toBe('mr');
    // a Hindi phone reading a Latin-script page: not Hindi
    expect(detectSpeechLanguage('The quick brown fox.', ['hi-IN'])).toBe('en');
    expect(detectSpeechLanguage('1234 — 5678', ['hi-IN', 'en-IN'])).toBe('en');
  });

  it('keeps a page in its own language when it only quotes a few foreign words', () => {
    expect(detectSpeechLanguage('The teacher greeted the whole class with a warm नमस्ते before the lesson began.')).toBe('en');
  });
});

describe('read-aloud voice choice', () => {
  it('reads in the accent of the phone', () => {
    expect(pickVoice('en', VOICES, ['en-IN', 'hi-IN'])).toEqual({ language: 'en-IN', voice: 'en-IN/Rishi', missing: false });
    expect(pickVoice('en', VOICES, ['en-AU']).language).toBe('en-AU');
    expect(pickVoice('en', VOICES, ['en-US']).language).toBe('en-US');
    // enhanced voices are preferred within the accent
    expect(pickVoice('en', VOICES, ['en-GB']).voice).toBe('en-GB/Kate');
    expect(pickVoice('fr', VOICES, ['fr-CA']).language).toBe('fr-CA');
  });

  it('falls back to the phone region for other languages', () => {
    // a Mexican phone set to English reading Spanish, a Canadian one reading French
    expect(pickVoice('es', VOICES, ['en-MX']).language).toBe('es-MX');
    expect(pickVoice('fr', VOICES, ['en-CA']).language).toBe('fr-CA');
    expect(pickVoice('zh', VOICES, ['en-TW']).language).toBe('zh-TW');
    expect(pickVoice('hi', VOICES, ['en-GB']).language).toBe('hi-IN');
    // tags written with an underscore (Android) still match
    expect(pickVoice('pt', VOICES, ['en-US'])).toEqual({ language: 'pt-BR', voice: 'pt_BR/Luciana', missing: false });
  });

  it('honours an explicit accent and voice', () => {
    expect(pickVoice('en-GB', VOICES, ['en-IN']).voice).toBe('en-GB/Kate');
    expect(pickVoice('en-GB', VOICES, ['en-IN'], 'en-GB/Daniel').voice).toBe('en-GB/Daniel');
    // a remembered voice of another accent is ignored
    expect(pickVoice('en-GB', VOICES, ['en-IN'], 'en-US/Samantha').voice).toBe('en-GB/Kate');
    // the chosen accent is not installed: the nearest voice of that language
    expect(pickVoice('en-NG', VOICES, ['en-NG']).missing).toBe(false);
  });

  it('reports a language the phone cannot speak, and stays quiet before voices are known', () => {
    expect(pickVoice('ko', VOICES, ['en-US'])).toEqual({ language: 'ko', missing: true });
    expect(pickVoice('en', [], ['en-ZA'])).toEqual({ language: 'en-ZA', missing: false });
    expect(pickVoice('fr-BE', [], ['en-ZA'])).toEqual({ language: 'fr-BE', missing: false });
  });

  it('lists every installed accent, the phone languages first', () => {
    const list = voiceLocales(VOICES, ['hi-IN', 'en-IN']);
    expect(list.slice(0, 2).map((l) => l.tag)).toEqual(['hi-IN', 'en-IN']);
    expect(list.slice(2, 5).map((l) => l.tag)).toEqual(['en-AU', 'en-GB', 'en-US']);
    expect(list).toHaveLength(14);
    expect(list.find((l) => l.tag === 'en-GB')!.voices.map((x) => x.name)).toEqual(['Daniel', 'Kate']);
    expect(list.find((l) => l.tag === 'pt-BR')!.label).toBe('Português (BR)');
    expect(localeLabel('en_in')).toBe('English (IN)');
    expect(localeLabel('xx')).toBe('xx');
    expect(normTag('ZH_hant_tw')).toBe('zh-hant-TW');
  });

  it('accepts any language tag in settings and rejects garbage', () => {
    expect(defaultSettings.speechLang).toBe('auto');
    expect(normalizeSettings({ speechLang: 'es-MX', speechVoice: 'x', speechRate: 9 })).toMatchObject({ speechLang: 'es-MX', speechVoice: 'x', speechRate: 2 });
    expect(normalizeSettings({ speechLang: 'en-IN' }).speechLang).toBe('en-IN');
    expect(normalizeSettings({ speechLang: '<script>', speechVoice: 5 })).toMatchObject({ speechLang: 'auto', speechVoice: '' });
    expect(normalizeSettings({ speechLang: 'auto', speechVoice: 'left-over' }).speechVoice).toBe('');
  });
});

describe('read-aloud text splitting', () => {
  it('groups whole sentences into pieces under the limit', () => {
    const parts = splitForSpeech('One short sentence. Another one follows! Is this the third? Yes it is.', 40);
    expect(parts).toEqual(['One short sentence. Another one follows!', 'Is this the third? Yes it is.']);
    parts.forEach((p) => expect(p.length).toBeLessThanOrEqual(40));
  });

  it('does not break on decimals or closing quotes, and breaks on other scripts and new lines', () => {
    expect(splitForSpeech('It cost 3.14 rupees. "Really?" she asked.', 20)).toEqual(['It cost 3.14 rupees.', '"Really?" she asked.']);
    expect(splitForSpeech('यह पहला वाक्य है। यह दूसरा है।', 20)).toEqual(['यह पहला वाक्य है।', 'यह दूसरा है।']);
    expect(splitForSpeech('这是第一句话。这是第二句话。', 8)).toEqual(['这是第一句话。', '这是第二句话。']);
    expect(splitForSpeech('Chapter One\nIt began.', 12)).toEqual(['Chapter One', 'It began.']);
  });

  it('cuts an over-long sentence at a comma or space and loses no words', () => {
    const long = 'When the rains finally came to the village, the river rose over the old stone bridge and nobody could cross for a week';
    const parts = splitForSpeech(long, 50);
    parts.forEach((p) => expect(p.length).toBeLessThanOrEqual(50));
    expect(parts.join(' ')).toBe(long);
    expect(parts[0]).toBe('When the rains finally came to the village,');
  });

  it('ships a page bridge that parses and can report the page text', () => {
    // the bridge is injected as a string, so a typo in it would only show up on a device
    expect(() => new Function(BRIDGE_JS)).not.toThrow();
    expect(BRIDGE_JS).toContain("pageText:function(req){post({type:'pageText'");
  });

  it('returns nothing for an empty page', () => {
    expect(splitForSpeech('  \n \n')).toEqual([]);
  });
});
