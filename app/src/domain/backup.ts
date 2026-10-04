// Encrypted backup (.koeito). PBKDF2-SHA256 (600000) → AES-GCM-256, AAD 'koeito-backup:1'.
import { z } from 'zod';
import { b64ToBytes, bytesToB64, sha256Hex } from './hash';
import { BackupPayloadSchema, SCHEMA_VERSION, type BackupPayload, type ProjectBundle } from './schema';
import { cpLength } from './text';
import { LIMITS } from './limits';
import { validateBundle } from './bundle';

export const PBKDF2_ITERATIONS = 600000;
export const BACKUP_AAD = 'koeito-backup:1';

export const EnvelopeSchema = z.strictObject({
  format: z.literal('koeito-backup'),
  version: z.int(),
  kdf: z.strictObject({ name: z.literal('PBKDF2'), hash: z.literal('SHA-256'), iterations: z.int(), salt: z.string() }),
  cipher: z.strictObject({ name: z.literal('AES-GCM'), iv: z.string(), tagLength: z.literal(128) }),
  payload: z.string(),
});
export type Envelope = z.infer<typeof EnvelopeSchema>;

export type BackupErrorCode =
  | 'too_large'
  | 'not_backup'
  | 'future_version'
  | 'bad_kdf'
  | 'wrong_password_or_corrupt'
  | 'invalid_payload'
  | 'future_schema'
  | 'limits'
  | 'bad_password';

export class BackupError extends Error {
  constructor(public code: BackupErrorCode, public detail?: string) {
    super(code);
  }
}

export const BACKUP_ERROR_LABEL: Record<BackupErrorCode, string> = {
  too_large: 'バックアップファイルが30MiBを超えています',
  not_backup: 'Koeitoのバックアップファイルではないか、壊れています',
  future_version: '新しい版のKoeitoで作られたバックアップです。この版では読み込めません',
  bad_kdf: '暗号化の設定が想定外のため読み込みません',
  wrong_password_or_corrupt: 'パスワードが違うか、ファイルが改変・破損しています',
  invalid_payload: 'バックアップの内容に不整合があります',
  future_schema: '新しいデータ形式のバックアップです。この版では読み込めません',
  limits: 'この端末の上限を超えるため読み込めません',
  bad_password: 'パスワードは12〜128文字で入力してください',
};

export function checkPassword(pw: string): boolean {
  const n = cpLength(pw);
  return n >= 12 && n <= 128;
}

const enc = new TextEncoder();

async function deriveKey(password: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', enc.encode(password) as BufferSource, 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function encryptBackup(payload: BackupPayload, password: string): Promise<string> {
  if (!checkPassword(password)) throw new BackupError('bad_password');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  let key: CryptoKey | null = await deriveKey(password, salt, PBKDF2_ITERATIONS);
  const plain = enc.encode(JSON.stringify(payload));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource, tagLength: 128, additionalData: enc.encode(BACKUP_AAD) as BufferSource }, key, plain as BufferSource),
  );
  key = null;
  const env: Envelope = {
    format: 'koeito-backup',
    version: 1,
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: PBKDF2_ITERATIONS, salt: bytesToB64(salt) },
    cipher: { name: 'AES-GCM', iv: bytesToB64(iv), tagLength: 128 },
    payload: bytesToB64(ct),
  };
  return JSON.stringify(env);
}

/** Parse + validate envelope without decrypting (cheap checks first). */
export function parseEnvelope(bytes: Uint8Array): Envelope {
  if (bytes.byteLength > LIMITS.backupBytes) throw new BackupError('too_large');
  let obj: unknown;
  try {
    obj = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw new BackupError('not_backup');
  }
  if (obj && typeof obj === 'object' && (obj as { format?: unknown }).format === 'koeito-backup') {
    const v = (obj as { version?: unknown }).version;
    if (typeof v === 'number' && v > 1) throw new BackupError('future_version');
  }
  const r = EnvelopeSchema.safeParse(obj);
  if (!r.success) throw new BackupError('not_backup');
  const env = r.data;
  if (env.version !== 1) throw new BackupError(env.version > 1 ? 'future_version' : 'not_backup');
  // Refuse any other iteration count: do not let a file make us burn CPU.
  if (env.kdf.iterations !== PBKDF2_ITERATIONS) throw new BackupError('bad_kdf');
  try {
    if (b64ToBytes(env.kdf.salt).length !== 16) throw new Error();
    if (b64ToBytes(env.cipher.iv).length !== 12) throw new Error();
    if (b64ToBytes(env.payload).length < 17) throw new Error();
  } catch {
    throw new BackupError('not_backup');
  }
  return env;
}

