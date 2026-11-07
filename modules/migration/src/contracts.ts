/**
 * Public API contracts of the migration module (Zod; no server imports — the web apps import this file).
 * Mounted under /v1/migration.
 */
import type { Provenance } from '@portico/kernel';
import { z } from 'zod';
import { BOOKING_STATUSES, DATA_CLASSES, EXCEPTION_STATUSES, RECORD_STATES } from './vocabulary';

const uuid = z.uuid();
const isoDateTime = z.string();

export const dataClass = z.enum(DATA_CLASSES);
export const bookingStatus = z.enum(BOOKING_STATUSES);
export const recordState = z.enum(RECORD_STATES);
export const exceptionStatus = z.enum(EXCEPTION_STATUSES);
/** Provenance a migration shows (kernel vocabulary subset, tied at compile time — BS3-1). */
const JOB_PROVENANCE = ['live', 'copied', 'simulated'] as const satisfies readonly Provenance[];
export const jobProvenance = z.enum(JOB_PROVENANCE);

export const tableKind = z.enum([
  'unit_types',
  'units',
  'rate_plans',
  'guests',
  'reservations',
  'reservation_nights',
  'deposits',
  'in_house_balances',
  'ar_open_items',
  'control_totals',
]);

// ───────────────────────────── Universal record contract ─────────────────────────────

export const recordAction = z.object({
  action: z.string(),
  label: z.string(),
  enabled: z.boolean(),
  reason: z.string().optional(),
  previewRequired: z.boolean().optional(),
});
export const recordOwner = z.object({
  kind: z.enum(['user', 'department']),
  id: z.string(),
  name: z.string().optional(),
});
export const recordIssue = z.object({
  code: z.string(),
  severity: z.enum(['blocking', 'warning', 'info']),
  message: z.string(),
  owner: recordOwner.optional(),
  since: z.string().optional(),
});
export const recordLink = z.object({
  rel: z.string(),
  type: z.string(),
  id: z.string(),
  title: z.string().optional(),
});

// ───────────────────────────── Inputs ─────────────────────────────

export const createJobInput = z.object({
  propertyId: uuid,
  /** Source adapter key (GET /migration/sources). */
  sourceAdapter: z.string().min(1).max(60),
  /** How the hotel names its current system, e.g. "Little Hotelier (Coral Nest)". */
  sourceSystem: z.string().trim().min(2).max(120),
  /** Simulator account id for the PMS simulator source. */
  sourceRef: z.string().min(1).max(100).optional(),
  /** Classes to migrate (default: everything the source and the finance pack provide). */
  scope: z.array(dataClass).min(1).max(8).optional(),
  /** Production jobs: the linked trial organization and property where rehearsals run. */
  rehearsal: z.object({ trialOrganizationId: uuid, trialPropertyId: uuid }).optional(),
});
export type CreateJobInput = z.infer<typeof createJobInput>;

export const uploadedFile = z.object({
  name: z.string().trim().min(1).max(200),
  content: z.string().min(1).max(28_000_000),
  encoding: z.enum(['text', 'base64']).optional(),
  kind: tableKind.optional(),
  columnOverrides: z.record(z.string().max(120), z.string().max(60)).optional(),
});
export const uploadInput = z.object({
  files: z.array(uploadedFile).min(1).max(20),
  /** Store even though some tables need confirmation (the person reviewed the detection preview). */
  confirmDetection: z.boolean().optional(),
});
export type UploadInput = z.infer<typeof uploadInput>;

export const reviewMappingInput = z.object({
  unitTypes: z
    .array(
      z.object({
        sourceCode: z.string().max(40),
        action: z.enum(['create', 'map']),
        targetCode: z.string().max(40),
      }),
    )
    .max(500)
    .optional(),
  ratePlans: z
    .array(
      z.object({
        sourceCode: z.string().max(40),
        action: z.enum(['map', 'not_in_portico']),
        targetCode: z.string().max(40).nullable(),
      }),
    )
    .max(2000)
    .optional(),
  statuses: z
    .array(z.object({ sourceWord: z.string().max(60), status: bookingStatus }))
    .max(100)
    .optional(),
  taxAccounts: z
    .array(z.object({ sourceCode: z.string().max(40), accountKey: z.string().max(60) }))
    .max(50)
    .optional(),
  dateOrder: z.enum(['dmy', 'mdy']).optional(),
});
export type ReviewMappingInput = z.infer<typeof reviewMappingInput>;

