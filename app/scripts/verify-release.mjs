#!/usr/bin/env node
// Release gate. Fails unless the buyer folder is complete, built in release mode with the seller's real
// configuration, free of test keys / private key material, and checksummed.
// Code signing cannot be verified on Linux here: it is always listed as a MANUAL item.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { loadReleaseConfig } from './lib/release-config.mjs';
import { APP_DIR, REPO_DIR, DEV_KEYS_DIR } from './lib/license-lib.mjs';

const dirArg = process.argv.find((a) => a.startsWith('--dir='));
const REL = dirArg ? path.resolve(dirArg.slice(6)) : path.join(REPO_DIR, 'release');
const version = JSON.parse(readFileSync(path.join(APP_DIR, 'package.json'), 'utf8')).version;
const results = [];
const check = (name, ok, detail = '') => results.push({ name, status: ok ? 'PASS' : 'FAIL', detail });
const manual = (name, detail) => results.push({ name, status: 'MANUAL', detail });

const { errors } = loadReleaseConfig();
check('release-config.json has real values', errors.length === 0, errors.join('; '));

const info = existsSync(path.join(APP_DIR, 'dist/release-info.json')) ? JSON.parse(readFileSync(path.join(APP_DIR, 'dist/release-info.json'), 'utf8')) : null;
check('dist/ built in release mode', info?.kind === 'release', info ? `kind=${info.kind}` : 'dist/release-info.json missing');

const expected = [`Koeito-Setup-${version}.exe`, `Koeito-Portable-${version}.exe`, `Koeito-PWA-${version}.zip`, 'README_JA.txt', 'QUICKSTART.txt', 'FAQ.txt', 'THIRD_PARTY_LICENSES.txt', 'SHA256SUMS.txt'];
const present = existsSync(REL) ? readdirSync(REL) : [];
for (const f of expected) check(`artifact ${f}`, present.includes(f));
check('no TEST artifacts in release folder', !present.some((f) => /TEST/i.test(f)), present.filter((f) => /TEST/i.test(f)).join(', '));

// test key / private key material must not ship
const needles = [];
const testPub = path.join(DEV_KEYS_DIR, 'test-public.jwk.json');
if (existsSync(testPub)) needles.push({ what: 'TEST public key', s: JSON.parse(readFileSync(testPub, 'utf8')).x });
const testPriv = path.join(DEV_KEYS_DIR, 'test-private.jwk.json');
if (existsSync(testPriv)) needles.push({ what: 'TEST private key', s: JSON.parse(readFileSync(testPriv, 'utf8')).d });
const patterns = [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, /"d"\s*:\s*"[A-Za-z0-9_-]{40,}"/];
const scan = (file) => {
  const buf = readFileSync(file);
  const s = buf.toString('latin1');
  const hits = needles.filter((n) => s.includes(n.s)).map((n) => n.what);
  for (const p of patterns) if (p.test(s)) hits.push(`pattern ${p}`);
  return hits;
};
const walk = (d) => readdirSync(d).flatMap((f) => (statSync(path.join(d, f)).isDirectory() ? walk(path.join(d, f)) : [path.join(d, f)]));
const asar = path.join(APP_DIR, 'out/win/win-unpacked/resources/app.asar'); // the NSIS exe is compressed; scan its payload
check('packaged app.asar present for scanning', existsSync(asar), 'run dist:win first');
const targets = [...(existsSync(path.join(APP_DIR, 'dist')) ? walk(path.join(APP_DIR, 'dist')) : []), ...(existsSync(asar) ? [asar] : []), ...present.map((f) => path.join(REL, f))];
const leaks = targets.flatMap((f) => scan(f).map((h) => `${path.relative(REPO_DIR, f)}: ${h}`));
check('no test key / private key material in dist and release artifacts', leaks.length === 0, leaks.join('; '));

if (present.includes('SHA256SUMS.txt')) {
  const lines = readFileSync(path.join(REL, 'SHA256SUMS.txt'), 'utf8').trim().split('\n');
  const bad = lines.filter((l) => {
    const [h, f] = l.split(/\s+/);
    return !existsSync(path.join(REL, f)) || createHash('sha256').update(readFileSync(path.join(REL, f))).digest('hex') !== h;
  });
  check('SHA256SUMS.txt matches files', bad.length === 0, bad.join('; '));
}
manual('Authenticode signature of both .exe', 'Verify on Windows: Get-AuthenticodeSignature .\\Koeito-Setup-*.exe → Status = Valid (seller certificate). Unsigned builds must not be published.');
manual('Windows 11 install / first launch / license / export / restart (AC18)', 'Run on a clean Windows 11 x64 without Node.js.');
manual('PWA HTTPS hosting, _headers, deep link #/ routes (AC18)', 'Deploy Koeito-PWA zip to the HTTPS URL in release-config.json.');

for (const r of results) console.log(`${r.status.padEnd(6)} ${r.name}${r.detail ? ' — ' + r.detail : ''}`);
const failed = results.filter((r) => r.status === 'FAIL').length;
console.log(failed ? `\nverify:release FAILED (${failed} failing checks)` : '\nverify:release passed automated checks; MANUAL items remain for the seller.');
process.exit(failed ? 1 : 0);
