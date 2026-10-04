import { createHash, randomUUID } from 'node:crypto';
import type { Page } from '@playwright/test';

type Any = Record<string, unknown>;
const T = '2026-10-01T00:00:00.000Z';
const m = { createdAt: T, updatedAt: T, revision: 1 };
const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

/** 20 sources × 10,000 chars, 400 excerpts, 20 findings (AC16 fixture). Independent from app code. */
export function perfBundle(sources = 20, chars = 10_000, excerptsPerSource = 20, findings = 20) {
  const pid = randomUUID();
  const parts: Any[] = [];
  const srcs: Any[] = [];
  const exs: Any[] = [];
  const themes: Any[] = [];
  const fnds: Any[] = [];
  const links: Any[] = [];
  for (let t = 0; t < 10; t++) themes.push({ ...m, id: randomUUID(), projectId: pid, label: `テーマ${t + 1}`, labelKey: `テーマ${t + 1}`, description: '', order: t + 1 });
  for (let i = 0; i < sources; i++) {
    const partId = randomUUID();
    parts.push({ ...m, id: partId, projectId: pid, alias: `P${String(i + 1).padStart(2, '0')}`, internalNote: '' });
    let text = '';
    let n = 0;
    while (text.length < chars) {
      n++;
      text += `段落${n}：送料が分からないと、カートに入れる前に迷います。到着の目安も知りたいです。返品の条件はどこにありますか。\n`;
    }
    text = text.slice(0, chars);
    const sid = randomUUID();
    srcs.push({ ...m, id: sid, projectId: pid, sourceNo: i + 1, participantId: partId, title: `資料${i + 1}`, originalFilename: null, text, sha256: sha(text), importBatchId: pid });
    for (let k = 0; k < excerptsPerSource; k++) {
      const start = k * 400;
      const quote = text.slice(start, start + 30);
      exs.push({ ...m, id: randomUUID(), projectId: pid, sourceId: sid, startUtf16: start, endUtf16: start + 30, quote, themeIds: [themes[k % 10]!.id], note: '', redactions: [], publicReviewedHash: null });
    }
  }
  for (let f = 0; f < findings; f++) {
    const fid = randomUUID();
    fnds.push({ ...m, id: fid, projectId: pid, title: `気づき${f + 1}：送料の見通し`, interpretation: '解釈'.repeat(50), proposal: '提案'.repeat(30), expectedChange: '', nextCheck: '確認する', counterCheck: 'not_checked', counterNote: '', status: 'draft', included: true, order: f + 1 });
    for (let k = 0; k < 4; k++) links.push({ ...m, id: randomUUID(), projectId: pid, findingId: fid, excerptId: exs[f * 20 + k]!.id, role: k === 3 ? 'contradicts' : 'supports', order: k + 1 });
  }
  return {
    projects: [{ ...m, id: pid, title: '性能確認の調査', question: '性能の確認', periodStart: null, periodEnd: null, limitations: '試験用', nextSourceNo: sources + 1, nextParticipantNo: sources + 1 }],
    participants: parts,
    sources: srcs,
    excerpts: exs,
    themes,
    findings: fnds,
    evidenceLinks: links,
  };
}

/** Restore a bundle into the real DB through the app's own repository (atomic). Returns the new project id. */
export async function seed(page: Page, bundle: unknown): Promise<string> {
  return page.evaluate(async (b) => {
    const t = (window as unknown as { __koeitoTest: { real: { restoreBundle(b: unknown): Promise<unknown>; db: { projects: { toArray(): Promise<Array<{ id: string; createdAt: string; title: string }>> } } } } }).__koeitoTest;
    const before = new Set((await t.real.db.projects.toArray()).map((p) => p.id));
    await t.real.restoreBundle(b);
    const after = await t.real.db.projects.toArray();
    return after.find((p) => !before.has(p.id))!.id;
  }, bundle);
}

/** Copy the in-memory demo into the real DB (for screen tests). */
export async function seedDemo(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const t = (window as unknown as { __koeitoTest: { demo: { getBundle(): Promise<unknown> }; real: { restoreBundle(b: unknown): Promise<unknown>; db: { projects: { toArray(): Promise<Array<{ id: string }>> } } } } }).__koeitoTest;
    const before = new Set((await t.real.db.projects.toArray()).map((p) => p.id));
    await t.real.restoreBundle(await t.demo.getBundle());
    return (await t.real.db.projects.toArray()).find((p) => !before.has(p.id))!.id;
  });
}
