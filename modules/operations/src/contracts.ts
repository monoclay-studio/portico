/**
 * Public API contracts of the operations module (Zod). No server imports — web apps and the staff PWA import
 * this file. Timestamps are ISO-8601 strings; dates are 'YYYY-MM-DD'.
 */
import { z } from 'zod';
import {
  ASSET_KINDS,
  BLOCK_KINDS,
  DEPARTMENT_KINDS,
  DISCREPANCIES,
  DISPOSAL_METHODS,
  ESCALATION_TARGETS,
  INTERVAL_UNITS,
  OBSERVED_OCCUPANCIES,
  OCCUPANCIES,
  SECTION_KINDS,
  SERVICE_REQUEST_CHANNELS,
  TASK_KINDS,
  TASK_PRIORITIES,
  TASK_STATUSES,
  TURNDOWN_STATUSES,
  UNIT_CONDITIONS,
  URGENCIES,
} from './domain/model';

const uuid = z.uuid();
const localDate = z.iso.date();
const isoDateTime = z.iso.datetime({ offset: true });
const text = (max = 500) => z.string().trim().min(1).max(max);

/** Reference to a file in the object store (photos, signatures). Upload happens elsewhere; we keep the ref. */
export const objectRef = z
  .string()
  .max(500)
  .regex(/^(obj|s3):\/\/\S+$/, 'must be an object-store reference such as obj://bucket/key');

export const unitCondition = z.enum(UNIT_CONDITIONS);
export const occupancy = z.enum(OCCUPANCIES);
export const observedOccupancy = z.enum(OBSERVED_OCCUPANCIES);
export const discrepancy = z.enum(DISCREPANCIES);
export const turndownStatus = z.enum(TURNDOWN_STATUSES);
export const taskKind = z.enum(TASK_KINDS);
export const taskStatus = z.enum(TASK_STATUSES);
export const taskPriority = z.enum(TASK_PRIORITIES);
export const departmentKind = z.enum(DEPARTMENT_KINDS);
export const urgency = z.enum(URGENCIES);
export const blockKind = z.enum(BLOCK_KINDS);
export const provenance = z.enum(['live', 'external', 'copied', 'simulated']);
export const entityRef = z.object({ type: z.string().min(1).max(60), id: uuid });

// Universal record contract (domain-map § Universal record contract; types in @portico/kernel records.ts).
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
const recordFacets = {
  status: z.record(z.string(), z.string()),
  allowedActions: z.array(recordAction),
  issues: z.array(recordIssue),
  owner: recordOwner.optional(),
  links: z.array(recordLink),
};

export const propertyParams = z.object({ propertyId: uuid });
export const idParams = z.object({ id: uuid });

// ───────────────────────────── Units ─────────────────────────────

export const readinessReason = z.object({
  code: z.string(),
  message: z.string(),
  details: z.record(z.string(), z.unknown()).optional(),
});

export const readiness = z.object({
  ready: z.boolean(),
  requiredCondition: z.enum(['clean', 'inspected']),
  reasons: z.array(readinessReason),
  readyAt: isoDateTime.nullable(),
  /** An ESTIMATE, labelled as such in every UI. */
  expectedReadyAt: isoDateTime.nullable(),
  estimateBasis: z.array(z.string()),
  assessedAt: isoDateTime,
});
export type Readiness = z.infer<typeof readiness>;

export const unitStatus = z.object({
  unitId: uuid,
  propertyId: uuid,
  unitNumber: z.string(),
  unitTypeId: uuid.nullable(),
  unitTypeCode: z.string().nullable(),
  sectionId: uuid.nullable(),
  sectionName: z.string().nullable(),
  floor: z.string().nullable(),
  features: z.array(z.string()),
  condition: unitCondition,
  conditionChangedAt: isoDateTime,
  occupancy,
  occupancyStayId: uuid.nullable(),
  observedOccupancy: observedOccupancy.nullable(),
  observedAt: isoDateTime.nullable(),
  discrepancy,
  dnd: z.boolean(),
  dndSince: isoDateTime.nullable(),
  turndown: turndownStatus,
  lastCleanedAt: isoDateTime.nullable(),
  lastInspectedAt: isoDateTime.nullable(),
  lastInspectionResult: z.enum(['passed', 'failed']).nullable(),
  block: z
    .object({
      kind: z.enum(['out_of_order', 'out_of_service', 'house_use']),
      blockId: uuid.nullable(),
      from: localDate,
      to: localDate,
      reason: z.string().nullable(),
      workOrderId: uuid.nullable(),
    })
    .nullable(),
  readiness,
  pendingChange: z
    .object({
      forwardId: uuid,
      change: z.record(z.string(), z.unknown()),
      requestedAt: isoDateTime.nullable(),
    })
    .nullable(),
  provenance,
  externalSyncedAt: isoDateTime.nullable(),
  version: z.number().int(),
  ...recordFacets,
});
export type UnitStatusView = z.infer<typeof unitStatus>;

