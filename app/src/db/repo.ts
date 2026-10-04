// Repository: every structural change is one atomic Dexie transaction.
// No crypto, fetch or long waits inside transactions; hashes are computed before.
import Dexie from 'dexie';
import { KoeitoDB, PROJECT_TABLES } from './db';
import {
  SCHEMA_VERSION,
  type BackupPayload,
  type EvidenceLink,
  type EvidenceRole,
  type Excerpt,
  type ExportRecord,
  type Finding,
  type Participant,
  type Project,
  type ProjectBundle,
  type Range,
  type SettingKey,
  type Source,
  type Theme,
  ProjectSchema,
  ParticipantSchema,
  SourceSchema,
  ExcerptSchema,
  ThemeSchema,
  FindingSchema,
  EvidenceLinkSchema,
} from '../domain/schema';
import { newId, nowIso } from '../domain/ids';
import { LIMITS } from '../domain/limits';
import { cpLength, formatAliasDefault, themeKey, BoundarySet } from '../domain/text';
import { normalizeRedactions, validateExcerptRange } from '../domain/excerpt';
import { evidenceCounts, readinessIssues, READINESS_LABEL } from '../domain/finding';
import { remapBundle } from '../domain/backup';
import { validateBundle } from '../domain/bundle';
import type { z } from 'zod';

export class RepoError extends Error {
  constructor(
    public code: 'conflict' | 'limit' | 'validation' | 'not_found' | 'duplicate_excerpt' | 'readonly' | 'already_done' | 'storage',
    message: string,
    public extra?: { existingId?: string },
  ) {
    super(message);
  }
}

export type FaultKind = 'quota' | 'tx_abort' | null;

/** Turn low-level IndexedDB errors into user-facing storage errors without losing the cause. */
function wrapStorage(e: unknown): never {
  if (e instanceof RepoError) throw e;
  const name = (e as { name?: string; inner?: { name?: string } })?.name;
  const inner = (e as { inner?: { name?: string } })?.inner?.name;
  if (name === 'QuotaExceededError' || inner === 'QuotaExceededError') {
    throw new RepoError('storage', '端末の保存容量が不足しています。入力内容は画面に残っています。バックアップを保存してから容量を空けて再試行してください');
  }
  throw new RepoError('storage', '保存できませんでした。入力内容は画面に残っています。バックアップを保存してから再試行してください');
}

function check<T>(schema: z.ZodType<T>, v: unknown, what: string): T {
  const r = schema.safeParse(v);
  if (!r.success) {
    const issue = r.error.issues[0];
    throw new RepoError('validation', `${what}の内容が正しくありません（${issue?.path.join('.') ?? ''}: ${issue?.message ?? ''}）`);
  }
  return r.data;
}

export interface NewSourceInput {
  participantId?: string; // existing
  newParticipant?: { id: string; alias: string; internalNote: string };
  title: string;
  originalFilename: string | null;
  text: string;
  sha256: string;
}

export class Repo {
  /** test hook: inject storage failures */
  fault: FaultKind = null;

  constructor(
    public readonly db: KoeitoDB,
    private readonly canWrite: () => boolean,
  ) {}

  private guard() {
    if (!this.canWrite()) throw new RepoError('readonly', 'この画面は読み取り専用です（編集権がないか、ライセンスが未読込です）');
    if (this.fault === 'quota') {
      const err = new Error('quota');
      err.name = 'QuotaExceededError';
      wrapStorage(err);
    }
  }

  private async tx<T>(tables: string[], fn: () => Promise<T>): Promise<T> {
    this.guard();
    try {
      return await this.db.transaction('rw', tables, async () => {
        const r = await fn();
        if (this.fault === 'tx_abort') throw new Error('injected abort');
        return r;
      });
    } catch (e) {
      wrapStorage(e);
    }
  }

  private async touchProject(projectId: string, now = nowIso()): Promise<Project> {
    const p = await this.db.projects.get(projectId);
    if (!p) throw new RepoError('not_found', '調査が見つかりません');
    const next = { ...p, revision: p.revision + 1, updatedAt: now };
    await this.db.projects.put(next);
    return next;
  }

  // ---------- projects ----------
  async createProject(input: { id: string; title: string; question: string; periodStart: string | null; periodEnd: string | null; limitations: string }): Promise<Project> {
    const now = nowIso();
    const p = check(ProjectSchema, {
      id: input.id,
      title: input.title.trim(),
      question: input.question,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      limitations: input.limitations,
      createdAt: now,
      updatedAt: now,
      revision: 1,
      nextSourceNo: 1,
      nextParticipantNo: 1,
    }, '調査');
    return this.tx(['projects'], async () => {
      if (await this.db.projects.get(p.id)) throw new RepoError('already_done', 'この調査は作成済みです');
      if ((await this.db.projects.count()) >= LIMITS.projectsPerDevice) throw new RepoError('limit', `1端末の調査は${LIMITS.projectsPerDevice}件までです`);
      await this.db.projects.add(p);
      return p;
    });
  }

