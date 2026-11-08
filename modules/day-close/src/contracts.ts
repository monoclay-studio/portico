/**
 * Public contracts of the day-close module (Zod). No server imports: the web apps import this file.
 * Kernel vocabularies (provenance, effect modes) are imported as types, never copied as literal lists (BS3-1).
 */
import type { EffectMode, Provenance } from '@portico/kernel';
import { z } from 'zod';

const uuid = z.uuid();
const localDate = z.iso.date();
const timestamp = z.string();
const money = z.object({ amountMinor: z.number().int(), currency: z.string().regex(/^[A-Z]{3}$/) });
/** Kernel vocabularies typed from the kernel (never a copied literal list); documented as strings. */
const provenance = z.string().describe('Kernel Provenance') as unknown as z.ZodType<Provenance>;
const effectMode = z.string().describe('Kernel EffectMode') as unknown as z.ZodType<EffectMode>;

export const STEP_KEYS = [
  'preflight',
  'no_shows',
  'room_and_package_postings',
  'allowance_close',
  'payments_housekeeping',
  'integrity',
  /** Last postings of the day (stays checked in during Day Close) and the blocker re-check (review P2-2/P2-3). */
  'final_sweep',
  /** Day facts are frozen in the same transaction that advances the date (DCL-I03 from the state the advance closes). */
  'advance',
  'post_advance',
] as const;
export type StepKey = (typeof STEP_KEYS)[number];
export const stepKey = z.enum(STEP_KEYS);

export const RUN_STATUSES = ['preflight', 'blocked', 'running', 'failed', 'completed', 'cancelled'] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];
export const STEP_STATUSES = ['pending', 'running', 'completed', 'failed', 'skipped'] as const;
export type StepStatus = (typeof STEP_STATUSES)[number];

// ───────────────────────────── Universal record contract pieces ─────────────────────────────

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

// ───────────────────────────── Readiness (DCL-R01) ─────────────────────────────

/** Who must act on an item: a department role of the property (the UI resolves the duty person). */
export const itemOwner = z.object({
  kind: z.enum(['user', 'department']),
  id: z.string(),
  name: z.string().optional(),
});

/** One fix for an item: the command (with the module that owns it) and whether it needs a preview. */
export const itemAction = z.object({
  action: z.string(),
  label: z.string(),
  module: z.string(),
  ref: z.object({ type: z.string(), id: z.string() }).nullable(),
  enabled: z.boolean(),
  reason: z.string().optional(),
});

/** Common exception shape `{code, severity, blocking, ref, owner, message, actions[]}` (spec DCL-R01). */
export const readinessItem = z.object({
  /** Stable key (source:code:refType:refId): what an override names. */
  key: z.string(),
  source: z.string(),
  code: z.string(),
  /** What the source module says. */
  severity: z.enum(['blocking', 'warning', 'info']),
  /** What the property's policy (and overrides) make of it: true = Day Close cannot proceed. */
  blocking: z.boolean(),
  overridable: z.boolean(),
  override: z.object({ reason: z.string(), by: z.string(), at: timestamp }).nullable(),
  ref: z.object({ type: z.string(), id: z.string() }).nullable(),
  owner: itemOwner,
  message: z.string(),
  actions: z.array(itemAction),
  since: timestamp.nullable(),
  details: z.record(z.string(), z.unknown()),
});
export type ReadinessItem = z.infer<typeof readinessItem>;

export const readiness = z.object({
  propertyId: uuid,
  businessDate: localDate,
  evaluatedAt: timestamp,
  /** One sentence for the auditor ("Ready to close: 0 blocking, 3 warnings."). */
  summary: z.string(),
  canClose: z.boolean(),
  counts: z.object({ blocking: z.number().int(), warning: z.number().int(), info: z.number().int() }),
  blocking: z.array(readinessItem),
  warnings: z.array(readinessItem),
  info: z.array(readinessItem),
  /** Sources that could not be read: their checks are missing, shown, never hidden. */
  unavailableSources: z.array(z.object({ source: z.string(), reason: z.string() })),
  provenance: provenance,
  activeRun: z.object({ id: uuid, status: z.enum(RUN_STATUSES), version: z.number().int() }).nullable(),
});
export type Readiness = z.infer<typeof readiness>;

