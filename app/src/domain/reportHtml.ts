// Renders a ReportDTO to a single self-contained UTF-8 HTML file.
// No script, no event attributes, no remote URLs, no images. All text escaped.
import type { ReportDTO, ReportFindingDTO, ReportQuoteDTO } from './report';

export interface EmbeddedFont {
  family: 'KoeitoSerif' | 'KoeitoSans' | 'KoeitoBrand';
  /** base64 TrueType */
  dataB64: string;
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** Every fixed label printed in the report (used for font subsetting). */
export const REPORT_STATIC_TEXT =
  '改善提案レポート草案・根拠未確認この文書は正式な提出物ではありません。不足：調査の問い実施期間未設定資料数件参加者人（別名で表記）作成日' +
  '調査の範囲と限界本レポートの引用は参加者の発言の一部です。件数は回答者の中での数で、母集団の割合や確からしさを示すものではありません。' +
  '観察と解釈支持する声異なる声文脈となる声反証の確認次の一手改善案期待する変化次に確かめること引用・出典の読み方＝別名資料番号資料内の段落番号' +
  '反証確認は未実施気づきなし0123456789／・「」年月日〜—– ()（）:：.,、。ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyzKoeito→ ';

const e = escapeHtml;
const para = (s: string) => (s.trim() === '' ? '' : `<p class="text">${e(s)}</p>`);
const pad2 = (n: number) => String(n).padStart(2, '0');

function quoteBlock(q: ReportQuoteDTO): string {
  // quotes of roughly ≤8 printed lines are kept on one page; longer ones may split
  const short = Array.from(q.text).length <= 300;
  return `<blockquote class="quote${short ? ' keep' : ''}"><p>「${e(q.text)}」</p><footer>${e(q.alias)}　/　${e(q.sourceLabel)}・${e(q.paragraphLabel)}</footer></blockquote>`;
}

function findingSection(f: ReportFindingDTO): string {
  const notes = f.draftNotes.map((n) => `<p class="draft-note">${e(n)}</p>`).join('');
  const supports = f.supports.length
    ? `<div class="group"><h3 class="keep-next">支持する声 <span class="count">${f.supportsParticipants}人・${f.supportsExcerpts}引用</span></h3>${f.supports.map(quoteBlock).join('')}</div>`
    : '';
  const contradicts = f.contradicts.length
    ? `<div class="group"><h3 class="keep-next">異なる声 <span class="count">${f.contradictsParticipants}人・${f.contradictsExcerpts}引用</span></h3>${f.contradicts.map(quoteBlock).join('')}</div>`
    : '';
  const context = f.context.length
    ? `<div class="group"><h3 class="keep-next">文脈となる声</h3>${f.context.map(quoteBlock).join('')}</div>`
    : '';
  const counter =
    f.counterCheck === 'not_checked'
      ? `<div class="counter unchecked"><h3 class="keep-next">反証の確認</h3><p><strong>反証確認は未実施</strong></p>${para(f.counterNote)}</div>`
      : `<div class="counter"><h3 class="keep-next">反証の確認</h3><p>${e(f.counterCheckLabel)}</p>${para(f.counterNote)}</div>`;
  const expected = f.expectedChange.trim() ? `<p class="expected"><span>期待する変化：</span>${e(f.expectedChange)}</p>` : '';
  return `<section class="finding">
<div class="finding-head keep-next"><span class="num">${pad2(f.no)}</span><h2>${e(f.title)}</h2></div>
${notes}
<h3 class="keep-next">観察と解釈</h3>${para(f.interpretation)}
${supports}${contradicts}${context}${counter}
<div class="proposal"><h3 class="keep-next">次の一手（改善案）</h3>${para(f.proposal)}${expected}</div>
<h3 class="keep-next">次に確かめること</h3>${para(f.nextCheck)}
</section>`;
}

const CSS = `
:root{--ink:#402A3D;--muted:#71666D;--line:#C7BDC0;--apricot:#F1AD7F;--paper:#F2EEE5;--surface:#FFFCF6;--moss:#334A42;--error:#A22E38}
*{box-sizing:border-box}
html{background:var(--paper)}
body{margin:0;color:var(--ink);font-family:KoeitoSans,"Noto Sans JP","Yu Gothic","Hiragino Sans",sans-serif;font-size:16px;line-height:1.85}
.doc{max-width:794px;margin:32px auto;background:var(--surface);padding:72px 76px;box-shadow:0 12px 32px rgba(64,42,61,.09)}
h1,h2,h3{font-family:KoeitoSerif,"Noto Serif JP","Yu Mincho","Hiragino Mincho ProN",serif;letter-spacing:.015em}
h1{font-size:34px;line-height:1.45;font-weight:600;margin:8px 0 24px}
h2{font-size:24px;line-height:1.5;font-weight:600;margin:0}
h3{font-size:15px;line-height:1.6;font-weight:600;margin:22px 0 8px;font-family:KoeitoSans,"Noto Sans JP",sans-serif}
.kicker{font-size:12px;letter-spacing:.1em;color:var(--muted);margin:0}
.draft-banner{border:2px solid var(--error);color:var(--error);padding:8px 12px;font-weight:700;margin:0 0 16px}
.draft-note{border-left:3px solid var(--error);padding:2px 10px;color:var(--error);font-size:.92em;margin:8px 0}
dl.meta{display:grid;grid-template-columns:7.5em 1fr;gap:4px 16px;margin:0 0 24px;border-top:2px solid var(--ink);padding-top:16px}
dl.meta dt{color:var(--muted)}dl.meta dd{margin:0}
.text{white-space:pre-wrap;margin:0 0 8px;overflow-wrap:anywhere}
.limits{border-top:1px solid var(--line);padding-top:8px}
.note{color:var(--muted);font-size:.9em}
.finding{border-top:2px solid var(--ink);margin-top:40px;padding-top:20px}
.finding-head{display:grid;grid-template-columns:64px 1fr;gap:12px;align-items:baseline}
.num{font-family:KoeitoBrand,Georgia,serif;font-size:40px;line-height:1;letter-spacing:-.04em}
.count{font-weight:400;color:var(--muted);font-size:.9em;margin-left:8px}
blockquote.quote{margin:8px 0 12px;padding:4px 0 4px 16px;border-left:1px solid var(--line)}
blockquote.quote p{font-family:KoeitoSerif,"Noto Serif JP",serif;margin:0;white-space:pre-wrap;overflow-wrap:anywhere}
blockquote.quote footer{font-size:12px;color:var(--muted);letter-spacing:.04em}
.counter.unchecked strong{color:var(--ink);border-bottom:2px solid var(--apricot)}
.proposal{background:#E9E1E7;border-left:3px solid var(--ink);padding:4px 18px 10px;margin-top:20px}
.expected span{font-weight:600}
.legend{border-top:1px solid var(--line);margin-top:40px;padding-top:8px;font-size:12px;color:var(--muted)}
.keep-next{break-after:avoid;page-break-after:avoid}
@media (max-width:640px){.doc{margin:0;padding:28px 20px;box-shadow:none}h1{font-size:26px}h2{font-size:20px}.finding-head{grid-template-columns:44px 1fr}.num{font-size:30px}dl.meta{grid-template-columns:1fr}}
@page{size:A4 portrait;margin:18mm 20mm 18mm 20mm}
@media print{
 html,body{background:#fff}
 body{font-size:10.5pt;line-height:1.7}
 .doc{max-width:none;margin:0;padding:0;box-shadow:none;background:#fff}
 h1{font-size:28pt;line-height:1.35}
 h2{font-size:18pt;line-height:1.4}
 h3{font-size:10.5pt}
 .num{font-size:26pt}
 .finding-head{grid-template-columns:16mm 1fr}
 blockquote.quote footer,.legend,.kicker{font-size:8.5pt}
 blockquote.keep{break-inside:avoid;page-break-inside:avoid}
 .proposal{-webkit-print-color-adjust:exact;print-color-adjust:exact}
 p{orphans:3;widows:3}
}
`;

function fontFaces(fonts: EmbeddedFont[]): string {
  return fonts
    .map((f) => `@font-face{font-family:${f.family};src:url(data:font/ttf;base64,${f.dataB64}) format("truetype");font-weight:100 900;font-display:block}`)
    .join('\n');
}

export function renderReportHtml(dto: ReportDTO, fonts: EmbeddedFont[] = []): string {
  const period =
    dto.periodStart || dto.periodEnd ? `${e(dto.periodStart ?? '未設定')} 〜 ${e(dto.periodEnd ?? '未設定')}` : '未設定';
  const missing = dto.draft
    ? `<p class="draft-banner">草案・根拠未確認 — この文書は正式な提出物ではありません。</p>`
    : '';
  const findings = dto.findings.length
    ? dto.findings.map(findingSection).join('\n')
    : `<section class="finding"><p>採用した気づきなし</p></section>`;
  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; font-src data:; base-uri 'none'; form-action 'none'">
<meta name="referrer" content="no-referrer">
<title>${dto.draft ? '【草案】' : ''}${e(dto.title)}</title>
<style>${fontFaces(fonts)}
${CSS}</style>
</head>
<body>
<article class="doc">
<header class="cover">
${missing}
<p class="kicker">改善提案レポート</p>
<h1>${e(dto.title)}</h1>
<dl class="meta">
<dt>調査の問い</dt><dd class="text">${e(dto.question)}</dd>
<dt>実施期間</dt><dd>${period}</dd>
<dt>資料数</dt><dd>${dto.sourceCount}件</dd>
<dt>参加者</dt><dd>${dto.participantCount}人（別名で表記）</dd>
<dt>作成日</dt><dd>${e(dto.createdDate)}</dd>
</dl>
<section class="limits"><h3>調査の範囲と限界</h3>${para(dto.limitations) || '<p class="text">未記入</p>'}
<p class="note">本レポートの引用は参加者の発言の一部です。件数は回答者の中での数で、母集団の割合や確からしさを示すものではありません。</p></section>
</header>
${findings}
<p class="legend">引用・出典の読み方：P02＝参加者の別名、S02＝資料番号、P001＝資料内の段落番号。</p>
</article>
</body>
</html>
`;
}
