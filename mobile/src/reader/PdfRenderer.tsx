// Hidden WebView that runs pdf.js (bundled, no network) and renders pages to JPEG files in the cache.
import React, { forwardRef, useImperativeHandle, useMemo, useRef } from 'react';
import { View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import type { File } from 'expo-file-system';
import { buildPdfRendererHtml } from './pdf-html';
import { pageCacheFile } from '../platform/files';

export interface PdfOutlineItem { title: string; page: number; children: PdfOutlineItem[] }
export interface PdfOpened { pageCount: number; aspect: number; toc: PdfOutlineItem[] }

/** Theme colours to paint the page with (paper / ink); null keeps the PDF's own colours. */
export interface PageTint { bg: string; fg: string }

export interface PdfRendererHandle {
  getPageUri(page: number, width: number, tint?: PageTint | null): Promise<string>;
  /** The page's text rebuilt as simple HTML paragraphs, for the text view. '' if the page has no text. */
  getHtml(page: number): Promise<string>;
  getText(page: number): Promise<string>;
}

interface Props {
  bookId: string;
  file: File;
  onOpened(info: PdfOpened): void;
  onError(message: string): void;
}

const CHUNK = 512 * 1024;

const rgb = (hex: string): [number, number, number] => {
  const h = hex.replace('#', '');
  const v = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.slice(0, 6);
  const n = parseInt(v, 16) || 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const tintTag = (t: PageTint) => `${t.bg}${t.fg}`.replace(/[^0-9a-fA-F]/g, '').toLowerCase();

export const PdfRenderer = forwardRef<PdfRendererHandle, Props>(function PdfRenderer({ bookId, file, onOpened, onError }, ref) {
  const web = useRef<WebView>(null);
  const html = useMemo(() => buildPdfRendererHtml(), []);
  const pagePending = useRef(new Map<string, { resolve(u: string): void; reject(e: Error): void }[]>());
  const textPending = useRef(new Map<number, ((t: string) => void)[]>());
  const htmlPending = useRef(new Map<number, ((t: string) => void)[]>());
  const htmlCache = useRef(new Map<number, string>());
  const opened = useRef(false);
  const waiters = useRef<(() => void)[]>([]);

  const send = (m: unknown) => web.current?.postMessage(JSON.stringify(m));
  const whenOpen = () => (opened.current ? Promise.resolve() : new Promise<void>((r) => waiters.current.push(r)));

  useImperativeHandle(ref, () => ({
    async getPageUri(page, width, tint) {
      const w = Math.max(200, Math.min(2400, Math.round(width)));
      const tag = tint ? tintTag(tint) : '';
      const f = pageCacheFile(bookId, page, w, tag);
      if (f.exists) return f.uri;
      await whenOpen();
      const key = `${page}:${w}:${tag}`;
      return new Promise<string>((resolve, reject) => {
        const list = pagePending.current.get(key);
        if (list) { list.push({ resolve, reject }); return; }
        pagePending.current.set(key, [{ resolve, reject }]);
        send({ type: 'render', page, width: w, quality: 0.85, tint: tint ? { bg: rgb(tint.bg), fg: rgb(tint.fg), tag } : null });
      });
    },
    async getHtml(page) {
      const hit = htmlCache.current.get(page);
      if (hit !== undefined) return hit;
      await whenOpen();
      return new Promise<string>((resolve) => {
        const list = htmlPending.current.get(page);
        if (list) { list.push(resolve); return; }
        htmlPending.current.set(page, [resolve]);
        send({ type: 'html', page });
      });
    },
    async getText(page) {
      await whenOpen();
      return new Promise<string>((resolve) => {
        const list = textPending.current.get(page);
        if (list) { list.push(resolve); return; }
        textPending.current.set(page, [resolve]);
        send({ type: 'text', page });
      });
    },
  }), [bookId]);

  const onMessage = async (ev: WebViewMessageEvent) => {
    let m: { type: string; [k: string]: unknown };
    try { m = JSON.parse(ev.nativeEvent.data); } catch { return; }
    switch (m.type) {
      case 'boot': {
        if (!m.ok) { onError('The PDF engine failed to start in this WebView.'); return; }
        try {
          const b64 = await file.base64();
          for (let i = 0; i < b64.length; i += CHUNK) send({ type: 'chunk', data: b64.slice(i, i + CHUNK) });
          send({ type: 'open' });
        } catch (e) {
          onError(`The PDF file could not be read (${e instanceof Error ? e.message : String(e)}).`);
        }
        return;
      }
      case 'opened':
        opened.current = true;
        waiters.current.splice(0).forEach((w) => w());
        onOpened({ pageCount: Number(m.pageCount), aspect: Number(m.aspect) || 0.707, toc: (m.toc as PdfOutlineItem[]) ?? [] });
        return;
      case 'error': {
        const name = String(m.name ?? '');
        const msg = String(m.msg ?? '');
        if (/Password/i.test(name) || /password/i.test(msg)) onError('This PDF is password-protected. RealBook Reader cannot open encrypted PDFs; remove the password with the tool that created it and import it again.');
        else if (/Invalid PDF|InvalidPDF|structure|xref/i.test(name + msg)) onError('This PDF is damaged and could not be opened. Try downloading it again.');
        else onError(`This PDF could not be opened: ${msg}`);
        return;
      }
      case 'page': {
        const page = Number(m.page);
        const w = Number(m.width);
        const tag = String(m.tag ?? '');
        const key = `${page}:${w}:${tag}`;
        const list = pagePending.current.get(key) ?? [];
        pagePending.current.delete(key);
        try {
          const data = String(m.data);
          const f = pageCacheFile(bookId, page, w, tag);
          f.write(data.slice(data.indexOf(',') + 1), { encoding: 'base64' });
          list.forEach((l) => l.resolve(f.uri));
        } catch (e) {
          list.forEach((l) => l.reject(e instanceof Error ? e : new Error(String(e))));
        }
        return;
      }
      case 'pageError': {
        const page = Number(m.page);
        for (const [k, list] of pagePending.current) {
          if (k.startsWith(`${page}:`)) { pagePending.current.delete(k); list.forEach((l) => l.reject(new Error(String(m.msg)))); }
        }
        return;
      }
      case 'html': {
        const page = Number(m.page);
        const html = String(m.html ?? '');
        htmlCache.current.set(page, html);
        const list = htmlPending.current.get(page) ?? [];
        htmlPending.current.delete(page);
        list.forEach((r) => r(html));
        return;
      }
      case 'text': {
        const page = Number(m.page);
        const list = textPending.current.get(page) ?? [];
        textPending.current.delete(page);
        list.forEach((r) => r(String(m.text ?? '')));
        return;
      }
      default:
    }
  };

  return (
    <View style={{ position: 'absolute', width: 2, height: 2, opacity: 0, left: -10, top: -10 }} pointerEvents="none">
      <WebView
        ref={web}
        source={{ html }}
        originWhitelist={['*']}
        onShouldStartLoadWithRequest={(r) => r.url.startsWith('about:') || r.url.startsWith('data:') || r.url.startsWith('blob:')}
        onMessage={onMessage}
        javaScriptEnabled
        cacheEnabled={false}
        allowFileAccess={false}
        setSupportMultipleWindows={false}
        mixedContentMode="never"
      />
    </View>
  );
});
