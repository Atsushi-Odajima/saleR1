#!/usr/bin/env node
// Windows 11 x64 distributables: NSIS per-user installer + portable exe.
// Release builds require a valid release-config.json (real PWA URL, public key, seller contact).
// KOEITO_ALLOW_TEST_BUILD=1 produces clearly-labelled TEST candidates in release-test/ instead (never for sale).
import { execSync } from 'node:child_process';
import { rmSync, mkdirSync, readdirSync, copyFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { loadReleaseConfig } from './lib/release-config.mjs';
import { APP_DIR } from './lib/license-lib.mjs';

const { errors } = loadReleaseConfig();
const allowTest = process.env.KOEITO_ALLOW_TEST_BUILD === '1';
if (errors.length && !allowTest) {
  console.error('dist:win refused — release-config.json is missing or invalid:\n - ' + errors.join('\n - '));
  console.error('Fill in real values (see release-config.example.json). For a TEST candidate only: KOEITO_ALLOW_TEST_BUILD=1 npm run dist:win');
  process.exit(1);
}
const release = errors.length === 0;
const run = (cmd) => execSync(cmd, { stdio: 'inherit', cwd: APP_DIR, env: process.env });
run('node scripts/sync-assets.mjs');
run('node scripts/ensure-test-keys.mjs');
run(release ? 'npx vite build --mode release' : 'npx vite build');
run('npm run build:electron');
rmSync(path.join(APP_DIR, 'out/win'), { recursive: true, force: true });
// Without a code-signing certificate the executables are UNSIGNED (recorded in docs/TEST_REPORT.txt).
run('npx electron-builder --win --x64 --publish never');
const version = JSON.parse(readFileSync(path.join(APP_DIR, 'package.json'), 'utf8')).version;
const outDir = path.join(APP_DIR, '..', release ? 'release' : 'release-test');
mkdirSync(outDir, { recursive: true });
for (const f of readdirSync(path.join(APP_DIR, 'out/win'))) {
  if (!f.endsWith('.exe')) continue;
  const dst = release ? f : f.replace(`-${version}.exe`, `-${version}-TEST.exe`);
  copyFileSync(path.join(APP_DIR, 'out/win', f), path.join(outDir, dst));
  console.log('→ ' + path.join(outDir, dst));
}