export const resolveExceptionInput = z.object({
  outcome: z.enum(['resolved', 'import_as_is', 'excluded', 'accepted_as_loss', 'deferred']),
  resolution: z.string().trim().min(3).max(2000),
});
export const assignExceptionInput = z.object({ ownerUserId: z.string().min(1).max(100) });

export const checklistInput = z.object({
  status: z.enum(['done', 'not_applicable']),
  /** What proves it: a document reference, a decision, the planned time … (shown in the audit). */
  evidence: z.object({
    reference: z.string().trim().max(500).optional(),
    decision: z.string().trim().max(100).optional(),
    note: z.string().trim().max(2000).optional(),
  }),
});
export type ChecklistInput = z.infer<typeof checklistInput>;

export const authorizeInput = z.object({
  /** Reference of the hotel's signed authorization (document id) — required. */
  evidenceRef: z.string().trim().min(3).max(500),
  note: z.string().trim().max(2000).optional(),
  validHours: z
    .number()
    .int()
    .min(1)
    .max(24 * 14)
    .default(72),
});

export const planCutoverInput = z.object({
  plannedStartAt: isoDateTime,
  freezeMinutes: z.number().int().min(1).max(240).default(15),
});

export const startCutoverInput = z.object({
  /** The person confirms the old system is frozen (channels stop-sold, no more changes). */
  sourceFrozen: z.literal(true),
  /** Final capture for file sources (the export taken at freeze start). */
  files: z.array(uploadedFile).max(20).optional(),
});

export const rollbackInput = z.object({ reason: z.string().trim().min(5).max(2000) });
export const journalTickInput = z.object({ status: z.enum(['replayed', 'not_needed']) });
export const linkRehearsalInput = z.object({ trialOrganizationId: uuid, trialPropertyId: uuid });
export const listJobsQuery = z.object({ propertyId: uuid.optional() });
export const exceptionsQuery = z.object({
  status: z.enum(['open', 'closed', 'all']).default('open'),
  severity: z.enum(['blocking', 'warning']).optional(),
  dataClass: dataClass.optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});

// ───────────────────────────── Views ─────────────────────────────

export const stepView = z.object({
  key: z.string(),
  label: z.string(),
  status: z.enum(['pending', 'running', 'succeeded', 'waiting', 'failed', 'skipped']),
  detail: z.string().nullable(),
  owner: z.string().nullable(),
  at: isoDateTime.nullable(),
});

export const checklistItemView = z.object({
  key: z.string(),
  title: z.string(),
  why: z.string(),
  ownerRole: z.string(),
  ownerUserId: z.string().nullable(),
  completion: z.enum(['person', 'observed']),
  status: z.enum(['waiting', 'done', 'not_applicable']),
  dueAt: isoDateTime,
  overdue: z.boolean(),
  reminders: z.number().int(),
  completedBy: z.string().nullable(),
  completedAt: isoDateTime.nullable(),
  evidence: z.record(z.string(), z.unknown()).nullable(),
});

export const reviewItemView = z.object({
  kind: z.string(),
  ref: z.string(),
  reason: z.string(),
  financial: z.boolean(),
});

