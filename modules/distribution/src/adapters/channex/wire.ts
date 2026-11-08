/**
 * THE Channex wire mapping (the only file that knows Channex endpoint paths, headers and field names).
 *
 * Verification status of every fact (see WIRE_FACTS below and the module README "What is unverified about Channex"):
 *  - `v2`: confirmed on 2026-11-07 only from search-engine-indexed excerpts of docs.channex.io (direct fetches to
 *    docs.channex.io are blocked in this environment; research 04 §A8 has the same limitation).
 *  - `unverified`: our assumption. Encoded here and nowhere else, so the R4 staging run can confirm or correct it in
 *    one place.
 *  - `owner`: provided by the owner (20 ARI requests per minute).
 * Nothing here is "verified" against the live API: that needs the owner's Channex staging key (R4).
 */
import { addDays, currencyExponent, type LocalDate } from '@portico/kernel';
import { z } from 'zod';
import type { RestrictionValue, Run } from '../../domain/ari';
import type { HubRevision } from '../../domain/revisions';

export type FactStatus = 'v2' | 'unverified' | 'owner';

export const WIRE_FACTS: ReadonlyArray<{ id: string; fact: string; status: FactStatus; source: string }> = [
  {
    id: 'host.production',
    fact: 'Production API host secure.channex.io, path /api/v1',
    status: 'v2',
    source: 'docs.channex.io best-practices guide (search excerpt)',
  },
  {
    id: 'host.staging',
    fact: 'Staging API host staging.channex.io, path /api/v1',
    status: 'v2',
    source: 'docs.channex.io examples (search excerpt)',
  },
  {
    id: 'auth.header',
    fact: 'API key in request header `user-api-key`',
    status: 'v2',
    source: 'Channex Postman docs and OpenAPI listing (search excerpt)',
  },
  {
    id: 'ari.availability.endpoint',
    fact: 'POST /availability with body { values: [...] }',
    status: 'v2',
    source: 'Channex ARI OpenAPI listing (search excerpt)',
  },
  {
    id: 'ari.availability.fields',
    fact: 'Availability value has property_id, room_type_id, availability',
    status: 'v2',
    source: 'AvailabilityValue schema (search excerpt)',
  },
  {
    id: 'ari.availability.dates',
    fact: 'Availability value takes date_from / date_to, both INCLUSIVE',
    status: 'unverified',
    source: 'assumption',
  },
  {
    id: 'ari.restrictions.endpoint',
    fact: 'POST /restrictions with body { values: [...] } carrying property_id and rate_plan_id',
    status: 'v2',
    source: 'Channex ARI OpenAPI listing (search excerpt)',
  },
  {
    id: 'ari.restrictions.fields',
    fact: 'Restriction value fields rate, min_stay_arrival, min_stay_through, max_stay, closed_to_arrival, closed_to_departure, stop_sell',
    status: 'unverified',
    source: 'assumption',
  },
  {
    id: 'ari.rate.format',
    fact: 'rate sent as a decimal string in the rate plan currency ("250.00")',
    status: 'unverified',
    source: 'assumption',
  },
  {
    id: 'ari.restrictions.clear',
    fact: 'min stay 1 and max_stay 0 mean "no restriction"',
    status: 'unverified',
    source: 'assumption',
  },
  {
    id: 'ari.response',
    fact: '2xx answer { data: [{ id, type: "task" }], meta: { message, warnings } }; warnings carry the index of a refused value (partial acceptance)',
    status: 'unverified',
    source: 'assumption',
  },
  {
    id: 'ari.batching',
    fact: 'No limit on the number of values per message; a payload size cap exists; batch per property every 30–60 s; separate availability and restriction messages; a nightly full update',
    status: 'v2',
    source: 'PMS integration guide (search excerpt)',
  },
  {
    id: 'limits.ari',
    fact: '10 restriction/price requests and 10 availability requests per minute per property (20 ARI in total); HTTP 429 when exceeded; pause one minute after an error',
    status: 'v2',
    source: 'Rate limits page (search excerpt); a "coming soon" page says 5 per minute',
  },
  {
    id: 'limits.owner',
    fact: '20 ARI requests per minute',
    status: 'owner',
    source: 'owner direction 2026-11-07',
  },
  {
    id: 'limits.retry_after',
    fact: 'HTTP 429 carries Retry-After',
    status: 'unverified',
    source: 'assumption (honoured when present)',
  },
  {
    id: 'revisions.feed',
    fact: 'GET /booking_revisions/feed returns NOT acknowledged revisions; filter[property_id]; order[inserted_at]=asc',
    status: 'v2',
    source: 'bookings collection + best-practices guide (search excerpt)',
  },
  {
    id: 'revisions.ack',
    fact: 'POST /booking_revisions/:id/ack acknowledges a revision (one wrapper lists PUT)',
    status: 'v2',
    source: 'bookings collection (search excerpt)',
  },
  {
    id: 'revisions.get',
    fact: 'GET /booking_revisions/:id returns one revision',
    status: 'v2',
    source: 'webhook collection: PMS pulls booking_revisions/:id then acks (search excerpt)',
  },
  {
    id: 'revisions.unacked',
    fact: 'An unacknowledged revision stays in the feed; after 30 minutes Channex e-mails a warning',
    status: 'v2',
    source: 'bookings collection (search excerpt)',
  },
  {
    id: 'revisions.status',
    fact: 'Revision status is new, modified or cancelled',
    status: 'v2',
    source: 'webhook collection (search excerpt)',
  },
  {
    id: 'revisions.shape',
    fact: 'JSON:API envelope { data: { id, type, attributes } }; attributes booking_id, property_id, status, inserted_at, ota_name, ota_reservation_code, currency, customer { name, surname, mail, phone, country }, notes, payment_collect, rooms[] { room_type_id, rate_plan_id, checkin_date, checkout_date, occupancy { adults, children, infants, ages }, days { date: "100.00" } }',
    status: 'unverified',
    source: 'assumption',
  },
  {
    id: 'revisions.ordering',
    fact: 'Revisions of one booking are ordered by attribute `inserted_at` (ISO 8601; precision assumed up to microseconds; a value without a zone is read as UTC); no per-booking revision ordinal is known, so none is read. Where `inserted_at` cannot separate two revisions Portico orders by lifecycle (new < modified < cancelled), then by arrival, and flags two such changes for review',
    status: 'unverified',
    source:
      'assumption — R4: record inserted_at of a create/modify/cancel sequence made within one second; look for an ordinal attribute',
  },
  {
    id: 'revisions.ack_idempotent',
    fact: 'Acknowledging an already acknowledged revision succeeds',
    status: 'unverified',
    source: 'assumption',
  },
  {
    id: 'bookings.since',
    fact: 'GET /bookings?filter[property_id]=…&filter[inserted_at][gte]=… lists bookings since T',
    status: 'unverified',
    source: 'assumption (filter syntax as on GET /availability)',
  },
  {
    id: 'webhook.fields',
    fact: 'Webhook config callback_url, event_mask ("booking" or "*"), headers (for authentication), send_data (default false), is_active',
    status: 'v2',
    source: 'webhook collection (search excerpt)',
  },
  {
    id: 'webhook.auth',
    fact: 'Channex does not sign webhooks; authentication is a secret header we configure in `headers`',
    status: 'unverified',
    source: 'search excerpt shows only `headers` (e.g. Basic auth); no signature documented',
  },
  {
    id: 'webhook.body',
    fact: 'Body { event, property_id, user_id, payload }; with send_data=false only event, user_id and property_id',
    status: 'v2',
    source: 'webhook collection (search excerpt)',
  },
  {
    id: 'webhook.payload',
    fact: 'With send_data=true, payload carries the revision attributes (as in the feed) or at least revision_id / booking_id',
    status: 'unverified',
    source: 'assumption',
  },
  {
    id: 'webhook.events',
    fact: 'Booking event names booking, booking_new, booking_modification, booking_cancellation',
    status: 'unverified',
    source: 'booking_new is in the docs excerpt; the others are assumed',
  },
  {
    id: 'property.get',
    fact: 'GET /properties/:id shows a property the key can access (credential test)',
    status: 'unverified',
    source: 'assumption',
  },
];

