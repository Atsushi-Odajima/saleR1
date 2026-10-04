// Repository behaviour on IndexedDB (fake-indexeddb): AC05, AC06, AC08 restore, cascades.
import { describe, it, expect, beforeEach } from 'vitest';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { KoeitoDB } from '../../src/db/db';
import { Repo, RepoError } from '../../src/db/repo';
import { sha256Hex } from '../../src/domain/hash';
import { newId } from '../../src/domain/ids';
import { encryptBackup, decryptBackup } from '../../src/domain/backup';
import { buildDemoBundle } from '../../src/domain/demo';

let repo: Repo;
let writable = true;
beforeEach(() => {
  writable = true;
  repo = new Repo(new KoeitoDB('t-' + Math.random(), { indexedDB: new IDBFactory(), IDBKeyRange }), () => writable);
});

async function project() {
  return repo.createProject({ id: newId(), title: '調査A', question: '問い', periodStart: null, periodEnd: null, limitations: '' });
}
async function importTexts(projectId: string, texts: Array<[string, string]>) {
  const items = [];
  for (const [alias, text] of texts) {
    items.push({ newParticipant: { id: newId(), alias, internalNote: '' }, title: '資料', originalFilename: null, text, sha256: await sha256Hex(text) });
  }
  return repo.importSources(projectId, newId(), items);
}
async function code(p: Promise<unknown>) {
  try {
    await p;
    return 'ok';
  } catch (e) {
    return (e as RepoError).code;
  }
}

describe('projects and sources', () => {
  it('double submit with the same id creates one project', async () => {
    const id = newId();
    const input = { id, title: 't', question: 'q', periodStart: null, periodEnd: null, limitations: '' };
    const r = await Promise.allSettled([repo.createProject(input), repo.createProject(input)]);
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    expect(await repo.db.projects.count()).toBe(1);
  });
  it('import is idempotent per batch id and numbers sources without reuse', async () => {
    const p = await project();
    const batch = newId();
    const text = 'こんにちは';
    const item = { newParticipant: { id: newId(), alias: 'P01', internalNote: '' }, title: '資料', originalFilename: 'a.txt', text, sha256: await sha256Hex(text) };
    await repo.importSources(p.id, batch, [item]);
    expect(await code(repo.importSources(p.id, batch, [item]))).toBe('already_done');
    const [s2] = await importTexts(p.id, [['P02', 'b']]);
    expect(s2!.sourceNo).toBe(2);
    await repo.deleteSource(s2!.id);
    const [s3] = await importTexts(p.id, [['P03', 'c']]);
    expect(s3!.sourceNo).toBe(3); // 2 is not reused
  });
  it('a failing row aborts the whole import (DB counts unchanged)', async () => {
    const p = await project();
    const before = await repo.counts();
    const good = { newParticipant: { id: newId(), alias: 'P01', internalNote: '' }, title: 'ok', originalFilename: null, text: 'x', sha256: await sha256Hex('x') };
    const bad = { newParticipant: { id: newId(), alias: 'P02', internalNote: '' }, title: '', originalFilename: null, text: 'y', sha256: await sha256Hex('y') };
    expect(await code(repo.importSources(p.id, newId(), [good, bad]))).toBe('validation');
    expect(await repo.counts()).toEqual(before);
  });
  it('project delete removes all related rows in one transaction', async () => {
    const p = await project();
    const [s] = await importTexts(p.id, [['P01', '送料が分かりません。']]);
    const ex = await repo.createExcerpt({ id: newId(), sourceId: s!.id, startUtf16: 0, endUtf16: 2, themeIds: [], note: '', redactions: [] });
    const f = await repo.createFinding(p.id, { id: newId(), title: 'f', supportsExcerptIds: [ex.id] });
    await repo.addExportRecord(p.id, 'html', true);
    expect(f).toBeTruthy();
    await repo.deleteProject(p.id);
    const c = await repo.counts();
    expect(Object.values(c).every((n) => n === 0)).toBe(true);
  });
});

