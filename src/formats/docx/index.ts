import mammoth from 'mammoth/mammoth.browser';
import { ImportError, type FormatAdapter, type ReflowDocument } from '../types';
import { extOf, finalizeMeta, readBytes, wrapError } from '../util';
import { loadZip, zipText } from '../zip';
import { tryParseXml, all, textOf } from '../xml';
import { parseHtmlBody } from '../sanitize';
import { sectionsFromContainer } from '../htmlSections';

export async function openDocx(data: Blob, fileName: string): Promise<ReflowDocument> {
  const zip = await loadZip(data, 'DOCX');
  if (!zip.file('word/document.xml')) throw new ImportError('This file is not a valid Word document (word/document.xml is missing).', 'corrupt');
  if (zip.file('EncryptedPackage')) throw new ImportError('This Word document is password-protected.', 'drm');

  const buf = await readBytes(data);
  const result = await mammoth.convertToHtml(
    { arrayBuffer: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer },
    {
      convertImage: mammoth.images.imgElement(async (image) => ({
        src: `data:${image.contentType};base64,${await image.read('base64')}`,
      })),
    },
  );

  const meta: Record<string, string> = {};
  const core = await zipText(zip, 'docProps/core.xml');
  const cd = core ? tryParseXml(core) : null;
  if (cd) {
    const g = (n: string) => textOf(all(cd, n)[0]);
    meta.title = g('title'); meta.author = g('creator'); meta.language = g('language');
    meta.description = g('description'); meta.published = g('created').slice(0, 10);
  }
  const root = parseHtmlBody(result.value);
  const { sections, toc } = sectionsFromContainer(root);
  const first = root.ownerDocument.body;
  void first;
  return {
    kind: 'reflow',
    metadata: finalizeMeta({
      title: meta.title || undefined, author: meta.author, language: meta.language,
      description: meta.description, published: meta.published,
    }, fileName),
    sections, toc, dispose() {},
  };
}

export const docxAdapter: FormatAdapter = {
  id: 'docx',
  label: 'Word (DOCX)',
  extensions: ['docx'],
  detect: (head, fileName) => extOf(fileName) === 'docx' && head[0] === 0x50,
  async open(data, fileName) {
    try { return await openDocx(data, fileName); } catch (e) { throw wrapError(e, 'DOCX'); }
  },
};