  async updateProject(id: string, expectedRevision: number, patch: Partial<Pick<Project, 'title' | 'question' | 'periodStart' | 'periodEnd' | 'limitations'>>): Promise<Project> {
    return this.tx(['projects'], async () => {
      const cur = await this.db.projects.get(id);
      if (!cur) throw new RepoError('not_found', '調査が見つかりません');
      if (cur.revision !== expectedRevision) throw new RepoError('conflict', '別の操作で調査が更新されています');
      const next = check(ProjectSchema, { ...cur, ...patch, revision: cur.revision + 1, updatedAt: nowIso() }, '調査');
      await this.db.projects.put(next);
      return next;
    });
  }

  async deleteProject(id: string): Promise<void> {
    await this.tx([...PROJECT_TABLES], async () => {
      for (const t of PROJECT_TABLES) {
        if (t === 'projects') continue;
        await this.db.table(t).where('projectId').equals(id).delete();
      }
      await this.db.projects.delete(id);
    });
  }

  // ---------- participants ----------
  async updateParticipant(id: string, expectedRevision: number, patch: { alias?: string; internalNote?: string }): Promise<Participant> {
    return this.tx(['participants', 'projects'], async () => {
      const cur = await this.db.participants.get(id);
      if (!cur) throw new RepoError('not_found', '参加者が見つかりません');
      if (cur.revision !== expectedRevision) throw new RepoError('conflict', '別の操作で参加者が更新されています');
      const next = check(ParticipantSchema, { ...cur, ...patch, alias: (patch.alias ?? cur.alias).trim(), revision: cur.revision + 1, updatedAt: nowIso() }, '参加者');
      if (next.alias !== cur.alias) {
        const clash = await this.db.participants.where('projectId').equals(cur.projectId).filter((x) => x.alias === next.alias && x.id !== id).first();
        if (clash) throw new RepoError('validation', `別名「${next.alias}」は既に使われています`);
      }
      await this.db.participants.put(next);
      await this.touchProject(cur.projectId);
      return next;
    });
  }

  async createParticipant(projectId: string, input: { id: string; alias?: string; internalNote?: string }): Promise<Participant> {
    return this.tx(['participants', 'projects'], async () => {
      const p = await this.db.projects.get(projectId);
      if (!p) throw new RepoError('not_found', '調査が見つかりません');
      if (await this.db.participants.get(input.id)) throw new RepoError('already_done', '作成済みです');
      const count = await this.db.participants.where('projectId').equals(projectId).count();
      if (count >= LIMITS.participantsPerProject) throw new RepoError('limit', `参加者は1調査${LIMITS.participantsPerProject}人までです`);
      const existing = new Set((await this.db.participants.where('projectId').equals(projectId).toArray()).map((x) => x.alias));
      let no = p.nextParticipantNo;
      let alias = input.alias?.trim();
      if (!alias) {
        while (existing.has(formatAliasDefault(no))) no++;
        alias = formatAliasDefault(no);
        no++;
      } else if (existing.has(alias)) throw new RepoError('validation', `別名「${alias}」は既に使われています`);
      const now = nowIso();
      const row = check(ParticipantSchema, { id: input.id, projectId, alias, internalNote: input.internalNote ?? '', createdAt: now, updatedAt: now, revision: 1 }, '参加者');
      await this.db.participants.add(row);
      await this.db.projects.put({ ...p, nextParticipantNo: Math.max(no, p.nextParticipantNo), revision: p.revision + 1, updatedAt: now });
      return row;
    });
  }

  async deleteParticipant(id: string): Promise<void> {
    await this.tx(['participants', 'sources', 'projects'], async () => {
      const cur = await this.db.participants.get(id);
      if (!cur) return;
      const used = await this.db.sources.where('projectId').equals(cur.projectId).filter((s) => s.participantId === id).count();
      if (used > 0) throw new RepoError('validation', 'この参加者の資料があるため削除できません。先に資料を削除してください');
      await this.db.participants.delete(id);
      await this.touchProject(cur.projectId);
    });
  }

