/**
 * Public API contracts (Zod). No server imports: web apps import this file.
 * Vocabularies shared with the kernel are typed against it (`satisfies readonly Provenance[]`); vocabularies the
 * integration module owns (severity, responsible party) are equal copies checked by test/compat (FOUNDATION_REQUESTS
 * FR-1 asks for them in the kernel — modules may not import each other).
 */
import type { Provenance } from '@portico/kernel';
import { z } from 'zod';

const uuid = z.uuid();
const localDate = z.iso.date();
const isoTs = z.string();

// ───────────────────────────── vocabularies ─────────────────────────────

/** Provenance of channel data in distribution (subset of the kernel vocabulary). */
export const DISTRIBUTION_PROVENANCE = [
  'live',
  'sandbox',
  'simulated',
] as const satisfies readonly Provenance[];
export const exchangeProvenance = z.enum(DISTRIBUTION_PROVENANCE);
export const severity = z.enum(['urgent', 'routine']);
export const responsibleParty = z.enum(['hotel', 'monoclay', 'vendor']);
export const ariKind = z.enum(['availability', 'restrictions']);
export const connectionStatus = z.enum(['setup', 'active', 'paused', 'disconnected']);
export const connectionHealth = z.enum([
  'connected',
  'degraded',
  'failing',
  'credentials_invalid',
  'paused',
  'blocked',
  'not_active',
]);
export const hubTarget = z.enum(['simulator', 'staging', 'production']);
export const revisionState = z.enum([
  'received',
  'applied',
  'duplicate',
  'stale',
  'parked',
  'rejected',
  'failed',
]);
export const ackState = z.enum(['not_due', 'pending', 'sending', 'acked', 'failed']);
export const messageStatus = z.enum([
  'queued',
  'sending',
  'accepted',
  'partially_accepted',
  'rejected',
  'failed_transient',
  'superseded',
]);
export const discrepancyKind = z.enum([
  'availability',
  'rate',
  'reservation',
  'mapping',
  'field_loss',
  'price',
]);
export const discrepancyStatus = z.enum(['open', 'investigating', 'resolved', 'accepted']);
export const cellSyncState = z.enum(['in_sync', 'pending', 'never_sent', 'differs', 'not_accepted']);

// ───────────────────────────── universal record contract ─────────────────────────────

export const recordAction = z.object({
  action: z.string(),
  label: z.string(),
  enabled: z.boolean(),
  reason: z.string().optional(),
  previewRequired: z.boolean().optional(),
});
export const recordIssue = z.object({
  code: z.string(),
  severity: z.enum(['blocking', 'warning', 'info']),
  message: z.string(),
  since: z.string().optional(),
});
export const recordLink = z.object({
  rel: z.string(),
  type: z.string(),
  id: z.string(),
  title: z.string().optional(),
});
export const recordOwner = z.object({
  kind: z.enum(['user', 'department']),
  id: z.string(),
  name: z.string().optional(),
});

// ───────────────────────────── settings and inputs ─────────────────────────────

export const connectionSettings = z
  .object({
    /** Requests per minute per kind. Defaults follow the Channex limit (10 + 10 = the owner's 20 ARI/minute). */
    availabilityPerMinute: z.number().int().min(1).max(100).default(10),
    restrictionsPerMinute: z.number().int().min(1).max(100).default(10),
    /** Nights published ahead of the business date (DST-R05: 400). */
    horizonDays: z.number().int().min(30).max(730).default(400),
    /** A change the channel has not confirmed within this time makes the connection degraded. */
    freshnessTargetSeconds: z.number().int().min(30).max(3600).default(120),
    maxCellsPerMessage: z.number().int().min(50).max(5000).default(2000),
    stopSellProtection: z
      .object({
        enabled: z.boolean().default(true),
        /** Close a unit type on this channel while the connection is degraded and at most this many are sellable. */
        threshold: z.number().int().min(1).max(50).default(2),
        /** Healthy time required before protection is released automatically. */
        cooldownMinutes: z.number().int().min(1).max(240).default(10),
      })
      .default({ enabled: true, threshold: 2, cooldownMinutes: 10 }),
    /** Whether the channel's nightly amounts include taxes (per channel; EC-DST-016 needs per-OTA detail). */
    amountsIncludeTax: z.boolean().default(false),
    /** Rate plan for a mapped room whose channel rate plan is not mapped (EC-DST-005); null parks the booking. */
    fallbackRatePlanId: uuid.nullable().default(null),
    /** Safety-net pull of revisions the hub still holds as unacknowledged. */
    feedPullMinutes: z.number().int().min(1).max(1440).default(15),
    /** Full non-destructive resync interval (nightly by default). */
    fullResyncHours: z.number().int().min(1).max(168).default(24),
  })
  .strict();