export const CHANNEX_HOSTS = { production: 'secure.channex.io', staging: 'staging.channex.io' } as const;
export const CHANNEX_BASE_PATH = '/api/v1';
export const CHANNEX_AUTH_HEADER = 'user-api-key';
/** Header we ask Channex to send with every webhook (configured in the webhook's `headers`). */
export const WEBHOOK_TOKEN_HEADER = 'x-portico-webhook-token';
/** Optional HMAC header (only for a signing proxy in front of Portico, or if Channex ever signs). */
export const WEBHOOK_SIGNATURE_HEADER = 'x-portico-signature';

export const DEFAULT_LIMITS = { availabilityPerMinute: 10, restrictionsPerMinute: 10 } as const;

export const PATHS = {
  availability: '/availability',
  restrictions: '/restrictions',
  feed: '/booking_revisions/feed',
  revision: (id: string) => `/booking_revisions/${encodeURIComponent(id)}`,
  ack: (id: string) => `/booking_revisions/${encodeURIComponent(id)}/ack`,
  property: (id: string) => `/properties/${encodeURIComponent(id)}`,
  webhooks: '/webhooks',
  bookings: '/bookings',
} as const;

// ───────────────────────────── money and dates ─────────────────────────────

/** Minor units → decimal string with the currency's exponent ("25000" USD → "250.00"). */
export function toDecimalString(amountMinor: number, currency: string): string {
  const exp = currencyExponent(currency);
  const neg = amountMinor < 0;
  const digits = Math.abs(Math.trunc(amountMinor))
    .toString()
    .padStart(exp + 1, '0');
  const whole = exp === 0 ? digits : digits.slice(0, -exp);
  const frac = exp === 0 ? '' : `.${digits.slice(-exp)}`;
  return `${neg ? '-' : ''}${whole}${frac}`;
}

