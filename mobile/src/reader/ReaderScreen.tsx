// The reader: owns location, persistence, chrome and panels; delegates page turning to FlipBook and
// page rendering to PageSurface (WebView, reflowable) / ImageSurface (PDF render or comic image).
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, AppState, Image, Linking, PixelRatio, Pressable, Text, View, useWindowDimensions,
} from 'react-native';
import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useReducedMotion } from 'react-native-reanimated';
import * as Clipboard from 'expo-clipboard';
import { Ionicons } from '@expo/vector-icons';
import type { TocItem } from '../formats/types';
import type { Bookmark, BookRecord, ContentManifest, Highlight, HighlightColor } from '../storage/types';
import { useSettings } from '../state/settings-store';
import { useLibrary } from '../state/library-store';
import { getRepo } from '../state/repo';
import { uid } from '../storage/library-logic';
import { THEMES, perfProfile } from '../settings/themes';
import { IconBtn, PromptModal } from '../components/ui';
import { originalFile, readManifest, readSection } from '../platform/files';
import { FlipBook, type FlipBookHandle, type Role, type Side } from './FlipBook';
import { PageSurface, type ShownInfo, type SurfaceEvent, type SurfaceTarget } from './PageSurface';
import { ImageSurface } from './ImageSurface';
import { PdfRenderer, type PdfOpened, type PdfOutlineItem, type PdfRendererHandle } from './PdfRenderer';
import { createCbzProvider } from './cbz-provider';
import { chooseFlipMode, pageBox, primaryPageOfSpread, spreadCount, spreadOfPage, pagesOfSpread, type FlipMode } from './spread';
import { reflowNext, reflowPrev, rightOf, type LocRef } from './navigation';
import { pageGeometry, htmlToText, searchText, type StartPos } from './page-html';
import { fixedFraction, fromOverallFraction, overallFraction, pageToSectionFraction, percentLabel, sectionFractionToPage } from './progress';
import { AppearancePanel, BookmarksPanel, HL_COLORS, HighlightsPanel, SearchPanel, TocPanel, type SearchResultItem } from './panels';

type SetIdx = 0 | 1;
type Targets = Record<string, SurfaceTarget | null>; // sid -> target
const sidOf = (set: SetIdx, side: Side) => `${set}${side}`;
let keySeq = 0;
const nextKey = () => `k${++keySeq}`;

interface CurState { section: number; page: number; pageCount: number }
type Panel = null | 'toc' | 'bookmarks' | 'highlights' | 'search' | 'appearance';

export default function ReaderScreen({ bookId }: { bookId: string }) {
  const book = useLibrary((s) => s.books.find((b) => b.id === bookId));
  const libLoaded = useLibrary((s) => s.loaded);
  const [manifest, setManifest] = useState<ContentManifest | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!book) return;
    let alive = true;
    readManifest(book.id).then((m) => { if (alive) setManifest(m); }).catch((e) => alive && setError(e instanceof Error ? e.message : String(e)));
    void useLibrary.getState().markOpened(book.id);
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book?.id]);

  if (!book) {
    return <Centered message={libLoaded ? 'This book is no longer in your library.' : undefined} />;
  }
  if (error) return <Centered message={error} />;
  if (!manifest) return <Centered />;
  return <Reader book={book} manifest={manifest} />;
}

function Centered({ message }: { message?: string }) {
  const theme = THEMES[useSettings((s) => s.settings.theme)];
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.desk, padding: 24 }}>
      {message ? <Text style={{ color: '#f2e6cf', textAlign: 'center', marginBottom: 16, lineHeight: 21 }}>{message}</Text> : <ActivityIndicator color="#f2e6cf" />}
      {message ? <Pressable onPress={() => router.back()} style={{ padding: 12 }} accessibilityRole="button"><Text style={{ color: '#f2e6cf', fontWeight: '700' }}>Back to library</Text></Pressable> : null}
    </View>
  );
}

