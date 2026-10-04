// AC04 (parsing part) + CSV export safety
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { decodeText, parseCsv, mapCsvRows, guessMapping, finishText } from '../../src/domain/importParse';
import { csvCell, excerptsCsv, isFormulaLike } from '../../src/domain/csvExport';

const fx = (n: string) => new Uint8Array(readFileSync(new URL(`../fixtures/import/${n}`, import.meta.url)));

function csvRows(name: string, enc: 'utf-8' | 'shift_jis' = 'utf-8') {
  const d = decodeText(fx(name), enc, { checkLength: false });
  if (!d.ok) throw new Error(d.error);
  const p = parseCsv(d.text, { hasHeader: true });
  if (!p.ok) return p;
  return { ok: true as const, ...mapCsvRows(p.data, guessMapping(p.data.header), true) };
}

describe('TXT decoding', () => {
  it('Shift_JIS when chosen; UTF-8 strict decoding fails on SJIS bytes', () => {
    expect(decodeText(fx('sjis.txt'), 'utf-8')).toEqual({ ok: false, error: 'decode_error' });
    const r = decodeText(fx('sjis.txt'), 'shift_jis');
    expect(r).toEqual({ ok: true, text: 'シフトJISの発言です。\n送料が分かりません。\n', hasReplacementChar: false });
  });
  it('broken UTF-8 is reported, not replaced', () => {
    expect(decodeText(fx('broken_utf8.txt'), 'utf-8')).toEqual({ ok: false, error: 'decode_error' });
  });
  it('NUL is rejected', () => {
    expect(decodeText(fx('nul.txt'), 'utf-8')).toEqual({ ok: false, error: 'nul' });
  });
  it('over 10MiB is rejected before decoding', () => {
    const big = new Uint8Array(10 * 1024 * 1024 + 1).fill(0x61);
    expect(decodeText(big, 'utf-8')).toEqual({ ok: false, error: 'too_large' });
  });
  it('empty and over 20000 code points', () => {
    expect(finishText('')).toEqual({ ok: false, error: 'empty' });
    expect(finishText('﻿')).toEqual({ ok: false, error: 'empty' });
    expect(finishText('😀'.repeat(20000)).ok).toBe(true);
    expect(finishText('😀'.repeat(20001))).toEqual({ ok: false, error: 'too_long' });
  });
  it('replacement char in input is flagged for preview', () => {
    expect(finishText('a�b')).toEqual({ ok: true, text: 'a�b', hasReplacementChar: true });
  });
});

describe('CSV parsing', () => {
  it('handles quotes, commas, CRLF and newlines inside cells', () => {
    const r = csvRows('quoted.csv');
    expect(r.ok).toBe(true);
    if (!r.ok || !('rows' in r)) return;
    expect(r.errors).toEqual([]);
    expect(r.rows).toEqual([
      { rowNo: 2, participantValue: 'P01', title: '題名, カンマ付き', text: '1行目の発言\n2行目は"引用符"を含む' },
      { rowNo: 3, participantValue: '山田 花子', title: '通常', text: 'カンマ, を含む本文' },
    ]);
  });
  it('BOM header is recognised', () => {
    const r = csvRows('bom_utf8.csv');
    if (!r.ok || !('rows' in r)) throw new Error();
    expect(r.rows.map((x) => x.participantValue)).toEqual(['P01', 'P02']);
  });
  it('Shift_JIS CSV', () => {
    const r = csvRows('sjis.csv', 'shift_jis');
    if (!r.ok || !('rows' in r)) throw new Error();
    expect(r.rows[0]!.text).toBe('シフトJISの本文');
  });
  it('empty required cells produce row-numbered errors (nothing skipped)', () => {
    const r = csvRows('empty_required.csv');
    if (!r.ok || !('rows' in r)) throw new Error();
    expect(r.errors).toEqual(['3行目: 参加者が空です', '4行目: 本文が空です']);
  });
  it('1001 data rows are rejected', () => {
    const r = csvRows('rows_1001.csv');
    expect(r.ok).toBe(false);
  });
  it('101 rows exceed the 100-sources-per-import limit', () => {
    const r = csvRows('rows_101.csv');
    if (!r.ok || !('rows' in r)) throw new Error();
    expect(r.errors[0]).toContain('100資料まで');
  });
});

describe('CSV export', () => {
  it('quotes all fields, doubles quotes, BOM, CRLF', () => {
    const out = excerptsCsv([{ alias: 'P01', sourceLabel: 'S01', paragraphLabel: 'P002', publicQuote: '「A」は"B"', themeLabels: ['送料', '返品'] }]);
    expect(out).toBe('﻿"別名","資料番号","段落","公開用引用","テーマ"\r\n"P01","S01","P002","「A」は""B""","送料 / 返品"\r\n');
  });
  it('neutralises formula-like cells, including after spaces/control chars', () => {
    for (const v of ['=1+1', '+A1', '-2', '@SUM(A1)', ' =cmd', '\t=x', '\u0001-1', '＝全角']) {
      expect(isFormulaLike(v)).toBe(true);
      expect(csvCell(v).startsWith(`"'`)).toBe(true);
    }
    expect(csvCell('普通の文')).toBe('"普通の文"');
  });
});