  // ---------- sources ----------
  /** Import a batch atomically. Idempotent per importBatchId (double click protection). */
  async importSources(projectId: string, importBatchId: string, items: NewSourceInput[]): Promise<Source[]> {
    if (items.length === 0) throw new RepoError('validation', '取り込む資料がありません');
    if (items.length > LIMITS.sourcesPerImport) throw new RepoError('limit', `1回の取込は${LIMITS.sourcesPerImport}資料までです`);
    return this.tx(['projects', 'participants', 'sources'], async () => {
      const p = await this.db.projects.get(projectId);
      if (!p) throw new RepoError('not_found', '調査が見つかりません');
      if ((await this.db.sources.where('importBatchId').equals(importBatchId).count()) > 0) throw new RepoError('already_done', 'この取込は確定済みです');
      const existingSources = await this.db.sources.where('projectId').equals(projectId).toArray();
      const parts = await this.db.participants.where('projectId').equals(projectId).toArray();
      const partIds = new Set(parts.map((x) => x.id));
      const aliases = new Set(parts.map((x) => x.alias));
      const newParts = new Map<string, Participant>();
      const now = nowIso();
      let nextPartNo = p.nextParticipantNo;
      for (const it of items) {
        if (it.newParticipant && !newParts.has(it.newParticipant.id)) {
          if (partIds.has(it.newParticipant.id)) continue;
          if (aliases.has(it.newParticipant.alias)) throw new RepoError('validation', `別名「${it.newParticipant.alias}」は既に使われています`);
          aliases.add(it.newParticipant.alias);
          newParts.set(it.newParticipant.id, check(ParticipantSchema, { ...it.newParticipant, projectId, createdAt: now, updatedAt: now, revision: 1 }, '参加者'));
          const m = /^P(\d+)$/.exec(it.newParticipant.alias);
          if (m) nextPartNo = Math.max(nextPartNo, Number(m[1]) + 1);
        }
      }
      if (parts.length + newParts.size > LIMITS.participantsPerProject) throw new RepoError('limit', `参加者は1調査${LIMITS.participantsPerProject}人までです`);
      if (existingSources.length + items.length > LIMITS.sourcesPerProject) throw new RepoError('limit', `資料は1調査${LIMITS.sourcesPerProject}件までです（現在${existingSources.length}件）`);
      const total = existingSources.reduce((n, s) => n + cpLength(s.text), 0) + items.reduce((n, s) => n + cpLength(s.text), 0);
      if (total > LIMITS.textCodePointsPerProject) throw new RepoError('limit', '1調査の原文合計は100万文字までです');
      let no = p.nextSourceNo;
      const rows: Source[] = [];
      for (const it of items) {
        const participantId = it.newParticipant?.id ?? it.participantId;
        if (!participantId || (!partIds.has(participantId) && !newParts.has(participantId))) throw new RepoError('validation', '参加者の指定が正しくありません');
        rows.push(
          check(SourceSchema, {
            id: newId(),
            projectId,
            sourceNo: no++,
            participantId,
            title: it.title,
            originalFilename: it.originalFilename,
            text: it.text,
            sha256: it.sha256,
            importBatchId,
            createdAt: now,
            updatedAt: now,
            revision: 1,
          }, '資料'),
        );
      }
      await this.db.participants.bulkAdd([...newParts.values()]);
      await this.db.sources.bulkAdd(rows);
      await this.db.projects.put({ ...p, nextSourceNo: no, nextParticipantNo: nextPartNo, revision: p.revision + 1, updatedAt: now });
      return rows;
    });
  }

  async updateSource(id: string, expectedRevision: number, patch: { title?: string; participantId?: string }): Promise<Source> {
    return this.tx(['sources', 'participants', 'projects'], async () => {
      const cur = await this.db.sources.get(id);
      if (!cur) throw new RepoError('not_found', '資料が見つかりません');
      if (cur.revision !== expectedRevision) throw new RepoError('conflict', '別の操作で資料が更新されています');
      if (patch.participantId) {
        const pa = await this.db.participants.get(patch.participantId);
        if (!pa || pa.projectId !== cur.projectId) throw new RepoError('validation', '参加者が見つかりません');
      }
      // text is immutable: only title / participant may change
      const next = check(SourceSchema, { ...cur, title: patch.title ?? cur.title, participantId: patch.participantId ?? cur.participantId, revision: cur.revision + 1, updatedAt: nowIso() }, '資料');
      await this.db.sources.put(next);
      await this.touchProject(cur.projectId);
      return next;
    });
  }

  async sourceImpact(sourceId: string): Promise<{ excerpts: number; findings: number }> {
    const ex = await this.db.excerpts.where('sourceId').equals(sourceId).toArray();
    const ids = new Set(ex.map((e) => e.id));
    const links = ids.size ? await this.db.evidenceLinks.where('excerptId').anyOf([...ids]).toArray() : [];
    return { excerpts: ex.length, findings: new Set(links.map((l) => l.findingId)).size };
  }

