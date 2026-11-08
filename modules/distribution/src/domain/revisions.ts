/**
 * Inbound booking revisions (pure): the hub-neutral revision model, revision ordering, the processing decision
 * (apply / wait / park) and the translation into the reservations module's canonical channel booking.
 */
import { canonicalJson, type LocalDate, sha256Hex } from '@portico/kernel';

/** A booking revision as delivered by a hub, normalized by the hub adapter (no card data, ever). */
export interface HubRevision {
  revisionId: string;
  bookingId: string;
  externalPropertyId: string;
  status: 'new' | 'modified' | 'cancelled';
  /** When the hub recorded the revision (ISO); orders revisions of one booking. Null when the hub omits it. */
  insertedAt: string | null;
  /**
   * The hub's own ordinal of the revision within its booking, when the hub gives one. No such attribute is verified
   * for Channex (WIRE_FACTS `revisions.ordering`), so its adapter leaves it out; the order uses it when present.
   */
  hubSequence?: number | null;
  otaName: string | null;
  otaReservationCode: string | null;
  currency: string;
  customer: {
    firstName: string | null;
    lastName: string | null;
    email: string | null;
    phone: string | null;
    country: string | null;
  } | null;
  rooms: HubRoom[];
  notes: string | null;
  /** Who collects payment: the property (hotel-collect) or the OTA (prepaid / virtual card). */
  paymentCollect: 'property' | 'ota' | null;
}

export interface HubRoom {
  /** Stable reference of the room inside the booking (modifications are matched by it). */
  roomRef: string;
  channelRoomTypeId: string | null;
  channelRatePlanId: string | null;
  checkin: LocalDate;
  checkout: LocalDate;
  adults: number;
  childrenAges: number[];
  nightly: Array<{ date: LocalDate; amountMinor: number }>;
}

export function revisionHash(r: HubRevision): string {
  return sha256Hex(canonicalJson(r));
}

/**
 * Lifecycle meaning orders revisions the hub's clock cannot separate: a creation precedes its changes and a
 * cancellation ends them (P1-2). Never a hash.
 */
export const LIFECYCLE_RANK: Record<HubRevision['status'], number> = { new: 0, modified: 1, cancelled: 2 };

const TS =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:[.,](\d{1,9}))?\s*(Z|[+-]\d{2}(?::?\d{2})?)?$/i;

/**
 * The hub's revision timestamp as integer MICROSECONDS since the epoch, UTC (P1-2). The whole fractional part is kept
 * to the microsecond (`Date.parse` keeps milliseconds only: `.123456` and `.123999` would compare equal), and a
 * timestamp without a zone is read as UTC, never as the server's local time. Null when absent or unreadable. The
 * field's name, precision and zone at Channex are unverified (WIRE_FACTS `revisions.ordering`).
 */
export function hubMicrosOf(ts: string | null | undefined): number | null {
  if (!ts) return null;
  const m = TS.exec(ts.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, s, frac, zone] = m;
  const ms = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s));
  if (!Number.isFinite(ms)) return null;
  const check = new Date(ms);
  if (check.getUTCDate() !== Number(d) || check.getUTCHours() !== Number(h)) return null; // e.g. 2026-02-30
  const micros = Number((frac ?? '').padEnd(6, '0').slice(0, 6));
  let offsetMinutes = 0;
  if (zone && zone.toUpperCase() !== 'Z') {
    const sign = zone.startsWith('-') ? -1 : 1;
    const digits = zone.slice(1).replace(':', '');
    offsetMinutes = sign * (Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2, 4) || '0'));
  }
  return (ms - offsetMinutes * 60_000) * 1000 + micros;
}

/** What orders one revision among the revisions of its booking. */
export interface RevisionOrderKey {
  /** The hub's own ordinal for the revision, when it gives one (none is verified for Channex). */
  hubSequence: number | null;
  /** The hub's timestamp in microseconds (`hubMicrosOf`), when present and readable. */
  hubMicros: number | null;
  /** `LIFECYCLE_RANK` of the revision's status. */
  rank: number;
  /** Portico's arrival order (first stored first). */
  arrival: number;
}

export interface BookingRevision extends RevisionOrderKey {
  id: string;
  status: HubRevision['status'];
  state: 'received' | 'applied' | 'duplicate' | 'stale' | 'parked' | 'rejected' | 'failed';
  parkReason: 'orphan' | 'unmapped' | null;
}

/**
 * A total order over the revisions of ONE booking (P1-2), consistent with the hub's sequence: the hub's ordinal when
 * every revision has one; else a creation first; else the hub's timestamp when every revision has one and they
 * differ; else lifecycle meaning (modified < cancelled); else first arrival. A key component is used only when the whole booking has
 * it, so the order stays transitive when the hub sends some revisions without it.
 */
