// Public API contracts for the reservations module. No server-only imports: web apps import this file.
import { z } from 'zod';

const uuid = z.uuid();
const localDate = z.iso.date();
const localTime = z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, 'Use HH:MM (24-hour)');
export const money = z.object({ amountMinor: z.number().int(), currency: z.string().regex(/^[A-Z]{3}$/) });
export const entityRef = z.object({ type: z.string(), id: z.string() });

export const bookingStatus = z.enum([
  'inquiry',
  'quoted',
  'held',
  'tentative',
  'confirmed',
  'cancelled',
  'declined',
  'expired',
  'completed',
]);
export const stayStatus = z.enum(['expected', 'in_house', 'departed', 'cancelled', 'no_show', 'waitlisted']);
export const bookingSource = z.enum([
  'direct_phone',
  'direct_email',
  'walk_in',
  'booking_engine',
  'channel',
  'agency',
  'company',
  'group',
  'import',
]);
export const guaranteeKind = z.enum(['none', 'card', 'deposit', 'company', 'agency', 'prepaid_channel']);
export const commercialType = z.enum(['standard', 'complimentary', 'house_use']);

export const occupancy = z.object({
  adults: z.number().int().min(1).max(20),
  childrenAges: z.array(z.number().int().min(0).max(17)).max(10).default([]),
});

export const profileInput = z.object({
  firstName: z.string().max(100).optional(),
  lastName: z.string().min(1).max(100),
  email: z.email().optional(),
  phone: z.string().max(40).optional(),
  nationality: z.string().length(2).optional(),
  birthDate: localDate.optional(),
  language: z.string().max(10).optional(),
});

export const payerRef = z.object({ type: z.enum(['profile', 'company', 'agency', 'house']), id: uuid });

export const occupantInput = z.object({
  profileId: uuid.optional(),
  profile: profileInput.optional(),
  kind: z.enum(['adult', 'child']),
  ageAtArrival: z.number().int().min(0).max(17).optional(),
  primary: z.boolean().default(false),
});

export const arrivalDetails = z.object({
  transportMode: z.enum(['seaplane', 'speedboat', 'domestic_flight', 'car', 'walk_in', 'other']).optional(),
  carrier: z.string().max(100).optional(),
  number: z.string().max(40).optional(),
  scheduledAt: z.iso.datetime({ offset: true }).optional(),
  estimatedAt: z.iso.datetime({ offset: true }).optional(),
  arrivalPoint: z.string().max(200).optional(),
  transferRequested: z.boolean().optional(),
  notes: z.string().max(1000).optional(),
});

export const stayInput = z.object({
  unitTypeId: uuid,
  ratePlanId: uuid,
  arrival: localDate,
  departure: localDate,
  occupancy,
  commercialType: commercialType.default('standard'),
  commercialReason: z.string().min(3).max(500).optional(),
  occupants: z.array(occupantInput).max(20).default([]),
  unitId: uuid.optional(),
  blockId: uuid.optional(),
  waitlist: z
    .object({ priority: z.number().int().min(1).max(10).default(5), expiresAt: localDate })
    .optional(),
  requests: z.array(z.string().min(1).max(500)).max(20).default([]),
  eta: localTime.optional(),
  arrivalDetails: arrivalDetails.optional(),
});
export type StayInput = z.infer<typeof stayInput>;

export const bookerInput = z.object({
  kind: z.enum(['profile', 'company', 'agency', 'channel']),
  profileId: uuid.optional(),
  profile: profileInput.optional(),
  companyId: uuid.optional(),
  agencyId: uuid.optional(),
  name: z.string().max(200).optional(),
});

export const guaranteeInput = z.object({
  kind: guaranteeKind,
  /** PSP payment-method token reference (never a card number). */
  paymentMethodId: z.string().max(200).optional(),
  note: z.string().max(500).optional(),
});

export const billingInstructions = z.object({
  /** Who pays accommodation (room, packages and their taxes). Omit = occupants/booker on the stay folio. */
  accommodationPayer: payerRef.optional(),
  /** Who pays everything else. 'occupants' = each stay's primary occupant. */
  incidentalsPayer: z.enum(['occupants', 'booker']).default('occupants'),
});
export type BillingInstructions = z.infer<typeof billingInstructions>;

