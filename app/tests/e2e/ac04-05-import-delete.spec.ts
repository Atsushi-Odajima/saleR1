// AC04 import through the UI (CSV quoting, SJIS, errors leave DB unchanged) and AC05 (double click, cascade delete)
import { test, expect, type Page } from '@playwright/test';
import path from 'node:path';
import { EXAMPLES, installLicense, createProject, importTxt, selectInReader, quoteSelection, projectIdFromUrl } from './helpers';

const FX = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../fixtures/import');
const counts = (page: Page) =>
  page.evaluate(async () => {
    const t = (window as unknown as { __koeitoTest: { real: { counts(): Promise<Record<string, number>> } } }).__koeitoTest;
    return t.real.counts();
  });

test('AC04: CSV with quotes/newlines/commas imports exactly; bad CSVs change nothing', async ({ page }) => {
  await installLicense(page);
  await createProject(page, '取込の確認');
  const pid = projectIdFromUrl(page.url());
  await page.goto(`./#/p/${pid}/import-csv`);
  await page.locator('#csv-file').setInputFiles(path.join(FX, 'quoted.csv'));
  await expect(page.getByText('2行・取り込む2資料・参加者2人')).toBeVisible();
  // real-looking name gets an alias; P01 stays P01
  await expect(page.locator('.alias-map li', { hasText: '山田 花子' }).locator('input')).toHaveValue('P02');
  await page.getByRole('button', { name: '2件をまとめて取り込む' }).click();
  await expect(page.getByText('2件の資料をこの端末に保存しました')).toBeVisible();
  const texts = await page.evaluate(async () => {
    const t = (window as unknown as { __koeitoTest: { real: { db: { sources: { toArray(): Promise<Array<{ text: string; title: string }>> } } } } }).__koeitoTest;
    return (await t.real.db.sources.toArray()).map((s) => [s.title, s.text]);
  });
  expect(texts).toContainEqual(['題名, カンマ付き', '1行目の発言\n2行目は"引用符"を含む']);
  expect(texts).toContainEqual(['通常', 'カンマ, を含む本文']);

  const before = await counts(page);
  for (const [f, msg] of [
    ['rows_1001.csv', 'CSVは1000行までです'],
    ['empty_required.csv', '3行目: 参加者が空です'],
    ['rows_101.csv', '1回の取込は100資料までです'],
  ] as const) {
    await page.goto(`./#/p/${pid}/sources`);
    await page.goto(`./#/p/${pid}/import-csv`);
    await page.locator('#csv-file').setInputFiles(path.join(FX, f));
    await expect(page.getByText(msg).first()).toBeVisible();
    await expect(page.getByRole('button', { name: /まとめて取り込む/ })).toHaveCount(f === 'rows_1001.csv' ? 0 : 1);
    if (f !== 'rows_1001.csv') await expect(page.getByRole('button', { name: /まとめて取り込む/ })).toBeDisabled();
  }
  // Shift_JIS CSV needs the encoding switch
  await page.goto(`./#/p/${pid}/sources`);
  await page.goto(`./#/p/${pid}/import-csv`);
  await page.locator('#csv-file').setInputFiles(path.join(FX, 'sjis.csv'));
  await expect(page.getByText('文字コードとして読めない部分があります')).toBeVisible();
  await page.getByLabel('文字コード').selectOption('shift_jis');
  await expect(page.getByText('シフトJISの本文')).toBeVisible();
  expect(await counts(page)).toEqual(before);

  // TXT: broken UTF-8 and NUL are refused in preview; SJIS TXT works when selected
  await page.goto(`./#/p/${pid}/sources`);
  await page.getByRole('button', { name: '文章を追加' }).first().click();
  const dlg = page.getByRole('dialog');
  await dlg.locator('#txt-files').setInputFiles([path.join(FX, 'broken_utf8.txt'), path.join(FX, 'nul.txt')]);
  await expect(dlg.getByText('文字コードとして読めない部分があります').first()).toBeVisible();
  await expect(dlg.getByText('NUL文字を含むため取り込めません').first()).toBeVisible();
  await dlg.locator('#txt-files').setInputFiles([path.join(FX, 'sjis.txt')]);
  await dlg.getByLabel('文字コード').selectOption('shift_jis');
  await expect(dlg.getByText('シフトJISの発言です。')).toBeVisible();
  await dlg.getByRole('button', { name: '1件を取り込む' }).click();
  await expect(dlg.getByText('1件の資料をこの端末に保存しました')).toBeVisible();
});

