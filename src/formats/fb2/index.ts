import { ImportError, type FormatAdapter, type ReflowDocument, type ReflowSection, type Target, type TocItem } from '../types';
import { ascii, escapeHtml, extOf, finalizeMeta, readBytes, wrapError } from '../util';
import { loadZip } from '../zip';
import { all, kid, kids, parseXml, stripTags, textOf } from '../xml';
import { sanitizeHtml } from '../sanitize';

function decodeXml(bytes: Uint8Array): string {
  let enc = 'utf-8';
  const m = /encoding\s*=\s*["']([\w-]+)["']/i.exec(ascii(bytes, 0, 200));
  if (m) enc = m[1];
  if (bytes[0] === 0xff && bytes[1] === 0xfe) enc = 'utf-16le';
  try { return new TextDecoder(enc).decode(bytes); } catch { return new TextDecoder('utf-8').decode(bytes); }
}

function hrefOf(el: Element): string {
  for (const a of Array.from(el.attributes)) if (a.localName === 'href') return a.value;
  return '';
}

export async function openFb2(data: Blob, fileName: string): Promise<ReflowDocument> {
  let bytes = await readBytes(data);
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    const zip = await loadZip(data, 'FB2 archive');
    const entry = Object.values(zip.files).find((f) => !f.dir && /\.fb2$/i.test(f.name));
    if (!entry) throw new ImportError('This ZIP does not contain an .fb2 file.', 'corrupt');
    bytes = await entry.async('uint8array');
  }
  const doc = parseXml(decodeXml(bytes), 'FB2');
  if (doc.documentElement.localName !== 'FictionBook') throw new ImportError('This file is not a valid FB2 book.', 'corrupt');

  const urls: string[] = [];
  const binaries = new Map<string, { type: string; b64: string }>();
  for (const b of kids(doc.documentElement, 'binary')) {
    const id = b.getAttribute('id');
    if (id) binaries.set(id, { type: b.getAttribute('content-type') ?? 'image/jpeg', b64: (b.textContent ?? '').replace(/\s+/g, '') });
  }
  const imgUrl = (ref: string): string | undefined => {
    const bin = binaries.get(ref.replace(/^#/, ''));
    if (!bin) return undefined;
    try {
      if (typeof URL.createObjectURL === 'function') {
        const raw = atob(bin.b64);
        const arr = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
        const u = URL.createObjectURL(new Blob([arr], { type: bin.type }));
        urls.push(u);
        return u;
      }
    } catch { return undefined; }
    return `data:${bin.type};base64,${bin.b64}`;
  };

  // metadata
  const desc = kid(doc.documentElement, 'description');
  const ti = kid(desc, 'title-info');
  const authors = kids(ti, 'author').map((a) => ['first-name', 'middle-name', 'last-name'].map((n) => textOf(kid(a, n))).filter(Boolean).join(' ')).filter(Boolean);
  const annotation = kid(ti, 'annotation');
  const metadata = finalizeMeta({
    title: textOf(kid(ti, 'book-title')),
    author: authors.join(', '),
    language: textOf(kid(ti, 'lang')),
    publisher: textOf(kid(kid(desc, 'publish-info'), 'publisher')),
    published: textOf(kid(ti, 'date')),
    description: annotation ? stripTags(annotation.textContent ?? '') : undefined,
  }, fileName);
  let cover: Blob | undefined;
  const coverRef = hrefOf(all(kid(ti, 'coverpage') ?? doc.documentElement, 'image')[0] ?? doc.createElement('x'));
  const coverBin = binaries.get(coverRef.replace(/^#/, ''));
  if (coverBin) {
    try {
      const raw = atob(coverBin.b64);
      const arr = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
      cover = new Blob([arr], { type: coverBin.type });
    } catch { /* ignore */ }
  }

  // body -> html
  const idSec = new Map<string, number>();
  let curSec = 0;
  const idAttr = (e: Element) => {
    const id = e.getAttribute('id');
    if (id) { idSec.set(id, curSec); return ` id="${escapeHtml(id)}"`; }
    return '';
  };
  const inline = (n: Node): string => {
    if (n.nodeType === 3) return escapeHtml(n.textContent ?? '');
    if (n.nodeType !== 1) return '';
    const e = n as Element;
    const inner = () => Array.from(e.childNodes).map(inline).join('');
    switch (e.localName) {
      case 'strong': return `<strong>${inner()}</strong>`;
      case 'emphasis': return `<em>${inner()}</em>`;
      case 'strikethrough': return `<s>${inner()}</s>`;
      case 'sub': return `<sub>${inner()}</sub>`;
      case 'sup': return `<sup>${inner()}</sup>`;
      case 'code': return `<code>${inner()}</code>`;
      case 'a': {
        const h = hrefOf(e);
        if (h.startsWith('#')) return `<a href="#fb2:${escapeHtml(h.slice(1))}">${inner()}</a>`;
        if (/^https?:|^mailto:/i.test(h)) return `<a href="${escapeHtml(h)}">${inner()}</a>`;
        return inner();
      }
      case 'image': {
        const u = imgUrl(hrefOf(e));
        return u ? `<img src="${u}" alt="">` : '';
      }
      default: return inner();
    }
  };
  const block = (e: Element, depth: number): string => {
    const inl = () => Array.from(e.childNodes).map(inline).join('');
    const kidsHtml = () => Array.from(e.children).map((c) => block(c, depth)).join('');
    switch (e.localName) {
      case 'p': return `<p${idAttr(e)}>${inl()}</p>`;
      case 'subtitle': return `<h4${idAttr(e)}>${inl()}</h4>`;
      case 'empty-line': return '<p>&nbsp;</p>';
      case 'image': { const u = imgUrl(hrefOf(e)); return u ? `<p><img src="${u}" alt=""></p>` : ''; }
      case 'title': return `<h${Math.min(depth + 1, 6)}${idAttr(e)}>${Array.from(e.children).map((c) => inline(c)).join(' ') || escapeHtml(textOf(e))}</h${Math.min(depth + 1, 6)}>`;
      case 'epigraph': case 'cite': return `<blockquote${idAttr(e)}>${kidsHtml()}</blockquote>`;
      case 'text-author': return `<p class="author"><em>${inl()}</em></p>`;
      case 'poem': return `<div class="poem"${idAttr(e)}>${kidsHtml()}</div>`;
      case 'stanza': return `<p>${Array.from(e.children).map((v) => inlineOf(v)).join('<br>')}</p>`;
      case 'v': return `<p>${inl()}</p>`;
      case 'table': return `<table>${Array.from(e.querySelectorAll('tr')).map((tr) => `<tr>${Array.from(tr.children).map((c) => `<${c.localName === 'th' ? 'th' : 'td'}>${Array.from(c.childNodes).map(inline).join('')}</${c.localName === 'th' ? 'th' : 'td'}>`).join('')}</tr>`).join('')}</table>`;
      default: return '';
    }
  };
  const inlineOf = (e: Element) => Array.from(e.childNodes).map(inline).join('');

  const sections: ReflowSection[] = [];
  const toc: TocItem[] = [];
  const secTitle = (s: Element) => textOf(kid(s, 'title'));
  const pushSection = (title: string | undefined, html: string, tocParent?: TocItem[]) => {
    const idx = sections.length;
    sections.push({ id: `s${idx}`, title: title || undefined, html });
    if (title && tocParent) tocParent.push({ title, target: { section: idx } as Target });
    return idx;
  };
  // Flatten nested <section>s: each top-level section = one chapter; nested sections are inlined with deeper headings.
  const renderSection = (s: Element, depth: number): string => {
    let h = '';
    for (const c of Array.from(s.children)) {
      if (c.localName === 'section') h += `<div${idAttr(c)}>${renderSection(c, depth + 1)}</div>`;
      else h += block(c, depth);
    }
    return h;
  };
  for (const body of kids(doc.documentElement, 'body')) {
    const isNotes = (body.getAttribute('name') ?? '') !== '';
    const secs = kids(body, 'section');
    const bodyTitle = textOf(kid(body, 'title'));
    if (!secs.length) {
      const html = Array.from(body.children).map((c) => block(c, 1)).join('');
      if (html) { curSec = sections.length; pushSection(bodyTitle, html, toc); }
      continue;
    }
    let notesParent: TocItem[] | undefined;
    if (isNotes) {
      const n: TocItem = { title: bodyTitle || 'Notes', target: { section: sections.length }, children: [] };
      toc.push(n);
      notesParent = n.children;
    }
    for (const s of secs) {
      curSec = sections.length;
      const title = secTitle(s) || undefined;
      const html = idAttr(s) ? `<a${idAttr(s)}></a>${renderSection(s, 1)}` : renderSection(s, 1);
      const idx = pushSection(title, html, notesParent ?? toc);
      // nested chapters (e.g. parts) appear as TOC children
      const subs = kids(s, 'section').map((c) => ({ c, t: secTitle(c) })).filter((x) => x.t);
      if (subs.length && !notesParent) {
        const parent = toc[toc.length - 1];
        if (parent && (parent.target as { section: number }).section === idx) {
          parent.children = subs.map((x) => ({ title: x.t, target: { section: idx, anchor: x.c.getAttribute('id') ?? undefined } as Target }));
          for (const x of subs) { const id = x.c.getAttribute('id'); if (id) idSec.set(id, idx); }
        }
      }
    }
  }
  if (sections.length === 0) throw new ImportError('This FB2 file contains no readable text.', 'corrupt');

  for (const s of sections) {
    s.html = s.html.replace(/<a href="#fb2:([^"]*)">/g, (_m, raw: string) => {
      const id = raw.replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
      const sec = idSec.get(id);
      return sec === undefined ? '<a>' : `<a href="#" data-sec="${sec}" data-anchor="${escapeHtml(id)}">`;
    });
    s.html = sanitizeHtml(s.html);
  }

  return {
    kind: 'reflow', metadata, cover, sections, toc,
    dispose() { for (const u of urls.splice(0)) URL.revokeObjectURL(u); },
  };
}

export const fb2Adapter: FormatAdapter = {
  id: 'fb2',
  label: 'FictionBook (FB2)',
  extensions: ['fb2', 'fb2.zip'],
  detect: (head, fileName) => ['fb2', 'fb2.zip'].includes(extOf(fileName)) || /<FictionBook/i.test(ascii(head, 0, 2000)),
  async open(data, fileName) {
    try { return await openFb2(data, fileName); } catch (e) { throw wrapError(e, 'FB2'); }
  },
};
