import type JSZip from 'jszip';
import type { ChildNode } from 'domhandler';
import {
  ImportError, type BookMetadata, type ReflowDocument, type ReflowSection, type Target, type TocItem, type ProgressCb,
} from './types';
import { loadZip, findEntry, zipText } from './zip';
import {
  attr, bodyNodes, childEls, chunkNodes, findAll, findFirst, parseHtml, parseXmlDoc, stripTags, textOf, walk,
} from './markup';
import { dataUri, finalizeMeta, mimeFromPath, resolvePath, wrapError } from './util';

const FONT_OBFUSCATION = new Set(['http://www.idpf.org/2008/embedding', 'http://ns.adobe.com/pdf/enc#RC']);
const MAX_IMG = 4 * 1024 * 1024;

interface ManifestItem { id: string; href: string; path: string; mediaType: string; properties: string[] }

function splitHref(href: string): { path: string; frag?: string } {
  const i = href.indexOf('#');
  return i < 0 ? { path: href } : { path: href.slice(0, i), frag: href.slice(i + 1) };
}
const isExternal = (h: string) => /^[a-z][a-z0-9+.-]*:/i.test(h);

async function checkDrm(zip: JSZip): Promise<void> {
  if (findEntry(zip, 'META-INF/rights.xml')) {
    throw new ImportError('This EPUB is protected by DRM (rights.xml found) and cannot be opened. RealBook Reader does not bypass DRM; please use a DRM-free copy.', 'drm');
  }
  const enc = await zipText(zip, 'META-INF/encryption.xml');
  if (!enc) return;
  for (const m of findAll(parseXmlDoc(enc), 'EncryptionMethod')) {
    if (!FONT_OBFUSCATION.has(attr(m, 'Algorithm') ?? '')) {
      throw new ImportError('This EPUB is protected by DRM (its content is encrypted) and cannot be opened. RealBook Reader does not bypass DRM; please use a DRM-free copy.', 'drm');
    }
  }
}

export async function openEpub(data: Uint8Array, fileName: string, onProgress?: ProgressCb): Promise<ReflowDocument> {
  try {
    return await openEpubInner(data, fileName, onProgress);
  } catch (e) {
    throw wrapError(e, 'EPUB');
  }
}

