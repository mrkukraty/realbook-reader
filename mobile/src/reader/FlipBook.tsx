// Native page-turn engine (Reanimated). Page contents are rendered by the parent into two fixed "sets"
// (current + neighbour), each with a left/right surface. Surfaces never move between parents (a WebView
// would reload), so a turn animates the surface containers themselves: each half-turn is a rotateY around
// the spine with perspective, shading on the leaf and a cast shadow on the revealed page. Which set is
// "current" lives in a shared value so the role swap at the end of a turn is atomic on the UI thread.
import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { cancelAnimation, Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { LinearGradient } from 'expo-linear-gradient';
import type { Theme, PerfProfile } from '../settings/themes';
import type { FlipMode } from './spread';
import { clamp, decideRelease, leafShade, remainingDuration, tapZone, tFromSwipe } from './flip-math';

export type Side = 'L' | 'R';
export type Role = 'cur' | 'aux';

export interface FlipBookHandle {
  next(): void;
  prev(): void;
  dragStart(dx: number): void;
  drag(dx: number): void;
  dragEnd(dx: number, vxPxPerMs: number): void;
  tap(xFraction: number): void;
  busy(): boolean;
}

export interface FlipBookProps {
  mode: FlipMode;
  pw: number;
  ph: number;
  theme: Theme;
  profile: PerfProfile;
  /** false when animations are off in settings or Reduce Motion is on */
  animate: boolean;
  speed: number;
  shadowStrength: number;
  /** 0..1 how much of the book lies to the left / right (page-thickness edges) */
  readFraction: number;
  renderSurface(set: 0 | 1, side: Side, role: Role): React.ReactNode;
  canTurn(dir: 1 | -1): boolean;
  /** Point the neighbour set at the next/previous view; resolves true when it has rendered. */
  prepareAux(dir: 1 | -1): Promise<boolean>;
  /** Called after the roles have swapped (neighbour became current). */
  onCommitted(dir: 1 | -1, newCurSet: 0 | 1): void;
  /** Lightweight mode: turn the page in place (same surface) - resolves when shown. */
  turnInPlace(dir: 1 | -1): Promise<boolean>;
  onCenterTap(): void;
  /** Fixed-layout books: native pan/tap gestures. Reflow books forward gestures from the WebView instead. */
  nativeGestures: boolean;
  onEdgeReached?(dir: 1 | -1): void;
}

const PERSPECTIVE = 1600;

export const FlipBook = forwardRef<FlipBookHandle, FlipBookProps>(function FlipBook(props, ref) {
  const { mode, pw, ph, theme, profile } = props;
  const useAux = profile.preloadNeighbor;
  const [curSet, setCurSet] = useState<0 | 1>(0);
  const cur = useSharedValue<0 | 1>(0);
  const t = useSharedValue(0);
  const dir = useSharedValue<1 | -1>(1);
  const active = useSharedValue(0);
  const fade = useSharedValue(1);
  const busyRef = useRef(false);
  const dragRef = useRef<{ dir: 1 | -1; ready: boolean; dx: number } | null>(null);
  const queued = useRef<1 | -1 | null>(null);
  const propsRef = useRef(props);
  propsRef.current = props;
  const handleRef = useRef<FlipBookHandle | null>(null);
  const fadeStyle = useAnimatedStyle(() => ({ opacity: fade.value }));

  const flip = mode === 'double' ? 1 : 0;
  const shadowK = props.shadowStrength * profile.shadowScale;
  const curl = profile.curl ? 1 : 0;
  const duration = profile.duration;

  const committed = useCallback((d: 1 | -1, newCur: 0 | 1) => {
    setCurSet(newCur);
    busyRef.current = false;
    propsRef.current.onCommitted(d, newCur);
    const q = queued.current;
    queued.current = null;
    if (q) setTimeout(() => (q === 1 ? handleRef.current?.next() : handleRef.current?.prev()), 0);
  }, []);
  const cancelled = useCallback(() => { busyRef.current = false; }, []);

  const finish = useCallback((d: 1 | -1, complete: boolean, from: number) => {
    const ms = remainingDuration(from, complete ? 1 : 0, duration, propsRef.current.speed);
    t.value = withTiming(complete ? 1 : 0, { duration: ms, easing: Easing.out(Easing.cubic) }, (done) => {
      'worklet';
      if (!done) return;
      if (complete) {
        const nc = (1 - cur.value) as 0 | 1;
        cur.value = nc;
        active.value = 0;
        t.value = 0;
        scheduleOnRN(committed, d, nc);
      } else {
        active.value = 0;
        t.value = 0;
        scheduleOnRN(cancelled);
      }
    });
  }, [duration, t, cur, active, committed, cancelled]);

  const instantSwap = useCallback((d: 1 | -1) => {
    const nc = (1 - cur.value) as 0 | 1;
    cur.value = nc;
    active.value = 0;
    t.value = 0;
    committed(d, nc);
  }, [cur, active, t, committed]);

  const runInPlace = useCallback(async (d: 1 | -1) => {
    const p = propsRef.current;
    if (p.animate) {
      await new Promise<void>((res) => { fade.value = withTiming(0.15, { duration: 90 }, () => { 'worklet'; scheduleOnRN(res); }); });
    }
    await p.turnInPlace(d);
    if (p.animate) fade.value = withTiming(1, { duration: Math.round(profile.duration / Math.max(0.5, p.speed)) });
    busyRef.current = false;
    p.onCommitted(d, curSet);
  }, [fade, profile.duration, curSet]);

  const turn = useCallback(async (d: 1 | -1) => {
    const p = propsRef.current;
    if (busyRef.current) { queued.current = d; return; }
    if (!p.canTurn(d)) { p.onEdgeReached?.(d); return; }
    busyRef.current = true;
    if (!useAux) { await runInPlace(d); return; }
    const ok = await p.prepareAux(d);
    if (!ok) { busyRef.current = false; return; }
    if (!p.animate) { instantSwap(d); return; }
    dir.value = d;
    t.value = 0;
    active.value = 1;
    finish(d, true, 0);
  }, [useAux, runInPlace, instantSwap, dir, t, active, finish]);

  const handle: FlipBookHandle = {
    next: () => { void turn(1); },
    prev: () => { void turn(-1); },
    busy: () => busyRef.current,
    tap: (x) => {
      const z = tapZone(x, 1);
      if (z === 0) propsRef.current.onCenterTap();
      else void turn(z);
    },
    dragStart: (dx) => {
      const p = propsRef.current;
      const d: 1 | -1 = dx < 0 ? 1 : -1;
      if (busyRef.current || !p.canTurn(d)) { if (!busyRef.current) p.onEdgeReached?.(d); return; }
      if (!useAux || !p.animate) { dragRef.current = { dir: d, ready: false, dx }; return; }
      busyRef.current = true;
      dragRef.current = { dir: d, ready: false, dx };
      void p.prepareAux(d).then((ok) => {
        const g = dragRef.current;
        if (!ok) { busyRef.current = false; dragRef.current = null; return; }
        if (!g) { // finger already lifted: finish the turn as a tap would
          dir.value = d; active.value = 1; finish(d, true, 0); return;
        }
        g.ready = true;
        dir.value = d;
        t.value = tFromSwipe(g.dx, pw, mode);
        active.value = 1;
      });
    },
    drag: (dx) => {
      const g = dragRef.current;
      if (!g) return;
      g.dx = dx;
      if (!g.ready) return;
      const same = g.dir === 1 ? dx < 0 : dx > 0;
      t.value = same ? tFromSwipe(dx, pw, mode) : 0;
    },
    dragEnd: (dx, vx) => {
      const g = dragRef.current;
      dragRef.current = null;
      if (!g) return;
      if (!useAux || !propsRef.current.animate) {
        if (Math.abs(dx) > 40) void turn(g.dir);
        return;
      }
      if (!g.ready) return; // prepareAux().then() completes the turn
      const k = pw * (mode === 'double' ? 1.2 : 0.8);
      const vt = ((-vx * g.dir) * 1000) / k; // t-units per second toward completion
      const from = clamp(t.value, 0, 1);
      finish(g.dir, decideRelease(from, vt), from);
    },
  };
  handleRef.current = handle;
  useImperativeHandle(ref, () => handle);

  // reset when the layout mode changes
  useEffect(() => {
    cancelAnimation(t);
    t.value = 0;
    active.value = 0;
    busyRef.current = false;
  }, [mode, pw, ph, t, active]);

  const pan = Gesture.Pan()
    .runOnJS(true)
    .enabled(props.nativeGestures)
    .activeOffsetX([-12, 12])
    .failOffsetY([-24, 24])
    .onStart((e) => handle.dragStart(e.translationX))
    .onUpdate((e) => handle.drag(e.translationX))
    .onEnd((e) => handle.dragEnd(e.translationX, e.velocityX / 1000))
    .onFinalize(() => { if (dragRef.current) handle.dragEnd(0, 0); });
  const tapG = Gesture.Tap().runOnJS(true).enabled(props.nativeGestures).maxDuration(300)
    .onEnd((e, ok) => { if (ok) handle.tap(e.x / (flip ? pw * 2 : pw)); });
  const gestures = Gesture.Exclusive(pan, tapG);

  const bookW = flip ? pw * 2 : pw;
  const sides: Side[] = flip ? ['L', 'R'] : ['R'];
  const sets: (0 | 1)[] = useAux ? [0, 1] : [curSet];

  const content = (
    <View style={{ width: bookW, height: ph }}>
      <PageEdges theme={theme} mode={mode} pw={pw} ph={ph} layers={profile.edges} readFraction={props.readFraction} />
      <Animated.View style={[{ width: bookW, height: ph }, fadeStyle]}>
        {sets.map((s) => sides.map((side) => (
          <SurfaceContainer
            key={`${s}${side}`} set={s} side={side} flip={flip} pw={pw} ph={ph}
            cur={cur} t={t} dir={dir} active={active} shadowK={shadowK} curl={curl} specular={profile.specular} theme={theme}
            single={!useAux}
          >
            {props.renderSurface(s, side, s === curSet ? 'cur' : 'aux')}
          </SurfaceContainer>
        )))}
      </Animated.View>
      <Spine theme={theme} mode={mode} pw={pw} ph={ph} strength={props.shadowStrength} />
    </View>
  );
  return <GestureDetector gesture={gestures}>{content}</GestureDetector>;
});

interface ContainerProps {
  set: 0 | 1; side: Side; flip: number; pw: number; ph: number;
  cur: { value: 0 | 1 }; t: { value: number }; dir: { value: 1 | -1 }; active: { value: number };
  shadowK: number; curl: number; specular: boolean; theme: Theme; single: boolean;
  children: React.ReactNode;
}

function SurfaceContainer(p: ContainerProps) {
  const { set, side, flip, pw, ph, cur, t, dir, active, shadowK, curl } = p;
  // plain locals only: worklets must not capture `p` (it holds React children)
  const single = p.single;
  const specular = p.specular ? 1 : 0;
  const isLeft = side === 'L';
  // worklet: rotation (deg), visibility, z-order and overlays for this container
  const geo = () => {
    'worklet';
    const isCur = cur.value === set || single;
    if (!active.value) return { rot: 0, vis: isCur ? 1 : 0, z: isCur ? 2 : 1, shade: 0, cast: 0 };
    const tt = t.value;
    const d = dir.value;
    if (!flip) {
      // single page: hinge on the left edge
      if (d === 1) return isCur ? { rot: -90 * tt, vis: 1, z: 2, shade: 0, cast: 0 } : { rot: 0, vis: 1, z: 1, shade: 0, cast: 1 - tt };
      return isCur ? { rot: 0, vis: 1, z: 1, shade: 0, cast: tt > 0 ? tt : 0 } : { rot: -90 * (1 - tt), vis: 1, z: 2, shade: 0, cast: 0 };
    }
    if (d === 1) {
      if (!isLeft) return isCur ? { rot: -180 * Math.min(tt, 0.5), vis: tt < 0.5 ? 1 : 0, z: 3, shade: 0, cast: 0 } : { rot: 0, vis: 1, z: 2, shade: 0, cast: 1 - tt };
      return isCur ? { rot: 0, vis: 1, z: 1, shade: 0, cast: tt > 0.5 ? (tt - 0.5) * 2 : 0 } : { rot: 180 * (1 - Math.max(tt, 0.5)), vis: tt >= 0.5 ? 1 : 0, z: 4, shade: 0, cast: 0 };
    }
    if (isLeft) return isCur ? { rot: 180 * Math.min(tt, 0.5), vis: tt < 0.5 ? 1 : 0, z: 3, shade: 0, cast: 0 } : { rot: 0, vis: 1, z: 2, shade: 0, cast: 1 - tt };
    return isCur ? { rot: 0, vis: 1, z: 1, shade: 0, cast: tt > 0.5 ? (tt - 0.5) * 2 : 0 } : { rot: -180 * (1 - Math.max(tt, 0.5)), vis: tt >= 0.5 ? 1 : 0, z: 4, shade: 0, cast: 0 };
  };
  const style = useAnimatedStyle(() => {
    const g = geo();
    return {
      opacity: g.vis,
      zIndex: g.z,
      transform: [{ perspective: PERSPECTIVE }, { rotateY: `${g.rot}deg` }],
    };
  });
  const shadeStyle = useAnimatedStyle(() => {
    const g = geo();
    return { opacity: active.value ? leafShade(Math.abs(g.rot), 0.5) * curl * Math.min(1.3, shadowK + 0.3) : 0 };
  });
  const castStyle = useAnimatedStyle(() => {
    const g = geo();
    return { opacity: active.value ? Math.min(0.7, g.cast * 0.45 * shadowK) : 0 };
  });
  const specStyle = useAnimatedStyle(() => {
    const g = geo();
    const a = Math.abs(g.rot) % 180;
    return { opacity: active.value && specular ? Math.sin((a * Math.PI) / 90) * 0.18 : 0 };
  });
  const base: ViewStyle = {
    position: 'absolute', top: 0, width: pw, height: ph,
    left: flip ? (isLeft ? 0 : pw) : 0,
    transformOrigin: flip ? (isLeft ? 'right center' : 'left center') : 'left center',
    backgroundColor: p.theme.page, overflow: 'hidden', backfaceVisibility: 'hidden',
  };
  return (
    <Animated.View style={[base, style]} pointerEvents="box-none">
      {p.children}
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: '#000' }, shadeStyle]} />
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, specStyle]}>
        <LinearGradient colors={['rgba(255,255,255,0)', 'rgba(255,255,255,0.9)', 'rgba(255,255,255,0)']} start={{ x: 0.2, y: 0 }} end={{ x: 0.8, y: 0 }} style={StyleSheet.absoluteFill} />
      </Animated.View>
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: '#000' }, castStyle]} />
    </Animated.View>
  );
}

