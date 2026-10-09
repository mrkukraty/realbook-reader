import type JSZip from 'jszip';
import {
  ImportError, type BookMetadata, type FormatAdapter, type ReflowDocument, type ReflowSection, type Target, type TocItem,
} from '../types';
import { loadZip, findEntry, zipText } from '../zip';
import { parseXml, kids, kid, all, textOf, stripTags } from '../xml';
import { parseHtmlBody, parseXhtmlBody, sanitizeHtml, splitChildren } from '../sanitize';
import { ascii, extOf, finalizeMeta, mimeFromPath, resolvePath, wrapError } from '../util';

const FONT_OBFUSCATION = new Set([
  'http://www.idpf.org/2008/embedding',
  'http://ns.adobe.com/pdf/enc#RC',
]);

interface ManifestItem { id: string; href: string; path: string; mediaType: string; properties: string[] }

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function hrefAttr(el: Element): Attr | undefined {
  for (const a of Array.from(el.attributes)) if (a.localName === 'href' || a.name === 'xlink:href') return a;
  return undefined;
}

function splitHref(href: string): { path: string; frag?: string } {
  const i = href.indexOf('#');
  return i < 0 ? { path: href } : { path: href.slice(0, i), frag: href.slice(i + 1) };
}

async function checkDrm(zip: JSZip): Promise<void> {
  if (findEntry(zip, 'META-INF/rights.xml')) {
    throw new ImportError(
      'This EPUB is protected by DRM (rights.xml found) and cannot be opened. RealBook Reader does not bypass DRM; please use a DRM-free copy.',
      'drm',
    );
  }
  const enc = await zipText(zip, 'META-INF/encryption.xml');
  if (!enc) return;
  let doc: Document;
  try { doc = parseXml(enc); } catch { return; }
  for (const m of all(doc, 'EncryptionMethod')) {
    const alg = m.getAttribute('Algorithm') ?? '';
    if (!FONT_OBFUSCATION.has(alg)) {
      throw new ImportError(
        'This EPUB is protected by DRM (its content is encrypted) and cannot be opened. RealBook Reader does not bypass DRM; please use a DRM-free copy.',
        'drm',
      );
    }
  }
}

