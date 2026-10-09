import { useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as RPointerEvent, type ReactNode, type Ref } from 'react';
import { flushSync } from 'react-dom';
import { pagesOfSpread, primaryPageOfSpread, spreadCount, spreadOfPage, type FlipMode } from './spread';
import { clamp, decideRelease, easeInOut, easeOut, edgeGeometry, leafAngle, tFromEdgePointer, tFromSwipe } from './flip-math';
import type { PerfProfile } from './perf';
import type { PageFlipEngine } from './types';

export interface BookProps {
  pageCount: number;
  mode: FlipMode;
  /** current page index (primary page of the visible spread) */
  current: number;
  pageWidth: number;
  pageHeight: number;
  renderPage: (index: number) => ReactNode;
  onTurn: (newIndex: number) => void;
  /** tap/click in the page interior (not on links, not while selecting) */
  onTap?: () => void;
  perf: PerfProfile;
  animations?: boolean;
  /** 0.5 .. 2 */
  speed?: number;
  /** 0..1 */
  shadowStrength?: number;
  frame?: 'hardcover' | 'none';
  texture?: boolean;
  /** reading progress 0..1 (page edge thickness) */
  progress?: number;
  engineRef?: Ref<PageFlipEngine>;
}

/** Space the chrome adds around the page block (the owner reserves it when sizing pages). */
export function bookChrome(pageCount: number, frame: 'hardcover' | 'none' | undefined) {
  void pageCount;
  return { framePad: frame === 'none' ? 0 : 16, edge: 22 };
}

interface Turn { dir: 1 | -1; from: number; to: number; kind: 'flip' | 'fade' }

function useReducedMotion() {
  const [r, setR] = useState(() => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    if (typeof matchMedia === 'undefined') return;
    const m = matchMedia('(prefers-reduced-motion: reduce)');
    const f = () => setR(m.matches);
    m.addEventListener('change', f);
    return () => m.removeEventListener('change', f);
  }, []);
  return r;
}

function Shell({ side, children, empty, grain }: { side: 'left' | 'right' | 'single'; children?: ReactNode; empty?: boolean; grain: boolean }) {
  return (
    <div className={`rb-page rb-page-${side}${empty ? ' rb-page-empty' : ''}`}>
      {!empty && <div className="rb-page-content">{children}</div>}
      <div className="rb-page-gutter" />
      {grain && !empty && <div className="rb-grain" />}
    </div>
  );
}

