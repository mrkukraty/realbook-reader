import { describe, it, expect } from 'vitest';
import { spreadCount, spreadOfPage, pagesOfSpread, primaryPageOfSpread, visiblePages } from '../../src/features/page-flip/spread';
import { PageMap } from '../../src/features/reader/reflow/pageMap';
import { toSectionFraction, fromSectionFraction, overallFraction, chunkForSection } from '../../src/features/reader/progress';
import { findMatches } from '../../src/features/search/snippets';
import { applyHighlights, clearHighlights, rangeToOffsets, localizeHighlights } from '../../src/features/highlights/apply';
import { buildChunks } from '../../src/features/reader/reflow/chunks';
import { tFromEdgePointer, decideRelease, edgeGeometry } from '../../src/features/page-flip/flip-math';
import { computeBookSize, resolveMode } from '../../src/features/reader/layout';

describe('spread math', () => {
  it('double spreads', () => {
    expect(spreadCount(5, 'double')).toBe(3);
    expect(spreadCount(4, 'double')).toBe(3);
    expect(pagesOfSpread(0, 'double', 5)).toEqual([null, 0]);
    expect(pagesOfSpread(1, 'double', 5)).toEqual([1, 2]);
    expect(pagesOfSpread(2, 'double', 4)).toEqual([3, null]);
    expect(spreadOfPage(0, 'double')).toBe(0);
    expect(spreadOfPage(1, 'double')).toBe(1);
    expect(spreadOfPage(2, 'double')).toBe(1);
    expect(spreadOfPage(3, 'double')).toBe(2);
    expect(primaryPageOfSpread(2, 'double')).toBe(3);
  });
  it('every page appears exactly once across spreads', () => {
    for (const mode of ['single', 'double'] as const) for (const n of [1, 2, 3, 10, 11]) {
      const seen: number[] = [];
      for (let s = 0; s < spreadCount(n, mode); s++) seen.push(...visiblePages(s, mode, n));
      expect(seen).toEqual(Array.from({ length: n }, (_, i) => i));
    }
  });
});

describe('PageMap', () => {
  it('maps global index <-> loc', () => {
    const m = new PageMap(3, [2, 3, 1]);
    expect(m.total()).toBe(6);
    expect(m.toLoc(0)).toEqual({ chunk: 0, page: 0 });
    expect(m.toLoc(2)).toEqual({ chunk: 1, page: 0 });
    expect(m.toLoc(5)).toEqual({ chunk: 2, page: 0 });
    expect(m.toIndex({ chunk: 1, page: 2 })).toBe(4);
    expect(m.pageForFraction(1, 0.5)).toBe(1);
  });
  it('estimates unknown', () => {
    const m = new PageMap(3);
    m.set(0, 4);
    expect(m.complete()).toBe(false);
    expect(m.total()).toBe(12);
  });
});

describe('progress', () => {
  const chunks = [
    { section: 0, textStart: 0, textLen: 100 },
    { section: 0, textStart: 100, textLen: 100 },
    { section: 1, textStart: 0, textLen: 200 },
  ];
  it('round trips section fraction', () => {
    const f = toSectionFraction(chunks, [0, 1], 1, 0.5);
    expect(f).toBeCloseTo(0.75);
    expect(fromSectionFraction(chunks, [0, 1], f)).toEqual({ chunk: 1, frac: 0.5 });
  });
  it('overall', () => {
    expect(overallFraction(chunks, 2, 0)).toBeCloseTo(0.5);
    expect(overallFraction(chunks, 2, 1)).toBeCloseTo(1);
  });
  it('chunkForSection skips empty', () => {
    expect(chunkForSection([[], [3]], 0)).toBe(3);
  });
});

describe('search snippets', () => {
  it('finds case-insensitively with context', () => {
    const r = findMatches('The Quick brown fox jumps over the lazy dog. quick!', 'quick', { context: 5 });
    expect(r.map((x) => x.index)).toEqual([4, 45]);
    expect(r[0].snippet.match).toBe('Quick');
  });
  it('empty query', () => expect(findMatches('abc', '  ')).toEqual([]));
});