/** Decimal string or number → minor units, exact (no floats); null when not a valid amount. */
export function fromDecimal(value: unknown, currency: string): number | null {
  const s = typeof value === 'number' ? value.toString() : typeof value === 'string' ? value.trim() : '';
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(s);
  if (!m) return null;
  const exp = currencyExponent(currency);
  const frac = (m[3] ?? '').padEnd(exp, '0');
  if (frac.length > exp && /[1-9]/.test(frac.slice(exp))) return null; // more precision than the currency has
  const minor = Number(`${m[2]}${frac.slice(0, exp)}`);
  if (!Number.isSafeInteger(minor)) return null;
  return m[1] === '-' ? -minor : minor;
}

/** Half-open run [from, to) → inclusive date_to (unverified assumption: Channex date_to is inclusive). */
export const inclusiveTo = (to: LocalDate): LocalDate => addDays(to, -1);

// ───────────────────────────── ARI requests ─────────────────────────────

export interface AvailabilityRun {
  channelRoomTypeId: string;
  run: Run<{ availability: number }>;
}
export interface RestrictionRun {
  channelRatePlanId: string;
  run: Run<RestrictionValue>;
}

export function availabilityBody(externalPropertyId: string, runs: readonly AvailabilityRun[]) {
  return {
    values: runs.map((r) => ({
      property_id: externalPropertyId,
      room_type_id: r.channelRoomTypeId,
      date_from: r.run.from,
      date_to: inclusiveTo(r.run.to),
      availability: r.run.value.availability,
    })),
  };
}