// ───────────────────────────── Policy ─────────────────────────────

const localTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM (24-hour clock)');

/**
 * Property Day Close policy (platform policy key `dayClose.policy`, inherited organization → property).
 * Saving it is refused if it would not work (integrity codes demoted, a code listed both ways, a schedule earlier than
 * the earliest start). Codes are free text matched against readiness item codes: an unknown code has no effect
 * (review P3-4 — the catalogue grows with each connected module, so it is not validated against a fixed list).
 */
export const dayClosePolicy = z
  .object({
    /** Codes that block in addition to the defaults. */
    blockingCodes: z.array(z.string().min(1).max(80)).max(100).default([]),
    /** Codes demoted to warnings (never integrity codes). */
    warningCodes: z.array(z.string().min(1).max(80)).max(100).default([]),
    noShow: z
      .object({
        /** auto: Day Close marks due arrivals no-show; decide: each is a blocking item; off: arrivals roll over. */
        mode: z.enum(['auto', 'decide', 'off']).default('auto'),
        /** Never auto no-show an arrival whose transfer is recorded as delayed (EC-DCL-010). */
        protectDelayedTransfers: z.boolean().default(true),
        /** Ask payments to collect the agreed fee from the agreed guarantee only (ADR-0015 Amendment 1). */
        collectFee: z.enum(['agreed_guarantee', 'never']).default('agreed_guarantee'),
      })
      .default({ mode: 'auto', protectDelayedTransfers: true, collectFee: 'agreed_guarantee' }),
    /** Nights before the business date checked for "night not posted" (catch-up). */
    catchUpWindowNights: z.number().int().min(1).max(31).default(7),
    /**
     * A run cannot start before this local time of the business date (EC-DCL-026; times before 12:00 are after
     * midnight). Always set (review P2-5): a daytime close would no-show the afternoon's arrivals. The schedule must
     * not be earlier, and the no-show step re-checks it.
     */
    earliestStartLocalTime: localTime.default('22:00'),
    schedule: z
      .object({
        enabled: z.boolean().default(false),
        localTime: localTime.default('02:00'),
        /** Continue automatically when nothing blocks (guesthouse auto-close, DCL-R09). */
        autoContinue: z.boolean().default(true),
      })
      .default({ enabled: false, localTime: '02:00', autoContinue: true }),
    steps: z
      .object({ paymentsHousekeeping: z.enum(['run', 'skip']).default('run') })
      .default({ paymentsHousekeeping: 'run' }),
    /** Charge codes whose revenue counts as room revenue in ADR and RevPAR. */
    roomChargeCodes: z.array(z.string().min(1).max(30)).min(1).max(20).default(['ROOM']),
  })
  .strict();
export type DayClosePolicy = z.output<typeof dayClosePolicy>;
export type DayClosePolicyInput = z.input<typeof dayClosePolicy>;

export const policyView = z.object({
  propertyId: uuid,
  policy: dayClosePolicy,
  source: z.string(),
  valid: z.boolean(),
  problems: z.array(z.string()),
  effectiveBlockingCodes: z.array(z.string()),
  version: z.number().int(),
});
export const policyUpdateInput = z.object({ policy: dayClosePolicy, reason: z.string().min(3).max(500) });

// ───────────────────────────── Runs and steps ─────────────────────────────

export const stepView = z.object({
  key: stepKey,
  ordinal: z.number().int(),
  label: z.string(),
  status: z.enum(STEP_STATUSES),
  total: z.number().int().nullable(),
  done: z.number().int(),
  failed: z.number().int(),
  skipped: z.number().int(),
  remaining: z.number().int().nullable(),
  /** "Room postings: 88 of 112 stays posted, 24 remaining". */
  progress: z.string(),
  detail: z.record(z.string(), z.unknown()),
  error: z
    .object({
      code: z.string(),
      message: z.string(),
      retryable: z.boolean(),
      integrity: z.boolean().optional(),
    })
    .nullable(),
  attempts: z.number().int(),
  startedAt: timestamp.nullable(),
  finishedAt: timestamp.nullable(),
  failedItems: z.array(
    z.object({
      itemKey: z.string(),
      ref: z.object({ type: z.string(), id: z.string() }).nullable(),
      code: z.string(),
      message: z.string(),
      retryable: z.boolean(),
      overridden: z.boolean(),
    }),
  ),
});
export type StepView = z.infer<typeof stepView>;

