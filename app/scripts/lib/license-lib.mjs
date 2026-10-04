// Shared helpers for seller-side license tooling (Node >= 22, WebCrypto).
import { webcrypto as crypto } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const REPO_DIR = path.resolve(APP_DIR, '..');
export const DEV_KEYS_DIR = path.join(APP_DIR, '.dev-keys');

export async function generateKeyPair() {
  const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const priv = await crypto.subtle.exportKey('jwk', kp.privateKey);
  const pub = await crypto.subtle.exportKey('jwk', kp.publicKey);
  return { priv, pub: { kty: pub.kty, crv: pub.crv, x: pub.x, y: pub.y } };
}

export function isInside(child, parent) {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

export async function signLicense(privJwk, { licenseId, issuedAt }) {
  const key = await crypto.subtle.importKey('jwk', privJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const payload = { version: 1, product: 'koeito', licenseId, edition: 'personal-v1', issuedAt, major: 1 };
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, bytes));
  return { payloadB64: Buffer.from(bytes).toString('base64'), signatureB64: Buffer.from(sig).toString('base64') };
}

/** Raw signing of arbitrary payload bytes (used by tests for wrong product / major). */
export async function signRaw(privJwk, payloadObj) {
  const key = await crypto.subtle.importKey('jwk', privJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const bytes = new TextEncoder().encode(typeof payloadObj === 'string' ? payloadObj : JSON.stringify(payloadObj));
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, bytes));
  return { payloadB64: Buffer.from(bytes).toString('base64'), signatureB64: Buffer.from(sig).toString('base64') };
}

/** Test-only key pair under app/.dev-keys (git-ignored). Never used for release. */
export async function ensureTestKeys() {
  const privPath = path.join(DEV_KEYS_DIR, 'test-private.jwk.json');
  const pubPath = path.join(DEV_KEYS_DIR, 'test-public.jwk.json');
  if (!existsSync(privPath) || !existsSync(pubPath)) {
    mkdirSync(DEV_KEYS_DIR, { recursive: true });
    const { priv, pub } = await generateKeyPair();
    writeFileSync(privPath, JSON.stringify(priv), { mode: 0o600 });
    writeFileSync(pubPath, JSON.stringify(pub));
  }
  return { privPath, pubPath, priv: JSON.parse(readFileSync(privPath, 'utf8')), pub: JSON.parse(readFileSync(pubPath, 'utf8')) };
}

export function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const k = a.slice(2);
    const v = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
    out[k] = v;
  }
  return out;
}