export const newBookingInput = z.object({
  propertyId: uuid,
  intent: z.enum(['quote', 'hold', 'tentative', 'confirm', 'waitlist']),
  booker: bookerInput,
  source: bookingSource,
  channelConnectionId: uuid.optional(),
  externalRefs: z.record(z.string(), z.string().max(200)).default({}),
  marketSegment: z.string().min(1).max(60),
  companyId: uuid.optional(),
  agencyId: uuid.optional(),
  commission: z
    .object({ kind: z.enum(['percent', 'net_rate']), percent: z.number().min(0).max(100).optional() })
    .optional(),
  guarantee: guaranteeInput.default({ kind: 'none' }),
  depositRequirement: z.object({ amount: money, dueDate: localDate }).optional(),
  notes: z.string().max(4000).optional(),
  specialRequests: z.array(z.string().min(1).max(500)).max(20).default([]),
  tags: z.array(z.string().min(1).max(40)).max(20).default([]),
  optionDate: localDate.optional(),
  ownerId: uuid.optional(),
  billing: billingInstructions.optional(),
  overbooking: z.object({ reason: z.string().min(3).max(500) }).optional(),
  stays: z.array(stayInput).min(1).max(30),
});
export type NewBookingInput = z.infer<typeof newBookingInput>;

export const bookingPatch = z
  .object({
    marketSegment: z.string().min(1).max(60),
    notes: z.string().max(4000).nullable(),
    specialRequests: z.array(z.string().min(1).max(500)).max(20),
    tags: z.array(z.string().min(1).max(40)).max(20),
    ownerId: uuid.nullable(),
    optionDate: localDate.nullable(),
    guarantee: guaranteeInput,
    externalRefs: z.record(z.string(), z.string().max(200)),
  })
  .partial();
export type BookingPatch = z.infer<typeof bookingPatch>;

export const stayPatch = z
  .object({
    eta: localTime.nullable(),
    etd: localTime.nullable(),
    arrivalDetails,
    requests: z.array(
      z.object({ text: z.string().min(1).max(500), status: z.enum(['open', 'prepared', 'cancelled']) }),
    ),
    notes: z.string().max(4000).nullable(),
  })
  .partial();
export type StayPatch = z.infer<typeof stayPatch>;

// ───────────────────────────── records ─────────────────────────────

export const segment = z.object({
  id: uuid,
  from: localDate,
  to: localDate,
  unitTypeId: uuid,
  ratePlanId: uuid,
  occupancy,
  termsSnapshotId: uuid,
  unitId: uuid.nullable(),
});

export const occupant = z.object({
  id: uuid,
  profileId: uuid.nullable(),
  name: z.string().nullable(),
  kind: z.enum(['adult', 'child']),
  ageAtArrival: z.number().int().nullable(),
  primary: z.boolean(),
});

export const stayRequest = z.object({ text: z.string(), status: z.enum(['open', 'prepared', 'cancelled']) });

export const stay = z.object({
  id: uuid,
  bookingId: uuid,
  propertyId: uuid,
  status: stayStatus,
  commercialType,
  arrival: localDate,
  departure: localDate,
  unitTypeId: uuid,
  ratePlanId: uuid,
  occupancy,
  unitId: uuid.nullable(),
  blockId: uuid.nullable(),
  segments: z.array(segment),
  occupants: z.array(occupant),
  requests: z.array(stayRequest),
  eta: z.string().nullable(),
  etd: z.string().nullable(),
  arrivalDetails: z.record(z.string(), z.unknown()),
  waitlist: z.object({ priority: z.number(), expiresAt: localDate }).nullable(),
  totals: z.object({ net: money, taxes: money, fees: money, gross: money }),
  checkedInAt: z.string().nullable(),
  checkedOutAt: z.string().nullable(),
  version: z.number().int(),
});
export type Stay = z.infer<typeof stay>;

export const forwardedChangeView = z.object({
  id: uuid,
  kind: z.string(),
  status: z.enum(['pending', 'acknowledged', 'rejected']),
  systemName: z.string().nullable(),
  createdAt: z.string(),
});

