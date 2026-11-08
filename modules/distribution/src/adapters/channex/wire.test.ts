import { describe, expect, it } from 'vitest';
import { channexAdapter } from './client';
import { addRevision, handleRequest, newSimState, webhookDeliveries } from './simulator';
import {
  availabilityBody,
  fromDecimal,
  parseAriSuccess,
  parseWebhook,
  restrictionsBody,
  toDecimalString,
  toHubRevision,
  WIRE_FACTS,
  WireParseError,
} from './wire';

const NOW = new Date('2026-11-07T06:00:00.000Z');

describe('wire mapping — money, dates, bodies', () => {
  it('converts minor units to decimal strings and back exactly (no floats)', () => {
    expect(toDecimalString(25000, 'USD')).toBe('250.00');
    expect(toDecimalString(5, 'USD')).toBe('0.05');
    expect(toDecimalString(12345, 'JPY')).toBe('12345');
    expect(toDecimalString(-150, 'USD')).toBe('-1.50');
    expect(fromDecimal('250.00', 'USD')).toBe(25000);
    expect(fromDecimal('0.1', 'USD')).toBe(10);
    expect(fromDecimal(99.5, 'USD')).toBe(9950);
    expect(fromDecimal('1.005', 'USD')).toBeNull(); // more precision than the currency: refused, never rounded silently
    expect(fromDecimal('1.000', 'USD')).toBe(100);
    expect(fromDecimal('abc', 'USD')).toBeNull();
  });
  it('builds availability and restriction values with inclusive date_to (unverified assumption)', () => {
    expect(
      availabilityBody('P', [
        {
          channelRoomTypeId: 'RT',
          run: { from: '2026-12-01', to: '2026-12-04', value: { availability: 2 } },
        },
      ]),
    ).toEqual({
      values: [
        {
          property_id: 'P',
          room_type_id: 'RT',
          date_from: '2026-12-01',
          date_to: '2026-12-03',
          availability: 2,
        },
      ],
    });
    const body = restrictionsBody('P', [
      {
        channelRatePlanId: 'RP',
        run: {
          from: '2026-12-01',
          to: '2026-12-02',
          value: {
            rateMinor: null,
            currency: null,
            stopSell: true,
            closedToArrival: false,
            closedToDeparture: false,
            minStayArrival: null,
            minStayThrough: 3,
            maxStay: null,
          },
        },
      },
    ]);
    expect(body.values[0]).not.toHaveProperty('rate');
    expect(body.values[0]).toMatchObject({
      stop_sell: true,
      min_stay_through: 3,
      min_stay_arrival: 1,
      max_stay: 0,
      date_to: '2026-12-01',
    });
  });
  it('reads partial acceptance from warnings and tolerates unknown answers', () => {
    expect(
      parseAriSuccess('{"data":[{"id":"t1"}],"meta":{"warnings":[{"index":1,"warning":"rate too low"}]}}', 2),
    ).toEqual({
      taskIds: ['t1'],
      refused: [{ index: 1, message: 'rate too low' }],
      unrecognized: false,
      why: null,
    });
    expect(parseAriSuccess('not json', 1).unrecognized).toBe(true);
  });
  it('P2-3 (B4 inverted): any answer that does not positively confirm acceptance is unrecognised, never accepted', () => {
    const unrecognised = [
      // a warning without an index (which value was refused?)
      '{"data":[{"id":"t1"}],"meta":{"warnings":[{"warning":"rate_plan_id is invalid"}]}}',
      // "errors" inside a 200
      '{"data":[{"id":"t1"}],"errors":{"code":"validation_error","title":"invalid"}}',
      '{"errors":{"code":"validation_error"}}',
      // nothing confirmed
      '{}',
      '',
      '[]',
      '{"data":[]}',
      '{"meta":{"message":"Success"}}',
      // an index outside the values sent, or not an integer
      '{"data":[{"id":"t1"}],"meta":{"warnings":[{"index":5,"warning":"x"}]}}',
      '{"data":[{"id":"t1"}],"meta":{"warnings":[{"index":-1,"warning":"x"}]}}',
      '{"data":[{"id":"t1"}],"meta":{"warnings":[{"index":"0","warning":"x"}]}}',
    ];
    for (const body of unrecognised) {
      const r = parseAriSuccess(body, 2);
      expect({ body, unrecognized: r.unrecognized, refused: r.refused }).toEqual({
        body,
        unrecognized: true,
        refused: [],
      });
      expect(r.why).toBeTruthy();
    }
    expect(
      parseAriSuccess('{"data":[{"id":"t1","type":"task"}],"meta":{"message":"Success","warnings":[]}}', 2),
    ).toMatchObject({
      unrecognized: false,
      refused: [],
    });
  });
  it('every wire fact carries a verification status; nothing claims to be verified against the live API', () => {
    expect(WIRE_FACTS.length).toBeGreaterThan(20);
    for (const f of WIRE_FACTS) expect(['v2', 'unverified', 'owner']).toContain(f.status);
    expect(WIRE_FACTS.find((f) => f.id === 'webhook.auth')?.status).toBe('unverified');
    expect(WIRE_FACTS.find((f) => f.id === 'limits.ari')?.status).toBe('v2');
  });
});

