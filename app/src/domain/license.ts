// Offline license: ECDSA P-256 / SHA-256 over the exact payload bytes (no re-serialization).
// Signature is WebCrypto raw r||s (64 bytes).
import { b64ToBytes } from './hash';
import { LicenseFileSchema, LicensePayloadSchema, type LicenseFile, type LicensePayload } from './schema';

export type LicenseResult =
  | { ok: true; payload: LicensePayload }
  | { ok: false; error: 'format' | 'signature' | 'payload' | 'product' | 'major' | 'no_key' };

export const LICENSE_ERROR_LABEL: Record<Exclude<LicenseResult, { ok: true }>['error'], string> = {
  format: 'ライセンスファイルの形式が正しくありません',
  signature: '署名を確認できませんでした（改変されたか、別の商品のファイルです）',
  payload: 'ライセンスの内容が正しくありません',
  product: 'Koeito用のライセンスではありません',
  major: 'この版（v1）用のライセンスではありません',
  no_key: 'この配布物には検証用の公開鍵が設定されていません',
};

export async function importPublicKey(jwk: JsonWebKey): Promise<CryptoKey> {
  const clean: JsonWebKey = { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y };
  return crypto.subtle.importKey('jwk', clean, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
}

export function parseLicenseFile(text: string): LicenseFile | null {
  try {
    const r = LicenseFileSchema.safeParse(JSON.parse(text));
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}

export async function verifyLicense(file: LicenseFile, publicKeyJwk: JsonWebKey | null): Promise<LicenseResult> {
  if (!publicKeyJwk) return { ok: false, error: 'no_key' };
  let payloadBytes: Uint8Array, sig: Uint8Array;
  try {
    payloadBytes = b64ToBytes(file.payloadB64);
    sig = b64ToBytes(file.signatureB64);
  } catch {
    return { ok: false, error: 'format' };
  }
  if (sig.length !== 64) return { ok: false, error: 'signature' };
  let key: CryptoKey;
  try {
    key = await importPublicKey(publicKeyJwk);
  } catch {
    return { ok: false, error: 'no_key' };
  }
  const valid = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, sig as BufferSource, payloadBytes as BufferSource);
  if (!valid) return { ok: false, error: 'signature' };
  let obj: unknown;
  try {
    obj = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(payloadBytes));
  } catch {
    return { ok: false, error: 'payload' };
  }
  const o = obj as Record<string, unknown> | null;
  if (o && o.product !== 'koeito') return { ok: false, error: 'product' };
  if (o && o.major !== 1) return { ok: false, error: 'major' };
  const r = LicensePayloadSchema.safeParse(obj);
  if (!r.success) return { ok: false, error: 'payload' };
  return { ok: true, payload: r.data };
}
