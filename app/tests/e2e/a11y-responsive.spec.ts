// AC14 responsive (no horizontal overflow, ≥44px controls) and AC15 axe (serious/critical = 0), focus return.
import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { installLicense } from './helpers';
import { seedDemo } from './seed';

const VIEWPORTS = [
  { name: '360x800', width: 360, height: 800 },
  { name: '390x844', width: 390, height: 844 },
  { name: '768x1024', width: 768, height: 1024 },
  { name: '1440x960', width: 1440, height: 960 },
  { name: '200%-zoom-proxy-720x480', width: 720, height: 480 },
];

async function screens(page: Page, pid: string) {
  const ids = await page.evaluate(async (pid) => {
    const t = (window as unknown as { __koeitoTest: { real: { db: { sources: { where(k: string): { equals(v: string): { toArray(): Promise<Array<{ id: string }>> } } }; findings: { where(k: string): { equals(v: string): { toArray(): Promise<Array<{ id: string }>> } } } } } } }).__koeitoTest;
    return { sid: (await t.real.db.sources.where('projectId').equals(pid).toArray())[0]!.id, fid: (await t.real.db.findings.where('projectId').equals(pid).toArray())[0]!.id };
  }, pid);
  return [
    ['S00', '#/'],
    ['S01', `#/p/${pid}/sources`],
    ['S01a', `#/p/${pid}/import-csv`],
    ['S02', `#/p/${pid}/source/${ids.sid}`],
    ['S03', `#/p/${pid}/themes`],
    ['S04', `#/p/${pid}/findings`],
    ['S04-edit', `#/p/${pid}/findings/${ids.fid}`],
    ['S05', `#/p/${pid}/report`],
    ['S06', '#/settings'],
    ['help', '#/help'],
    ['search', `#/p/${pid}/search`],
    ['demo-S04', '#/d/00000000-0000-4000-8000-000000000001/findings'],
  ] as const;
}

test('AC14/AC15: every screen at 5 sizes — no horizontal overflow, controls ≥44px, axe serious/critical = 0', async ({ page }) => {
  test.setTimeout(240_000);
  await installLicense(page);
  const pid = await seedDemo(page);
  const list = await screens(page, pid);
  const problems: string[] = [];
  for (const vp of VIEWPORTS) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    for (const [name, hash] of list) {
      await page.goto('./' + hash);
      await page.locator('main').first().waitFor();
      await page.waitForTimeout(250);
      const r = await page.evaluate(() => {
        const vw = document.documentElement.clientWidth;
        const overflow = document.documentElement.scrollWidth - vw;
        const small: string[] = [];
        document.querySelectorAll<HTMLElement>('button, .btn, a.header-menu, .choice, select, input:not([type=checkbox]):not([type=radio]):not([type=file])').forEach((el) => {
          const b = el.getBoundingClientRect();
          if (b.width === 0 || b.height === 0) return;
          if (el.closest('.visually-hidden') || el.classList.contains('skip-link')) return;
          if (b.height < 44 - 0.5) small.push(`${el.tagName}.${el.className} "${(el.textContent ?? '').trim().slice(0, 20)}" h=${b.height.toFixed(1)}`);
        });
        return { overflow, small: small.slice(0, 5) };
      });
      if (r.overflow > 0) problems.push(`${vp.name} ${name}: horizontal overflow ${r.overflow}px`);
      if (r.small.length) problems.push(`${vp.name} ${name}: small controls ${r.small.join(' | ')}`);
      if (vp.name === '1440x960' || vp.name === '360x800') {
        const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
        for (const v of axe.violations.filter((x) => x.impact === 'serious' || x.impact === 'critical')) {
          problems.push(`${vp.name} ${name}: axe ${v.id} (${v.impact}) ${v.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(', ')}`);
        }
      }
    }
  }
  expect(problems, problems.join('\n')).toEqual([]);
});

test('AC15: modal focus moves in, Esc closes, focus returns to the opener; keyboard-only dialog', async ({ page }) => {
  await installLicense(page);
  await page.goto('./#/');
  const opener = page.getByRole('button', { name: '新しい調査を作る' }).first();
  await opener.focus();
  await page.keyboard.press('Enter');
  const dlg = page.getByRole('dialog', { name: '新しい調査を作る' });
  await expect(dlg).toBeVisible();
  await expect(dlg.getByLabel('調査の題名')).toBeFocused();
  // Tab cycles inside the dialog
  for (let i = 0; i < 8; i++) await page.keyboard.press('Tab');
  expect(await page.evaluate(() => !!document.activeElement?.closest('[role=dialog]'))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(dlg).toBeHidden();
  await expect(opener).toBeFocused();
});
