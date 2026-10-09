/// <reference types="jest" />
/// <reference types="node" />
import { chooseFlipMode, pageBox, pagesOfSpread, primaryPageOfSpread, spreadCount, spreadOfPage, visiblePages } from '../src/reader/spread';
import { decideRelease, leafAngle, remainingDuration, tapZone, tFromSwipe } from '../src/reader/flip-math';
import { fixedNeighbor, reflowNext, reflowPrev, rightOf } from '../src/reader/navigation';
import {
  fixedFraction, fromOverallFraction, overallFraction, pageToSectionFraction, sectionFractionToPage,
} from '../src/reader/progress';
import { buildPageHtml, htmlToText, pageGeometry, searchText } from '../src/reader/page-html';
import { defaultSettings } from '../src/settings/types';

describe('spread math', () => {
  it('single mode', () => {
    expect(spreadCount(10, 'single')).toBe(10);
    expect(spreadOfPage(3, 'single')).toBe(3);
    expect(pagesOfSpread(3, 'single', 10)).toEqual([null, 3]);
    expect(spreadCount(0, 'single')).toBe(1);
  });
  it('double mode: cover alone on the right', () => {
    expect(spreadCount(10, 'double')).toBe(6);
    expect(pagesOfSpread(0, 'double', 10)).toEqual([null, 0]);
    expect(pagesOfSpread(1, 'double', 10)).toEqual([1, 2]);
    expect(pagesOfSpread(5, 'double', 10)).toEqual([9, null]);
    expect(spreadOfPage(2, 'double')).toBe(1);
    expect(spreadOfPage(1, 'double')).toBe(1);
    expect(primaryPageOfSpread(1, 'double', 10)).toBe(1);
    expect(visiblePages(5, 'double', 10)).toEqual([9]);
  });
  it('chooses single on phones, double on tablets/landscape', () => {
    expect(chooseFlipMode(390, 844, 'auto')).toBe('single');
    expect(chooseFlipMode(844, 390, 'auto')).toBe('double');
    expect(chooseFlipMode(1024, 1366, 'auto')).toBe('double');
    expect(chooseFlipMode(1024, 1366, 'single')).toBe('single');
    expect(chooseFlipMode(390, 844, 'double')).toBe('single'); // too narrow for two pages
  });
  it('page boxes keep a paper ratio', () => {
    const { pw, ph } = pageBox(1000, 600, 'double', 0.7);
    expect(pw).toBeLessThanOrEqual(500);
    expect(pw / ph).toBeCloseTo(0.7, 1);
  });
});

describe('flip math', () => {
  it('maps swipe distance and angles', () => {
    expect(tFromSwipe(0, 400, 'single')).toBe(0);
    expect(tFromSwipe(-320, 400, 'single')).toBe(1);
    expect(leafAngle(0.5, 'double', 1)).toBe(90);
    expect(leafAngle(1, 'single', -1)).toBe(0);
  });
  it('decides release by threshold and flick velocity', () => {
    expect(decideRelease(0.5, 0)).toBe(true);
    expect(decideRelease(0.2, 0)).toBe(false);
    expect(decideRelease(0.1, 2)).toBe(true);
    expect(decideRelease(0.8, -2)).toBe(false);
  });
  it('tap zones and durations', () => {
    expect(tapZone(0.1, 1)).toBe(-1);
    expect(tapZone(0.5, 1)).toBe(0);
    expect(tapZone(0.9, 1)).toBe(1);
    expect(remainingDuration(0, 1, 600, 2)).toBe(300);
    expect(remainingDuration(0.99, 1, 600, 1)).toBe(60);
  });
});

describe('navigation', () => {
  it('reflow next/prev across sections', () => {
    expect(reflowNext({ section: 0, page: 2 }, 3, 2, 'single')).toEqual({ section: 1, page: 0 });
    expect(reflowNext({ section: 1, page: 2 }, 3, 2, 'single')).toBeNull();
    expect(reflowNext({ section: 0, page: 0 }, 2, 2, 'double')).toEqual({ section: 1, page: 0 });
    expect(reflowNext({ section: 0, page: 0 }, 3, 2, 'double')).toEqual({ section: 0, page: 2 }); // [2, blank] spread
    expect(reflowNext({ section: 0, page: 0 }, 4, 2, 'double')).toEqual({ section: 0, page: 2 });
    expect(reflowPrev({ section: 1, page: 0 }, 'single')).toEqual({ section: 0, page: 'last' });
    expect(reflowPrev({ section: 1, page: 0 }, 'double')).toEqual({ section: 0, page: 'lastEven' });
    expect(reflowPrev({ section: 0, page: 0 }, 'single')).toBeNull();
    expect(rightOf(4)).toBe(5);
    expect(rightOf('lastEven')).toBe('lastEven1');
  });
  it('fixed neighbours', () => {
    expect(fixedNeighbor(0, 1, 'double', 10)).toBe(1);
    expect(fixedNeighbor(1, 1, 'double', 10)).toBe(3);
    expect(fixedNeighbor(9, 1, 'double', 10)).toBeNull();
    expect(fixedNeighbor(0, -1, 'single', 10)).toBeNull();
  });
});

describe('progress conversion', () => {
  it('page <-> section fraction round-trips', () => {
    for (const n of [1, 3, 7, 20]) {
      for (let p = 0; p < n; p++) expect(sectionFractionToPage(pageToSectionFraction(p, n), n)).toBe(p);
    }
    expect(sectionFractionToPage(1, 5)).toBe(4);
    expect(sectionFractionToPage(NaN, 5)).toBe(0);
  });
  it('overall fraction is weighted by section length and invertible', () => {
    const lens = [100, 300, 600];
    expect(overallFraction(0, 0, lens)).toBe(0);
    expect(overallFraction(1, 0, lens)).toBeCloseTo(0.1);
    expect(overallFraction(2, 1, lens)).toBe(1);
    const back = fromOverallFraction(overallFraction(2, 0.5, lens), lens);
    expect(back.section).toBe(2);
    expect(back.sectionFraction).toBeCloseTo(0.5);
    expect(fixedFraction(0, 10)).toBe(0);
    expect(fixedFraction(9, 10)).toBe(1);
  });
});

describe('page html', () => {
  it('builds a CSP-locked page with our nonce only', () => {
    const geom = pageGeometry(400, 700, defaultSettings);
    const html = buildPageHtml({
      sectionHtml: '<p>Hello</p>', settings: defaultSettings, geom, start: { fraction: 0.5 }, highlights: [], sid: '0R', gen: 1,
      nonce: 'abc123', key: 'k1',
    });
    expect(html).toContain("script-src 'nonce-abc123'");
    expect(html).toContain("default-src 'none'");
    expect(html).toContain('column-width');
    expect(html).toContain('<p>Hello</p>');
    expect((html.match(/<script nonce="abc123">/g) ?? []).length).toBe(2);
  });
  it('extracts text and finds matches with snippets', () => {
    const t = htmlToText('<p>Fish &amp; chips</p><p>more fish</p>');
    expect(t).toBe('Fish & chipsmore fish');
    const hits = searchText([t, 'no match', 'FISH'], 'fish');
    expect(hits.map((h) => [h.section, h.start])).toEqual([[0, 0], [0, 17], [2, 0]]);
    expect(searchText([t], 'f')).toEqual([]);
  });
});
