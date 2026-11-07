/**
 * Channex API simulator (pure state machine over a serializable state). It answers the same HTTP requests the
 * adapter sends to Channex, with its OWN reading of the request format (literal field names below, not the
 * adapter's builders), keeps the resulting calendar so tests can assert the final channel state, generates booking
 * revisions and the webhooks announcing them, and injects faults:
 *   429 (and real per-minute limits), 5xx, outages, timeouts (before or after applying), unauthorized keys,
 *   bad requests, partial acceptance, duplicate and out-of-order webhook deliveries, revisions for unknown bookings.
 * It encodes the same unverified assumptions as `wire.ts` (WIRE_FACTS); only the R4 staging run can confirm them.
 */
import { randomUUID } from 'node:crypto';

export type SimEndpoint =
  | 'availability'
  | 'restrictions'
  | 'feed'
  | 'revision'
  | 'ack'
  | 'property'
  | 'webhooks'
  | 'bookings';

export type SimFaultKind =
  | 'rate_limit'
  | 'server_error'
  | 'timeout'
  | 'timeout_after_apply'
  | 'partial_acceptance'
  | 'unauthorized'
  | 'bad_request';

export interface SimRestriction {
  rate: string | null;
  min_stay_arrival: number;
  min_stay_through: number;
  max_stay: number;
  closed_to_arrival: boolean;
  closed_to_departure: boolean;
  stop_sell: boolean;
}

export interface SimRevision {
  id: string;
  booking_id: string;
  status: 'new' | 'modified' | 'cancelled';
  inserted_at: string;
  attributes: Record<string, unknown>;
  acked: boolean;
  ack_count: number;
}

export interface SimState {
  v: 1;
  propertyId: string;
  title: string;
  apiKey: string;
  roomTypes: string[];
  ratePlans: Array<{ id: string; roomTypeId: string; minRate: string | null }>;
  limits: { availabilityPerMinute: number; restrictionsPerMinute: number };
  log: Array<{ at: string; endpoint: SimEndpoint | 'unknown'; status: number; values?: number }>;
  availability: Record<string, Record<string, number>>;
  restrictions: Record<string, Record<string, SimRestriction>>;
  revisions: SimRevision[];
  webhook: {
    callbackUrl: string;
    headers: Record<string, string>;
    sendData: boolean;
    active: boolean;
  } | null;
  faults: Array<{ endpoint: SimEndpoint | 'any'; kind: SimFaultKind; remaining: number }>;
  outageUntil: string | null;
  seq: number;
}

export interface SimRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
}

export interface SimResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

export type SimOutcome = { kind: 'response'; response: SimResponse } | { kind: 'timeout'; applied: boolean };

const LOG_CAP = 5000;
const json = (status: number, body: unknown, headers: Record<string, string> = {}): SimOutcome => ({
  kind: 'response',
  response: {
    status,
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  },
});
const errorBody = (code: string, title: string) => ({ errors: { code, title } });

export function newSimState(input: {
  propertyId?: string;
  title?: string;
  apiKey?: string;
  roomTypes: string[];
  ratePlans: Array<{ id: string; roomTypeId: string; minRate?: string | null }>;
  limits?: { availabilityPerMinute: number; restrictionsPerMinute: number };
}): SimState {
  return {
    v: 1,
    propertyId: input.propertyId ?? randomUUID(),
    title: input.title ?? 'Simulated Channex property',
    apiKey: input.apiKey ?? `sim_${randomUUID().replace(/-/g, '')}`,
    roomTypes: [...input.roomTypes],
    ratePlans: input.ratePlans.map((r) => ({
      id: r.id,
      roomTypeId: r.roomTypeId,
      minRate: r.minRate ?? null,
    })),
    limits: input.limits ?? { availabilityPerMinute: 10, restrictionsPerMinute: 10 },
    log: [],
    availability: {},
    restrictions: {},
    revisions: [],
    webhook: null,
    faults: [],
    outageUntil: null,
    seq: 0,
  };
}