describe('highlights', () => {
  it('applies and clears, offsets stay valid', () => {
    const root = document.createElement('div');
    root.innerHTML = '<p>Hello <b>brave</b> new world</p>';
    const text = root.textContent!;
    applyHighlights(root, [{ id: 'a', start: 3, end: 14, color: 'yellow' }, { id: 'b', start: 16, end: 19, color: 'pink' }]);
    expect(root.textContent).toBe(text);
    const marks = root.querySelectorAll('mark[data-hl]');
    expect(marks.length).toBeGreaterThanOrEqual(3);
    expect(Array.from(root.querySelectorAll('mark[data-hl="a"]')).map((m) => m.textContent).join('')).toBe(text.slice(3, 14));
    expect(root.querySelector('mark[data-hl="b"]')!.textContent).toBe(text.slice(16, 19));
    clearHighlights(root);
    expect(root.querySelectorAll('mark').length).toBe(0);
    expect(root.innerHTML).toBe('<p>Hello <b>brave</b> new world</p>');
  });
  it('rangeToOffsets', () => {
    const root = document.createElement('div');
    root.innerHTML = '<p>Hello <b>brave</b> new world</p>';
    document.body.appendChild(root);
    const r = document.createRange();
    const b = root.querySelector('b')!.firstChild!;
    r.setStart(b, 1); r.setEnd(root.querySelector('p')!.lastChild!, 4);
    expect(rangeToOffsets(root, r)).toEqual({ start: 7, end: 15 });
    root.remove();
  });
  it('localize clips', () => {
    expect(localizeHighlights([{ start: 90, end: 120 }], 100, 50)).toEqual([{ start: 0, end: 20 }]);
  });
});

describe('chunks', () => {
  it('sanitizes and skips empty sections', () => {
    const { chunks, sectionChunks } = buildChunks({ sections: [
      { id: 'a', html: '<p onclick="x()">Hi</p><script>alert(1)</script>' },
      { id: 'b', html: '   ' },
      { id: 'c', html: '<h1 id="t">T</h1><p>body</p>' },
    ] });
    expect(chunks.length).toBe(2);
    expect(chunks[0].html).not.toMatch(/script|onclick/);
    expect(sectionChunks).toEqual([[0], [], [1]]);
    expect(chunks[1].ids).toEqual(['t']);
  });
  it('splits huge sections at block boundaries', () => {
    const html = Array.from({ length: 20 }, (_, i) => `<p>${'x'.repeat(100)}${i}</p>`).join('');
    const { chunks, sectionChunks } = buildChunks({ sections: [{ id: 'a', html }] }, 500);
    expect(chunks.length).toBeGreaterThan(2);
    expect(chunks[1].textStart).toBe(chunks[0].textLen);
    expect(sectionChunks[0].length).toBe(chunks.length);
    expect(chunks.reduce((a, c) => a + c.textLen, 0)).toBe(2030);
  });
});

describe('flip math', () => {
  it('edge pointer maps to t', () => {
    expect(tFromEdgePointer(200, 200, 'double', 1)).toBeCloseTo(0.5, 5);
    expect(tFromEdgePointer(400, 200, 'double', 1)).toBeCloseTo(0);
    expect(tFromEdgePointer(0, 200, 'double', 1)).toBeCloseTo(1);
    expect(tFromEdgePointer(0, 200, 'double', -1)).toBeCloseTo(0);
    expect(tFromEdgePointer(200, 200, 'single', 1)).toBeCloseTo(0);
    expect(tFromEdgePointer(0, 200, 'single', 1)).toBeCloseTo(1);
  });
  it('release decision', () => {
    expect(decideRelease(0.4, 0)).toBe(true);
    expect(decideRelease(0.2, 0)).toBe(false);
    expect(decideRelease(0.2, 0.002)).toBe(true);
    expect(decideRelease(0.6, -0.002)).toBe(false);
  });
  it('edge geometry', () => {
    expect(edgeGeometry(0, 100, 'double', 1)).toEqual({ x: 200, side: 1 });
    expect(edgeGeometry(180, 100, 'double', 1).x).toBeCloseTo(0);
  });
});

describe('layout', () => {
  it('auto mode', () => {
    expect(resolveMode('auto', 1200, 800)).toBe('double');
    expect(resolveMode('auto', 800, 1000)).toBe('single');
    expect(resolveMode('single', 1600, 800)).toBe('single');
  });
  it('sizes fit', () => {
    const s = computeBookSize({ stageW: 1280, stageH: 720, mode: 'double', aspect: 0.68, flex: true, readingWidth: 100, framePad: 14, edge: 12, reserveY: 120 });
    expect(s.pageW * 2).toBeLessThan(1280);
    expect(s.pageH).toBeLessThan(720);
  });
});