describe('revisions and webhooks — parsing, and card data never read', () => {
  const state = newSimState({ roomTypes: ['RT-WV'], ratePlans: [{ id: 'RP', roomTypeId: 'RT-WV' }] });
  const sim = addRevision(
    state,
    {
      status: 'new',
      rooms: [
        {
          roomTypeId: 'RT-WV',
          ratePlanId: 'RP',
          checkin: '2026-12-10',
          checkout: '2026-12-12',
          adults: 2,
          nightly: { '2026-12-10': '250.00', '2026-12-11': '260.50' },
        },
      ],
    },
    NOW,
  );
  it('turns a revision into the hub-neutral model; the guarantee/card block is dropped', () => {
    const r = toHubRevision(sim.id, sim.attributes);
    expect(r).toMatchObject({ bookingId: sim.booking_id, status: 'new', currency: 'USD' });
    expect(r.rooms[0]?.nightly).toEqual([
      { date: '2026-12-10', amountMinor: 25000 },
      { date: '2026-12-11', amountMinor: 26050 },
    ]);
    expect(JSON.stringify(r)).not.toMatch(/411111|card_number|guarantee/);
  });
  it('refuses an unreadable revision with the reasons', () => {
    expect(() => toHubRevision('x', { ...sim.attributes, rooms: [] })).toThrow(WireParseError);
    expect(() => toHubRevision('x', { ...sim.attributes, currency: 'usd' })).toThrow(WireParseError);
  });
  it('parses full and notification-only webhooks', () => {
    state.webhook = {
      callbackUrl: 'https://x/v1/distribution/webhooks/channex/00000000-0000-7000-8000-000000000000',
      headers: {},
      sendData: true,
      active: true,
    };
    const [full] = webhookDeliveries(state, [sim.id], {}, NOW);
    const n = parseWebhook(full?.rawBody ?? '');
    expect(n).toMatchObject({ event: 'booking_new', isBookingEvent: true, revisionId: sim.id });
    expect(n.revision?.bookingId).toBe(sim.booking_id);
    const [thin] = webhookDeliveries(state, [sim.id], { notificationOnly: true }, NOW);
    expect(parseWebhook(thin?.rawBody ?? '')).toMatchObject({ revision: null, isBookingEvent: true });
    expect(parseWebhook('{"event":"ari","property_id":"p"}').isBookingEvent).toBe(false);
    expect(() => parseWebhook('{')).toThrow(WireParseError);
  });
});

