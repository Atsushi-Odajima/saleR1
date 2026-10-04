import { useLiveQuery } from 'dexie-react-hooks';
import type { Repo } from '../db/repo';
import type { EvidenceLink, Excerpt, Finding, Participant, Project, Source, Theme } from '../domain/schema';

export interface ProjectData {
  project: Project;
  participants: Participant[];
  sources: Source[];
  excerpts: Excerpt[];
  themes: Theme[];
  findings: Finding[];
  links: EvidenceLink[];
  participantById: Map<string, Participant>;
  sourceById: Map<string, Source>;
  excerptById: Map<string, Excerpt>;
  themeById: Map<string, Theme>;
}

/** Live view of one project. `null` = not found, `undefined` = loading. */
export function useProjectData(repo: Repo, pid: string, epoch: number): ProjectData | null | undefined {
  return useLiveQuery(
    async () => {
      const db = repo.db;
      return db.transaction('r', ['projects', 'participants', 'sources', 'excerpts', 'themes', 'findings', 'evidenceLinks'], async () => {
        const project = await db.projects.get(pid);
        if (!project) return null;
        const [participants, sources, excerpts, themes, findings, links] = await Promise.all([
          db.participants.where('projectId').equals(pid).toArray(),
          db.sources.where('projectId').equals(pid).toArray(),
          db.excerpts.where('projectId').equals(pid).toArray(),
          db.themes.where('projectId').equals(pid).toArray(),
          db.findings.where('projectId').equals(pid).toArray(),
          db.evidenceLinks.where('projectId').equals(pid).toArray(),
        ]);
        participants.sort((a, b) => a.alias.localeCompare(b.alias, 'ja', { numeric: true }));
        sources.sort((a, b) => a.sourceNo - b.sourceNo);
        themes.sort((a, b) => a.order - b.order);
        findings.sort((a, b) => a.order - b.order);
        links.sort((a, b) => a.order - b.order);
        const sourceNo = new Map(sources.map((s) => [s.id, s.sourceNo]));
        excerpts.sort((a, b) => (sourceNo.get(a.sourceId)! - sourceNo.get(b.sourceId)!) || a.startUtf16 - b.startUtf16 || a.endUtf16 - b.endUtf16);
        return {
          project,
          participants,
          sources,
          excerpts,
          themes,
          findings,
          links,
          participantById: new Map(participants.map((x) => [x.id, x])),
          sourceById: new Map(sources.map((x) => [x.id, x])),
          excerptById: new Map(excerpts.map((x) => [x.id, x])),
          themeById: new Map(themes.map((x) => [x.id, x])),
        } satisfies ProjectData;
      });
    },
    [repo, pid, epoch],
  );
}

export function aliasOfExcerpt(d: ProjectData, e: Excerpt): string {
  const s = d.sourceById.get(e.sourceId);
  return s ? d.participantById.get(s.participantId)?.alias ?? '?' : '?';
}
