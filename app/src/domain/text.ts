// Text primitives. JavaScript string offsets are UTF-16 code units; user-facing
// length limits are Unicode code points (Array.from). Keep the two separate.
import Graphemer from 'graphemer';

export function cpLength(s: string): number {
  let n = 0;
  for (const _ of s) n++;
  return n;
}

/** Remove exactly one leading BOM (U+FEFF). Nothing else is trimmed. */
export function stripBom(s: string): string {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

/** CRLF / CR → LF. No other normalization (no NFC, no trim). */
export function normalizeNewlines(s: string): string {
  return s.replace(/\r\n?/g, '\n');
}

export interface Paragraph {
  /** 1-based paragraph number (P001). Empty lines count. */
  no: number;
  /** UTF-16 start offset (inclusive) */
  start: number;
  /** UTF-16 end offset (exclusive, excludes the LF) */
  end: number;
}

export function splitParagraphs(text: string): Paragraph[] {
  const out: Paragraph[] = [];
  let start = 0;
  let no = 1;
  for (;;) {
    const lf = text.indexOf('\n', start);
    if (lf === -1) {
      out.push({ no, start, end: text.length });
      break;
    }
    out.push({ no, start, end: lf });
    start = lf + 1;
    no++;
  }
  return out;
}

/** Paragraph number containing UTF-16 offset (offset at a LF belongs to the line it ends). */
export function paragraphNoAt(text: string, offset: number): number {
  let no = 1;
  for (let i = 0; i < offset && i < text.length; i++) if (text.charCodeAt(i) === 10) no++;
  return no;
}

export function formatSourceNo(n: number): string {
  return 'S' + String(n).padStart(2, '0');
}
export function formatParagraphNo(n: number): string {
  return 'P' + String(n).padStart(3, '0');
}
export function formatAliasDefault(n: number): string {
  return 'P' + String(n).padStart(2, '0');
}

type SegmenterLike = { segment(s: string): Iterable<{ index: number }> };
let forceFallback = false;
/** test hook: force the bundled fallback segmenter */
export function _setGraphemeFallback(v: boolean) {
  forceFallback = v;
}
function nativeSegmenter(): SegmenterLike | null {
  if (forceFallback) return null;
  const I = (globalThis as { Intl?: typeof Intl }).Intl as unknown as { Segmenter?: new (l?: string, o?: object) => SegmenterLike };
  if (!I || typeof I.Segmenter !== 'function') return null;
  return new I.Segmenter('ja', { granularity: 'grapheme' });
}

const graphemer = new Graphemer();

/** All grapheme cluster boundaries as UTF-16 offsets, including 0 and text.length. */
export function graphemeBoundaries(text: string): number[] {
  const seg = nativeSegmenter();
  const out: number[] = [];
  if (seg) {
    for (const s of seg.segment(text)) out.push(s.index);
  } else {
    let i = 0;
    for (const g of graphemer.iterateGraphemes(text)) {
      out.push(i);
      i += g.length;
    }
  }
  out.push(text.length);
  if (out[0] !== 0) out.unshift(0);
  return out;
}

export function graphemes(text: string): string[] {
  const b = graphemeBoundaries(text);
  const out: string[] = [];
  for (let i = 0; i + 1 < b.length; i++) out.push(text.slice(b[i], b[i + 1]));
  return out;
}

export class BoundarySet {
  private readonly set: Set<number>;
  readonly list: number[];
  constructor(text: string) {
    this.list = graphemeBoundaries(text);
    this.set = new Set(this.list);
  }
  has(offset: number): boolean {
    return this.set.has(offset);
  }
}

/** Contains NUL? */
export function hasNul(s: string): boolean {
  return s.indexOf('\u0000') !== -1;
}

/** Search-only normalization (NFKC + lower case). Never stored over originals. */
export function searchKey(s: string): string {
  return s.normalize('NFKC').toLowerCase();
}

/** Theme duplicate key: NFKC + trim + casefold equivalent */
export function themeKey(s: string): string {
  return s.normalize('NFKC').trim().toLowerCase();
}
