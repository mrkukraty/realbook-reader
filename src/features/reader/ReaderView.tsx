import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { storage } from '../../storage';
import { toast } from '../../app/feedback';
import { useSettings } from '../../settings/store';
import type { BookRecord, Bookmark, Highlight, ProgressRecord } from '../../storage/StorageAdapter';
import type { BookDocument, PageLink, Target } from '../../formats/types';
import { Book, bookChrome } from '../page-flip/Book';
import { perfProfile } from '../page-flip/perf';
import { spreadOfPage, visiblePages } from '../page-flip/spread';
import type { PageFlipEngine } from '../page-flip/types';
import { computeBookSize, FONT_STACKS, flowGeometry, layoutKey, resolveMode } from './layout';
import { resolveTheme, themeVars } from './themes';
import type { ReaderContent, SearchHit } from './content';
import { ReflowContent } from './reflow/ReflowContent';
import type { ReflowInfo } from './reflow/ReflowPage';
import { FixedContent } from './fixed/FixedContent';
import { IconButton } from './ui/parts';
import { TocPanel } from './ui/TocPanel';
import { SettingsPanel } from './ui/SettingsPanel';
import { HelpPanel } from './ui/HelpPanel';
import { LoadingScreen } from './ui/ErrorScreen';
import { SearchPanel } from '../search/SearchPanel';
import { BookmarksList } from '../bookmarks/BookmarksPanel';
import { HighlightPopover, HighlightsList, SelectionToolbar } from '../highlights/HighlightsPanel';
import { rangeToOffsets } from '../highlights/apply';
import { Panel } from './ui/parts';

export interface ReaderViewProps {
  bookId: string; record: BookRecord; doc: BookDocument;
  progress?: ProgressRecord; bookmarks: Bookmark[]; highlights: Highlight[];
  onBack: () => void;
}

type PanelId = null | 'toc' | 'search' | 'marks' | 'settings' | 'help';
interface Applied { mode: 'single' | 'double'; pageW: number; pageH: number; info?: ReflowInfo; sig: string }
interface SelState { rect: DOMRect; chunk: number; start: number; end: number; text: string }

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
const noopSub = () => () => {};

