// Generates test fixtures into ./fixtures. Run: node scripts/make-fixtures.mjs
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { PDFDocument, StandardFonts, rgb, PDFName, PDFString, PDFHexString } from 'pdf-lib';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'fixtures');
fs.mkdirSync(out, { recursive: true });
const W = (name, data) => fs.writeFileSync(path.join(out, name), data);

// ---------- prose ----------
const CHAPTERS = [
  ['The Lighthouse Keeper', [
    'The lighthouse at Marrow Point had stood for ninety years, and in all that time it had never once failed to burn. Old Tobias Wren, who tended it, said that a light was a promise, and a promise was not a thing to be broken because one happened to be tired.',
    'Every evening he climbed the one hundred and twelve steps with a can of oil in each hand, counting them under his breath as his father had taught him. At the top the lamp waited, patient and enormous, a great cut-glass eye that looked out over the grey water.',
    'On the night this story begins the wind came from the north-east, and it brought with it a thin cold rain that rattled on the gallery like handfuls of thrown gravel. Tobias trimmed the wick, wound the clockwork, and settled to his watch.',
    'Far below, the sea heaved itself against the rocks and fell back again, over and over, with the slow patience of something that has all the time in the world.']],
  ['A Stranger on the Shore', [
    'It was past midnight when Tobias saw the figure on the shingle. At first he took it for a trick of the rain, a bundle of weed or a fallen spar, but the shape moved, and lifted one arm, and he understood that someone was alive down there.',
    'He went down faster than he had gone in twenty years, a lantern swinging in his fist and the cold biting at his lungs. The stranger was a young woman wrapped in a sodden coat, and she was shivering so hard that she could not speak.',
    'He carried her to the cottage at the foot of the tower and set her by the stove. When at last she could talk, she told him that her name was Imogen Hale, that her small boat had been driven onto the rocks, and that she had been rowing toward the light for three hours.',
    '"I never took my eyes from it," she said. "Whenever I lost hope I looked up, and there it was."',
    'Tobias said nothing, but he stood a little straighter, and went back up the stairs to his lamp with something warm lodged in his chest.']],
  ['What the Tide Brought', [
    'By morning the storm had blown itself out, and the sea lay flat and silver under a washed sky. Imogen walked the beach with a borrowed pair of boots, gathering what the tide had delivered: planks, rope, a single oar, and a brass-bound chest that was far too heavy to lift.',
    'Together they dragged it above the high-water line. The lock had rusted through, and a few blows with a hammer broke it open. Inside, wrapped in oilcloth, lay a bundle of letters tied with blue ribbon and a small, battered compass.',
    'The letters were addressed to a ship\'s captain named Edmund Hale. Imogen read the first one in silence, and then she sat down on the chest and wept, for Edmund Hale had been her grandfather, lost at sea long before she was born.',
    'The compass still worked. Its needle swung, steadied, and pointed unwaveringly at the lighthouse.']],
  ['Letters in Blue Ribbon', [
    'They read the letters over the course of a week, one each evening, by the light of the kitchen lamp. They were written to a wife who waited ashore, and they were full of small things: a gull that had followed the ship for a hundred miles, a cook who sang badly, the strange green colour of the water near the equator.',
    'In the last letter the captain wrote of a storm that was gathering, and of a light he hoped to see before dawn. "If I do not come home," he wrote, "tell the child that I looked for the lighthouse until the very end."',
    'Tobias set down the page and looked at the window, where the great beam was beginning to sweep across the dusk. He had never known who the light was for. He had thought, in his plainer moments, that it was for no one in particular.',
    'Now he understood that it had always been for someone: for every sailor who looked up in the dark and found it there.']],
  ['The Long Way Home', [
    'When the supply boat came on Friday, Imogen went back with it to the mainland, carrying the letters and the compass in her coat. She left behind her address, written in a careful hand, and a promise to return in the spring.',
    'The winter was long, and the nights were longer, and Tobias kept his light burning through gales and fogs and the black stillness of frost. He found that he no longer climbed the stairs alone; he climbed them with the thought of all the unseen faces turned toward the glow.',
    'In April, as the first crocuses opened in the lee of the cottage wall, a small boat appeared on the horizon. It was a sturdy craft with a red sail, and in the bow stood Imogen, waving both arms above her head.',
    'He waved back. It seemed to him then that the light had finished one long errand and begun another.']],
  ['Marrow Point at Dusk', [
    'Imogen stayed that summer, and the summer after. She learned to trim the wick and wind the clockwork, and to read the weather in the colour of the evening sky. She had a gift for it, Tobias said, the same gift her grandfather must have had.',
    'In time the Trinity House inspectors came, in their polished boots and serious hats, and were surprised to find two keepers where there had been one. They inspected the brass and the glass and the logbook, and pronounced everything in excellent order.',
    'On the evening they left, Tobias and Imogen climbed the tower together and watched the lamp kindle. The beam swept out across the water, steady and unhurried, and far off a ship\'s lantern answered it.',
    '"A promise," said Tobias quietly, "is not a thing to be broken."',
    'And the light burned on.']],
];
const LINK_PHRASE = 'See also the letters in Chapter Four.';

