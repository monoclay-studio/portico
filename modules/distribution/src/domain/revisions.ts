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
 * Order of a revision among the revisions of its booking: the hub's own timestamp (microsecond scale) plus a
 * deterministic tie-break from the revision id, so two revisions never share an order and redeliveries keep theirs.
 * Without a hub timestamp, the receipt time is used (and the revision is flagged).
 */
export function revisionOrderOf(revisionId: string, insertedAt: string | null, receivedAt: Date): number {
  const parsed = insertedAt ? Date.parse(insertedAt) : Number.NaN;
  const ms = Number.isFinite(parsed) ? parsed : receivedAt.getTime();
  const tie = Number.parseInt(sha256Hex(revisionId).slice(0, 6), 16) % 1000;
  return ms * 1000 + tie;
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
