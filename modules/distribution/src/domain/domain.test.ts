import { describe, expect, it } from 'vitest';
import { compareCell, compressRuns, publishedAvailability, restrictionValueFrom } from './ari';
import { BUDGET_WINDOW_MS, maxInAnyWindow, nextSlotAt, reserveSlot } from './budget';
import { classifyHttp, isEscalated, nextAttemptAt, retryDelayMs } from './delivery';
import { computeHealth, type HealthFacts } from './health';
import { clipRanges, countNights, mergeRanges, normalizeRanges, subtractRanges, takeNights } from './ranges';
import { decideProcessing, type HubRevision, revisionOrderOf, translateRevision } from './revisions';

const r = (from: string, to: string) => ({ from, to });
const at = (s: number) => new Date(Date.UTC(2026, 10, 7, 6, 0, 0) + s * 1000);

describe('ranges — coalescing the dirty set', () => {
  it('merges overlapping AND adjacent ranges, drops empty ones, sorts', () => {
    expect(
      normalizeRanges([
        r('2026-12-05', '2026-12-07'),
        r('2026-12-01', '2026-12-03'),
        r('2026-12-03', '2026-12-05'),
      ]),
    ).toEqual([r('2026-12-01', '2026-12-07')]);
    expect(normalizeRanges([r('2026-12-01', '2026-12-02'), r('2026-12-04', '2026-12-05')])).toHaveLength(2);
    expect(normalizeRanges([r('2026-12-02', '2026-12-02'), r('2026-12-03', '2026-12-01')])).toEqual([]);
    expect(mergeRanges([r('2026-12-01', '2026-12-10')], [r('2026-12-02', '2026-12-04')])).toEqual([
      r('2026-12-01', '2026-12-10'),
    ]);
  });
  it('50 single-night edits over 3 weeks collapse into one range', () => {
    let acc: Array<{ from: string; to: string }> = [];
    for (let i = 0; i < 50; i++) {
      const d = 1 + ((i * 5) % 21);
      const day = `2026-12-${String(d).padStart(2, '0')}`;
      const next = `2026-12-${String(d + 1).padStart(2, '0')}`;
      acc = mergeRanges(acc, [r(day, next)]);
    }
    expect(acc).toEqual([r('2026-12-01', '2026-12-22')]);
  });
  it('clips to the publication window and subtracts what was sent', () => {
    expect(clipRanges([r('2026-11-01', '2026-11-10')], r('2026-11-07', '2027-12-12'))).toEqual([
      r('2026-11-07', '2026-11-10'),
    ]);
    expect(subtractRanges([r('2026-12-01', '2026-12-10')], [r('2026-12-03', '2026-12-05')])).toEqual([
      r('2026-12-01', '2026-12-03'),
      r('2026-12-05', '2026-12-10'),
    ]);
    expect(subtractRanges([r('2026-12-01', '2026-12-10')], [r('2026-11-01', '2027-01-01')])).toEqual([]);
  });
  it('takes the earliest nights first up to a cap, leaving the rest', () => {
    const t = takeNights([r('2026-12-10', '2026-12-20'), r('2026-12-01', '2026-12-03')], 5);
    expect(t.taken).toEqual([r('2026-12-01', '2026-12-03'), r('2026-12-10', '2026-12-13')]);
    expect(t.rest).toEqual([r('2026-12-13', '2026-12-20')]);
    expect(countNights(t.taken) + countNights(t.rest)).toBe(12);
    expect(takeNights([r('2026-12-01', '2026-12-03')], 0).taken).toEqual([]);
  });
});

