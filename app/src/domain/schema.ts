// Zod schemas for every stored entity. Unknown properties are rejected (strictObject).
import { z } from 'zod';
import { cpLength } from './text';

export const SCHEMA_VERSION = 1 as const;

/** plain text with code point length bounds */
export const cpString = (min: number, max: number) =>
  z.string().refine((s) => {
    const n = cpLength(s);
    return n >= min && n <= max;
  }, { message: `length_${min}_${max}` });

const id = z.uuid();
const isoDateTime = z.iso.datetime();
const ymd = z.iso.date().nullable();
const revision = z.int().min(1);

const common = {
  id,
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
  revision,
};

export const ProjectSchema = z.strictObject({
  ...common,
  title: cpString(1, 80),
  question: cpString(1, 300),
  periodStart: ymd,
  periodEnd: ymd,
  limitations: cpString(0, 2000),
  nextSourceNo: z.int().min(1),
  nextParticipantNo: z.int().min(1),
});
export type Project = z.infer<typeof ProjectSchema>;

export const ParticipantSchema = z.strictObject({
  ...common,
  projectId: id,
  alias: cpString(1, 24),
  internalNote: cpString(0, 1000),
});
export type Participant = z.infer<typeof ParticipantSchema>;

export const SourceSchema = z.strictObject({
  ...common,
  projectId: id,
  sourceNo: z.int().min(1),
  participantId: id,
  title: cpString(1, 120),
  originalFilename: z.string().max(255).nullable(),
  text: cpString(1, 20000),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  importBatchId: id,
});
export type Source = z.infer<typeof SourceSchema>;

export const RangeSchema = z.strictObject({ startUtf16: z.int().min(0), endUtf16: z.int().min(1) });
export type Range = z.infer<typeof RangeSchema>;

export const ExcerptSchema = z.strictObject({
  ...common,
  projectId: id,
  sourceId: id,
  startUtf16: z.int().min(0),
  endUtf16: z.int().min(1),
  quote: cpString(1, 800),
  themeIds: z.array(id).max(100),
  note: cpString(0, 1000),
  redactions: z.array(RangeSchema).max(400),
  publicReviewedHash: z.string().regex(/^[0-9a-f]{64}$/).nullable(),
});
export type Excerpt = z.infer<typeof ExcerptSchema>;

export const ThemeSchema = z.strictObject({
  ...common,
  projectId: id,
  label: cpString(1, 40),
  labelKey: z.string(),
  description: cpString(0, 300),
  order: z.int(),
});
export type Theme = z.infer<typeof ThemeSchema>;

export const CounterCheck = z.enum(['not_checked', 'none_found', 'found']);
export type CounterCheck = z.infer<typeof CounterCheck>;

export const FindingSchema = z.strictObject({
  ...common,
  projectId: id,
  title: cpString(1, 80),
  interpretation: cpString(0, 1500),
  proposal: cpString(0, 1000),
  expectedChange: cpString(0, 500),
  nextCheck: cpString(0, 800),
  counterCheck: CounterCheck,
  counterNote: cpString(0, 800),
  status: z.enum(['draft', 'ready']),
  included: z.boolean(),
  order: z.int(),
});
export type Finding = z.infer<typeof FindingSchema>;

export const EvidenceRole = z.enum(['supports', 'contradicts', 'context']);
export type EvidenceRole = z.infer<typeof EvidenceRole>;

export const EvidenceLinkSchema = z.strictObject({
  ...common,
  projectId: id,
  findingId: id,
  excerptId: id,
  role: EvidenceRole,
  order: z.int(),
});
export type EvidenceLink = z.infer<typeof EvidenceLinkSchema>;

export const ExportRecordSchema = z.strictObject({
  id,
  projectId: id,
  format: z.enum(['html', 'pdf']),
  draft: z.boolean(),
  projectRevision: revision,
  createdAt: isoDateTime,
});
export type ExportRecord = z.infer<typeof ExportRecordSchema>;

export const SettingKey = z.enum(['lastBackupAt', 'license', 'display', 'importedBackupDigests']);
export type SettingKey = z.infer<typeof SettingKey>;
export interface SettingRow {
  key: SettingKey;
  value: unknown;
}

export const LicenseFileSchema = z.strictObject({
  payloadB64: z.string().min(4).max(4096),
  signatureB64: z.string().min(4).max(256),
});
export type LicenseFile = z.infer<typeof LicenseFileSchema>;

export const LicensePayloadSchema = z.strictObject({
  version: z.literal(1),
  product: z.literal('koeito'),
  licenseId: z.uuid(),
  edition: z.literal('personal-v1'),
  issuedAt: isoDateTime,
  major: z.literal(1),
});
export type LicensePayload = z.infer<typeof LicensePayloadSchema>;

export const BackupPayloadSchema = z.strictObject({
  schemaVersion: z.int(),
  exportedAt: isoDateTime,
  appVersion: z.string().max(40),
  projects: z.array(ProjectSchema),
  participants: z.array(ParticipantSchema),
  sources: z.array(SourceSchema),
  excerpts: z.array(ExcerptSchema),
  themes: z.array(ThemeSchema),
  findings: z.array(FindingSchema),
  evidenceLinks: z.array(EvidenceLinkSchema),
});
export type BackupPayload = z.infer<typeof BackupPayloadSchema>;

export interface ProjectBundle {
  projects: Project[];
  participants: Participant[];
  sources: Source[];
  excerpts: Excerpt[];
  themes: Theme[];
  findings: Finding[];
  evidenceLinks: EvidenceLink[];
}