export const unitUpsertInput = z.object({
  units: z
    .array(
      z.object({
        unitId: uuid,
        number: text(40),
        unitTypeId: uuid.nullish(),
        unitTypeCode: z.string().max(40).nullish(),
        sectionCode: z.string().max(40).nullish(),
        floor: z.string().max(20).nullish(),
        locationPath: z.string().max(200).nullish(),
        features: z.array(z.string().max(60)).max(50).optional(),
        active: z.boolean().optional(),
      }),
    )
    .min(1)
    .max(2000),
  initialCondition: unitCondition.optional(),
});
export type UnitUpsertInput = z.infer<typeof unitUpsertInput>;

export const conditionChangeInput = z.object({
  condition: unitCondition,
  reason: z.string().max(500).optional(),
});
export const dndInput = z.object({ dnd: z.boolean(), reason: z.string().max(500).optional() });
export const occupancyReportInput = z.object({
  observed: observedOccupancy,
  note: z.string().max(500).optional(),
});
export const turndownInput = z.object({ status: turndownStatus });

export const unitChangeResult = z.object({
  unit: unitStatus,
  /** True when the change was forwarded to the external system of record and is not yet effective. */
  pending: z.boolean(),
  forwardId: uuid.nullable(),
});
export type UnitChangeResult = z.infer<typeof unitChangeResult>;

export const boardQuery = z.object({
  condition: z
    .string()
    .optional()
    .transform((v) => (v ? v.split(',') : undefined))
    .pipe(z.array(unitCondition).optional()),
  occupancy: occupancy.optional(),
  sectionId: uuid.optional(),
  floor: z.string().max(20).optional(),
  priority: taskPriority.optional(),
  discrepancy: z.coerce.boolean().optional(),
  arrivalsOnly: z.coerce.boolean().optional(),
  attendantUserId: uuid.optional(),
});
export type BoardQuery = z.infer<typeof boardQuery>;

export const boardRow = z.object({
  unit: unitStatus,
  arrival: z
    .object({
      stayId: uuid,
      eta: isoDateTime.nullable(),
      vip: z.boolean(),
      earlyCheckIn: z.boolean(),
      guestLabel: z.string().nullable(),
    })
    .nullable(),
  departureToday: z.object({ stayId: uuid, status: z.string() }).nullable(),
  topPriority: taskPriority.nullable(),
  priorityReasons: z.array(z.string()),
  openTasks: z.array(
    z.object({
      taskId: uuid,
      kind: taskKind,
      status: taskStatus,
      priority: taskPriority,
      assigneeUserId: uuid.nullable(),
      assigneeName: z.string().nullable(),
    }),
  ),
});
export const board = z.object({
  propertyId: uuid,
  businessDate: localDate,
  generatedAt: isoDateTime,
  counts: z.object({
    byCondition: z.record(z.string(), z.number()),
    byOccupancy: z.record(z.string(), z.number()),
    discrepancies: z.number(),
    dnd: z.number(),
    arrivalsNotReady: z.number(),
  }),
  rows: z.array(boardRow),
});
export type Board = z.infer<typeof board>;

export const arrivalReadinessItem = z.object({
  stayId: uuid,
  unitId: uuid.nullable(),
  unitNumber: z.string().nullable(),
  eta: isoDateTime.nullable(),
  vip: z.boolean(),
  guestLabel: z.string().nullable(),
  readiness: readiness.nullable(),
  blocker: z.string().nullable(),
});
export const arrivalReadiness = z.object({
  propertyId: uuid,
  date: localDate,
  items: z.array(arrivalReadinessItem),
});
export type ArrivalReadiness = z.infer<typeof arrivalReadiness>;

// ───────────────────────────── Sections & roster ─────────────────────────────

export const sectionInput = z.object({
  code: text(40),
  name: text(120),
  kind: z.enum(SECTION_KINDS),
  parentCode: z.string().max(40).optional(),
  sortOrder: z.number().int().optional(),
});
export const section = z.object({
  id: uuid,
  propertyId: uuid,
  code: z.string(),
  name: z.string(),
  kind: z.enum(SECTION_KINDS),
  parentId: uuid.nullable(),
  sortOrder: z.number().int(),
});
export type Section = z.infer<typeof section>;

