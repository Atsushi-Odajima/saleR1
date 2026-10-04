// Builds the deliverable HTML (and CSV) from the database. Nothing here writes to the DB.
import hbWasmUrl from 'harfbuzzjs/dist/harfbuzz-subset.wasm?url';
import type { Repo } from '../db/repo';
import { assembleReport, reportStrings, type ReportBlocker, type ReportDTO } from '../domain/report';
import { renderReportHtml, REPORT_STATIC_TEXT, type EmbeddedFont } from '../domain/reportHtml';
import { bytesToB64 } from '../domain/hash';
import { loadHarfbuzz, subsetFont } from '../platform/fontSubset';
import { excerptsCsv, type ExcerptCsvRow } from '../domain/csvExport';
import { publicQuote } from '../domain/excerpt';
import { formatParagraphNo, formatSourceNo, paragraphNoAt } from '../domain/text';

const fontCache = new Map<string, Promise<Uint8Array>>();
function fontBytes(file: string): Promise<Uint8Array> {
  let p = fontCache.get(file);
  if (!p) {
    p = fetch(new URL(`fonts/${file}`, document.baseURI)).then(async (r) => {
      if (!r.ok) throw new Error('font_fetch');
      return new Uint8Array(await r.arrayBuffer());
    });
    p.catch(() => fontCache.delete(file));
    fontCache.set(file, p);
  }
  return p;
}

export async function embeddedFonts(dto: ReportDTO): Promise<EmbeddedFont[]> {
  const hb = await loadHarfbuzz(async () => {
    const r = await fetch(hbWasmUrl);
    if (!r.ok) throw new Error('wasm_fetch');
    return r.arrayBuffer();
  });
  const text = reportStrings(dto) + REPORT_STATIC_TEXT;
  const [serif, sans, brand] = await Promise.all([fontBytes('NotoSerifJP.ttf'), fontBytes('NotoSansJP.ttf'), fontBytes('Fraunces.ttf')]);
  return [
    { family: 'KoeitoSerif', dataB64: bytesToB64(subsetFont(hb, serif, text)) },
    { family: 'KoeitoSans', dataB64: bytesToB64(subsetFont(hb, sans, text)) },
    { family: 'KoeitoBrand', dataB64: bytesToB64(subsetFont(hb, brand, '0123456789')) },
  ];
}

export async function buildReport(repo: Repo, pid: string, draft: boolean): Promise<{ html: string | null; blockers: ReportBlocker[]; dto: ReportDTO }> {
  const b = await repo.getBundle([pid]);
  const project = b.projects[0];
  if (!project) throw new Error('not_found');
  const { dto, blockers } = await assembleReport({ project, participants: b.participants, sources: b.sources, excerpts: b.excerpts, themes: b.themes, findings: b.findings, evidenceLinks: b.evidenceLinks }, { draft });
  if (!draft && blockers.length) return { html: null, blockers, dto };
  let fonts: EmbeddedFont[] = [];
  try {
    fonts = await embeddedFonts(dto);
  } catch {
    // fall back to system fonts rather than failing the export
    fonts = [];
  }
  return { html: renderReportHtml(dto, fonts), blockers, dto };
}

export async function buildExcerptCsv(repo: Repo, pid: string): Promise<{ csv: string; unreviewedHint: number }> {
  const b = await repo.getBundle([pid]);
  const src = new Map(b.sources.map((s) => [s.id, s]));
  const part = new Map(b.participants.map((p) => [p.id, p]));
  const th = new Map(b.themes.map((t) => [t.id, t]));
  const rows: ExcerptCsvRow[] = [];
  const sorted = [...b.excerpts].sort((x, y) => (src.get(x.sourceId)!.sourceNo - src.get(y.sourceId)!.sourceNo) || x.startUtf16 - y.startUtf16);
  let unreviewed = 0;
  for (const e of sorted) {
    const s = src.get(e.sourceId);
    if (!s || s.text.slice(e.startUtf16, e.endUtf16) !== e.quote) continue; // broken anchors are never exported
    if (!e.publicReviewedHash) unreviewed++;
    rows.push({
      alias: part.get(s.participantId)?.alias ?? '',
      sourceLabel: formatSourceNo(s.sourceNo),
      paragraphLabel: formatParagraphNo(paragraphNoAt(s.text, e.startUtf16)),
      publicQuote: publicQuote(e.quote, e.redactions),
      themeLabels: e.themeIds.map((t) => th.get(t)?.label ?? '').filter(Boolean),
    });
  }
  return { csv: excerptsCsv(rows), unreviewedHint: unreviewed };
}

export function safeFileName(title: string, ext: string, draft: boolean): string {
  const base = Array.from(title.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim()).slice(0, 60).join('') || 'koeito-report';
  const d = new Date();
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  return `${base}${draft ? '_草案' : ''}_${stamp}.${ext}`;
}