export const booking = z.object({
  id: uuid,
  propertyId: uuid,
  code: z.string(),
  status: bookingStatus,
  booker: z.object({
    kind: z.enum(['profile', 'company', 'agency', 'channel']),
    profileId: uuid.nullable(),
    companyId: uuid.nullable(),
    agencyId: uuid.nullable(),
    name: z.string().nullable(),
  }),
  source: bookingSource,
  channelConnectionId: uuid.nullable(),
  externalRefs: z.record(z.string(), z.string()),
  marketSegment: z.string(),
  commission: z.object({ kind: z.string(), percent: z.number().optional() }).nullable(),
  guarantee: z.object({
    kind: guaranteeKind,
    paymentMethodId: z.string().optional(),
    note: z.string().optional(),
  }),
  depositRequirement: z.object({ amount: money, dueDate: localDate }).nullable(),
  optionDate: localDate.nullable(),
  holdExpiresAt: z.string().nullable(),
  ownerId: uuid.nullable(),
  notes: z.string().nullable(),
  specialRequests: z.array(z.string()),
  tags: z.array(z.string()),
  currency: z.string(),
  totals: z.object({ net: money, taxes: money, fees: money, gross: money }),
  stays: z.array(stay),
  pendingForwardedChanges: z.array(forwardedChangeView),
  createdAt: z.string(),
  updatedAt: z.string(),
  version: z.number().int(),
});
export type Booking = z.infer<typeof booking>;

export const bookingSummary = booking.omit({ stays: true, pendingForwardedChanges: true }).extend({
  arrival: localDate,
  departure: localDate,
  stayCount: z.number().int(),
});
export type BookingSummary = z.infer<typeof bookingSummary>;

export const bookingListQuery = z.object({
  propertyId: uuid,
  status: bookingStatus.optional(),
  arrivalFrom: localDate.optional(),
  arrivalTo: localDate.optional(),
  code: z.string().max(20).optional(),
  source: bookingSource.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().max(500).optional(),
});
export type BookingListQuery = z.infer<typeof bookingListQuery>;

// ───────────────────────────── quotes ─────────────────────────────

export const quoteRequest = z.object({
  propertyId: uuid,
  arrival: localDate,
  departure: localDate,
  occupancy,
  unitTypeIds: z.array(uuid).max(50).optional(),
  ratePlanIds: z.array(uuid).max(50).optional(),
  companyId: uuid.optional(),
  promoCode: z.string().max(40).optional(),
});

export const quoteOffer = z.object({
  unitTypeId: uuid,
  ratePlanId: uuid,
  ratePlanName: z.string().optional(),
  available: z.number().int(),
  bookable: z.boolean(),
  unavailableNights: z.array(localDate),
  nightly: z.array(z.object({ date: localDate, amount: money })),
  totals: z.object({ net: money, taxes: money, fees: money, gross: money }),
  inclusions: z.array(z.object({ code: z.string(), name: z.string() })),
  cancellation: z.string(),
  restrictionViolations: z.array(z.object({ code: z.string(), message: z.string() })),
});

// ───────────────────────────── change previews ─────────────────────────────

const typeChangePolicy = z.enum(['keep_agreed', 'difference', 'reprice']);
export const extraNightsPlan = z.discriminatedUnion('strategy', [
  z.object({ strategy: z.literal('keep_unit') }),
  z.object({ strategy: z.literal('move_extra_nights'), unitId: uuid }),
  z.object({ strategy: z.literal('move_whole_stay'), unitId: uuid }),
  z.object({
    strategy: z.literal('change_type_extra'),
    unitTypeId: uuid,
    unitId: uuid.nullable(),
    typeChange: typeChangePolicy,
  }),
]);

