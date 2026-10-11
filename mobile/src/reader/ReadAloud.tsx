// Read aloud. Speaks the visible page with the phone's own voices (Indian English, Hindi and other Indian
// languages), then turns the page and carries on, so a book can be listened to hands-free. Nothing is sent
// anywhere: the speech engine is the one built into iOS / Android.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, Text, View } from 'react-native';
import * as Speech from 'expo-speech';
import { Ionicons } from '@expo/vector-icons';
import { IconBtn, Stepper, useAppTheme } from '../components/ui';
import { useSettings } from '../state/settings-store';
import { LIMITS, SPEECH_LANG_IDS, type SpeechLangId } from '../settings/types';
import { SPEECH_LANG_LABELS, detectSpeechLang, splitForSpeech } from './speech-text';
import { Sheet } from './panels';

export type ReadAloudState = 'off' | 'playing' | 'paused';

interface Options {
  /** identifies what is on screen; when it changes while playing, reading restarts from the new page */
  locKey: string | null;
  /** text of the visible page(s); rejects while the page is not ready yet */
  getPageText(): Promise<string>;
  canNext(): boolean;
  next(): void;
  lang: SpeechLangId;
  rate: number;
  /** the book's own language tag, if known */
  bookLang?: string;
  /** short message for the user (end of book, missing voice, ...) */
  notify(message: string): void;
}

