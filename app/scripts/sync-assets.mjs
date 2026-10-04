#!/usr/bin/env node
// Copies brand assets from the planning pack (read-only input) into app/public.
// The pack is never modified. Files are verified against the pack's SHA256SUMS.txt.
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PACK = process.env.KOEITO_PACK_DIR ? path.resolve(process.env.KOEITO_PACK_DIR) : path.resolve(APP, '..', 'R01_Koeito');
if (!existsSync(path.join(PACK, 'SHA256SUMS.txt'))) {
  console.error('ERROR: planning pack not found at ' + PACK + ' (set KOEITO_PACK_DIR)');
  process.exit(1);
}
const sums = new Map(
  readFileSync(path.join(PACK, 'SHA256SUMS.txt'), 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((l) => {
      const m = /^([0-9a-f]{64})\s+\*?(.+)$/.exec(l.trim());
      return m ? [m[2], m[1]] : null;
    })
    .filter(Boolean),
);
const files = [
  ['assets/fonts/Fraunces.ttf', 'public/fonts/Fraunces.ttf'],
  ['assets/fonts/NotoSansJP.ttf', 'public/fonts/NotoSansJP.ttf'],
  ['assets/fonts/NotoSerifJP.ttf', 'public/fonts/NotoSerifJP.ttf'],
  ['licenses/Fraunces-OFL.txt', 'public/licenses/Fraunces-OFL.txt'],
  ['licenses/NotoSansJP-OFL.txt', 'public/licenses/NotoSansJP-OFL.txt'],
  ['licenses/NotoSerifJP-OFL.txt', 'public/licenses/NotoSerifJP-OFL.txt'],
  ['assets/source/logo_horizontal.svg', 'public/brand/logo_horizontal.svg'],
  ['assets/source/logo_horizontal_reverse.svg', 'public/brand/logo_horizontal_reverse.svg'],
  ['assets/source/logo_mark.svg', 'public/brand/logo_mark.svg'],
  ['assets/pwa_icon_192.png', 'public/brand/pwa_icon_192.png'],
  ['assets/pwa_icon_512.png', 'public/brand/pwa_icon_512.png'],
  ['assets/apple_touch_icon_180.png', 'public/brand/apple_touch_icon_180.png'],
  ['assets/source/pwa_icon.svg', 'public/brand/pwa_icon.svg'],
];
for (const [from, to] of files) {
  const src = path.join(PACK, from);
  const buf = readFileSync(src);
  const h = createHash('sha256').update(buf).digest('hex');
  const expected = sums.get(from);
  if (expected && expected !== h) {
    console.error(`ERROR: checksum mismatch for ${from}`);
    process.exit(1);
  }
  const dst = path.join(APP, to);
  mkdirSync(path.dirname(dst), { recursive: true });
  if (!existsSync(dst) || createHash('sha256').update(readFileSync(dst)).digest('hex') !== h) copyFileSync(src, dst);
}
console.log('brand assets synced from ' + PACK);
