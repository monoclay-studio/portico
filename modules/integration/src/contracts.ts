// Public API contracts for the integration module. No server-only imports here: web apps import this file.
import { z } from 'zod';

// ───────────────────────────── Vocabulary ─────────────────────────────

export const connectorCategory = z.enum([
  'pms',
  'channel',
  'pos',
  'accounting',
  'payments',
  'doorLock',
  'rms',
  'crm',
  'messaging',
  'spaActivities',
  'transport',
  'procurement',
  'identity',
  'fiscal',
  'dataPlatform',
  'file',
]);
export type ConnectorCategory = z.infer<typeof connectorCategory>;

export const mappingKind = z.enum([
  'property',
  'unitType',
  'unit',
  'ratePlan',
  'outlet',
  'chargeCode',
  'taxRule',
  'ledgerAccount',
  'status',
]);
export type MappingKind = z.infer<typeof mappingKind>;

export const workflowOperation = z.enum(['read', 'create', 'update', 'receive']);
export type WorkflowOperation = z.infer<typeof workflowOperation>;
export const syncMode = z.enum(['realtime', 'periodic', 'manual', 'file']);
export type SyncMode = z.infer<typeof syncMode>;
export const capabilityStatus = z.enum(['supported', 'limited', 'unsupported', 'unverified']);
export type CapabilityStatus = z.infer<typeof capabilityStatus>;
export const readinessLevel = z.enum(['R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'R8', 'R9']);
export type ReadinessLevel = z.infer<typeof readinessLevel>;
export const accessModel = z.enum(['public_api', 'partner_program', 'on_prem_interface', 'file']);
/** money: moves money · inventory: consumes or changes inventory/reservations · inventory_reopen: releases it. */
export const effectClass = z.enum(['standard', 'money', 'inventory', 'inventory_reopen']);
export type EffectClass = z.infer<typeof effectClass>;

/** Same domains as platform data authority (ADR-0014). Duplicated here: modules never import each other. */
export const dataDomain = z.enum([
  'reservations',
  'availability',
  'rates',
  'guestProfiles',
  'charges',
  'payments',
  'roomStatus',
  'maintenance',
  'accounting',
]);
export type DataDomain = z.infer<typeof dataDomain>;

export const responsibleParty = z.enum(['hotel', 'monoclay', 'vendor']);
export type ResponsibleParty = z.infer<typeof responsibleParty>;
export const severity = z.enum(['urgent', 'routine']);
export type Severity = z.infer<typeof severity>;

export const connectionState = z.enum([
  'selected',
  'compatibility_reviewed',
  'authorized',
  'mappings_suggested',
  'issues_resolved',
  'validated',
  'previewed',
  'active',
  'monitoring',
  'paused',
  'disconnected',
  'error',
]);
export type ConnectionState = z.infer<typeof connectionState>;

export const healthStatus = z.enum(['not_monitored', 'healthy', 'degraded', 'down', 'paused']);
export type HealthStatus = z.infer<typeof healthStatus>;

/** Glossary "Integration status": supported → configured → tested → live. Never collapsed. */
export const integrationStatus = z.enum(['supported', 'configured', 'tested', 'live']);
export type IntegrationStatus = z.infer<typeof integrationStatus>;

/** How data exchanged by a connection must be labeled (CLAUDE.md rule 16). */
export const exchangeProvenance = z.enum(['live', 'sandbox', 'simulated', 'file']);
export type ExchangeProvenance = z.infer<typeof exchangeProvenance>;

// ───────────────────────────── Catalogue ─────────────────────────────

export const workflowCapability = z.object({
  workflow: z.string(),
  label: z.string(),
  description: z.string(),
  operations: z.array(workflowOperation),
  sync: syncMode,
  status: capabilityStatus,
  limitations: z.array(z.string()),
  /** The data-authority domain this workflow belongs to, when it is a governed domain. */
  dataDomain: dataDomain.nullable(),
  /** What happens when the vendor cannot provide the information or refuses the action. */
  whenUnavailable: z.string(),
  freshnessTargetSeconds: z.number().int().nullable(),
});
export type WorkflowCapabilityView = z.infer<typeof workflowCapability>;

export const credentialField = z.object({
  name: z.string(),
  label: z.string(),
  secret: z.boolean(),
  description: z.string(),
});

export const connectorSummary = z.object({
  key: z.string(),
  name: z.string(),
  category: connectorCategory,
  vendor: z.object({ name: z.string(), note: z.string().optional() }),
  products: z.array(z.object({ name: z.string(), versions: z.array(z.string()) })),
  regions: z.array(z.string()),
  accessModel,
  localConnectorRequired: z.boolean(),
  localConnectorNote: z.string().nullable(),
  credentialFields: z.array(credentialField),
  vendorSetupSteps: z.array(z.string()),
  workflows: z.array(workflowCapability),
  governableDomains: z.array(
    z.object({ domain: dataDomain, writeModes: z.array(z.enum(['read_only', 'forward'])) }),
  ),
  costNotes: z.array(z.string()),
  implementation: z.object({
    level: readinessLevel,
    label: z.string(),
    evidence: z.array(z.string()),
  }),
  externalApproval: z.object({
    status: z.enum(['not_required', 'not_started', 'applied', 'approved', 'unknown']),
    note: z.string(),
  }),
  /** How data from this connector is labeled (CLAUDE.md rule 16): external, simulated or file-based. */
  provenance: z.enum(['external', 'simulated', 'file']),
  isSimulator: z.boolean(),
  fileBased: z.boolean(),
  /** True when Portico has code for this connector; planned entries are listed honestly but cannot connect. */
  connectable: z.boolean(),
  /** How the connector is set up: a connection journey, webhook subscriptions, or not yet available. */
  setupPath: z.enum(['connection', 'webhook_subscriptions', 'not_available']),
  support: z.object({ vendor: z.string(), escalation: z.string() }),
  vendorNotices: z.array(
    z.object({ title: z.string(), requiredAction: z.string(), dueDate: z.string().nullable() }),
  ),
  disclaimer: z.string(),
});
export type ConnectorSummary = z.infer<typeof connectorSummary>;

export const catalogueQuery = z.object({
  category: connectorCategory.optional(),
  connectable: z.enum(['true', 'false']).optional(),
});

// ───────────────────────────── Universal record contract (docs/architecture/domain-map.md) ─────────────────────────────

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
const universalRecord = {
  status: z.record(z.string(), z.string()),
  allowedActions: z.array(recordAction),
  issues: z.array(recordIssue),
  owner: recordOwner.optional(),
  links: z.array(recordLink),
};

// ───────────────────────────── Connections ─────────────────────────────

export const connectionScope = z.object({
  workflows: z.array(
    z.object({ workflow: z.string().min(1), operations: z.array(workflowOperation).min(1) }),
  ),
  authority: z.array(z.object({ domain: dataDomain, writeMode: z.enum(['read_only', 'forward']) })),
});
export type ConnectionScope = z.infer<typeof connectionScope>;

export const setupStepView = z.object({
  step: z.number().int(),
  key: z.string(),
  title: z.string(),
  status: z.enum(['done', 'current', 'todo']),
  completedAt: z.string().nullable(),
  completedBy: z.string().nullable(),
});

export const connection = z.object({
  id: z.uuid(),
  connectorKey: z.string(),
  connectorName: z.string(),
  category: connectorCategory,
  name: z.string(),
  propertyIds: z.array(z.uuid()),
  state: connectionState,
  resumeState: z.enum(['active', 'monitoring']).nullable(),
  setup: z.object({ currentStep: z.number().int(), steps: z.array(setupStepView) }),
  scope: connectionScope,
  health: z.object({ status: healthStatus, reason: z.string().nullable(), changedAt: z.string().nullable() }),
  integrationStatus,
  /** How data exchanged by this connection is labeled: live, sandbox, simulated or file-based. */
  exchangeProvenance,
  fileBased: z.boolean(),
  interruptedSince: z.string().nullable(),
  activatedAt: z.string().nullable(),
  ownerUserId: z.uuid().nullable(),
  replacesConnectionId: z.uuid().nullable(),
  replacedByConnectionId: z.uuid().nullable(),
  /**
   * G-03: shown on trial connections whose credential could write at the vendor (or the vendor does not say):
   * "This credential would allow changes in <system>. Portico blocks all writes from trials."
   */
  trialWriteGuard: z.string().nullable(),
  lastError: z.record(z.string(), z.unknown()).nullable(),
  createdAt: z.string(),
  version: z.number().int(),
  ...universalRecord,
});
export type Connection = z.infer<typeof connection>;

export const createConnectionInput = z.object({
  connectorKey: z.string().min(1),
  name: z.string().min(1).max(120),
  propertyIds: z.array(z.uuid()).max(500),
  ownerUserId: z.uuid().optional(),
});
export type CreateConnectionInput = z.infer<typeof createConnectionInput>;

export const listConnectionsQuery = z.object({ propertyId: z.uuid().optional() });

export const compatibilityReport = z.object({
  connectorKey: z.string(),
  supportedWorkflows: z.array(workflowCapability),
  selected: connectionScope,
  checks: z.array(
    z.object({
      code: z.string(),
      outcome: z.enum(['ok', 'warning', 'blocking']),
      message: z.string(),
      responsibleParty: responsibleParty.nullable(),
    }),
  ),
  prerequisites: z.array(z.string()),
  vendorSetupSteps: z.array(z.string()),
  costNotes: z.array(z.string()),
  localConnectorRequired: z.boolean(),
  environmentNote: z.string(),
});
export type CompatibilityReport = z.infer<typeof compatibilityReport>;

export const reviewCompatibilityInput = z.object({
  scope: connectionScope,
  acknowledged: z.literal(true),
});

export const authorizeInput = z.object({
  credentials: z.record(z.string(), z.unknown()),
  label: z.string().min(1).max(120).default('Primary credential'),
  expiresAt: z.iso.datetime().optional(),
});

// ───────────────────────────── Mappings ─────────────────────────────

export const mappingReason = z.object({ code: z.string(), message: z.string() });
export const mapping = z.object({
  id: z.uuid(),
  connectionId: z.uuid(),
  kind: mappingKind,
  externalId: z.string(),
  externalLabel: z.string(),
  externalAttributes: z.record(z.string(), z.unknown()),
  propertyId: z.uuid().nullable(),
  internalId: z.string().nullable(),
  internalLabel: z.string().nullable(),
  // status (universal record): { mapping: suggested|confirmed|unmapped|ignored, review: required|reviewed|not_required }
  confidence: z.number().nullable(),
  reasons: z.array(mappingReason),
  alternatives: z.array(z.object({ internalId: z.string(), label: z.string(), confidence: z.number() })),
  financiallySignificant: z.boolean(),
  requiresReview: z.boolean(),
  reviewReason: z.string().nullable(),
  reviewed: z.boolean(),
  reviewedBy: z.string().nullable(),
  reviewedAt: z.string().nullable(),
  autoConfirmed: z.boolean(),
  version: z.number().int(),
  ...universalRecord,
});
export type Mapping = z.infer<typeof mapping>;

export const mappingIssue = z.object({
  code: z.string(),
  severity: z.enum(['blocking', 'warning']),
  kind: mappingKind.nullable(),
  message: z.string(),
  mappingId: z.uuid().nullable(),
});
export type MappingIssue = z.infer<typeof mappingIssue>;

export const mappingSet = z.object({
  items: z.array(mapping),
  issues: z.array(mappingIssue),
  summary: z.object({
    total: z.number().int(),
    confirmed: z.number().int(),
    awaitingReview: z.number().int(),
    unmapped: z.number().int(),
    ignored: z.number().int(),
    autoConfirmed: z.number().int(),
    /** Share of reviewed suggestions accepted unchanged (INT-R14, adoption metric M-04). Null until reviewed. */
    suggestionAccuracy: z.number().nullable(),
  }),
});
export type MappingSet = z.infer<typeof mappingSet>;

export const reviewMappingInput = z.object({
  decision: z.enum(['confirm', 'override', 'ignore', 'reset']),
  internalId: z.string().min(1).max(200).optional(),
  internalLabel: z.string().max(300).optional(),
  reason: z.string().max(500).optional(),
});
export type ReviewMappingInput = z.infer<typeof reviewMappingInput>;

export const mappingHistoryEntry = z.object({
  version: z.number().int(),
  internalId: z.string().nullable(),
  status: z.string(),
  reviewed: z.boolean(),
  confidence: z.number().nullable(),
  change: z.string(),
  reason: z.string().nullable(),
  actor: z.string(),
  changedAt: z.string(),
});

// ───────────────────────────── Validation, preview, activation ─────────────────────────────

export const validationCheck = z.object({
  code: z.string(),
  outcome: z.enum(['passed', 'failed', 'warning']),
  message: z.string(),
  workflow: z.string().nullable(),
  responsibleParty: responsibleParty.nullable(),
  nextStep: z.string().nullable(),
});
export const validationRun = z.object({
  id: z.uuid(),
  connectionId: z.uuid(),
  status: z.enum(['passed', 'failed']),
  checks: z.array(validationCheck),
  provenance: exchangeProvenance,
  startedAt: z.string(),
  finishedAt: z.string(),
});
export type ValidationRun = z.infer<typeof validationRun>;

export const hotelFunctionImpact = z.object({
  workflow: z.string(),
  hotelFunction: z.string(),
  effect: z.string(),
});
export type HotelFunctionImpact = z.infer<typeof hotelFunctionImpact>;

export const impactStatement = z.object({
  summary: z.string(),
  properties: z.array(z.object({ id: z.uuid(), name: z.string() })),
  hotelFunctions: z.array(hotelFunctionImpact),
});
export type ImpactStatement = z.infer<typeof impactStatement>;

export const authorityChange = z.object({
  propertyId: z.uuid(),
  propertyName: z.string(),
  domain: dataDomain,
  before: z.object({ authority: z.string(), writeMode: z.string(), systemName: z.string().nullable() }),
  after: z.object({ authority: z.string(), writeMode: z.string(), systemName: z.string().nullable() }),
  explanation: z.string(),
});
export type AuthorityChange = z.infer<typeof authorityChange>;

export const expectedBehavior = z.object({
  workflow: z.string(),
  externalId: z.string(),
  description: z.string(),
  outcome: z.enum(['would_apply', 'would_hold', 'would_skip']),
  reason: z.string().nullable(),
});

export const activationPreview = z.object({
  id: z.uuid(),
  connectionId: z.uuid(),
  hash: z.string(),
  provenance: exchangeProvenance,
  scopeSummary: z.string(),
  workflows: z.array(
    z.object({ workflow: z.string(), operations: z.array(workflowOperation), sync: syncMode }),
  ),
  authorityChanges: z.array(authorityChange),
  expectedBehavior: z.array(expectedBehavior),
  impact: impactStatement,
  warnings: z.array(z.string()),
  createdAt: z.string(),
});
export type ActivationPreview = z.infer<typeof activationPreview>;

export const activateInput = z.object({ previewId: z.uuid(), previewHash: z.string().min(1) });

export const lifecycleAction = z.enum(['pause', 'resume', 'disconnect', 'rotate', 'replace']);
export type LifecycleAction = z.infer<typeof lifecycleAction>;

export const lifecyclePreview = z.object({
  id: z.uuid(),
  connectionId: z.uuid(),
  action: lifecycleAction,
  hash: z.string(),
  impact: impactStatement,
  authorityChanges: z.array(authorityChange),
  backlog: z.object({
    queued: z.number().int(),
    pendingVerification: z.number().int(),
    needsRevalidation: z.number().int(),
    moneyOrInventory: z.number().int(),
  }),
  warnings: z.array(z.string()),
  /** Reasons the action cannot be taken now (e.g. disconnect while the connection is a system of record). */
  blockers: z.array(z.string()),
  createdAt: z.string(),
});
export type LifecyclePreview = z.infer<typeof lifecyclePreview>;

export const lifecyclePreviewQuery = z.object({
  action: lifecycleAction,
  replacementConnectionId: z.uuid().optional(),
});

export const pauseInput = z.object({
  reason: z.string().min(1).max(500),
  previewHash: z.string().optional(),
});
export const resumeInput = z.object({
  reason: z.string().max(500).optional(),
  previewHash: z.string().optional(),
});
export const disconnectInput = z.object({
  reason: z.string().min(1).max(500),
  previewHash: z.string().min(1),
});
export const rotateCredentialInput = z.object({
  credentials: z.record(z.string(), z.unknown()),
  label: z.string().min(1).max(120).default('Rotated credential'),
  expiresAt: z.iso.datetime().optional(),
  reason: z.string().max(500).optional(),
});
export const replaceInput = z.object({
  replacementConnectionId: z.uuid(),
  reason: z.string().min(1).max(500),
  previewHash: z.string().min(1),
});

export const credentialView = z.object({
  id: z.uuid(),
  label: z.string(),
  status: z.enum(['active', 'superseded', 'revoked']),
  accountLabel: z.string().nullable(),
  scopesGranted: z.array(z.string()).nullable(),
  readOnlyAtVendor: z.boolean().nullable(),
  expiresAt: z.string().nullable(),
  verifiedAt: z.string().nullable(),
  createdAt: z.string(),
  createdBy: z.string(),
  storeKind: z.string(),
});
export type CredentialView = z.infer<typeof credentialView>;

// ───────────────────────────── Health, exceptions, exchange ─────────────────────────────

export const healthSignal = z.object({
  code: z.string(),
  severity,
  title: z.string(),
  detail: z.string(),
  workflow: z.string().nullable(),
  responsibleParty,
  nextStep: z.string(),
});
export type HealthSignal = z.infer<typeof healthSignal>;

/** Per-workflow health (connection lifecycle spec §6.3; INT-R21). */
export const workflowHealthStatus = z.enum([
  'healthy',
  'delayed',
  'degraded',
  'failing',
  'paused',
  'unknown',
]);
export type WorkflowHealthStatus = z.infer<typeof workflowHealthStatus>;

/** Kernel provenance values used to label data from this workflow on every screen (CLAUDE.md rule 16, G-05). */
export const dataProvenance = z.enum(['external', 'simulated', 'delayed', 'incomplete']);

export const workflowHealth = z.object({
  workflow: z.string(),
  label: z.string(),
  status: workflowHealthStatus,
  sync: syncMode,
  /** How staff see the exchange: "Live connection", "Updated every N minutes", "File exchange — not a live connection". */
  exchangeLabel: z.string(),
  lastSuccessAt: z.string().nullable(),
  /** Age of the information Portico holds from this workflow (seconds since the last successful exchange). */
  ageSeconds: z.number().int().nullable(),
  freshnessTargetSeconds: z.number().int().nullable(),
  dataProvenance,
  incompleteSince: z.string().nullable(),
  incompleteReason: z.string().nullable(),
  lastMessageLatencySeconds: z.number().int().nullable(),
  consecutiveFailures: z.number().int(),
  feedsSystemOfRecord: z.boolean(),
});
export type WorkflowHealth = z.infer<typeof workflowHealth>;

export const connectionHealth = z.object({
  connectionId: z.uuid(),
  connectionName: z.string(),
  connectorName: z.string(),
  state: connectionState,
  overall: healthStatus,
  worstWorkflowStatus: workflowHealthStatus,
  credentialStatus: z.enum(['ok', 'expiring', 'invalid', 'not_required']),
  exchangeProvenance,
  urgent: z.array(healthSignal),
  routine: z.array(healthSignal),
  workflows: z.array(workflowHealth),
  credential: z.object({
    expiresAt: z.string().nullable(),
    daysToExpiry: z.number().int().nullable(),
  }),
  mappingProblems: z.object({
    awaitingReview: z.number().int(),
    unmapped: z.number().int(),
    heldMessages: z.number().int(),
  }),
  outbound: z.object({
    queued: z.number().int(),
    pendingVerification: z.number().int(),
    needsRevalidation: z.number().int(),
  }),
  openExceptions: z.object({ urgent: z.number().int(), routine: z.number().int() }),
  vendorNotices: z.array(
    z.object({ id: z.uuid(), title: z.string(), requiredAction: z.string(), dueDate: z.string().nullable() }),
  ),
  impact: impactStatement.nullable(),
  usage: z.object({ exchangesLast24h: z.number().int(), costNotes: z.array(z.string()) }),
  support: z.object({ vendor: z.string(), escalation: z.string(), ownerUserId: z.uuid().nullable() }),
  recoveryActions: z.array(z.string()),
  checkedAt: z.string(),
});
export type ConnectionHealth = z.infer<typeof connectionHealth>;

export const portfolioHealth = z.object({
  totals: z.object({
    connections: z.number().int(),
    healthy: z.number().int(),
    degraded: z.number().int(),
    down: z.number().int(),
    paused: z.number().int(),
    notMonitored: z.number().int(),
  }),
  urgent: z.array(healthSignal.extend({ connectionId: z.uuid(), connectionName: z.string() })),
  connections: z.array(
    z.object({
      connectionId: z.uuid(),
      name: z.string(),
      connectorName: z.string(),
      propertyIds: z.array(z.uuid()),
      overall: healthStatus,
      urgentCount: z.number().int(),
      routineCount: z.number().int(),
    }),
  ),
  checkedAt: z.string(),
});
export type PortfolioHealth = z.infer<typeof portfolioHealth>;

export const healthQuery = z.object({ propertyId: z.uuid().optional() });

export const entityRef = z.object({ type: z.string(), id: z.string() });

export const integrationException = z.object({
  id: z.uuid(),
  connectionId: z.uuid(),
  propertyId: z.uuid().nullable(),
  workflow: z.string().nullable(),
  severity,
  code: z.string(),
  problem: z.string(),
  businessImpact: z.string(),
  responsibleParty,
  nextStep: z.string(),
  relatedRefs: z.array(entityRef),
  ownerUserId: z.uuid().nullable(),
  ownerDepartmentId: z.uuid().nullable(),
  // status (universal record): { exception: open|acknowledged|resolved|ignored, severity, responsibleParty }
  resolution: z.string().nullable(),
  resolvedBy: z.string().nullable(),
  resolvedAt: z.string().nullable(),
  occurrences: z.number().int(),
  firstSeenAt: z.string(),
  lastSeenAt: z.string(),
  /** Only present for callers holding integration.technical.read. */
  technicalDetail: z.record(z.string(), z.unknown()).nullable().optional(),
  version: z.number().int(),
  ...universalRecord,
});
export type IntegrationException = z.infer<typeof integrationException>;

export const exceptionsQuery = z.object({
  connectionId: z.uuid().optional(),
  propertyId: z.uuid().optional(),
  status: z.enum(['open', 'acknowledged', 'resolved', 'ignored', 'unresolved']).default('unresolved'),
  severity: severity.optional(),
});
export const resolveExceptionInput = z.object({ resolution: z.string().min(1).max(1000) });
export const ignoreExceptionInput = z.object({ reason: z.string().min(1).max(1000) });
export const assignExceptionInput = z.object({
  ownerUserId: z.uuid().nullable().optional(),
  ownerDepartmentId: z.uuid().nullable().optional(),
});

export const exchangeEntry = z.object({
  id: z.uuid(),
  connectionId: z.uuid(),
  propertyId: z.uuid().nullable(),
  workflow: z.string(),
  direction: z.enum(['inbound', 'outbound']),
  operation: z.string().nullable(),
  externalRef: z.string().nullable(),
  idempotencyKey: z.string().nullable(),
  outcome: z.string(),
  latencyMs: z.number().int().nullable(),
  summary: z.string(),
  provenance: exchangeProvenance,
  occurredAt: z.string(),
  detail: z.record(z.string(), z.unknown()).nullable().optional(),
});
export type ExchangeEntry = z.infer<typeof exchangeEntry>;

export const exchangeQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  workflow: z.string().optional(),
});