  async excerptImpact(excerptId: string): Promise<{ findings: number }> {
    const links = await this.db.evidenceLinks.where('excerptId').equals(excerptId).toArray();
    return { findings: new Set(links.map((l) => l.findingId)).size };
  }

  /** remove excerpts + their links; findings that lose evidence go back to draft */
  private async cascadeExcerpts(excerptIds: string[], now: string) {
    if (!excerptIds.length) return;
    const links = await this.db.evidenceLinks.where('excerptId').anyOf(excerptIds).toArray();
    const affected = new Set(links.map((l) => l.findingId));
    await this.db.evidenceLinks.bulkDelete(links.map((l) => l.id));
    await this.db.excerpts.bulkDelete(excerptIds);
    for (const fid of affected) {
      const f = await this.db.findings.get(fid);
      if (f && f.status !== 'draft') await this.db.findings.put({ ...f, status: 'draft', revision: f.revision + 1, updatedAt: now });
    }
  }

  async deleteSource(id: string): Promise<void> {
    await this.tx(['sources', 'excerpts', 'evidenceLinks', 'findings', 'projects'], async () => {
      const cur = await this.db.sources.get(id);
      if (!cur) return;
      const now = nowIso();
      const ex = await this.db.excerpts.where('sourceId').equals(id).primaryKeys();
      await this.cascadeExcerpts(ex, now);
      await this.db.sources.delete(id);
      await this.touchProject(cur.projectId, now);
    });
  }

  // ---------- excerpts ----------
  async createExcerpt(input: { id: string; sourceId: string; startUtf16: number; endUtf16: number; themeIds: string[]; note: string; redactions: Range[] }): Promise<Excerpt> {
    return this.tx(['sources', 'excerpts', 'themes', 'projects'], async () => {
      const src = await this.db.sources.get(input.sourceId);
      if (!src) throw new RepoError('not_found', '資料が見つかりません');
      if (await this.db.excerpts.get(input.id)) throw new RepoError('already_done', 'この引用は保存済みです');
      const v = validateExcerptRange(src.text, input.startUtf16, input.endUtf16, new BoundarySet(src.text));
      if (!v.ok) throw new RepoError('validation', '選択範囲が正しくありません。もう一度選択してください');
      const dup = await this.db.excerpts.where('sourceId').equals(src.id).filter((e) => e.startUtf16 === input.startUtf16 && e.endUtf16 === input.endUtf16).first();
      if (dup) throw new RepoError('duplicate_excerpt', '同じ範囲の引用が既にあります', { existingId: dup.id });
      const count = await this.db.excerpts.where('projectId').equals(src.projectId).count();
      if (count >= LIMITS.excerptsPerProject) throw new RepoError('limit', `引用は1調査${LIMITS.excerptsPerProject}件までです`);
      await this.assertThemes(src.projectId, input.themeIds);
      const red = normalizeRedactions(v.quote, input.redactions);
      if (!red.ok) throw new RepoError('validation', '伏字の範囲が正しくありません');
      const now = nowIso();
      const row = check(ExcerptSchema, {
        id: input.id,
        projectId: src.projectId,
        sourceId: src.id,
        startUtf16: input.startUtf16,
        endUtf16: input.endUtf16,
        quote: v.quote,
        themeIds: [...new Set(input.themeIds)],
        note: input.note,
        redactions: red.ranges,
        publicReviewedHash: null,
        createdAt: now,
        updatedAt: now,
        revision: 1,
      }, '引用');
      await this.db.excerpts.add(row);
      await this.touchProject(src.projectId, now);
      return row;
    });
  }

  private async assertThemes(projectId: string, themeIds: string[]) {
    for (const t of themeIds) {
      const th = await this.db.themes.get(t);
      if (!th || th.projectId !== projectId) throw new RepoError('validation', 'テーマが見つかりません');
    }
  }

