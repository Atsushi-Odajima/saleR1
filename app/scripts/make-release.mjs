#!/usr/bin/env node
// Assemble the buyer folder (release/ or release-test/) and the seller's source.zip.
//   buyer:  exe (dist:win), PWA zip (build:pwa), README_JA / QUICKSTART / FAQ, THIRD_PARTY_LICENSES, SHA256SUMS
//   seller: seller/source.zip (git-tracked files only — no node_modules, keys, builds)
// Usage: node scripts/make-release.mjs [--test]
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { APP_DIR, REPO_DIR } from './lib/license-lib.mjs';
import { zipFiles } from './lib/zip.mjs';

const test = process.argv.includes('--test');
const out = path.join(REPO_DIR, test ? 'release-test' : 'release');
mkdirSync(out, { recursive: true });
for (const f of ['README_JA.txt', 'QUICKSTART.txt', 'FAQ.txt']) copyFileSync(path.join(REPO_DIR, 'release-docs', f), path.join(out, f));

// THIRD_PARTY_LICENSES: every package bundled into the renderer + Electron runtime + fonts
const pkgs = ['react', 'react-dom', 'scheduler', 'dexie', 'dexie-react-hooks', 'zod', 'papaparse', 'graphemer', 'fake-indexeddb', 'harfbuzzjs', 'electron'];
let tpl = 'Koeito — 第三者ライセンス / THIRD-PARTY LICENSES\n本ソフトウェアは以下のソフトウェア・フォントを含みます。各ライセンス本文を収録します。\n';
tpl += 'Electron の実行ファイルには Chromium 等のライセンスが LICENSES.chromium.html として同梱されています（インストール先フォルダー）。\n';
for (const p of pkgs) {
  const dir = path.join(APP_DIR, 'node_modules', p);
  const pj = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8'));
  const lic = readdirSync(dir).find((f) => /^licen[cs]e/i.test(f));
  tpl += `\n==================== ${p} ${pj.version} (${pj.license}) ====================\n`;
  tpl += lic ? readFileSync(path.join(dir, lic), 'utf8') : '(license file not found in package)\n';
}
for (const f of ['Fraunces-OFL.txt', 'NotoSansJP-OFL.txt', 'NotoSerifJP-OFL.txt']) {
  tpl += `\n==================== ${f.replace('-OFL.txt', '')} (SIL Open Font License 1.1) ====================\n`;
  tpl += readFileSync(path.join(REPO_DIR, 'R01_Koeito', 'licenses', f), 'utf8');
}
writeFileSync(path.join(out, 'THIRD_PARTY_LICENSES.txt'), tpl);

// SHA256SUMS over everything in the buyer folder
const files = readdirSync(out).filter((f) => f !== 'SHA256SUMS.txt').sort();
const sums = files.map((f) => `${createHash('sha256').update(readFileSync(path.join(out, f))).digest('hex')}  ${f}`).join('\n') + '\n';
writeFileSync(path.join(out, 'SHA256SUMS.txt'), sums);
console.log(`buyer folder: ${out}\n${sums}`);

// seller source.zip from git-tracked files
const tracked = execSync('git ls-files', { cwd: REPO_DIR, encoding: 'utf8' }).split('\n').filter(Boolean).filter((f) => !/(^|\/)(node_modules|\.dev-keys)\//.test(f) && !/private|\.pem$/i.test(f));
mkdirSync(path.join(REPO_DIR, 'seller'), { recursive: true });
const zip = path.join(REPO_DIR, 'seller', 'source.zip');
zipFiles(tracked.filter((f) => existsSync(path.join(REPO_DIR, f))).map((f) => [`koeito/${f}`, path.join(REPO_DIR, f)]), zip);
console.log('seller source: ' + zip + ` (${tracked.length} files)`);