test('AC05: double clicks create once; deleting the evidence source returns the finding to draft and blocks formal output', async ({ page }) => {
  await installLicense(page);
  await createProject(page, '削除の確認');
  const pid = projectIdFromUrl(page.url());
  // double click on import confirm → one batch
  await page.getByRole('button', { name: '文章を追加' }).first().click();
  const dlg = page.getByRole('dialog');
  await dlg.locator('#txt-files').setInputFiles([path.join(EXAMPLES, 'interview_P01.txt'), path.join(EXAMPLES, 'interview_P02.txt')]);
  await dlg.getByRole('button', { name: '2件を取り込む' }).dblclick();
  await expect(dlg.getByText('2件の資料をこの端末に保存しました')).toBeVisible();
  await dlg.getByRole('button', { name: '閉じる' }).last().click();
  expect((await counts(page)).sources).toBe(2);
  // duplicate content warning
  await page.getByRole('button', { name: '文章を追加' }).first().click();
  await page.getByRole('dialog').locator('#txt-files').setInputFiles([path.join(EXAMPLES, 'interview_P01.txt')]);
  await expect(page.getByRole('dialog').getByText(/S01（P01） と同じ本文です/).first()).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: '閉じる' }).click();

  await page.locator('.table-list > li', { hasText: 'S01' }).getByRole('link', { name: '読む' }).click();
  await selectInReader(page, '商品ページで総額の目安が分かると助かります。');
  await quoteSelection(page);
  // the same range again opens the existing excerpt instead of creating a new one
  await selectInReader(page, '商品ページで総額の目安が分かると助かります。');
  await page.getByRole('button', { name: '選択を引用' }).click();
  await expect(page.getByRole('dialog', { name: '引用を編集' })).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'やめる' }).click();
  expect((await counts(page)).excerpts).toBe(1);

  await page.goto(`./#/p/${pid}/themes`);
  await page.locator('.quote-rows li').first().getByRole('checkbox').check();
  await page.getByRole('button', { name: '選択した引用で気づきを作る' }).click();
  await page.getByRole('dialog').getByLabel('見出し（気づき）').fill('総額の見通し');
  await page.getByRole('dialog').getByRole('button', { name: '作成して編集する' }).dblclick();
  await expect(page.getByLabel('見出し（気づき）')).toHaveValue('総額の見通し');
  expect((await counts(page)).findings).toBe(1);
  await page.getByLabel('観察と解釈').fill('解釈');
  await page.getByLabel('改善案（次の一手）').fill('提案');
  await page.getByLabel('次に確認すること').fill('確認');
  await page.getByLabel('次に確認すること').blur();
  await page.getByRole('button', { name: '提出可にする' }).click();
  await expect(page.getByText('現在の状態：提出可')).toBeVisible();
  await page.getByLabel('提案書に採用').click();
  await expect(page.getByLabel('提案書に採用')).toBeChecked();

  await page.goto(`./#/p/${pid}/sources`);
  await page.getByRole('button', { name: 'S01を削除' }).click();
  await expect(page.getByRole('dialog')).toContainText('引用1件も削除されます');
  await expect(page.getByRole('dialog')).toContainText('気づき1件は「草案」に戻ります');
  await page.getByRole('dialog').getByRole('button', { name: '削除する' }).click();
  await expect(page.locator('.table-list > li')).toHaveCount(1);
  await page.goto(`./#/p/${pid}/findings`);
  await expect(page.locator('.status-badge.draft')).toBeVisible();
  await page.goto(`./#/p/${pid}/report`);
  await expect(page.getByRole('button', { name: 'HTMLを保存' })).toBeDisabled();
  await expect(page.getByText('未：採用した気づきが全て「提出可」')).toBeVisible();
});