const norm = (l: string) => l.replace('_', '-').toLowerCase();
let voices: Speech.Voice[] | null = null;
async function loadVoices(): Promise<void> {
  if (voices?.length) return;
  try { voices = await Speech.getAvailableVoicesAsync(); } catch { voices = []; }
}
/** The best installed voice for a language (enhanced quality if present), and whether the language is missing. */
function voiceFor(language: string): { voice?: string; missing: boolean } {
  if (!voices?.length) return { missing: false };
  const want = norm(language);
  const exact = voices.filter((v) => norm(v.language) === want);
  const best = exact.find((v) => v.quality === Speech.VoiceQuality.Enhanced) ?? exact[0];
  if (best) return { voice: best.identifier, missing: false };
  return { missing: !voices.some((v) => norm(v.language).split('-')[0] === want.split('-')[0]) };
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const MISSING_HINT = Platform.OS === 'ios'
  ? 'Add it in Settings › Accessibility › Spoken Content › Voices.'
  : 'Add it in Settings › Text-to-speech output › Install voice data.';

export function useReadAloud(o: Options) {
  const [state, setStateRaw] = useState<ReadAloudState>('off');
  const stateRef = useRef<ReadAloudState>('off');
  const setState = (s: ReadAloudState) => { stateRef.current = s; setStateRaw(s); };
  const oRef = useRef(o);
  oRef.current = o;
  /** bumped whenever the utterance in progress is abandoned, so its callbacks are ignored */
  const run = useRef(0);
  const chunks = useRef<string[]>([]);
  const idx = useRef(0);
  const chunksKey = useRef<string | null>(null);
  const emptyPages = useRef(0);
  const warned = useRef(new Set<string>());

  const halt = async () => { run.current++; try { await Speech.stop(); } catch { /* nothing was playing */ } };

  const stop = useCallback(() => {
    setState('off');
    chunks.current = [];
    chunksKey.current = null;
    void halt();
  }, []);

  const advance = () => {
    const cur = oRef.current;
    if (!cur.canNext()) { stop(); cur.notify('Finished reading - end of the book'); return; }
    const my = run.current;
    cur.next();
    // the page turn restarts reading (see the effect below); if it never happens, do not sit silent forever
    setTimeout(() => { if (my === run.current && stateRef.current === 'playing') { stop(); oRef.current.notify('Read aloud stopped - the next page did not open'); } }, 8000);
  };

  const speakFrom = (i: number) => {
    const my = run.current;
    idx.current = i;
    if (i >= chunks.current.length) { advance(); return; }
    const text = chunks.current[i];
    const cur = oRef.current;
    const language = cur.lang === 'auto' ? detectSpeechLang(text, cur.bookLang) : cur.lang;
    const v = voiceFor(language);
    if (v.missing && !warned.current.has(language)) {
      warned.current.add(language);
      cur.notify(`No ${SPEECH_LANG_LABELS[language]} voice on this phone. ${MISSING_HINT}`);
    }
    const onward = () => { if (my === run.current && stateRef.current === 'playing') speakFrom(i + 1); };
    Speech.speak(text, { language, voice: v.voice, rate: cur.rate, onDone: onward, onError: onward });
  };

  const readPage = async () => {
    await halt();
    const my = run.current;
    let text: string | null = null;
    for (let attempt = 0; attempt < 4 && text === null; attempt++) {
      try { text = await oRef.current.getPageText(); } catch { await sleep(400); }
      if (my !== run.current || stateRef.current !== 'playing') return;
    }
    if (text === null) { stop(); oRef.current.notify('Could not read this page aloud'); return; }
    chunks.current = splitForSpeech(text);
    chunksKey.current = oRef.current.locKey;
    if (!chunks.current.length) {
      // a picture or scanned page: move on, but do not leaf through a whole book of them
      if (++emptyPages.current >= 3) { stop(); oRef.current.notify('These pages have no text to read aloud'); return; }
      setTimeout(() => { if (my === run.current && stateRef.current === 'playing') advance(); }, 600);
      return;
    }
    emptyPages.current = 0;
    speakFrom(0);
  };

  const start = useCallback(() => {
    emptyPages.current = 0;
    setState('playing');
    void loadVoices().then(() => { if (stateRef.current === 'playing') void readPage(); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Pausing stops the engine and resuming repeats the piece in progress: the engine's own pause is missing on Android.
  const pause = useCallback(() => { if (stateRef.current !== 'playing') return; setState('paused'); void halt(); }, []);
  const resume = useCallback(() => {
    if (stateRef.current !== 'paused') return;
    setState('playing');
    if (chunksKey.current !== oRef.current.locKey) void readPage();
    else void halt().then(() => { if (stateRef.current === 'playing') speakFrom(idx.current); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // a new page on screen (our own turn, or the reader's): read it from the top
  useEffect(() => {
    if (stateRef.current === 'playing' && o.locKey && o.locKey !== chunksKey.current) void readPage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [o.locKey]);

  // voice or speed changed: say the piece in progress again the new way
  useEffect(() => {
    if (stateRef.current !== 'playing' || !chunks.current.length) return;
    void halt().then(() => { if (stateRef.current === 'playing') speakFrom(idx.current); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [o.lang, o.rate]);

  useEffect(() => () => { stateRef.current = 'off'; run.current++; void Speech.stop().catch(() => {}); }, []);

  return { state, start, pause, resume, stop };
}

/** Floating player shown over the page while a book is being read aloud. */
export function ReadAloudBar({ state, color, background, onToggle, onStop, onOptions }: {
  state: ReadAloudState; color: string; background: string; onToggle(): void; onStop(): void; onOptions(): void;
}) {
  if (state === 'off') return null;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: background, borderRadius: 24, paddingHorizontal: 6, opacity: 0.96, elevation: 6, shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 6 }}>
      <Ionicons name="volume-high-outline" size={16} color={color} style={{ marginLeft: 8 }} />
      <IconBtn icon={state === 'playing' ? 'pause' : 'play'} label={state === 'playing' ? 'Pause reading aloud' : 'Continue reading aloud'} color={color} onPress={onToggle} />
      <IconBtn icon="stop" label="Stop reading aloud" color={color} onPress={onStop} />
      <IconBtn icon="options-outline" label="Voice and speed" color={color} onPress={onOptions} />
    </View>
  );
}

export function ReadAloudPanel({ visible, onClose }: { visible: boolean; onClose(): void }) {
  const t = useAppTheme();
  const lang = useSettings((x) => x.settings.speechLang);
  const rate = useSettings((x) => x.settings.speechRate);
  const update = useSettings((x) => x.update);
  return (
    <Sheet visible={visible} title="Read aloud" onClose={onClose}>
      <ScrollView contentContainerStyle={{ padding: 16 }}>
        <Stepper label="Speed" value={rate} min={LIMITS.speechRate[0]} max={LIMITS.speechRate[1]} step={0.1} format={(v) => `${v.toFixed(1)}×`} onChange={(v) => update({ speechRate: Math.round(v * 10) / 10 })} />
        <Text style={{ color: t.muted, marginTop: 14, marginBottom: 6 }}>Voice</Text>
        {SPEECH_LANG_IDS.map((id) => {
          const sel = id === lang;
          return (
            <Pressable key={id} onPress={() => update({ speechLang: id })} accessibilityRole="radio" accessibilityState={{ selected: sel }} accessibilityLabel={SPEECH_LANG_LABELS[id]}
              style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 11, paddingHorizontal: 10, borderRadius: 8, backgroundColor: sel ? t.border : 'transparent' }}>
              <Text style={{ flex: 1, color: t.chromeText, fontSize: 16 }}>{SPEECH_LANG_LABELS[id]}</Text>
              {sel ? <Ionicons name="checkmark" size={18} color={t.accent} /> : null}
            </Pressable>
          );
        })}
        <Text style={{ color: t.muted, fontSize: 12, lineHeight: 17, marginTop: 12 }}>
          Auto reads Hindi, Tamil, Bengali and other Indian scripts in their own voice and everything else in Indian English. The voices are the ones installed on this phone. {MISSING_HINT}
          {Platform.OS === 'ios' ? ' On iPhone the ring/silent switch must be on ring to hear the voice.' : ''}
        </Text>
      </ScrollView>
    </Sheet>
  );
}