export const changeRequest = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('new_booking'), booking: newBookingInput }),
  z.object({
    kind: z.literal('dates'),
    stayId: uuid,
    arrival: localDate,
    departure: localDate,
    extraNights: extraNightsPlan.optional(),
  }),
  z.object({
    kind: z.literal('unit_type'),
    stayId: uuid,
    unitTypeId: uuid,
    fromDate: localDate.optional(),
    ratePlanId: uuid.optional(),
    unitId: uuid.nullable().optional(),
    typeChange: typeChangePolicy.optional(),
  }),
  z.object({ kind: z.literal('rate_plan'), stayId: uuid, ratePlanId: uuid, fromDate: localDate.optional() }),
  z.object({ kind: z.literal('occupancy'), stayId: uuid, occupancy, fromDate: localDate.optional() }),
  z.object({
    kind: z.literal('move'),
    stayId: uuid,
    unitId: uuid,
    fromDate: localDate.optional(),
    reason: z.enum(['guest_request', 'maintenance', 'upgrade', 'relocation', 'other']),
    chargeable: z.boolean().default(false),
  }),
  z.object({
    kind: z.literal('early_check_in'),
    stayId: uuid,
    time: localTime,
  }),
  z.object({
    kind: z.literal('late_check_out'),
    stayId: uuid,
    time: localTime,
  }),
  z.object({ kind: z.literal('add_stay'), bookingId: uuid, stay: stayInput }),
  z.object({
    kind: z.literal('cancel_stay'),
    stayId: uuid,
    waive: z.object({ reason: z.string().min(3) }).optional(),
  }),
  z.object({
    kind: z.literal('cancel_booking'),
    bookingId: uuid,
    reason: z.string().min(1).max(500),
    waive: z.object({ reason: z.string().min(3) }).optional(),
  }),
  z.object({ kind: z.literal('waitlist_extension'), stayId: uuid, departure: localDate }),
]);
export type ChangeRequest = z.infer<typeof changeRequest>;

export const nightEffect = z.object({
  date: localDate,
  unitTypeId: uuid.nullable(),
  before: money.nullable(),
  after: money.nullable(),
  status: z.enum(['kept', 'added', 'removed', 'repriced', 'retyped']),
  availability: z
    .object({ available: z.number().int(), sufficient: z.boolean(), why: z.string().optional() })
    .nullable(),
});

export const stayEffect = z.object({
  stayId: uuid.nullable(),
  label: z.string(),
  before: z
    .object({
      arrival: localDate,
      departure: localDate,
      unitTypeId: uuid,
      ratePlanId: uuid,
      occupancy,
      unitId: uuid.nullable(),
    })
    .nullable(),
  after: z
    .object({
      arrival: localDate,
      departure: localDate,
      unitTypeId: uuid,
      ratePlanId: uuid,
      occupancy,
      unitId: uuid.nullable(),
    })
    .nullable(),
  nights: z.array(nightEffect),
  totals: z.object({
    before: z.object({ net: money, taxes: money, fees: money, gross: money }),
    after: z.object({ net: money, taxes: money, fees: money, gross: money }),
  }),
  inclusions: z.object({ before: z.array(z.string()), after: z.array(z.string()) }),
  assignment: z.object({
    status: z.enum(['none', 'unchanged', 'kept', 'released', 'moved', 'conflict', 'needs_assignment']),
    unitId: uuid.nullable(),
    message: z.string(),
    conflictingRefs: z.array(entityRef),
  }),
});

export const penaltyEffect = z.object({
  stayId: uuid.nullable(),
  kind: z.string(),
  amount: money,
  description: z.string(),
  waived: z.boolean(),
});

const previewCore = z.object({
  token: uuid,
  kind: z.string(),
  bookingId: uuid.nullable(),
  bookingVersion: z.number().int().nullable(),
  fingerprint: z.string(),
  expiresAt: z.string(),
  currency: z.string(),
  feasible: z.boolean(),
  blockers: z.array(z.object({ code: z.string(), message: z.string() })),
  warnings: z.array(z.string()),
  stays: z.array(stayEffect),
  totals: z.object({ before: money, after: money, difference: money }),
  taxes: z.object({ before: money, after: money }),
  penalties: z.array(penaltyEffect),
  fees: z.array(z.object({ kind: z.string(), amount: money, description: z.string() })),
  deposits: z.object({
    requiredBefore: money,
    requiredAfter: money,
    held: money.nullable(),
    additionalDue: money,
  }),
  balance: z.object({ projectedBefore: money, projectedAfter: money, basis: z.string() }),
  provenance: z.enum(['live', 'simulated']),
});
export const changePreview = previewCore.extend({
  alternatives: z.array(
    z.object({ id: z.string(), label: z.string(), description: z.string(), preview: previewCore }),
  ),
});
export type ChangePreview = z.infer<typeof changePreview>;

