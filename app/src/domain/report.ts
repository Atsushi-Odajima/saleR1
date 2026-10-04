// Report assembly. The DTO is built from an explicit allow-list; database rows
// are never spread into it. Only public strings leave this module.
import type { EvidenceLink, Excerpt, Finding, Participant, Project, Source, Theme } from './schema';
import { evidenceCounts, readinessIssues, READINESS_LABEL, COUNTER_CHECK_LABEL } from './finding';
import { excerptAnchorIntact, publicQuote, publicReviewHash, excerptParagraphNo } from './excerpt';
import { formatParagraphNo, formatSourceNo } from './text';

export interface ReportQuoteDTO {
  text: string;
  alias: string;
  sourceLabel: string;
  paragraphLabel: string;
}

export interface ReportFindingDTO {
  no: number;
  title: string;
  interpretation: string;
  proposal: string;
  expectedChange: string;
  nextCheck: string;
  counterCheckLabel: string;
  counterCheck: Finding['counterCheck'];
  counterNote: string;
  supports: ReportQuoteDTO[];
  contradicts: ReportQuoteDTO[];
  context: ReportQuoteDTO[];
  supportsExcerpts: number;
  supportsParticipants: number;
  contradictsExcerpts: number;
  contradictsParticipants: number;
  /** draft-only notes describing what is missing */
  draftNotes: string[];
}

export interface ReportDTO {
  draft: boolean;
  title: string;
  question: string;
  periodStart: string | null;
  periodEnd: string | null;
  limitations: string;
  sourceCount: number;
  participantCount: number;
  findings: ReportFindingDTO[];
  createdDate: string;
}

export interface ReportBlocker {
  kind: 'no_findings' | 'finding_not_ready' | 'anchor_broken' | 'review_needed' | 'limitations' | 'question';
  message: string;
  findingId?: string;
  excerptId?: string;
}

export interface ReportInput {
  project: Project;
  participants: Participant[];
  sources: Source[];
  excerpts: Excerpt[];
  themes: Theme[];
  findings: Finding[];
  evidenceLinks: EvidenceLink[];
}

export interface ExcerptPublicInfo {
  excerpt: Excerpt;
  source: Source | undefined;
  alias: string;
  publicText: string;
  currentHash: string | null;
  anchorOk: boolean;
  reviewed: boolean;
}

export async function excerptPublicInfo(ex: Excerpt, sourceById: Map<string, Source>, participantById: Map<string, Participant>): Promise<ExcerptPublicInfo> {
  const source = sourceById.get(ex.sourceId);
  const alias = source ? participantById.get(source.participantId)?.alias ?? '' : '';
  const anchorOk = !!source && excerptAnchorIntact(source, ex);
  const text = publicQuote(ex.quote, ex.redactions);
  const currentHash = source
    ? await publicReviewHash({ publicText: text, alias, sourceNo: source.sourceNo, startUtf16: ex.startUtf16, endUtf16: ex.endUtf16 })
    : null;
  return { excerpt: ex, source, alias, publicText: text, currentHash, anchorOk, reviewed: !!currentHash && ex.publicReviewedHash === currentHash };
}