describe('excerpts and findings', () => {
  it('same source/range → duplicate error pointing at the existing excerpt', async () => {
    const p = await project();
    const [s] = await importTexts(p.id, [['P01', '送料が分かりません。']]);
    const a = await repo.createExcerpt({ id: newId(), sourceId: s!.id, startUtf16: 0, endUtf16: 2, themeIds: [], note: '', redactions: [] });
    try {
      await repo.createExcerpt({ id: newId(), sourceId: s!.id, startUtf16: 0, endUtf16: 2, themeIds: [], note: '', redactions: [] });
      throw new Error('should fail');
    } catch (e) {
      expect((e as RepoError).code).toBe('duplicate_excerpt');
      expect((e as RepoError).extra?.existingId).toBe(a.id);
    }
  });
  it('rejects ranges that split a grapheme', async () => {
    const p = await project();
    const [s] = await importTexts(p.id, [['P01', 'a👍🏽b']]);
    expect(await code(repo.createExcerpt({ id: newId(), sourceId: s!.id, startUtf16: 0, endUtf16: 2, themeIds: [], note: '', redactions: [] }))).toBe('validation');
  });
  it('AC05: deleting the evidence source returns the finding to draft', async () => {
    const p = await project();
    const [s1, s2] = await importTexts(p.id, [['P01', '支持する発言'], ['P02', '別の発言']]);
    const e1 = await repo.createExcerpt({ id: newId(), sourceId: s1!.id, startUtf16: 0, endUtf16: 6, themeIds: [], note: '', redactions: [] });
    const f = await repo.createFinding(p.id, { id: newId(), title: '見出し', supportsExcerptIds: [e1.id] });
    const f2 = await repo.updateFinding(f.id, f.revision, { interpretation: '解釈', proposal: '提案', nextCheck: '次' });
    await repo.setFindingStatus(f2.id, 'ready');
    expect((await repo.db.findings.get(f.id))!.status).toBe('ready');
    expect(await repo.sourceImpact(s1!.id)).toEqual({ excerpts: 1, findings: 1 });
    await repo.deleteSource(s1!.id);
    expect((await repo.db.findings.get(f.id))!.status).toBe('draft');
    expect(await repo.db.evidenceLinks.count()).toBe(0);
    expect(await repo.db.excerpts.count()).toBe(0);
    expect(s2).toBeTruthy();
  });
  it('setting ready is refused with missing evidence; role change does not duplicate links', async () => {
    const p = await project();
    const [s] = await importTexts(p.id, [['P01', 'abcdef']]);
    const e = await repo.createExcerpt({ id: newId(), sourceId: s!.id, startUtf16: 0, endUtf16: 3, themeIds: [], note: '', redactions: [] });
    const f = await repo.createFinding(p.id, { id: newId(), title: 't' });
    expect(await code(repo.setFindingStatus(f.id, 'ready'))).toBe('validation');
    await repo.setLink(f.id, e.id, 'supports');
    await repo.setLink(f.id, e.id, 'contradicts');
    await repo.setLink(f.id, e.id, 'supports');
    expect(await repo.db.evidenceLinks.count()).toBe(1);
  });
  it('theme delete only removes membership; merge rewrites ids', async () => {
    const p = await project();
    const [s] = await importTexts(p.id, [['P01', 'abcdef']]);
    const { theme: t1 } = await repo.createTheme(p.id, { id: newId(), label: '送料' });
    const { theme: t2, duplicateOf } = await repo.createTheme(p.id, { id: newId(), label: ' 送料 ' });
    expect(duplicateOf?.id).toBe(t1.id);
    const e = await repo.createExcerpt({ id: newId(), sourceId: s!.id, startUtf16: 0, endUtf16: 3, themeIds: [t1.id, t2.id], note: '', redactions: [] });
    await repo.mergeTheme(t2.id, t1.id);
    expect((await repo.db.excerpts.get(e.id))!.themeIds).toEqual([t1.id]);
    await repo.deleteTheme(t1.id);
    expect((await repo.db.excerpts.get(e.id))!.themeIds).toEqual([]);
    expect(await repo.db.excerpts.count()).toBe(1);
  });
  it('changing redactions clears the public review mark', async () => {
    const p = await project();
    const [s] = await importTexts(p.id, [['P01', '山田です']]);
    const e = await repo.createExcerpt({ id: newId(), sourceId: s!.id, startUtf16: 0, endUtf16: 4, themeIds: [], note: '', redactions: [] });
    const e2 = await repo.updateExcerpt(e.id, e.revision, { publicReviewedHash: 'a'.repeat(64) });
    const e3 = await repo.updateExcerpt(e2.id, e2.revision, { redactions: [{ startUtf16: 0, endUtf16: 2 }] });
    expect(e3.publicReviewedHash).toBeNull();
    expect(e3.quote).toBe('山田です');
  });
});