  /**
   * Update theme membership / note / redactions / review mark. The quote itself never changes.
   * Changing redactions clears the public review mark unless a fresh hash is supplied.
   */
  async updateExcerpt(
    id: string,
    expectedRevision: number,
    patch: { themeIds?: string[]; note?: string; redactions?: Range[]; publicReviewedHash?: string | null },
  ): Promise<Excerpt> {
    return this.tx(['excerpts', 'sources', 'themes', 'projects'], async () => {
      const cur = await this.db.excerpts.get(id);
      if (!cur) throw new RepoError('not_found', '引用が見つかりません（削除された可能性があります）');
      if (cur.revision !== expectedRevision) throw new RepoError('conflict', '別の操作で引用が更新されています');
      const src = await this.db.sources.get(cur.sourceId);
      if (!src || src.text.slice(cur.startUtf16, cur.endUtf16) !== cur.quote) throw new RepoError('validation', '原文と引用の位置が一致しません。引用を作り直してください');
      if (patch.themeIds) await this.assertThemes(cur.projectId, patch.themeIds);
      let redactions = cur.redactions;
      let reviewed = cur.publicReviewedHash;
      if (patch.redactions) {
        const r = normalizeRedactions(cur.quote, patch.redactions);
        if (!r.ok) throw new RepoError('validation', '伏字の範囲が正しくありません');
        if (JSON.stringify(r.ranges) !== JSON.stringify(cur.redactions)) reviewed = null;
        redactions = r.ranges;
      }
      if (patch.publicReviewedHash !== undefined) reviewed = patch.publicReviewedHash;
      const next = check(ExcerptSchema, {
        ...cur,
        themeIds: patch.themeIds ? [...new Set(patch.themeIds)] : cur.themeIds,
        note: patch.note ?? cur.note,
        redactions,
        publicReviewedHash: reviewed,
        revision: cur.revision + 1,
        updatedAt: nowIso(),
      }, '引用');
      await this.db.excerpts.put(next);
      await this.touchProject(cur.projectId);
      return next;
    });
  }

  async deleteExcerpt(id: string): Promise<void> {
    await this.tx(['excerpts', 'evidenceLinks', 'findings', 'projects'], async () => {
      const cur = await this.db.excerpts.get(id);
      if (!cur) return;
      const now = nowIso();
      await this.cascadeExcerpts([id], now);
      await this.touchProject(cur.projectId, now);
    });
  }

  // ---------- themes ----------
  async createTheme(projectId: string, input: { id: string; label: string; description?: string }): Promise<{ theme: Theme; duplicateOf: Theme | null }> {
    return this.tx(['themes', 'projects'], async () => {
      if (await this.db.themes.get(input.id)) throw new RepoError('already_done', '作成済みです');
      const list = await this.db.themes.where('projectId').equals(projectId).toArray();
      if (list.length >= LIMITS.themesPerProject) throw new RepoError('limit', `テーマは1調査${LIMITS.themesPerProject}件までです`);
      const label = input.label.trim();
      const key = themeKey(label);
      const now = nowIso();
      const row = check(ThemeSchema, {
        id: input.id,
        projectId,
        label,
        labelKey: key,
        description: input.description ?? '',
        order: list.reduce((m, t) => Math.max(m, t.order), 0) + 1,
        createdAt: now,
        updatedAt: now,
        revision: 1,
      }, 'テーマ');
      await this.db.themes.add(row);
      await this.touchProject(projectId, now);
      return { theme: row, duplicateOf: list.find((t) => t.labelKey === key) ?? null };
    });
  }

  async updateTheme(id: string, expectedRevision: number, patch: { label?: string; description?: string }): Promise<Theme> {
    return this.tx(['themes', 'projects'], async () => {
      const cur = await this.db.themes.get(id);
      if (!cur) throw new RepoError('not_found', 'テーマが見つかりません');
      if (cur.revision !== expectedRevision) throw new RepoError('conflict', '別の操作でテーマが更新されています');
      const label = patch.label !== undefined ? patch.label.trim() : cur.label;
      const next = check(ThemeSchema, { ...cur, label, labelKey: themeKey(label), description: patch.description ?? cur.description, revision: cur.revision + 1, updatedAt: nowIso() }, 'テーマ');
      await this.db.themes.put(next);
      await this.touchProject(cur.projectId);
      return next;
    });
  }

  /** delete only removes the membership from excerpts */
  async deleteTheme(id: string): Promise<void> {
    await this.tx(['themes', 'excerpts', 'projects'], async () => {
      const cur = await this.db.themes.get(id);
      if (!cur) return;
      const now = nowIso();
      const ex = await this.db.excerpts.where('projectId').equals(cur.projectId).filter((e) => e.themeIds.includes(id)).toArray();
      for (const e of ex) await this.db.excerpts.put({ ...e, themeIds: e.themeIds.filter((t) => t !== id), revision: e.revision + 1, updatedAt: now });
      await this.db.themes.delete(id);
      await this.touchProject(cur.projectId, now);
    });
  }