describe('simulator — the API surface the adapter talks to', () => {
  const setup = () => {
    const s = newSimState({
      roomTypes: ['RT-WV'],
      ratePlans: [{ id: 'RP', roomTypeId: 'RT-WV', minRate: '100.00' }],
    });
    const adapter = channexAdapter({
      http: { send: () => Promise.reject(new Error('no real hub in tests')) },
      simulator: () => ({
        async send(req) {
          const o = handleRequest(
            s,
            {
              method: req.method,
              url: req.url,
              headers: req.headers,
              ...(req.body ? { body: req.body } : {}),
            },
            NOW,
          );
          if (o.kind === 'timeout') throw new Error('timeout');
          return o.response;
        },
      }),
    });
    const ctx = {
      tenantId: 't',
      mode: 'simulate' as const,
      apiKey: s.apiKey,
      externalPropertyId: s.propertyId,
      deadline: NOW,
    };
    return { s, adapter, ctx };
  };
  it('applies availability and enforces 10 requests per minute per property (HTTP 429)', async () => {
    const { s, adapter, ctx } = setup();
    for (let i = 0; i < 10; i++) {
      await adapter.pushAvailability(ctx, [
        {
          channelRoomTypeId: 'RT-WV',
          run: { from: '2026-12-01', to: '2026-12-03', value: { availability: i } },
        },
      ]);
    }
    expect(s.availability['RT-WV']).toEqual({ '2026-12-01': 9, '2026-12-02': 9 });
    await expect(
      adapter.pushAvailability(ctx, [
        {
          channelRoomTypeId: 'RT-WV',
          run: { from: '2026-12-01', to: '2026-12-02', value: { availability: 1 } },
        },
      ]),
    ).rejects.toMatchObject({ failure: { class: 'rate_limited', httpStatus: 429, retryAfterSeconds: 60 } });
  });
  it('refuses a wrong key (auth) and reports value-level refusals as partial acceptance', async () => {
    const { s, adapter, ctx } = setup();
    await expect(adapter.testCredentials({ ...ctx, apiKey: 'wrong' })).rejects.toMatchObject({
      failure: { class: 'auth' },
    });
    const v = (rateMinor: number) => ({
      rateMinor,
      currency: 'USD',
      stopSell: false,
      closedToArrival: false,
      closedToDeparture: false,
      minStayArrival: null,
      minStayThrough: null,
      maxStay: null,
    });
    const res = await adapter.pushRestrictions(ctx, [
      { channelRatePlanId: 'RP', run: { from: '2026-12-01', to: '2026-12-02', value: v(25000) } },
      { channelRatePlanId: 'RP', run: { from: '2026-12-02', to: '2026-12-03', value: v(5000) } },
    ]);
    expect(res.refused).toEqual([{ index: 1, message: expect.stringMatching(/below the minimum/) }]);
    expect(s.restrictions.RP?.['2026-12-01']?.rate).toBe('250.00');
    expect(s.restrictions.RP?.['2026-12-02']).toBeUndefined();
  });
  it('feeds unacknowledged revisions in order and acknowledges idempotently', async () => {
    const { s, adapter, ctx } = setup();
    const a = addRevision(
      s,
      {
        status: 'new',
        rooms: [
          {
            roomTypeId: 'RT-WV',
            ratePlanId: 'RP',
            checkin: '2026-12-10',
            checkout: '2026-12-11',
            adults: 1,
            nightly: { '2026-12-10': '200.00' },
          },
        ],
      },
      NOW,
    );
    const b = addRevision(
      s,
      {
        bookingId: a.booking_id,
        status: 'cancelled',
        rooms: [
          {
            roomTypeId: 'RT-WV',
            ratePlanId: 'RP',
            checkin: '2026-12-10',
            checkout: '2026-12-11',
            adults: 1,
            nightly: {},
          },
        ],
      },
      NOW,
    );
    const feed = await adapter.fetchFeed(ctx);
    expect(feed.map((i) => (i.ok ? i.revision.revisionId : null))).toEqual([a.id, b.id]);
    await adapter.acknowledge(ctx, a.id);
    await adapter.acknowledge(ctx, a.id);
    expect(s.revisions.find((r) => r.id === a.id)).toMatchObject({ acked: true, ack_count: 2 });
    expect((await adapter.fetchFeed(ctx)).length).toBe(1);
    // A 404 is handed to the caller as "refused again" (it alone knows whether it acknowledged before).
    expect(await adapter.acknowledge(ctx, 'unknown')).toEqual({ httpStatus: 404, refusedAgain: true });
  });
});
