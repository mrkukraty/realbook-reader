import { ImportError, type FormatAdapter, type ReflowDocument } from '../types';
import { decodeText, extOf, finalizeMeta, readBytes, wrapError } from '../util';
import { parseHtmlBody } from '../sanitize';
import { sectionsFromContainer } from '../htmlSections';

export async function openHtml(data: Blob, fileName: string): Promise<ReflowDocument> {
  const text = decodeText(await readBytes(data));
  if (!text.trim()) throw new ImportError('This HTML file is empty.', 'corrupt');
  const doc = new DOMParser().parseFromString(text, 'text/html');
  const root = parseHtmlBody(text);
  const { sections, toc } = sectionsFromContainer(root, { dropImages: true });
  const title = doc.title?.trim() || root.querySelector('h1')?.textContent?.trim();
  const metaOf = (n: string) => doc.querySelector(`meta[name="${n}" i]`)?.getAttribute('content') ?? undefined;
  return {
    kind: 'reflow',
    metadata: finalizeMeta({
      title, author: metaOf('author'), description: metaOf('description'),
      language: doc.documentElement.getAttribute('lang') ?? undefined,
    }, fileName),
    sections, toc, dispose() {},
  };
}

export const htmlAdapter: FormatAdapter = {
  id: 'html',
  label: 'HTML',
  extensions: ['html', 'htm', 'xhtml'],
  detect: (head, fileName) => ['html', 'htm', 'xhtml'].includes(extOf(fileName)) || /<(!doctype html|html)/i.test(String.fromCharCode(...head.subarray(0, 500))),
  async open(data, fileName) {
    try { return await openHtml(data, fileName); } catch (e) { throw wrapError(e, 'HTML'); }
  },
};