export function ReaderView({ bookId, record, doc, progress, bookmarks: bm0, highlights: hl0, onBack }: ReaderViewProps) {
  const settings = useSettings((s) => s.settings);
  const rootRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const engine = useRef<PageFlipEngine>(null);
  const [stage, setStage] = useState({ w: 0, h: 0 });
  const [content, setContent] = useState<ReaderContent | null>(null);
  const [applied, setApplied] = useState<Applied | null>(null);
  const [panel, setPanel] = useState<PanelId>(null);
  const [marksTab, setMarksTab] = useState<'bookmarks' | 'highlights'>('bookmarks');
  const [uiVisible, setUiVisible] = useState(true);
  const [bookmarks, setBookmarks] = useState(bm0);
  const [highlights, setHighlights] = useState(hl0);
  const [sel, setSel] = useState<SelState | null>(null);
  const [pop, setPop] = useState<{ id: string; rect: DOMRect; focusNote?: boolean } | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [announce, setAnnounce] = useState('');
  const [sliderDrag, setSliderDrag] = useState<number | null>(null);
  const isReflow = doc.kind === 'reflow';
  const perf = perfProfile(settings.perfMode);

  useSyncExternalStore(content ? content.subscribe : noopSub, content ? content.getVersion : () => 0);

  // ---------- stage size ----------
  useEffect(() => {
    const el = stageRef.current; if (!el) return;
    const ro = new ResizeObserver((es) => { const r = es[0].contentRect; setStage({ w: Math.floor(r.width), h: Math.floor(r.height) }); });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ---------- content lifecycle ----------
  const linkRef = useRef<(l: PageLink) => void>(() => {});
  useEffect(() => {
    const host = rootRef.current; if (!host) return;
    const c: ReaderContent = doc.kind === 'reflow'
      ? new ReflowContent(bookId, doc, host)
      : new FixedContent(doc, host, { openLink: (l) => linkRef.current(l) });
    setContent(c);
    startedRef.current = false;
    return () => { c.dispose(); setContent(null); setApplied(null); };
  }, [doc, bookId]);

  // ---------- geometry ----------
  const mode = resolveMode(settings.layout, stage.w, stage.h);
  const compact = stage.w < 700;
  const geo = useMemo(() => {
    if (!stage.w || !stage.h) return null;
    const chrome = bookChrome(0, settings.frame);
    const aspect = doc.kind === 'fixed' ? Math.min(3, Math.max(0.3, doc.aspect || 0.7)) : 0.68;
    const size = computeBookSize({ stageW: stage.w, stageH: stage.h, mode, aspect, flex: doc.kind === 'reflow', readingWidth: settings.readingWidth, framePad: chrome.framePad, edge: chrome.edge, reserveY: 0 });
    let info: ReflowInfo | undefined;
    if (doc.kind === 'reflow') {
      const g = flowGeometry(size.pageW, size.pageH, settings.margin);
      const typo = { fontFamily: FONT_STACKS[settings.fontFamily], fontSize: settings.fontSize, lineHeight: settings.lineHeight, align: settings.align, lang: doc.metadata.language };
      info = { style: { cw: g.cw, ch: g.ch, ...typo }, key: layoutKey(mode, g, typo), padX: g.padX, padY: g.padY, pageW: size.pageW, pageH: size.pageH };
    }
    return { mode, pageW: size.pageW, pageH: size.pageH, info, sig: `${mode}|${size.pageW}x${size.pageH}|${info?.key ?? ''}` } as Applied;
  }, [stage.w, stage.h, mode, settings.frame, settings.readingWidth, settings.margin, settings.fontFamily, settings.fontSize, settings.lineHeight, settings.align, doc]);

  // debounce geometry/typography changes (first one is immediate)
  useEffect(() => {
    if (!geo) return;
    if (!applied) { setApplied(geo); return; }
    if (applied.sig === geo.sig) return;
    const t = setTimeout(() => setApplied(geo), 220);
    return () => clearTimeout(t);
  }, [geo, applied]);

  const startedRef = useRef(false);
  useEffect(() => {
    if (!content || !applied) return;
    if (content instanceof ReflowContent && applied.info) {
      void content.setLayout(applied.info, startedRef.current ? undefined : { section: progress?.section, sectionFraction: progress?.sectionFraction });
    } else if (content instanceof FixedContent) {
      if (!startedRef.current) content.setPageIndex(progress?.page ?? 0);
      content.setLayout(applied.pageW, applied.pageH, perf.cacheRadius);
    }
    startedRef.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content, applied?.sig, perf.cacheRadius]);

  useEffect(() => { if (content instanceof ReflowContent) content.setHighlights(highlights); }, [content, highlights]);

  // ---------- progress persistence ----------
  const posRef = useRef<ProgressRecord | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flush = useCallback(() => {
    if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null; }
    const p = posRef.current; posRef.current = null;
    if (p) void storage.saveProgress(p).catch(() => {});
  }, []);
  const scheduleSave = useCallback(() => {
    if (!content || !content.ready) return;
    posRef.current = { bookId, ...content.savedPosition(), updatedAt: Date.now() };
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(flush, 600);
  }, [content, bookId, flush]);
  useEffect(() => {
    const vis = () => { if (document.visibilityState === 'hidden') flush(); };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', vis);
    return () => { window.removeEventListener('pagehide', flush); document.removeEventListener('visibilitychange', vis); flush(); };
  }, [flush]);
  useEffect(() => { void storage.updateBook(bookId, { lastOpenedAt: Date.now() }).catch(() => {}); }, [bookId]);
  // layout changes can remap the page index of the same position: store the position again once settled
  const complete = content?.complete;
  useEffect(() => { if (complete) scheduleSave(); }, [complete, scheduleSave]);

  // ---------- derived state ----------
  const count = content?.pageCount ?? 1;
  const pageIndex = content?.pageIndex ?? 0;
  const bookMode = applied?.mode ?? mode;
  const spread = spreadOfPage(pageIndex, bookMode);
  const visible = visiblePages(spread, bookMode, count);
  const chapter = content?.chapterAt(pageIndex) ?? '';
  const estimated = isReflow && !!content && !content.complete;
  const pageLabel = visible.length > 1 ? `${visible[0] + 1}–${visible[1] + 1}` : `${(visible[0] ?? pageIndex) + 1}`;
  const counter = `Page ${estimated ? '~' : ''}${pageLabel} of ${estimated ? '~' : ''}${count}`;
  useEffect(() => { setAnnounce(`${counter}${chapter ? `. ${chapter}` : ''}`); }, [counter, chapter]);

  const bmHere = content ? bookmarks.filter((b) => { const i = content.indexOfAnchor(b); return i !== undefined && visible.includes(i); }) : [];

  // ---------- navigation ----------
  const keepHit = useRef(false);
  const goIndex = useCallback((i: number, animate = false) => { engine.current?.goTo(i, { animate }); }, []);
  const goTarget = useCallback(async (t: Target, keep = false) => {
    if (!content) return;
    const i = await content.resolveTarget(t);
    if (i === undefined) return;
    keepHit.current = keep; goIndex(i); keepHit.current = false;
  }, [content, goIndex]);
  const onTurn = useCallback((i: number) => {
    if (!content) return;
    if (!keepHit.current) content.clearHit();
    content.setPageIndex(i);
    scheduleSave();
  }, [content, scheduleSave]);
  linkRef.current = (l) => {
    if (l.target) void goTarget(l.target);
    else if (l.url) window.open(l.url, '_blank', 'noopener,noreferrer');
  };

  const next = () => engine.current?.next();
  const prev = () => engine.current?.prev();

  // links inside reflow pages
  const onStageClick = (e: React.MouseEvent) => {
    const t = e.target as HTMLElement;
    const mark = t.closest<HTMLElement>('mark[data-hl]');
    if (mark && mark.dataset.hl !== 'hit') {
      const sels = window.getSelection();
      if (!sels || sels.isCollapsed) { e.preventDefault(); setPop({ id: mark.dataset.hl!, rect: mark.getBoundingClientRect() }); return; }
    }
    const a = t.closest<HTMLAnchorElement>('a');
    if (!a) return;
    if (a.dataset.sec !== undefined) {
      e.preventDefault();
      void goTarget({ section: Number(a.dataset.sec), anchor: a.dataset.anchor || undefined });
    } else if (a.closest('.rb-flow')) {
      e.preventDefault();
      const href = a.getAttribute('href') || '';
      if (/^(https?:|mailto:)/i.test(href)) { const w = window.open(href, '_blank', 'noopener,noreferrer'); if (!w) toast.info('Could not open the link in a new tab.'); }
    }
  };

  // ---------- UI auto-hide ----------
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const poke = useCallback(() => {
    setUiVisible(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setUiVisible(false), 3500);
  }, []);
  useEffect(() => { poke(); return () => { if (hideTimer.current) clearTimeout(hideTimer.current); }; }, [poke]);
  const keepUi = panel !== null || !!pop;
  const barsShown = uiVisible || keepUi;
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (e.clientY < 70 || e.clientY > window.innerHeight - 90) poke();
    };
    window.addEventListener('mousemove', onMove);
    return () => window.removeEventListener('mousemove', onMove);
  }, [poke]);
  useEffect(() => { if (keepUi && hideTimer.current) clearTimeout(hideTimer.current); else if (!keepUi) poke(); }, [keepUi, poke]);

  // ---------- fullscreen ----------
  useEffect(() => {
    const f = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', f);
    return () => document.removeEventListener('fullscreenchange', f);
  }, []);
  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    else void document.documentElement.requestFullscreen?.().catch(() => toast.info('Fullscreen is not available here.'));
  };

  // ---------- bookmarks ----------
  const toggleBookmark = async () => {
    if (!content) return;
    if (bmHere.length) {
      setBookmarks((l) => l.filter((b) => !bmHere.includes(b)));
      await Promise.all(bmHere.map((b) => storage.removeBookmark(b.id)));
      toast.info('Bookmark removed');
      return;
    }
    const idx = visible[0] ?? pageIndex;
    const b: Bookmark = { id: uid(), bookId, createdAt: Date.now(), label: chapter ? `${chapter}` : `Page ${idx + 1}`, ...content.anchorAt(idx) };
    setBookmarks((l) => [...l, b]);
    await storage.putBookmark(b);
    toast.success('Page bookmarked');
  };

  // ---------- keyboard ----------
  const kb = useRef({ next, prev, toggleBookmark, toggleFullscreen });
  kb.current = { next, prev, toggleBookmark, toggleFullscreen };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
      if (e.key === 'Escape') {
        if (pop) { setPop(null); return; }
        if (panel) { setPanel(null); return; }
        if (typing) return;
        setUiVisible((v) => !v); return;
      }
      if (typing || e.altKey || e.metaKey) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') { e.preventDefault(); setPanel('search'); return; }
      if (e.ctrlKey) return;
      const onButton = t?.tagName === 'BUTTON' || t?.tagName === 'A';
      switch (e.key) {
        case 'ArrowRight': case 'PageDown': kb.current.next(); break;
        case 'ArrowLeft': case 'PageUp': kb.current.prev(); break;
        case ' ': if (onButton) return; if (e.shiftKey) kb.current.prev(); else kb.current.next(); break;
        case 'Home': engine.current?.goTo(0); break;
        case 'End': engine.current?.goTo(Number.MAX_SAFE_INTEGER >> 8); break;
        case '/': setPanel('search'); break;
        case 't': case 'T': setPanel((p) => (p === 'toc' ? null : 'toc')); break;
        case 'n': case 'N': setPanel((p) => (p === 'marks' ? null : 'marks')); break;
        case 'a': case 'A': setPanel((p) => (p === 'settings' ? null : 'settings')); break;
        case 'b': case 'B': void kb.current.toggleBookmark(); break;
        case 'f': case 'F': kb.current.toggleFullscreen(); break;
        case 'l': case 'L': useSettings.getState().set({ layout: bookMode === 'double' ? 'single' : 'double' }); break;
        case '?': setPanel('help'); break;
        default: return;
      }
      e.preventDefault();
      if (!['t', 'T', 'n', 'N', 'a', 'A', '?', '/'].includes(e.key)) poke();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [panel, pop, poke, bookMode]);

  // ---------- selection / highlights ----------
  useEffect(() => {
    if (!isReflow) return;
    let raf = 0;
    const update = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const s = window.getSelection();
        if (!s || s.isCollapsed || !s.rangeCount || !(content instanceof ReflowContent)) { setSel(null); return; }
        const r = s.getRangeAt(0);
        const startEl = r.startContainer.nodeType === 1 ? (r.startContainer as Element) : r.startContainer.parentElement;
        const flow = startEl?.closest<HTMLElement>('.rb-flow[data-chunk]');
        if (!flow || !flow.contains(r.endContainer)) { setSel(null); return; }
        const off = rangeToOffsets(flow, r);
        const text = s.toString();
        if (!off || !text.trim()) { setSel(null); return; }
        const rects = r.getClientRects();
        const rect = rects.length ? rects[0] : r.getBoundingClientRect();
        setSel({ rect, chunk: Number(flow.dataset.chunk), start: off.start, end: off.end, text });
      });
    };
    document.addEventListener('selectionchange', update);
    return () => { document.removeEventListener('selectionchange', update); cancelAnimationFrame(raf); };
  }, [isReflow, content]);

  const createHighlight = async (color: Highlight['color'], note?: string) => {
    if (!sel || !(content instanceof ReflowContent)) return;
    const c = content.chunkInfo(sel.chunk);
    if (!c) return;
    const h: Highlight = { id: uid(), bookId, createdAt: Date.now(), section: c.section, start: c.textStart + sel.start, end: c.textStart + sel.end, text: sel.text.slice(0, 600), color, note };
    const rect = sel.rect;
    setHighlights((l) => [...l, h]);
    window.getSelection()?.removeAllRanges();
    setSel(null);
    await storage.putHighlight(h);
    if (note !== undefined) setPop({ id: h.id, rect, focusNote: true });
  };
  const updateHighlight = async (h: Highlight) => { setHighlights((l) => l.map((x) => (x.id === h.id ? h : x))); await storage.putHighlight(h); };
  const deleteHighlight = async (h: Highlight) => { setHighlights((l) => l.filter((x) => x.id !== h.id)); setPop(null); await storage.removeHighlight(h.id); };
  const goHighlight = async (h: Highlight) => {
    if (!(content instanceof ReflowContent)) return;
    const i = await content.resolveOffset(h.section, h.start);
    if (i !== undefined) goIndex(i);
  };
  const sectionTitleOf = (h: Highlight) => {
    if (!(content instanceof ReflowContent)) return '';
    const ci = content.sectionChunks[h.section]?.[0];
    return ci !== undefined ? content.chapterAt(content.indexOfAnchor({ section: h.section, sectionFraction: 0 }) ?? 0) : '';
  };

  // ---------- search ----------
  const jumpHit = async (h: SearchHit) => {
    if (!content) return;
    const i = await content.resolveHit(h);
    if (i === undefined) return;
    keepHit.current = true; goIndex(i); keepHit.current = false;
    if (window.innerWidth < 700) setPanel(null);
  };

  // ---------- render ----------
  const theme = resolveTheme(settings);
  const style = themeVars(settings) as React.CSSProperties;
  const chromeLayout = bookChrome(count, settings.frame);
  void chromeLayout;
  const animOn = settings.animations;
  const showBook = !!content && content.ready && !!applied;
  const progressFraction = content ? content.fractionAt(pageIndex) : 0;
  const sliderValue = sliderDrag ?? pageIndex;
  const chapters = content?.chapters ?? [];

  const panelEl = (() => {
    if (!content) return null;
    switch (panel) {
      case 'toc': return <TocPanel toc={doc.toc} currentTitle={chapter} onClose={() => setPanel(null)} onGo={(t) => { void goTarget(t); if (window.innerWidth < 700) setPanel(null); }} />;
      case 'search': return <SearchPanel content={content} onClose={() => { content.clearHit(); setPanel(null); }} onJump={jumpHit} />;
      case 'settings': return <SettingsPanel reflow={isReflow} onClose={() => setPanel(null)} />;
      case 'help': return <HelpPanel onClose={() => setPanel(null)} />;
      case 'marks': return (
        <Panel title="Bookmarks & notes" onClose={() => setPanel(null)}>
          <div className="rb-seg rb-tabs" role="tablist">
            <button type="button" role="tab" aria-selected={marksTab === 'bookmarks'} className={marksTab === 'bookmarks' ? 'is-active' : ''} onClick={() => setMarksTab('bookmarks')}>Bookmarks ({bookmarks.length})</button>
            <button type="button" role="tab" aria-selected={marksTab === 'highlights'} className={marksTab === 'highlights' ? 'is-active' : ''} onClick={() => setMarksTab('highlights')}>Highlights ({highlights.length})</button>
          </div>
          {marksTab === 'bookmarks'
            ? <BookmarksList items={bookmarks} content={content}
                onGo={(b) => { const i = content.indexOfAnchor(b); if (i !== undefined) goIndex(i); }}
                onRename={(b, label) => { const nb = { ...b, label }; setBookmarks((l) => l.map((x) => (x.id === b.id ? nb : x))); void storage.putBookmark(nb); }}
                onRemove={(b) => { setBookmarks((l) => l.filter((x) => x.id !== b.id)); void storage.removeBookmark(b.id); }} />
            : <HighlightsList items={highlights} reflow={isReflow} title={record.metadata.title} chapterOf={sectionTitleOf} onGo={goHighlight}
                onRemove={(h) => void deleteHighlight(h)} onToast={(m) => toast.info(m)} />}
        </Panel>
      );
      default: return null;
    }
  })();

  const popHl = pop ? highlights.find((h) => h.id === pop.id) : undefined;

  return (
    <div ref={rootRef} className="rb-reader" data-dark={theme.dark ? '1' : '0'} data-frame={settings.frame} style={{ ...style, ['--rb-desk' as string]: theme.desk }}>
      <div className="rb-desk" aria-hidden />
      <div ref={stageRef} className={`rb-stage${compact ? ' rb-stage-compact' : ''}`} onClick={onStageClick}>
        {showBook && content && applied && (
          <Book
            engineRef={engine}
            pageCount={count}
            mode={applied.mode}
            current={pageIndex}
            pageWidth={applied.pageW}
            pageHeight={applied.pageH}
            renderPage={(i) => content.renderPage(i)}
            onTurn={onTurn}
            onTap={() => { if (panel) setPanel(null); else setUiVisible((v) => !v); }}
            perf={perf}
            animations={animOn}
            speed={settings.animationSpeed}
            shadowStrength={settings.shadowStrength}
            frame={settings.frame}
            progress={progressFraction}
          />
        )}
      </div>

      {!showBook && <LoadingOverlay label={content && !content.ready && content.progress > 0 ? 'Preparing pages…' : 'Opening book…'} fraction={content?.progress} />}
      {showBook && content && !content.complete && content.kind === 'reflow' && (
        <div className="rb-paginating" role="status">Paginating… {Math.round(content.progress * 100)}%<div className="rb-progress"><i style={{ width: `${content.progress * 100}%` }} /></div></div>
      )}

      <header className={`rb-bar rb-top${barsShown ? '' : ' is-hidden'}`} inert={!barsShown} onFocus={poke}>
        <IconButton icon="back" label="Back to library" onClick={() => { flush(); onBack(); }} />
        <div className="rb-title" title={record.metadata.title}><strong>{record.metadata.title}</strong>{record.metadata.author && <span>{record.metadata.author}</span>}</div>
        <div className="rb-tools">
          <IconButton icon="toc" label="Contents" active={panel === 'toc'} onClick={() => setPanel(panel === 'toc' ? null : 'toc')} />
          <IconButton icon="search" label="Search" active={panel === 'search'} onClick={() => setPanel(panel === 'search' ? null : 'search')} />
          <IconButton icon="bookmark" label={bmHere.length ? 'Remove bookmark' : 'Bookmark this page'} filled={!!bmHere.length} active={!!bmHere.length} onClick={() => void toggleBookmark()} />
          <IconButton icon="notes" label="Bookmarks and notes" active={panel === 'marks'} onClick={() => setPanel(panel === 'marks' ? null : 'marks')} />
          <IconButton icon="text" label="Appearance" active={panel === 'settings'} onClick={() => setPanel(panel === 'settings' ? null : 'settings')} />
          <IconButton icon={bookMode === 'double' ? 'layout1' : 'layout'} label={bookMode === 'double' ? 'Switch to single page' : 'Switch to two pages'} onClick={() => useSettings.getState().set({ layout: bookMode === 'double' ? 'single' : 'double' })} />
          <IconButton icon="expand" label={fullscreen ? 'Exit fullscreen' : 'Fullscreen'} active={fullscreen} onClick={toggleFullscreen} />
          <IconButton icon="help" label="Keyboard shortcuts" onClick={() => setPanel('help')} />
        </div>
      </header>

      <footer className={`rb-bar rb-bottom${barsShown ? '' : ' is-hidden'}`} inert={!barsShown} onFocus={poke}>
        <IconButton icon="prev" label="Previous page" onClick={prev} disabled={pageIndex <= 0} />
        <div className="rb-scrub">
          <div className="rb-scrub-info"><span className="rb-chapter" title={chapter}>{chapter || record.metadata.title}</span><span className="rb-counter">{sliderDrag !== null ? `Page ${sliderDrag + 1} of ${count}` : counter}</span></div>
          <div className="rb-slider">
            <div className="rb-ticks" aria-hidden>
              {count > 1 && chapters.filter((c) => c.depth === 0 || chapters.length < 40).map((c, i) => <i key={i} style={{ left: `${(c.page / (count - 1)) * 100}%` }} title={c.title} />)}
            </div>
            <Slider value={sliderValue} max={Math.max(0, count - 1)} onPreview={setSliderDrag} onCommit={(v) => { setSliderDrag(null); goIndex(v); }} label={`Reading position, ${counter}`} />
          </div>
        </div>
        <IconButton icon="next" label="Next page" onClick={next} disabled={pageIndex >= count - 1} />
      </footer>

      {panelEl}
      <div className="rb-sr" aria-live="polite" role="status">{announce}</div>
      {sel && !pop && <SelectionToolbar rect={sel.rect} onColor={(c) => void createHighlight(c)} onNote={() => void createHighlight('yellow', '')}
        onCopy={() => { void navigator.clipboard?.writeText(sel.text).then(() => toast.info('Copied')).catch(() => toast.error('Could not copy')); }} />}
      {pop && popHl && <HighlightPopover key={popHl.id} hl={popHl} rect={pop.rect} autoFocusNote={pop.focusNote} onChange={(h) => void updateHighlight(h)} onDelete={() => void deleteHighlight(popHl)} onClose={() => setPop(null)} />}
    </div>
  );
}

function LoadingOverlay({ label, fraction }: { label: string; fraction?: number }) {
  return <div className="rb-loading"><LoadingScreen label={label} fraction={fraction} /></div>;
}

/** Native range input that previews while dragging and commits on release (so scrubbing doesn't re-render pages). */
function Slider({ value, max, onPreview, onCommit, label }: { value: number; max: number; onPreview: (v: number) => void; onCommit: (v: number) => void; label: string }) {
  const ref = useRef<HTMLInputElement>(null);
  const commit = useRef(onCommit); commit.current = onCommit;
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const f = () => commit.current(Number(el.value));
    el.addEventListener('change', f);
    return () => el.removeEventListener('change', f);
  }, []);
  return <input ref={ref} type="range" min={0} max={max} step={1} value={Math.min(value, max)} aria-label={label} onChange={(e) => onPreview(Number(e.target.value))} />;
}
