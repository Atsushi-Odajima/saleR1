// AC02 counts, readiness, AC09 (report part): no private values in HTML/CSV
import { describe, it, expect } from 'vitest';
import { evidenceCounts, readinessIssues } from '../../src/domain/finding';
import { assembleReport } from '../../src/domain/report';
import { renderReportHtml } from '../../src/domain/reportHtml';
import type { EvidenceLink, Excerpt, Finding, Participant, Project, Source } from '../../src/domain/schema';
import { publicQuote, publicReviewHash } from '../../src/domain/excerpt';

const T = '2026-10-01T00:00:00.000Z';
const m = { createdAt: T, updatedAt: T, revision: 1 };
const PID = '10000000-0000-4000-8000-000000000000';
const u = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function link(id: number, findingId: string, excerptId: string, role: EvidenceLink['role']): EvidenceLink {
  return { ...m, id: u(id), projectId: PID, findingId, excerptId, role, order: id };
}

describe('AC02 evidence counts', () => {
  it('P01×2 + P02×1 supports = 3 quotes / 2 people; P03 contradicts excluded', () => {
    const sources = new Map([
      ['s1', { participantId: 'P01' }],
      ['s2', { participantId: 'P01' }],
      ['s3', { participantId: 'P02' }],
      ['s4', { participantId: 'P03' }],
    ]);
    const excerpts = new Map([
      ['e1', { sourceId: 's1' }],
      ['e2', { sourceId: 's2' }],
      ['e3', { sourceId: 's3' }],
      ['e4', { sourceId: 's4' }],
    ]);
    const links = [link(1, 'f', 'e1', 'supports'), link(2, 'f', 'e2', 'supports'), link(3, 'f', 'e3', 'supports'), link(4, 'f', 'e4', 'contradicts')];
    const c = evidenceCounts('f', links, excerpts, sources);
    expect(c.supportsExcerpts).toBe(3);
    expect(c.supportsParticipants).toBe(2);
    expect(c.contradictsExcerpts).toBe(1);
    expect(c.contradictsParticipants).toBe(1);
  });
});

const baseFinding: Finding = {
  ...m, id: u(900), projectId: PID, title: '見出し', interpretation: '解釈', proposal: '提案', expectedChange: '', nextCheck: '次', counterCheck: 'not_checked', counterNote: '', status: 'ready', included: true, order: 1,
};

describe('readiness', () => {
  it('requires fields, supports, counter note, contradicts for found', () => {
    expect(readinessIssues(baseFinding, { supportsExcerpts: 1, contradictsExcerpts: 0 })).toEqual([]);
    expect(readinessIssues({ ...baseFinding, title: ' ', nextCheck: '' }, { supportsExcerpts: 0, contradictsExcerpts: 0 })).toEqual(['title', 'nextCheck', 'supports']);
    expect(readinessIssues({ ...baseFinding, counterCheck: 'none_found' }, { supportsExcerpts: 1, contradictsExcerpts: 0 })).toEqual(['counterNote']);
    expect(readinessIssues({ ...baseFinding, counterCheck: 'found', counterNote: 'x' }, { supportsExcerpts: 1, contradictsExcerpts: 0 })).toEqual(['contradicts']);
  });
});