export const syncRun = z.object({
  id: z.uuid(),
  connectionId: z.uuid(),
  workflow: z.string().nullable(),
  trigger: z.enum(['periodic', 'manual', 'file', 'reconciliation']),
  status: z.enum(['running', 'succeeded', 'partial', 'failed']),
  counts: z.object({
    received: z.number().int(),
    applied: z.number().int(),
    duplicates: z.number().int(),
    stale: z.number().int(),
    held: z.number().int(),
    rejected: z.number().int(),
    sent: z.number().int(),
    exported: z.number().int(),
  }),
  provenance: exchangeProvenance,
  fileId: z.uuid().nullable(),
  error: z.record(z.string(), z.unknown()).nullable(),
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
});
export type SyncRun = z.infer<typeof syncRun>;

export const manualSyncInput = z.object({
  workflow: z.string().optional(),
  /** `reconciliation` re-reads recent records to recover missed updates and clears the `incomplete` label. */
  kind: z.enum(['manual', 'reconciliation']).default('manual'),
});
export const fileImportInput = z.object({
  workflow: z.string().min(1),
  fileName: z.string().min(1).max(200),
  content: z.string().min(1).max(5_000_000),
});
export const fileExportInput = z.object({ workflow: z.string().min(1) });
export const exportedFile = z.object({
  fileId: z.uuid(),
  name: z.string(),
  contentType: z.string(),
  content: z.string(),
  rows: z.number().int(),
  syncRunId: z.uuid(),
  notice: z.string(),
});