export const commitRequest = z.object({ previewToken: uuid });

// ───────────────────────────── workflows ─────────────────────────────

export const stepView = z.object({
  key: z.string(),
  label: z.string(),
  status: z.enum(['pending', 'done', 'failed', 'skipped']),
  mandatory: z.boolean(),
  external: z.boolean(),
  attempts: z.number().int(),
  message: z.string().nullable(),
  result: z.record(z.string(), z.unknown()).nullable(),
  updatedAt: z.string().nullable(),
});

export const workflowRun = z.object({
  id: uuid,
  stayId: uuid,
  kind: z.enum(['check_in', 'check_out']),
  status: z.enum(['in_progress', 'completed', 'abandoned']),
  steps: z.array(stepView),
  summary: z.object({
    succeeded: z.array(z.string()),
    remaining: z.array(z.string()),
    failed: z.array(z.string()),
    pendingExternal: z.array(z.string()),
  }),
  version: z.number().int(),
  startedAt: z.string(),
  updatedAt: z.string(),
});
export type WorkflowRun = z.infer<typeof workflowRun>;

/**
 * Keys step. `manualFallback` records that staff issued (or deactivated) keys on the lock console because the
 * key system was unavailable — an explicit, audited outcome, never an implicit success.
 */
export const keyStepInput = z.object({
  kind: z.enum(['card', 'wristband', 'mobile']).optional(),
  count: z.number().int().min(1).max(10).optional(),
  manualFallback: z.object({ confirmed: z.literal(true), note: z.string().min(3).max(300) }).optional(),
});

export const checkInInputs = z
  .object({
    registration: z.object({
      primaryOccupant: profileInput.optional(),
      identityVerified: z.boolean(),
      documentReference: z.string().max(100).optional(),
    }),
    unit: z.object({ unitId: uuid.optional(), overrideConditionReason: z.string().min(3).optional() }),
    guarantee: z.object({ paymentMethodId: z.string().max(200).optional(), amount: money.optional() }),
    access: keyStepInput,
  })
  .partial();
export type CheckInInputs = z.infer<typeof checkInInputs>;

export const checkOutInputs = z
  .object({
    settle: z.object({ leaveOpenReason: z.string().min(3).optional() }),
    access: keyStepInput,
  })
  .partial();
export type CheckOutInputs = z.infer<typeof checkOutInputs>;

export const skipStepInput = z.object({ reason: z.string().min(3).max(500) });

// ───────────────────────────── front desk ─────────────────────────────

export const readinessView = z.object({
  ready: z.boolean(),
  checks: z.array(
    z.object({ key: z.string(), status: z.enum(['ok', 'blocking', 'unknown']), message: z.string() }),
  ),
  blockingReason: z.object({ key: z.string(), message: z.string() }).nullable(),
});

export const frontDeskRow = z.object({
  stayId: uuid,
  bookingId: uuid,
  bookingCode: z.string(),
  bookingStatus,
  stayStatus,
  guestName: z.string().nullable(),
  arrival: localDate,
  departure: localDate,
  unitTypeId: uuid,
  unitId: uuid.nullable(),
  unitName: z.string().nullable(),
  eta: z.string().nullable(),
  occupancy,
  flags: z.array(z.string()),
  readiness: readinessView.nullable(),
  balance: money.nullable(),
  checkInRun: z.object({ status: z.string(), remaining: z.array(z.string()) }).nullable(),
});
export type FrontDeskRow = z.infer<typeof frontDeskRow>;

export const frontDeskQuery = z.object({ propertyId: uuid, date: localDate.optional() });

// ───────────────────────────── handover ─────────────────────────────

export const handoverItemInput = z.object({
  propertyId: uuid,
  department: z.string().min(1).max(60),
  kind: z.enum(['task', 'financial_exception', 'guest_commitment', 'note']),
  title: z.string().min(1).max(200),
  detail: z.string().max(4000).optional(),
  ref: entityRef.optional(),
  ownerId: uuid,
  ownerName: z.string().max(200).optional(),
  dueAt: z.iso.datetime({ offset: true }).optional(),
});