export function restrictionsBody(externalPropertyId: string, runs: readonly RestrictionRun[]) {
  return {
    values: runs.map((r) => {
      const v = r.run.value;
      return {
        property_id: externalPropertyId,
        rate_plan_id: r.channelRatePlanId,
        date_from: r.run.from,
        date_to: inclusiveTo(r.run.to),
        ...(v.rateMinor !== null && v.currency ? { rate: toDecimalString(v.rateMinor, v.currency) } : {}),
        min_stay_arrival: v.minStayArrival ?? 1,
        min_stay_through: v.minStayThrough ?? 1,
        max_stay: v.maxStay ?? 0,
        closed_to_arrival: v.closedToArrival,
        closed_to_departure: v.closedToDeparture,
        stop_sell: v.stopSell,
      };
    }),
  };
}

const warning = z
  .object({
    index: z.number().int().nonnegative().optional(),
    warning: z.unknown().optional(),
    message: z.unknown().optional(),
  })
  .loose();
const ariSuccess = z
  .object({
    data: z.array(z.object({ id: z.string().optional() }).loose()).optional(),
    meta: z
      .object({ message: z.string().optional(), warnings: z.array(warning).optional() })
      .loose()
      .optional(),
  })
  .loose();

/** Parse a 2xx ARI answer: task ids and the values the hub refused (partial acceptance). */
export function parseAriSuccess(body: string): {
  taskIds: string[];
  refused: Array<{ index: number; message: string }>;
  unrecognized: boolean;
} {
  let json: unknown;
  try {
    json = body ? JSON.parse(body) : {};
  } catch {
    return { taskIds: [], refused: [], unrecognized: true };
  }
  const p = ariSuccess.safeParse(json);
  if (!p.success) return { taskIds: [], refused: [], unrecognized: true };
  const refused: Array<{ index: number; message: string }> = [];
  for (const w of p.data.meta?.warnings ?? []) {
    if (w.index === undefined) continue;
    const text =
      typeof w.warning === 'string'
        ? w.warning
        : typeof w.message === 'string'
          ? w.message
          : JSON.stringify(w.warning ?? w.message ?? 'refused');
    refused.push({ index: w.index, message: text.slice(0, 500) });
  }
  return { taskIds: (p.data.data ?? []).flatMap((d) => (d.id ? [d.id] : [])), refused, unrecognized: false };
}

/** Best-effort error text from a non-2xx answer (shape unverified). */
export function errorText(body: string): string {
  try {
    const j = JSON.parse(body) as {
      errors?: { title?: unknown; details?: unknown; code?: unknown } | unknown[];
    };
    const e = Array.isArray(j.errors) ? j.errors[0] : j.errors;
    if (e && typeof e === 'object') {
      const o = e as { title?: unknown; details?: unknown; code?: unknown };
      const parts = [
        o.code,
        o.title,
        typeof o.details === 'string' ? o.details : o.details ? JSON.stringify(o.details) : null,
      ]
        .filter((x) => x !== undefined && x !== null)
        .map(String);
      if (parts.length) return parts.join(': ').slice(0, 500);
    }
  } catch {
    // not JSON
  }
  return body.slice(0, 200) || 'no details';
}

// ───────────────────────────── booking revisions ─────────────────────────────

const str = z.string().min(1);
const optStr = z.string().nullish();
const amount = z.union([z.string(), z.number()]);

export const revisionAttributes = z
  .object({
    id: str.optional(),
    booking_id: str,
    property_id: str,
    status: z.enum(['new', 'modified', 'cancelled']),
    inserted_at: optStr,
    ota_name: optStr,
    ota_reservation_code: optStr,
    currency: z.string().regex(/^[A-Z]{3}$/),
    notes: optStr,
    payment_collect: z.enum(['property', 'ota']).nullish(),
    customer: z
      .object({ name: optStr, surname: optStr, mail: optStr, phone: optStr, country: optStr })
      .loose()
      .nullish(),
    rooms: z
      .array(
        z
          .object({
            room_type_id: optStr,
            rate_plan_id: optStr,
            checkin_date: z.iso.date(),
            checkout_date: z.iso.date(),
            occupancy: z
              .object({
                adults: z.number().int().min(0).max(50),
                children: z.number().int().min(0).max(50).nullish(),
                infants: z.number().int().min(0).max(50).nullish(),
                ages: z.array(z.number().int().min(0).max(17)).nullish(),
              })
              .loose(),
            days: z.record(z.iso.date(), amount).nullish(),
          })
          .loose(),
      )
      .min(1),
  })
  .loose();
