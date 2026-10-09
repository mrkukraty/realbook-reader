import type { Element } from 'domhandler';
import { isTag, isText } from 'domhandler';
import { ImportError, type ReflowDocument, type ReflowSection, type Target, type TocItem } from './types';
import { ascii, decodeText, escapeHtml, finalizeMeta, fromBase64, wrapError } from './util';
import { loadZip } from './zip';
import { attr, childEls, findAll, parseXmlDoc, stripTags, textOf } from './markup';
import { sanitizeHtmlString } from './markup';

const lname = (e: Element) => e.name.replace(/^.*:/, '');

function hrefOf(e: Element): string {
  for (const k of Object.keys(e.attribs)) if (k === 'href' || k.endsWith(':href')) return e.attribs[k];
  return '';
}

export async function openFb2(data: Uint8Array, fileName: string): Promise<ReflowDocument> {
  try {
    return await openFb2Inner(data, fileName);
  } catch (e) {
    throw wrapError(e, 'FB2');
  }
}

async function openFb2Inner(data: Uint8Array, fileName: string): Promise<ReflowDocument> {
  let bytes = data;
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    const zip = await loadZip(bytes, 'FB2 archive');
    const entry = Object.values(zip.files).find((f) => !f.dir && /\.fb2$/i.test(f.name));
    if (!entry) throw new ImportError('This ZIP does not contain an .fb2 file.', 'corrupt');
    bytes = await entry.async('uint8array');
  }
  void ascii;
  const doc = parseXmlDoc(decodeText(bytes));
  const root = childEls(doc, 'FictionBook')[0] ?? childEls(doc).find((e) => lname(e) === 'FictionBook');
  if (!root) throw new ImportError('This file is not a valid FB2 book.', 'corrupt');

  const binaries = new Map<string, { type: string; b64: string }>();
  for (const b of childEls(root, 'binary')) {
    const id = attr(b, 'id');
    if (id) binaries.set(id, { type: attr(b, 'content-type') ?? 'image/jpeg', b64: textOf(b).replace(/\s+/g, '') });
  }
  const imgUrl = (ref: string): string | undefined => {
    const bin = binaries.get(ref.replace(/^#/, ''));
    return bin ? `data:${bin.type};base64,${bin.b64}` : undefined;
  };

  const desc = childEls(root, 'description')[0];
  const ti = childEls(desc, 'title-info')[0];
  const authors = childEls(ti, 'author')
    .map((a) => ['first-name', 'middle-name', 'last-name'].map((n) => textOf(childEls(a, n)[0])).filter(Boolean).join(' '))
    .filter(Boolean);
  const annotation = childEls(ti, 'annotation')[0];
  const metadata = finalizeMeta({
    title: textOf(childEls(ti, 'book-title')[0]),
    author: authors.join(', '),
    language: textOf(childEls(ti, 'lang')[0]),
    publisher: textOf(childEls(childEls(desc, 'publish-info')[0], 'publisher')[0]),
    published: textOf(childEls(ti, 'date')[0]),
    description: annotation ? stripTags(textOf(annotation)) : undefined,
  }, fileName);

  let cover: ReflowDocument['cover'];
  const coverEl = childEls(ti, 'coverpage')[0];
  const coverRef = coverEl ? hrefOf(findAll(coverEl, 'image')[0] ?? ({ attribs: {} } as Element)) : '';
  const cb = binaries.get(coverRef.replace(/^#/, ''));
  if (cb) cover = { bytes: fromBase64(cb.b64), mime: cb.type };

  const idSec = new Map<string, number>();
  let curSec = 0;
  const idAttr = (e: Element) => {
    const id = attr(e, 'id');
    if (id) { idSec.set(id, curSec); return ` id="${escapeHtml(id)}"`; }
    return '';
  };
  const inline = (n: import('domhandler').ChildNode): string => {
    if (isText(n)) return escapeHtml(n.data);
    if (!isTag(n)) return '';
    const inner = () => n.children.map(inline).join('');
    switch (lname(n)) {
      case 'strong': return `<strong>${inner()}</strong>`;
      case 'emphasis': return `<em>${inner()}</em>`;
      case 'strikethrough': return `<s>${inner()}</s>`;
      case 'sub': return `<sub>${inner()}</sub>`;
      case 'sup': return `<sup>${inner()}</sup>`;
      case 'code': return `<code>${inner()}</code>`;
      case 'a': {
        const h = hrefOf(n);
        if (h.startsWith('#')) return `<a href="#fb2:${escapeHtml(h.slice(1))}">${inner()}</a>`;
        if (/^https?:|^mailto:/i.test(h)) return `<a href="${escapeHtml(h)}">${inner()}</a>`;
        return inner();
      }
      case 'image': { const u = imgUrl(hrefOf(n)); return u ? `<img src="${u}" alt="">` : ''; }
      default: return inner();
    }
  };
  const inlineOf = (e: Element) => e.children.map(inline).join('');
  const block = (e: Element, depth: number): string => {
    const kidsHtml = () => childEls(e).map((c) => block(c, depth)).join('');
    switch (lname(e)) {
      case 'p': return `<p${idAttr(e)}>${inlineOf(e)}</p>`;
      case 'subtitle': return `<h4${idAttr(e)}>${inlineOf(e)}</h4>`;
      case 'empty-line': return '<p>&nbsp;</p>';
      case 'image': { const u = imgUrl(hrefOf(e)); return u ? `<p><img src="${u}" alt=""></p>` : ''; }
      case 'title': { const l = Math.min(depth + 1, 6); return `<h${l}${idAttr(e)}>${childEls(e).map((c) => inlineOf(c)).join(' ') || escapeHtml(textOf(e))}</h${l}>`; }
      case 'epigraph': case 'cite': return `<blockquote${idAttr(e)}>${kidsHtml()}</blockquote>`;
      case 'text-author': return `<p class="author"><em>${inlineOf(e)}</em></p>`;
      case 'poem': return `<div class="poem"${idAttr(e)}>${kidsHtml()}</div>`;
      case 'stanza': return `<p>${childEls(e).map((v) => inlineOf(v)).join('<br>')}</p>`;
      case 'v': return `<p>${inlineOf(e)}</p>`;
      case 'table': return `<table>${findAll(e, 'tr').map((tr) => `<tr>${childEls(tr).map((c) => { const t = lname(c) === 'th' ? 'th' : 'td'; return `<${t}>${inlineOf(c)}</${t}>`; }).join('')}</tr>`).join('')}</table>`;
      default: return '';
    }
  };

  const sections: ReflowSection[] = [];
  const toc: TocItem[] = [];
  const secTitle = (s: Element) => textOf(childEls(s, 'title')[0]);
  const pushSection = (title: string | undefined, html: string, parent?: TocItem[]) => {
    const idx = sections.length;
    sections.push({ id: `s${idx}`, title: title || undefined, html });
    if (title && parent) parent.push({ title, target: { section: idx } as Target });
    return idx;
  };
  const renderSection = (s: Element, depth: number): string => {
    let h = '';
    for (const c of childEls(s)) {
      if (lname(c) === 'section') h += `<div${idAttr(c)}>${renderSection(c, depth + 1)}</div>`;
      else h += block(c, depth);
    }
    return h;
  };
  for (const body of childEls(root, 'body')) {
    const isNotes = (attr(body, 'name') ?? '') !== '';
    const secs = childEls(body, 'section');
    const bodyTitle = textOf(childEls(body, 'title')[0]);
    if (!secs.length) {
      const html = childEls(body).map((c) => block(c, 1)).join('');
      if (html) { curSec = sections.length; pushSection(bodyTitle, html, toc); }
      continue;
    }
    let notesParent: TocItem[] | undefined;
    if (isNotes) {
      const nItem: TocItem = { title: bodyTitle || 'Notes', target: { section: sections.length }, children: [] };
      toc.push(nItem);
      notesParent = nItem.children;
    }
    for (const s of secs) {
      curSec = sections.length;
      const title = secTitle(s) || undefined;
      const html = idAttr(s) ? `<a${idAttr(s)}></a>${renderSection(s, 1)}` : renderSection(s, 1);
      const idx = pushSection(title, html, notesParent ?? toc);
      const subs = childEls(s, 'section').map((c) => ({ c, t: secTitle(c) })).filter((x) => x.t);
      if (subs.length && !notesParent) {
        const parent = toc[toc.length - 1];
        if (parent && (parent.target as { section: number }).section === idx) {
          parent.children = subs.map((x) => ({ title: x.t, target: { section: idx, anchor: attr(x.c, 'id') } as Target }));
          for (const x of subs) { const id = attr(x.c, 'id'); if (id) idSec.set(id, idx); }
        }
      }
    }
  }
  if (sections.length === 0) throw new ImportError('This FB2 file contains no readable text.', 'corrupt');

  const unesc = (s: string) => s.replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  for (const s of sections) {
    s.html = s.html.replace(/<a href="#fb2:([^"]*)">/g, (_m, raw: string) => {
      const id = unesc(raw);
      const sec = idSec.get(id);
      return sec === undefined ? '<a>' : `<a href="#" data-sec="${sec}" data-anchor="${escapeHtml(id)}">`;
    });
    // run through the allow-list sanitizer; data-sec links are preserved via custom link rewrite
    s.html = sanitizeHtmlString(s.html, {
      imageSrc: (src) => (src.startsWith('data:image/') ? src : null),
      link: (href) => ({ kind: 'external', url: href }),
    });
  }
  return { kind: 'reflow', metadata, cover, sections, toc };
}