  async mergeTheme(fromId: string, intoId: string): Promise<void> {
    if (fromId === intoId) return;
    await this.tx(['themes', 'excerpts', 'projects'], async () => {
      const from = await this.db.themes.get(fromId);
      const into = await this.db.themes.get(intoId);
      if (!from || !into || from.projectId !== into.projectId) throw new RepoError('not_found', 'テーマが見つかりません');
      const now = nowIso();
      const ex = await this.db.excerpts.where('projectId').equals(from.projectId).filter((e) => e.themeIds.includes(fromId)).toArray();
      for (const e of ex) {
        const ids = [...new Set(e.themeIds.map((t) => (t === fromId ? intoId : t)))];
        await this.db.excerpts.put({ ...e, themeIds: ids, revision: e.revision + 1, updatedAt: now });
      }
      await this.db.themes.delete(fromId);
      await this.touchProject(from.projectId, now);
    });
  }

  async moveTheme(id: string, dir: -1 | 1): Promise<void> {
    await this.tx(['themes', 'projects'], async () => {
      const cur = await this.db.themes.get(id);
      if (!cur) return;
      const list = (await this.db.themes.where('projectId').equals(cur.projectId).toArray()).sort((a, b) => a.order - b.order);
      await this.swapOrder(list, id, dir, (t) => this.db.themes.put(t));
      await this.touchProject(cur.projectId);
    });
  }

