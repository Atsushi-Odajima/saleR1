import type { EvidenceLink, Excerpt, Finding, Source } from './schema';

export interface EvidenceCounts {
  supportsExcerpts: number;
  supportsParticipants: number;
  contradictsExcerpts: number;
  contradictsParticipants: number;
  contextExcerpts: number;
}

/**
 * 支持した人数 = distinct participantId over "supports" links only.
 * context / contradicts are never mixed into the support counts.
 */
export function evidenceCounts(
  findingId: string,
  links: EvidenceLink[],
  excerptById: Map<string, Pick<Excerpt, 'sourceId'>>,
  sourceById: Map<string, Pick<Source, 'participantId'>>,
): EvidenceCounts {
  const sup = new Set<string>();
  const con = new Set<string>();
  let s = 0, c = 0, x = 0;
  for (const l of links) {
    if (l.findingId !== findingId) continue;
    const ex = excerptById.get(l.excerptId);
    const src = ex ? sourceById.get(ex.sourceId) : undefined;
    if (!ex || !src) continue;
    if (l.role === 'supports') { s++; sup.add(src.participantId); }
    else if (l.role === 'contradicts') { c++; con.add(src.participantId); }
    else x++;
  }
  return { supportsExcerpts: s, supportsParticipants: sup.size, contradictsExcerpts: c, contradictsParticipants: con.size, contextExcerpts: x };
}

export type ReadinessIssue =
  | 'title'
  | 'interpretation'
  | 'proposal'
  | 'nextCheck'
  | 'supports'
  | 'counterNote'
  | 'contradicts';

export const READINESS_LABEL: Record<ReadinessIssue, string> = {
  title: '見出しが空です',
  interpretation: '観察と解釈が空です',
  proposal: '改善案が空です',
  nextCheck: '次に確認することが空です',
  supports: '支持する引用が1件以上必要です',
  counterNote: '反証確認のメモが必要です',
  contradicts: '「異なる声あり」の場合は異なる声の引用が1件以上必要です',
};

const blank = (s: string) => s.trim().length === 0;

export function readinessIssues(f: Finding, counts: Pick<EvidenceCounts, 'supportsExcerpts' | 'contradictsExcerpts'>): ReadinessIssue[] {
  const out: ReadinessIssue[] = [];
  if (blank(f.title)) out.push('title');
  if (blank(f.interpretation)) out.push('interpretation');
  if (blank(f.proposal)) out.push('proposal');
  if (blank(f.nextCheck)) out.push('nextCheck');
  if (counts.supportsExcerpts < 1) out.push('supports');
  if ((f.counterCheck === 'none_found' || f.counterCheck === 'found') && blank(f.counterNote)) out.push('counterNote');
  if (f.counterCheck === 'found' && counts.contradictsExcerpts < 1) out.push('contradicts');
  return out;
}

export const COUNTER_CHECK_LABEL = {
  not_checked: '反証確認は未実施',
  none_found: '確認したが異なる声は見つからなかった',
  found: '異なる声あり',
} as const;
