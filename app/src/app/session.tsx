// Session: which data store is active, whether this tab may write, license state.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { IDBFactory as FakeIDBFactory, IDBKeyRange as FakeIDBKeyRange } from 'fake-indexeddb';
import { KoeitoDB, DB_NAME } from '../db/db';
import { Repo } from '../db/repo';
import { buildDemoBundle } from '../domain/demo';
import { verifyLicense, LICENSE_ERROR_LABEL } from '../domain/license';
import type { LicenseFile, LicensePayload } from '../domain/schema';
import { SCHEMA_VERSION } from '../domain/schema';
import { LICENSE_PUBKEY } from '../config';
import { acquireWriterLock, locksSupported } from './writerLock';

export type LockState = 'held' | 'busy' | 'unsupported' | 'pending';
export type LicenseState = { state: 'none' } | { state: 'valid'; payload: LicensePayload } | { state: 'invalid'; message: string };

export interface StorageInfo {
  persisted: boolean | null;
  usage: number | null;
  quota: number | null;
}

export interface Session {
  real: Repo;
  demo: Repo;
  lock: LockState;
  license: LicenseState;
  storage: StorageInfo;
  realWritable: boolean;
  readOnlyReason: string | null;
  /** increments whenever data must be re-read (lock acquired, restore, ...) */
  epoch: number;
  tryAcquireLock(): Promise<boolean>;
  installLicense(file: LicenseFile): Promise<LicenseState>;
  refreshStorage(): Promise<void>;
  requestPersist(): Promise<boolean | null>;
  repoFor(kind: 'p' | 'd'): Repo;
  bump(): void;
}

const Ctx = createContext<Session | null>(null);

export function useSession(): Session {
  const s = useContext(Ctx);
  if (!s) throw new Error('no session');
  return s;
}

export class FatalStartupError extends Error {
  constructor(public title: string, message: string) {
    super(message);
  }
}

async function openRealDb(): Promise<KoeitoDB> {
  const db = new KoeitoDB(DB_NAME);
  try {
    await db.open();
  } catch (e) {
    const name = (e as { name?: string }).name;
    if (name === 'VersionError') throw new FatalStartupError('新しい版のデータです', 'この端末のデータは新しい版のKoeitoで更新されています。この版では開けません。データは削除していません。新しい版で開いてください。');
    if (name === 'MissingAPIError' || name === 'InvalidStateError') throw new FatalStartupError('端末内に保存できません', 'このブラウザではIndexedDB（端末内保存）が使えません。プライベートブラウズを終了するか、対応ブラウザで開いてください。');
    throw new FatalStartupError('データを開けませんでした', '端末内データを開けませんでした。データは削除していません。ブラウザやアプリを再起動して再度お試しください。');
  }
  const meta = await db.meta.get('schemaVersion');
  if (meta && meta.value > SCHEMA_VERSION) {
    db.close();
    throw new FatalStartupError('新しい版のデータです', `この端末のデータ形式（${meta.value}）はこの版（${SCHEMA_VERSION}）より新しいため開けません。データは削除していません。`);
  }
  return db;
}

async function createDemoRepo(): Promise<Repo> {
  // In-memory IndexedDB implementation: the demo never touches device storage.
  const db = new KoeitoDB('koeito-demo', { indexedDB: new FakeIDBFactory(), IDBKeyRange: FakeIDBKeyRange as unknown as typeof IDBKeyRange });
  await db.open();
  const b = await buildDemoBundle();
  await db.transaction('rw', ['projects', 'participants', 'sources', 'excerpts', 'themes', 'findings', 'evidenceLinks'], async () => {
    await db.projects.bulkAdd(b.projects);
    await db.participants.bulkAdd(b.participants);
    await db.sources.bulkAdd(b.sources);
    await db.excerpts.bulkAdd(b.excerpts);
    await db.themes.bulkAdd(b.themes);
    await db.findings.bulkAdd(b.findings);
    await db.evidenceLinks.bulkAdd(b.evidenceLinks);
  });
  return new Repo(db, () => true);
}

async function readStorage(): Promise<StorageInfo> {
  const st = navigator.storage;
  let persisted: boolean | null = null;
  let usage: number | null = null;
  let quota: number | null = null;
  try {
    if (st?.persisted) persisted = await st.persisted();
    if (st?.estimate) {
      const e = await st.estimate();
      usage = e.usage ?? null;
      quota = e.quota ?? null;
    }
  } catch {
    /* not available */
  }
  return { persisted, usage, quota };
}