export function bookingComparator(all: readonly RevisionOrderKey[]) {
  const useSeq = all.every((r) => r.hubSequence !== null);
  const useTs = all.every((r) => r.hubMicros !== null);
  return (a: RevisionOrderKey, b: RevisionOrderKey): { cmp: number; byArrival: boolean } => {
    if (useSeq && a.hubSequence !== b.hubSequence)
      return { cmp: Math.sign((a.hubSequence ?? 0) - (b.hubSequence ?? 0)), byArrival: false };
    // A creation precedes every change of its booking, whatever the hub's clocks say (no change exists before it):
    // a skewed hub time can never make a creation "older news" than its own cancellation.
    if ((a.rank === 0) !== (b.rank === 0)) return { cmp: a.rank === 0 ? -1 : 1, byArrival: false };
    if (useTs && a.hubMicros !== b.hubMicros)
      return { cmp: Math.sign((a.hubMicros ?? 0) - (b.hubMicros ?? 0)), byArrival: false };
    if (a.rank !== b.rank) return { cmp: Math.sign(a.rank - b.rank), byArrival: false };
    return { cmp: Math.sign(a.arrival - b.arrival), byArrival: true };
  };
}

export interface OrderDecision {
  /** Earlier revisions of the booking that are not settled (the target waits for them). */
  earlierUnsettled: string[];
  /** A LATER revision of the booking is already applied: the target is older news (stale, never applied). */
  laterApplied: string | null;
  /** Revisions ordered against the target only by arrival (the hub could not separate them). */
  tiedByArrival: string[];
}

/**
 * Where a revision stands in its booking. A parked ORPHAN never counts as an earlier unsettled revision: it is parked
 * because the creation is missing, so a creation (or any revision) must never wait behind it — it is re-woken and
 * re-ordered when the booking exists (A4). An unmapped park is a real earlier revision (its booking is held).
 */
export function orderWithinBooking(
  target: BookingRevision,
  siblings: readonly BookingRevision[],
): OrderDecision {
  const others = siblings.filter((s) => s.id !== target.id);
  const cmp = bookingComparator([target, ...others]);
  const out: OrderDecision = { earlierUnsettled: [], laterApplied: null, tiedByArrival: [] };
  for (const o of others) {
    const c = cmp(o, target);
    if (c.byArrival) out.tiedByArrival.push(o.id);
    const unsettled =
      o.state === 'received' || o.state === 'failed' || (o.state === 'parked' && o.parkReason !== 'orphan');
    if (c.cmp < 0 && unsettled) out.earlierUnsettled.push(o.id);
    if (c.cmp > 0 && o.state === 'applied' && out.laterApplied === null) out.laterApplied = o.id;
  }
  return out;
}

export type ProcessingDecision =
  | { action: 'apply' }
  | { action: 'wait'; reason: string }
  | { action: 'park_orphan'; reason: string };

/**
 * DST-R09. A modification or cancellation can only be applied once Portico holds the booking it changes; otherwise
 * it is parked (state `parked`, reason `orphan`) and re-processed when the creation arrives, or by a recovery pull.
 * A revision also waits while an EARLIER revision of the same booking is not settled (ordered processing).
 */
export function decideProcessing(input: {
  channelStatus: HubRevision['status'];
  bookingKnown: boolean;
  earlierUnsettled: number;
}): ProcessingDecision {
  if (input.earlierUnsettled > 0) {
    return {
      action: 'wait',
      reason: `${input.earlierUnsettled} earlier revision(s) of this booking are not settled yet.`,
    };
  }
  if (input.channelStatus === 'new' || input.bookingKnown) return { action: 'apply' };
  return {
    action: 'park_orphan',
    reason:
      input.channelStatus === 'cancelled'
        ? 'A cancellation arrived for a booking Portico has not received yet.'
        : 'A modification arrived for a booking Portico has not received yet.',
  };
}

// ───────────────────────────── translation to the reservations canonical booking ─────────────────────────────

/** The reservations module's canonical channel booking (input shape of `ingestChannelBooking`). */
export interface ChannelBookingPayload {
  status: 'confirmed' | 'modified' | 'cancelled';
  propertyId: string;
  currency: string;
  booker: { firstName?: string; lastName: string; email?: string; phone?: string; nationality?: string };
  rooms: Array<{
    roomRef: string;
    unitTypeId: string;
    ratePlanId: string;
    arrival: LocalDate;
    departure: LocalDate;
    adults: number;
    childrenAges: number[];
    guests: Array<{ firstName?: string; lastName: string }>;
    nightlyPrices: Array<{ date: LocalDate; amountMinor: number }>;
    specialRequests: string[];
  }>;
  guarantee: { kind: 'prepaid_channel' | 'card' | 'agency' | 'none' };
  amountsIncludeTax: boolean;
  specialRequests: string[];
  notes?: string;
  marketSegment: string;
}