// ---------- PNG ----------
function crc32(buf) { let c, crc = ~0; for (let n = 0; n < buf.length; n++) { c = (crc ^ buf[n]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; } return ~crc >>> 0; }
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
const GLYPHS = { 0: '111101101101111', 1: '010110010010111', 2: '111001111100111', 3: '111001111001111', 4: '101101111001001', 5: '111100111001111', 6: '111100111101111', 7: '111001001001001', 8: '111101111101111', 9: '111101111001111' };
function png(w, h, hue, label) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  const digits = String(label ?? '');
  const scale = Math.floor(h / 14);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      let r = (hue + (x * 90) / w) % 256, g = (hue * 2 + (y * 120) / h) % 256, b = 200 - (x + y) * 60 / (w + h);
      const gx = Math.floor((x - Math.floor(w / 2 - (digits.length * 4 * scale) / 2)) / scale);
      const gy = Math.floor((y - Math.floor(h / 2 - (7 * scale) / 2)) / scale);
      if (digits && gy >= 0 && gy < 5 && gx >= 0 && gx < digits.length * 4 && gx % 4 !== 3) {
        if (GLYPHS[digits[Math.floor(gx / 4)]]?.[gy * 3 + (gx % 4)] === '1') { r = g = b = 255; }
      }
      const o = y * (w * 3 + 1) + 1 + x * 3;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = Math.max(0, b);
    }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// ---------- EPUB ----------
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
async function makeEpub(file, v3) {
  const z = new JSZip();
  z.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  z.file('META-INF/container.xml', '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>');
  z.file('OEBPS/images/cover.png', png(300, 450, 40, '1'));
  z.file('OEBPS/images/lamp.png', png(240, 160, 120, '7'));
  z.file('OEBPS/images/lamp.svg', '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><rect width="120" height="80" fill="#468"/><circle cx="60" cy="40" r="20" fill="#fd5"/></svg>');
  z.file('OEBPS/style.css', 'body{font-family:serif;color:red} p{margin:0}');
  const items = [], spine = [];
  CHAPTERS.forEach(([title, paras], i) => {
    const n = i + 1;
    const body = paras.map((p, j) => `<p${j === 0 ? ` id="p${n}-start"` : ''}>${esc(p)}</p>`).join('\n');
    const extra = n === 1
      ? `<p><img src="images/lamp.png" alt="A lamp"/></p><svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="120" height="80" viewBox="0 0 120 80"><image xlink:href="images/lamp.svg" width="120" height="80"/></svg><p>Continue to <a href="ch2.xhtml">the next chapter</a>, or jump to <a href="ch4.xhtml#p4-start">${LINK_PHRASE}</a></p><p><a href="#p1-start">Back to start</a> <a href="http://example.com/x">external</a></p><script>alert(1)</script>`
      : n === 4 ? '<p>Return to <a href="ch1.xhtml#p1-start">chapter one</a>.</p>' : '';
    z.file(`OEBPS/ch${n}.xhtml`, `<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>${esc(title)}</title><link rel="stylesheet" href="style.css"/></head><body><h1 id="h${n}">${esc(title)}</h1>\n${body}\n${extra}</body></html>`);
    items.push(`<item id="ch${n}" href="ch${n}.xhtml" media-type="application/xhtml+xml"/>`);
    spine.push(`<itemref idref="ch${n}"/>`);
  });
  const tocEntries = CHAPTERS.map(([t], i) => [`ch${i + 1}.xhtml`, t]);
  let nav = '';
  if (v3) {
    z.file('OEBPS/nav.xhtml', `<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Contents</title></head><body><nav epub:type="toc"><ol>${tocEntries.map(([h, t], i) => `<li><a href="${h}">${esc(t)}</a>${i === 0 ? `<ol><li><a href="ch1.xhtml#p1-start">Opening</a></li></ol>` : ''}</li>`).join('')}</ol></nav></body></html>`);
    nav = '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="cover" href="images/cover.png" media-type="image/png" properties="cover-image"/>';
  } else {
    z.file('OEBPS/toc.ncx', `<?xml version="1.0" encoding="utf-8"?><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><head/><docTitle><text>The Lighthouse at Marrow Point</text></docTitle><navMap>${tocEntries.map(([h, t], i) => `<navPoint id="n${i}" playOrder="${i + 1}"><navLabel><text>${esc(t)}</text></navLabel><content src="${h}"/></navPoint>`).join('')}</navMap></ncx>`);
    nav = '<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/><item id="cover-img" href="images/cover.png" media-type="image/png"/>';
  }
  z.file('OEBPS/content.opf', `<?xml version="1.0" encoding="utf-8"?><package xmlns="http://www.idpf.org/2007/opf" version="${v3 ? '3.0' : '2.0'}" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf"><dc:identifier id="id">urn:uuid:12345</dc:identifier><dc:title>The Lighthouse at Marrow Point${v3 ? '' : ' (EPUB2)'}</dc:title><dc:creator>A. N. Author</dc:creator><dc:language>en</dc:language><dc:publisher>Fixture Press</dc:publisher><dc:date>1901-05-01</dc:date><dc:description>A short tale of a light and a promise.</dc:description>${v3 ? '' : '<meta name="cover" content="cover-img"/>'}</metadata><manifest>${nav}<item id="css" href="style.css" media-type="text/css"/><item id="img1" href="images/lamp.png" media-type="image/png"/><item id="img2" href="images/lamp.svg" media-type="image/svg+xml"/>${items.join('')}</manifest><spine${v3 ? '' : ' toc="ncx"'}>${spine.join('')}</spine></package>`);
  W(file, await z.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
}

// ---------- plain text ----------
function wrap(s, n = 72) { const words = s.split(' '); const lines = []; let l = ''; for (const w of words) { if ((l + ' ' + w).trim().length > n) { lines.push(l); l = w; } else l = (l + ' ' + w).trim(); } if (l) lines.push(l); return lines.join('\n'); }
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
function gutenberg() {
  let t = 'The Project Gutenberg eBook of The Lighthouse at Marrow Point\n\nTitle: The Lighthouse at Marrow Point\n\nAuthor: A. N. Author\n\nRelease date: May 1, 1901 [eBook #99999]\n\nLanguage: English\n\n*** START OF THE PROJECT GUTENBERG EBOOK THE LIGHTHOUSE AT MARROW POINT ***\n\n\n\n';
  t += 'CONTENTS\n\nCHAPTER I. The Lighthouse Keeper\nCHAPTER II. A Stranger on the Shore\n\n\n\n';
  CHAPTERS.forEach(([title, paras], i) => { t += `CHAPTER ${ROMAN[i]}.\n${title}\n\n` + paras.map((p) => wrap(p)).join('\n\n') + '\n\n\n'; });
  t += '*** END OF THE PROJECT GUTENBERG EBOOK THE LIGHTHOUSE AT MARROW POINT ***\n\nLicense text that must be removed.\n';
  return t;
}

// ---------- PDF ----------
function wrapLines(font, text, size, maxW) { const words = text.split(' '); const lines = []; let l = ''; for (const w of words) { const t = l ? l + ' ' + w : w; if (font.widthOfTextAtSize(t, size) > maxW) { lines.push(l); l = w; } else l = t; } if (l) lines.push(l); return lines; }
async function makeSamplePdf() {
  const pdf = await PDFDocument.create();
  pdf.setTitle('Sample PDF Book'); pdf.setAuthor('A. N. Author'); pdf.setSubject('Fixture');
  const font = await pdf.embedFont(StandardFonts.TimesRoman);
  const bold = await pdf.embedFont(StandardFonts.TimesRomanBold);
  const paras = CHAPTERS.flatMap(([, p]) => p);
  const pages = [];
  for (let i = 0; i < 24; i++) {
    const page = pdf.addPage([420, 595]); pages.push(page);
    page.drawText(`Page ${i + 1} - ${CHAPTERS[i % 6][0]}`, { x: 40, y: 545, size: 16, font: bold });
    let y = 515;
    for (let k = 0; k < 4; k++) {
      for (const line of wrapLines(font, paras[(i * 3 + k) % paras.length], 11, 340)) { page.drawText(line, { x: 40, y, size: 11, font }); y -= 15; }
      y -= 8;
    }
  }
  const ctx = pdf.context;
  const addLink = (page, rect, action) => {
    const ref = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Link', Rect: rect, Border: [0, 0, 0], ...action }));
    const existing = page.node.get(PDFName.of('Annots'));
    if (existing) existing.push(ref); else page.node.set(PDFName.of('Annots'), ctx.obj([ref]));
  };
  pages[0].drawText('Visit https://example.com/book', { x: 40, y: 40, size: 11, font });
  addLink(pages[0], [40, 36, 220, 54], { A: ctx.obj({ Type: 'Action', S: 'URI', URI: PDFString.of('https://example.com/book') }) });
  pages[0].drawText('Go to page 10', { x: 240, y: 40, size: 11, font });
  addLink(pages[0], [240, 36, 320, 54], { Dest: ctx.obj([pages[9].ref, PDFName.of('Fit')]) });
  addLink(pages[1], [40, 36, 220, 54], { A: ctx.obj({ Type: 'Action', S: 'URI', URI: PDFString.of('https://example.org/') }) });
  // outline
  const outlines = ctx.nextRef();
  const marks = [[0, 'Chapter 1'], [4, 'Chapter 2'], [9, 'Chapter 3'], [14, 'Chapter 4'], [19, 'Chapter 5']];
  const refs = marks.map(() => ctx.nextRef());
  marks.forEach(([pg, title], i) => {
    const d = { Title: PDFHexString.fromText(title), Parent: outlines, Dest: [pages[pg].ref, PDFName.of('Fit')] };
    if (i > 0) d.Prev = refs[i - 1];
    if (i < marks.length - 1) d.Next = refs[i + 1];
    ctx.assign(refs[i], ctx.obj(d));
  });
  ctx.assign(outlines, ctx.obj({ Type: 'Outlines', First: refs[0], Last: refs[refs.length - 1], Count: marks.length }));
  pdf.catalog.set(PDFName.of('Outlines'), outlines);
  W('sample.pdf', await pdf.save());
}
async function makeScanned() {
  const pdf = await PDFDocument.create();
  for (let i = 0; i < 4; i++) {
    const img = await pdf.embedPng(png(400, 560, 30 + i * 50, String(i + 1)));
    const page = pdf.addPage([400, 560]);
    page.drawImage(img, { x: 0, y: 0, width: 400, height: 560 });
  }
  W('scanned.pdf', await pdf.save());
}

// ---------- other text formats ----------
function makeMd() {
  let t = '---\ntitle: The Lighthouse (Markdown)\nauthor: A. N. Author\n---\n\n';
  CHAPTERS.forEach(([title, paras], i) => {
    t += `# ${title}\n\n` + paras.join('\n\n') + '\n\n';
    if (i === 0) t += '## A quiet beginning\n\nSome *emphasis*, **strong** text, and a [link to the end](#marrow-point-at-dusk).\n\n- one\n- two\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n<script>alert(1)</script>\n\n';
  });
  W('sample.md', t);
}
function makeHtml() {
  let t = '<!doctype html><html><head><meta charset="utf-8"><title>The Lighthouse (HTML)</title><style>@import url(x.css);body{color:red}</style><script>alert(1)</script></head><body onload="alert(2)">';
  CHAPTERS.forEach(([title, paras], i) => { t += `<h1 id="c${i}">${esc(title)}</h1>` + paras.map((p) => `<p>${esc(p)}</p>`).join('') + (i === 0 ? '<p><a href="#c3">to chapter four</a> <a href="javascript:alert(1)">bad</a> <img src="x" onerror="alert(3)"></p>' : ''); });
  W('sample.html', t + '</body></html>');
}
function makeFb2() {
  const cover = png(200, 300, 90, '2').toString('base64');
  let b = '';
  CHAPTERS.forEach(([title, paras], i) => { b += `<section id="ch${i}"><title><p>${esc(title)}</p></title>${paras.map((p) => `<p>${esc(p)}</p>`).join('')}${i === 0 ? '<p>Note<a l:href="#n1" type="note">[1]</a>.</p><image l:href="#pic"/>' : ''}</section>`; });
  W('sample.fb2', `<?xml version="1.0" encoding="utf-8"?><FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0" xmlns:l="http://www.w3.org/1999/xlink"><description><title-info><genre>prose</genre><author><first-name>A. N.</first-name><last-name>Author</last-name></author><book-title>The Lighthouse (FB2)</book-title><annotation><p>A short tale.</p></annotation><date>1901</date><lang>en</lang><coverpage><image l:href="#cover.png"/></coverpage></title-info><publish-info><publisher>Fixture Press</publisher></publish-info></description><body>${b}</body><body name="notes"><section id="n1"><title><p>1</p></title><p>A footnote text.</p></section></body><binary id="cover.png" content-type="image/png">${cover}</binary><binary id="pic" content-type="image/png">${png(100, 60, 10, '3').toString('base64')}</binary></FictionBook>`);
}
async function makeDocx() {
  const z = new JSZip();
  z.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>');
  z.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>');
  z.file('word/_rels/document.xml.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>');
  z.file('word/styles.xml', '<?xml version="1.0" encoding="UTF-8"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style><w:style w:type="paragraph" w:styleId="Normal" w:default="1"><w:name w:val="Normal"/></w:style></w:styles>');
  z.file('docProps/core.xml', '<?xml version="1.0" encoding="UTF-8"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/"><dc:title>The Lighthouse (DOCX)</dc:title><dc:creator>A. N. Author</dc:creator><dc:language>en</dc:language><dc:description>Docx fixture</dc:description><dcterms:created>2020-01-02T00:00:00Z</dcterms:created></cp:coreProperties>');
  const body = CHAPTERS.map(([t, ps]) => `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>${esc(t)}</w:t></w:r></w:p>` + ps.map((p) => `<w:p><w:r><w:t xml:space="preserve">${esc(p)}</w:t></w:r></w:p>`).join('')).join('');
  z.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`);
  W('sample.docx', await z.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
}
function makeRtf() {
  const r = (s) => s.replace(/[\\{}]/g, '\\$&').replace(/[^\x00-\x7f]/g, (c) => `\\u${c.charCodeAt(0)}?`);
  let t = '{\\rtf1\\ansi\\ansicpg1252\\deff0{\\fonttbl{\\f0 Times New Roman;}}{\\colortbl;\\red0\\green0\\blue0;}{\\info{\\title The Lighthouse (RTF)}{\\author A. N. Author}}\\pard\\f0\\fs24\n';
  CHAPTERS.forEach(([title, paras], i) => { t += `\\pard\\b\\fs36 CHAPTER ${ROMAN[i]}. ${r(title)}\\b0\\fs24\\par\n` + paras.map((p) => `\\pard ${r(p)} \\i caf\\'e9\\i0  \\u8212? end\\par\n`).join(''); });
  W('sample.rtf', t + '}');
}
async function makeCbz() {
  const z = new JSZip();
  const order = [1, 2, 3, 10, 9, 8, 7, 6, 5, 4];
  for (const n of order) z.file(`pages/page${n}.png`, png(200, 300, n * 20, String(n)));
  z.file('__MACOSX/pages/._page1.png', 'junk');
  z.file('ComicInfo.xml', '<ComicInfo><Title>Test Comic</Title><Writer>A. N. Author</Writer></ComicInfo>');
  W('sample.cbz', await z.generateAsync({ type: 'nodebuffer', compression: 'STORE' }));
}

// ---------- run ----------
await makeEpub('sample.epub', true);
await makeEpub('sample-epub2.epub', false);
fs.copyFileSync(path.join(out, 'sample.epub'), path.join(out, '_tmp.epub'));
{ const b = fs.readFileSync(path.join(out, 'sample.epub')); W('corrupt.epub', b.subarray(0, Math.floor(b.length / 2))); fs.unlinkSync(path.join(out, '_tmp.epub')); }
await makeSamplePdf();
await makeScanned();
{ const b = fs.readFileSync(path.join(out, 'sample.pdf')); W('corrupt.pdf', Buffer.concat([b.subarray(0, 600), Buffer.from('garbage')])); }
W('fake.pdf', 'This is just a text file pretending to be a PDF.\n');
W('sample.txt', gutenberg());
{
  const paras = CHAPTERS.flatMap(([, p]) => p).map((p) => wrap(p));
  let t = '', n = 0;
  while (t.length < 6 * 1024 * 1024) { n++; t += `CHAPTER ${n}\n\n`; for (let i = 0; i < 12; i++) t += paras[(n + i) % paras.length] + '\n\n'; }
  W('large.txt', t);
}
W('empty.txt', '');
makeMd(); makeHtml(); makeFb2(); await makeDocx(); makeRtf(); await makeCbz();
W('book.mobi', Buffer.concat([Buffer.alloc(60), Buffer.from('BOOKMOBI'), Buffer.alloc(100)]));
W('book.djvu', Buffer.concat([Buffer.from('AT&TFORM'), Buffer.alloc(100)]));
W('book.cbr', Buffer.concat([Buffer.from('Rar!\x1a\x07\x00'), Buffer.alloc(100)]));
console.log('fixtures written to', out, fs.readdirSync(out).join(', '));
