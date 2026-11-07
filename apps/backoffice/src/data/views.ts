/**
 * View models the APP owns for screens that combine several modules or whose module API does not exist yet.
 * Each names the module endpoints that will feed it, so a live adapter maps real payloads into it. Fields use
 * the modules' vocabularies (reservations stay/booking status, operations unit condition, payments state).
 */
import { bookingStatus, money, stayStatus } from '@portico/reservations/contracts';
import { z } from 'zod';
import { boardRow, readinessView } from './contracts';

const id = z.string().min(1);
const localDate = z.iso.date();
const isoDateTime = z.iso.datetime({ offset: true });
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export type Money = z.infer<typeof money>;

/** RES-R36 timeline (reservations + inventory): units × nights with stays, blocks and holds. */
export const timelineItem = z.object({
  id,
  unitId: id,
  kind: z.enum(['stay', 'block', 'hold']),
  from: localDate,
  to: localDate,
  label: z.string(),
  bookingCode: z.string().optional(),
  stayStatus: stayStatus.optional(),
  blockKind: z.enum(['out_of_order', 'out_of_service', 'house_use']).optional(),
  flags: z.array(z.string()),
  guests: z.number().int().optional(),
  nightlyRate: money.optional(),
});
export const timelineView = z.object({
  from: localDate,
  days: z.number().int(),
  units: z.array(
    z.object({ unitId: id, unitNumber: z.string(), unitTypeName: z.string(), condition: z.string() }),
  ),
  items: z.array(timelineItem),
});
export type TimelineView = z.infer<typeof timelineView>;
export type TimelineItemView = z.infer<typeof timelineItem>;

/** Glossary "Change preview" (reservations `changePreview`, simplified until P2-13 binds the real one). */
export const changePreviewLine = z.object({
  label: z.string(),
  before: z.string(),
  after: z.string(),
  delta: z.string().optional(),
  changed: z.boolean(),
  attention: z.enum(['warning', 'danger']).optional(),
});
export const stayChangePreview = z.object({
  token: z.string(),
  stayId: id,
  title: z.string(),
  summary: z.string(),
  validUntil: isoDateTime,
  /** False when something stops the change; confirm stays disabled and `blockers` say what to do instead. */
  feasible: z.boolean(),
  blockers: z.array(z.string()),
  sections: z.array(
    z.object({
      kind: z.enum(['availability', 'price', 'taxes', 'deposits', 'balance']),
      rows: z.array(changePreviewLine),
      note: z.string().optional(),
    }),
  ),
  consequences: z.array(z.string()),
});
export type StayChangePreview = z.infer<typeof stayChangePreview>;

/** Arrival details (reservations stay `arrivalDetails`, RES-R39). Times are property-local HH:MM. */
export const arrivalDetails = z.object({
  transportMode: z.enum(['seaplane', 'speedboat', 'domestic_flight', 'car', 'walk_in', 'other']),
  carrier: z.string().optional(),
  number: z.string().optional(),
  inbound: z.string().optional(),
  scheduledTime: hhmm.optional(),
  estimatedTime: hhmm.optional(),
  delayReason: z.string().optional(),
  arrivalPoint: z.string().optional(),
});

/**
 * Stay record (reservations GET /stays/:id + payments status + guests VIP). Nullable wherever a source may
 * not know: the record shows "not known" rather than a guess.
 */
export const stayRecordView = z.object({
  stayId: id,
  bookingId: id,
  bookingCode: z.string(),
  bookingStatus: bookingStatus.nullable(),
  stayStatus,
  guestName: z.string().nullable(),
  vip: z.boolean().nullable(),
  unitId: id.nullable(),
  unitName: z.string().nullable(),
  unitTypeName: z.string().nullable(),
  unitCondition: z.string().nullable(),
  arrival: localDate,
  departure: localDate,
  occupancy: z.object({ adults: z.number().int(), childrenAges: z.array(z.number().int()) }),
  eta: hhmm.nullable(),
  arrivalDetails: arrivalDetails.nullable(),
  /** Payments' state for this stay ('none', 'authorized', 'pending_verification' …); null = unavailable. */
  paymentStatus: z.string().nullable(),
  balance: money.nullable(),
  nightlyRate: money.nullable(),
  requests: z.array(z.object({ text: z.string(), status: z.enum(['open', 'prepared', 'cancelled']) })),
  readiness: readinessView.nullable(),
  checkedInAt: isoDateTime.nullable(),
  history: z.array(
    z.object({
      at: isoDateTime,
      action: z.string(),
      actor: z.object({ kind: z.string(), label: z.string() }),
      reason: z.string().nullable(),
    }),
  ),
});
export type StayRecordView = z.infer<typeof stayRecordView>;

/** Unit record: the operations board row for the unit + its stays around today (timeline). */
export const unitRecordView = z.object({ row: boardRow, stays: z.array(timelineItem) });
export type UnitRecordView = z.infer<typeof unitRecordView>;

/** My work (foundation inbox, not built yet): records that need someone, across modules. */
export const workItem = z.object({
  id,
  kind: z.enum(['exception', 'task', 'approval', 'handover']),
  area: z.enum(['front_desk', 'housekeeping', 'payments', 'rates', 'management']),
  title: z.string(),
  detail: z.string(),
  priority: z.enum(['urgent', 'high', 'normal', 'low']),
  assignee: z.string().nullable(),
  dueAt: isoDateTime.nullable(),
  record: z.object({ type: z.string(), id, title: z.string() }).nullable(),
});
export type WorkItem = z.infer<typeof workItem>;

/**
 * Overview figures that no single board shows (inventory occupancy and forecast; payments awaiting
 * verification). Arrivals, departures, in-house and exceptions on Today come from the same lists as their
 * boards, so the numbers always agree with the drill-down.
 */
export const overviewView = z.object({
  businessDate: localDate,
  occupancy: z.object({
    occupied: z.number().int(),
    sellable: z.number().int(),
    outOfOrder: z.number().int(),
    lastWeek: z.object({ occupied: z.number().int(), sellable: z.number().int() }),
  }),
  pendingVerification: z.object({
    count: z.number().int(),
    amount: money,
    stays: z.array(z.object({ stayId: id, title: z.string() })),
  }),
  forecast: z.array(
    z.object({
      unitTypeName: z.string(),
      nights: z.array(z.object({ date: localDate, occupied: z.number().int(), sellable: z.number().int() })),
    }),
  ),
});
export type OverviewView = z.infer<typeof overviewView>;