export type RevisionAttributes = z.infer<typeof revisionAttributes>;

const revisionEnvelope = z.object({ id: str, type: z.string().optional(), attributes: z.unknown() }).loose();

export class WireParseError extends Error {
  constructor(
    message: string,
    readonly issues: string[],
  ) {
    super(message);
    this.name = 'WireParseError';
  }
}

/** Channex revision (envelope id + attributes) → hub-neutral revision. Card or guarantee fields are never read. */
export function toHubRevision(envelopeId: string, raw: unknown): HubRevision {
  const p = revisionAttributes.safeParse(raw);
  if (!p.success) {
    throw new WireParseError(
      'The booking revision could not be read.',
      p.error.issues.slice(0, 10).map((i) => `${i.path.join('.')}: ${i.message}`),
    );
  }
  const a = p.data;
  const rooms = a.rooms.map((r, i) => {
    const nightly: Array<{ date: LocalDate; amountMinor: number }> = [];
    for (const [date, value] of Object.entries(r.days ?? {})) {
      const minor = fromDecimal(value, a.currency);
      if (minor === null) {
        throw new WireParseError('A nightly price could not be read.', [
          `rooms.${i}.days.${date}: ${String(value)}`,
        ]);
      }
      nightly.push({ date, amountMinor: minor });
    }
    nightly.sort((x, y) => (x.date < y.date ? -1 : 1));
    const ages = r.occupancy.ages ?? [];
    return {
      roomRef: String(i + 1),
      channelRoomTypeId: r.room_type_id ?? null,
      channelRatePlanId: r.rate_plan_id ?? null,
      checkin: r.checkin_date,
      checkout: r.checkout_date,
      adults: r.occupancy.adults,
      childrenAges: ages,
      nightly,
    };
  });
  return {
    revisionId: envelopeId,
    bookingId: a.booking_id,
    externalPropertyId: a.property_id,
    status: a.status,
    // Ordering (WIRE_FACTS `revisions.ordering`, unverified): kept as sent; read to the microsecond, zone-less = UTC.
    insertedAt: a.inserted_at ?? null,
    otaName: a.ota_name ?? null,
    otaReservationCode: a.ota_reservation_code ?? null,
    currency: a.currency,
    customer: a.customer
      ? {
          firstName: a.customer.name ?? null,
          lastName: a.customer.surname ?? null,
          email: a.customer.mail ?? null,
          phone: a.customer.phone ?? null,
          country: a.customer.country ?? null,
        }
      : null,
    rooms,
    notes: a.notes ?? null,
    paymentCollect: a.payment_collect ?? null,
  };
}

const feedBody = z
  .object({
    data: z.array(revisionEnvelope),
    meta: z
      .object({ page: z.number().optional(), limit: z.number().optional(), total: z.number().optional() })
      .loose()
      .optional(),
  })
  .loose();

export function parseFeed(body: string): {
  items: Array<{ id: string; attributes: unknown }>;
  page: number | null;
  limit: number | null;
  total: number | null;
} {
  const p = feedBody.safeParse(JSON.parse(body));
  if (!p.success)
    throw new WireParseError(
      'The revision feed could not be read.',
      p.error.issues.map((i) => i.message),
    );
  return {
    items: p.data.data.map((d) => ({ id: d.id, attributes: d.attributes })),
    page: p.data.meta?.page ?? null,
    limit: p.data.meta?.limit ?? null,
    total: p.data.meta?.total ?? null,
  };
}