export function Book(props: BookProps) {
  const { pageCount, mode, pageWidth: pw, pageHeight: ph, perf } = props;
  const reduced = useReducedMotion();
  const nSpreads = spreadCount(pageCount, mode);
  const [base, setBase] = useState(() => clamp(spreadOfPage(props.current, mode), 0, nSpreads - 1));
  const [turn, setTurn] = useState<Turn | null>(null);
  const [tick, setTick] = useState(0);
  const propsRef = useRef(props); propsRef.current = props;
  const reducedRef = useRef(reduced); reducedRef.current = reduced;
  const baseRef = useRef(base);
  const turnRef = useRef<Turn | null>(null);
  const tRef = useRef(0);
  const pendingRef = useRef<0 | 1 | -1>(0);
  const pendingSync = useRef(false);
  const anim = useRef<{ raf: number; target: number } | null>(null);
  const els = useRef<{ leaf: HTMLDivElement | null; cast: HTMLDivElement | null; ghost: HTMLDivElement | null }>({ leaf: null, cast: null, ghost: null });
  const drag = useRef<null | {
    id: number; kind: 'zone' | 'swipe' | 'tap'; dir: 1 | -1; sx: number; sy: number; started: boolean; samples: { t: number; at: number }[]; failed: boolean; down: number;
  }>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const api = useMemo(() => {
    const P = () => propsRef.current;
    const nS = () => spreadCount(P().pageCount, P().mode);
    const commitBase = (s: number) => { baseRef.current = s; setBase(s); };
    const cancelAnim = () => { if (anim.current) cancelAnimationFrame(anim.current.raf); anim.current = null; };

    const paint = (t: number) => {
      const tr = turnRef.current; if (!tr) return;
      tRef.current = t;
      const p = P();
      if (tr.kind === 'fade') { if (els.current.ghost) els.current.ghost.style.opacity = String(1 - t); return; }
      const leaf = els.current.leaf; if (!leaf) return;
      const ang = leafAngle(t, p.mode, tr.dir);
      const rad = (ang * Math.PI) / 180;
      const sin = Math.sin(rad);
      const sign = p.mode === 'double' && tr.dir === -1 ? 1 : -1;
      leaf.style.transform = `rotateY(${sign * ang}deg) translateZ(${(sin * p.pageWidth * 0.012).toFixed(2)}px)`;
      leaf.style.setProperty('--c', sin.toFixed(3));
      leaf.style.setProperty('--f', String(ang < 90 ? ang / 90 : 1));
      leaf.style.setProperty('--b', String(ang > 90 ? (180 - ang) / 90 : 1));
      const cast = els.current.cast;
      if (cast) {
        const g = edgeGeometry(ang, p.pageWidth, p.mode, tr.dir);
        cast.style.transform = `translateX(${g.x.toFixed(1)}px) scaleX(${g.side})`;
        cast.style.opacity = String(Math.min(1, sin * 1.15));
      }
    };

    const tween = (to: number, dur: number, ease: (x: number) => number, done?: () => void) => {
      cancelAnim();
      const from = tRef.current;
      const d = Math.max(50, dur * Math.abs(to - from));
      const t0 = performance.now();
      const step = (now: number) => {
        const k = clamp((now - t0) / d, 0, 1);
        paint(from + (to - from) * ease(k));
        if (k < 1) anim.current = { raf: requestAnimationFrame(step), target: to };
        else { anim.current = null; paint(to); done?.(); }
      };
      anim.current = { raf: requestAnimationFrame(step), target: to };
    };

    const finish = (commit: boolean) => {
      const tr = turnRef.current; if (!tr) return;
      cancelAnim();
      turnRef.current = null;
      const p = P();
      if (commit) commitBase(tr.to);
      setTurn(null);
      if (commit) p.onTurn(primaryPageOfSpread(tr.to, p.mode, p.pageCount));
      if (pendingSync.current) { pendingSync.current = false; setTick((x) => x + 1); }
      const pd = pendingRef.current; pendingRef.current = 0;
      if (pd) (pd > 0 ? next : prev)();
    };

    const durationFor = (tr: Turn) => {
      const p = P();
      const base = p.perf.duration / clamp(p.speed ?? 1, 0.25, 4);
      return tr.kind === 'fade' ? base : p.mode === 'single' ? base * 0.7 : base;
    };

    const begin = (dir: 1 | -1): Turn | null => {
      const p = P();
      const from = baseRef.current, to = from + dir;
      if (to < 0 || to >= nS()) return null;
      const animOk = p.animations !== false && !reducedRef.current;
      if (!animOk) return { dir, from, to, kind: 'fade' }; // caller treats !animOk specially
      return { dir, from, to, kind: p.perf.transition === 'fade' ? 'fade' : 'flip' };
    };

    const startAuto = (dir: 1 | -1): boolean => {
      const p = P();
      const tr = begin(dir); if (!tr) return false;
      const animOk = p.animations !== false && !reducedRef.current;
      if (!animOk) { commitBase(tr.to); p.onTurn(primaryPageOfSpread(tr.to, p.mode, p.pageCount)); return true; }
      turnRef.current = tr; tRef.current = 0;
      flushSync(() => setTurn(tr));
      paint(0);
      tween(1, durationFor(tr), tr.kind === 'fade' ? (x) => x : easeInOut, () => finish(true));
      return true;
    };

    function next(): boolean { return step(1); }
    function prev(): boolean { return step(-1); }
    function step(dir: 1 | -1): boolean {
      if (turnRef.current) {
        if (drag.current?.started) return false;
        if (pendingRef.current === 0) {
          pendingRef.current = dir;
          // accelerate the running turn
          if (anim.current && anim.current.target === 1) tween(1, durationFor(turnRef.current) * 0.35, easeOut, () => finish(true));
        }
        return true;
      }
      return startAuto(dir);
    }

    const goTo = (index: number, opts?: { animate?: boolean }) => {
      const p = P();
      if (turnRef.current) { pendingRef.current = 0; finish(!!anim.current && anim.current.target === 1); }
      const idx = clamp(Math.floor(index), 0, Math.max(0, p.pageCount - 1));
      const s = clamp(spreadOfPage(idx, p.mode), 0, nS() - 1);
      if (s === baseRef.current) { p.onTurn(idx); return; }
      if (opts?.animate && Math.abs(s - baseRef.current) === 1) { startAuto(s > baseRef.current ? 1 : -1); return; }
      commitBase(s);
      p.onTurn(idx);
    };

    return { next, prev, goTo, paint, tween, finish, begin, commitBase, cancelAnim, nS, durationFor };
  }, []);

  useImperativeHandle(props.engineRef, () => ({
    next: api.next, prev: api.prev, goTo: api.goTo, isTurning: () => turnRef.current !== null,
  }), [api]);

  // reconcile with the owner's `current` (external jumps, re-pagination remaps, mode switches)
  useLayoutEffect(() => {
    if (turnRef.current) { pendingSync.current = true; return; }
    const s = clamp(spreadOfPage(props.current, mode), 0, spreadCount(pageCount, mode) - 1);
    if (s !== baseRef.current) api.commitBase(s);
  }, [props.current, mode, pageCount, tick, api]);

  // leaf is freshly mounted: set its initial angle
  useLayoutEffect(() => { if (turn) api.paint(tRef.current); }, [turn, api]);
  useEffect(() => () => api.cancelAnim(), [api]);

  const sp = (s: number) => pagesOfSpread(s, mode, pageCount);
  let L: number | null, R: number | null;
  let front: number | null = null, back: number | null = null;
  let ghost: [number | null, number | null] | null = null;
  const s0 = sp(base);
  if (!turn) { [L, R] = s0; }
  else if (turn.kind === 'fade') { [L, R] = sp(turn.to); ghost = sp(turn.from); }
  else {
    const a = sp(turn.from), b = sp(turn.to);
    if (mode === 'double') {
      if (turn.dir === 1) { L = a[0]; R = b[1]; front = a[1]; back = b[0]; }
      else { L = b[0]; R = a[1]; front = a[0]; back = b[1]; }
    } else if (turn.dir === 1) { L = null; R = b[1]; front = a[1]; }
    else { L = null; R = a[1]; front = b[1]; }
  }

  const grain = perf.grain;
  const slot = (i: number | null, side: 'left' | 'right' | 'single') => (
    <Shell side={side} empty={i === null} grain={grain}>{i !== null ? props.renderPage(i) : null}</Shell>
  );
  const slots = (l: number | null, r: number | null) =>
    mode === 'double' ? (
      <>
        <div className="rb-slot" style={{ left: 0, width: pw }}>{slot(l, 'left')}</div>
        <div className="rb-slot" style={{ left: pw, width: pw }}>{slot(r, 'right')}</div>
      </>
    ) : (
      <div className="rb-slot" style={{ left: 0, width: pw }}>{slot(r, 'single')}</div>
    );

  const chrome = bookChrome(pageCount, props.frame);
  const prog = clamp(props.progress ?? 0, 0, 1);
  const bookW = mode === 'double' ? pw * 2 : pw;
  const shade = clamp(props.shadowStrength ?? 0.6, 0, 1) * perf.shadowScale;
  const canNext = base < nSpreads - 1, canPrev = base > 0;

  // ---------------- pointer handling ----------------
  const bx = (e: { clientX: number }) => e.clientX - (rootRef.current?.getBoundingClientRect().left ?? 0);
  const onDown = (e: RPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const target = e.target as HTMLElement;
    const zone = target.closest<HTMLElement>('[data-zone]');
    const touch = e.pointerType !== 'mouse';
    if (zone) {
      e.preventDefault();
      drag.current = { id: e.pointerId, kind: 'zone', dir: zone.dataset.zone!.endsWith('r') ? 1 : -1, sx: e.clientX, sy: e.clientY, started: false, samples: [], failed: false, down: performance.now() };
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    } else {
      drag.current = { id: e.pointerId, kind: touch ? 'swipe' : 'tap', dir: 1, sx: e.clientX, sy: e.clientY, started: false, samples: [], failed: false, down: performance.now() };
    }
  };
  const tryStart = (dir: 1 | -1): boolean => {
    const p = propsRef.current;
    if (turnRef.current) return false;
    const tr = api.begin(dir);
    if (!tr) return false;
    if (p.animations === false || reducedRef.current || tr.kind === 'fade') return false;
    turnRef.current = tr; tRef.current = 0;
    flushSync(() => setTurn(tr));
    api.paint(0);
    return true;
  };
  const onMove = (e: RPointerEvent<HTMLDivElement>) => {
    const d = drag.current; if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.sx, dy = e.clientY - d.sy;
    if (!d.started && !d.failed) {
      if (d.kind === 'zone' && Math.hypot(dx, dy) > 6) { if (tryStart(d.dir)) d.started = true; else d.failed = true; }
      else if (d.kind === 'swipe' && Math.abs(dx) > 30 && Math.abs(dx) > Math.abs(dy) * 1.3) {
        d.dir = dx < 0 ? 1 : -1;
        if (tryStart(d.dir)) { d.started = true; try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* ignore */ } } else d.failed = true;
      } else if (d.kind === 'tap' && Math.hypot(dx, dy) > 5) d.failed = true;
    }
    if (d.started) {
      const p = propsRef.current;
      const t = d.kind === 'zone' ? tFromEdgePointer(bx(e), p.pageWidth, p.mode, d.dir) : tFromSwipe(dx, p.pageWidth, p.mode);
      api.paint(t);
      d.samples.push({ t, at: performance.now() });
      if (d.samples.length > 8) d.samples.shift();
    }
  };
  const onUp = (e: RPointerEvent<HTMLDivElement>, cancelled = false) => {
    const d = drag.current; if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    const dx = e.clientX - d.sx;
    if (d.started) {
      const s = d.samples;
      let v = 0;
      if (s.length >= 2) { const a = s[Math.max(0, s.length - 4)], b = s[s.length - 1]; v = (b.t - a.t) / Math.max(1, b.at - a.at); }
      const complete = !cancelled && decideRelease(tRef.current, v);
      const tr = turnRef.current!;
      api.tween(complete ? 1 : 0, api.durationFor(tr) * 0.8, easeOut, () => api.finish(complete));
      return;
    }
    if (cancelled) return;
    if (d.kind === 'zone' && !d.failed) { (d.dir > 0 ? api.next : api.prev)(); return; }
    if (d.kind === 'zone' || (d.kind === 'swipe' && d.failed && Math.abs(dx) > 30 && Math.abs(dx) > Math.abs(e.clientY - d.sy) * 1.3)) {
      (dx < 0 || d.kind === 'zone' && d.dir > 0 ? api.next : api.prev)();
      return;
    }
    if (!d.failed && performance.now() - d.down < 600) {
      const t = e.target as HTMLElement;
      if (t.closest('a,button,input,textarea,select,mark')) return;
      const sel = window.getSelection();
      if (sel && !sel.isCollapsed) return;
      propsRef.current.onTap?.();
    }
  };

  const zoneW = Math.max(26, Math.round(pw * 0.1));
  const cornerS = Math.max(44, Math.round(pw * 0.2));
  const zones = pageCount > 1 && (
    <>
      <div className="rb-zone rb-zone-edge" data-zone="el" data-disabled={!canPrev || undefined} style={{ left: 0, width: zoneW, top: 0, bottom: cornerS }} aria-hidden />
      <div className="rb-zone rb-zone-edge" data-zone="er" data-disabled={!canNext || undefined} style={{ right: 0, width: zoneW, top: 0, bottom: cornerS }} aria-hidden />
      <div className="rb-zone rb-zone-corner rb-corner-l" data-zone="cl" data-disabled={!canPrev || undefined} style={{ left: 0, bottom: 0, width: cornerS, height: cornerS }} aria-hidden><i className="rb-peel" /></div>
      <div className="rb-zone rb-zone-corner rb-corner-r" data-zone="cr" data-disabled={!canNext || undefined} style={{ right: 0, bottom: 0, width: cornerS, height: cornerS }} aria-hidden><i className="rb-peel" /></div>
    </>
  );

  const leafStyle: CSSProperties = mode === 'double' && turn?.dir === -1
    ? { left: 0, width: pw, transformOrigin: '100% 50%' }
    : mode === 'double' ? { left: pw, width: pw, transformOrigin: '0 50%' } : { left: 0, width: pw, transformOrigin: '0 50%' };
  const faceSide = (isFront: boolean): 'left' | 'right' | 'single' => {
    if (mode === 'single') return 'single';
    const fwd = turn?.dir === 1;
    return isFront ? (fwd ? 'right' : 'left') : (fwd ? 'left' : 'right');
  };
  const face = (i: number | null, isFront: boolean) => (
    <div className={`rb-face ${isFront ? 'rb-face-front' : 'rb-face-back'}`}>
      <Shell side={faceSide(isFront)} empty={i === null} grain={grain}>{i !== null ? props.renderPage(i) : null}</Shell>
      {perf.curl && <><i className="rb-curl" /><i className="rb-dark" />{perf.specular && <i className="rb-spec" />}</>}
    </div>
  );

  const stack = clamp(pageCount / 14, 3, 22);
  const edgeL = Math.round(stack * (mode === 'double' ? prog : 0.5));
  const edgeR = Math.round(stack * (mode === 'double' ? 1 - prog : 0.5));

  return (
    <div className={`rb-cover${props.frame === 'none' ? ' rb-cover-none' : ''}`} style={{ padding: chrome.framePad }}>
      <div className="rb-block" style={{ padding: `0 ${chrome.edge}px` }}>
        <div className="rb-edge rb-edge-l" style={{ width: edgeL, left: chrome.edge - edgeL }} />
        <div className="rb-edge rb-edge-r" style={{ width: edgeR, left: chrome.edge + bookW }} />
        <div
          ref={rootRef}
          className={`rb-book rb-mode-${mode}`}
          data-turning={turn ? '' : undefined}
          style={{ width: bookW, height: ph, perspective: Math.round(pw * 3.2), ['--s' as string]: shade.toFixed(3) }}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={(e) => onUp(e)}
          onPointerCancel={(e) => onUp(e, true)}
        >
          {slots(L!, R!)}
          {mode === 'double' && <div className="rb-spine" aria-hidden />}
          {ghost && <div className="rb-ghost" ref={(el) => { els.current.ghost = el; }}>{slots(ghost[0], ghost[1])}</div>}
          {turn && turn.kind === 'flip' && perf.cast && <div className="rb-castwrap" aria-hidden><div className="rb-cast" ref={(el) => { els.current.cast = el; }} style={{ width: Math.round(pw * 0.45) }} /></div>}
          {turn && turn.kind === 'flip' && (
            <div className="rb-leaf" ref={(el) => { els.current.leaf = el; }} style={{ ...leafStyle, willChange: 'transform' }}>
              {face(front, true)}
              {mode === 'double' && face(back, false)}
            </div>
          )}
          {zones}
        </div>
      </div>
    </div>
  );
}