export const jobView = z.object({
  id: uuid,
  propertyId: uuid,
  purpose: z.enum(['rehearsal', 'production']),
  environment: z.string(),
  source: z.object({
    adapter: z.string(),
    label: z.string(),
    system: z.string(),
    verification: z.enum(['verified', 'unverified']),
    verificationNote: z.string(),
  }),
  state: z.string(),
  headline: z.string(),
  steps: z.array(stepView),
  counts: z.record(
    z.string(),
    z.object({ source: z.number().int(), imported: z.number().int(), exceptions: z.number().int() }),
  ),
  pendingReview: z.array(reviewItemView),
  planFingerprint: z.string().nullable(),
  lastReport: z
    .object({
      id: uuid,
      seq: z.number().int(),
      exact: z.boolean(),
      fingerprint: z.string(),
      generatedAt: isoDateTime,
    })
    .nullable(),
  certificate: z.record(z.string(), z.unknown()).nullable(),
  freeze: z.object({
    targetMinutes: z.number(),
    measuredMinutes: z.number().nullable(),
    frozenAt: isoDateTime.nullable(),
    openedAt: isoDateTime.nullable(),
  }),
  rollbackWindowEndsAt: isoDateTime.nullable(),
  checklist: z.array(checklistItemView),
  openExceptions: z.object({
    blocking: z.number().int(),
    warning: z.number().int(),
    financial: z.number().int(),
  }),
  provenance: jobProvenance,
  status: z.record(z.string(), z.string()),
  allowedActions: z.array(recordAction),
  issues: z.array(recordIssue),
  owner: recordOwner.optional(),
  links: z.array(recordLink),
  createdAt: isoDateTime,
  version: z.number().int(),
});
export type JobView = z.infer<typeof jobView>;

export const exceptionView = z.object({
  id: uuid,
  jobId: uuid,
  dataClass,
  sourceKey: z.string().nullable(),
  code: z.string(),
  severity: z.enum(['blocking', 'warning']),
  financial: z.boolean(),
  problem: z.string(),
  impact: z.string(),
  proposedResolution: z.string(),
  ownerRole: z.string(),
  ownerUserId: z.string().nullable(),
  dueAt: isoDateTime.nullable(),
  state: exceptionStatus,
  resolution: z.string().nullable(),
  repeatCount: z.number().int(),
  status: z.record(z.string(), z.string()),
  allowedActions: z.array(recordAction),
  issues: z.array(recordIssue),
  links: z.array(recordLink),
  version: z.number().int(),
});

export const reportView = z.object({
  id: uuid,
  jobId: uuid,
  seq: z.number().int(),
  context: z.string(),
  extractSeq: z.number().int(),
  exact: z.boolean(),
  fingerprint: z.string(),
  result: z.record(z.string(), z.unknown()),
  generatedAt: isoDateTime,
});

export const uploadResult = z.object({
  stored: z.boolean(),
  extractSeq: z.number().int().nullable(),
  review: z.array(
    z.object({
      name: z.string(),
      kind: z.string(),
      confidence: z.number(),
      missingRequired: z.array(z.string()),
      unmappedHeaders: z.array(z.string()),
      columns: z.array(z.object({ header: z.string(), field: z.string(), confidence: z.number() })),
      rows: z.number().int(),
      needsConfirmation: z.boolean(),
    }),
  ),
  counts: z.record(z.string(), z.number().int()),
  delta: z
    .object({ added: z.number().int(), changed: z.number().int(), removed: z.number().int() })
    .nullable(),
});

export const runResult = z.object({
  job: jobView,
  executed: z.array(z.object({ step: z.string(), status: z.string(), detail: z.string().nullable() })),
});

export const sourceAdapterView = z.object({
  key: z.string(),
  label: z.string(),
  vendor: z.string(),
  kind: z.enum(['file', 'simulator']),
  verification: z.enum(['verified', 'unverified']),
  verificationNote: z.string(),
  provides: z.array(dataClass),
  assessment: z.record(z.string(), z.string()),
});

export const journalEntryView = z.object({
  id: uuid,
  eventType: z.string(),
  occurredAt: isoDateTime,
  recordType: z.string(),
  recordId: z.string(),
  summary: z.string(),
  worklistStatus: z.enum(['to_replay', 'replayed', 'not_needed']),
});

export const cardRecollectionView = z.object({
  sourceKey: z.string(),
  bookingId: z.string(),
  arrival: z.string(),
  status: z.enum(['to_request', 'requested', 'simulated', 'collected', 'not_needed']),
  reference: z.string().nullable(),
  note: z.string().nullable(),
});

export const ledgerEntryView = z.object({
  dataClass,
  sourceKey: z.string(),
  state: recordState,
  targetType: z.string().nullable(),
  targetId: z.string().nullable(),
  reason: z.string().nullable(),
});
