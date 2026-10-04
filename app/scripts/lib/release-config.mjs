// Validation of release-config.json (seller-provided real values). Shared by the
// Vite build (release mode), dist:win and verify:release.
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { APP_DIR, DEV_KEYS_DIR } from './license-lib.mjs';

export const RELEASE_CONFIG_PATH = path.join(APP_DIR, 'release-config.json');
const PLACEHOLDER = /(example\.(com|org|net)|\.example\b|\.test\b|\.invalid\b|localhost|127\.0\.0\.1|todo|dummy|xxx|placeholder|your[-_ ]|ダミー|未定)/i;

function httpsUrl(v, name, errors, { optional = false } = {}) {
  if (v === null || v === undefined || v === '') {
    if (!optional) errors.push(`${name} is required`);
    return;
  }
  try {
    const u = new URL(v);
    if (u.protocol !== 'https:') errors.push(`${name} must be https`);
    if (PLACEHOLDER.test(v)) errors.push(`${name} looks like a placeholder`);
    if (u.username || u.password) errors.push(`${name} must not contain credentials`);
  } catch {
    errors.push(`${name} is not a valid URL`);
  }
}

export function validateReleaseConfig(cfg) {
  const errors = [];
  if (!cfg || typeof cfg !== 'object') return ['release-config.json must be a JSON object'];
  const allowed = ['pwaUrl', 'licensePublicKeyJwk', 'sellerName', 'sellerContact', 'salesUrl', 'helpUrl'];
  for (const k of Object.keys(cfg)) if (!allowed.includes(k)) errors.push(`unknown key ${k}`);
  httpsUrl(cfg.pwaUrl, 'pwaUrl', errors);
  httpsUrl(cfg.salesUrl, 'salesUrl', errors, { optional: true });
  httpsUrl(cfg.helpUrl, 'helpUrl', errors, { optional: true });
  for (const k of ['sellerName', 'sellerContact']) {
    if (typeof cfg[k] !== 'string' || cfg[k].trim() === '') errors.push(`${k} is required`);
    else if (PLACEHOLDER.test(cfg[k])) errors.push(`${k} looks like a placeholder`);
  }
  const k = cfg.licensePublicKeyJwk;
  if (!k || k.kty !== 'EC' || k.crv !== 'P-256' || typeof k.x !== 'string' || typeof k.y !== 'string') errors.push('licensePublicKeyJwk must be an EC P-256 public JWK');
  else {
    if ('d' in k) errors.push('licensePublicKeyJwk contains a PRIVATE key component "d" — remove it');
    const testPub = path.join(DEV_KEYS_DIR, 'test-public.jwk.json');
    if (existsSync(testPub)) {
      const t = JSON.parse(readFileSync(testPub, 'utf8'));
      if (t.x === k.x && t.y === k.y) errors.push('licensePublicKeyJwk is the TEST key');
    }
  }
  return errors;
}

export function loadReleaseConfig() {
  if (!existsSync(RELEASE_CONFIG_PATH)) return { cfg: null, errors: ['release-config.json not found (copy release-config.example.json and fill in real values)'] };
  let cfg;
  try {
    cfg = JSON.parse(readFileSync(RELEASE_CONFIG_PATH, 'utf8'));
  } catch {
    return { cfg: null, errors: ['release-config.json is not valid JSON'] };
  }
  return { cfg, errors: validateReleaseConfig(cfg) };
}