function Spine({ theme, mode, pw, ph, strength }: { theme: Theme; mode: FlipMode; pw: number; ph: number; strength: number }) {
  const w = Math.max(14, pw * 0.07);
  if (mode === 'double') {
    return (
      <View pointerEvents="none" style={{ position: 'absolute', left: pw - w, top: 0, width: w * 2, height: ph, zIndex: 10, opacity: 0.4 + strength * 0.6 }}>
        <LinearGradient colors={['rgba(0,0,0,0)', theme.gutter, 'rgba(0,0,0,0)']} locations={[0, 0.5, 1]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFill} />
      </View>
    );
  }
  return (
    <View pointerEvents="none" style={{ position: 'absolute', left: 0, top: 0, width: w, height: ph, zIndex: 10, opacity: 0.3 + strength * 0.5 }}>
      <LinearGradient colors={[theme.gutter, 'rgba(0,0,0,0)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFill} />
    </View>
  );
}

/** Stacked thin strips on the outer edges suggest the thickness of unread (right) / read (left) pages. */
function PageEdges({ theme, mode, pw, ph, layers, readFraction }: { theme: Theme; mode: FlipMode; pw: number; ph: number; layers: number; readFraction: number }) {
  const bookW = mode === 'double' ? pw * 2 : pw;
  const maxT = Math.min(8, Math.max(2, pw * 0.012));
  const right = Math.max(1, Math.round(maxT * (1 - readFraction)));
  const left = Math.max(mode === 'double' ? 1 : 0, Math.round(maxT * readFraction));
  const strips = (n: number, side: 'l' | 'r') => {
    const count = Math.max(1, Math.min(layers, n));
    return Array.from({ length: count }, (_, i) => {
      const off = ((i + 1) * n) / count;
      const style: ViewStyle = {
        position: 'absolute', top: 1 + i * 0.7, bottom: 1 + i * 0.7, width: 2,
        left: side === 'r' ? bookW + off - 2 : -off,
        backgroundColor: i % 2 ? theme.edge : theme.page, borderColor: 'rgba(0,0,0,0.14)',
        borderRightWidth: side === 'r' ? StyleSheet.hairlineWidth : 0, borderLeftWidth: side === 'l' ? StyleSheet.hairlineWidth : 0,
      };
      return <View key={`${side}${i}`} pointerEvents="none" style={style} />;
    });
  };
  return (
    <>
      {strips(right, 'r')}
      {mode === 'double' && left > 0 ? strips(left, 'l') : null}
    </>
  );
}
