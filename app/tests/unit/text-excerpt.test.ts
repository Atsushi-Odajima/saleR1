// AC03: emoji, combining chars, Japanese, CRLF, repeated sentences, overlapping excerpts.
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { cpLength, graphemeBoundaries, normalizeNewlines, splitParagraphs, stripBom, paragraphNoAt, _setGraphemeFallback } from '../../src/domain/text';
import { validateExcerptRange, normalizeRedactions, publicQuote, highlightSegments, excerptAnchorIntact, trimRangeNewlines, findPhraseRanges } from '../../src/domain/excerpt';
import { decodeText } from '../../src/domain/importParse';

const raw = readFileSync(new URL('../fixtures/import/crlf_emoji.txt', import.meta.url));

describe('text normalization', () => {
  it('only CRLF/CR→LF and one BOM are changed', () => {
    expect(normalizeNewlines('a\r\nb\rc\n')).toBe('a\nb\nc\n');
    expect(stripBom('﻿﻿x')).toBe('﻿x');
    // no NFC normalization: e + combining acute stays two code points
    expect(normalizeNewlines('é')).toBe('é');
    expect(normalizeNewlines('  空白  ')).toBe('  空白  ');
  });

  it('decodes the CRLF/emoji fixture and keeps empty lines as paragraphs', () => {
    const r = decodeText(new Uint8Array(raw), 'utf-8');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.text).toBe('先頭\n👍🏽 はい\n家族👨‍👩‍👧です\nが́\n繰り返し。繰り返し。\n');
    const ps = splitParagraphs(r.text);
    expect(ps.map((p) => p.no)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(ps[5]).toEqual({ no: 6, start: r.text.length, end: r.text.length });
    expect(splitParagraphs('a\n\nb').map((p) => [p.start, p.end])).toEqual([[0, 1], [2, 2], [3, 4]]);
  });

  it('code points vs UTF-16', () => {
    expect('👍🏽'.length).toBe(4);
    expect(cpLength('👍🏽')).toBe(2);
    expect(cpLength('日本語')).toBe(3);
  });
});

describe.each([false, true])('grapheme boundaries (fallback=%s)', (fallback) => {
  afterEach(() => _setGraphemeFallback(false));
  it('does not split emoji ZWJ sequences, skin tones, or combining marks', () => {
    _setGraphemeFallback(fallback);
    const t = '家族👨‍👩‍👧です👍🏽が́';
    const b = graphemeBoundaries(t);
    // 家,族,👨‍👩‍👧(8 units),で,す,👍🏽(4),が+◌́(2)
    expect(b).toEqual([0, 1, 2, 10, 11, 12, 16, 18]);
  });
});

describe('excerpt ranges', () => {
  const text = '先頭\n👍🏽 はい\n家族👨‍👩‍👧です\nが́\n繰り返し。繰り返し。\n';
  it('slice must equal quote; repeated sentences keep distinct anchors', () => {
    const first = text.indexOf('繰り返し。');
    const second = text.indexOf('繰り返し。', first + 1);
    const a = validateExcerptRange(text, first, first + 5);
    const b = validateExcerptRange(text, second, second + 5);
    expect(a.ok && b.ok).toBe(true);
    expect(first).not.toBe(second);
    expect(text.slice(second, second + 5)).toBe('繰り返し。');
    expect(paragraphNoAt(text, second)).toBe(5);
  });
  it('rejects splitting surrogate pairs / ZWJ sequences / combining marks', () => {
    const i = text.indexOf('👍🏽');
    expect(validateExcerptRange(text, i + 1, i + 4)).toEqual({ ok: false, error: 'not_grapheme_boundary' });
    expect(validateExcerptRange(text, i, i + 2)).toEqual({ ok: false, error: 'not_grapheme_boundary' }); // between emoji and skin tone
    const fam = text.indexOf('👨');
    expect(validateExcerptRange(text, fam, fam + 2).ok).toBe(false);
    const ga = text.indexOf('が');
    expect(validateExcerptRange(text, ga, ga + 1).ok).toBe(false);
    expect(validateExcerptRange(text, ga, ga + 2)).toEqual({ ok: true, quote: 'が́' });
  });
  it('rejects empty, reversed, out-of-bounds, newline-only, over 800 code points', () => {
    expect(validateExcerptRange(text, 3, 3).ok).toBe(false);
    expect(validateExcerptRange(text, 5, 3).ok).toBe(false);
    expect(validateExcerptRange(text, 0, text.length + 1).ok).toBe(false);
    expect(validateExcerptRange('a\n\nb', 1, 3)).toEqual({ ok: false, error: 'only_newlines' });
    const long = 'あ'.repeat(801);
    expect(validateExcerptRange(long, 0, 801)).toEqual({ ok: false, error: 'too_long' });
    expect(validateExcerptRange(long, 0, 800).ok).toBe(true);
    const emoji800 = '😀'.repeat(800);
    expect(validateExcerptRange(emoji800, 0, 1600).ok).toBe(true); // 800 code points, 1600 UTF-16 units
  });
  it('trims line breaks at the selection ends without changing text', () => {
    expect(trimRangeNewlines('a\nbc\n', 1, 5)).toEqual([2, 4]);
  });
  it('anchor check detects drift', () => {
    expect(excerptAnchorIntact({ text }, { startUtf16: 0, endUtf16: 2, quote: '先頭' })).toBe(true);
    expect(excerptAnchorIntact({ text: 'X' + text }, { startUtf16: 0, endUtf16: 2, quote: '先頭' })).toBe(false);
  });
  it('overlapping excerpts split into segments', () => {
    const segs = highlightSegments(0, 10, [
      { id: 'a', startUtf16: 2, endUtf16: 6 },
      { id: 'b', startUtf16: 4, endUtf16: 8 },
    ]);
    expect(segs).toEqual([
      { start: 0, end: 2, ids: [] },
      { start: 2, end: 4, ids: ['a'] },
      { start: 4, end: 6, ids: ['a', 'b'] },
      { start: 6, end: 8, ids: ['b'] },
      { start: 8, end: 10, ids: [] },
    ]);
  });
});

describe('redactions', () => {
  it('sorts, merges overlapping and adjacent ranges', () => {
    const q = '山田さんは東京の会社で働く';
    const r = normalizeRedactions(q, [
      { startUtf16: 5, endUtf16: 7 },
      { startUtf16: 0, endUtf16: 2 },
      { startUtf16: 1, endUtf16: 3 },
      { startUtf16: 7, endUtf16: 8 },
    ]);
    expect(r).toEqual({ ok: true, ranges: [{ startUtf16: 0, endUtf16: 3 }, { startUtf16: 5, endUtf16: 8 }] });
    if (r.ok) expect(publicQuote(q, r.ranges)).toBe('［伏字］んは［伏字］会社で働く');
  });
  it('rejects ranges splitting a grapheme', () => {
    expect(normalizeRedactions('👍🏽x', [{ startUtf16: 0, endUtf16: 1 }]).ok).toBe(false);
  });
  it('phrase search finds all occurrences', () => {
    expect(findPhraseRanges('田中と田中', '田中')).toEqual([{ startUtf16: 0, endUtf16: 2 }, { startUtf16: 3, endUtf16: 5 }]);
  });
});