export const runView = z.object({
  id: uuid,
  propertyId: uuid,
  businessDate: localDate,
  status: z.record(z.string(), z.string()),
  runStatus: z.enum(RUN_STATUSES),
  trigger: z.enum(['manual', 'schedule', 'api']),
  startedBy: z.string(),
  startedByName: z.string().nullable(),
  startedAt: timestamp,
  finishedAt: timestamp.nullable(),
  currentStep: stepKey.nullable(),
  summary: z.string(),
  steps: z.array(stepView),
  blockers: z.array(readinessItem),
  failure: z
    .object({
      step: z.string(),
      code: z.string(),
      message: z.string(),
      retryable: z.boolean(),
      integrity: z.boolean().optional(),
    })
    .nullable(),
  overrides: z.array(
    z.object({ itemKey: z.string(), code: z.string(), reason: z.string(), by: z.string(), at: timestamp }),
  ),
  execution: z.object({
    leaseHeldBy: z.string().nullable(),
    leaseUntil: timestamp.nullable(),
    lastHeartbeatAt: timestamp.nullable(),
    resumableAt: timestamp.nullable(),
    retryCount: z.number().int(),
    nextRetryAt: timestamp.nullable(),
    executions: z.array(z.record(z.string(), z.unknown())),
  }),
  notifications: z.object({ mode: effectMode }),
  autoContinue: z.boolean(),
  allowedActions: z.array(recordAction),
  issues: z.array(recordIssue),
  owner: recordOwner.optional(),
  links: z.array(recordLink),
  provenance: provenance,
  version: z.number().int(),
  /** True when a start request found this run already active (DCL-R06). */
  alreadyActive: z.boolean().optional(),
});
export type RunView = z.infer<typeof runView>;

export const startRunInput = z
  .object({
    /** Defaults to the property's current business date; must equal it. */
    businessDate: localDate.optional(),
    /** Run every step now (default) or only create the run for the worker to execute. */
    execute: z.boolean().default(true),
  })
  .strict();
export const resumeInput = z.object({}).strict();
export const cancelInput = z.object({ reason: z.string().min(3).max(500) }).strict();
export const overrideInput = z
  .object({ itemKey: z.string().min(3).max(300), reason: z.string().min(3).max(500) })
  .strict();
export const resolveIssueInput = z.object({ resolution: z.string().min(3).max(500) }).strict();
/** Decide a stay-night a person took out of Day Close (review P1-1): Day Close posts it, or it was charged elsewhere. */
export const nightDecisionInput = z
  .object({
    stayId: uuid,
    night: localDate,
    decision: z.enum(['post_by_day_close', 'posted_elsewhere']),
    reason: z.string().min(3).max(500),
  })
  .strict();
export type NightDecisionInput = z.infer<typeof nightDecisionInput>;

