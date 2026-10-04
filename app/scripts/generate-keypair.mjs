#!/usr/bin/env node
// Seller-side: create the ECDSA P-256 license signing key pair.
// Usage: node scripts/generate-keypair.mjs --out-dir <directory-outside-repo>
// Writes koeito-license.private.jwk.json (keep secret, back up offline) and koeito-license.public.jwk.json
// (copy its content into release-config.json "licensePublicKeyJwk").
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { generateKeyPair, parseArgs, isInside, REPO_DIR } from './lib/license-lib.mjs';

const args = parseArgs(process.argv.slice(2));
if (typeof args['out-dir'] !== 'string') {
  console.error('ERROR: --out-dir <directory outside the repository> is required.');
  process.exit(1);
}
const dir = path.resolve(args['out-dir']);
if (isInside(dir, REPO_DIR)) {
  console.error('ERROR: refuse to write a private key inside the repository/source tree.');
  process.exit(1);
}
mkdirSync(dir, { recursive: true });
const privPath = path.join(dir, 'koeito-license.private.jwk.json');
if (existsSync(privPath)) {
  console.error('ERROR: a private key already exists there. Refusing to overwrite.');
  process.exit(1);
}
const { priv, pub } = await generateKeyPair();
writeFileSync(privPath, JSON.stringify(priv), { mode: 0o600 });
writeFileSync(path.join(dir, 'koeito-license.public.jwk.json'), JSON.stringify(pub, null, 2) + '\n');
console.log('created key pair in ' + dir + '\nPublic key (for release-config.json):\n' + JSON.stringify(pub));