export function SessionProvider({ children, fallback, onFatal }: { children: ReactNode; fallback: ReactNode; onFatal: (e: FatalStartupError) => ReactNode }) {
  const [state, setState] = useState<{ real: Repo; demo: Repo } | null>(null);
  const [fatal, setFatal] = useState<FatalStartupError | null>(null);
  const [lock, setLock] = useState<LockState>('pending');
  const [license, setLicense] = useState<LicenseState>({ state: 'none' });
  const [storage, setStorage] = useState<StorageInfo>({ persisted: null, usage: null, quota: null });
  const [epoch, setEpoch] = useState(0);
  const writable = useRef(false);

  const realWritable = lock === 'held' && license.state === 'valid';
  writable.current = realWritable;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const db = await openRealDb();
        const real = new Repo(db, () => writable.current);
        const demo = await createDemoRepo();
        let lockState: LockState = 'unsupported';
        if (locksSupported()) lockState = (await acquireWriterLock()) ? 'held' : 'busy';
        if (lockState === 'held' && !(await db.meta.get('schemaVersion'))) await db.meta.put({ key: 'schemaVersion', value: SCHEMA_VERSION });
        const stored = await real.getSetting<LicenseFile>('license');
        let lic: LicenseState = { state: 'none' };
        if (stored) {
          const r = await verifyLicense(stored, LICENSE_PUBKEY);
          lic = r.ok ? { state: 'valid', payload: r.payload } : { state: 'invalid', message: LICENSE_ERROR_LABEL[r.error] };
        }
        if (cancelled) return;
        setLock(lockState);
        setLicense(lic);
        setState({ real, demo });
        setStorage(await readStorage());
        if (import.meta.env.MODE !== 'release') {
          (window as unknown as { __koeitoTest?: unknown }).__koeitoTest = { real, demo };
        }
      } catch (e) {
        if (!cancelled) setFatal(e instanceof FatalStartupError ? e : new FatalStartupError('起動できませんでした', String((e as Error)?.message ?? e)));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const tryAcquireLock = useCallback(async () => {
    if (!locksSupported()) return false;
    const ok = await acquireWriterLock();
    if (ok) {
      setLock('held');
      setEpoch((n) => n + 1); // re-read everything before editing
    }
    return ok;
  }, []);

  const installLicense = useCallback(
    async (file: LicenseFile): Promise<LicenseState> => {
      const r = await verifyLicense(file, LICENSE_PUBKEY);
      if (!r.ok) return { state: 'invalid', message: LICENSE_ERROR_LABEL[r.error] };
      if (!state) return { state: 'invalid', message: '起動処理が終わっていません' };
      await state.real.setSetting('license', file);
      const lic: LicenseState = { state: 'valid', payload: r.payload };
      setLicense(lic);
      try {
        if (navigator.storage?.persist && !(await navigator.storage.persisted())) await navigator.storage.persist();
      } catch {
        /* ignore */
      }
      setStorage(await readStorage());
      return lic;
    },
    [state],
  );

  const refreshStorage = useCallback(async () => setStorage(await readStorage()), []);
  const requestPersist = useCallback(async () => {
    try {
      if (!navigator.storage?.persist) return null;
      const ok = await navigator.storage.persist();
      setStorage(await readStorage());
      return ok;
    } catch {
      return null;
    }
  }, []);

  const value = useMemo<Session | null>(() => {
    if (!state) return null;
    let reason: string | null = null;
    if (license.state !== 'valid') reason = 'ライセンスが未読込のため、保存されたデータは閲覧・HTML出力・バックアップのみ利用できます。';
    else if (lock === 'unsupported') reason = 'このブラウザは同時編集の防止（Web Locks）に対応していないため、編集できません。最新のSafari・Chrome・Edge・Firefoxで開いてください。';
    else if (lock === 'busy') reason = '別のタブまたはウィンドウで編集中のため、この画面は読み取り専用です。';
    return {
      real: state.real,
      demo: state.demo,
      lock,
      license,
      storage,
      realWritable,
      readOnlyReason: reason,
      epoch,
      tryAcquireLock,
      installLicense,
      refreshStorage,
      requestPersist,
      repoFor: (kind) => (kind === 'd' ? state.demo : state.real),
      bump: () => setEpoch((n) => n + 1),
    };
  }, [state, lock, license, storage, realWritable, epoch, tryAcquireLock, installLicense, refreshStorage, requestPersist]);

  if (fatal) return <>{onFatal(fatal)}</>;
  if (!value) return <>{fallback}</>;
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