export const runListQuery = z.object({
  from: localDate.optional(),
  to: localDate.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
export const runSummary = z.object({
  id: uuid,
  propertyId: uuid,
  businessDate: localDate,
  runStatus: z.enum(RUN_STATUSES),
  startedAt: timestamp,
  finishedAt: timestamp.nullable(),
  currentStep: stepKey.nullable(),
  version: z.number().int(),
});

// ───────────────────────────── Day facts and reports (DCL-R02 step 7, DCL-R07) ─────────────────────────────

export const dayFacts = z.object({
  propertyId: uuid,
  businessDate: localDate,
  currency: z.string(),
  rooms: z.object({
    capacity: z.number().int(),
    outOfOrder: z.number().int(),
    available: z.number().int(),
    sold: z.number().int(),
    complimentary: z.number().int(),
    houseUse: z.number().int(),
  }),
  /** Percentages as decimal strings with two places; money in minor units. */
  occupancyPercent: z.string(),
  adr: money,
  revpar: money,
  roomRevenue: money,
  revenueByChargeCode: z.array(z.object({ chargeCode: z.string(), netMinor: z.number().int() })),
  totalRevenue: money,
  movements: z.object({
    arrivals: z.number().int(),
    /** Departed stays need a reservations list of departures by date (contract request): null until bound. */
    departures: z.number().int().nullable(),
    noShows: z.number().int(),
    inHouse: z.number().int(),
  }),
  guests: z.object({ adults: z.number().int(), children: z.number().int(), guestNights: z.number().int() }),
  /** Guest-nights by nationality need the guests module (Q43): reported as incomplete until bound. */
  nationality: z.object({ status: z.enum(['complete', 'incomplete']), reason: z.string().nullable() }),
  generatedAt: timestamp,
  runId: uuid,
});
export type DayFacts = z.infer<typeof dayFacts>;

export const dayReport = z.object({
  id: z.string(),
  propertyId: uuid,
  businessDate: localDate,
  runId: uuid,
  generatedAt: timestamp,
  /** The "as closed" pack (immutable). */
  pack: z.object({
    managerFlash: z.record(z.string(), z.unknown()),
    trialBalance: z.record(z.string(), z.unknown()),
    exceptions: z.array(z.record(z.string(), z.unknown())),
    overrides: z.array(z.record(z.string(), z.unknown())),
    steps: z.array(z.record(z.string(), z.unknown())),
  }),
  /**
   * Computed on read (DCL-R07, EC-DCL-021, review P2-3/P2-4/P2-13), each entry labelled by cause:
   * - `revenueDelta`: revenue stamped with the date that committed after the close froze it (in-flight postings,
   *   FR-1) — the facts are frozen in the advance transaction, so nothing else can change it;
   * - `entries`: corrections finance relates to the date (`relatesToBusinessDate`);
   * - `latePostings`: charges for the date's service posted after it closed — Day Close's own late postings
   *   (catch-up nights, agreement lines) from its register; others need finance's service-date query (CR-19).
   */
  restatementsSince: z.object({
    asOf: timestamp,
    revenueDelta: z.array(
      z.object({
        chargeCode: z.string(),
        closedMinor: z.number().int(),
        nowMinor: z.number().int(),
        cause: z.literal('posted_after_close'),
      }),
    ),
    entries: z.array(z.record(z.string(), z.unknown())),
    latePostings: z.object({
      byDayClose: z.array(
        z.object({
          stayId: uuid,
          lineKey: z.string(),
          kind: z.string(),
          serviceDate: localDate,
          postedOn: localDate,
          amount: money,
          cause: z.literal('late_posting'),
        }),
      ),
      otherSources: z.object({ status: z.enum(['not_connected']), reason: z.string() }),
    }),
    changed: z.boolean(),
  }),
  links: z.array(recordLink),
  provenance: provenance,
});
export type DayReport = z.infer<typeof dayReport>;

export const portfolioBoard = z.object({
  generatedAt: timestamp,
  properties: z.array(
    z.object({
      propertyId: uuid,
      name: z.string(),
      businessDate: localDate,
      lagDays: z.number().int(),
      run: runSummary.nullable(),
      blockingCount: z.number().int().nullable(),
      lastCompletedAt: timestamp.nullable(),
      alert: z.string().nullable(),
    }),
  ),
});

export const issueView = z.object({
  id: uuid,
  propertyId: uuid,
  businessDate: localDate,
  code: z.string(),
  severity: z.enum(['blocking', 'warning', 'info']),
  message: z.string(),
  ref: z.object({ type: z.string(), id: z.string() }).nullable(),
  owner: itemOwner,
  status: z.enum(['open', 'resolved']),
  details: z.record(z.string(), z.unknown()),
  createdAt: timestamp,
  resolvedAt: timestamp.nullable(),
  resolution: z.string().nullable(),
  version: z.number().int(),
});

export const propertyParams = z.object({ propertyId: uuid });
export const runParams = z.object({ id: uuid });
export const dateParams = z.object({ propertyId: uuid, date: localDate });
export const readinessQuery = z.object({ businessDate: localDate.optional() });
export { money as moneySchema };
