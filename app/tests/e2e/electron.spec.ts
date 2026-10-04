// Electron shell: security posture, custom protocol, persistence across restart, printToPDF (AC10 on Linux).
// Windows-specific behaviour (NSIS/portable, Windows fonts/printing) is NOT covered here.
import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { testLicenseFile, EXAMPLES } from './helpers';
import { renderReportHtml, REPORT_STATIC_TEXT } from '../../src/domain/reportHtml';
import { reportStrings, type ReportDTO } from '../../src/domain/report';
import { loadHarfbuzz, subsetFont } from '../../src/platform/fontSubset';

const home = mkdtempSync(path.join(tmpdir(), 'koeito-electron-'));
const pdfOut = path.join(home, 'out.pdf');
const args = ['.', ...(process.getuid?.() === 0 ? ['--no-sandbox'] : [])];
const launch = () => electron.launch({ args, env: { ...process.env, XDG_CONFIG_HOME: home, HOME: home, KOEITO_E2E_PDF_OUT: pdfOut } });

async function firstWindow(app: ElectronApplication) {
  const w = await app.firstWindow();
  await w.waitForLoadState('domcontentloaded');
  return w;
}

test.describe.configure({ mode: 'serial' });

test('Electron: secure defaults, narrow bridge, protocol confinement, blocked navigation', async () => {
  const app = await launch();
  const w = await firstWindow(app);
  expect(w.url()).toBe('koeito://app/index.html');
  const prefs = await app.evaluate(({ BrowserWindow }) => {
    const p = (BrowserWindow.getAllWindows()[0]!.webContents as unknown as { getLastWebPreferences(): Record<string, unknown> }).getLastWebPreferences();
    return { contextIsolation: p.contextIsolation, sandbox: p.sandbox, nodeIntegration: p.nodeIntegration, webSecurity: p.webSecurity };
  });
  expect(prefs).toEqual({ contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true });
  const r = await w.evaluate(async () => {
    const out: Record<string, unknown> = {};
    out.require = typeof (window as unknown as { require?: unknown }).require;
    out.process = typeof (window as unknown as { process?: unknown }).process;
    out.bridge = Object.keys(window.koeito ?? {}).sort();
    out.traversal = (await fetch('koeito://app/%2e%2e/package.json').catch(() => ({ status: -1 }))).status;
    out.traversal2 = (await fetch('koeito://app/..%2fpackage.json').catch(() => ({ status: -1 }))).status;
    out.external = await fetch('https://example.org/').then(() => 'reached', () => 'blocked');
    out.open = window.open('https://example.org/') === null;
    out.csp = document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute('content')?.includes("script-src 'self'");
    return out;
  });
  expect(r).toEqual({ require: 'undefined', process: 'undefined', bridge: ['chooseBackupFile', 'openExternal', 'platform', 'savePdf', 'saveTextFile'], traversal: 404, traversal2: 404, external: 'blocked', open: true, csp: true });
  // navigation away is refused
  await w.evaluate(() => { location.href = 'https://example.org/'; }).catch(() => {});
  await w.waitForTimeout(500);
  expect(w.url().startsWith('koeito://app/')).toBe(true);
  const perms = await w.evaluate(async () => (await navigator.permissions.query({ name: 'notifications' as PermissionName })).state).catch(() => 'denied');
  expect(perms).not.toBe('granted');
  await app.close();
});

test('Electron: license + data persist across restart (userData profile)', async () => {
  let app = await launch();
  let w = await firstWindow(app);
  await w.evaluate(() => (location.hash = '#/settings'));
  await w.locator('#lic-file').setInputFiles(await testLicenseFile());
  await expect(w.getByText('ライセンスを読み込みました')).toBeVisible();
  await w.evaluate(() => (location.hash = '#/'));
  await w.getByRole('button', { name: '新しい調査を作る' }).first().click();
  await w.getByRole('dialog').getByLabel('調査の題名').fill('Windows版の確認');
  await w.getByRole('dialog').getByLabel('調査の問い').fill('再起動後も残るか');
  await w.getByRole('dialog').getByRole('button', { name: '作成する' }).click();
  await w.getByRole('button', { name: '文章を追加' }).first().click();
  await w.getByRole('dialog').locator('#txt-files').setInputFiles([path.join(EXAMPLES, 'interview_P01.txt')]);
  await w.getByRole('dialog').getByRole('button', { name: '1件を取り込む' }).click();
  await expect(w.getByText('1件の資料をこの端末に保存しました')).toBeVisible();
  const userData = await app.evaluate(({ app }) => app.getPath('userData'));
  expect(userData.endsWith('Koeito')).toBe(true);
  await app.close();

  app = await launch();
  w = await firstWindow(app);
  await expect(w.getByRole('link', { name: 'Windows版の確認' })).toBeVisible();
  await w.getByRole('link', { name: 'Windows版の確認' }).click();
  await expect(w.locator('.table-list > li')).toHaveCount(1);
  // second instance is refused by the single-instance lock
  const second = await electron.launch({ args, env: { ...process.env, XDG_CONFIG_HOME: home, HOME: home } }).then(
    async (a) => {
      const n = await a.windows().length;
      await a.close().catch(() => {});
      return n;
    },
    () => 0,
  );
  expect(second).toBe(0);
  await app.close();
});

