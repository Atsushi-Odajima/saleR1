// AC16: 20 sources × 10,000 chars, 400 excerpts, 20 findings. Records timings (not a Windows measurement).
import { test, expect } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { installLicense } from './helpers';
import { perfBundle, seed } from './seed';

test('AC16: first display per screen and search latency on the standard fixture', async ({ page }) => {
  test.setTimeout(180_000);
  await installLicense(page);
  const pid = await seed(page, perfBundle());
  const sid = await page.evaluate(async (pid) => {
    const t = (window as unknown as { __koeitoTest: { real: { db: { sources: { where(k: string): { equals(v: string): { toArray(): Promise<Array<{ id: string; sourceNo: number }>> } } } } } } }).__koeitoTest;
    return (await t.real.db.sources.where('projectId').equals(pid).toArray()).sort((a, b) => a.sourceNo - b.sourceNo)[0]!.id;
  }, pid);
  const results: Record<string, number> = {};
  const measure = async (name: string, hash: string, ready: () => Promise<void>) => {
    await page.goto('about:blank');
    const t0 = Date.now();
    await page.goto('./' + hash);
    await ready();
    results[name] = Date.now() - t0;
  };
  await measure('S01 sources (cold load)', `#/p/${pid}/sources`, () => expect(page.locator('.table-list > li')).toHaveCount(20, { timeout: 15000 }));
  await measure('S02 reader 10,000 chars', `#/p/${pid}/source/${sid}`, () => expect(page.locator('.reader .hl').first()).toBeVisible({ timeout: 15000 }));
  await measure('S03 themes 400 excerpts', `#/p/${pid}/themes`, () => expect(page.locator('.quote-rows > li')).toHaveCount(400, { timeout: 15000 }));
  await measure('S04 findings 20', `#/p/${pid}/findings`, () => expect(page.locator('article.finding')).toHaveCount(20, { timeout: 15000 }));
  await measure('S05 report checks', `#/p/${pid}/report`, () => expect(page.locator('.checklist li')).toHaveCount(4, { timeout: 15000 }));
  await page.goto(`./#/p/${pid}/search`);
  await page.locator('#q').waitFor();
  const t0 = Date.now();
  await page.locator('#q').fill('返品の条件');
  await expect(page.getByRole('status').filter({ hasText: /件/ })).toBeVisible();
  results['search (incl. 150ms debounce)'] = Date.now() - t0;
  await expect(page.getByRole('button', { name: /続きを表示/ })).toBeVisible();
  mkdirSync('test-reports', { recursive: true });
  const env = { date: new Date().toISOString(), os: `${os.type()} ${os.release()}`, cpus: os.cpus().length, cpu: os.cpus()[0]?.model, memGB: Math.round(os.totalmem() / 2 ** 30), browser: 'Chromium (Playwright, headless)', note: 'Linux container measurement; NOT the Windows 11 test machine required by AC16' };
  writeFileSync('test-reports/perf.json', JSON.stringify({ env, resultsMs: results }, null, 2));
  console.log(JSON.stringify({ env, resultsMs: results }, null, 2));
  for (const [k, v] of Object.entries(results)) {
    if (k.startsWith('search')) expect(v, k).toBeLessThan(1000);
    else expect(v, k).toBeLessThan(3000);
  }
});