export const outboundCommand = z.object({
  id: z.uuid(),
  connectionId: z.uuid(),
  propertyId: z.uuid().nullable(),
  workflow: z.string(),
  operation: z.string(),
  idempotencyKey: z.string(),
  effectClass,
  status: z.enum([
    'queued',
    'sending',
    'acknowledged',
    'rejected',
    'pending_verification',
    'needs_revalidation',
    'cancelled',
    'superseded',
    'exported',
  ]),
  businessKey: z.string().nullable(),
  attempts: z.number().int(),
  externalRef: z.string().nullable(),
  sourceRef: entityRef.nullable(),
  revalidationReason: z.string().nullable(),
  lastError: z.record(z.string(), z.unknown()).nullable(),
  enqueuedAt: z.string(),
  completedAt: z.string().nullable(),
  version: z.number().int(),
});
export type OutboundCommand = z.infer<typeof outboundCommand>;

export const outboundQuery = z.object({
  status: outboundCommand.shape.status.optional(),
});
export const revalidateInput = z.object({
  decision: z.enum(['resend', 'cancel']),
  reason: z.string().min(1).max(500),
});

export const vendorNoticeInput = z.object({
  title: z.string().min(1).max(200),
  requiredAction: z.string().min(1).max(1000),
  responsibleParty,
  dueDate: z.iso.date().optional(),
});