export async function openEpub(data: Blob, fileName: string, onProgress?: (f: number, l?: string) => void): Promise<ReflowDocument> {
  const zip = await loadZip(data, 'EPUB');
  await checkDrm(zip);

  const containerXml = await zipText(zip, 'META-INF/container.xml');
  if (!containerXml) throw new ImportError('This EPUB is damaged: META-INF/container.xml is missing.', 'corrupt');
  const container = parseXml(containerXml, 'EPUB container');
  const rootfile = all(container, 'rootfile')[0]?.getAttribute('full-path');
  if (!rootfile) throw new ImportError('This EPUB is damaged: it does not point to a package (OPF) file.', 'corrupt');
  const opfPath = rootfile.replace(/^\/+/, '');
  const opfText = await zipText(zip, opfPath);
  if (!opfText) throw new ImportError('This EPUB is damaged: the package (OPF) file is missing.', 'corrupt');
  const opf = parseXml(opfText, 'EPUB package');
  onProgress?.(0.1, 'Reading package');

  // manifest
  const manifest = new Map<string, ManifestItem>();
  const byPath = new Map<string, ManifestItem>();
  for (const it of all(opf, 'item')) {
    const id = it.getAttribute('id');
    const href = it.getAttribute('href');
    if (!id || !href) continue;
    const path = resolvePath(opfPath, splitHref(href).path);
    const item: ManifestItem = {
      id, href, path, mediaType: it.getAttribute('media-type') ?? mimeFromPath(path),
      properties: (it.getAttribute('properties') ?? '').split(/\s+/).filter(Boolean),
    };
    manifest.set(id, item);
    byPath.set(path, item);
  }

  // metadata
  const metaEl = all(opf, 'metadata')[0];
  const dc = (name: string) => (metaEl ? all(metaEl, name).map(textOf).filter(Boolean) : []);
  const metadata: BookMetadata = finalizeMeta({
    title: dc('title')[0],
    author: dc('creator').join(', '),
    language: dc('language')[0],
    publisher: dc('publisher')[0],
    published: dc('date')[0],
    description: stripTags(dc('description')[0] ?? ''),
  }, fileName);

  // spine
  const spineEl = all(opf, 'spine')[0];
  const spinePaths: string[] = [];
  for (const ref of kids(spineEl, 'itemref')) {
    const item = manifest.get(ref.getAttribute('idref') ?? '');
    if (!item) continue;
    if (!/html|xml/i.test(item.mediaType) || /ncx|opf/i.test(item.mediaType)) continue;
    if (!zip.file(item.path)) continue;
    spinePaths.push(item.path);
  }
  if (spinePaths.length === 0) throw new ImportError('This EPUB has no readable chapters (its reading order is empty).', 'corrupt');

  // blob URL management
  const urls: string[] = [];
  const urlCache = new Map<string, string | null>();
  const makeUrl = async (path: string): Promise<string | null> => {
    if (urlCache.has(path)) return urlCache.get(path)!;
    const f = findEntry(zip, path);
    let result: string | null = null;
    if (f) {
      const bytes = await f.async('uint8array');
      const mime = byPath.get(path)?.mediaType.startsWith('image/') ? byPath.get(path)!.mediaType : mimeFromPath(path);
      if (typeof URL.createObjectURL === 'function') {
        result = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }));
        urls.push(result);
      } else {
        result = `data:${mime};base64,${toBase64(bytes)}`;
      }
    }
    urlCache.set(path, result);
    return result;
  };

  // cover
  let coverPath: string | undefined;
  const coverMeta = metaEl && all(metaEl, 'meta').find((m) => m.getAttribute('name') === 'cover');
  const coverItem =
    [...manifest.values()].find((m) => m.properties.includes('cover-image')) ??
    (coverMeta ? manifest.get(coverMeta.getAttribute('content') ?? '') : undefined);
  if (coverItem && coverItem.mediaType.startsWith('image/')) coverPath = coverItem.path;
  if (!coverPath) {
    const ref = all(opf, 'reference').find((r) => (r.getAttribute('type') ?? '').toLowerCase() === 'cover');
    const p = ref && resolvePath(opfPath, splitHref(ref.getAttribute('href') ?? '').path);
    if (p && /\.(jpe?g|png|gif|webp|svg)$/i.test(p)) coverPath = p;
    else if (p) {
      // cover page (xhtml) -> first image in it
      const t = await zipText(zip, p);
      const m = t && /<(?:img|image)\b[^>]*?(?:src|href)\s*=\s*["']([^"']+)["']/i.exec(t);
      if (m) coverPath = resolvePath(p, splitHref(m[1]).path);
    }
  }
  if (!coverPath) {
    const guess = [...manifest.values()].find((m) => m.mediaType.startsWith('image/') && /cover/i.test(m.id + m.href));
    if (guess) coverPath = guess.path;
  }
  let cover: Blob | undefined;
  if (coverPath) {
    const f = findEntry(zip, coverPath);
    if (f) {
      const bytes = await f.async('uint8array');
      cover = new Blob([bytes as BlobPart], { type: byPath.get(coverPath)?.mediaType ?? mimeFromPath(coverPath) });
    }
  }

  // pass A: parse chapters into containers, drop empty, split big ones
  interface Rec { path: string; nodes: Node[]; idx: number }
  const recs: Rec[] = [];
  const pathFirst = new Map<string, number>();
  const pathAnchors = new Map<string, Map<string, number>>();
  let kept = 0;
  for (let i = 0; i < spinePaths.length; i++) {
    const path = spinePaths[i];
    const text = await zip.file(path)!.async('string');
    const root = parseXhtmlBody(text);
    const hasContent = (root.textContent ?? '').trim().length > 0 || !!root.querySelector('img,svg,image,hr,table');
    pathFirst.set(path, kept);
    if (!hasContent) continue;
    const groups = splitChildren(root);
    const anchors = new Map<string, number>();
    pathAnchors.set(path, anchors);
    pathFirst.set(path, kept);
    for (const g of groups) {
      const idx = kept++;
      for (const n of g) {
        if (n.nodeType !== 1) continue;
        const el = n as Element;
        if (el.id && !anchors.has(el.id)) anchors.set(el.id, idx);
        for (const d of Array.from(el.querySelectorAll('[id]'))) if (!anchors.has(d.id)) anchors.set(d.id, idx);
      }
      recs.push({ path, nodes: g, idx });
    }
    onProgress?.(0.1 + 0.3 * ((i + 1) / spinePaths.length), 'Parsing chapters');
  }
  if (recs.length === 0) throw new ImportError('This EPUB contains no readable text.', 'corrupt');
  const maxIdx = recs.length - 1;
  for (const [p, v] of pathFirst) pathFirst.set(p, Math.min(v, maxIdx));

  // TOC
  const toc = await buildToc();
  async function buildToc(): Promise<TocItem[]> {
    const resolveTarget = (base: string, href: string): Target | undefined => {
      const { path, frag } = splitHref(href);
      const p = path ? resolvePath(base, path) : base;
      const first = pathFirst.get(p);
      if (first === undefined) return undefined;
      if (frag) {
        const idx = pathAnchors.get(p)?.get(frag) ?? first;
        return { section: idx, anchor: frag };
      }
      return { section: first };
    };
    let items: TocItem[] = [];
    // EPUB3 nav
    const navItem = [...manifest.values()].find((m) => m.properties.includes('nav'));
    if (navItem && zip.file(navItem.path)) {
      const nav = parseHtmlBody(await zip.file(navItem.path)!.async('string'));
      const navs = Array.from(nav.querySelectorAll('nav'));
      const tocNav = navs.find((n) => /\btoc\b/.test(n.getAttribute('epub:type') ?? n.getAttribute('type') ?? '')) ?? navs[0];
      const parseOl = (ol: Element): TocItem[] => {
        const out: TocItem[] = [];
        for (const li of Array.from(ol.children).filter((c) => c.tagName === 'LI')) {
          const a = Array.from(li.children).find((c) => c.tagName === 'A');
          const label = textOf(a ?? Array.from(li.children).find((c) => c.tagName === 'SPAN'));
          const sub = Array.from(li.children).find((c) => c.tagName === 'OL');
          const children = sub ? parseOl(sub) : [];
          const target = a?.getAttribute('href') ? resolveTarget(navItem.path, a.getAttribute('href')!) : undefined;
          if (target && label) out.push({ title: label, target, children: children.length ? children : undefined });
          else out.push(...children);
        }
        return out;
      };
      const ol = tocNav && Array.from(tocNav.children).find((c) => c.tagName === 'OL');
      if (ol) items = parseOl(ol);
    }
    // EPUB2 ncx
    if (items.length === 0) {
      const ncxId = spineEl?.getAttribute('toc');
      const ncx = (ncxId && manifest.get(ncxId)) || [...manifest.values()].find((m) => /ncx/i.test(m.mediaType));
      if (ncx && zip.file(ncx.path)) {
        try {
          const doc = parseXml(await zip.file(ncx.path)!.async('string'), 'NCX');
          const navMap = all(doc, 'navMap')[0];
          const parsePoints = (parent: Element): TocItem[] => {
            const out: TocItem[] = [];
            for (const np of kids(parent, 'navPoint')) {
              const label = textOf(kid(kid(np, 'navLabel'), 'text'));
              const src = kid(np, 'content')?.getAttribute('src');
              const children = parsePoints(np);
              const target = src ? resolveTarget(ncx.path, src) : undefined;
              if (target && label) out.push({ title: label, target, children: children.length ? children : undefined });
              else out.push(...children);
            }
            return out;
          };
          if (navMap) items = parsePoints(navMap);
        } catch { /* fall through to spine titles */ }
      }
    }
    return items;
  }

  // section titles from toc
  const tocTitle = new Map<number, string>();
  (function walk(list: TocItem[]) {
    for (const t of list) {
      const tg = t.target as { section: number };
      if (!tocTitle.has(tg.section)) tocTitle.set(tg.section, t.title);
      if (t.children) walk(t.children);
    }
  })(toc);

  // pass B: rewrite + serialize
  const sections: ReflowSection[] = [];
  for (const rec of recs) {
    const holder = rec.nodes[0]?.ownerDocument ?? document.implementation.createHTMLDocument('');
    const div = holder.createElement('div');
    for (const n of rec.nodes) div.appendChild(n);

    // images
    for (const img of Array.from(div.querySelectorAll('img'))) {
      const src = img.getAttribute('src') ?? '';
      if (src.startsWith('data:')) continue;
      const url = /^[a-z][a-z0-9+.-]*:/i.test(src) ? null : await makeUrl(resolvePath(rec.path, splitHref(src).path));
      if (url) img.setAttribute('src', url);
      else img.remove();
    }
    for (const im of Array.from(div.querySelectorAll('image'))) {
      const attr = hrefAttr(im);
      if (!attr || attr.value.startsWith('data:')) continue;
      const url = /^[a-z][a-z0-9+.-]*:/i.test(attr.value) ? null : await makeUrl(resolvePath(rec.path, splitHref(attr.value).path));
      if (url) attr.value = url;
      else im.remove();
    }
    // links
    for (const a of Array.from(div.querySelectorAll('a[href]'))) {
      const href = a.getAttribute('href') ?? '';
      if (/^[a-z][a-z0-9+.-]*:/i.test(href)) continue; // external
      const { path, frag } = splitHref(href);
      const p = path ? resolvePath(rec.path, path) : rec.path;
      const first = pathFirst.get(p);
      if (first === undefined) {
        a.replaceWith(...Array.from(a.childNodes));
        continue;
      }
      const sec = frag ? (pathAnchors.get(p)?.get(frag) ?? first) : first;
      a.setAttribute('href', '#');
      a.setAttribute('data-sec', String(sec));
      if (frag) a.setAttribute('data-anchor', frag);
    }
    const heading = div.querySelector('h1,h2,h3');
    const html = sanitizeHtml(div.innerHTML);
    sections.push({
      id: `s${rec.idx}`,
      title: tocTitle.get(rec.idx) ?? (heading ? textOf(heading) : undefined),
      html,
    });
    onProgress?.(0.4 + 0.6 * ((rec.idx + 1) / recs.length), 'Preparing chapters');
  }

  let finalToc = toc;
  if (finalToc.length === 0) {
    finalToc = sections
      .map((s, i) => ({ s, i }))
      .filter(({ s }) => !!s.title)
      .map(({ s, i }) => ({ title: s.title!, target: { section: i } as Target }));
    if (finalToc.length === 0 && sections.length > 1) {
      finalToc = sections.map((_, i) => ({ title: `Section ${i + 1}`, target: { section: i } as Target }));
    }
  }

  return {
    kind: 'reflow',
    metadata,
    cover,
    sections,
    toc: finalToc,
    dispose() {
      for (const u of urls.splice(0)) URL.revokeObjectURL(u);
      urlCache.clear();
    },
  };
}

export const epubAdapter: FormatAdapter = {
  id: 'epub',
  label: 'EPUB',
  extensions: ['epub'],
  detect(head, fileName) {
    const isZip = head[0] === 0x50 && head[1] === 0x4b;
    if (!isZip) return false;
    return extOf(fileName) === 'epub' || ascii(head, 30, 90).includes('application/epub+zip');
  },
  async open(data, fileName, onProgress) {
    try {
      return await openEpub(data, fileName, onProgress);
    } catch (e) {
      throw wrapError(e, 'EPUB');
    }
  },
};