describe('budget — never more than the limit in ANY 60-second window', () => {
  it('allows a burst of `limit`, then waits until the oldest token is 60 s old', () => {
    let state = { sends: [] as Date[], pausedUntil: null as Date | null };
    for (let i = 0; i < 10; i++) {
      const res = reserveSlot(state, at(i), 10);
      expect(res.ok).toBe(true);
      state = { ...state, sends: res.sends };
    }
    const refused = reserveSlot(state, at(30), 10);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.retryAt).toEqual(at(60));
    expect(reserveSlot(state, new Date(at(60).getTime() - 1), 10).ok).toBe(false); // the first token is not back yet
    expect(reserveSlot(state, at(60), 10).ok).toBe(true); // 60 s after its use, the first token is back
  });
  it('a continuous-refill bucket would allow 2× in a minute; the sliding window never does (property test)', () => {
    let state = { sends: [] as Date[], pausedUntil: null as Date | null };
    const sent: Date[] = [];
    let seed = 7;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed / 2 ** 31;
    };
    let t = 0;
    for (let i = 0; i < 2000; i++) {
      t += Math.floor(rand() * 4000);
      const now = new Date(at(0).getTime() + t);
      const res = reserveSlot(state, now, 10);
      state = { ...state, sends: res.sends };
      if (res.ok) sent.push(now);
    }
    expect(sent.length).toBeGreaterThan(100);
    expect(maxInAnyWindow(sent, BUDGET_WINDOW_MS)).toBeLessThanOrEqual(10);
  });
  it('respects a pause after HTTP 429', () => {
    const state = { sends: [], pausedUntil: at(60) };
    const res = reserveSlot(state, at(10), 10);
    expect(res).toMatchObject({ ok: false, reason: 'paused_after_rate_limit' });
    expect(nextSlotAt(state, at(10), 10)).toEqual(at(60));
    expect(reserveSlot(state, at(61), 10).ok).toBe(true);
  });
  it('a limit of 0 never sends', () => {
    expect(reserveSlot({ sends: [], pausedUntil: null }, at(0), 0).ok).toBe(false);
  });
});

describe('delivery — classification and backoff (DST-R04)', () => {
  it('backs off 5 → 10 → 20 → 40 s, then every minute', () => {
    expect([1, 2, 3, 4, 5, 6, 50].map(retryDelayMs)).toEqual([
      5000, 10000, 20000, 40000, 60000, 60000, 60000,
    ]);
    expect(retryDelayMs(0)).toBe(0);
  });
  it('a 429 waits at least one minute (or Retry-After)', () => {
    expect(nextAttemptAt(at(0), 1, { class: 'rate_limited', retryAfterSeconds: null })).toEqual(at(60));
    expect(nextAttemptAt(at(0), 1, { class: 'rate_limited', retryAfterSeconds: 120 })).toEqual(at(120));
    expect(nextAttemptAt(at(0), 1, { class: 'transient', retryAfterSeconds: 120 })).toEqual(at(5));
  });
  it('classifies payload errors as never retried, transient ones as retried', () => {
    expect([400, 404, 409, 422].map(classifyHttp)).toEqual(['payload', 'payload', 'payload', 'payload']);
    expect([408, 425, 500, 502, 503].map(classifyHttp)).toEqual(Array(5).fill('transient'));
    expect(classifyHttp(429)).toBe('rate_limited');
    expect([401, 403].map(classifyHttp)).toEqual(['auth', 'auth']);
  });
  it('escalates after 30 minutes of failing', () => {
    expect(isEscalated(at(0), at(29 * 60))).toBe(false);
    expect(isEscalated(at(0), at(30 * 60))).toBe(true);
    expect(isEscalated(null, at(99999))).toBe(false);
  });
});

describe('ARI values — publish what Portico has, closed when it must be', () => {
  it('protection closes the last N units; a manual stop-sell closes everything; never negative', () => {
    expect(publishedAvailability(2, { manual: false, protectionThreshold: 2 })).toEqual({
      value: { availability: 0 },
      reason: 'protection',
    });
    expect(publishedAvailability(3, { manual: false, protectionThreshold: 2 })).toEqual({
      value: { availability: 3 },
    });
    expect(publishedAvailability(5, { manual: true, protectionThreshold: null })).toEqual({
      value: { availability: 0 },
      reason: 'stop_sell',
    });
    expect(publishedAvailability(-1, { manual: false, protectionThreshold: null })).toEqual({
      value: { availability: 0 },
    });
    expect(publishedAvailability(0, { manual: false, protectionThreshold: 2 })).toEqual({
      value: { availability: 0 },
    });
  });
  it('a night without a price is published closed, never with an invented price', () => {
    const v = restrictionValueFrom(null, { minLos: 3 });
    expect(v.reason).toBe('no_price');
    expect(v.value).toMatchObject({ rateMinor: null, stopSell: true, minStayArrival: 3 });
    expect(
      restrictionValueFrom({ amountMinor: 25000, currency: 'USD' }, { closed: true }).value.stopSell,
    ).toBe(true);
  });
  it('packs consecutive equal nights into runs', () => {
    const cells = ['2026-12-03', '2026-12-01', '2026-12-02', '2026-12-05'].map((date) => ({
      date,
      value: { availability: date === '2026-12-05' ? 1 : 2 },
    }));
    expect(compressRuns(cells)).toEqual([
      { from: '2026-12-01', to: '2026-12-04', value: { availability: 2 } },
      { from: '2026-12-05', to: '2026-12-06', value: { availability: 1 } },
    ]);
  });
  it('compares Portico with the last acknowledged state', () => {
    const a = { availability: 2 };
    expect(compareCell({ expected: a, acked: a, pending: false, rejected: false })).toBe('in_sync');
    expect(compareCell({ expected: a, acked: { availability: 3 }, pending: false, rejected: false })).toBe(
      'differs',
    );
    expect(compareCell({ expected: a, acked: { availability: 3 }, pending: true, rejected: false })).toBe(
      'pending',
    );
    expect(compareCell({ expected: a, acked: null, pending: false, rejected: true })).toBe('not_accepted');
    expect(compareCell({ expected: a, acked: null, pending: false, rejected: false })).toBe('never_sent');
  });
});

