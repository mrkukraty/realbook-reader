/// <reference types="jest" />
import { detectSpeechLang, splitForSpeech, SPEECH_LANG_LABELS } from '../src/reader/speech-text';
import { BRIDGE_JS } from '../src/reader/page-html';
import { SPEECH_LANG_IDS, defaultSettings, normalizeSettings } from '../src/settings/types';

describe('read-aloud voice choice', () => {
  it('reads Indian scripts in their own language and everything else in Indian English', () => {
    expect(detectSpeechLang('Most of the retail investors invest all of their money.')).toBe('en-IN');
    expect(detectSpeechLang('यह एक बहुत अच्छी किताब है।')).toBe('hi-IN');
    expect(detectSpeechLang('यह एक बहुत अच्छी किताब है।', 'mr')).toBe('mr-IN');
    expect(detectSpeechLang('இது ஒரு நல்ல புத்தகம்.')).toBe('ta-IN');
    expect(detectSpeechLang('এটি একটি ভালো বই।')).toBe('bn-IN');
    expect(detectSpeechLang('ఇది మంచి పుస్తకం.')).toBe('te-IN');
    expect(detectSpeechLang('یہ ایک اچھی کتاب ہے')).toBe('ur-IN');
    expect(detectSpeechLang('1234 — 5678')).toBe('en-IN');
  });

  it('keeps an English page English when it only quotes a few Hindi words', () => {
    expect(detectSpeechLang('The teacher greeted the whole class with a warm नमस्ते before the lesson began.')).toBe('en-IN');
  });

  it('has a label for every voice and valid defaults', () => {
    SPEECH_LANG_IDS.forEach((id) => expect(SPEECH_LANG_LABELS[id]).toBeTruthy());
    expect(defaultSettings.speechLang).toBe('auto');
    const s = normalizeSettings({ speechLang: 'xx-YY', speechRate: 9 });
    expect(s.speechLang).toBe('auto');
    expect(s.speechRate).toBe(2);
  });
});

describe('read-aloud text splitting', () => {
  it('groups whole sentences into pieces under the limit', () => {
    const parts = splitForSpeech('One short sentence. Another one follows! Is this the third? Yes it is.', 40);
    expect(parts).toEqual(['One short sentence. Another one follows!', 'Is this the third? Yes it is.']);
    parts.forEach((p) => expect(p.length).toBeLessThanOrEqual(40));
  });

  it('does not break on decimals or closing quotes, and breaks on Hindi full stops and new lines', () => {
    expect(splitForSpeech('It cost 3.14 rupees. "Really?" she asked.', 20)).toEqual(['It cost 3.14 rupees.', '"Really?" she asked.']);
    expect(splitForSpeech('यह पहला वाक्य है। यह दूसरा है।', 20)).toEqual(['यह पहला वाक्य है।', 'यह दूसरा है।']);
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
