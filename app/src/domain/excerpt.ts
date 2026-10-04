import type { Excerpt, Range, Source } from './schema';
import { BoundarySet, cpLength, paragraphNoAt } from './text';
import { sha256Hex } from './hash';
import { LIMITS } from './limits';

export const REDACTION_MARK = '［伏字］';

export type RangeError =
  | 'empty'
  | 'out_of_bounds'
  | 'not_grapheme_boundary'
  | 'too_long'
  | 'only_newlines';

/**
 * Validate a candidate excerpt range against the raw source text.
 * Returns the quote when valid. Ranges are half-open UTF-16 [start, end).
 */
export function validateExcerptRange(
  text: string,
  start: number,
  end: number,
  boundaries?: BoundarySet,
): { ok: true; quote: string } | { ok: false; error: RangeError } {
  if (!Number.isInteger(start) || !Number.isInteger(end)) return { ok: false, error: 'out_of_bounds' };
  if (start < 0 || end > text.length) return { ok: false, error: 'out_of_bounds' };
  if (end <= start) return { ok: false, error: 'empty' };
  const b = boundaries ?? new BoundarySet(text);
  if (!b.has(start) || !b.has(end)) return { ok: false, error: 'not_grapheme_boundary' };
  const quote = text.slice(start, end);
  if (/^\n*$/.test(quote)) return { ok: false, error: 'only_newlines' };
  if (cpLength(quote) > LIMITS.excerptCodePoints) return { ok: false, error: 'too_long' };
  return { ok: true, quote };
}

/** Shrink a selection so it does not start/end with line breaks. Never changes the text. */
export function trimRangeNewlines(text: string, start: number, end: number): [number, number] {
  let s = start;
  let e = end;
  while (s < e && text.charCodeAt(s) === 10) s++;
  while (e > s && text.charCodeAt(e - 1) === 10) e--;
  return [s, e];
}

/** The stored anchor must still match the source exactly. */
export function excerptAnchorIntact(source: Pick<Source, 'text'>, ex: Pick<Excerpt, 'startUtf16' | 'endUtf16' | 'quote'>): boolean {
  return (
    ex.startUtf16 >= 0 &&
    ex.endUtf16 <= source.text.length &&
    ex.startUtf16 < ex.endUtf16 &&
    source.text.slice(ex.startUtf16, ex.endUtf16) === ex.quote
  );
}

/**
 * Sort, merge overlapping and adjacent ranges. Validates that every range lies
 * inside the quote and on grapheme boundaries of the quote.
 */
export function normalizeRedactions(quote: string, ranges: Range[]): { ok: true; ranges: Range[] } | { ok: false; error: RangeError } {
  const b = new BoundarySet(quote);
  for (const r of ranges) {
    if (r.startUtf16 < 0 || r.endUtf16 > quote.length) return { ok: false, error: 'out_of_bounds' };
    if (r.endUtf16 <= r.startUtf16) return { ok: false, error: 'empty' };
    if (!b.has(r.startUtf16) || !b.has(r.endUtf16)) return { ok: false, error: 'not_grapheme_boundary' };
  }
  const sorted = [...ranges].sort((a, c) => a.startUtf16 - c.startUtf16 || a.endUtf16 - c.endUtf16);
  const out: Range[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r.startUtf16 <= last.endUtf16) {
      last.endUtf16 = Math.max(last.endUtf16, r.endUtf16);
    } else {
      out.push({ startUtf16: r.startUtf16, endUtf16: r.endUtf16 });
    }
  }
  return { ok: true, ranges: out };
}

/** Public quote: redacted ranges are replaced in the text itself. */
export function publicQuote(quote: string, redactions: Range[]): string {
  let out = '';
  let pos = 0;
  for (const r of redactions) {
    out += quote.slice(pos, r.startUtf16) + REDACTION_MARK;
    pos = r.endUtf16;
  }
  return out + quote.slice(pos);
}

/** Find all non-overlapping occurrences of a phrase inside the quote (for "伏字にする語句"). */
export function findPhraseRanges(quote: string, phrase: string): Range[] {
  if (!phrase) return [];
  const out: Range[] = [];
  let i = quote.indexOf(phrase);
  while (i !== -1) {
    out.push({ startUtf16: i, endUtf16: i + phrase.length });
    i = quote.indexOf(phrase, i + phrase.length);
  }
  return out;
}

/** Hash of what will be published for this excerpt. Changes → re-review required. */
export async function publicReviewHash(args: {
  publicText: string;
  alias: string;
  sourceNo: number;
  startUtf16: number;
  endUtf16: number;
}): Promise<string> {
  return sha256Hex(
    JSON.stringify(['koeito-public-review:1', args.publicText, args.alias, args.sourceNo, args.startUtf16, args.endUtf16]),
  );
}

export function excerptParagraphNo(source: Pick<Source, 'text'>, ex: Pick<Excerpt, 'startUtf16'>): number {
  return paragraphNoAt(source.text, ex.startUtf16);
}

/**
 * Split [lineStart, lineEnd) into segments by excerpt boundaries so overlapping
 * excerpts render correctly. Each segment lists the excerpt ids covering it.
 */
export function highlightSegments(
  lineStart: number,
  lineEnd: number,
  excerpts: Array<Pick<Excerpt, 'id' | 'startUtf16' | 'endUtf16'>>,
): Array<{ start: number; end: number; ids: string[] }> {
  const cuts = new Set<number>([lineStart, lineEnd]);
  const rel = excerpts.filter((e) => e.startUtf16 < lineEnd && e.endUtf16 > lineStart);
  for (const e of rel) {
    if (e.startUtf16 > lineStart && e.startUtf16 < lineEnd) cuts.add(e.startUtf16);
    if (e.endUtf16 > lineStart && e.endUtf16 < lineEnd) cuts.add(e.endUtf16);
  }
  const pts = [...cuts].sort((a, b) => a - b);
  const segs: Array<{ start: number; end: number; ids: string[] }> = [];
  for (let i = 0; i + 1 < pts.length; i++) {
    const s = pts[i]!;
    const e = pts[i + 1]!;
    if (e <= s) continue;
    segs.push({ start: s, end: e, ids: rel.filter((x) => x.startUtf16 <= s && x.endUtf16 >= e).map((x) => x.id) });
  }
  if (segs.length === 0) segs.push({ start: lineStart, end: lineEnd, ids: [] });
  return segs;
}
