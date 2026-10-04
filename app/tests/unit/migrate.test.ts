// v1→v2 migration fixture (procedure test; v1.0 itself has no migrations) + future schema refusal
import { describe, it, expect } from 'vitest';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { KoeitoDB } from '../../src/db/db';
import { runMigrations, FutureSchemaError, MIGRATIONS } from '../../src/db/migrate';
import { buildDemoBundle } from '../../src/domain/demo';

function dbs() {
  const f = new IDBFactory();
  return { db: new KoeitoDB('koeito-v1', { indexedDB: f, IDBKeyRange }), snap: () => Promise.resolve(new KoeitoDB('koeito-v1-snapshot', { indexedDB: f, IDBKeyRange })) };
}

describe('migrations', () => {
  it('v1.0 ships with no migrations', () => {
    expect(MIGRATIONS).toEqual([]);
  });
  it('v1→v2 fixture: snapshot keeps the previous version, migration is atomic', async () => {
    const { db, snap } = dbs();
    const b = await buildDemoBundle();
    await db.projects.bulkAdd(b.projects);
    await db.themes.bulkAdd(b.themes);
    await db.meta.put({ key: 'schemaVersion', value: 1 });
    const v2 = { from: 1, to: 2, run: async (d: KoeitoDB) => { await d.themes.toCollection().modify((t) => { t.description = 'migrated'; }); } };
    expect(await runMigrations(db, snap, [v2], 2)).toBe(2);
    expect((await db.meta.get('schemaVersion'))!.value).toBe(2);
    expect((await db.themes.toArray()).every((t) => t.description === 'migrated')).toBe(true);
    const s = await snap();
    expect((await s.themes.toArray()).every((t) => t.description === '')).toBe(true);
    expect((await s.meta.get('schemaVersion'))!.value).toBe(1);
  });
  it('failed migration leaves data untouched (and the snapshot available)', async () => {
    const { db, snap } = dbs();
    const b = await buildDemoBundle();
    await db.themes.bulkAdd(b.themes);
    const bad = { from: 1, to: 2, run: async (d: KoeitoDB) => { await d.themes.clear(); throw new Error('boom'); } };
    await expect(runMigrations(db, snap, [bad], 2)).rejects.toThrow('boom');
    expect(await db.themes.count()).toBe(2);
    expect((await db.meta.get('schemaVersion'))?.value ?? 1).toBe(1);
  });
  it('future schemaVersion is refused', async () => {
    const { db, snap } = dbs();
    await db.meta.put({ key: 'schemaVersion', value: 3 });
    await expect(runMigrations(db, snap)).rejects.toBeInstanceOf(FutureSchemaError);
  });
});
