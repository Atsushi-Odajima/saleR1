// AC09: private values never reach HTML, PDF text, CSV or DOM attributes of the deliverable.
import { test, expect, type Page } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { installLicense, createProject, selectInReader, projectIdFromUrl, tmp } from './helpers';
// pdfjs legacy build works in Node
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

const SECRETS = ['SECRET_SOURCE_A', 'SECRET_NOTE_B', '本名テスト値', 'SECRET_TITLE_C', 'SECRET_FILE_D'];

async function pdfText(bytes: Uint8Array): Promise<string> {
  const doc = await pdfjs.getDocument({ data: bytes, useSystemFonts: false }).promise;
  let out = '';
  for (let i = 1; i <= doc.numPages; i++) {
    const c = await (await doc.getPage(i)).getTextContent();
    out += c.items.map((x) => ('str' in x ? x.str : '')).join('') + '\n';
  }
  return out;
}

async function downloadText(page: Page, click: () => Promise<void>): Promise<string> {
  const [dl] = await Promise.all([page.waitForEvent('download'), click()]);
  return readFileSync((await dl.path())!, 'utf8');
}

test('AC09: no private values in HTML / PDF text / CSV / DOM attributes', async ({ page, browser }) => {
  await installLicense(page);
  await createProject(page, '漏洩確認の調査');
  const pid = projectIdFromUrl(page.url());
  // CSV with a real-looking name, secret title and secret file name
  const dir = tmp();
  const csv = path.join(dir, 'interviews_SECRET_FILE_D.csv');
  writeFileSync(csv, 'participant,title,text\r\n本名テスト値 山田,SECRET_TITLE_C,"公開してよい発言です。SECRET_SOURCE_A の件で困りました。\r\n別の段落です。"\r\n');
  await page.goto(`./#/p/${pid}/import-csv`);
  await page.locator('#csv-file').setInputFiles(csv);
  await page.getByRole('button', { name: /1件をまとめて取り込む/ }).click();
  await expect(page.getByText('1件の資料をこの端末に保存しました')).toBeVisible();
  // internal note on the participant
  await page.goto(`./#/p/${pid}/sources`);
  await page.getByRole('button', { name: '別名・メモを編集' }).click();
  await page.getByRole('dialog').getByLabel('内部メモ（提案書には出ません）').fill('SECRET_NOTE_B 本名テスト値');
  await page.getByRole('dialog').getByRole('button', { name: '保存する' }).click();
  // excerpt with redaction + secret note
  await page.locator('.table-list > li').getByRole('link', { name: '読む' }).click();
  await selectInReader(page, '公開してよい発言です。SECRET_SOURCE_A の件で困りました。');
  await page.getByRole('button', { name: '選択を引用' }).click();
  const dlg = page.getByRole('dialog');
  await dlg.getByLabel('伏字にする語句').fill('SECRET_SOURCE_A');
  await dlg.getByRole('button', { name: '語句をすべて伏字にする' }).click();
  await expect(dlg.locator('.quote-box.public')).toHaveText('公開してよい発言です。［伏字］ の件で困りました。');
  await dlg.getByLabel('内部メモ（提案書には出ません）').fill('SECRET_NOTE_B');
  await dlg.getByRole('button', { name: '引用を保存' }).click();
  await expect(dlg).toBeHidden();
  // finding
  await page.goto(`./#/p/${pid}/themes`);
  await page.locator('.quote-rows li').first().getByRole('checkbox').check();
  await page.getByRole('button', { name: '選択した引用で気づきを作る' }).click();
  await page.getByRole('dialog').getByLabel('見出し（気づき）').fill('説明の不足');
  await page.getByRole('dialog').getByRole('button', { name: '作成して編集する' }).click();
  await page.getByLabel('観察と解釈').fill('解釈です。');
  await page.getByLabel('改善案（次の一手）').fill('提案です。');
  await page.getByLabel('次に確認すること').fill('確認です。');
  await page.getByLabel('次に確認すること').blur();
  await expect(page.getByText('提出に必要な項目はそろっています')).toBeVisible();
  await page.getByRole('button', { name: '提出可にする' }).click();
  await page.getByLabel('提案書に採用').click();
  await expect(page.getByLabel('提案書に採用')).toBeChecked();
  await page.goto(`./#/p/${pid}/report`);
  await page.getByLabel('調査の限界').fill('1人のみ。');
  await page.getByLabel('調査の限界').blur();
  await page.getByRole('checkbox', { name: '公開内容を確認しました' }).click();
  await expect(page.locator('.checklist li.ok')).toHaveCount(4);

  const html = await downloadText(page, () => page.getByRole('button', { name: 'HTMLを保存' }).click());
  const csvOut = await downloadText(page, () => page.getByRole('button', { name: '引用CSVを保存' }).click());
  for (const s of SECRETS) {
    expect(html, `HTML contains ${s}`).not.toContain(s);
    expect(csvOut, `CSV contains ${s}`).not.toContain(s);
  }
  expect(html).toContain('［伏字］');
  expect(csvOut).toContain('［伏字］');
  expect(html).not.toMatch(/<script|\son[a-z]+\s*=|https?:\/\/|<iframe|<img|<link/i);

  // DOM of the deliverable: every attribute and text node
  const p2 = await browser.newPage();
  await p2.setContent(html);
  const dom = await p2.evaluate(() => {
    const parts: string[] = [];
    document.querySelectorAll('*').forEach((el) => {
      for (const a of Array.from(el.attributes)) parts.push(a.value);
    });
    parts.push(document.documentElement.outerHTML);
    return parts.join('\n');
  });
  for (const s of SECRETS) expect(dom).not.toContain(s);

  // PDF (browser print path) → extracted text
  const pdf = await p2.pdf({ format: 'A4', preferCSSPageSize: true, printBackground: true });
  const text = await pdfText(new Uint8Array(pdf));
  expect(text.replace(/\s/g, '')).toContain('説明の不足');
  expect(text).toContain('伏字');
  for (const s of SECRETS) expect(text).not.toContain(s);
  await p2.close();

  // in-app preview iframe (srcdoc) also never carries private values
  const srcdoc = await page.locator('iframe.preview-frame').getAttribute('srcdoc');
  for (const s of SECRETS) expect(srcdoc ?? '').not.toContain(s);
});