export type ConnectionSettings = z.output<typeof connectionSettings>;
export const DEFAULT_SETTINGS: ConnectionSettings = connectionSettings.parse({});

export const createConnectionInput = z
  .object({
    propertyId: uuid,
    name: z.string().min(1).max(120),
    hub: z.literal('channex').default('channex'),
    /** The hub's property id. Omit in demo/trial/training/sandbox simulator organizations to create a simulated one. */
    externalPropertyId: z.string().min(1).max(100).optional(),
    /** The hub API key (stored encrypted; never returned). Omit to use the simulator's. */
    apiKey: z.string().min(8).max(500).optional(),
    channelCode: z.string().min(1).max(100).default('ota'),
    settings: connectionSettings.partial().optional(),
    /** Simulator only: the hub-side room types and rate plans to create. */
    simulator: z
      .object({
        roomTypes: z.array(z.string().min(1).max(100)).min(1).max(100),
        ratePlans: z
          .array(
            z.object({
              id: z.string().min(1).max(100),
              roomTypeId: z.string().min(1).max(100),
              minRate: z
                .string()
                .regex(/^\d+(\.\d{1,2})?$/)
                .nullable()
                .optional(),
            }),
          )
          .max(500),
      })
      .optional(),
  })
  .strict();
export type CreateConnectionInput = z.input<typeof createConnectionInput>;

export const updateSettingsInput = connectionSettings.partial().strict();

export const roomMappingInput = z
  .object({ unitTypeId: uuid, channelRoomTypeId: z.string().min(1).max(100) })
  .strict();
export const rateMappingInput = z
  .object({ unitTypeId: uuid, ratePlanId: uuid, channelRatePlanId: z.string().min(1).max(100) })
  .strict();

export const resyncInput = z
  .object({
    from: localDate.optional(),
    to: localDate.optional(),
    kinds: z.array(ariKind).min(1).max(2).optional(),
  })
  .strict();
export const pullBookingsInput = z.object({ since: z.iso.datetime({ offset: true }).optional() }).strict();
export const stopSellInput = z
  .object({
    unitTypeId: uuid.nullable().default(null),
    from: localDate,
    to: localDate,
    reason: z.string().min(3).max(500),
  })
  .strict();
export const releaseInput = z.object({ reason: z.string().min(3).max(500) }).strict();
export const resolveRevisionInput = z
  .object({
    action: z.enum(['retry', 'apply_as_new', 'dismiss']),
    reason: z.string().min(3).max(500),
  })
  .strict();
export const resolveInput = z.object({ resolution: z.string().min(3).max(1000) }).strict();
export const resolveDiscrepancyInput = z
  .object({
    status: z.enum(['investigating', 'resolved', 'accepted']),
    resolution: z.string().min(3).max(1000),
  })
  .strict();
export const calendarQuery = z.object({
  from: localDate,
  to: localDate,
  kind: ariKind.optional(),
  unitTypeId: uuid.optional(),
});

export const simulatorBookingInput = z
  .object({
    bookingId: z.string().min(1).max(100).optional(),
    status: z.enum(['new', 'modified', 'cancelled']).default('new'),
    otaName: z.string().max(100).optional(),
    notes: z.string().max(1000).nullable().optional(),
    paymentCollect: z.enum(['property', 'ota']).optional(),
    rooms: z
      .array(
        z.object({
          roomTypeId: z.string().nullable(),
          ratePlanId: z.string().nullable(),
          checkin: localDate,
          checkout: localDate,
          adults: z.number().int().min(1).max(20),
          childrenAges: z.array(z.number().int().min(0).max(17)).optional(),
          nightly: z.record(localDate, z.string().regex(/^\d+(\.\d{1,2})?$/)),
        }),
      )
      .min(1)
      .max(10),
    deliver: z
      .object({
        webhook: z.boolean().default(true),
        duplicate: z.number().int().min(0).max(5).default(0),
        notificationOnly: z.boolean().default(false),
      })
      .default({ webhook: true, duplicate: 0, notificationOnly: false }),
  })
  .strict();
export const simulatorFaultInput = z
  .object({
    endpoint: z.enum([
      'any',
      'availability',
      'restrictions',
      'feed',
      'revision',
      'ack',
      'property',
      'webhooks',
      'bookings',
    ]),
    kind: z.enum([
      'rate_limit',
      'server_error',
      'timeout',
      'timeout_after_apply',
      'partial_acceptance',
      'unauthorized',
      'bad_request',
    ]),
    times: z.number().int().min(1).max(100),
  })
  .strict();
