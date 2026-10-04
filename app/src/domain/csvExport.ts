// Excerpt CSV for spreadsheets: UTF-8 BOM, CRLF, every field quoted, quotes doubled,
// cells that could be read as formulas are prefixed with an apostrophe.

/** True if the cell would be interpreted as a formula (also after leading spaces/control chars). */
export function isFormulaLike(v: string): boolean {
  // eslint-disable-next-line no-control-regex
  const stripped = v.replace(/^[\s\u0000-\u001f\u007f　]+/, '');
  return /^[=+\-@＝＋－＠]/.test(stripped) || /^[\t\r]/.test(v);
}

export function csvCell(v: string): string {
  const safe = isFormulaLike(v) ? "'" + v : v;
  return '"' + safe.replace(/"/g, '""') + '"';
}

export function toCsv(rows: string[][]): string {
  return '﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

export interface ExcerptCsvRow {
  alias: string;
  sourceLabel: string;
  paragraphLabel: string;
  publicQuote: string;
  themeLabels: string[];
}

export function excerptsCsv(rows: ExcerptCsvRow[]): string {
  return toCsv([
    ['別名', '資料番号', '段落', '公開用引用', 'テーマ'],
    ...rows.map((r) => [r.alias, r.sourceLabel, r.paragraphLabel, r.publicQuote, r.themeLabels.join(' / ')]),
  ]);
}