function longDto(findings: number): ReportDTO {
  const q300 = '送料が分からないと迷います。'.repeat(22).slice(0, 300);
  const q800 = '到着の目安と返品の条件も知りたいです。'.repeat(45).slice(0, 800);
  return {
    draft: false,
    title: '購入体験の改善提案 — 送料・到着日・返品条件の見通しについての聞き取り調査',
    question: '初めて購入する人は、商品ページのどこで迷っているか。',
    periodStart: '2026-09-01',
    periodEnd: null,
    limitations: '既存顧客6人への聞き取り。件数は母集団の割合ではない。',
    sourceCount: 6,
    participantCount: 6,
    createdDate: '2026年10月5日',
    findings: Array.from({ length: findings }, (_, i) => ({
      no: i + 1,
      title: `気づき${i + 1}：価格の不安は、送料が見えないことから生まれ、購入直前の離脱につながっている可能性がある`,
      interpretation: '初めて購入する人には、注文確定の前に総額を把握したいという声がある。\n一方で、慣れた人には説明が増えることが負担になりそうだ。',
      proposal: '商品詳細に送料の目安を短く表示し、詳しい条件は開いて読めるようにする。',
      expectedChange: 'カート投入前の迷いが減る。',
      nextCheck: '初回購入者が、総額の目安を自分で見つけられるか。',
      counterCheck: i % 2 ? 'found' : 'not_checked',
      counterCheckLabel: i % 2 ? '異なる声あり' : '反証確認は未実施',
      counterNote: i % 2 ? '常連の利用者からは懸念があった。' : '',
      supports: [
        { text: i === 0 ? q800 : q300, alias: 'P01', sourceLabel: 'S01', paragraphLabel: 'P002' },
        { text: '［伏字］の件でカートに入れる前に迷います。', alias: 'P02', sourceLabel: 'S02', paragraphLabel: 'P003' },
      ],
      contradicts: i % 2 ? [{ text: '説明が増えると商品写真が見づらくなりそうです。', alias: 'P03', sourceLabel: 'S03', paragraphLabel: 'P002' }] : [],
      context: [],
      supportsExcerpts: 2,
      supportsParticipants: 2,
      contradictsExcerpts: i % 2,
      contradictsParticipants: i % 2,
      draftNotes: [],
    })),
  };
}

async function pdfInfo(file: string) {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(file)) }).promise;
  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const c = await (await doc.getPage(i)).getTextContent();
    pages.push(c.items.map((x) => ('str' in x ? x.str : '')).join(''));
  }
  return pages;
}

test('AC10 (Linux Electron): printToPDF — Japanese, long headings, multi-page, 300/800 char quotes, 0 and 50 findings', async () => {
  const hb = await loadHarfbuzz(async () => readFileSync('node_modules/harfbuzzjs/dist/harfbuzz-subset.wasm'));
  const font = (f: string) => new Uint8Array(readFileSync(`../R01_Koeito/assets/fonts/${f}`));
  const app = await launch();
  const w = await firstWindow(app);
  const results: Record<string, number> = {};
  for (const n of [0, 50]) {
    const dto = longDto(n);
    const text = reportStrings(dto) + REPORT_STATIC_TEXT;
    const html = renderReportHtml(dto, [
      { family: 'KoeitoSerif', dataB64: Buffer.from(subsetFont(hb, font('NotoSerifJP.ttf'), text)).toString('base64') },
      { family: 'KoeitoSans', dataB64: Buffer.from(subsetFont(hb, font('NotoSansJP.ttf'), text)).toString('base64') },
      { family: 'KoeitoBrand', dataB64: Buffer.from(subsetFont(hb, font('Fraunces.ttf'), '0123456789')).toString('base64') },
    ]);
    writeFileSync(path.join(home, `report-${n}.html`), html);
    expect(await w.evaluate((h) => (window as unknown as { koeitoTest: { pdf(h: string): Promise<boolean> } }).koeitoTest.pdf(h), html)).toBe(true);
    const pages = await pdfInfo(pdfOut);
    results[`findings=${n} pages`] = pages.length;
    // no blank pages, Japanese text extractable (embedded fonts, no tofu)
    pages.forEach((p, i) => expect(p.replace(/\s/g, '').length, `page ${i + 1} is blank`).toBeGreaterThan(10));
    const all = pages.join('');
    expect(all).toContain('改善提案レポート');
    expect(all).not.toContain('�');
    if (n === 50) {
      expect(pages.length).toBeGreaterThan(10);
      expect(all.replace(/\s/g, '')).toContain('気づき50');
      expect(all).toContain('反証確認は未実施');
    }
    writeFileSync(path.join(home, `report-${n}.pdf`), readFileSync(pdfOut));
  }
  console.log('AC10 pdf', JSON.stringify(results), 'files in', home);
  await app.close();
});