export async function decryptBackup(bytes: Uint8Array, password: string): Promise<{ payload: BackupPayload; digest: string }> {
  const env = parseEnvelope(bytes);
  const digest = await sha256Hex(bytes);
  let key: CryptoKey | null = await deriveKey(password, b64ToBytes(env.kdf.salt), PBKDF2_ITERATIONS);
  let plain: ArrayBuffer;
  try {
    plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: b64ToBytes(env.cipher.iv) as BufferSource, tagLength: 128, additionalData: enc.encode(BACKUP_AAD) as BufferSource },
      key,
      b64ToBytes(env.payload) as BufferSource,
    );
  } catch {
    throw new BackupError('wrong_password_or_corrupt');
  } finally {
    key = null;
  }
  let obj: unknown;
  try {
    obj = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(plain));
  } catch {
    throw new BackupError('invalid_payload');
  }
  const sv = (obj as { schemaVersion?: unknown })?.schemaVersion;
  if (typeof sv === 'number' && sv > SCHEMA_VERSION) throw new BackupError('future_schema');
  const r = BackupPayloadSchema.safeParse(obj);
  if (!r.success) throw new BackupError('invalid_payload', r.error.issues.slice(0, 3).map((i) => i.path.join('.') + ':' + i.message).join('; '));
  if (r.data.schemaVersion !== SCHEMA_VERSION) throw new BackupError('future_schema');
  const problems = validateBundle(r.data);
  if (problems.length) throw new BackupError('invalid_payload', problems.slice(0, 5).join('; '));
  for (const src of r.data.sources) {
    if ((await sha256Hex(src.text)) !== src.sha256) throw new BackupError('invalid_payload', 'source hash mismatch');
  }
  return { payload: r.data, digest };
}

/**
 * Give every entity a fresh UUID and remap all references. sourceNo/alias/order are kept.
 * Titles that collide with existing projects get "（読込）".
 */
export function remapBundle(b: ProjectBundle, existingTitles: Set<string>, newId: () => string, now: string): ProjectBundle {
  const map = new Map<string, string>();
  const m = (id: string) => {
    let v = map.get(id);
    if (!v) {
      v = newId();
      map.set(id, v);
    }
    return v;
  };
  const ref = (id: string) => {
    const v = map.get(id);
    if (!v) throw new BackupError('invalid_payload', 'dangling reference');
    return v;
  };
  const titles = new Set(existingTitles);
  const projects = b.projects.map((p) => {
    let title = p.title;
    if (titles.has(title)) {
      const suffix = '（読込）';
      const chars = Array.from(title);
      title = chars.slice(0, 80 - suffix.length).join('') + suffix;
    }
    titles.add(title);
    return { ...p, id: m(p.id), title, updatedAt: now };
  });
  const participants = b.participants.map((x) => ({ ...x, id: m(x.id), projectId: ref(x.projectId) }));
  const themes = b.themes.map((x) => ({ ...x, id: m(x.id), projectId: ref(x.projectId) }));
  const batchIds = new Map<string, string>();
  const sources = b.sources.map((x) => {
    let bid = batchIds.get(x.importBatchId);
    if (!bid) {
      bid = newId();
      batchIds.set(x.importBatchId, bid);
    }
    return { ...x, id: m(x.id), projectId: ref(x.projectId), participantId: ref(x.participantId), importBatchId: bid };
  });
  const excerpts = b.excerpts.map((x) => ({
    ...x,
    id: m(x.id),
    projectId: ref(x.projectId),
    sourceId: ref(x.sourceId),
    themeIds: x.themeIds.map(ref),
  }));
  const findings = b.findings.map((x) => ({ ...x, id: m(x.id), projectId: ref(x.projectId) }));
  const evidenceLinks = b.evidenceLinks.map((x) => ({
    ...x,
    id: m(x.id),
    projectId: ref(x.projectId),
    findingId: ref(x.findingId),
    excerptId: ref(x.excerptId),
  }));
  return { projects, participants, sources, excerpts, themes, findings, evidenceLinks };
}
