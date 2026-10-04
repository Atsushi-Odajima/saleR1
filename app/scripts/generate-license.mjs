#!/usr/bin/env node
// Seller-side offline license issuer.
// Usage: node scripts/generate-license.mjs --private-key-path <path-outside-repo> --out <file.koeito-license> [--license-id <uuid>] [--issued-at <iso>]
// The private key path must be given explicitly. Nothing is sent anywhere; the private key is never printed.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { parseArgs, signLicense, isInside, REPO_DIR, DEV_KEYS_DIR } from './lib/license-lib.mjs';

const args = parseArgs(process.argv.slice(2));
function fail(msg) {
  console.error('ERROR: ' + msg);
  process.exit(1);
}
if (typeof args['private-key-path'] !== 'string') fail('--private-key-path <path> is required (no default location).');
if (typeof args.out !== 'string') fail('--out <file> is required.');
const keyPath = path.resolve(args['private-key-path']);
if (!existsSync(keyPath)) fail('private key file not found.');
const isTestKey = isInside(keyPath, DEV_KEYS_DIR);
if (isInside(keyPath, REPO_DIR) && !isTestKey) fail('the private key must be stored outside the repository/source tree.');
if (isTestKey && !args.test) fail('this is the test-only key; pass --test to issue a TEST license (never for customers).');

let jwk;
try {
  jwk = JSON.parse(readFileSync(keyPath, 'utf8'));
} catch {
  fail('private key file must be a JWK JSON (ECDSA P-256).');
}
if (jwk.kty !== 'EC' || jwk.crv !== 'P-256' || typeof jwk.d !== 'string') fail('private key must be an EC P-256 private JWK.');
const licenseId = typeof args['license-id'] === 'string' ? args['license-id'] : randomUUID();
if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(licenseId)) fail('--license-id must be a UUID.');
const issuedAt = typeof args['issued-at'] === 'string' ? new Date(args['issued-at']).toISOString() : new Date().toISOString();
const lic = await signLicense(jwk, { licenseId, issuedAt });
writeFileSync(path.resolve(args.out), JSON.stringify(lic, null, 2) + '\n');
console.log(`license written: ${path.resolve(args.out)}\nlicenseId: ${licenseId}${isTestKey ? '\n(TEST license — valid only in test builds)' : ''}`);
