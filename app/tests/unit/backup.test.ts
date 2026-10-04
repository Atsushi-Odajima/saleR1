// AC08 backup format & crypto (repository round-trip is in repo.test.ts)
import { describe, it, expect } from 'vitest';
import { encryptBackup, decryptBackup, BackupError, PBKDF2_ITERATIONS, parseEnvelope } from '../../src/domain/backup';
import { buildDemoBundle } from '../../src/domain/demo';
import type { BackupPayload } from '../../src/domain/schema';

const PW = 'correct horse battery';
const enc = new TextEncoder();

async function payload(): Promise<BackupPayload> {
  return { schemaVersion: 1, exportedAt: '2026-10-04T00:00:00.000Z', appVersion: '1.0.0', ...(await buildDemoBundle()) };
}
async function expectCode(p: Promise<unknown>, code: string) {
  try {
    await p;
    throw new Error('expected failure');
  } catch (e) {
    expect(e).toBeInstanceOf(BackupError);
    expect((e as BackupError).code).toBe(code);
  }
}

describe('backup envelope', () => {
  it('round-trips and has the specified envelope shape', async () => {
    const p = await payload();
    const file = await encryptBackup(p, PW);
    const env = JSON.parse(file);
    expect(Object.keys(env)).toEqual(['format', 'version', 'kdf', 'cipher', 'payload']);
    expect(env.kdf).toMatchObject({ name: 'PBKDF2', hash: 'SHA-256', iterations: 600000 });
    expect(Buffer.from(env.kdf.salt, 'base64')).toHaveLength(16);
    expect(Buffer.from(env.cipher.iv, 'base64')).toHaveLength(12);
    expect(env.cipher.tagLength).toBe(128);
    expect(file).not.toContain('送料');
    const out = await decryptBackup(enc.encode(file), PW);
    expect(out.payload).toEqual(p);
    expect(out.digest).toMatch(/^[0-9a-f]{64}$/);
  });
  it('salt and iv differ every time', async () => {
    const p = await payload();
    const a = JSON.parse(await encryptBackup(p, PW));
    const b = JSON.parse(await encryptBackup(p, PW));
    expect(a.kdf.salt).not.toBe(b.kdf.salt);
    expect(a.cipher.iv).not.toBe(b.cipher.iv);
  });
  it('password length 12..128 code points', async () => {
    await expectCode(encryptBackup(await payload(), 'short'), 'bad_password');
    await expectCode(encryptBackup(await payload(), 'x'.repeat(129)), 'bad_password');
  });
  it('wrong password', async () => {
    const file = await encryptBackup(await payload(), PW);
    await expectCode(decryptBackup(enc.encode(file), 'wrong password!!'), 'wrong_password_or_corrupt');
  });
  it('tampered ciphertext', async () => {
    const env = JSON.parse(await encryptBackup(await payload(), PW));
    const ct = Buffer.from(env.payload, 'base64');
    ct[5] = ct[5]! ^ 1;
    env.payload = ct.toString('base64');
    await expectCode(decryptBackup(enc.encode(JSON.stringify(env)), PW), 'wrong_password_or_corrupt');
  });
  it('future envelope version / other iterations / not a backup / too large', async () => {
    const env = JSON.parse(await encryptBackup(await payload(), PW));
    await expectCode(decryptBackup(enc.encode(JSON.stringify({ ...env, version: 2 })), PW), 'future_version');
    await expectCode(decryptBackup(enc.encode(JSON.stringify({ ...env, kdf: { ...env.kdf, iterations: 100000000 } })), PW), 'bad_kdf');
    expect(() => parseEnvelope(enc.encode('{"hello":1}'))).toThrow(BackupError);
    expect(() => parseEnvelope(new Uint8Array(30 * 1024 * 1024 + 1))).toThrow(/too_large/);
    expect(PBKDF2_ITERATIONS).toBe(600000);
  });
  it('future schemaVersion inside payload is rejected', async () => {
    const p = { ...(await payload()), schemaVersion: 2 };
    const file = await encryptBackup(p as BackupPayload, PW);
    await expectCode(decryptBackup(enc.encode(file), PW), 'future_schema');
  });
  it('dangling references and duplicate ids are rejected', async () => {
    const p = await payload();
    const bad = { ...p, evidenceLinks: [{ ...p.evidenceLinks[0]!, excerptId: '99999999-0000-4000-8000-000000000000' }] };
    await expectCode(decryptBackup(enc.encode(await encryptBackup(bad, PW)), PW), 'invalid_payload');
    const dup = { ...p, themes: [...p.themes, { ...p.themes[0]! }] };
    await expectCode(decryptBackup(enc.encode(await encryptBackup(dup, PW)), PW), 'invalid_payload');
    const drift = { ...p, excerpts: [{ ...p.excerpts[0]!, startUtf16: p.excerpts[0]!.startUtf16 + 1 }, ...p.excerpts.slice(1)] };
    await expectCode(decryptBackup(enc.encode(await encryptBackup(drift, PW)), PW), 'invalid_payload');
    const unknown = { ...p, projects: [{ ...p.projects[0]!, extra: 1 }] };
    await expectCode(decryptBackup(enc.encode(await encryptBackup(unknown as BackupPayload, PW)), PW), 'invalid_payload');
  });
});