function route(method: string, path: string): { endpoint: SimEndpoint; id?: string } | null {
  const p = path.replace(/^\/api\/v1/, '');
  if (method === 'POST' && p === '/availability') return { endpoint: 'availability' };
  if (method === 'POST' && p === '/restrictions') return { endpoint: 'restrictions' };
  if (method === 'GET' && p === '/booking_revisions/feed') return { endpoint: 'feed' };
  let m = /^\/booking_revisions\/([^/]+)\/ack$/.exec(p);
  if (method === 'POST' && m) return { endpoint: 'ack', id: decodeURIComponent(m[1] as string) };
  m = /^\/booking_revisions\/([^/]+)$/.exec(p);
  if (method === 'GET' && m) return { endpoint: 'revision', id: decodeURIComponent(m[1] as string) };
  m = /^\/properties\/([^/]+)$/.exec(p);
  if (method === 'GET' && m) return { endpoint: 'property', id: decodeURIComponent(m[1] as string) };
  if (method === 'POST' && p === '/webhooks') return { endpoint: 'webhooks' };
  if (method === 'GET' && p === '/bookings') return { endpoint: 'bookings' };
  return null;
}

function addDaysIso(d: string, n: number): string {
  const t = new Date(`${d}T00:00:00Z`).getTime() + n * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

function eachInclusive(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to && out.length <= 800; d = addDaysIso(d, 1)) out.push(d);
  return out;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DECIMAL = /^\d+(\.\d{1,2})?$/;

function log(state: SimState, at: Date, endpoint: SimEndpoint | 'unknown', status: number, values?: number) {
  state.log.push({ at: at.toISOString(), endpoint, status, ...(values !== undefined ? { values } : {}) });
  if (state.log.length > LOG_CAP) state.log.splice(0, state.log.length - LOG_CAP);
}

function revisionView(r: SimRevision) {
  return { id: r.id, type: 'booking_revision', attributes: { ...r.attributes, id: r.id } };
}

/** Handle one API request against the simulated property. Mutates `state`. */
export function handleRequest(state: SimState, req: SimRequest, now: Date): SimOutcome {
  const url = new URL(req.url);
  const r = route(req.method.toUpperCase(), url.pathname);
  if (!r) {
    log(state, now, 'unknown', 404);
    return json(404, errorBody('not_found', `No route ${req.method} ${url.pathname}`));
  }
  const respond = (status: number, body: unknown, values?: number, headers?: Record<string, string>) => {
    log(state, now, r.endpoint, status, values);
    return json(status, body, headers);
  };
  if ((req.headers['user-api-key'] ?? '') !== state.apiKey) {
    return respond(401, errorBody('unauthorized', 'Unauthorized'));
  }
  if (state.outageUntil && now.getTime() < Date.parse(state.outageUntil)) {
    return respond(503, errorBody('service_unavailable', 'Service Unavailable'));
  }
  const fault = state.faults.find(
    (f) => f.remaining > 0 && (f.endpoint === 'any' || f.endpoint === r.endpoint),
  );
  let partial = false;
  let timeoutAfterApply = false;
  if (fault) {
    fault.remaining -= 1;
    state.faults = state.faults.filter((f) => f.remaining > 0);
    switch (fault.kind) {
      case 'rate_limit':
        return respond(429, errorBody('too_many_requests', 'Too Many Requests'), undefined, {
          'retry-after': '60',
        });
      case 'server_error':
        return respond(500, errorBody('internal_error', 'Internal Server Error'));
      case 'unauthorized':
        return respond(401, errorBody('unauthorized', 'Unauthorized'));
      case 'bad_request':
        return respond(422, errorBody('validation_error', 'Simulated validation error'));
      case 'timeout':
        log(state, now, r.endpoint, 0);
        return { kind: 'timeout', applied: false };
      case 'timeout_after_apply':
        timeoutAfterApply = true;
        break;
      case 'partial_acceptance':
        partial = true;
        break;
    }
  }
  // Real per-minute limits per property (requests refused for rate do not count).
  if (r.endpoint === 'availability' || r.endpoint === 'restrictions') {
    const limit =
      r.endpoint === 'availability' ? state.limits.availabilityPerMinute : state.limits.restrictionsPerMinute;
    const floor = now.getTime() - 60_000;
    const recent = state.log.filter(
      (l) => l.endpoint === r.endpoint && l.status !== 429 && Date.parse(l.at) > floor,
    ).length;
    if (recent >= limit) {
      return respond(429, errorBody('too_many_requests', 'Too Many Requests'), undefined, {
        'retry-after': '60',
      });
    }
  }
  const out = dispatch(state, r, req, url, partial, respond);
  if (timeoutAfterApply) return { kind: 'timeout', applied: true };
  return out;
}

function dispatch(
  state: SimState,
  r: { endpoint: SimEndpoint; id?: string },
  req: SimRequest,
  url: URL,
  partial: boolean,
  respond: (status: number, body: unknown, values?: number, headers?: Record<string, string>) => SimOutcome,
): SimOutcome {
  switch (r.endpoint) {
    case 'availability':
    case 'restrictions': {
      let body: { values?: unknown };
      try {
        body = JSON.parse(req.body ?? '') as { values?: unknown };
      } catch {
        return respond(422, errorBody('validation_error', 'Body is not JSON'));
      }
      if (!Array.isArray(body.values) || body.values.length === 0) {
        return respond(422, errorBody('validation_error', 'values must be a non-empty array'));
      }
      const warnings: Array<{ index: number; warning: string }> = [];
      body.values.forEach((raw, index) => {
        if (partial && index === (body.values as unknown[]).length - 1) {
          warnings.push({ index, warning: 'Simulated refusal of this value' });
          return;
        }
        const problem =
          r.endpoint === 'availability' ? applyAvailability(state, raw) : applyRestriction(state, raw);
        if (problem) warnings.push({ index, warning: problem });
      });
      return respond(
        200,
        {
          data: [{ id: randomUUID(), type: 'task' }],
          meta: { message: 'Success', warnings },
        },
        body.values.length,
      );
    }
    case 'feed': {
      const property = url.searchParams.get('filter[property_id]');
      const page = Math.max(1, Number(url.searchParams.get('pagination[page]') ?? '1') || 1);
      const limit = 10;
      const pending = state.revisions
        .filter((x) => !x.acked && (!property || property === state.propertyId))
        .sort((a, b) => (a.inserted_at < b.inserted_at ? -1 : 1));
      const slice = pending.slice((page - 1) * limit, page * limit);
      return respond(200, { data: slice.map(revisionView), meta: { page, limit, total: pending.length } });
    }
    case 'revision': {
      const rev = state.revisions.find((x) => x.id === r.id);
      return rev
        ? respond(200, { data: revisionView(rev) })
        : respond(404, errorBody('not_found', 'Not Found'));
    }
    case 'ack': {
      const rev = state.revisions.find((x) => x.id === r.id);
      if (!rev) return respond(404, errorBody('not_found', 'Not Found'));
      rev.acked = true;
      rev.ack_count += 1;
      return respond(200, { meta: { message: 'Success' } });
    }
    case 'property':
      return r.id === state.propertyId
        ? respond(200, {
            data: { id: state.propertyId, type: 'property', attributes: { title: state.title } },
          })
        : respond(404, errorBody('not_found', 'Not Found'));
    case 'webhooks': {
      let body: { webhook?: Record<string, unknown> };
      try {
        body = JSON.parse(req.body ?? '') as { webhook?: Record<string, unknown> };
      } catch {
        return respond(422, errorBody('validation_error', 'Body is not JSON'));
      }
      const w = body.webhook ?? {};
      if (typeof w.callback_url !== 'string' || w.property_id !== state.propertyId) {
        return respond(422, errorBody('validation_error', 'callback_url and property_id are required'));
      }
      const headers =
        w.headers && typeof w.headers === 'object'
          ? Object.fromEntries(
              Object.entries(w.headers as Record<string, unknown>).map(([k, v]) => [k, String(v)]),
            )
          : {};
      state.webhook = {
        callbackUrl: w.callback_url,
        headers,
        sendData: w.send_data === true,
        active: w.is_active !== false,
      };
      return respond(201, { data: { id: randomUUID(), type: 'webhook' } });
    }
    case 'bookings': {
      const since = url.searchParams.get('filter[inserted_at][gte]');
      const byBooking = new Map<string, SimRevision>();
      for (const rev of state.revisions) {
        if (since && rev.inserted_at < since) continue;
        const prev = byBooking.get(rev.booking_id);
        if (!prev || prev.inserted_at < rev.inserted_at) byBooking.set(rev.booking_id, rev);
      }
      const data = [...byBooking.values()].map((rev) => ({
        id: rev.booking_id,
        type: 'booking',
        attributes: { revision_id: rev.id, inserted_at: rev.inserted_at, status: rev.status },
      }));
      return respond(200, { data, meta: { total: data.length, limit: Math.max(1, data.length) } });
    }
  }
}

function applyAvailability(state: SimState, raw: unknown): string | null {
  const v = raw as Record<string, unknown>;
  if (v.property_id !== state.propertyId) return 'property_id does not match';
  if (typeof v.room_type_id !== 'string' || !state.roomTypes.includes(v.room_type_id))
    return 'unknown room_type_id';
  if (
    typeof v.date_from !== 'string' ||
    typeof v.date_to !== 'string' ||
    !DATE.test(v.date_from) ||
    !DATE.test(v.date_to) ||
    v.date_from > v.date_to
  ) {
    return 'invalid dates';
  }
  if (typeof v.availability !== 'number' || !Number.isInteger(v.availability) || v.availability < 0) {
    return 'availability must be a non-negative integer';
  }
  const cal = state.availability[v.room_type_id] ?? {};
  for (const d of eachInclusive(v.date_from, v.date_to)) cal[d] = v.availability;
  state.availability[v.room_type_id] = cal;
  return null;
}

function applyRestriction(state: SimState, raw: unknown): string | null {
  const v = raw as Record<string, unknown>;
  if (v.property_id !== state.propertyId) return 'property_id does not match';
  const plan = state.ratePlans.find((p) => p.id === v.rate_plan_id);
  if (!plan) return 'unknown rate_plan_id';
  if (
    typeof v.date_from !== 'string' ||
    typeof v.date_to !== 'string' ||
    !DATE.test(v.date_from) ||
    !DATE.test(v.date_to) ||
    v.date_from > v.date_to
  ) {
    return 'invalid dates';
  }
  if (v.rate !== undefined && (typeof v.rate !== 'string' || !DECIMAL.test(v.rate)))
    return 'rate must be a decimal string';
  if (typeof v.rate === 'string' && plan.minRate !== null && Number(v.rate) < Number(plan.minRate)) {
    return `rate is below the minimum of ${plan.minRate} for this rate plan`;
  }
  const cal = state.restrictions[plan.id] ?? {};
  for (const d of eachInclusive(v.date_from, v.date_to)) {
    const prev = cal[d];
    cal[d] = {
      rate: typeof v.rate === 'string' ? v.rate : (prev?.rate ?? null),
      min_stay_arrival:
        typeof v.min_stay_arrival === 'number' ? v.min_stay_arrival : (prev?.min_stay_arrival ?? 1),
      min_stay_through:
        typeof v.min_stay_through === 'number' ? v.min_stay_through : (prev?.min_stay_through ?? 1),
      max_stay: typeof v.max_stay === 'number' ? v.max_stay : (prev?.max_stay ?? 0),
      closed_to_arrival: v.closed_to_arrival === true,
      closed_to_departure: v.closed_to_departure === true,
      stop_sell: v.stop_sell === true,
    };
  }
  state.restrictions[plan.id] = cal;
  return null;
}

// ───────────────────────────── control (the "OTA side" of the simulator) ─────────────────────────────

export interface SimBookingInput {
  bookingId?: string;
  status: 'new' | 'modified' | 'cancelled';
  currency?: string;
  otaName?: string;
  otaReservationCode?: string;
  customer?: { name?: string; surname?: string; mail?: string; phone?: string; country?: string };
  notes?: string | null;
  paymentCollect?: 'property' | 'ota';
  rooms: Array<{
    roomTypeId: string | null;
    ratePlanId: string | null;
    checkin: string;
    checkout: string;
    adults: number;
    childrenAges?: number[];
    /** Price per night as a decimal string ("250.00"). */
    nightly: Record<string, string>;
  }>;
}

/** Record a booking revision at the hub (as if an OTA delivered it). Revisions get strictly increasing times. */
export function addRevision(state: SimState, input: SimBookingInput, now: Date): SimRevision {
  state.seq += 1;
  const id = randomUUID();
  const bookingId = input.bookingId ?? randomUUID();
  const insertedAt = new Date(now.getTime() + state.seq).toISOString();
  const rev: SimRevision = {
    id,
    booking_id: bookingId,
    status: input.status,
    inserted_at: insertedAt,
    acked: false,
    ack_count: 0,
    attributes: {
      booking_id: bookingId,
      property_id: state.propertyId,
      status: input.status,
      inserted_at: insertedAt,
      ota_name: input.otaName ?? 'Booking.com',
      ota_reservation_code: input.otaReservationCode ?? `SIM${state.seq.toString().padStart(6, '0')}`,
      currency: input.currency ?? 'USD',
      notes: input.notes ?? null,
      payment_collect: input.paymentCollect ?? 'ota',
      customer: input.customer ?? {
        name: 'Aiko',
        surname: 'Tanaka',
        mail: 'guest@example.com',
        country: 'JP',
      },
      rooms: input.rooms.map((room) => ({
        room_type_id: room.roomTypeId,
        rate_plan_id: room.ratePlanId,
        checkin_date: room.checkin,
        checkout_date: room.checkout,
        occupancy: {
          adults: room.adults,
          children: room.childrenAges?.length ?? 0,
          infants: 0,
          ages: room.childrenAges ?? [],
        },
        days: room.nightly,
      })),
      // A real hub may include card or guarantee fields; Portico never reads them (PCI).
      guarantee: { card_type: 'VI', card_number: '411111******1111' },
    },
  };
  state.revisions.push(rev);
  return rev;
}

export interface WebhookDelivery {
  callbackUrl: string;
  headers: Record<string, string>;
  rawBody: string;
  revisionId: string;
}

const EVENT_OF: Record<SimRevision['status'], string> = {
  new: 'booking_new',
  modified: 'booking_modification',
  cancelled: 'booking_cancellation',
};

/**
 * The webhook requests the hub would send for these revisions. Options model delivery faults: duplicates,
 * reversed order, notification-only bodies (send_data = false).
 */
export function webhookDeliveries(
  state: SimState,
  revisionIds: readonly string[],
  opts: { duplicate?: number; reverse?: boolean; notificationOnly?: boolean } = {},
  now: Date = new Date(),
): WebhookDelivery[] {
  if (!state.webhook?.active) return [];
  const sendData = state.webhook.sendData && !opts.notificationOnly;
  const one = (rev: SimRevision): WebhookDelivery => ({
    callbackUrl: state.webhook?.callbackUrl ?? '',
    headers: { 'content-type': 'application/json', ...(state.webhook?.headers ?? {}) },
    revisionId: rev.id,
    rawBody: JSON.stringify(
      sendData
        ? {
            event: EVENT_OF[rev.status],
            property_id: state.propertyId,
            user_id: null,
            timestamp: now.toISOString(),
            payload: { ...rev.attributes, id: rev.id, revision_id: rev.id },
          }
        : { event: EVENT_OF[rev.status], property_id: state.propertyId, user_id: null },
    ),
  });
  let list = revisionIds
    .map((id) => state.revisions.find((r) => r.id === id))
    .filter((r): r is SimRevision => r !== undefined)
    .map(one);
  if (opts.reverse) list = list.reverse();
  const copies = Math.max(1, (opts.duplicate ?? 0) + 1);
  return list.flatMap((d) => Array.from({ length: copies }, () => d));
}

/** Instants of EVERY request that reached an endpoint, whatever its answer (evidence for the rate-limit tests). */
export function requestInstants(state: SimState, endpoint: SimEndpoint): Date[] {
  return state.log.filter((l) => l.endpoint === endpoint).map((l) => new Date(l.at));
}
