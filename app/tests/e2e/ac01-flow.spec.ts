// AC01 normal route + AC02 counts (UI) + persistence after restart (reload)
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { EXAMPLES, installLicense, createProject, importTxt, selectInReader, quoteSelection, projectIdFromUrl } from './helpers';

test('AC01: 3 sources → excerpts → 2 supports + 1 contradiction → proposal → formal HTML, survives reload', async ({ page }) => {
  await installLicense(page);
  await createProject(page, 'ECサイトの購入体験');
  const pid = projectIdFromUrl(page.url());
  await importTxt(page, ['interview_P01.txt', 'interview_P02.txt', 'interview_P03.txt'].map((f) => path.join(EXAMPLES, f)));
  await expect(page.locator('.table-list > li')).toHaveCount(3);

  // S02: quote from each source
  const quotes: Array<[string, string]> = [
    ['S01', '商品ページで総額の目安が分かると助かります。'],
    ['S02', 'カートに入れる前に迷います。'],
    ['S03', '説明が増えると商品写真が見づらくなりそうです。'],
  ];
  for (const [no, phrase] of quotes) {
    await page.goto(`./#/p/${pid}/sources`);
    await page.locator('.table-list > li', { hasText: no }).getByRole('link', { name: '読む' }).click();
    await selectInReader(page, phrase);
    await expect(page.getByText(/文字を選択中/)).toBeVisible();
    await quoteSelection(page, ['送料の見通し']);
    await expect(page.locator('.excerpt-list .quote-box', { hasText: phrase })).toBeVisible();
  }

  // S03: select two supporting quotes and create a finding
  await page.goto(`./#/p/${pid}/themes`);
  const group = page.locator('section', { has: page.getByRole('heading', { name: '送料の見通し', level: 2 }) });
  await group.locator('li', { hasText: '総額の目安' }).getByRole('checkbox').check();
  await group.locator('li', { hasText: 'カートに入れる前' }).getByRole('checkbox').check();
  await page.getByRole('button', { name: '選択した引用で気づきを作る' }).click();
  await page.getByRole('dialog').getByLabel('見出し（気づき）').fill('価格の不安は、送料が見えないことから。');
  await page.getByRole('dialog').getByRole('button', { name: '作成して編集する' }).click();

  // S04 editor
  await expect(page.getByLabel('見出し（気づき）')).toHaveValue('価格の不安は、送料が見えないことから。');
  await page.getByRole('button', { name: '引用を追加' }).nth(1).click();
  const add = page.getByRole('dialog');
  await add.locator('li', { hasText: '商品写真が見づらく' }).getByRole('button', { name: '追加' }).click();
  await expect(add.getByText('追加済み')).toBeVisible();
  await add.getByRole('button', { name: '完了' }).click();
  await page.getByLabel('観察と解釈').fill('初めて購入する人には、注文確定の前に総額を把握したいという声がある。');
  await page.getByLabel('異なる声あり').check();
  await page.getByLabel('反証確認のメモ').fill('常連の利用者からは、説明が増えることへの懸念があった。');
  await page.getByLabel('改善案（次の一手）').fill('商品詳細に送料の目安を短く表示する。');
  await page.getByLabel('次に確認すること').fill('初回購入者が総額の目安を自分で見つけられるか。');
  await page.getByLabel('次に確認すること').blur();
  await expect(page.getByRole('status').filter({ hasText: 'この端末に保存済み' })).toBeVisible();
  await expect(page.getByText('提出に必要な項目はそろっています')).toBeVisible();
  await page.getByRole('button', { name: '提出可にする' }).click();
  await expect(page.getByText('現在の状態：提出可')).toBeVisible();
  await page.getByLabel('提案書に採用').click();
  await expect(page.getByLabel('提案書に採用')).toBeChecked();

  // AC02 on screen: supports from P01,P02 → 2人・2引用; P03 contradicts separately
  await page.goto(`./#/p/${pid}/findings`);
  await expect(page.locator('.quote-col').first()).toContainText('2人・2引用');
  await expect(page.locator('.quote-col.contra')).toContainText('1人・1引用');

  // S05: limitations + review + formal export
  await page.goto(`./#/p/${pid}/report`);
  await page.getByLabel('調査の限界').fill('架空の3人の発言のみ。全利用者を代表しない。');
  await page.getByLabel('調査の限界').blur();
  const boxes = page.getByRole('checkbox', { name: '公開内容を確認しました' });
  await expect(boxes).toHaveCount(3);
  for (let i = 0; i < 3; i++) {
    await boxes.nth(i).click();
    await expect(boxes.nth(i)).toBeChecked();
  }
  await expect(page.locator('.checklist li.ok')).toHaveCount(4);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'HTMLを保存' }).click()]);
  const html = readFileSync((await dl.path())!, 'utf8');
  expect(html).toContain('価格の不安は、送料が見えないことから。');
  expect(html).toContain('P01　/　S01・P002'); // original position reference
  expect(html).toContain('P03　/　S03・P002');
  expect(html).not.toContain('草案・根拠未確認');
  expect(html).toContain('2人・2引用');
  await expect(page.getByText('ファイルを作成しました')).toBeVisible();

  // restart: reload the app → same content
  await page.reload();
  await page.goto(`./#/p/${pid}/findings`);
  await expect(page.getByRole('heading', { name: '価格の不安は、送料が見えないことから。' })).toBeVisible();
  await expect(page.locator('.status-badge.ready')).toBeVisible();
  const ex = await page.evaluate(async (pid) => {
    const t = (window as unknown as { __koeitoTest: { real: { db: { excerpts: { where(k: string): { equals(v: string): { toArray(): Promise<Array<{ quote: string; startUtf16: number; endUtf16: number; sourceId: string }>> } } }; sources: { get(id: string): Promise<{ text: string }> } } } } }).__koeitoTest;
    const rows = await t.real.db.excerpts.where('projectId').equals(pid).toArray();
    const out = [];
    for (const r of rows) out.push((await t.real.db.sources.get(r.sourceId)).text.slice(r.startUtf16, r.endUtf16) === r.quote);
    return out;
  }, pid);
  expect(ex).toEqual([true, true, true]);
});