const rev = (over: Partial<HubRevision> = {}): HubRevision => ({
  revisionId: 'rev-1',
  bookingId: 'bk-1',
  externalPropertyId: 'prop',
  status: 'new',
  insertedAt: '2026-11-07T06:00:00.000Z',
  otaName: 'Booking.com',
  otaReservationCode: '4711',
  currency: 'USD',
  customer: { firstName: 'Aiko', lastName: 'Tanaka', email: 'aiko@example.com', phone: null, country: 'jp' },
  rooms: [
    {
      roomRef: '1',
      channelRoomTypeId: 'RT-WV',
      channelRatePlanId: 'RP-WV-BAR',
      checkin: '2026-12-10',
      checkout: '2026-12-13',
      adults: 2,
      childrenAges: [4, 19],
      nightly: [{ date: '2026-12-10', amountMinor: 50000 }],
    },
  ],
  notes: 'Late arrival',
  paymentCollect: 'ota',
  ...over,
});

describe('revisions — ordering, parking and translation', () => {
  it('orders by the hub timestamp with a deterministic tie-break; falls back to arrival time', () => {
    const a = revisionOrderOf('a', '2026-11-07T06:00:00.000Z', at(999));
    const b = revisionOrderOf('b', '2026-11-07T06:00:00.001Z', at(0));
    expect(b).toBeGreaterThan(a);
    expect(revisionOrderOf('a', '2026-11-07T06:00:00.000Z', at(0))).toBe(a);
    expect(revisionOrderOf('a', null, at(5))).toBeGreaterThanOrEqual(at(5).getTime() * 1000);
    expect(Number.isSafeInteger(a)).toBe(true);
  });
  it('parks a modification or cancellation for an unknown booking; waits for earlier revisions', () => {
    expect(decideProcessing({ channelStatus: 'new', bookingKnown: false, earlierUnsettled: 0 })).toEqual({
      action: 'apply',
    });
    expect(
      decideProcessing({ channelStatus: 'cancelled', bookingKnown: false, earlierUnsettled: 0 }).action,
    ).toBe('park_orphan');
    expect(
      decideProcessing({ channelStatus: 'modified', bookingKnown: false, earlierUnsettled: 0 }).action,
    ).toBe('park_orphan');
    expect(
      decideProcessing({ channelStatus: 'modified', bookingKnown: true, earlierUnsettled: 0 }).action,
    ).toBe('apply');
    expect(decideProcessing({ channelStatus: 'new', bookingKnown: false, earlierUnsettled: 1 }).action).toBe(
      'wait',
    );
  });
  const mapping = {
    rooms: new Map([['RT-WV', 'ut-wv']]),
    rates: new Map([['RP-WV-BAR', { unitTypeId: 'ut-wv', ratePlanId: 'rp-bar' }]]),
    fallbackRatePlanId: null,
  };
  it('translates to the reservations canonical booking, cleaning what the contract refuses', () => {
    const t = translateRevision(rev(), { propertyId: 'p', amountsIncludeTax: false, mapping });
    expect(t.ok).toBe(true);
    if (!t.ok) return;
    expect(t.payload).toMatchObject({
      status: 'confirmed',
      booker: { firstName: 'Aiko', lastName: 'Tanaka', email: 'aiko@example.com', nationality: 'JP' },
      rooms: [{ unitTypeId: 'ut-wv', ratePlanId: 'rp-bar', childrenAges: [4], adults: 2 }],
      guarantee: { kind: 'prepaid_channel' },
      specialRequests: ['Late arrival'],
    });
    const bad = translateRevision(
      rev({
        customer: { firstName: null, lastName: null, email: 'not-an-email', phone: null, country: 'Japan' },
      }),
      {
        propertyId: 'p',
        amountsIncludeTax: false,
        mapping,
      },
    );
    expect(bad.ok && bad.payload.booker).toEqual({ lastName: 'Channel guest' });
    expect(bad.ok && bad.payload.notes).toMatch(/surname not supplied/);
  });
  it('an unmapped room is reported with the unit type to hold (from the rate mapping or the room mapping)', () => {
    const t = translateRevision(rev({ rooms: [{ ...rev().rooms[0]!, channelRatePlanId: 'RP-UNKNOWN' }] }), {
      propertyId: 'p',
      amountsIncludeTax: false,
      mapping,
    });
    expect(t).toMatchObject({
      ok: false,
      unmapped: [{ holdUnitTypeId: 'ut-wv', channelRatePlanId: 'RP-UNKNOWN' }],
    });
    const fallback = translateRevision(
      rev({ rooms: [{ ...rev().rooms[0]!, channelRatePlanId: 'RP-UNKNOWN' }] }),
      {
        propertyId: 'p',
        amountsIncludeTax: false,
        mapping: { ...mapping, fallbackRatePlanId: 'rp-fallback' },
      },
    );
    expect(fallback).toMatchObject({ ok: true, fallbackRooms: ['1'] });
    const none = translateRevision(
      rev({ rooms: [{ ...rev().rooms[0]!, channelRoomTypeId: 'X', channelRatePlanId: 'Y' }] }),
      {
        propertyId: 'p',
        amountsIncludeTax: false,
        mapping,
      },
    );
    expect(none).toMatchObject({ ok: false, unmapped: [{ holdUnitTypeId: null }] });
  });
});