function Reader({ book, manifest }: { book: BookRecord; manifest: ContentManifest }) {
  const settings = useSettings((s) => s.settings);
  const theme = THEMES[settings.theme];
  const profile = perfProfile(settings.perfMode);
  const reduceMotion = useReducedMotion();
  const animate = settings.animations && !reduceMotion;
  const insets = useSafeAreaInsets();
  const win = useWindowDimensions();
  const isReflow = manifest.kind === 'reflow';
  const isPdf = book.format === 'pdf';
  const sectionCount = manifest.sections.length;
  const sectionLens = useMemo(() => manifest.sections.map((s) => s.chars), [manifest]);

  // ---------- fixed-layout page source ----------
  const [fixedInfo, setFixedInfo] = useState<{ pageCount: number; aspect: number; toc: TocItem[] } | null>(null);
  const [fixedError, setFixedError] = useState<string | null>(null);
  const pdfRef = useRef<PdfRendererHandle>(null);
  const cbzRef = useRef<Awaited<ReturnType<typeof createCbzProvider>> | null>(null);
  const origFile = useMemo(() => originalFile(book.id, book.fileName), [book.id, book.fileName]);

  useEffect(() => {
    if (isReflow || isPdf) return;
    let alive = true;
    createCbzProvider(book.id, origFile, manifest.imagePaths).then(async (prov) => {
      if (!alive) return;
      cbzRef.current = prov;
      let aspect = 2 / 3;
      try {
        const uri = await prov.getPageUri(0);
        aspect = await new Promise<number>((res) => Image.getSize(uri, (w, h) => res(w && h ? w / h : 2 / 3), () => res(2 / 3)));
      } catch { /* default aspect */ }
      if (alive) setFixedInfo({ pageCount: prov.pageCount, aspect, toc: [] });
    }).catch((e) => alive && setFixedError(`This comic could not be opened: ${e instanceof Error ? e.message : String(e)}`));
    return () => { alive = false; };
  }, [isReflow, isPdf, book.id, origFile, manifest.imagePaths]);

  const onPdfOpened = useCallback((info: PdfOpened) => {
    const conv = (items: PdfOutlineItem[]): TocItem[] => items.map((i) => ({ title: i.title, target: { page: i.page }, children: i.children?.length ? conv(i.children) : undefined }));
    setFixedInfo({ pageCount: info.pageCount, aspect: info.aspect, toc: conv(info.toc) });
    if (info.pageCount && info.pageCount !== book.pageCount) void useLibrary.getState().patchBook(book.id, { pageCount: info.pageCount });
  }, [book.id, book.pageCount]);

  // ---------- layout ----------
  const areaW = win.width - 16;
  const areaH = win.height - insets.top - insets.bottom - 16;
  const mode: FlipMode = chooseFlipMode(win.width, win.height, settings.layout);
  const aspect = isReflow ? (mode === 'double' ? 0.7 : Math.min(0.8, areaW / areaH)) : (fixedInfo?.aspect ?? 0.7);
  const { pw, ph } = pageBox(areaW, areaH, mode, aspect);
  const geom = useMemo(() => pageGeometry(pw, ph, settings), [pw, ph, settings]);
  const styleKey = `${settings.theme}|${settings.fontFamily}|${settings.fontSize}|${settings.lineHeight}|${settings.margin}|${settings.align}|${pw}x${ph}|${mode}`;
  const pageCount = fixedInfo?.pageCount ?? 0;

  // ---------- location state ----------
  const [cur, setCur] = useState<CurState | null>(null);
  const curRef = useRef<CurState | null>(null);
  curRef.current = cur;
  const [targets, setTargets] = useState<Targets>({});
  const targetsRef = useRef<Targets>({});
  const shown = useRef<Record<string, ShownInfo>>({});
  const curSet = useRef<SetIdx>(0);
  const auxFor = useRef<{ dir: 1 | -1; key: string } | null>(null);
  const waiters = useRef<{ check(): boolean; resolve(v: boolean): void }[]>([]);
  const flipRef = useRef<FlipBookHandle>(null);
  const [chrome, setChrome] = useState(true);
  const [panel, setPanel] = useState<Panel>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = (m: string) => { setToast(m); if (toastTimer.current) clearTimeout(toastTimer.current); toastTimer.current = setTimeout(() => setToast(null), 2200); };

  const updateTargets = (patch: Targets) => {
    targetsRef.current = { ...targetsRef.current, ...patch };
    setTargets(targetsRef.current);
  };
  const auxSet = (): SetIdx => (1 - curSet.current) as SetIdx;
  const primarySide: Side = mode === 'double' ? 'L' : 'R';

  /** set a view (single page or spread) into a set; double reflow derives the right page after the left resolves */
  const assignSet = (set: SetIdx, ref: { section: number; pos: StartPos }) => {
    if (isReflow) {
      const t: SurfaceTarget = { section: ref.section, pos: ref.pos, key: nextKey() };
      const patch: Targets = { [sidOf(set, primarySide)]: t };
      if (mode === 'double') {
        // when the left page is a known number, the right one is known too
        const pg = 'page' in ref.pos ? ref.pos.page : null;
        patch[sidOf(set, 'R')] = pg !== null ? { section: ref.section, pos: { page: rightOf(pg) }, key: nextKey() } : null;
        pendingRight.current[set] = pg === null;
      }
      updateTargets(patch);
    } else {
      const page = 'page' in ref.pos && typeof ref.pos.page === 'number' ? ref.pos.page : 0;
      if (mode === 'double') {
        const [l, r] = pagesOfSpread(spreadOfPage(page, 'double'), 'double', pageCount);
        updateTargets({
          [sidOf(set, 'L')]: l === null ? null : { section: 0, pos: { page: l }, key: nextKey() },
          [sidOf(set, 'R')]: r === null ? null : { section: 0, pos: { page: r }, key: nextKey() },
        });
      } else {
        updateTargets({ [sidOf(set, 'R')]: { section: 0, pos: { page }, key: nextKey() } });
      }
    }
  };
  const pendingRight = useRef<Record<number, boolean>>({});

  const setReady = (set: SetIdx) => {
    const sides: Side[] = mode === 'double' ? ['L', 'R'] : ['R'];
    return sides.every((side) => {
      const sid = sidOf(set, side);
      const tg = targetsRef.current[sid];
      if (tg === undefined) return false;
      if (tg === null) return !(mode === 'double' && isReflow && pendingRight.current[set]);
      return shown.current[sid]?.key === tg.key;
    });
  };
  const checkWaiters = () => {
    waiters.current = waiters.current.filter((w) => { if (w.check()) { w.resolve(true); return false; } return true; });
  };
  const waitFor = (check: () => boolean, ms = 3000) => new Promise<boolean>((resolve) => {
    if (check()) { resolve(true); return; }
    const w = { check, resolve };
    waiters.current.push(w);
    setTimeout(() => { if (waiters.current.includes(w)) { waiters.current = waiters.current.filter((x) => x !== w); resolve(false); } }, ms);
  });

  // ---------- neighbours ----------
  const neighbor = (dir: 1 | -1): { section: number; pos: StartPos } | null => {
    const c = curRef.current;
    if (!c) return null;
    if (isReflow) {
      const r: LocRef | null = dir === 1 ? reflowNext(c, c.pageCount, sectionCount, mode) : reflowPrev(c, mode);
      return r ? { section: r.section, pos: { page: r.page } } : null;
    }
    const s = spreadOfPage(c.page, mode) + dir;
    if (s < 0 || s >= spreadCount(pageCount, mode)) return null;
    return { section: 0, pos: { page: primaryPageOfSpread(s, mode, pageCount) } };
  };

  const canTurn = (dir: 1 | -1) => neighbor(dir) !== null;

  const prepareAux = async (dir: 1 | -1): Promise<boolean> => {
    const n = neighbor(dir);
    if (!n) return false;
    const a = auxSet();
    const sig = `${dir}:${curRef.current?.section}:${curRef.current?.page}:${styleKey}`;
    if (!(auxFor.current && auxFor.current.key === sig)) {
      auxFor.current = { dir, key: sig };
      assignSet(a, n);
    }
    return waitFor(() => setReady(a), 4000);
  };

  const onCommitted = (_dir: 1 | -1, newCur: SetIdx) => {
    curSet.current = newCur;
    auxFor.current = null;
    const info = shown.current[sidOf(newCur, primarySide)];
    if (info) commitLoc(info);
    // preload forward neighbour into the (new) auxiliary set
    if (profile.preloadNeighbor) setTimeout(() => { void prepareAux(1); }, 30);
  };

  const turnInPlace = async (dir: 1 | -1) => {
    const n = neighbor(dir);
    if (!n) return false;
    assignSet(curSet.current, n);
    return waitFor(() => setReady(curSet.current), 4000);
  };

  // ---------- progress ----------
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const persist = useCallback((c: CurState) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const fraction = isReflow
        ? overallFraction(c.section, pageToSectionFraction(c.page, c.pageCount), sectionLens)
        : fixedFraction(c.page, c.pageCount);
      void useLibrary.getState().setProgress({
        bookId: book.id, fraction, updatedAt: Date.now(),
        ...(isReflow ? { section: c.section, sectionFraction: pageToSectionFraction(c.page, c.pageCount) } : { page: c.page }),
      });
    }, 350);
  }, [book.id, isReflow, sectionLens]);

  const commitLoc = (info: ShownInfo) => {
    const c: CurState = isReflow ? { section: info.section, page: info.page, pageCount: info.pageCount } : { section: 0, page: info.page, pageCount };
    setCur(c);
    curRef.current = c;
    persist(c);
  };

  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => { if (s !== 'active' && curRef.current) persist(curRef.current); });
    return () => sub.remove();
  }, [persist]);

  // ---------- surface reports ----------
  const onShown = useCallback((sid: string, info: ShownInfo) => {
    shown.current[sid] = info;
    const set = Number(sid[0]) as SetIdx;
    const side = sid[1] as Side;
    // double reflow: derive right page from the resolved left page
    if (isReflow && mode === 'double' && side === 'L' && targetsRef.current[sid]?.key === info.key && info.key) {
      const want = info.blank ? null : info.page + 1;
      const rt = targetsRef.current[sidOf(set, 'R')];
      const has = rt && 'page' in rt.pos && rt.pos.page === want && rt.section === info.section;
      if (pendingRight.current[set] || !has) {
        pendingRight.current[set] = false;
        updateTargets({ [sidOf(set, 'R')]: want === null ? null : { section: info.section, pos: { page: want }, key: nextKey() } });
      }
    }
    if (set === curSet.current && side === primarySide && targetsRef.current[sid]?.key === info.key && !info.blank) {
      commitLoc(info);
      if (profile.preloadNeighbor && !flipRef.current?.busy()) setTimeout(() => { if (!flipRef.current?.busy()) void prepareAux(1); }, 60);
    }
    checkWaiters();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReflow, mode, primarySide, profile.preloadNeighbor, styleKey]);

  const onImageShown = useCallback((sid: string, page: number | null) => {
    const tg = targetsRef.current[sid];
    onShown(sid, { section: 0, page: page ?? 0, pageCount, blank: page === null, key: tg?.key ?? null });
  }, [onShown, pageCount]);

  // ---------- initial position & re-layout ----------
  const jumpTo = useCallback((ref: { section: number; pos: StartPos }) => {
    auxFor.current = null;
    assignSet(curSet.current, ref);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, isReflow, pageCount, primarySide]);

  useEffect(() => {
    if (!isReflow && !fixedInfo) return;
    let alive = true;
    (async () => {
      // reset all surfaces for the new layout
      targetsRef.current = {};
      shown.current = {};
      pendingRight.current = {};
      auxFor.current = null;
      const c = curRef.current;
      if (c) {
        // re-layout: keep the reading position
        jumpTo(isReflow ? { section: c.section, pos: { fraction: pageToSectionFraction(c.page, c.pageCount) } } : { section: 0, pos: { page: c.page } });
        return;
      }
      const p = await (await getRepo()).getProgress(book.id);
      if (!alive) return;
      if (isReflow) {
        const sec = Math.min(Math.max(0, p?.section ?? 0), sectionCount - 1);
        jumpTo({ section: sec, pos: { fraction: p?.sectionFraction ?? 0 } });
      } else {
        jumpTo({ section: 0, pos: { page: Math.min(Math.max(0, p?.page ?? 0), Math.max(0, pageCount - 1)) } });
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [styleKey, !!fixedInfo, pageCount]);

  // ---------- highlights & bookmarks ----------
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [hlVersion, setHlVersion] = useState(0);
  useEffect(() => {
    let alive = true;
    void getRepo().then(async (r) => {
      const [h, b] = await Promise.all([r.listHighlights(book.id), r.listBookmarks(book.id)]);
      if (alive) { setHighlights(h); setBookmarks(b); setHlVersion((v) => v + 1); }
    });
    return () => { alive = false; };
  }, [book.id]);
  const hlRef = useRef(highlights);
  hlRef.current = highlights;
  const highlightsFor = useCallback((section: number) => hlRef.current.filter((h) => h.section === section).map((h) => ({ id: h.id, start: h.start, end: h.end, color: h.color, note: h.note })), []);

  const [selection, setSelection] = useState<{ section: number; text: string; start: number; end: number } | null>(null);
  const [noteEdit, setNoteEdit] = useState<Highlight | null>(null);

  const addHighlight = async (color: HighlightColor, withNote = false) => {
    if (!selection) return;
    const h: Highlight = { id: uid(), bookId: book.id, createdAt: Date.now(), section: selection.section, start: selection.start, end: selection.end, text: selection.text.slice(0, 1000), color };
    await (await getRepo()).putHighlight(h);
    setHighlights((l) => [...l, h].sort((a, b) => a.section - b.section || a.start - b.start));
    setHlVersion((v) => v + 1);
    setSelection(null);
    if (withNote) setNoteEdit(h);
  };
  const saveNote = async (h: Highlight, note: string) => {
    const n = { ...h, note: note.trim() || undefined };
    await (await getRepo()).putHighlight(n);
    setHighlights((l) => l.map((x) => (x.id === h.id ? n : x)));
    setHlVersion((v) => v + 1);
  };
  const deleteHighlight = async (h: Highlight) => {
    await (await getRepo()).deleteHighlight(h.id);
    setHighlights((l) => l.filter((x) => x.id !== h.id));
    setHlVersion((v) => v + 1);
  };

  const sectionTitle = useCallback((n: number) => {
    if (!isReflow) return `Page ${n + 1}`;
    let best: string | undefined;
    const walk = (items: TocItem[]) => items.forEach((i) => { if ('section' in i.target && i.target.section <= n) best = i.title; if (i.children) walk(i.children); });
    walk(manifest.toc);
    return manifest.sections[n]?.title ?? best ?? `Part ${n + 1}`;
  }, [isReflow, manifest]);

  const currentFraction = cur ? (isReflow ? overallFraction(cur.section, pageToSectionFraction(cur.page, cur.pageCount), sectionLens) : fixedFraction(cur.page, pageCount)) : 0;
  const bookmarkHere = cur ? bookmarks.find((b) => (isReflow
    ? b.section === cur.section && sectionFractionToPage(b.sectionFraction ?? 0, cur.pageCount) === cur.page
    : b.page === cur.page)) : undefined;

  const toggleBookmark = async () => {
    if (!cur) return;
    const r = await getRepo();
    if (bookmarkHere) {
      await r.deleteBookmark(bookmarkHere.id);
      setBookmarks((l) => l.filter((b) => b.id !== bookmarkHere.id));
      showToast('Bookmark removed');
      return;
    }
    const b: Bookmark = isReflow
      ? { id: uid(), bookId: book.id, createdAt: Date.now(), label: `${sectionTitle(cur.section)} · ${percentLabel(currentFraction)}`, section: cur.section, sectionFraction: pageToSectionFraction(cur.page, cur.pageCount) }
      : { id: uid(), bookId: book.id, createdAt: Date.now(), label: `Page ${cur.page + 1} of ${pageCount}`, page: cur.page };
    await r.putBookmark(b);
    setBookmarks((l) => [...l, b]);
    showToast('Bookmarked');
  };

  // ---------- search ----------
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<(SearchResultItem & { section: number; start: number; end: number; page?: number })[]>([]);
  const [searching, setSearching] = useState<string | null>(null);
  const [searchMark, setSearchMark] = useState<{ section: number; start: number; end: number } | null>(null);
  const textCache = useRef<string[] | null>(null);
  const searchToken = useRef(0);
  const runSearch = async () => {
    const q = query.trim();
    if (q.length < 2) return;
    const token = ++searchToken.current;
    setResults([]);
    if (isReflow) {
      setSearching('Searching…');
      if (!textCache.current) {
        const arr: string[] = [];
        for (let i = 0; i < sectionCount; i++) arr.push(htmlToText(await readSection(book.id, i)));
        textCache.current = arr;
      }
      if (token !== searchToken.current) return;
      const hits = searchText(textCache.current, q, 300);
      setResults(hits.map((h, i) => ({ key: `${i}`, label: sectionTitle(h.section), snippet: h.snippet, section: h.section, start: h.start, end: h.end })));
      setSearching(null);
    } else if (isPdf && pdfRef.current) {
      const out: typeof results = [];
      const lc = q.toLowerCase();
      for (let p = 0; p < pageCount; p++) {
        if (token !== searchToken.current) return;
        if (p % 5 === 0) setSearching(`Searching page ${p + 1} of ${pageCount}…`);
        const text = await pdfRef.current.getText(p);
        let idx = text.toLowerCase().indexOf(lc);
        while (idx >= 0 && out.length < 300) {
          const a = Math.max(0, idx - 40);
          out.push({ key: `${p}-${idx}`, label: `Page ${p + 1}`, snippet: `…${text.slice(a, idx + q.length + 40)}…`, section: 0, start: idx, end: idx + q.length, page: p });
          idx = text.toLowerCase().indexOf(lc, idx + q.length);
        }
        if (out.length && p % 10 === 0) setResults([...out]);
      }
      setResults(out);
      setSearching(null);
    }
  };

  // ---------- surface events (from WebViews) ----------
  const onEvent = useCallback((sid: string, e: SurfaceEvent) => {
    const fb = flipRef.current;
    switch (e.type) {
      case 'tap': {
        if (selection) { setSelection(null); return; }
        const side = sid[1];
        // x is relative to the page; convert to a book-wide fraction in double mode
        const x = mode === 'double' ? (side === 'L' ? e.x / 2 : 0.5 + e.x / 2) : e.x;
        fb?.tap(x);
        return;
      }
      case 'dragStart': fb?.dragStart(e.dx); return;
      case 'drag': fb?.drag(e.dx); return;
      case 'dragEnd': fb?.dragEnd(e.dx, e.vx); return;
      case 'link':
        if (Number.isFinite(e.section) && e.section >= 0 && e.section < sectionCount) {
          jumpTo({ section: e.section, pos: e.anchor ? { anchor: e.anchor } : { page: 0 } });
        }
        return;
      case 'ext':
        Alert.alert('Open external link?', `${e.url}\n\nThis leaves the app and opens your browser or mail app.`, [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Open', onPress: () => { void Linking.openURL(e.url).catch(() => Alert.alert('Could not open link', e.url)); } },
        ]);
        return;
      case 'selection': {
        const info = shown.current[sid];
        if (!e.text || e.start === undefined || e.end === undefined || !info) { setSelection(null); return; }
        setSelection({ section: info.section, text: e.text, start: e.start, end: e.end });
        return;
      }
      case 'hl': {
        const h = hlRef.current.find((x) => x.id === e.id);
        if (!h) return;
        Alert.alert('Highlight', h.note ? `${h.text}\n\nNote: ${h.note}` : h.text, [
          { text: h.note ? 'Edit note' : 'Add note', onPress: () => setNoteEdit(h) },
          { text: 'Delete highlight', style: 'destructive', onPress: () => void deleteHighlight(h) },
          { text: 'Close', style: 'cancel' },
        ]);
        return;
      }
      default:
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, selection, sectionCount, jumpTo]);

  // ---------- rendering ----------
  const getPdfPage = useCallback((page: number) => {
    if (!pdfRef.current) return Promise.reject(new Error('PDF engine not ready'));
    return pdfRef.current.getPageUri(page, Math.round(pw * Math.min(2.5, PixelRatio.get())));
  }, [pw]);
  const getCbzPage = useCallback((page: number) => {
    if (!cbzRef.current) return Promise.reject(new Error('Comic not ready'));
    return cbzRef.current.getPageUri(page);
  }, []);
  const getSection = useCallback((n: number) => readSection(book.id, n), [book.id]);

  const renderSurface = (set: SetIdx, side: Side, role: Role) => {
    const sid = sidOf(set, side);
    const tg = targets[sid] ?? null;
    if (isReflow) {
      return (
        <PageSurface
          sid={sid} target={tg} getSection={getSection} settings={settings} styleKey={styleKey} geom={geom}
          even={mode === 'double' && side === 'L'} lang={book.metadata.language}
          highlightsFor={highlightsFor} highlightsVersion={hlVersion} searchMark={searchMark}
          interactive={role === 'cur'} pageColor={settings.customPageColor ?? theme.page}
          onShown={onShown} onEvent={onEvent}
        />
      );
    }
    const page = tg && 'page' in tg.pos && typeof tg.pos.page === 'number' ? tg.pos.page : null;
    return (
      <ImageSurface sid={sid} page={tg ? page : null} targetKey={tg?.key ?? null} getPageUri={isPdf ? getPdfPage : getCbzPage}
        pageColor={isPdf ? '#ffffff' : theme.page} textColor={theme.text} onShown={onImageShown} dim={theme.dark} />
    );
  };

  const fixedReady = isReflow || !!fixedInfo;
  const fatal = fixedError;
  const progressLabel = cur
    ? isReflow
      ? `${sectionTitle(cur.section)} · page ${cur.page + 1}/${cur.pageCount} · ${percentLabel(currentFraction)}`
      : mode === 'double'
        ? `Pages ${visibleLabel(cur.page, pageCount)} of ${pageCount} · ${percentLabel(currentFraction)}`
        : `Page ${cur.page + 1} of ${pageCount} · ${percentLabel(currentFraction)}`
    : 'Opening…';

  const scrubTo = (f: number) => {
    if (isReflow) {
      const { section, sectionFraction } = fromOverallFraction(f, sectionLens);
      jumpTo({ section, pos: { fraction: sectionFraction } });
    } else if (pageCount) {
      jumpTo({ section: 0, pos: { page: Math.round(f * (pageCount - 1)) } });
    }
  };

  const tocSelect = (item: TocItem) => {
    setPanel(null);
    if ('page' in item.target) jumpTo({ section: 0, pos: { page: item.target.page } });
    else jumpTo({ section: item.target.section, pos: item.target.anchor ? { anchor: item.target.anchor } : { page: 0 } });
  };

  return (
    <View style={{ flex: 1, backgroundColor: settings.customDeskColor ?? theme.desk }}>
      <StatusBar hidden={!chrome} style={theme.dark ? 'light' : 'dark'} />
      {isPdf ? <PdfRenderer ref={pdfRef} bookId={book.id} file={origFile} onOpened={onPdfOpened} onError={setFixedError} /> : null}
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: insets.top, paddingBottom: insets.bottom }}>
        {fatal ? (
          <View style={{ padding: 24, maxWidth: 520 }}>
            <Text style={{ color: '#f2e6cf', textAlign: 'center', lineHeight: 21 }}>{fatal}</Text>
            <Pressable onPress={() => router.back()} style={{ padding: 14, alignSelf: 'center' }} accessibilityRole="button"><Text style={{ color: '#f2e6cf', fontWeight: '700' }}>Back to library</Text></Pressable>
          </View>
        ) : !fixedReady ? <ActivityIndicator color="#f2e6cf" /> : (
          <View style={{ shadowColor: '#000', shadowOpacity: 0.5 * (0.4 + settings.shadowStrength), shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 12 }}>
            <FlipBook
              ref={flipRef}
              mode={mode} pw={pw} ph={ph} theme={theme} profile={profile} animate={animate}
              speed={settings.animationSpeed} shadowStrength={settings.shadowStrength} readFraction={currentFraction}
              renderSurface={renderSurface} canTurn={canTurn} prepareAux={prepareAux} onCommitted={onCommitted}
              turnInPlace={turnInPlace} onCenterTap={() => { setSelection(null); setChrome((c) => !c); }}
              nativeGestures={!isReflow} onEdgeReached={(d) => showToast(d === 1 ? 'End of the book' : 'Beginning of the book')}
            />
          </View>
        )}
      </View>

      {chrome ? (
        <>
          <View style={{ position: 'absolute', top: 0, left: 0, right: 0, paddingTop: insets.top, backgroundColor: theme.chrome, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 4, borderBottomWidth: 1, borderColor: 'rgba(0,0,0,0.1)' }}>
            <IconBtn icon="chevron-back" label="Back to library" color={theme.chromeText} onPress={() => router.back()} />
            <Text style={{ flex: 1, color: theme.chromeText, fontWeight: '600' }} numberOfLines={1}>{book.metadata.title}</Text>
            <IconBtn icon="list" label="Contents" color={theme.chromeText} onPress={() => setPanel('toc')} />
            <IconBtn icon="search" label="Search in book" color={theme.chromeText} onPress={() => setPanel('search')} />
            {isReflow ? <IconBtn icon="color-wand-outline" label="Highlights and notes" color={theme.chromeText} onPress={() => setPanel('highlights')} /> : null}
            <IconBtn icon={bookmarkHere ? 'bookmark' : 'bookmark-outline'} label={bookmarkHere ? 'Remove bookmark' : 'Add bookmark'} color={theme.chromeText} onPress={() => void toggleBookmark()} />
            <IconBtn icon="albums-outline" label="Bookmarks" color={theme.chromeText} onPress={() => setPanel('bookmarks')} />
            <IconBtn icon="text" label="Appearance" color={theme.chromeText} onPress={() => setPanel('appearance')} />
          </View>
          <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, paddingBottom: insets.bottom + 6, paddingTop: 8, paddingHorizontal: 14, backgroundColor: theme.chrome, borderTopWidth: 1, borderColor: 'rgba(0,0,0,0.1)' }}>
            <Scrubber fraction={currentFraction} color={theme.accent} track={theme.edge} onSeek={scrubTo} />
            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
              <IconBtn icon="chevron-back-circle-outline" label="Previous page" color={theme.chromeText} onPress={() => flipRef.current?.prev()} />
              <Text style={{ flex: 1, color: theme.muted, fontSize: 12, textAlign: 'center' }} numberOfLines={1}>{progressLabel}</Text>
              <IconBtn icon="chevron-forward-circle-outline" label="Next page" color={theme.chromeText} onPress={() => flipRef.current?.next()} />
            </View>
          </View>
        </>
      ) : null}

      {selection ? (
        <View style={{ position: 'absolute', left: 12, right: 12, bottom: insets.bottom + (chrome ? 96 : 16), backgroundColor: theme.chrome, borderRadius: 14, padding: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around', elevation: 8, shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 8 }}>
          {(Object.keys(HL_COLORS) as HighlightColor[]).map((c) => (
            <Pressable key={c} onPress={() => void addHighlight(c)} accessibilityRole="button" accessibilityLabel={`Highlight ${c}`}
              style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: HL_COLORS[c], borderWidth: 2, borderColor: theme.chromeText }} />
          ))}
          <IconBtn icon="create-outline" label="Highlight with note" color={theme.chromeText} onPress={() => void addHighlight('yellow', true)} />
          <IconBtn icon="copy-outline" label="Copy text" color={theme.chromeText} onPress={() => { void Clipboard.setStringAsync(selection.text); setSelection(null); showToast('Copied'); }} />
          <IconBtn icon="close" label="Dismiss" color={theme.chromeText} onPress={() => setSelection(null)} />
        </View>
      ) : null}

      {toast ? (
        <View pointerEvents="none" style={{ position: 'absolute', alignSelf: 'center', top: insets.top + 70, backgroundColor: 'rgba(0,0,0,0.75)', borderRadius: 16, paddingHorizontal: 14, paddingVertical: 7 }}>
          <Text style={{ color: '#fff' }}>{toast}</Text>
        </View>
      ) : null}

      <TocPanel visible={panel === 'toc'} toc={isReflow ? manifest.toc : (fixedInfo?.toc ?? [])} currentSection={cur?.section} onClose={() => setPanel(null)} onSelect={tocSelect} />
      <BookmarksPanel visible={panel === 'bookmarks'} bookmarks={bookmarks} onClose={() => setPanel(null)}
        onSelect={(b) => { setPanel(null); if (b.page !== undefined) jumpTo({ section: 0, pos: { page: b.page } }); else jumpTo({ section: b.section ?? 0, pos: { fraction: b.sectionFraction ?? 0 } }); }}
        onDelete={(b) => { void getRepo().then((r) => r.deleteBookmark(b.id)); setBookmarks((l) => l.filter((x) => x.id !== b.id)); }} />
      <HighlightsPanel visible={panel === 'highlights'} highlights={highlights} sectionTitle={sectionTitle} onClose={() => setPanel(null)}
        onSelect={(h) => { setPanel(null); jumpTo({ section: h.section, pos: { offset: h.start } }); }}
        onEdit={(h) => { setPanel(null); setNoteEdit(h); }} onDelete={(h) => void deleteHighlight(h)} />
      <SearchPanel visible={panel === 'search'} query={query} setQuery={setQuery} onSubmit={() => void runSearch()} results={results}
        busy={!!searching} progressLabel={searching ?? undefined} onClose={() => { searchToken.current++; setSearching(null); setPanel(null); }}
        disabledReason={!isReflow && !isPdf ? 'Comic books are images without text, so they cannot be searched.' : undefined}
        onSelect={(i) => {
          const r = results[i];
          setPanel(null);
          if (r.page !== undefined) { jumpTo({ section: 0, pos: { page: r.page } }); return; }
          setSearchMark({ section: r.section, start: r.start, end: r.end });
          jumpTo({ section: r.section, pos: { offset: r.start } });
        }} />
      <AppearancePanel visible={panel === 'appearance'} onClose={() => setPanel(null)} reflow={isReflow} />
      <PromptModal visible={!!noteEdit} title="Note" message={noteEdit?.text.slice(0, 160)} initial={noteEdit?.note ?? ''} multiline
        placeholder="Write a note for this highlight" onCancel={() => setNoteEdit(null)}
        onSubmit={(v) => { const h = noteEdit; setNoteEdit(null); if (h) void saveNote(h, v); }} />
    </View>
  );
}

