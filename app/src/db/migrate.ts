// Data migrations. v1.0 ships none, but the procedure is fixed and tested:
// 1) refuse future data, 2) copy every table to the snapshot DB in ONE transaction,
// 3) migrate in ONE transaction and bump meta.schemaVersion. The snapshot keeps the
// previous version only (it is replaced by the next migration).
import type { KoeitoDB } from './db';
import { SCHEMA_VERSION } from '../domain/schema';

export const ALL_TABLES = ['projects', 'participants', 'sources', 'excerpts', 'themes', 'findings', 'evidenceLinks', 'exportRecords', 'settings', 'meta'] as const;

export interface Migration {
  from: number;
  to: number;
  run(db: KoeitoDB): Promise<void>;
}

export const MIGRATIONS: Migration[] = [];

export class FutureSchemaError extends Error {}

export async function snapshotTo(db: KoeitoDB, snap: KoeitoDB): Promise<void> {
  const data: Record<string, unknown[]> = {};
  await db.transaction('r', [...ALL_TABLES], async () => {
    for (const t of ALL_TABLES) data[t] = await db.table(t).toArray();
  });
  await snap.transaction('rw', [...ALL_TABLES], async () => {
    for (const t of ALL_TABLES) {
      await snap.table(t).clear();
      await snap.table(t).bulkAdd(data[t]!);
    }
  });
}

export async function runMigrations(db: KoeitoDB, openSnapshot: () => Promise<KoeitoDB>, migrations: Migration[] = MIGRATIONS, target: number = SCHEMA_VERSION): Promise<number> {
  let current = (await db.meta.get('schemaVersion'))?.value ?? 1;
  if (current > target) throw new FutureSchemaError(`schema ${current} > ${target}`);
  while (current < target) {
    const m = migrations.find((x) => x.from === current);
    if (!m) throw new Error(`no migration from ${current}`);
    const snap = await openSnapshot();
    try {
      await snapshotTo(db, snap);
    } finally {
      snap.close();
    }
    await db.transaction('rw', [...ALL_TABLES], async () => {
      await m.run(db);
      await db.meta.put({ key: 'schemaVersion', value: m.to });
    });
    current = m.to;
  }
  return current;
}
