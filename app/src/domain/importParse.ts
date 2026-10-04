// Import parsing: TXT decoding and CSV parsing (RFC4180 via Papa Parse).
import Papa from 'papaparse';
import { cpLength, hasNul, normalizeNewlines, stripBom } from './text';
import { LIMITS } from './limits';

export type Encoding = 'utf-8' | 'shift_jis';

export type DecodeResult =
  | { ok: true; text: string; hasReplacementChar: boolean }
  | { ok: false; error: 'too_large' | 'decode_error' | 'nul' | 'empty' | 'too_long' | 'unsupported_encoding'; detail?: string };

export const DECODE_ERROR_LABEL: Record<Exclude<DecodeResult, { ok: true }>['error'], string> = {
  too_large: 'ファイルが10MiBを超えています',
  decode_error: '文字コードとして読めない部分があります。文字コードを変えて読み直してください',
  nul: 'NUL文字を含むため取り込めません（テキストではない可能性があります）',
  empty: '本文が空です',
  too_long: '1資料は20,000文字までです',
  unsupported_encoding: 'この環境ではShift_JISを読み込めません',
};

/** Decode bytes with the chosen encoding. Strict: decoding errors are reported, not replaced. */
export function decodeText(bytes: Uint8Array, encoding: Encoding, opts: { checkLength?: boolean } = {}): DecodeResult {
  if (bytes.byteLength > LIMITS.importFileBytes) return { ok: false, error: 'too_large' };
  let dec: TextDecoder;
  try {
    dec = new TextDecoder(encoding, { fatal: true, ignoreBOM: true });
  } catch {
    return { ok: false, error: 'unsupported_encoding' };
  }
  let raw: string;
  try {
    raw = dec.decode(bytes);
  } catch {
    return { ok: false, error: 'decode_error' };
  }
  return finishText(raw, opts.checkLength ?? true);
}

/** Pasted text goes through the same rules (BOM, newline, NUL, length). */
export function finishText(raw: string, checkLength = true): DecodeResult {
  const text = normalizeNewlines(stripBom(raw));
  if (hasNul(text)) return { ok: false, error: 'nul' };
  if (checkLength) {
    if (text.length === 0) return { ok: false, error: 'empty' };
    if (cpLength(text) > LIMITS.sourceTextCodePoints) return { ok: false, error: 'too_long' };
  }
  return { ok: true, text, hasReplacementChar: text.includes('�') };
}

export interface CsvParsed {
  header: string[];
  rows: string[][];
}

export type CsvResult = { ok: true; data: CsvParsed } | { ok: false; error: string; rowErrors?: string[] };

/** Parse CSV text (already decoded and newline-normalized). */
export function parseCsv(text: string, opts: { hasHeader: boolean }): CsvResult {
  const res = Papa.parse<string[]>(text, { header: false, skipEmptyLines: 'greedy', delimiter: ',', newline: '\n', quoteChar: '"' });
  const errs = res.errors.filter((er) => er.type !== 'Delimiter');
  if (errs.length) {
    return { ok: false, error: 'CSVの形式を読み取れませんでした', rowErrors: errs.slice(0, 20).map((er) => `${(er.row ?? 0) + 1}行目: ${er.message}`) };
  }
  const all = res.data;
  if (all.length === 0) return { ok: false, error: 'CSVに行がありません' };
  const header = opts.hasHeader ? all[0]!.map((h) => h) : all[0]!.map((_, i) => `${i + 1}列目`);
  const rows = opts.hasHeader ? all.slice(1) : all;
  if (rows.length > LIMITS.csvRows) return { ok: false, error: `CSVは${LIMITS.csvRows}行までです（${rows.length}行あります）` };
  return { ok: true, data: { header, rows } };
}

export interface CsvMapping {
  participant: number;
  text: number;
  title: number | null;
}

export interface CsvRowDraft {
  rowNo: number; // 1-based line in file including header
  participantValue: string;
  text: string;
  title: string | null;
}

export function guessMapping(header: string[]): CsvMapping {
  const find = (re: RegExp) => header.findIndex((h) => re.test(h.trim()));
  const p = find(/^(participant|参加者|別名|alias|話者)$/i);
  const t = find(/^(text|本文|発言|内容)$/i);
  const ti = find(/^(title|タイトル|題名|件名)$/i);
  return { participant: p >= 0 ? p : 0, text: t >= 0 ? t : Math.min(1, header.length - 1), title: ti >= 0 ? ti : null };
}

/** Apply column mapping. Any invalid row blocks the whole import (no silent skip). */
export function mapCsvRows(data: CsvParsed, m: CsvMapping, hasHeader: boolean): { rows: CsvRowDraft[]; errors: string[] } {
  const rows: CsvRowDraft[] = [];
  const errors: string[] = [];
  if (m.participant === m.text) errors.push('参加者列と本文列に同じ列は使えません');
  data.rows.forEach((r, i) => {
    const rowNo = i + 1 + (hasHeader ? 1 : 0);
    const pv = r[m.participant] ?? '';
    const tx = r[m.text] ?? '';
    const ti = m.title === null ? null : (r[m.title] ?? '');
    if (pv.trim() === '') errors.push(`${rowNo}行目: 参加者が空です`);
    else if (cpLength(pv) > 200) errors.push(`${rowNo}行目: 参加者の値が長すぎます`);
    const fin = finishText(tx);
    if (!fin.ok) errors.push(`${rowNo}行目: ${DECODE_ERROR_LABEL[fin.error]}`);
    else if (fin.hasReplacementChar) errors.push(`${rowNo}行目: 置換文字（�）を含みます。文字コードを確認してください`);
    if (ti !== null && cpLength(ti) > 120) errors.push(`${rowNo}行目: タイトルは120文字までです`);
    rows.push({ rowNo, participantValue: pv, text: fin.ok ? fin.text : tx, title: ti && ti.trim() !== '' ? ti : null });
  });
  if (rows.length > LIMITS.sourcesPerImport) errors.unshift(`1回の取込は${LIMITS.sourcesPerImport}資料までです（${rows.length}行）`);
  return { rows, errors };
}