function visibleLabel(page: number, count: number): string {
  const [l, r] = pagesOfSpread(spreadOfPage(page, 'double'), 'double', count);
  if (l !== null && r !== null) return `${l + 1}–${r + 1}`;
  return `${(l ?? r ?? 0) + 1}`;
}

/** Touch-draggable progress bar; seeks on release. */
function Scrubber({ fraction, color, track, onSeek }: { fraction: number; color: string; track: string; onSeek(f: number): void }) {
  const [w, setW] = useState(1);
  const [drag, setDrag] = useState<number | null>(null);
  const f = drag ?? fraction;
  const at = (x: number) => Math.max(0, Math.min(1, x / w));
  return (
    <View
      onLayout={(e) => setW(Math.max(1, e.nativeEvent.layout.width))}
      onStartShouldSetResponder={() => true}
      onMoveShouldSetResponder={() => true}
      onResponderGrant={(e) => setDrag(at(e.nativeEvent.locationX))}
      onResponderMove={(e) => setDrag(at(e.nativeEvent.locationX))}
      onResponderRelease={(e) => { const v = at(e.nativeEvent.locationX); setDrag(null); onSeek(v); }}
      onResponderTerminate={() => setDrag(null)}
      accessibilityRole="adjustable"
      accessibilityLabel="Reading position"
      accessibilityValue={{ min: 0, max: 100, now: Math.round(f * 100) }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(e) => onSeek(Math.max(0, Math.min(1, fraction + (e.nativeEvent.actionName === 'increment' ? 0.05 : -0.05))))}
      style={{ height: 28, justifyContent: 'center' }}
    >
      <View style={{ height: 4, borderRadius: 2, backgroundColor: track }}>
        <View style={{ width: `${f * 100}%`, height: 4, borderRadius: 2, backgroundColor: color }} />
      </View>
      <View style={{ position: 'absolute', left: f * w - 8, width: 16, height: 16, borderRadius: 8, backgroundColor: color }} />
    </View>
  );
}
