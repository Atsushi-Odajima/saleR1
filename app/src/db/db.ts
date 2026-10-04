import Dexie, { type Table } from 'dexie';
import type { EvidenceLink, Excerpt, ExportRecord, Finding, Participant, Project, SettingRow, Source, Theme } from '../domain/schema';

export const DB_NAME = 'koeito-v1';
export const SNAPSHOT_DB_NAME = 'koeito-v1-snapshot';
export const IDB_VERSION = 1;

export interface MetaRow {
  key: 'schemaVersion';
  value: number;
}

export const STORES = {
  projects: 'id, updatedAt',
  participants: 'id, projectId',
  sources: 'id, projectId, importBatchId, [projectId+sha256]',
  excerpts: 'id, projectId, sourceId',
  themes: 'id, projectId',
  findings: 'id, projectId',
  evidenceLinks: 'id, projectId, findingId, excerptId',
  exportRecords: 'id, projectId',
  settings: 'key',
  meta: 'key',
} as const;

export class KoeitoDB extends Dexie {
  projects!: Table<Project, string>;
  participants!: Table<Participant, string>;
  sources!: Table<Source, string>;
  excerpts!: Table<Excerpt, string>;
  themes!: Table<Theme, string>;
  findings!: Table<Finding, string>;
  evidenceLinks!: Table<EvidenceLink, string>;
  exportRecords!: Table<ExportRecord, string>;
  settings!: Table<SettingRow, string>;
  meta!: Table<MetaRow, string>;

  constructor(name: string, deps?: { indexedDB: IDBFactory; IDBKeyRange: typeof IDBKeyRange }) {
    super(name, deps ? { indexedDB: deps.indexedDB, IDBKeyRange: deps.IDBKeyRange } : undefined);
    this.version(IDB_VERSION).stores(STORES);
  }
}

export const PROJECT_TABLES = ['projects', 'participants', 'sources', 'excerpts', 'themes', 'findings', 'evidenceLinks', 'exportRecords'] as const;