export function parseSingleRevision(body: string): { id: string; attributes: unknown } {
  const p = z.object({ data: revisionEnvelope }).loose().safeParse(JSON.parse(body));
  if (!p.success)
    throw new WireParseError(
      'The booking revision could not be read.',
      p.error.issues.map((i) => i.message),
    );
  return { id: p.data.data.id, attributes: p.data.data.attributes };
}

export function feedQuery(externalPropertyId: string, page: number): string {
  const q = new URLSearchParams();
  q.set('filter[property_id]', externalPropertyId);
  q.set('order[inserted_at]', 'asc');
  q.set('pagination[page]', String(page));
  return q.toString();
}

export function bookingsSinceQuery(externalPropertyId: string, since: string, page: number): string {
  const q = new URLSearchParams();
  q.set('filter[property_id]', externalPropertyId);
  q.set('filter[inserted_at][gte]', since);
  q.set('pagination[page]', String(page));
  return q.toString();
}

const bookingsBody = z
  .object({
    data: z.array(
      z
        .object({
          id: str,
          attributes: z.object({ revision_id: optStr, inserted_at: optStr }).loose().optional(),
        })
        .loose(),
    ),
    meta: z.object({ total: z.number().optional(), limit: z.number().optional() }).loose().optional(),
  })
  .loose();

export function parseBookings(body: string): {
  items: Array<{ bookingId: string; latestRevisionId: string | null }>;
  total: number | null;
  limit: number | null;
} {
  const p = bookingsBody.safeParse(JSON.parse(body));
  if (!p.success)
    throw new WireParseError(
      'The booking list could not be read.',
      p.error.issues.map((i) => i.message),
    );
  return {
    items: p.data.data.map((d) => ({ bookingId: d.id, latestRevisionId: d.attributes?.revision_id ?? null })),
    total: p.data.meta?.total ?? null,
    limit: p.data.meta?.limit ?? null,
  };
}

// ───────────────────────────── webhooks ─────────────────────────────

export function webhookRegistration(input: {
  externalPropertyId: string;
  callbackUrl: string;
  token: string;
}) {
  return {
    webhook: {
      property_id: input.externalPropertyId,
      callback_url: input.callbackUrl,
      event_mask: 'booking',
      headers: { [WEBHOOK_TOKEN_HEADER]: input.token },
      request_params: {},
      is_active: true,
      send_data: true,
    },
  };
}

const webhookBody = z
  .object({
    event: z.string().min(1).max(100),
    property_id: str,
    user_id: z.string().nullish(),
    timestamp: optStr,
    payload: z.unknown().optional(),
  })
  .loose();

export type WebhookNotice = {
  event: string;
  externalPropertyId: string;
  isBookingEvent: boolean;
  /** Present when the webhook carried the revision itself (send_data = true). */
  revision: HubRevision | null;
  /** Present when the webhook named the revision without carrying it. */
  revisionId: string | null;
};

const BOOKING_EVENTS = new Set(['booking', 'booking_new', 'booking_modification', 'booking_cancellation']);

export function parseWebhook(rawBody: string): WebhookNotice {
  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    throw new WireParseError('The notification is not JSON.', []);
  }
  const p = webhookBody.safeParse(json);
  if (!p.success)
    throw new WireParseError(
      'The notification could not be read.',
      p.error.issues.map((i) => i.message),
    );
  const w = p.data;
  const isBookingEvent = BOOKING_EVENTS.has(w.event);
  let revision: HubRevision | null = null;
  let revisionId: string | null = null;
  if (isBookingEvent && w.payload && typeof w.payload === 'object') {
    const payload = w.payload as Record<string, unknown>;
    const id =
      typeof payload.revision_id === 'string'
        ? payload.revision_id
        : typeof payload.id === 'string'
          ? payload.id
          : null;
    revisionId = id;
    if (id && Array.isArray(payload.rooms)) revision = toHubRevision(id, payload);
  }
  return { event: w.event, externalPropertyId: w.property_id, isBookingEvent, revision, revisionId };
}