export interface MappingLookup {
  /** channel room type id → unit type id (active room mappings). */
  rooms: ReadonlyMap<string, string>;
  /** channel rate plan id → { unitTypeId, ratePlanId } (active rate mappings). */
  rates: ReadonlyMap<string, { unitTypeId: string; ratePlanId: string }>;
  /** Rate plan used for a mapped room whose channel rate plan is not mapped (EC-DST-005); null = park instead. */
  fallbackRatePlanId: string | null;
}

export interface UnmappedRoom {
  roomRef: string;
  channelRoomTypeId: string | null;
  channelRatePlanId: string | null;
  /** Best-matching Portico unit type for a provisional hold (null: flag the property total). */
  holdUnitTypeId: string | null;
  arrival: LocalDate;
  departure: LocalDate;
}

export type Translation =
  | {
      ok: true;
      payload: ChannelBookingPayload;
      /** Rooms applied with the fallback rate plan (a mapping discrepancy is raised for each). */
      fallbackRooms: string[];
    }
  | { ok: false; unmapped: UnmappedRoom[] };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const COUNTRY = /^[A-Z]{2}$/;
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) : s);

/** Placeholder surname when a hub omits it (the reservations contract requires one); flagged in the notes. */
export const MISSING_SURNAME = 'Channel guest';

export function translateRevision(
  rev: HubRevision,
  input: { propertyId: string; amountsIncludeTax: boolean; mapping: MappingLookup },
): Translation {
  const unmapped: UnmappedRoom[] = [];
  const fallbackRooms: string[] = [];
  const rooms: ChannelBookingPayload['rooms'] = [];
  for (const room of rev.rooms) {
    const rate = room.channelRatePlanId ? input.mapping.rates.get(room.channelRatePlanId) : undefined;
    const roomType = room.channelRoomTypeId ? input.mapping.rooms.get(room.channelRoomTypeId) : undefined;
    let unitTypeId: string | undefined;
    let ratePlanId: string | undefined;
    if (rate && (!roomType || roomType === rate.unitTypeId)) {
      unitTypeId = rate.unitTypeId;
      ratePlanId = rate.ratePlanId;
    } else if (roomType && !rate && input.mapping.fallbackRatePlanId) {
      unitTypeId = roomType;
      ratePlanId = input.mapping.fallbackRatePlanId;
      fallbackRooms.push(room.roomRef);
    }
    if (!unitTypeId || !ratePlanId) {
      unmapped.push({
        roomRef: room.roomRef,
        channelRoomTypeId: room.channelRoomTypeId,
        channelRatePlanId: room.channelRatePlanId,
        holdUnitTypeId: roomType ?? rate?.unitTypeId ?? null,
        arrival: room.checkin,
        departure: room.checkout,
      });
      continue;
    }
    rooms.push({
      roomRef: clip(room.roomRef, 100),
      unitTypeId,
      ratePlanId,
      arrival: room.checkin,
      departure: room.checkout,
      adults: Math.min(20, Math.max(1, Math.floor(room.adults))),
      childrenAges: room.childrenAges.filter((a) => Number.isInteger(a) && a >= 0 && a <= 17),
      guests: [],
      nightlyPrices: room.nightly.map((n) => ({ date: n.date, amountMinor: n.amountMinor })),
      specialRequests: [],
    });
  }
  if (unmapped.length > 0) return { ok: false, unmapped };
  const c = rev.customer;
  const surname = c?.lastName?.trim() || c?.firstName?.trim() || '';
  const booker: ChannelBookingPayload['booker'] = { lastName: clip(surname || MISSING_SURNAME, 100) };
  if (c?.firstName?.trim() && c.lastName?.trim()) booker.firstName = clip(c.firstName.trim(), 100);
  if (c?.email && EMAIL.test(c.email.trim())) booker.email = c.email.trim();
  if (c?.phone?.trim()) booker.phone = clip(c.phone.trim(), 40);
  if (c?.country && COUNTRY.test(c.country.trim().toUpperCase()))
    booker.nationality = c.country.trim().toUpperCase();
  const noteParts = [
    rev.otaName ? `${rev.otaName}${rev.otaReservationCode ? ` ${rev.otaReservationCode}` : ''}` : null,
    surname ? null : 'Guest surname not supplied by the channel.',
    rev.notes,
  ].filter((x): x is string => !!x);
  const payload: ChannelBookingPayload = {
    status: rev.status === 'new' ? 'confirmed' : rev.status,
    propertyId: input.propertyId,
    currency: rev.currency,
    booker,
    rooms,
    guarantee: { kind: rev.paymentCollect === 'ota' ? 'prepaid_channel' : 'none' },
    amountsIncludeTax: input.amountsIncludeTax,
    specialRequests: rev.notes ? [clip(rev.notes, 500)] : [],
    marketSegment: 'ota',
  };
  if (noteParts.length) payload.notes = clip(noteParts.join(' · '), 2000);
  return { ok: true, payload, fallbackRooms };
}