async function openEpubInner(data: Uint8Array, fileName: string, onProgress?: ProgressCb): Promise<ReflowDocument> {
  const zip = await loadZip(data, 'EPUB');
  await checkDrm(zip);

  const containerXml = await zipText(zip, 'META-INF/container.xml');
  if (!containerXml) throw new ImportError('This EPUB is damaged: META-INF/container.xml is missing.', 'corrupt');
  const rootfile = attr(findAll(parseXmlDoc(containerXml), 'rootfile')[0] ?? ({ attribs: {} } as never), 'full-path');
  if (!rootfile) throw new ImportError('This EPUB is damaged: it does not point to a package (OPF) file.', 'corrupt');
  const opfPath = rootfile.replace(/^\/+/, '');
  const opfText = await zipText(zip, opfPath);
  if (!opfText) throw new ImportError('This EPUB is damaged: the package (OPF) file is missing.', 'corrupt');
  const opf = parseXmlDoc(opfText);
  onProgress?.(0.1, 'Reading package');

  const manifest = new Map<string, ManifestItem>();
  const byPath = new Map<string, ManifestItem>();
  for (const it of findAll(opf, 'item')) {
    const id = attr(it, 'id');
    const href = attr(it, 'href');
    if (!id || !href) continue;
    const path = resolvePath(opfPath, splitHref(href).path);
    const item: ManifestItem = {
      id, href, path, mediaType: attr(it, 'media-type') ?? mimeFromPath(path),
      properties: (attr(it, 'properties') ?? '').split(/\s+/).filter(Boolean),
    };
    manifest.set(id, item);
    byPath.set(path, item);
  }

  const metaEl = findFirst(opf, 'metadata');
  const dc = (name: string) => (metaEl ? findAll(metaEl, name).map((e) => textOf(e)).filter(Boolean) : []);
  const metadata: BookMetadata = finalizeMeta({
    title: dc('title')[0],
    author: dc('creator').join(', '),
    language: dc('language')[0],
    publisher: dc('publisher')[0],
    published: dc('date')[0],
    description: stripTags(dc('description')[0] ?? ''),
  }, fileName);

  const spineEl = findFirst(opf, 'spine');
  const spinePaths: string[] = [];
  for (const ref of childEls(spineEl, 'itemref')) {
    const item = manifest.get(attr(ref, 'idref') ?? '');
    if (!item) continue;
    if (!/html|xml/i.test(item.mediaType) || /ncx|opf/i.test(item.mediaType)) continue;
    if (!findEntry(zip, item.path)) continue;
    spinePaths.push(item.path);
  }
  if (spinePaths.length === 0) throw new ImportError('This EPUB has no readable chapters (its reading order is empty).', 'corrupt');

  // cover
  let coverPath: string | undefined;
  const coverMeta = metaEl && findAll(metaEl, 'meta').find((m) => attr(m, 'name') === 'cover');
  const coverItem =
    [...manifest.values()].find((m) => m.properties.includes('cover-image')) ??
    (coverMeta ? manifest.get(attr(coverMeta, 'content') ?? '') : undefined);
  if (coverItem && coverItem.mediaType.startsWith('image/')) coverPath = coverItem.path;
  if (!coverPath) {
    const ref = findAll(opf, 'reference').find((r) => (attr(r, 'type') ?? '').toLowerCase() === 'cover');
    const p = ref && resolvePath(opfPath, splitHref(attr(ref, 'href') ?? '').path);
    if (p && /\.(jpe?g|png|gif|webp)$/i.test(p)) coverPath = p;
    else if (p) {
      const t = await zipText(zip, p);
      const m = t && /<(?:img|image)\b[^>]*?(?:src|href)\s*=\s*["']([^"']+)["']/i.exec(t);
      if (m) coverPath = resolvePath(p, splitHref(m[1]).path);
    }
  }
  if (!coverPath) {
    const guess = [...manifest.values()].find((m) => m.mediaType.startsWith('image/') && /cover/i.test(m.id + m.href));
    if (guess) coverPath = guess.path;
  }
  let cover: ReflowDocument['cover'];
  if (coverPath) {
    const f = findEntry(zip, coverPath);
    if (f) cover = { bytes: await f.async('uint8array'), mime: byPath.get(coverPath)?.mediaType ?? mimeFromPath(coverPath) };
  }

  // pass A: parse chapters -> chunks
  interface Rec { path: string; html: string; idx: number }
  const recs: Rec[] = [];
  const pathFirst = new Map<string, number>();
  const pathAnchors = new Map<string, Map<string, number>>();
  let kept = 0;
  const imgCache = new Map<string, string | null>();
  for (let i = 0; i < spinePaths.length; i++) {
    const path = spinePaths[i];
    const text = (await zipText(zip, path)) ?? '';
    const doc = parseHtml(text);
    const nodes = bodyNodes(doc);
    // pre-resolve images (async) so the sanitizer can stay synchronous
    const imgRefs: string[] = [];
    walk(nodes, (e) => {
      const n = e.name.replace(/^.*:/, '').toLowerCase();
      if (n === 'img' || n === 'image') { const s = attr(e, 'src') ?? attr(e, 'href'); if (s) imgRefs.push(s); }
    });
    for (const s of imgRefs) {
      if (s.startsWith('data:') || isExternal(s)) continue;
      const p = resolvePath(path, splitHref(s).path);
      if (imgCache.has(p)) continue;
      const f = findEntry(zip, p);
      if (!f) { imgCache.set(p, null); continue; }
      const bytes = await f.async('uint8array');
      imgCache.set(p, bytes.length > MAX_IMG ? null : dataUri(bytes, byPath.get(p)?.mediaType?.startsWith('image/') ? byPath.get(p)!.mediaType : mimeFromPath(p)));
    }
    const chunks = chunkNodes(nodes as ChildNode[], {
      imageSrc: (s) => (s.startsWith('data:image/') ? s : isExternal(s) ? null : imgCache.get(resolvePath(path, splitHref(s).path)) ?? null),
      link: (href) => {
        if (/^(https?:|mailto:)/i.test(href)) return { kind: 'external', url: href };
        if (isExternal(href)) return { kind: 'drop' };
        const { path: lp, frag } = splitHref(href);
        return { kind: 'path', path: lp ? resolvePath(path, lp) : path, frag };
      },
    });
    pathFirst.set(path, kept);
    const anchors = new Map<string, number>();
    pathAnchors.set(path, anchors);
    for (const c of chunks) {
      const idx = kept++;
      for (const id of c.ids) if (!anchors.has(id)) anchors.set(id, idx);
      recs.push({ path, html: c.html, idx });
    }
    onProgress?.(0.1 + 0.6 * ((i + 1) / spinePaths.length), 'Parsing chapters');
  }
  if (recs.length === 0) throw new ImportError('This EPUB contains no readable text.', 'corrupt');
  const maxIdx = recs.length - 1;
  for (const [p, v] of pathFirst) pathFirst.set(p, Math.min(v, maxIdx));

  const resolveTarget = (base: string, href: string): Target | undefined => {
    const { path, frag } = splitHref(href);
    const p = path ? resolvePath(base, path) : base;
    const first = pathFirst.get(p);
    if (first === undefined) return undefined;
    if (frag) return { section: pathAnchors.get(p)?.get(frag) ?? first, anchor: frag };
    return { section: first };
  };

  // TOC
  let toc: TocItem[] = [];
  const navItem = [...manifest.values()].find((m) => m.properties.includes('nav'));
  if (navItem) {
    const navText = await zipText(zip, navItem.path);
    if (navText) {
      const nd = parseHtml(navText);
      const navs = findAll(nd, 'nav');
      const tocNav = navs.find((n) => /\btoc\b/.test(attr(n, 'epub:type') ?? attr(n, 'type') ?? '')) ?? navs[0];
      const parseOl = (ol: ReturnType<typeof childEls>[number]): TocItem[] => {
        const out: TocItem[] = [];
        for (const li of childEls(ol, 'li')) {
          const a = childEls(li, 'a')[0];
          const label = textOf(a ?? childEls(li, 'span')[0]);
          const sub = childEls(li, 'ol')[0];
          const children = sub ? parseOl(sub) : [];
          const href = a && attr(a, 'href');
          const target = href ? resolveTarget(navItem.path, href) : undefined;
          if (target && label) out.push({ title: label, target, children: children.length ? children : undefined });
          else out.push(...children);
        }
        return out;
      };
      const ol = tocNav && childEls(tocNav, 'ol')[0];
      if (ol) toc = parseOl(ol);
    }
  }
  if (toc.length === 0) {
    const ncxId = spineEl && attr(spineEl, 'toc');
    const ncx = (ncxId && manifest.get(ncxId)) || [...manifest.values()].find((m) => /ncx/i.test(m.mediaType));
    const ncxText = ncx && (await zipText(zip, ncx.path));
    if (ncx && ncxText) {
      try {
        const navMap = findAll(parseXmlDoc(ncxText), 'navMap')[0];
        const points = (parent: typeof navMap): TocItem[] => {
          const out: TocItem[] = [];
          for (const np of childEls(parent, 'navPoint')) {
            const label = textOf(childEls(childEls(np, 'navLabel')[0], 'text')[0]);
            const src = attr(childEls(np, 'content')[0] ?? ({ attribs: {} } as never), 'src');
            const children = points(np);
            const target = src ? resolveTarget(ncx.path, src) : undefined;
            if (target && label) out.push({ title: label, target, children: children.length ? children : undefined });
            else out.push(...children);
          }
          return out;
        };
        if (navMap) toc = points(navMap);
      } catch { /* fall back to spine titles */ }
    }
  }

  const tocTitle = new Map<number, string>();
  (function collect(list: TocItem[]) {
    for (const t of list) {
      const tg = t.target as { section: number };
      if (!tocTitle.has(tg.section)) tocTitle.set(tg.section, t.title);
      if (t.children) collect(t.children);
    }
  })(toc);

  // pass B: resolve internal links
  const sections: ReflowSection[] = recs.map((rec) => {
    const html = rec.html.replace(/data-lp="([^"]*)" data-lf="([^"]*)"/g, (_m, p: string, f: string) => {
      const path = p.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
      const frag = f.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
      const first = pathFirst.get(path);
      if (first === undefined) return 'data-sec="" data-anchor=""';
      const sec = frag ? (pathAnchors.get(path)?.get(frag) ?? first) : first;
      return `data-sec="${sec}" data-anchor="${f}"`;
    });
    const h = /<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/i.exec(html);
    return { id: `s${rec.idx}`, title: tocTitle.get(rec.idx) ?? (h ? stripTags(h[1]) || undefined : undefined), html };
  });

  if (toc.length === 0) {
    toc = sections.map((s, i) => ({ s, i })).filter(({ s }) => !!s.title).map(({ s, i }) => ({ title: s.title!, target: { section: i } as Target }));
    if (toc.length === 0 && sections.length > 1) toc = sections.map((_s, i) => ({ title: `Section ${i + 1}`, target: { section: i } as Target }));
  }
  onProgress?.(1, 'Done');
  return { kind: 'reflow', metadata, cover, sections, toc };
}
