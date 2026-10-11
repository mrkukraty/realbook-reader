// One reflowable page = one WebView showing a section paginated with CSS columns, offset to a page.
// The WebView stays mounted; moving within a section is a cheap injected `RB.go(...)`.
import React, { memo, useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import type { Settings } from '../settings/types';
import { buildPageHtml, type PageGeometry, type StartPos } from './page-html';

export interface SurfaceTarget { section: number; pos: StartPos; key: string }
export interface ShownInfo { section: number; page: number; pageCount: number; blank: boolean; key: string | null }
export type SurfaceEvent =
  | { type: 'tap'; x: number; y: number }
  | { type: 'dragStart'; dx: number }
  | { type: 'drag'; dx: number }
  | { type: 'dragEnd'; dx: number; vx: number }
  | { type: 'link'; section: number; anchor: string }
  | { type: 'ext'; url: string }
  | { type: 'selection'; text: string; start?: number; end?: number }
  | { type: 'hl'; id: string }
  | { type: 'pinch'; scale: number };

export interface SurfaceHighlight { id: string; start: number; end: number; color: string; note?: string }

interface Props {
  sid: string;
  target: SurfaceTarget | null;
  getSection(n: number): Promise<string>;
  settings: Settings;
  styleKey: string;
  geom: PageGeometry;
  even: boolean;
  lang?: string;
  highlightsFor(section: number): SurfaceHighlight[];
  highlightsVersion: number;
  searchMark: { section: number; start: number; end: number } | null;
  interactive: boolean;
  pageColor: string;
  onShown(sid: string, info: ShownInfo): void;
  onEvent(sid: string, e: SurfaceEvent): void;
}

const randomNonce = () => Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);

function PageSurfaceImpl(p: Props) {
  const web = useRef<WebView>(null);
  const [doc, setDoc] = useState<{ html: string; key: string } | null>(null);
  const loaded = useRef<{ section: number; styleKey: string; ready: boolean } | null>(null);
  const gen = useRef(0);
  const lastTargetKey = useRef<string | null>(null);
  const pendingPos = useRef<StartPos | null>(null);
  const pRef = useRef(p);
  pRef.current = p;

  const inject = (js: string) => web.current?.injectJavaScript(`try{${js}}catch(e){};true;`);

  useEffect(() => {
    const t = p.target;
    if (!t) {
      if (loaded.current?.ready) inject(`document.getElementById('c').style.visibility='hidden'`);
      p.onShown(p.sid, { section: -1, page: 0, pageCount: 0, blank: true, key: null });
      lastTargetKey.current = null;
      return;
    }
    const sameDoc = loaded.current && loaded.current.section === t.section && loaded.current.styleKey === p.styleKey;
    if (sameDoc && lastTargetKey.current === t.key) return;
    lastTargetKey.current = t.key;
    if (sameDoc) {
      if (loaded.current!.ready) inject(`window.__KEY=${JSON.stringify(t.key)};RB.go(${JSON.stringify(t.pos)})`);
      else pendingPos.current = t.pos;
      return;
    }
    let cancelled = false;
    const myGen = ++gen.current;
    loaded.current = { section: t.section, styleKey: p.styleKey, ready: false };
    pendingPos.current = null;
    void p.getSection(t.section).then((html) => {
      if (cancelled || myGen !== gen.current) return;
      setDoc({
        key: `${t.section}-${myGen}`,
        html: buildPageHtml({
          sectionHtml: html, settings: p.settings, geom: p.geom, start: t.pos,
          highlights: p.highlightsFor(t.section), sid: p.sid, gen: myGen, nonce: randomNonce(), lang: p.lang, even: p.even, key: t.key,
        }),
      });
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.target?.key, p.target?.section, p.styleKey]);

  // highlights changed for the loaded section
  useEffect(() => {
    if (!loaded.current?.ready) return;
    inject(`RB.setHighlights(${JSON.stringify(p.highlightsFor(loaded.current.section))})`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.highlightsVersion]);

  useEffect(() => {
    if (!loaded.current?.ready) return;
    const m = p.searchMark && p.searchMark.section === loaded.current.section ? p.searchMark : null;
    inject(`RB.setSearch(${JSON.stringify(m ? { start: m.start, end: m.end } : null)})`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.searchMark?.section, p.searchMark?.start, p.searchMark?.end]);

  const onMessage = (ev: WebViewMessageEvent) => {
    let m: Record<string, unknown>;
    try { m = JSON.parse(ev.nativeEvent.data); } catch { return; }
    if (m.gen !== gen.current || m.sid !== pRef.current.sid) return;
    const cur = pRef.current;
    switch (m.type) {
      case 'ready':
        if (loaded.current) loaded.current.ready = true;
        if (pendingPos.current) { inject(`window.__KEY=${JSON.stringify(lastTargetKey.current)};RB.go(${JSON.stringify(pendingPos.current)})`); pendingPos.current = null; }
        if (cur.searchMark && loaded.current && cur.searchMark.section === loaded.current.section) {
          inject(`RB.setSearch(${JSON.stringify({ start: cur.searchMark.start, end: cur.searchMark.end })})`);
        }
        return;
      case 'shown':
        cur.onShown(cur.sid, { section: loaded.current?.section ?? -1, page: Number(m.page), pageCount: Number(m.pageCount), blank: !!m.blank, key: typeof m.key === 'string' ? m.key : null });
        return;
      default:
        if (cur.interactive || m.type === 'selection') cur.onEvent(cur.sid, m as unknown as SurfaceEvent);
    }
  };

  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: p.pageColor }]} pointerEvents={p.interactive ? 'auto' : 'none'}>
      {doc ? (
        <WebView
          key={doc.key}
          ref={web}
          source={{ html: doc.html }}
          originWhitelist={['*']}
          onShouldStartLoadWithRequest={(r) => r.url === 'about:blank' || r.url.startsWith('about:') || r.url.startsWith('data:')}
          onMessage={onMessage}
          javaScriptEnabled
          scrollEnabled={false}
          bounces={false}
          overScrollMode="never"
          showsHorizontalScrollIndicator={false}
          showsVerticalScrollIndicator={false}
          textZoom={100}
          setSupportMultipleWindows={false}
          allowFileAccess={false}
          allowsLinkPreview={false}
          dataDetectorTypes="none"
          cacheEnabled={false}
          mixedContentMode="never"
          style={{ backgroundColor: p.pageColor, width: p.geom.width, height: p.geom.height }}
          containerStyle={{ backgroundColor: p.pageColor }}
          androidLayerType="hardware"
        />
      ) : null}
    </View>
  );
}

export const PageSurface = memo(PageSurfaceImpl);
