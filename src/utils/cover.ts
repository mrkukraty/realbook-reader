import type { BookMetadata, FixedDocument } from '../formats/types';
import { hashString } from './format';

export const COVER_MAX_WIDTH = 360;

function canvasToBlob(c: HTMLCanvasElement, type = 'image/jpeg', q = 0.82): Promise<Blob | null> {
  return new Promise((res) => c.toBlob((b) => res(b), type, q));
}

/** Downscale an image Blob to <= 360px wide JPEG. Returns undefined when the image can't be decoded. */
export async function makeThumbnail(src: Blob, maxW = COVER_MAX_WIDTH): Promise<Blob | undefined> {
  try {
    let w: number, h: number, draw: (ctx: CanvasRenderingContext2D, tw: number, th: number) => void, close = () => {};
    if (typeof createImageBitmap === 'function') {
      const bmp = await createImageBitmap(src);
      w = bmp.width; h = bmp.height; draw = (ctx, tw, th) => ctx.drawImage(bmp, 0, 0, tw, th); close = () => bmp.close?.();
    } else {
      const url = URL.createObjectURL(src);
      const img = await new Promise<HTMLImageElement>((res, rej) => {
        const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('decode')); i.src = url;
      });
      URL.revokeObjectURL(url);
      w = img.naturalWidth; h = img.naturalHeight; draw = (ctx, tw, th) => ctx.drawImage(img, 0, 0, tw, th);
    }
    if (!w || !h) { close(); return undefined; }
    const scale = Math.min(1, maxW / w);
    const tw = Math.max(1, Math.round(w * scale)); const th = Math.max(1, Math.round(h * scale));
    const c = document.createElement('canvas'); c.width = tw; c.height = th;
    const ctx = c.getContext('2d'); if (!ctx) { close(); return undefined; }
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, tw, th);
    draw(ctx, tw, th); close();
    return (await canvasToBlob(c)) ?? undefined;
  } catch { return undefined; }
}

/** Render page 0 of a fixed document to a thumbnail. */
export async function renderFixedCover(doc: FixedDocument): Promise<Blob | undefined> {
  if (doc.pageCount < 1) return undefined;
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-99999px;top:0;width:360px;pointer-events:none;overflow:hidden';
  document.body.appendChild(host);
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 15000);
  try {
    const width = COVER_MAX_WIDTH; const height = Math.round(width / (doc.aspect || 0.7));
    host.style.height = `${height}px`;
    await doc.renderPage(0, host, { width, height, signal: ac.signal });
    const canvas = host.querySelector('canvas');
    if (canvas) {
      const c = document.createElement('canvas'); c.width = canvas.width; c.height = canvas.height;
      const ctx = c.getContext('2d'); if (!ctx) return undefined;
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(canvas, 0, 0);
      const full = await canvasToBlob(c);
      return full ? (await makeThumbnail(full)) ?? full : undefined;
    }
    const img = host.querySelector('img');
    if (img?.src) { const blob = await (await fetch(img.src)).blob(); return makeThumbnail(blob); }
    return undefined;
  } catch { return undefined; }
  finally { clearTimeout(timer); host.remove(); }
}

const PALETTES: [string, string, string][] = [
  ['#6b2d2d', '#3d1a1a', '#e9d8b4'], ['#2d4a3e', '#16291f', '#e6dcc0'], ['#2f3e5c', '#182238', '#ead9b0'],
  ['#5a3e2b', '#2e1e13', '#f0e2c0'], ['#4a2f55', '#26172d', '#eadcc4'], ['#7a5c2e', '#3f2e14', '#f3e8cc'],
  ['#274c57', '#12272d', '#e8dfc3'], ['#5c2f43', '#2e1722', '#efe0c6'],
];

function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxW: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = []; let cur = '';
  for (const w of words) {
    const t = cur ? cur + ' ' + w : w;
    if (ctx.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t;
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) { const k = lines.slice(0, maxLines); k[maxLines - 1] = k[maxLines - 1].replace(/\s*\S*$/, '') + '...'; return k; }
  return lines;
}

/** Deterministic typographic placeholder cover (same title/author => same image). */
export async function makePlaceholderCover(meta: Pick<BookMetadata, 'title' | 'author'>): Promise<Blob | undefined> {
  try {
    const W = 300, H = 440;
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const ctx = c.getContext('2d'); if (!ctx) return undefined;
    const seed = hashString(`${meta.title}|${meta.author ?? ''}`);
    const [c1, c2, ink] = PALETTES[seed % PALETTES.length];
    const g = ctx.createLinearGradient(0, 0, W, H); g.addColorStop(0, c1); g.addColorStop(1, c2);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = ink; ctx.globalAlpha = 0.55; ctx.lineWidth = 2; ctx.strokeRect(18, 18, W - 36, H - 36);
    ctx.lineWidth = 1; ctx.strokeRect(24, 24, W - 48, H - 48); ctx.globalAlpha = 1;
    // ornament varies with seed
    ctx.fillStyle = ink; ctx.globalAlpha = 0.8;
    const n = 3 + (seed >> 3) % 4;
    for (let i = 0; i < n; i++) { const x = W / 2 + (i - (n - 1) / 2) * 16; ctx.beginPath(); ctx.arc(x, 86, 3, 0, Math.PI * 2); ctx.fill(); }
    ctx.globalAlpha = 1;
    ctx.textAlign = 'center'; ctx.fillStyle = ink;
    ctx.font = '600 30px Georgia, "Times New Roman", serif';
    const lines = wrapLines(ctx, meta.title || 'Untitled', W - 90, 6);
    const lh = 38; let y = 150 + Math.max(0, (5 - lines.length)) * 8;
    for (const l of lines) { ctx.fillText(l, W / 2, y); y += lh; }
    if (meta.author) {
      ctx.globalAlpha = 0.85; ctx.font = 'italic 19px Georgia, serif';
      const al = wrapLines(ctx, meta.author, W - 90, 2); let ay = H - 80 - (al.length - 1) * 24;
      for (const l of al) { ctx.fillText(l, W / 2, ay); ay += 24; }
    }
    return (await canvasToBlob(c)) ?? undefined;
  } catch { return undefined; }
}