describe('AC06 save failures and conflicts', () => {
  it('revision conflict is not overwritten', async () => {
    const p = await project();
    await repo.updateProject(p.id, p.revision, { title: '新' });
    expect(await code(repo.updateProject(p.id, p.revision, { title: '古いタブから' }))).toBe('conflict');
    expect((await repo.db.projects.get(p.id))!.title).toBe('新');
  });
  it('quota and transaction failures leave data unchanged', async () => {
    const p = await project();
    repo.fault = 'quota';
    expect(await code(repo.updateProject(p.id, p.revision, { title: 'x' }))).toBe('storage');
    repo.fault = 'tx_abort';
    expect(await code(repo.updateProject(p.id, p.revision, { title: 'x' }))).toBe('storage');
    repo.fault = null;
    expect((await repo.db.projects.get(p.id))!.title).toBe('調査A');
  });
  it('read-only mode refuses writes', async () => {
    const p = await project();
    writable = false;
    expect(await code(repo.updateProject(p.id, p.revision, { title: 'x' }))).toBe('readonly');
  });
});

describe('AC08 restore', () => {
  it('full and single project round-trip as new projects with new ids', async () => {
    await repo.restoreBundle(await buildDemoBundle());
    const p2 = await project();
    await importTexts(p2.id, [['P01', '別の調査の本文']]);
    const all = await repo.backupPayload(undefined, '1.0.0');
    const one = await repo.backupPayload([p2.id], '1.0.0');
    expect(one.projects).toHaveLength(1);
    expect(one.sources).toHaveLength(1);
    expect(JSON.stringify(one)).not.toContain('送料'); // unreferenced project not mixed in
    const file = await encryptBackup(all, 'password-12345');
    const { payload } = await decryptBackup(new TextEncoder().encode(file), 'password-12345');
    await repo.restoreBundle(payload);
    const projects = await repo.db.projects.toArray();
    expect(projects).toHaveLength(4);
    expect(projects.filter((x) => x.title.endsWith('（読込）'))).toHaveLength(2);
    const ids = new Set((await repo.db.excerpts.toArray()).map((e) => e.id));
    expect(ids.size).toBe(8);
    // sourceNo / alias kept
    const restoredDemo = projects.find((x) => x.title === '【サンプル】ECサイトの購入体験（読込）')!;
    const srcs = await repo.db.sources.where('projectId').equals(restoredDemo.id).toArray();
    expect(srcs.map((s) => s.sourceNo).sort()).toEqual([1, 2, 3]);
  });
  it('a failing restore changes nothing', async () => {
    await repo.restoreBundle(await buildDemoBundle());
    const before = await repo.counts();
    const b = await buildDemoBundle();
    b.evidenceLinks[0] = { ...b.evidenceLinks[0]!, excerptId: '99999999-0000-4000-8000-000000000000' };
    expect(await code(repo.restoreBundle(b))).not.toBe('ok');
    expect(await repo.counts()).toEqual(before);
  });
});