export const simulatorOutageInput = z
  .object({
    minutes: z
      .number()
      .int()
      .min(0)
      .max(24 * 60),
  })
  .strict();

// ───────────────────────────── views ─────────────────────────────

export const connectionView = z.object({
  id: uuid,
  propertyId: uuid,
  hub: z.literal('channex'),
  name: z.string(),
  target: hubTarget,
  externalPropertyId: z.string(),
  channelCode: z.string(),
  provenance: exchangeProvenance,
  status: z.record(z.string(), z.string()),
  webhook: z.object({
    url: z.string(),
    verifier: z.enum(['header_secret', 'hmac_sha256']),
    header: z.string(),
  }),
  settings: z.unknown(),
  lastPushAt: isoTs.nullable(),
  lastRevisionAt: isoTs.nullable(),
  lastFullSyncAt: isoTs.nullable(),
  nextFullSyncAt: isoTs.nullable(),
  activatedAt: isoTs.nullable(),
  allowedActions: z.array(recordAction),
  issues: z.array(recordIssue),
  owner: recordOwner.optional(),
  links: z.array(recordLink),
  version: z.number().int(),
});
export type ConnectionView = z.infer<typeof connectionView>;

export const createdConnection = z.object({
  connection: connectionView,
  /** Shown ONCE: configure it as the webhook header value at the hub. Never stored in clear, never replayed. */
  webhookToken: z.string().nullable(),
});

export const healthView = z.object({
  connectionId: uuid,
  propertyId: uuid,
  health: connectionHealth,
  reason: z.string(),
  staleSince: isoTs.nullable(),
  provenance: exchangeProvenance,
  lastSuccessfulPushAt: isoTs.nullable(),
  lastReservationReceivedAt: isoTs.nullable(),
  oldestUnconfirmedChangeAt: isoTs.nullable(),
  oldestUnacknowledgedRevisionAt: isoTs.nullable(),
  queue: z.object({
    dirtyProducts: z.number().int(),
    dirtyNights: z.number().int(),
    mergedDeltas: z.number().int(),
    openMessages: z.array(
      z.object({
        id: uuid,
        kind: ariKind,
        status: messageStatus,
        attempts: z.number().int(),
        nextAttemptAt: isoTs.nullable(),
        cells: z.number().int(),
      }),
    ),
  }),
  budget: z.record(
    z.string(),
    z.object({ used: z.number().int(), limit: z.number().int(), pausedUntil: isoTs.nullable() }),
  ),
  errors24h: z.object({ calls: z.number().int(), failures: z.number().int() }),
  mapping: z.object({ mapped: z.number().int(), total: z.number().int(), complete: z.boolean() }),
  revisions: z.object({ parked: z.number().int(), failed: z.number().int(), awaitingAck: z.number().int() }),
  openExceptions: z.number().int(),
  openDiscrepancies: z.number().int(),
  protection: z.object({ id: uuid, since: isoTs, threshold: z.number().int().nullable() }).nullable(),
  banner: z
    .object({
      severity: z.enum(['urgent', 'warning']),
      message: z.string(),
      staleSince: isoTs.nullable(),
      nextStep: z.string(),
    })
    .nullable(),
});
export type HealthView = z.infer<typeof healthView>;

export const calendarCell = z.object({
  kind: ariKind,
  unitTypeId: uuid,
  ratePlanId: uuid.nullable(),
  date: localDate,
  expected: z.unknown().nullable(),
  acked: z.unknown().nullable(),
  ackedAt: isoTs.nullable(),
  state: cellSyncState,
  reason: z.string().nullable(),
});
export type CalendarCell = z.infer<typeof calendarCell>;

export const completenessView = z.object({
  connectionId: uuid,
  mapped: z.number().int(),
  total: z.number().int(),
  complete: z.boolean(),
  /** "9 of 10 sellable products mapped". */
  summary: z.string(),
  unmapped: z.array(
    z.object({
      unitTypeId: uuid,
      ratePlanId: uuid.nullable(),
      label: z.string(),
      missing: z.enum(['room', 'rate']),
    }),
  ),
  invalid: z.array(z.object({ mappingId: uuid, problem: z.string() })),
});
export type CompletenessView = z.infer<typeof completenessView>;

export const mappingView = z.object({
  id: uuid,
  kind: z.enum(['room', 'rate']),
  connectionId: uuid,
  unitTypeId: uuid,
  ratePlanId: uuid.nullable(),
  channelCode: z.string(),
  status: z.record(z.string(), z.string()),
  version: z.number().int(),
});

