// AC08 (UI part): create encrypted backup, wrong password, restore into a fresh profile, duplicate warning.
import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { EXAMPLES, installLicense, createProject, importTxt, tmp } from './helpers';

test('AC08: backup → wrong password → restore as new project → re-import warns', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const a = await ctxA.newPage();
  await installLicense(a);
  await createProject(a, 'バックアップ元');
  await importTxt(a, [path.join(EXAMPLES, 'interview_P01.txt'), path.join(EXAMPLES, 'interview_P02.txt')]);
  await a.goto('./#/settings');
  await a.getByLabel('パスワード（12〜128文字）').fill('short');
  await a.getByLabel('パスワード（確認）').fill('short');
  await a.getByRole('button', { name: 'バックアップを保存' }).click();
  await expect(a.getByText('パスワードは12〜128文字にしてください')).toBeVisible();
  await a.getByLabel('パスワード（12〜128文字）').fill('correct horse battery');
  await a.getByLabel('パスワード（確認）').fill('correct horse battery');
  const [dl] = await Promise.all([a.waitForEvent('download'), a.getByRole('button', { name: 'バックアップを保存' }).click()]);
  expect(dl.suggestedFilename()).toMatch(/^koeito-backup-\d{8}\.koeito$/);
  const file = path.join(tmp(), dl.suggestedFilename());
  await dl.saveAs(file);
  await expect(a.getByText('ファイルを作成しました（ブラウザのダウンロード）')).toBeVisible();
  const env = JSON.parse(readFileSync(file, 'utf8'));
  expect(env.format).toBe('koeito-backup');
  expect(readFileSync(file, 'utf8')).not.toContain('送料');
  await ctxA.close();

  // fresh profile = another device
  const ctxB = await browser.newContext();
  const b = await ctxB.newPage();
  await installLicense(b);
  await b.locator('#rs-file').setInputFiles(file);
  await b.getByLabel('パスワード', { exact: true }).fill('wrong password!!');
  await b.getByRole('button', { name: '内容を確認する' }).click();
  await expect(b.getByText('パスワードが違うか、ファイルが改変・破損しています')).toBeVisible();
  await b.getByLabel('パスワード', { exact: true }).fill('correct horse battery');
  await b.getByRole('button', { name: '内容を確認する' }).click();
  await expect(b.getByText('調査1件・資料2件・引用0件・気づき0件', { exact: false })).toBeVisible();
  await b.getByRole('button', { name: '新しい調査として読み込む' }).click();
  await expect(b.getByText('1件の調査を新しい調査として読み込みました')).toBeVisible();
  await b.goto('./#/');
  await expect(b.getByRole('link', { name: 'バックアップ元' })).toBeVisible();

  // the same file again → warning + explicit approval, title gets （読込）
  await b.goto('./#/settings');
  await b.locator('#rs-file').setInputFiles(file);
  await b.getByLabel('パスワード', { exact: true }).fill('correct horse battery');
  await b.getByRole('button', { name: '内容を確認する' }).click();
  await expect(b.getByRole('button', { name: '新しい調査として読み込む' })).toBeDisabled();
  await b.getByLabel(/このファイルは以前にも読み込んでいます/).check();
  await b.getByRole('button', { name: '新しい調査として読み込む' }).click();
  await expect(b.getByText('1件の調査を新しい調査として読み込みました')).toBeVisible();
  await b.goto('./#/');
  await expect(b.getByRole('link', { name: 'バックアップ元（読込）' })).toBeVisible();

  // tampered file → refused, nothing added
  const env2 = JSON.parse(readFileSync(file, 'utf8'));
  env2.kdf.iterations = 100000000;
  const bad = path.join(tmp(), 'bad.koeito');
  writeFileSync(bad, JSON.stringify(env2));
  await b.goto('./#/settings');
  await b.locator('#rs-file').setInputFiles(bad);
  await b.getByLabel('パスワード', { exact: true }).fill('correct horse battery');
  await b.getByRole('button', { name: '内容を確認する' }).click();
  await expect(b.getByText('暗号化の設定が想定外のため読み込みません')).toBeVisible();
  await b.goto('./#/');
  await expect(b.locator('.project-list li')).toHaveCount(2);
  await ctxB.close();
});
