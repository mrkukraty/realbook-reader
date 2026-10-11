// Pinch-zoom viewer for fixed-layout pages (PDF / comics). Opens over the book showing the visible page(s)
// re-rendered at high resolution; pinch, pan and double-tap work as in a photo viewer. Zooming back out to
// 1x closes it and returns to page turning.
import React, { useEffect, useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { IconBtn } from '../components/ui';

const MAX_SCALE = 5;
const DOUBLE_TAP_SCALE = 2.5;

interface Props {
  /** visible pages left to right; null = blank half of a spread */
  pages: (number | null)[];
  pw: number;
  ph: number;
  /** initial zoom and its focal point relative to the book's centre */
  start: { scale: number; x: number; y: number };
  getPageUri(page: number, hiRes: boolean): Promise<string>;
  pageColor: string;
  chromeColor: string;
  onClose(): void;
}

export function ZoomView({ pages, pw, ph, start, getPageUri, pageColor, chromeColor, onClose }: Props) {
  const [box, setBox] = useState({ w: 1, h: 1 });
  const contentW = pw * pages.length;
  const s = useSharedValue(start.scale);
  const tx = useSharedValue(start.x * (1 - start.scale));
  const ty = useSharedValue(start.y * (1 - start.scale));
  const s0 = useSharedValue(1);
  const tx0 = useSharedValue(0);
  const ty0 = useSharedValue(0);
  const fx0 = useSharedValue(0);
  const fy0 = useSharedValue(0);
  const W = useSharedValue(1);
  const H = useSharedValue(1);
  useEffect(() => { W.value = box.w; H.value = box.h; }, [box, W, H]);

  // keep the content covering the viewport: no empty gaps at the edges when zoomed in
  const clampT = (v: number, scale: number, content: number, view: number) => {
    'worklet';
    const max = Math.max(0, (content * scale - view) / 2);
    return Math.min(max, Math.max(-max, v));
  };
  const settle = () => {
    'worklet';
    if (s.value <= 1.02) { scheduleOnRN(onClose); return; }
    const sc = Math.min(MAX_SCALE, s.value);
    s.value = withTiming(sc, { duration: 160 });
    tx.value = withTiming(clampT(tx.value, sc, contentW, W.value), { duration: 160 });
    ty.value = withTiming(clampT(ty.value, sc, ph, H.value), { duration: 160 });
  };

  const pinch = Gesture.Pinch()
    .onStart((e) => {
      s0.value = s.value; tx0.value = tx.value; ty0.value = ty.value;
      fx0.value = e.focalX - W.value / 2; fy0.value = e.focalY - H.value / 2;
    })
    .onUpdate((e) => {
      const ns = Math.min(MAX_SCALE * 1.2, Math.max(0.6, s0.value * e.scale));
      const k = ns / s0.value;
      const fx = e.focalX - W.value / 2;
      const fy = e.focalY - H.value / 2;
      s.value = ns;
      tx.value = fx - (fx0.value - tx0.value) * k;
      ty.value = fy - (fy0.value - ty0.value) * k;
    })
    .onEnd(() => settle());

  const pan = Gesture.Pan()
    .maxPointers(1)
    .onStart(() => { tx0.value = tx.value; ty0.value = ty.value; })
    .onUpdate((e) => {
      tx.value = clampT(tx0.value + e.translationX, s.value, contentW, W.value);
      ty.value = clampT(ty0.value + e.translationY, s.value, ph, H.value);
    });

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd((e, ok) => {
      if (!ok) return;
      if (s.value > 1.05) { scheduleOnRN(onClose); return; }
      const fx = e.x - W.value / 2;
      const fy = e.y - H.value / 2;
      const sc = DOUBLE_TAP_SCALE;
      s.value = withTiming(sc, { duration: 200 });
      tx.value = withTiming(clampT(fx * (1 - sc), sc, contentW, W.value), { duration: 200 });
      ty.value = withTiming(clampT(fy * (1 - sc), sc, ph, H.value), { duration: 200 });
    });

  const gestures = Gesture.Simultaneous(pinch, pan, doubleTap);
  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: s.value }],
  }));

  return (
    <View style={StyleSheet.absoluteFill} onLayout={(e) => setBox({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
      <GestureDetector gesture={gestures}>
        <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }]} collapsable={false}>
          <Animated.View style={[{ width: contentW, height: ph, flexDirection: 'row' }, style]}>
            {pages.map((p, i) => (
              <ZoomPage key={`${i}-${p}`} page={p} pw={pw} ph={ph} getPageUri={getPageUri} pageColor={pageColor} />
            ))}
          </Animated.View>
        </View>
      </GestureDetector>
      <View style={{ position: 'absolute', top: 8, right: 8, backgroundColor: chromeColor, borderRadius: 22, opacity: 0.92 }}>
        <IconBtn icon="contract-outline" label="Close zoom" onPress={onClose} />
      </View>
    </View>
  );
}

/** Shows the cached normal-resolution page at once, then swaps in the high-resolution render. */
function ZoomPage({ page, pw, ph, getPageUri, pageColor }: { page: number | null; pw: number; ph: number; getPageUri(page: number, hiRes: boolean): Promise<string>; pageColor: string }) {
  const [uri, setUri] = useState<string | null>(null);
  useEffect(() => {
    if (page === null) return;
    let alive = true;
    getPageUri(page, false).then((u) => { if (alive) setUri((cur) => cur ?? u); }).catch(() => {});
    getPageUri(page, true).then((u) => { if (alive) setUri(u); }).catch(() => {});
    return () => { alive = false; };
  }, [page, getPageUri]);
  return (
    <View style={{ width: pw, height: ph, backgroundColor: pageColor }}>
      {uri ? <Image source={{ uri }} resizeMode="contain" style={StyleSheet.absoluteFill} accessibilityLabel={page !== null ? `Page ${page + 1}, zoomed` : undefined} /> : null}
    </View>
  );
}
