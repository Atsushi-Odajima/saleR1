import { expect, type Page } from '@playwright/test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// @ts-expect-error plain mjs helper
import { ensureTestKeys, signRaw } from '../../scripts/lib/license-lib.mjs';

export const EXAMPLES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../R01_Koeito/examples');
export const tmp = () => mkdtempSync(path.join(tmpdir(), 'koeito-e2e-'));

export async function testLicenseFile(): Promise<string> {
  const k = await ensureTestKeys();
  const lic = await signRaw(k.priv, { version: 1, product: 'koeito', licenseId: '6f1c1f2e-3c55-4b7e-9f63-0d8f0e3b1a11', edition: 'personal-v1', issuedAt: '2026-10-04T00:00:00.000Z', major: 1 });
  const f = path.join(tmp(), 'test.koeito-license');
  writeFileSync(f, JSON.stringify(lic));
  return f;
}

export async function installLicense(page: Page) {
  await page.goto('./#/settings');
  await page.locator('#lic-file').setInputFiles(await testLicenseFile());
  await expect(page.getByText('ライセンスを読み込みました')).toBeVisible();
}

export async function createProject(page: Page, title: string, question = '初めて購入する人は、商品ページのどこで迷っているか。') {
  await page.goto('./#/');
  await page.getByRole('button', { name: '新しい調査を作る' }).first().click();
  const dlg = page.getByRole('dialog');
  await dlg.getByLabel('調査の題名').fill(title);
  await dlg.getByLabel('調査の問い').fill(question);
  await dlg.getByRole('button', { name: '作成する' }).click();
  await expect(page.getByRole('heading', { name: '声を集める' })).toBeVisible();
}

export async function importTxt(page: Page, files: string[], encoding: 'utf-8' | 'shift_jis' = 'utf-8') {
  await page.getByRole('button', { name: '文章を追加' }).first().click();
  const dlg = page.getByRole('dialog');
  if (encoding !== 'utf-8') await dlg.getByLabel('文字コード').selectOption(encoding);
  await dlg.locator('#txt-files').setInputFiles(files);
  await dlg.getByRole('button', { name: new RegExp(`${files.length}件を取り込む`) }).click();
  await expect(dlg.getByText(`${files.length}件の資料をこの端末に保存しました`)).toBeVisible();
  await dlg.getByRole('button', { name: '閉じる' }).last().click();
}

/** Select `phrase` (nth occurrence) inside the reader using a real DOM Range. */
export async function selectInReader(page: Page, phrase: string, occurrence = 0) {
  await page.locator('.reader [data-o]').first().waitFor();
  await page.evaluate(
    ({ phrase, occurrence }) => {
      const root = document.querySelector('[data-reader]')!;
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode: (n) => (n.parentElement?.closest('[data-o]') ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
      });
      const nodes: Text[] = [];
      let full = '';
      const starts: number[] = [];
      while (walker.nextNode()) {
        const t = walker.currentNode as Text;
        starts.push(full.length);
        nodes.push(t);
        full += t.data;
      }
      let idx = -1;
      for (let i = 0; i <= occurrence; i++) idx = full.indexOf(phrase, idx + 1);
      if (idx < 0) throw new Error('phrase not found: ' + phrase);
      const locate = (off: number, end: boolean) => {
        for (let i = nodes.length - 1; i >= 0; i--) {
          if (starts[i]! < off || (!end && starts[i] === off) || (end && starts[i]! < off)) return { node: nodes[i]!, offset: off - starts[i]! };
        }
        return { node: nodes[0]!, offset: 0 };
      };
      const a = locate(idx, false);
      const b = locate(idx + phrase.length, true);
      const r = document.createRange();
      r.setStart(a.node, a.offset);
      r.setEnd(b.node, b.offset);
      const sel = window.getSelection()!;
      sel.removeAllRanges();
      sel.addRange(r);
    },
    { phrase, occurrence },
  );
}

export async function quoteSelection(page: Page, themes: string[] = []) {
  await page.getByRole('button', { name: '選択を引用' }).click();
  const dlg = page.getByRole('dialog');
  for (const t of themes) {
    const box = dlg.getByRole('checkbox', { name: t });
    if (await box.count()) await box.check();
    else {
      await dlg.getByPlaceholder('新しいテーマ名').fill(t);
      await dlg.getByRole('button', { name: 'テーマを追加' }).click();
      await expect(dlg.getByRole('checkbox', { name: t })).toBeChecked();
    }
  }
  await dlg.getByRole('button', { name: '引用を保存' }).click();
  await expect(dlg).toBeHidden();
}

export function projectIdFromUrl(url: string): string {
  const m = /#\/p\/([0-9a-f-]{36})/.exec(url);
  if (!m) throw new Error('no project id in ' + url);
  return m[1]!;
}
