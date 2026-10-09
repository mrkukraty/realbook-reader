// Minimal DOCX reader: paragraphs, headings (Heading1-3 / Title), bold/italic runs, line breaks, simple lists.
// No tables/images/footnotes (documented limitation). Uses jszip + htmlparser2 only.
import type { Element } from 'domhandler';
import { ImportError, type ReflowDocument } from './types';
import { escapeHtml, finalizeMeta, wrapError } from './util';
import { loadZip, findEntry, zipText } from './zip';
import { attr, childEls, findAll, parseXmlDoc, textOf } from './markup';
import { demoteTocLikeHeadings, groupBlocks, headingBlock, type Block } from './blocks';

const isOn = (rpr: Element | undefined, name: string) => {
  const e = childEls(rpr, name)[0];
  if (!e) return false;
  const v = attr(e, 'val');
  return v !== '0' && v !== 'false';
};

export async function openDocx(data: Uint8Array, fileName: string): Promise<ReflowDocument> {
  try {
    const zip = await loadZip(data, 'DOCX');
    if (findEntry(zip, 'EncryptedPackage')) throw new ImportError('This Word document is password-protected.', 'drm');
    const docXml = await zipText(zip, 'word/document.xml');
    if (!docXml) throw new ImportError('This file is not a valid Word document (word/document.xml is missing).', 'corrupt');
    const doc = parseXmlDoc(docXml);
    const blocks: Block[] = [];
    for (const p of findAll(doc, 'p')) {
      const ppr = childEls(p, 'pPr')[0];
      const style = attr(childEls(ppr, 'pStyle')[0] ?? ({ attribs: {} } as Element), 'val') ?? '';
      const isList = !!childEls(ppr, 'numPr')[0];
      let html = '';
      let plain = '';
      for (const r of childEls(p, 'r')) {
        const rpr = childEls(r, 'rPr')[0];
        let t = '';
        for (const c of childEls(r)) {
          const nm = c.name.replace(/^.*:/, '');
          if (nm === 't') t += textOf(c);
          else if (nm === 'tab') t += '\t';
          else if (nm === 'br') t += '\n';
        }
        if (!t) continue;
        plain += t;
        let h = escapeHtml(t).replace(/\n/g, '<br>');
        if (isOn(rpr, 'b')) h = `<strong>${h}</strong>`;
        if (isOn(rpr, 'i')) h = `<em>${h}</em>`;
        html += h;
      }
      const text = plain.trim();
      if (!text) continue;
      if (/^(Title|Heading ?[12])$/i.test(style)) blocks.push(headingBlock(text));
      else if (/^Heading ?[3-6]$/i.test(style)) blocks.push({ html: `<h4>${html}</h4>`, chars: text.length });
      else if (isList) blocks.push({ html: `<p>• ${html}</p>`, chars: text.length });
      else blocks.push({ html: `<p>${html}</p>`, chars: text.length });
    }
    if (!blocks.length) throw new ImportError('This Word document contains no readable text.', 'corrupt');
    demoteTocLikeHeadings(blocks, 60);
    const { sections, toc } = groupBlocks(blocks);
    const core = await zipText(zip, 'docProps/core.xml');
    const cd = core ? parseXmlDoc(core) : undefined;
    const g = (n: string) => (cd ? textOf(findAll(cd, n)[0]) : '');
    return { kind: 'reflow', metadata: finalizeMeta({ title: g('title') || undefined, author: g('creator'), language: g('language'), description: g('description') }, fileName), sections, toc };
  } catch (e) {
    throw wrapError(e, 'DOCX');
  }
}
