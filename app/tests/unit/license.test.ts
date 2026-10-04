// AC17 license verification
import { describe, it, expect, beforeAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { verifyLicense, parseLicenseFile } from '../../src/domain/license';
// @ts-expect-error plain mjs helper
import { ensureTestKeys, signRaw, generateKeyPair } from '../../scripts/lib/license-lib.mjs';

let keys: { priv: JsonWebKey; pub: JsonWebKey; privPath: string };
const good = { version: 1, product: 'koeito', licenseId: '6f1c1f2e-3c55-4b7e-9f63-0d8f0e3b1a11', edition: 'personal-v1', issuedAt: '2026-10-04T00:00:00.000Z', major: 1 };

beforeAll(async () => {
  keys = await ensureTestKeys();
});

describe('license', () => {
  it('valid test-signed license', async () => {
    const lic = await signRaw(keys.priv, good);
    expect(await verifyLicense(lic, keys.pub)).toEqual({ ok: true, payload: good });
  });
  it('1 byte change in payload fails', async () => {
    const lic = await signRaw(keys.priv, good);
    const bytes = Buffer.from(lic.payloadB64, 'base64');
    bytes[10] = bytes[10]! ^ 1;
    expect(await verifyLicense({ ...lic, payloadB64: bytes.toString('base64') }, keys.pub)).toEqual({ ok: false, error: 'signature' });
  });
  it('1 byte change in signature fails', async () => {
    const lic = await signRaw(keys.priv, good);
    const sig = Buffer.from(lic.signatureB64, 'base64');
    sig[0] = sig[0]! ^ 0x80;
    expect((await verifyLicense({ ...lic, signatureB64: sig.toString('base64') }, keys.pub)).ok).toBe(false);
  });
  it('re-serialized JSON with same content is not accepted (bytes are signed)', async () => {
    const lic = await signRaw(keys.priv, good);
    const reser = JSON.stringify(JSON.parse(Buffer.from(lic.payloadB64, 'base64').toString()), null, 1);
    expect((await verifyLicense({ ...lic, payloadB64: Buffer.from(reser).toString('base64') }, keys.pub)).ok).toBe(false);
  });
  it('other product / other major / invalid JSON / extra field', async () => {
    expect(await verifyLicense(await signRaw(keys.priv, { ...good, product: 'other' }), keys.pub)).toEqual({ ok: false, error: 'product' });
    expect(await verifyLicense(await signRaw(keys.priv, { ...good, major: 2 }), keys.pub)).toEqual({ ok: false, error: 'major' });
    expect(await verifyLicense(await signRaw(keys.priv, '{not json'), keys.pub)).toEqual({ ok: false, error: 'payload' });
    expect(await verifyLicense(await signRaw(keys.priv, { ...good, email: 'a@b' }), keys.pub)).toEqual({ ok: false, error: 'payload' });
    expect(await verifyLicense(await signRaw(keys.priv, { ...good, expiresAt: '2030-01-01T00:00:00.000Z' }), keys.pub)).toEqual({ ok: false, error: 'payload' });
  });
  it('signed with another key fails', async () => {
    const other = await generateKeyPair();
    expect(await verifyLicense(await signRaw(other.priv, good), keys.pub)).toEqual({ ok: false, error: 'signature' });
  });
  it('no public key configured', async () => {
    expect(await verifyLicense(await signRaw(keys.priv, good), null)).toEqual({ ok: false, error: 'no_key' });
  });
  it('license file parser rejects unknown properties', () => {
    expect(parseLicenseFile('{"payloadB64":"AAAA","signatureB64":"AAAA"}')).not.toBeNull();
    expect(parseLicenseFile('{"payloadB64":"AAAA","signatureB64":"AAAA","x":1}')).toBeNull();
    expect(parseLicenseFile('nope')).toBeNull();
  });
  it('CLI requires explicit private key path and refuses test key without --test', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'koeito-lic-'));
    const out = path.join(dir, 'l.json');
    const run = (args: string[]) => {
      try {
        return { code: 0, out: execFileSync('node', ['scripts/generate-license.mjs', ...args], { encoding: 'utf8', stdio: 'pipe' }) };
      } catch (e) {
        const err = e as { status: number; stderr: string };
        return { code: err.status, out: err.stderr };
      }
    };
    expect(run(['--out', out]).code).toBe(1);
    expect(run(['--private-key-path', keys.privPath, '--out', out]).code).toBe(1);
    const ok = run(['--private-key-path', keys.privPath, '--out', out, '--test']);
    expect(ok.code).toBe(0);
    expect(ok.out).not.toContain(JSON.parse(readFileSync(keys.privPath, 'utf8')).d);
    const lic = parseLicenseFile(readFileSync(out, 'utf8'));
    expect(lic).not.toBeNull();
    // a real (non-test) key stored outside the repository is accepted without --test
    writeFileSync(path.join(dir, 'k.json'), readFileSync(keys.privPath));
    expect(run(['--private-key-path', path.join(dir, 'k.json'), '--out', out]).code).toBe(0);
  });
});