// ───────────────────────────── Webhooks ─────────────────────────────

export const webhookSubscriptionInput = z.object({
  name: z.string().min(1).max(120),
  url: z.url().refine((u) => u.startsWith('https://'), 'Webhook endpoints must use https://'),
  eventTypes: z.array(z.string().min(1).max(120)).min(1).max(50),
  propertyIds: z.array(z.uuid()).max(500).default([]),
  apiClientId: z.uuid().optional(),
});
export type WebhookSubscriptionInput = z.infer<typeof webhookSubscriptionInput>;

export const webhookSubscription = z.object({
  id: z.uuid(),
  name: z.string(),
  url: z.string(),
  eventTypes: z.array(z.string()),
  propertyIds: z.array(z.uuid()),
  apiClientId: z.uuid().nullable(),
  status: z.enum(['active', 'disabled']),
  disabledReason: z.string().nullable(),
  disabledAt: z.string().nullable(),
  consecutiveFailures: z.number().int(),
  lastSuccessAt: z.string().nullable(),
  createdAt: z.string(),
  version: z.number().int(),
});
export type WebhookSubscription = z.infer<typeof webhookSubscription>;

export const webhookSubscriptionCreated = webhookSubscription.extend({
  /** Shown once. Store it to verify the Portico-Signature header; Portico cannot show it again. */
  signingSecret: z.string(),
});