export const handoverItem = handoverItemInput.extend({
  id: uuid,
  status: z.enum(['open', 'resolved']),
  source: z.enum(['manual', 'reservations_issue', 'relocation']),
  createdAt: z.string(),
  resolvedAt: z.string().nullable(),
  resolution: z.string().nullable(),
});

export const publishHandoverInput = z.object({
  propertyId: uuid,
  department: z.string().min(1).max(60),
  shiftLabel: z.string().min(1).max(60),
  notes: z.string().max(4000).optional(),
});

export const handover = z.object({
  id: uuid,
  propertyId: uuid,
  department: z.string(),
  shiftLabel: z.string(),
  status: z.enum(['published', 'acknowledged']),
  notes: z.string().nullable(),
  items: z.array(
    z.object({
      itemId: z.string(),
      kind: z.string(),
      title: z.string(),
      ownerId: z.string().nullable(),
      ownerName: z.string().nullable(),
      source: z.string(),
      stillOpen: z.boolean(),
    }),
  ),
  publishedBy: z.string(),
  publishedAt: z.string(),
  acknowledgedBy: z.string().nullable(),
  acknowledgedAt: z.string().nullable(),
  version: z.number().int(),
});
export type Handover = z.infer<typeof handover>;

// ───────────────────────────── channel ingestion ─────────────────────────────

export const canonicalChannelBooking = z.object({
  status: z.enum(['confirmed', 'modified', 'cancelled']),
  propertyId: uuid,
  currency: z.string().regex(/^[A-Z]{3}$/),
  booker: profileInput,
  rooms: z
    .array(
      z.object({
        roomRef: z.string().min(1).max(100),
        unitTypeId: uuid,
        ratePlanId: uuid,
        arrival: localDate,
        departure: localDate,
        adults: z.number().int().min(1).max(20),
        childrenAges: z.array(z.number().int().min(0).max(17)).default([]),
        guests: z.array(profileInput).default([]),
        nightlyPrices: z.array(z.object({ date: localDate, amountMinor: z.number().int() })),
        specialRequests: z.array(z.string()).default([]),
      }),
    )
    .min(1),
  guarantee: z.object({
    kind: z.enum(['prepaid_channel', 'card', 'agency', 'none']),
    paymentMethodId: z.string().optional(),
  }),
  specialRequests: z.array(z.string()).default([]),
  notes: z.string().optional(),
  marketSegment: z.string().default('ota'),
  commission: z.object({ percent: z.number().min(0).max(100) }).optional(),
});
export type CanonicalChannelBooking = z.infer<typeof canonicalChannelBooking>;

export const ingestRequest = z.object({
  connectionId: uuid,
  externalId: z.string().min(1).max(200),
  revision: z.number().int().min(0),
  payload: canonicalChannelBooking,
});

export const ingestResult = z.object({
  outcome: z.enum(['created', 'modified', 'cancelled', 'duplicate', 'conflict', 'stale']),
  bookingId: uuid.optional(),
  fieldLosses: z.array(z.object({ path: z.string(), lost: z.unknown(), kind: z.string() })).optional(),
  conflictIds: z.array(z.string()).optional(),
  note: z.string().optional(),
});
export type IngestResult = z.infer<typeof ingestResult>;

// ───────────────────────────── issues & relocation ─────────────────────────────

export const issue = z.object({
  id: uuid,
  propertyId: uuid,
  kind: z.string(),
  severity: z.enum(['urgent', 'routine']),
  bookingId: uuid.nullable(),
  stayId: uuid.nullable(),
  message: z.string(),
  ownerId: uuid.nullable(),
  status: z.enum(['open', 'resolved']),
  details: z.record(z.string(), z.unknown()),
  createdAt: z.string(),
});

export const relocationCase = z.object({
  id: uuid,
  propertyId: uuid,
  stayId: uuid,
  bookingId: uuid,
  cause: z.string(),
  nights: z.object({ from: localDate, to: localDate }),
  options: z.array(
    z.object({
      kind: z.string(),
      label: z.string(),
      unitId: z.string().nullable(),
      unitTypeId: z.string().nullable(),
    }),
  ),
  status: z.enum(['open', 'option_selected', 'completed', 'cancelled']),
  ownerId: uuid.nullable(),
  createdAt: z.string(),
  version: z.number().int(),
});
export type KeyStepInput = z.infer<typeof keyStepInput>;
