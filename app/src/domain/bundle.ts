// Referential / offset / limit validation for a set of project rows (backup restore, fixtures).
import type { ProjectBundle } from './schema';
import { excerptAnchorIntact, normalizeRedactions } from './excerpt';
import { cpLength, BoundarySet } from './text';
import { LIMITS } from './limits';

export function validateBundle(b: ProjectBundle): string[] {
  const problems: string[] = [];
  const all = [...b.projects, ...b.participants, ...b.sources, ...b.excerpts, ...b.themes, ...b.findings, ...b.evidenceLinks];
  const ids = new Set<string>();
  for (const r of all) {
    if (ids.has(r.id)) problems.push('duplicate id ' + r.id);
    ids.add(r.id);
  }
  const projectIds = new Set(b.projects.map((p) => p.id));
  const participants = new Map(b.participants.map((p) => [p.id, p]));
  const sources = new Map(b.sources.map((s) => [s.id, s]));
  const excerpts = new Map(b.excerpts.map((e) => [e.id, e]));
  const themes = new Map(b.themes.map((t) => [t.id, t]));
  const findings = new Map(b.findings.map((f) => [f.id, f]));
  const inProject = (pid: string, what: string) => {
    if (!projectIds.has(pid)) problems.push(`${what}: unknown project`);
  };
  for (const p of b.participants) inProject(p.projectId, 'participant');
  for (const t of b.themes) inProject(t.projectId, 'theme');
  for (const f of b.findings) inProject(f.projectId, 'finding');
  for (const s of b.sources) {
    inProject(s.projectId, 'source');
    const part = participants.get(s.participantId);
    if (!part || part.projectId !== s.projectId) problems.push('source: bad participant');
  }
  for (const e of b.excerpts) {
    inProject(e.projectId, 'excerpt');
    const s = sources.get(e.sourceId);
    if (!s || s.projectId !== e.projectId) {
      problems.push('excerpt: bad source');
      continue;
    }
    if (!excerptAnchorIntact(s, e)) problems.push('excerpt: anchor mismatch');
    else {
      const bs = new BoundarySet(s.text);
      if (!bs.has(e.startUtf16) || !bs.has(e.endUtf16)) problems.push('excerpt: not grapheme boundary');
    }
    const nr = normalizeRedactions(e.quote, e.redactions);
    if (!nr.ok || JSON.stringify(nr.ranges) !== JSON.stringify(e.redactions)) problems.push('excerpt: redactions not normalized');
    for (const t of e.themeIds) {
      const th = themes.get(t);
      if (!th || th.projectId !== e.projectId) problems.push('excerpt: bad theme');
    }
  }
  const pairs = new Set<string>();
  for (const l of b.evidenceLinks) {
    inProject(l.projectId, 'link');
    const f = findings.get(l.findingId);
    const e = excerpts.get(l.excerptId);
    if (!f || f.projectId !== l.projectId || !e || e.projectId !== l.projectId) problems.push('link: bad reference');
    const k = l.findingId + '|' + l.excerptId;
    if (pairs.has(k)) problems.push('link: duplicate finding+excerpt');
    pairs.add(k);
  }
  for (const p of b.projects) {
    const srcs = b.sources.filter((s) => s.projectId === p.id);
    const count = (arr: Array<{ projectId: string }>) => arr.filter((x) => x.projectId === p.id).length;
    if (srcs.length > LIMITS.sourcesPerProject) problems.push('limit: sources');
    if (count(b.participants) > LIMITS.participantsPerProject) problems.push('limit: participants');
    if (count(b.excerpts) > LIMITS.excerptsPerProject) problems.push('limit: excerpts');
    if (count(b.themes) > LIMITS.themesPerProject) problems.push('limit: themes');
    if (count(b.findings) > LIMITS.findingsPerProject) problems.push('limit: findings');
    if (srcs.reduce((n, s) => n + cpLength(s.text), 0) > LIMITS.textCodePointsPerProject) problems.push('limit: text');
    const nos = new Set<number>();
    for (const s of srcs) {
      if (nos.has(s.sourceNo)) problems.push('source: duplicate sourceNo');
      nos.add(s.sourceNo);
      if (s.sourceNo >= p.nextSourceNo) problems.push('source: sourceNo >= nextSourceNo');
    }
    const aliases = new Set<string>();
    for (const pa of b.participants.filter((x) => x.projectId === p.id)) {
      if (aliases.has(pa.alias)) problems.push('participant: duplicate alias');
      aliases.add(pa.alias);
    }
  }
  return problems;
}