function localDate(d: Date): string {
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

export async function assembleReport(input: ReportInput, opts: { draft: boolean; now?: Date }): Promise<{ dto: ReportDTO; blockers: ReportBlocker[] }> {
  const { project } = input;
  const sourceById = new Map(input.sources.map((s) => [s.id, s]));
  const participantById = new Map(input.participants.map((p) => [p.id, p]));
  const excerptById = new Map(input.excerpts.map((e) => [e.id, e]));
  const blockers: ReportBlocker[] = [];

  if (project.question.trim() === '') blockers.push({ kind: 'question', message: '調査の問いが空です' });
  if (project.limitations.trim() === '') blockers.push({ kind: 'limitations', message: '調査の限界が未記入です' });

  const included = input.findings.filter((f) => f.included).sort((a, b) => a.order - b.order);
  if (included.length === 0) blockers.push({ kind: 'no_findings', message: '提案書に採用した気づきがありません' });

  const infoCache = new Map<string, ExcerptPublicInfo>();
  const findings: ReportFindingDTO[] = [];
  let no = 0;
  for (const f of included) {
    no++;
    const links = input.evidenceLinks.filter((l) => l.findingId === f.id).sort((a, b) => a.order - b.order);
    const counts = evidenceCounts(f.id, links, excerptById, sourceById);
    const issues = readinessIssues(f, counts);
    const draftNotes: string[] = [];
    if (f.status !== 'ready' || issues.length > 0) {
      const msg = issues.length ? issues.map((i) => READINESS_LABEL[i]).join('／') : '「提出可」になっていません';
      blockers.push({ kind: 'finding_not_ready', message: `気づき${String(no).padStart(2, '0')}「${f.title}」: ${msg}`, findingId: f.id });
      draftNotes.push('草案・根拠未確認：' + msg);
    }
    const groups: Record<'supports' | 'contradicts' | 'context', ReportQuoteDTO[]> = { supports: [], contradicts: [], context: [] };
    for (const l of links) {
      const ex = excerptById.get(l.excerptId);
      if (!ex) continue;
      let info = infoCache.get(ex.id);
      if (!info) {
        info = await excerptPublicInfo(ex, sourceById, participantById);
        infoCache.set(ex.id, info);
      }
      if (!info.anchorOk || !info.source) {
        blockers.push({ kind: 'anchor_broken', message: `引用の原文位置が一致しません（気づき${String(no).padStart(2, '0')}）`, findingId: f.id, excerptId: ex.id });
        draftNotes.push('原文位置を確認できない引用を除外しました');
        continue;
      }
      if (!info.reviewed) {
        blockers.push({ kind: 'review_needed', message: `公開用の引用が未確認です（${info.alias} / ${formatSourceNo(info.source.sourceNo)}）`, findingId: f.id, excerptId: ex.id });
        if (!draftNotes.includes('公開内容が未確認の引用があります')) draftNotes.push('公開内容が未確認の引用があります');
      }
      groups[l.role].push({
        text: info.publicText,
        alias: info.alias,
        sourceLabel: formatSourceNo(info.source.sourceNo),
        paragraphLabel: formatParagraphNo(excerptParagraphNo(info.source, ex)),
      });
    }
    findings.push({
      no,
      title: f.title,
      interpretation: f.interpretation,
      proposal: f.proposal,
      expectedChange: f.expectedChange,
      nextCheck: f.nextCheck,
      counterCheck: f.counterCheck,
      counterCheckLabel: COUNTER_CHECK_LABEL[f.counterCheck],
      counterNote: f.counterNote,
      supports: groups.supports,
      contradicts: groups.contradicts,
      context: groups.context,
      supportsExcerpts: counts.supportsExcerpts,
      supportsParticipants: counts.supportsParticipants,
      contradictsExcerpts: counts.contradictsExcerpts,
      contradictsParticipants: counts.contradictsParticipants,
      draftNotes: opts.draft ? draftNotes : [],
    });
  }

  const usedParticipants = new Set(input.sources.map((s) => s.participantId));
  const dto: ReportDTO = {
    draft: opts.draft,
    title: project.title,
    question: project.question,
    periodStart: project.periodStart,
    periodEnd: project.periodEnd,
    limitations: project.limitations,
    sourceCount: input.sources.length,
    participantCount: usedParticipants.size,
    findings,
    createdDate: localDate(opts.now ?? new Date()),
  };
  return { dto, blockers };
}

/** Collect every string that will be printed (for font subsetting). */
export function reportStrings(dto: ReportDTO): string {
  const parts: string[] = [dto.title, dto.question, dto.limitations, dto.createdDate, dto.periodStart ?? '', dto.periodEnd ?? ''];
  for (const f of dto.findings) {
    parts.push(f.title, f.interpretation, f.proposal, f.expectedChange, f.nextCheck, f.counterNote, f.counterCheckLabel, ...f.draftNotes);
    for (const q of [...f.supports, ...f.contradicts, ...f.context]) parts.push(q.text, q.alias, q.sourceLabel, q.paragraphLabel);
  }
  return parts.join('\n');
}