async function fixture() {
  const SECRET_TEXT = 'SECRET_SOURCE_A';
  const text = `公開してよい発言です。${SECRET_TEXT}は伏せます。\n本名テスト値 山田太郎 さんの話。\n別の段落。`;
  const project: Project = { ...m, id: PID, title: '調査タイトル', question: '問い', periodStart: '2026-09-01', periodEnd: null, limitations: '限界', nextSourceNo: 2, nextParticipantNo: 2 };
  const participant: Participant = { ...m, id: u(1), projectId: PID, alias: 'P01', internalNote: 'SECRET_NOTE_B 本名テスト値 山田太郎' };
  const source: Source = { ...m, id: u(2), projectId: PID, sourceNo: 1, participantId: u(1), title: '山田太郎インタビュー', originalFilename: 'yamada_taro_SECRET.txt', text, sha256: 'a'.repeat(64), importBatchId: u(3) };
  const q1 = `公開してよい発言です。${SECRET_TEXT}は伏せます。`;
  const red = [{ startUtf16: q1.indexOf(SECRET_TEXT), endUtf16: q1.indexOf(SECRET_TEXT) + SECRET_TEXT.length }];
  const ex1: Excerpt = { ...m, id: u(4), projectId: PID, sourceId: u(2), startUtf16: 0, endUtf16: q1.length, quote: q1, themeIds: [], note: 'SECRET_NOTE_B', redactions: red, publicReviewedHash: null };
  const q2 = '本名テスト値 山田太郎 さんの話。';
  const s2 = text.indexOf(q2);
  const ex2: Excerpt = { ...m, id: u(5), projectId: PID, sourceId: u(2), startUtf16: s2, endUtf16: s2 + q2.length, quote: q2, themeIds: [], note: '', redactions: [{ startUtf16: 0, endUtf16: '本名テスト値 山田太郎'.length }], publicReviewedHash: null };
  for (const e of [ex1, ex2]) {
    e.publicReviewedHash = await publicReviewHash({ publicText: publicQuote(e.quote, e.redactions), alias: 'P01', sourceNo: 1, startUtf16: e.startUtf16, endUtf16: e.endUtf16 });
  }
  const finding: Finding = { ...baseFinding, id: u(6) };
  const links = [link(7, u(6), u(4), 'supports'), link(8, u(6), u(5), 'context')];
  return { project, participants: [participant], sources: [source], excerpts: [ex1, ex2], themes: [], findings: [finding], evidenceLinks: links };
}

describe('report', () => {
  it('formal report passes and contains no private values (AC09)', async () => {
    const input = await fixture();
    const { dto, blockers } = await assembleReport(input, { draft: false });
    expect(blockers).toEqual([]);
    const html = renderReportHtml(dto);
    for (const secret of ['SECRET_SOURCE_A', 'SECRET_NOTE_B', '山田太郎', '本名テスト値', 'yamada', '山田太郎インタビュー']) {
      expect(html).not.toContain(secret);
      expect(JSON.stringify(dto)).not.toContain(secret);
    }
    expect(html).toContain('［伏字］');
    expect(html).toContain('P01　/　S01・P001');
    expect(html).toContain('反証確認は未実施');
    expect(html).not.toMatch(/<script|\son[a-z]+\s*=|https?:\/\/|<iframe|<img/i);
  });
  it('changing a redaction after review blocks the formal report', async () => {
    const input = await fixture();
    input.excerpts[0] = { ...input.excerpts[0]!, redactions: [] };
    const { blockers } = await assembleReport(input, { draft: false });
    expect(blockers.map((b) => b.kind)).toContain('review_needed');
  });
  it('changing the alias invalidates the review', async () => {
    const input = await fixture();
    input.participants[0] = { ...input.participants[0]!, alias: 'P09' };
    const { blockers } = await assembleReport(input, { draft: false });
    expect(blockers.filter((b) => b.kind === 'review_needed')).toHaveLength(2);
  });
  it('anchor drift blocks formal output and is excluded from draft', async () => {
    const input = await fixture();
    input.excerpts[0] = { ...input.excerpts[0]!, quote: input.excerpts[0]!.quote + 'x' };
    const formal = await assembleReport(input, { draft: false });
    expect(formal.blockers.map((b) => b.kind)).toContain('anchor_broken');
    const draft = await assembleReport(input, { draft: true });
    expect(renderReportHtml(draft.dto)).toContain('草案・根拠未確認');
  });
  it('escapes HTML in user strings', async () => {
    const input = await fixture();
    input.project = { ...input.project, title: '<img src=x onerror=alert(1)>' };
    const { dto } = await assembleReport(input, { draft: true });
    const html = renderReportHtml(dto);
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).not.toContain('<img');
  });
  it('no included findings / missing limitations block formal', async () => {
    const input = await fixture();
    input.findings = [{ ...input.findings[0]!, included: false }];
    input.project = { ...input.project, limitations: '' };
    const { blockers } = await assembleReport(input, { draft: false });
    expect(blockers.map((b) => b.kind).sort()).toEqual(['limitations', 'no_findings']);
  });
});