export const attendantInput = z.object({
  userId: uuid,
  displayName: text(120),
  homeSectionCodes: z.array(z.string().max(40)).max(20).default([]),
  dailyCreditCapacity: z.number().int().min(1).max(200),
});
export const attendant = z.object({
  id: uuid,
  propertyId: uuid,
  userId: uuid,
  displayName: z.string(),
  homeSectionIds: z.array(uuid),
  dailyCreditCapacity: z.number().int(),
  active: z.boolean(),
  version: z.number().int(),
});
export type Attendant = z.infer<typeof attendant>;

// ───────────────────────────── Tasks ─────────────────────────────

export const attachment = z.object({
  ref: objectRef,
  contentType: z.string().max(100).optional(),
  caption: z.string().max(200).optional(),
});

export const task = z.object({
  id: uuid,
  propertyId: uuid,
  departmentKind: z.string(),
  departmentId: uuid.nullable(),
  kind: taskKind,
  title: z.string(),
  description: z.string().nullable(),
  priority: taskPriority,
  priorityScore: z.number().int(),
  priorityReasons: z.array(z.string()),
  unitId: uuid.nullable(),
  unitNumber: z.string().nullable(),
  stayId: uuid.nullable(),
  guestProfileId: uuid.nullable(),
  parentTaskId: uuid.nullable(),
  refs: z.array(entityRef),
  assigneeUserId: uuid.nullable(),
  assigneeName: z.string().nullable(),
  serviceDate: localDate.nullable(),
  dueAt: isoDateTime.nullable(),
  sla: z.object({ state: z.enum(['none', 'on_track', 'due_soon', 'overdue']), minutes: z.number().int() }),
  credits: z.number().int(),
  blockedReason: z.string().nullable(),
  cancelledReason: z.string().nullable(),
  startedAt: isoDateTime.nullable(),
  doneAt: isoDateTime.nullable(),
  verifiedAt: isoDateTime.nullable(),
  escalationLevel: z.number().int(),
  escalationPath: z.array(z.object({ afterMinutes: z.number().int(), target: z.enum(ESCALATION_TARGETS) })),
  nextEscalationAt: isoDateTime.nullable(),
  source: z.string(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
  version: z.number().int(),
  ...recordFacets,
});
export type TaskView = z.infer<typeof task>;

export const taskActivity = z.object({
  id: uuid,
  kind: z.string(),
  from: z.string().nullable(),
  to: z.string().nullable(),
  comment: z.string().nullable(),
  attachments: z.array(attachment),
  actor: z.string(),
  occurredAt: isoDateTime,
  clientOccurredAt: isoDateTime.nullable(),
  source: z.string(),
});
export const taskDetail = task.extend({ history: z.array(taskActivity) });
export type TaskDetail = z.infer<typeof taskDetail>;

export const taskCreateInput = z.object({
  propertyId: uuid,
  kind: taskKind.default('general'),
  departmentKind: departmentKind.optional(),
  departmentId: uuid.optional(),
  title: text(200),
  description: z.string().max(4000).optional(),
  priority: taskPriority.default('normal'),
  unitId: uuid.optional(),
  stayId: uuid.optional(),
  guestProfileId: uuid.optional(),
  refs: z.array(entityRef).max(20).optional(),
  dueAt: isoDateTime.optional(),
  assigneeUserId: uuid.optional(),
  assigneeName: z.string().max(120).optional(),
});
export type TaskCreateInput = z.input<typeof taskCreateInput>;

export const taskTransitionInput = z.object({
  to: taskStatus,
  reason: z.string().max(1000).optional(),
  comment: z.string().max(4000).optional(),
});
export const taskAssignInput = z.object({
  assigneeUserId: uuid.nullable(),
  assigneeName: z.string().max(120).optional(),
  reason: z.string().max(500).optional(),
});
export const taskCommentInput = z.object({
  text: z.string().max(4000).default(''),
  attachments: z.array(attachment).max(10).default([]),
});
export const taskListQuery = z.object({
  propertyId: uuid,
  status: z
    .string()
    .optional()
    .transform((v) => (v ? v.split(',') : undefined))
    .pipe(z.array(taskStatus).optional()),
  kind: z
    .string()
    .optional()
    .transform((v) => (v ? v.split(',') : undefined))
    .pipe(z.array(taskKind).optional()),
  assigneeUserId: uuid.optional(),
  unitId: uuid.optional(),
  departmentKind: z.string().max(40).optional(),
  serviceDate: localDate.optional(),
  overdue: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});
export type TaskListQuery = z.infer<typeof taskListQuery>;

export const escalationRunResult = z.object({
  /** Welfare-check tasks created for units on do-not-disturb beyond the policy limit. */
  welfareChecks: z.array(uuid),
  escalated: z.array(
    z.object({
      taskId: uuid,
      level: z.number().int(),
      target: z.enum(ESCALATION_TARGETS),
      minutesOverdue: z.number().int(),
    }),
  ),
});

// ───────────────────────────── Service requests ─────────────────────────────

export const serviceRequestInput = z.object({
  propertyId: uuid,
  stayId: uuid.optional(),
  guestProfileId: uuid.optional(),
  unitId: uuid.optional(),
  channel: z.enum(SERVICE_REQUEST_CHANNELS),
  category: text(60),
  description: text(2000),
  priority: taskPriority.default('normal'),
  departmentKind: departmentKind.optional(),
  dueAt: isoDateTime.optional(),
  assigneeUserId: uuid.optional(),
});
export type ServiceRequestInput = z.input<typeof serviceRequestInput>;

export const serviceRequest = z.object({
  id: uuid,
  propertyId: uuid,
  number: z.string(),
  channel: z.enum(SERVICE_REQUEST_CHANNELS),
  category: z.string(),
  description: z.string(),
  stayId: uuid.nullable(),
  guestProfileId: uuid.nullable(),
  unitId: uuid.nullable(),
  requestedAt: isoDateTime,
  fulfilledAt: isoDateTime.nullable(),
  task,
  version: z.number().int(),
  ...recordFacets,
});
export type ServiceRequestView = z.infer<typeof serviceRequest>;

// ───────────────────────────── Housekeeping planning ─────────────────────────────

export const dayPlanInput = z.object({ date: localDate.optional() });
export const dayPlanResult = z.object({
  propertyId: uuid,
  date: localDate,
  created: z.array(task),
  alreadyPlanned: z.number().int(),
});
export const assignmentSuggestionQuery = z.object({ date: localDate.optional() });
export const assignmentSuggestions = z.object({
  propertyId: uuid,
  date: localDate,
  suggestions: z.array(
    z.object({
      taskId: uuid,
      unitNumber: z.string().nullable(),
      kind: taskKind,
      credits: z.number().int(),
      attendantId: uuid,
      attendantUserId: uuid,
      attendantName: z.string(),
      explanation: z.array(z.string()),
      alternatives: z.array(
        z.object({
          attendantId: uuid,
          attendantName: z.string(),
          score: z.number(),
          factors: z.array(z.string()),
        }),
      ),
      taskVersion: z.number().int(),
    }),
  ),
  unassigned: z.array(z.object({ taskId: uuid, reason: z.string() })),
  workload: z.array(
    z.object({
      attendantId: uuid,
      attendantName: z.string(),
      capacity: z.number().int(),
      creditsBefore: z.number().int(),
      creditsAfter: z.number().int(),
      utilisationPercent: z.number().int(),
      suggestedTaskIds: z.array(uuid),
    }),
  ),
});
export type AssignmentSuggestions = z.infer<typeof assignmentSuggestions>;
export const applyAssignmentsInput = z.object({
  assignments: z
    .array(z.object({ taskId: uuid, expectedVersion: z.number().int(), attendantId: uuid }))
    .min(1)
    .max(500),
  reason: z.string().max(500).optional(),
});
export const applyAssignmentsResult = z.object({
  applied: z.array(task),
  conflicts: z.array(
    z.object({ taskId: uuid, code: z.string(), message: z.string(), currentVersion: z.number() }),
  ),
});

// ───────────────────────────── Inspections ─────────────────────────────

export const checklistItemDefinition = z.object({
  code: z.string().min(1).max(60),
  label: text(200),
  critical: z.boolean().default(true),
  area: z.string().max(60).optional(),
});
export const checklistTemplateInput = z.object({
  code: text(40),
  name: text(120),
  purpose: z.enum(['unit', 'public_area', 'return_to_service', 'asset']).default('unit'),
  items: z.array(checklistItemDefinition).min(1).max(200),
});
export const checklistTemplate = z.object({
  id: uuid,
  propertyId: uuid,
  code: z.string(),
  name: z.string(),
  purpose: z.string(),
  items: z.array(
    z.object({ code: z.string(), label: z.string(), critical: z.boolean(), area: z.string().optional() }),
  ),
  active: z.boolean(),
  version: z.number().int(),
});

export const inspectionInput = z.object({
  checklistCode: z.string().max(40).optional(),
  items: z
    .array(
      z.object({
        code: z.string().min(1).max(60),
        result: z.enum(['pass', 'fail', 'na']),
        note: z.string().max(1000).optional(),
        photoRefs: z.array(objectRef).max(10).optional(),
      }),
    )
    .max(200)
    .default([]),
  /** For properties without a checklist: free-text failure reasons (empty = pass). */
  failureReasons: z.array(text(300)).max(20).optional(),
  notes: z.string().max(2000).optional(),
  taskId: uuid.optional(),
  clientInspectedAt: isoDateTime.optional(),
});
export type InspectionInput = z.input<typeof inspectionInput>;

export const inspection = z.object({
  id: uuid,
  propertyId: uuid,
  unitId: uuid,
  result: z.enum(['passed', 'failed']),
  reasons: z.array(z.string()),
  items: z.array(z.record(z.string(), z.unknown())),
  checklistCode: z.string().nullable(),
  inspector: z.string(),
  inspectedAt: isoDateTime,
  recleanTaskId: uuid.nullable(),
  affectedStayId: uuid.nullable(),
  workOrderId: uuid.nullable(),
});
export const inspectionResult = z.object({
  inspection,
  unit: unitStatus,
  recleanTask: task.nullable(),
  pending: z.boolean(),
});
export type InspectionResult = z.infer<typeof inspectionResult>;

// ───────────────────────────── Maintenance ─────────────────────────────

export const assetInput = z.object({
  kind: z.enum(ASSET_KINDS),
  code: text(60),
  name: text(200),
  category: text(60),
  unitId: uuid.optional(),
  parentAssetCode: z.string().max(60).optional(),
  sectionCode: z.string().max(40).optional(),
  locationPath: z.string().max(200).optional(),
  manufacturer: z.string().max(120).optional(),
  model: z.string().max(120).optional(),
  serialNumber: z.string().max(120).optional(),
  installedOn: localDate.optional(),
});
export const assetUpdateInput = assetInput
  .omit({ kind: true, code: true })
  .partial()
  .extend({ status: z.enum(['active', 'retired']).optional() });
export const asset = z.object({
  id: uuid,
  propertyId: uuid,
  kind: z.enum(ASSET_KINDS),
  code: z.string(),
  name: z.string(),
  category: z.string(),
  unitId: uuid.nullable(),
  parentAssetId: uuid.nullable(),
  sectionId: uuid.nullable(),
  locationPath: z.string().nullable(),
  manufacturer: z.string().nullable(),
  model: z.string().nullable(),
  serialNumber: z.string().nullable(),
  installedOn: localDate.nullable(),
  status: z.enum(['active', 'retired']),
  version: z.number().int(),
});
export type AssetView = z.infer<typeof asset>;

export const part = z.object({
  name: text(200),
  partNumber: z.string().max(100).optional(),
  quantity: z.number().int().min(1).max(10_000),
  note: z.string().max(500).optional(),
});
export const photo = z.object({
  ref: objectRef,
  caption: z.string().max(200).optional(),
  takenAt: isoDateTime.optional(),
});

export const blockRequestInput = z.object({
  kind: blockKind,
  from: localDate,
  to: localDate,
  reason: text(500),
});
export type BlockRequestInput = z.infer<typeof blockRequestInput>;

export const workOrderInput = z.object({
  propertyId: uuid,
  assetId: uuid.optional(),
  unitId: uuid.optional(),
  locationText: z.string().max(200).optional(),
  title: text(200),
  description: z.string().max(4000).optional(),
  faultCategory: text(60),
  urgency: urgency.default('normal'),
  photos: z.array(photo).max(20).optional(),
  assigneeUserId: uuid.optional(),
  assigneeName: z.string().max(120).optional(),
  dueAt: isoDateTime.optional(),
  block: blockRequestInput.optional(),
});
export type WorkOrderInput = z.input<typeof workOrderInput>;

export const resolutionItem = z.object({
  id: uuid,
  propertyId: uuid,
  unitId: uuid,
  unitNumber: z.string().nullable(),
  blockId: uuid,
  workOrderId: uuid.nullable(),
  ref: entityRef,
  nights: z.object({ from: localDate, to: localDate }),
  status: z.enum(['open', 'resolved', 'dismissed']),
  resolutionNote: z.string().nullable(),
  resolvedAt: isoDateTime.nullable(),
  version: z.number().int(),
});
export type ResolutionItemView = z.infer<typeof resolutionItem>;
export const resolveItemInput = z.object({
  status: z.enum(['resolved', 'dismissed']),
  note: text(1000),
});

export const workOrder = z.object({
  id: uuid,
  propertyId: uuid,
  number: z.string(),
  assetId: uuid.nullable(),
  unitId: uuid.nullable(),
  locationText: z.string().nullable(),
  faultCategory: z.string(),
  urgency,
  photos: z.array(photo),
  parts: z.array(part),
  resolutionNote: z.string().nullable(),
  completedAt: isoDateTime.nullable(),
  block: z.object({
    status: z.enum(['none', 'pending_forward', 'active', 'released', 'refused']),
    kind: blockKind.nullable(),
    from: localDate.nullable(),
    to: localDate.nullable(),
    reason: z.string().nullable(),
    blockId: uuid.nullable(),
    /** Why inventory / the system of record refused the block, and what to do next. */
    refusal: z.object({ code: z.string(), message: z.string(), nextStep: z.string() }).nullable(),
    /** Released directly in inventory, bypassing return to service (shown as a blocking issue). */
    releasedExternallyAt: isoDateTime.nullable(),
  }),
  returnToService: z.enum([
    'not_applicable',
    'awaiting_completion',
    'awaiting_inspection',
    'ready',
    'returned',
  ]),
  returnedToServiceAt: isoDateTime.nullable(),
  preventiveScheduleId: uuid.nullable(),
  preventiveDueOn: localDate.nullable(),
  authorityState: z.enum(['effective', 'pending_forward', 'rejected']),
  reportedVia: z.string(),
  task,
  resolutionItems: z.array(resolutionItem),
  version: z.number().int(),
  ...recordFacets,
});
export type WorkOrderView = z.infer<typeof workOrder>;

export const workOrderCompleteInput = z.object({
  resolutionNote: text(4000),
  parts: z.array(part).max(50).optional(),
});
export const workOrderPartsInput = z.object({ parts: z.array(part).min(1).max(50) });
export const workOrderPhotosInput = z.object({ photos: z.array(photo).min(1).max(20) });
export const workOrderListQuery = z.object({
  propertyId: uuid,
  open: z.coerce.boolean().optional(),
  assetId: uuid.optional(),
  unitId: uuid.optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});

export const assetHistory = z.object({
  asset,
  workOrders: z.array(workOrder),
  inspections: z.array(inspection),
});

export const preventiveScheduleInput = z.object({
  code: text(60),
  title: text(200),
  description: z.string().max(2000).optional(),
  assetId: uuid.optional(),
  assetCategory: z.string().max(60).optional(),
  faultCategory: text(60),
  urgency: urgency.default('normal'),
  intervalUnit: z.enum(INTERVAL_UNITS),
  intervalCount: z.number().int().min(1).max(365),
  firstDueOn: localDate,
  leadDays: z.number().int().min(0).max(90).default(0),
  checklistCode: z.string().max(40).optional(),
});
export const preventiveSchedule = z.object({
  id: uuid,
  propertyId: uuid,
  code: z.string(),
  title: z.string(),
  assetId: uuid.nullable(),
  assetCategory: z.string().nullable(),
  faultCategory: z.string(),
  urgency,
  intervalUnit: z.enum(INTERVAL_UNITS),
  intervalCount: z.number().int(),
  nextDueOn: localDate,
  leadDays: z.number().int(),
  active: z.boolean(),
  lastRunAt: isoDateTime.nullable(),
  version: z.number().int(),
});
export type PreventiveScheduleView = z.infer<typeof preventiveSchedule>;
export const preventiveRunInput = z.object({ asOf: localDate.optional() });
export const preventiveRunResult = z.object({
  asOf: localDate,
  created: z.array(
    z.object({ workOrderId: uuid, number: z.string(), scheduleCode: z.string(), dueOn: localDate }),
  ),
  alreadyGenerated: z.number().int(),
  skippedOccurrences: z.number().int(),
});

// ───────────────────────────── Lost & found ─────────────────────────────

export const lostFoundInput = z.object({
  propertyId: uuid,
  description: text(1000),
  category: text(60),
  highValue: z.boolean().default(false),
  foundAt: isoDateTime,
  foundLocation: text(200),
  foundUnitId: uuid.optional(),
  finder: text(120),
  finderUserId: uuid.optional(),
  storageLocation: text(200),
  photos: z.array(photo).max(10).optional(),
});
export type LostFoundInput = z.input<typeof lostFoundInput>;
export const lostFoundMatchInput = z.object({
  guestProfileId: uuid.optional(),
  stayId: uuid.optional(),
  note: z.string().max(1000).optional(),
});
export const lostFoundReleaseInput = z.object({
  /** Handed over in person, or shipped to the guest (common for guests already home abroad). */
  method: z.enum(['handed_over', 'shipped']).default('handed_over'),
  trackingRef: z.string().max(120).optional(),
  releasedTo: text(200),
  signatureRef: objectRef,
  note: z.string().max(1000).optional(),
});
export const lostFoundDisposeInput = z.object({
  method: z.enum(DISPOSAL_METHODS),
  signatureRef: objectRef,
  reason: z.string().max(1000).optional(),
});
export const lostFoundItem = z.object({
  id: uuid,
  propertyId: uuid,
  number: z.string(),
  description: z.string(),
  category: z.string(),
  highValue: z.boolean(),
  foundAt: isoDateTime,
  foundLocation: z.string(),
  foundUnitId: uuid.nullable(),
  finder: z.string(),
  storageLocation: z.string(),
  photos: z.array(photo),
  matchedGuestProfileId: uuid.nullable(),
  matchedStayId: uuid.nullable(),
  releasedTo: z.string().nullable(),
  releaseMethod: z.enum(['handed_over', 'shipped']).nullable(),
  trackingRef: z.string().nullable(),
  releaseSignatureRef: z.string().nullable(),
  releasedAt: isoDateTime.nullable(),
  disposalMethod: z.string().nullable(),
  disposedAt: isoDateTime.nullable(),
  retentionUntil: localDate,
  version: z.number().int(),
  ...recordFacets,
});
export type LostFoundView = z.infer<typeof lostFoundItem>;

// ───────────────────────────── Offline sync ─────────────────────────────

const baseMutation = {
  clientMutationId: z.string().min(8).max(100),
  clientTimestamp: isoDateTime,
};

export const syncMutation = z.discriminatedUnion('op', [
  z.object({
    ...baseMutation,
    op: z.literal('unit.setCondition'),
    unitId: uuid,
    baseVersion: z.number().int(),
    condition: unitCondition,
    reason: z.string().max(500).optional(),
  }),
  z.object({
    ...baseMutation,
    op: z.literal('unit.setDnd'),
    unitId: uuid,
    baseVersion: z.number().int(),
    dnd: z.boolean(),
  }),
  z.object({
    ...baseMutation,
    op: z.literal('unit.reportOccupancy'),
    unitId: uuid,
    baseVersion: z.number().int(),
    observed: observedOccupancy,
    note: z.string().max(500).optional(),
  }),
  z.object({
    ...baseMutation,
    op: z.literal('unit.setTurndown'),
    unitId: uuid,
    baseVersion: z.number().int(),
    status: turndownStatus,
  }),
  z.object({
    ...baseMutation,
    op: z.literal('task.transition'),
    taskId: uuid,
    baseVersion: z.number().int(),
    to: taskStatus,
    reason: z.string().max(1000).optional(),
  }),
  z.object({
    ...baseMutation,
    op: z.literal('task.comment'),
    taskId: uuid,
    text: z.string().max(4000).default(''),
    attachments: z.array(attachment).max(10).default([]),
  }),
  z.object({
    ...baseMutation,
    op: z.literal('inspection.record'),
    unitId: uuid,
    baseVersion: z.number().int(),
    inspection: inspectionInput.omit({ clientInspectedAt: true }),
  }),
  z.object({
    ...baseMutation,
    op: z.literal('lostFound.record'),
    item: lostFoundInput.omit({ propertyId: true }),
  }),
]);
export type SyncMutation = z.infer<typeof syncMutation>;

export const syncBatchInput = z.object({
  propertyId: uuid,
  deviceId: z.string().min(1).max(100),
  mutations: z.array(syncMutation).min(1).max(200),
});
export type SyncBatchInput = z.input<typeof syncBatchInput>;

export const syncMutationResult = z.object({
  clientMutationId: z.string(),
  op: z.string(),
  /**
   * applied: effective now · pending: forwarded to the external system of record, not yet effective ·
   * duplicate: already processed earlier (stored outcome returned, nothing re-applied) · conflict: rejected
   * because the record changed since the device's version · rejected: not allowed / invalid ·
   * skipped: depended on an earlier mutation in this batch that was not applied.
   */
  status: z.enum(['applied', 'pending', 'duplicate', 'conflict', 'rejected', 'skipped']),
  originalStatus: z.enum(['applied', 'pending', 'conflict', 'rejected', 'skipped']).optional(),
  code: z.string().nullable(),
  message: z.string().nullable(),
  entity: z.object({ type: z.string(), id: uuid }).nullable(),
  baseVersion: z.number().int().nullable(),
  resultVersion: z.number().int().nullable(),
  noChange: z.boolean().optional(),
  /** True when the failure was transient: the device should resend the same mutation (same id) later. */
  retryable: z.boolean().optional(),
  conflict: z
    .object({
      currentVersion: z.number().int(),
      changesSinceYourVersion: z.array(
        z.object({
          field: z.string(),
          from: z.string().nullable(),
          to: z.string().nullable(),
          by: z.string(),
          at: z.string(),
          version: z.number().int(),
        }),
      ),
    })
    .nullable(),
});
export type SyncMutationResult = z.infer<typeof syncMutationResult>;

export const syncBatchResult = z.object({
  results: z.array(syncMutationResult),
  /** Authoritative server state of every record the batch touched. */
  units: z.array(unitStatus),
  tasks: z.array(task),
  serverTime: isoDateTime,
});
export type SyncBatchResult = z.infer<typeof syncBatchResult>;

export const syncConflict = z.object({
  clientMutationId: z.string(),
  deviceId: z.string(),
  actor: z.string(),
  op: z.string(),
  entity: z.object({ type: z.string(), id: uuid }).nullable(),
  code: z.string().nullable(),
  message: z.string().nullable(),
  baseVersion: z.number().int().nullable(),
  conflict: syncMutationResult.shape.conflict,
  clientOccurredAt: isoDateTime,
  processedAt: isoDateTime,
});
export type SyncConflictView = z.infer<typeof syncConflict>;

export const changesQuery = z.object({
  propertyId: uuid,
  cursor: z.string().max(600).optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(500),
});
export const changes = z.object({
  units: z.array(unitStatus),
  tasks: z.array(task),
  workOrders: z.array(
    z.object({
      id: uuid,
      number: z.string(),
      unitId: uuid.nullable(),
      taskId: uuid,
      version: z.number().int(),
    }),
  ),
  cursor: z.string(),
  hasMore: z.boolean(),
  serverTime: isoDateTime,
});
export type Changes = z.infer<typeof changes>;

// ───────────────────────────── Connected mode ─────────────────────────────

export const statusForward = z.object({
  id: uuid,
  propertyId: uuid,
  domain: z.enum(['roomStatus', 'maintenance']),
  connectionId: uuid.nullable(),
  targetType: z.enum(['unit', 'work_order']),
  targetId: uuid,
  change: z.record(z.string(), z.unknown()),
  status: z.enum(['pending', 'acknowledged', 'rejected', 'superseded']),
  requestedAt: isoDateTime,
  resolvedAt: isoDateTime.nullable(),
  externalRef: z.string().nullable(),
  rejectionReason: z.string().nullable(),
});
export type StatusForwardView = z.infer<typeof statusForward>;
export const forwardAckInput = z.object({
  outcome: z.enum(['acknowledged', 'rejected']),
  externalRef: z.string().max(200).optional(),
  reason: z.string().max(1000).optional(),
});
export const externalRoomStatusInput = z.object({
  condition: unitCondition.optional(),
  dnd: z.boolean().optional(),
  observedAt: isoDateTime,
  connectionId: uuid,
});

// ───────────────────────────── My work (cross-module inbox feed) ─────────────────────────────

export const myWorkQuery = z.object({
  propertyId: uuid.optional(),
  /** Also include unassigned work of these departments (e.g. housekeeping,engineering). */
  departments: z
    .string()
    .optional()
    .transform((v) => (v ? v.split(',') : undefined))
    .pipe(z.array(departmentKind).optional()),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});
export const workItem = z.object({
  type: z.literal('task'),
  id: uuid,
  propertyId: uuid,
  title: z.string(),
  kind: taskKind,
  status: z.record(z.string(), z.string()),
  priority: taskPriority,
  dueAt: isoDateTime.nullable(),
  owner: recordOwner,
  issues: z.array(recordIssue),
  links: z.array(recordLink),
});
export type WorkItem = z.infer<typeof workItem>;
