// AC13 (no external requests, no research data leaves) and AC12 (PWA offline after install).
import { test, expect } from '@playwright/test';
import path from 'node:path';
import { EXAMPLES, installLicense, createProject, importTxt, selectInReader, quoteSelection, projectIdFromUrl } from './helpers';

test('AC13: a full session only talks to the same origin with GET for static files', async ({ page }) => {
  const reqs: Array<{ url: string; method: string; post: string | null }> = [];
  page.on('request', (r) => reqs.push({ url: r.url(), method: r.method(), post: r.postData() }));
  await installLicense(page);
  await createProject(page, '通信の確認');
  const pid = projectIdFromUrl(page.url());
  await importTxt(page, [path.join(EXAMPLES, 'interview_P02.txt')]);
  await page.locator('.table-list > li').getByRole('link', { name: '読む' }).click();
  await selectInReader(page, 'カートに入れる前に迷います。');
  await quoteSelection(page, ['送料']);
  await page.goto(`./#/p/${pid}/report`);
  await page.getByLabel(/^草案/).check();
  await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'HTMLを保存' }).click()]);
  await page.goto('./#/settings');
  await page.getByLabel('パスワード（12〜128文字）').fill('correct horse battery');
  await page.getByLabel('パスワード（確認）').fill('correct horse battery');
  await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'バックアップを保存' }).click()]);
  const external = reqs.filter((r) => !/^(http:\/\/localhost:4173\/|data:|blob:)/.test(r.url));
  expect(external, JSON.stringify(external)).toEqual([]);
  expect(reqs.filter((r) => r.method !== 'GET' && !r.url.startsWith('blob:') && !r.url.startsWith('data:'))).toEqual([]);
  for (const r of reqs) expect(decodeURIComponent(r.url)).not.toContain('迷います');
});

test('AC12 (PWA): after the first online visit, the app works offline: import → quote → HTML → backup', async ({ page, context }) => {
  await page.goto('./');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload(); // now controlled by the service worker
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: '顧客の声を、根拠のある提案へ。' })).toBeVisible();
  await installLicense(page);
  await createProject(page, 'オフラインの確認');
  const pid = projectIdFromUrl(page.url());
  await importTxt(page, [path.join(EXAMPLES, 'interview_P03.txt')]);
  await page.locator('.table-list > li').getByRole('link', { name: '読む' }).click();
  await selectInReader(page, '常連なので送料は気になりません。');
  await quoteSelection(page);
  await page.goto(`./#/p/${pid}/report`);
  await page.getByLabel(/^草案/).check();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'HTMLを保存' }).click()]);
  expect(dl.suggestedFilename(), dl.url()).toMatch(/\.html$/);
  await page.goto('./#/settings');
  await page.getByLabel('パスワード（12〜128文字）').fill('correct horse battery');
  await page.getByLabel('パスワード（確認）').fill('correct horse battery');
  const [bk] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'バックアップを保存' }).click()]);
  expect(bk.suggestedFilename()).toMatch(/\.koeito$/);
  await context.setOffline(false);
});