export const messageView = z.object({
  id: uuid,
  connectionId: uuid,
  kind: ariKind,
  trigger: z.enum(['delta', 'resync', 'protection']),
  status: z.record(z.string(), z.string()),
  cellCount: z.number().int(),
  valueCount: z.number().int(),
  coalescedDeltas: z.number().int(),
  attempts: z.number().int(),
  nextAttemptAt: isoTs.nullable(),
  sentAt: isoTs.nullable(),
  acceptedAt: isoTs.nullable(),
  lastError: z.string().nullable(),
  provenance: exchangeProvenance,
  createdAt: isoTs,
});

export const revisionView = z.object({
  id: uuid,
  connectionId: uuid,
  propertyId: uuid,
  channelBookingId: z.string(),
  revisionId: z.string(),
  channelStatus: z.enum(['new', 'modified', 'cancelled']),
  receivedVia: z.enum(['webhook', 'feed', 'recovery']),
  receivedAt: isoTs,
  status: z.record(z.string(), z.string()),
  parkReason: z.enum(['orphan', 'unmapped']).nullable(),
  outcome: z.string().nullable(),
  bookingId: uuid.nullable(),
  note: z.string().nullable(),
  attempts: z.number().int(),
  nextAttemptAt: isoTs.nullable(),
  lastError: z.string().nullable(),
  ackedAt: isoTs.nullable(),
  otaName: z.string().nullable(),
  otaReservationCode: z.string().nullable(),
  arrival: localDate.nullable(),
  departure: localDate.nullable(),
  provenance: exchangeProvenance,
  allowedActions: z.array(recordAction),
  issues: z.array(recordIssue),
  links: z.array(recordLink),
  version: z.number().int(),
});
export type RevisionView = z.infer<typeof revisionView>;

export const exceptionView = z.object({
  id: uuid,
  connectionId: uuid,
  propertyId: uuid,
  code: z.string(),
  severity,
  problem: z.string(),
  businessImpact: z.string(),
  responsibleParty,
  nextStep: z.string(),
  status: z.record(z.string(), z.string()),
  occurrences: z.number().int(),
  firstSeenAt: isoTs,
  lastSeenAt: isoTs,
  resolution: z.string().nullable(),
  allowedActions: z.array(recordAction),
  links: z.array(recordLink),
  version: z.number().int(),
});
export type ExceptionView = z.infer<typeof exceptionView>;

export const discrepancyView = z.object({
  id: uuid,
  connectionId: uuid,
  propertyId: uuid,
  kind: discrepancyKind,
  summary: z.string(),
  detail: z.unknown(),
  status: z.record(z.string(), z.string()),
  detectedAt: isoTs,
  resolution: z.string().nullable(),
  allowedActions: z.array(recordAction),
  links: z.array(recordLink),
  version: z.number().int(),
});

export const stopSellView = z.object({
  id: uuid,
  connectionId: uuid,
  source: z.enum(['manual', 'protection']),
  unitTypeId: uuid.nullable(),
  from: localDate,
  to: localDate,
  threshold: z.number().int().nullable(),
  reason: z.string(),
  status: z.record(z.string(), z.string()),
  createdAt: isoTs,
  releasedAt: isoTs.nullable(),
  version: z.number().int(),
});

// ───────────────────────────── event payloads (producer-owned; ids only, never guest data) ─────────────────────

export const ariOutcomeEvent = z.object({
  connectionId: uuid,
  propertyId: uuid,
  messageId: uuid,
  kind: ariKind,
  cells: z.number().int(),
  refusedCells: z.number().int(),
});
export const bookingEvent = z.object({
  connectionId: uuid,
  propertyId: uuid,
  revisionRowId: uuid,
  channelBookingId: z.string(),
  channelStatus: z.enum(['new', 'modified', 'cancelled']),
  via: z.enum(['webhook', 'feed', 'recovery']).optional(),
  reason: z.string().optional(),
});
export const discrepancyEvent = z.object({
  discrepancyId: uuid,
  connectionId: uuid,
  propertyId: uuid,
  kind: discrepancyKind,
});
export const channelHealthEvent = z.object({
  connectionId: uuid,
  propertyId: uuid,
  health: connectionHealth,
  previous: connectionHealth,
  reason: z.string(),
});
export const stopSellEvent = z.object({
  stopSellId: uuid,
  connectionId: uuid,
  propertyId: uuid,
  source: z.enum(['manual', 'protection']),
});