const facts = (over: Partial<HealthFacts> = {}): HealthFacts => ({
  status: 'active',
  credentialState: 'valid',
  publicationBlocked: null,
  oldestUnconfirmedChangeAt: null,
  ariFailingSince: null,
  ackFailingSince: null,
  applyFailingSince: null,
  parkedOverdue: 0,
  inboundGapAt: null,
  now: at(3600),
  freshnessTargetMs: 120_000,
  gapCooldownMs: 600_000,
  ...over,
});

describe('health — an outage never looks synced', () => {
  it('connected only when nothing is waiting longer than the freshness target', () => {
    expect(computeHealth(facts()).health).toBe('connected');
    expect(computeHealth(facts({ oldestUnconfirmedChangeAt: at(3600 - 60) })).health).toBe('connected');
    const d = computeHealth(facts({ oldestUnconfirmedChangeAt: at(3600 - 121) }));
    expect(d.health).toBe('degraded');
    expect(d.staleSince).toBe(at(3600 - 121).toISOString());
  });
  it('failing after 30 minutes of failures or an overdue orphan; credentials and authority win', () => {
    expect(computeHealth(facts({ ariFailingSince: at(3600 - 60) })).health).toBe('connected'); // a retry within the target
    expect(computeHealth(facts({ ariFailingSince: at(3600 - 121) })).health).toBe('degraded');
    expect(computeHealth(facts({ ariFailingSince: at(0) })).health).toBe('failing');
    expect(computeHealth(facts({ ackFailingSince: at(0) })).health).toBe('failing');
    expect(computeHealth(facts({ parkedOverdue: 1 })).health).toBe('failing');
    expect(computeHealth(facts({ credentialState: 'invalid', ariFailingSince: at(0) })).health).toBe(
      'credentials_invalid',
    );
    expect(computeHealth(facts({ publicationBlocked: 'PMS X is authoritative' })).health).toBe('blocked');
    expect(computeHealth(facts({ status: 'paused' })).health).toBe('paused');
    expect(computeHealth(facts({ inboundGapAt: at(3600 - 60) })).health).toBe('degraded');
    expect(computeHealth(facts({ inboundGapAt: at(0) })).health).toBe('connected');
  });
});
