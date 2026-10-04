// AC06 save failures (quota / transaction / revision conflict) and AC07 single writer across tabs.
import { test, expect } from '@playwright/test';
import path from 'node:path';
import { EXAMPLES, installLicense, createProject, importTxt, projectIdFromUrl } from './helpers';

type T = { __koeitoTest: { real: { fault: string | null; db: { projects: { get(id: string): Promise<{ title: string; revision: number }> }; findings: { toArray(): Promise<Array<{ id: string; title: string }>>; update(id: string, c: object): Promise<number> } } } } };

test('AC06: injected quota / transaction failures never show "saved"; input and backup route remain', async ({ page }) => {
  await installLicense(page);
  await createProject(page, '保存失敗の確認');
  const pid = projectIdFromUrl(page.url());
  await page.goto(`./#/p/${pid}/report`);
  await page.getByLabel('調査の限界').fill('最初の限界');
  await page.getByLabel('調査の限界').blur();
  await expect(page.getByRole('status').filter({ hasText: 'この端末に保存済み' })).toBeVisible();

  for (const fault of ['quota', 'tx_abort']) {
    await page.evaluate((f) => ((window as unknown as T).__koeitoTest.real.fault = f), fault);
    await page.getByLabel('調査の限界').fill(`失敗する入力 ${fault}`);
    await page.getByLabel('調査の限界').blur();
    await expect(page.getByRole('status').filter({ hasText: '未保存' })).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: 'この端末に保存済み' })).toHaveCount(0);
    await expect(page.getByRole('alert').first()).toContainText('保存できませんでした');
    await expect(page.getByRole('link', { name: 'バックアップを保存する' })).toBeVisible();
    await expect(page.getByLabel('調査の限界')).toHaveValue(`失敗する入力 ${fault}`); // input kept
    const stored = await page.evaluate((id) => (window as unknown as T).__koeitoTest.real.db.projects.get(id), pid);
    expect(stored.title).toBe('保存失敗の確認');
  }
  // recovery: clear the fault and the next save succeeds
  await page.evaluate(() => ((window as unknown as T).__koeitoTest.real.fault = null));
  await page.getByLabel('調査の限界').fill('回復した入力');
  await page.getByLabel('調査の限界').blur();
  await expect(page.getByRole('status').filter({ hasText: 'この端末に保存済み' })).toBeVisible();
});

test('AC06: revision conflict is shown and not overwritten', async ({ page }) => {
  await installLicense(page);
  await createProject(page, '競合の確認');
  const pid = projectIdFromUrl(page.url());
  await page.goto(`./#/p/${pid}/findings`);
  await page.getByRole('button', { name: '気づきを作る' }).click();
  await page.getByRole('dialog').getByLabel('見出し（気づき）').fill('元の見出し');
  await page.getByRole('dialog').getByRole('button', { name: '作成して編集する' }).click();
  await expect(page.getByLabel('見出し（気づき）')).toHaveValue('元の見出し');
  // another writer changes the same field behind the form's back, while the user is typing
  await page.getByLabel('観察と解釈').fill('入力中');
  await page.evaluate(async () => {
    const t = (window as unknown as T).__koeitoTest.real.db;
    const [f] = await t.findings.toArray();
    await t.findings.update(f!.id, { interpretation: '別の操作の値', revision: 99 });
  });
  await page.getByLabel('観察と解釈').blur();
  await expect(page.getByText('この気づきは別の操作で更新されました')).toBeVisible();
  const stored = await page.evaluate(async () => (await (window as unknown as T).__koeitoTest.real.db.findings.toArray())[0]);
  expect((stored as unknown as { interpretation: string }).interpretation).toBe('別の操作の値');
  await page.getByRole('button', { name: '最新の内容を読み込む' }).click();
  await expect(page.getByLabel('観察と解釈')).toHaveValue('別の操作の値');
});

test('AC07: second tab is read-only; after the writer closes it can take over; stale tab cannot overwrite', async ({ context }) => {
  const a = await context.newPage();
  await installLicense(a);
  await createProject(a, '複数タブ');
  const pid = projectIdFromUrl(a.url());
  await importTxt(a, [path.join(EXAMPLES, 'interview_P01.txt')]);

  const b = await context.newPage();
  await b.goto(`./#/p/${pid}/sources`);
  await expect(b.getByText('別のタブまたはウィンドウで編集中のため').first()).toBeVisible();
  await expect(b.getByRole('button', { name: '文章を追加' }).first()).toBeDisabled();
  // pressing the button while A is open does not steal the lock
  b.once('dialog', (d) => void d.accept());
  await b.getByRole('button', { name: '編集権を取得' }).click();
  await expect(b.getByText('別のタブまたはウィンドウで編集中のため').first()).toBeVisible();
  await expect(a.getByRole('button', { name: '文章を追加' }).first()).toBeEnabled();

  // A edits; B (read-only) sees the change live
  await a.goto(`./#/p/${pid}/report`);
  await a.getByLabel('調査の限界').fill('Aの入力');
  await a.getByLabel('調査の限界').blur();
  await expect(a.getByRole('status').filter({ hasText: 'この端末に保存済み' })).toBeVisible();
  await b.goto(`./#/p/${pid}/report`);
  await expect(b.getByLabel('調査の限界')).toHaveValue('Aの入力');
  await expect(b.getByLabel('調査の限界')).toBeDisabled();

  await a.close();
  await b.getByRole('button', { name: '編集権を取得' }).click();
  await expect(b.getByText('別のタブまたはウィンドウで編集中のため').first()).toHaveCount(0);
  await expect(b.getByLabel('調査の限界')).toBeEnabled();
  await b.getByText('対象と範囲（表紙に載る内容）').click(); // band starts closed once limitations exist
  await b.getByLabel('調査の限界').fill('Bの入力');
  await b.getByLabel('調査の限界').blur();
  await expect(b.getByRole('status').filter({ hasText: 'この端末に保存済み' })).toBeVisible();

  // a third, stale tab opened now is read-only and cannot write
  const c = await context.newPage();
  await c.goto(`./#/p/${pid}/report`);
  await expect(c.getByLabel('調査の限界')).toBeDisabled();
  const r = await c.evaluate(async (id) => {
    const t = (window as unknown as { __koeitoTest: { real: { updateProject(id: string, e: object, p: object): Promise<unknown> } } }).__koeitoTest;
    try {
      await t.real.updateProject(id, { limitations: 'Bの入力' }, { limitations: '古いタブ' });
      return 'written';
    } catch (e) {
      return (e as { code?: string }).code;
    }
  }, pid);
  expect(r).toBe('readonly');
});