export const webhookSubscriptionUpdate = z.object({
  status: z.enum(['active', 'disabled']).optional(),
  eventTypes: z.array(z.string().min(1).max(120)).min(1).max(50).optional(),
  url: z
    .url()
    .refine((u) => u.startsWith('https://'), 'Webhook endpoints must use https://')
    .optional(),
});

export const webhookDelivery = z.object({
  id: z.uuid(),
  subscriptionId: z.uuid(),
  eventId: z.uuid(),
  eventType: z.string(),
  propertyId: z.uuid().nullable(),
  status: z.enum(['pending', 'succeeded', 'failed', 'dead', 'blocked', 'simulated', 'cancelled']),
  attempts: z.number().int(),
  nextAttemptAt: z.string().nullable(),
  lastAttemptAt: z.string().nullable(),
  lastResponseStatus: z.number().int().nullable(),
  lastError: z.string().nullable(),
  replayOf: z.uuid().nullable(),
  createdAt: z.string(),
  completedAt: z.string().nullable(),
});
export type WebhookDelivery = z.infer<typeof webhookDelivery>;
export const replayDeliveryInput = z.object({ reason: z.string().min(1).max(500) });
export const replayRangeInput = z.object({
  from: z.iso.datetime(),
  to: z.iso.datetime(),
  reason: z.string().min(1).max(500),
});
export const rotateSigningSecretInput = z.object({
  /** Hours the previous secret keeps signing alongside the new one (0 = stop immediately). */
  overlapHours: z.number().int().min(0).max(168).default(24),
});
export const rotatedSigningSecret = z.object({
  signingSecret: z.string(),
  previousValidUntil: z.string().nullable(),
});