  private async swapOrder<T extends { id: string; order: number; revision: number; updatedAt: string }>(list: T[], id: string, dir: -1 | 1, put: (t: T) => Promise<unknown>) {
    const i = list.findIndex((x) => x.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return;
    // renumber densely then swap
    const now = nowIso();
    const arr = list.map((x, k) => ({ ...x, order: k + 1 }));
    const a = arr[i]!;
    const b = arr[j]!;
    [a.order, b.order] = [b.order, a.order];
    for (const x of arr) {
      const orig = list.find((o) => o.id === x.id)!;
      if (orig.order !== x.order) await put({ ...x, revision: x.revision + 1, updatedAt: now });
    }
  }

  // ---------- findings ----------
  async createFinding(projectId: string, input: { id: string; title: string; supportsExcerptIds?: string[] }): Promise<Finding> {
    return this.tx(['findings', 'evidenceLinks', 'excerpts', 'projects'], async () => {
      if (await this.db.findings.get(input.id)) throw new RepoError('already_done', '作成済みです');
      const list = await this.db.findings.where('projectId').equals(projectId).toArray();
      if (list.length >= LIMITS.findingsPerProject) throw new RepoError('limit', `気づきは1調査${LIMITS.findingsPerProject}件までです`);
      const now = nowIso();
      const f = check(FindingSchema, {
        id: input.id,
        projectId,
        title: input.title.trim(),
        interpretation: '',
        proposal: '',
        expectedChange: '',
        nextCheck: '',
        counterCheck: 'not_checked',
        counterNote: '',
        status: 'draft',
        included: false,
        order: list.reduce((m, t) => Math.max(m, t.order), 0) + 1,
        createdAt: now,
        updatedAt: now,
        revision: 1,
      }, '気づき');
      await this.db.findings.add(f);
      let order = 1;
      for (const exId of [...new Set(input.supportsExcerptIds ?? [])]) {
        const ex = await this.db.excerpts.get(exId);
        if (!ex || ex.projectId !== projectId) throw new RepoError('not_found', '選択した引用が見つかりません（削除された可能性があります）');
        await this.db.evidenceLinks.add(check(EvidenceLinkSchema, { id: newId(), projectId, findingId: f.id, excerptId: exId, role: 'supports', order: order++, createdAt: now, updatedAt: now, revision: 1 }, '根拠'));
      }
      await this.touchProject(projectId, now);
      return f;
    });
  }

  async updateFinding(
    id: string,
    expectedRevision: number,
    patch: Partial<Pick<Finding, 'title' | 'interpretation' | 'proposal' | 'expectedChange' | 'nextCheck' | 'counterCheck' | 'counterNote'>>,
  ): Promise<Finding> {
    return this.tx(['findings', 'evidenceLinks', 'excerpts', 'sources', 'projects'], async () => {
      const cur = await this.db.findings.get(id);
      if (!cur) throw new RepoError('not_found', '気づきが見つかりません（削除された可能性があります）');
      if (cur.revision !== expectedRevision) throw new RepoError('conflict', '別の操作で気づきが更新されています');
      let next = check(FindingSchema, { ...cur, ...patch, revision: cur.revision + 1, updatedAt: nowIso() }, '気づき');
      // edits that break readiness put the finding back to draft
      if (next.status === 'ready' && (await this.findingIssues(next)).length) next = { ...next, status: 'draft' };
      await this.db.findings.put(next);
      await this.touchProject(cur.projectId);
      return next;
    });
  }

  private async findingIssues(f: Finding) {
    const links = await this.db.evidenceLinks.where('findingId').equals(f.id).toArray();
    const exs = await this.db.excerpts.bulkGet(links.map((l) => l.excerptId));
    const excerptById = new Map(exs.filter((e): e is Excerpt => !!e).map((e) => [e.id, e]));
    const srcs = await this.db.sources.bulkGet([...new Set([...excerptById.values()].map((e) => e.sourceId))]);
    const sourceById = new Map(srcs.filter((s): s is Source => !!s).map((s) => [s.id, s]));
    return readinessIssues(f, evidenceCounts(f.id, links, excerptById, sourceById));
  }

  async setFindingStatus(id: string, status: 'draft' | 'ready'): Promise<Finding> {
    return this.tx(['findings', 'evidenceLinks', 'excerpts', 'sources', 'projects'], async () => {
      const cur = await this.db.findings.get(id);
      if (!cur) throw new RepoError('not_found', '気づきが見つかりません');
      if (status === 'ready') {
        const issues = await this.findingIssues(cur);
        if (issues.length) throw new RepoError('validation', '提出可にできません：' + issues.map((i) => READINESS_LABEL[i]).join('／'));
      }
      const next = { ...cur, status, revision: cur.revision + 1, updatedAt: nowIso() };
      await this.db.findings.put(next);
      await this.touchProject(cur.projectId);
      return next;
    });
  }

  async setFindingIncluded(id: string, included: boolean): Promise<void> {
    await this.tx(['findings', 'projects'], async () => {
      const cur = await this.db.findings.get(id);
      if (!cur) throw new RepoError('not_found', '気づきが見つかりません');
      await this.db.findings.put({ ...cur, included, revision: cur.revision + 1, updatedAt: nowIso() });
      await this.touchProject(cur.projectId);
    });
  }

  async moveFinding(id: string, dir: -1 | 1): Promise<void> {
    await this.tx(['findings', 'projects'], async () => {
      const cur = await this.db.findings.get(id);
      if (!cur) return;
      const list = (await this.db.findings.where('projectId').equals(cur.projectId).toArray()).sort((a, b) => a.order - b.order);
      await this.swapOrder(list, id, dir, (t) => this.db.findings.put(t));
      await this.touchProject(cur.projectId);
    });
  }

  async deleteFinding(id: string): Promise<void> {
    await this.tx(['findings', 'evidenceLinks', 'projects'], async () => {
      const cur = await this.db.findings.get(id);
      if (!cur) return;
      await this.db.evidenceLinks.where('findingId').equals(id).delete();
      await this.db.findings.delete(id);
      await this.touchProject(cur.projectId);
    });
  }

  // ---------- evidence links ----------
  /** One link per finding+excerpt. Changing the role updates the existing link. */
  async setLink(findingId: string, excerptId: string, role: EvidenceRole): Promise<EvidenceLink> {
    return this.tx(['evidenceLinks', 'findings', 'excerpts', 'sources', 'projects'], async () => {
      const f = await this.db.findings.get(findingId);
      const ex = await this.db.excerpts.get(excerptId);
      if (!f || !ex || f.projectId !== ex.projectId) throw new RepoError('not_found', '気づきまたは引用が見つかりません');
      const now = nowIso();
      const existing = await this.db.evidenceLinks.where('findingId').equals(findingId).filter((l) => l.excerptId === excerptId).first();
      let link: EvidenceLink;
      if (existing) {
        link = { ...existing, role, revision: existing.revision + 1, updatedAt: now };
        await this.db.evidenceLinks.put(link);
      } else {
        const all = await this.db.evidenceLinks.where('findingId').equals(findingId).toArray();
        link = check(EvidenceLinkSchema, { id: newId(), projectId: f.projectId, findingId, excerptId, role, order: all.reduce((m, l) => Math.max(m, l.order), 0) + 1, createdAt: now, updatedAt: now, revision: 1 }, '根拠');
        await this.db.evidenceLinks.add(link);
      }
      await this.demoteIfBroken(findingId, now);
      await this.touchProject(f.projectId, now);
      return link;
    });
  }

  async removeLink(linkId: string): Promise<void> {
    await this.tx(['evidenceLinks', 'findings', 'excerpts', 'sources', 'projects'], async () => {
      const l = await this.db.evidenceLinks.get(linkId);
      if (!l) return;
      const now = nowIso();
      await this.db.evidenceLinks.delete(linkId);
      await this.demoteIfBroken(l.findingId, now);
      await this.touchProject(l.projectId, now);
    });
  }

  async moveLink(linkId: string, dir: -1 | 1): Promise<void> {
    await this.tx(['evidenceLinks', 'projects'], async () => {
      const l = await this.db.evidenceLinks.get(linkId);
      if (!l) return;
      const list = (await this.db.evidenceLinks.where('findingId').equals(l.findingId).toArray()).filter((x) => x.role === l.role).sort((a, b) => a.order - b.order);
      await this.swapOrder(list, linkId, dir, (t) => this.db.evidenceLinks.put(t));
      await this.touchProject(l.projectId);
    });
  }

  private async demoteIfBroken(findingId: string, now: string) {
    const f = await this.db.findings.get(findingId);
    if (f && f.status === 'ready' && (await this.findingIssues(f)).length) {
      await this.db.findings.put({ ...f, status: 'draft', revision: f.revision + 1, updatedAt: now });
    }
  }

  // ---------- exports ----------
  async addExportRecord(projectId: string, format: ExportRecord['format'], draft: boolean): Promise<void> {
    // Export records are allowed in read-only (license-less) mode for existing data.
    try {
      await this.db.transaction('rw', ['exportRecords', 'projects'], async () => {
        const p = await this.db.projects.get(projectId);
        if (!p) return;
        await this.db.exportRecords.add({ id: newId(), projectId, format, draft, projectRevision: p.revision, createdAt: nowIso() });
      });
    } catch {
      // export itself succeeded; a missing record must not fail the user's export
    }
  }

  // ---------- settings ----------
  async getSetting<T>(key: SettingKey): Promise<T | undefined> {
    return (await this.db.settings.get(key))?.value as T | undefined;
  }
  /** settings writes are allowed without the writer lock only for license/backup metadata */
  async setSetting(key: SettingKey, value: unknown): Promise<void> {
    try {
      await this.db.settings.put({ key, value });
    } catch (e) {
      wrapStorage(e);
    }
  }

  // ---------- bundles (backup) ----------
  async getBundle(projectIds?: string[]): Promise<ProjectBundle> {
    return this.db.transaction('r', ['projects', 'participants', 'sources', 'excerpts', 'themes', 'findings', 'evidenceLinks'], async () => {
      const projects = projectIds ? (await this.db.projects.bulkGet(projectIds)).filter((p): p is Project => !!p) : await this.db.projects.toArray();
      const ids = projects.map((p) => p.id);
      const by = async <T>(t: string): Promise<T[]> => (ids.length ? ((await this.db.table(t).where('projectId').anyOf(ids).toArray()) as T[]) : []);
      return {
        projects,
        participants: await by<Participant>('participants'),
        sources: await by<Source>('sources'),
        excerpts: await by<Excerpt>('excerpts'),
        themes: await by<Theme>('themes'),
        findings: await by<Finding>('findings'),
        evidenceLinks: await by<EvidenceLink>('evidenceLinks'),
      };
    });
  }

  async backupPayload(projectIds: string[] | undefined, appVersion: string): Promise<BackupPayload> {
    const b = await this.getBundle(projectIds);
    return { schemaVersion: SCHEMA_VERSION, exportedAt: nowIso(), appVersion, ...b };
  }

  /** Add restored projects as new projects, atomically. Never replaces existing data. */
  async restoreBundle(bundle: ProjectBundle): Promise<{ projects: number }> {
    return this.tx([...PROJECT_TABLES], async () => {
      const existing = await this.db.projects.toArray();
      if (existing.length + bundle.projects.length > LIMITS.projectsPerDevice) throw new RepoError('limit', `1端末の調査は${LIMITS.projectsPerDevice}件までです（現在${existing.length}件）`);
      const remapped = remapBundle(bundle, new Set(existing.map((p) => p.title)), newId, nowIso());
      const problems = validateBundle(remapped);
      if (problems.length) throw new RepoError('validation', 'バックアップの内容に不整合があります');
      await this.db.projects.bulkAdd(remapped.projects);
      await this.db.participants.bulkAdd(remapped.participants);
      await this.db.sources.bulkAdd(remapped.sources);
      await this.db.themes.bulkAdd(remapped.themes);
      await this.db.excerpts.bulkAdd(remapped.excerpts);
      await this.db.findings.bulkAdd(remapped.findings);
      await this.db.evidenceLinks.bulkAdd(remapped.evidenceLinks);
      return { projects: remapped.projects.length };
    });
  }

  async counts(): Promise<Record<string, number>> {
    const out: Record<string, number> = {};
    for (const t of PROJECT_TABLES) out[t] = await this.db.table(t).count();
    return out;
  }
}

export { Dexie };
