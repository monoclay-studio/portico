/**
 * PROVISIONAL contracts for the role workspaces whose modules are still being built in wave 1
 * (reservations, operations, inventory, rates, finance, payments). They follow the specs and the in-progress
 * module contracts as of 2026-11-07:
 *   - arrivals:      reservations `frontDeskRow` + RES-R35 readiness (assigned unit, condition, payment/guarantee,
 *                    documents, ETA & transfer, requests) + RES-R39 arrival details
 *   - housekeeping:  operations `boardRow` (OPS-R01..R10), readiness with an ESTIMATED ready time
 *   - timeline:      RES-R36 (units × nights; stays, unit blocks, holds)
 *   - change preview: glossary "Change preview" (availability, price, taxes, deposits, balance)
 * When the modules merge, replace these with imports from `@portico/<module>/contracts` and bind the HTTP
 * data source in src/data/sources.ts. Every payload here is validated, so the mock cannot drift silently.
 */
import { z } from 'zod';

const uuid = z.string().min(1);
const localDate = z.iso.date();
const isoDateTime = z.iso.datetime({ offset: true });
export const money = z.object({ amountMinor: z.number().int(), currency: z.string().regex(/^[A-Z]{3}$/) });
export type Money = z.infer<typeof money>;

export const provenance = z.enum(['live', 'simulated', 'copied', 'delayed', 'incomplete', 'external']);

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
export const unitCondition = z.enum(['dirty', 'cleaning', 'clean', 'inspected', 'failed_inspection']);
export const paymentStatus = z.enum([
  'not_required',
  'unpaid',
  'requested',
  'authorized',
  'pending_verification',
  'partially_paid',
  'paid',
  'failed',
  'refunded',
  'guaranteed',
]);

export const arrivalDetails = z.object({
  transportMode: z.enum(['seaplane', 'speedboat', 'domestic_flight', 'car', 'walk_in', 'other']),
  carrier: z.string().optional(),
  number: z.string().optional(),
  /** International leg into Velana International Airport (MLE), if known. */
  inbound: z.string().optional(),
  scheduledAt: isoDateTime.optional(),
  estimatedAt: isoDateTime.optional(),
  arrivalPoint: z.string().optional(),
  transferRequested: z.boolean(),
});

export const readinessCheckKey = z.enum([
  'unit_assigned',
  'unit_condition',
  'guarantee',
  'documents',
  'transfer',
  'requests',
]);
export const readinessCheck = z.object({
  key: readinessCheckKey,
  status: z.enum(['ok', 'blocking', 'attention', 'unknown']),
  message: z.string(),
});
export const readinessView = z.object({
  ready: z.boolean(),
  checks: z.array(readinessCheck),
  /** The single most important thing to clear before this guest can check in. */
  blockingReason: z
    .object({ key: readinessCheckKey, message: z.string(), owner: z.string().nullable() })
    .nullable(),
});
export type ReadinessView = z.infer<typeof readinessView>;
export type ReadinessCheck = z.infer<typeof readinessCheck>;

export const workflowStep = z.object({
  id: z.string(),
  label: z.string(),
  status: z.enum(['done', 'failed', 'pending', 'in_progress', 'skipped', 'pending_verification']),
  detail: z.string().optional(),
  error: z.string().optional(),
});

export const arrivalRow = z.object({
  stayId: uuid,
  bookingId: uuid,
  bookingCode: z.string(),
  bookingStatus,
  stayStatus,
  guestName: z.string(),
  vip: z.boolean(),
  arrival: localDate,
  departure: localDate,
  nights: z.number().int().positive(),
  unitTypeName: z.string(),
  unitId: uuid.nullable(),
  unitName: z.string().nullable(),
  unitCondition: unitCondition.nullable(),
  occupancy: z.object({ adults: z.number().int(), childrenAges: z.array(z.number().int()) }),
  eta: isoDateTime.nullable(),
  arrivalDetails,
  paymentStatus,
  balance: money,
  requests: z.array(z.string()),
  flags: z.array(z.string()),
  owner: z.string().nullable(),
  readiness: readinessView,
  checkInRun: z
    .object({
      status: z.enum(['not_started', 'in_progress', 'completed', 'abandoned']),
      steps: z.array(workflowStep),
    })
    .nullable(),
});
export type ArrivalRow = z.infer<typeof arrivalRow>;

export const housekeepingRow = z.object({
  unitId: uuid,
  unitNumber: z.string(),
  unitTypeName: z.string(),
  sectionName: z.string(),
  condition: unitCondition,
  occupancy: z.enum(['vacant', 'occupied']),
  discrepancy: z.enum(['none', 'skip', 'sleep']),
  dnd: z.boolean(),
  block: z.object({ kind: z.enum(['out_of_order', 'out_of_service']), reason: z.string() }).nullable(),
  arrival: z
    .object({ stayId: uuid, eta: isoDateTime.nullable(), vip: z.boolean(), guestLabel: z.string() })
    .nullable(),
  departureToday: z.boolean(),
  topPriority: z.enum(['low', 'normal', 'high', 'urgent']).nullable(),
  priorityReasons: z.array(z.string()),
  assigneeName: z.string().nullable(),
  /** ESTIMATE — always labelled as such in the UI. */
  expectedReadyAt: isoDateTime.nullable(),
});
export type HousekeepingRow = z.infer<typeof housekeepingRow>;

export const timelineUnit = z.object({
  unitId: uuid,
  unitNumber: z.string(),
  unitTypeName: z.string(),
  condition: unitCondition,
});
export const timelineItem = z.object({
  id: uuid,
  unitId: uuid,
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
  units: z.array(timelineUnit),
  items: z.array(timelineItem),
});
export type TimelineView = z.infer<typeof timelineView>;
export type TimelineItemView = z.infer<typeof timelineItem>;

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
  stayId: uuid,
  title: z.string(),
  summary: z.string(),
  validUntil: isoDateTime,
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

/** Every simulated payload is wrapped so the UI can never forget to show where it came from. */
export interface Sourced<T> {
  data: T;
  provenance: z.infer<typeof provenance>;
  generatedAt: string;
  /** What produced it ("Simulator — reservations module not yet connected"). */
  source: string;
}