// ───────────────────────────── Simulator control (pms.simulator) ─────────────────────────────

export const simulatorFaults = z.object({
  outage: z.boolean().optional(),
  credentialExpired: z.boolean().optional(),
  delaySeconds: z.number().int().min(0).max(86_400).optional(),
  duplicateNext: z.number().int().min(0).max(100).optional(),
  reorderNext: z.boolean().optional(),
  timeoutNextCommand: z.boolean().optional(),
  rejectNextCommand: z.boolean().optional(),
});
export type SimulatorFaults = z.infer<typeof simulatorFaults>;

export const simulatorAccountCreated = z.object({
  accountId: z.string(),
  apiKey: z.string(),
  notice: z.string(),
});

export const simulatorEventInput = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('reservation'),
    reservationId: z.string().min(1).max(60).optional(),
    action: z.enum(['create', 'modify', 'cancel']),
    roomTypeCode: z.string().optional(),
    arrival: z.iso.date().optional(),
    departure: z.iso.date().optional(),
  }),
  z.object({ type: z.literal('roomStatus'), roomNumber: z.string(), statusCode: z.string() }),
  z.object({
    type: z.literal('charge'),
    reservationId: z.string(),
    chargeCode: z.string(),
    amountMinor: z.number().int(),
    currency: z.string().regex(/^[A-Z]{3}$/),
  }),
]);
export type SimulatorEventInput = z.infer<typeof simulatorEventInput>;
