#!/usr/bin/env node
// Static PWA distribution (dist/ → zip). Release mode requires release-config.json.
// KOEITO_ALLOW_TEST_BUILD=1 builds a TEST zip (test public key, "試験ビルド" banner) into release-test/.
import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { loadReleaseConfig } from './lib/release-config.mjs';
import { APP_DIR } from './lib/license-lib.mjs';
import { zipDir } from './lib/zip.mjs';

const { errors } = loadReleaseConfig();
const allowTest = process.env.KOEITO_ALLOW_TEST_BUILD === '1';
if (errors.length && !allowTest) {
  console.error('build:pwa refused — release-config.json is missing or invalid:\n - ' + errors.join('\n - '));
  process.exit(1);
}
const release = errors.length === 0;
const run = (cmd) => execSync(cmd, { stdio: 'inherit', cwd: APP_DIR });
run('node scripts/sync-assets.mjs');
run('node scripts/ensure-test-keys.mjs');
run(release ? 'npx vite build --mode release' : 'npx vite build');
const version = JSON.parse(readFileSync(path.join(APP_DIR, 'package.json'), 'utf8')).version;
const outDir = path.join(APP_DIR, '..', release ? 'release' : 'release-test');
mkdirSync(outDir, { recursive: true });
const zip = path.join(outDir, `Koeito-PWA-${version}${release ? '' : '-TEST'}.zip`);
rmSync(zip, { force: true });
await zipDir(path.join(APP_DIR, 'dist'), zip);
console.log('→ ' + zip);
