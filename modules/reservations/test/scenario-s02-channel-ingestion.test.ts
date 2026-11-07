import { sql } from '@portico/db';
import { fixedClock, newId } from '@portico/kernel';
import type { TestDatabase } from '@portico/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CanonicalChannelBooking } from '../src/contracts';
import { RESERVATIONS_EVENTS as E } from '../src/events';
import { type Org, setupOrg, startDb } from './helpers';

/** S02 (reservations part) — an OTA reservation is delivered twice, then modified and cancelled. */
let t: TestDatabase;
// Business morning in Malé on the property's business date.
const clock = fixedClock('2026-12-10T05:00:00Z');
beforeAll(async () => {
  t = await startDb({ clock });
});
afterAll(async () => t?.drop());

function payload(
  org: Org,
  over: Partial<CanonicalChannelBooking> = {},
  room: Partial<CanonicalChannelBooking['rooms'][number]> = {},
): CanonicalChannelBooking {
  const arrival = room.arrival ?? '2026-12-20';
  const departure = room.departure ?? '2026-12-23';
  const nights: Array<{ date: string; amountMinor: number }> = [];
  for (
    let d = new Date(`${arrival}T00:00:00Z`);
    d.toISOString().slice(0, 10) < departure;
    d.setUTCDate(d.getUTCDate() + 1)
  ) {
    nights.push({ date: d.toISOString().slice(0, 10), amountMinor: 30_000 });
  }
  return {
    status: 'confirmed',
    propertyId: org.propertyId,
    currency: 'USD',
    booker: { firstName: 'Kenji', lastName: 'Watanabe', email: 'kenji@ota-alias.example' },
    rooms: [
      {
        roomRef: 'R1',
        unitTypeId: org.types.beach,
        ratePlanId: org.plans.bar,
        arrival,
        departure,
        adults: 2,
        childrenAges: [],
        guests: [
          { firstName: 'Kenji', lastName: 'Watanabe' },
          { firstName: 'Yui', lastName: 'Watanabe' },
        ],
        nightlyPrices: nights,
        specialRequests: ['Anniversary cake'],
        ...room,
      },
    ],
    guarantee: { kind: 'prepaid_channel' },
    amountsIncludeTax: false,
    specialRequests: ['Late arrival by seaplane'],
    marketSegment: 'ota',
    ...over,
  } as CanonicalChannelBooking;
}

describe('S02: channel booking delivered twice, modified, reordered and cancelled', () => {
  it('is idempotent by (connection, external id, revision) and applies revisions in order', async () => {
    const org = await setupOrg(t);
    const connectionId = newId();
    const externalId = `OTA-${newId().slice(-8)}`;
    const ingest = (revision: number, p: CanonicalChannelBooking) =>
      org.run((tx) => org.svc.ingestChannelBooking(tx, { connectionId, externalId, revision, payload: p }));

    const r1 = await ingest(1, payload(org));
    expect(r1.outcome).toBe('created');
    const dup = await ingest(1, payload(org));
    expect(dup).toMatchObject({ outcome: 'duplicate', bookingId: r1.bookingId });
    // Concurrent duplicate deliveries also produce one effect (RES-I06).
    const both = await Promise.all([ingest(1, payload(org)), ingest(1, payload(org))]);
    expect(both.map((x) => x.outcome)).toEqual(['duplicate', 'duplicate']);

    const booking = await org.run((tx) => org.svc.getBooking(tx, r1.bookingId ?? ''));
    expect(booking).toMatchObject({
      source: 'channel',
      channelConnectionId: connectionId,
      guarantee: { kind: 'prepaid_channel' },
    });
    const stayId = booking.stays[0]?.id as string;
    expect(
      await org.run((tx) => org.fakes.inventory.consumptionOf(tx, { type: 'stay', id: stayId })),
    ).toHaveLength(3);

    // Revision 3 (full replacement): one night longer, special request and a guest dropped → field-loss review.
    const r3 = await ingest(
      3,
      payload(
        org,
        { specialRequests: [] },
        {
          departure: '2026-12-24',
          guests: [{ firstName: 'Kenji', lastName: 'Watanabe' }],
          specialRequests: ['Anniversary cake'],
        },
      ),
    );
    expect(r3.outcome).toBe('modified');
    expect(r3.fieldLosses?.map((l) => l.kind)).toEqual(['special_request', 'occupant']);
    const modified = await org.run((tx) => org.svc.getBooking(tx, r1.bookingId ?? ''));
    expect(modified.stays[0]).toMatchObject({ id: stayId, departure: '2026-12-24' });
    expect(modified.issues.map((i) => i.code)).toContain('channel_field_loss');
    expect(
      await org.run((tx) => org.fakes.inventory.consumptionOf(tx, { type: 'stay', id: stayId })),
    ).toHaveLength(4);

    // Revision 2 arrives late: recorded with a note, not applied.
    const r2 = await ingest(2, payload(org, {}, { departure: '2026-12-22' }));
    expect(r2.outcome).toBe('stale');
    expect(r2.note).toMatch(/older/);
    expect((await org.run((tx) => org.svc.getBooking(tx, r1.bookingId ?? ''))).stays[0]?.departure).toBe(
      '2026-12-24',
    );

    // Cancellation after the "1 day before arrival, 14:00 Malé" deadline → 100% per AGREED terms.
    // Rates change meanwhile; the agreed terms (snapshotted at booking) are what count.
    org.fakes.rates.setBase(org.propertyId, org.plans.bar, org.types.beach, 10_000);
    clock.set('2026-12-19T09:00:00Z');
    const r4 = await ingest(
      4,
      payload(org, { status: 'cancelled' }, { arrival: '2026-12-20', departure: '2026-12-24' }),
    );
    clock.set('2026-12-10T05:00:00Z');
    expect(r4.outcome).toBe('cancelled');
    const cancelled = await org.run((tx) => org.svc.getBooking(tx, r1.bookingId ?? ''));
    expect(cancelled.status.booking).toBe('cancelled');
    expect(
      await org.run((tx) => org.fakes.inventory.consumptionOf(tx, { type: 'stay', id: stayId })),
    ).toHaveLength(0);
    const penalty = (await org.run((tx) => org.fakes.finance.postings(tx))).filter(
      (p) => p.key === `penalty:cancellation:${stayId}`,
    );
    expect(penalty.map((p) => [p.chargeCode, p.amountMinor])).toEqual([['CANCEL_FEE', 4 * 30_000]]);
    expect(cancelled.issues.length + cancelled.stays.length).toBeGreaterThan(0);
    // Re-delivery of the cancellation: one effect only.
    expect((await ingest(4, payload(org, { status: 'cancelled' }))).outcome).toBe('duplicate');
    expect(
      (await org.run((tx) => org.fakes.finance.postings(tx))).filter(
        (p) => p.key === `penalty:cancellation:${stayId}`,
      ),
    ).toHaveLength(1);

    const revisions = await org.run((tx) =>
      sql<{
        revision: number;
        outcome: string;
        applied: boolean;
      }>`select revision::int, outcome, applied from reservations.channel_revisions order by revision`.execute(
        tx.db,
      ),
    );
    expect(revisions.rows.map((r) => [r.revision, r.outcome, r.applied])).toEqual([
      [1, 'created', true],
      [2, 'stale', false],
      [3, 'modified', true],
      [4, 'cancelled', true],
    ]);
  });

  it('a channel booking on a sold-out night is committed with an inventory conflict and a relocation case', async () => {
    const org = await setupOrg(t, { units: { beach: ['V101'] } });
    await org.run((tx) =>
      org.svc.createBooking(tx, org.booking({}, { arrival: '2026-12-20', departure: '2026-12-23' })),
    );
    const res = await org.run((tx) =>
      org.svc.ingestChannelBooking(tx, {
        connectionId: newId(),
        externalId: 'OTA-OVERSOLD',
        revision: 1,
        payload: payload(org),
      }),
    );
    expect(res.outcome).toBe('conflict');
    expect(res.conflictIds).toHaveLength(3);
    const conflicts = await org.run((tx) => org.fakes.inventory.conflicts(tx));
    expect(conflicts).toHaveLength(3);
    const cases = await org.run((tx) => org.svc.listRelocationCases(tx, { propertyId: org.propertyId }));
    expect(cases).toHaveLength(1);
    expect(cases[0]).toMatchObject({
      cause: 'inventory_conflict',
      status: 'open',
      nights: { from: '2026-12-20', to: '2026-12-23' },
    });
    expect(cases[0]?.options.map((o) => o.kind)).toEqual(
      expect.arrayContaining(['upgrade', 'external_hotel']),
    );
    const events = await org.run((tx) =>
      sql<{ type: string }>`select type from core.outbox where type = ${E.stayRelocationRequired}`.execute(
        tx.db,
      ),
    );
    expect(events.rows).toHaveLength(1);
    const booking = await org.run((tx) => org.svc.getBooking(tx, res.bookingId ?? ''));
    expect(booking.status.booking).toBe('confirmed');
    expect(booking.stays[0]?.issues.map((i) => i.code)).toContain('relocation_required');
  });

  it('R-01: a channel price that differs from the quote keeps every tax and levy (computed by rates)', async () => {
    const org = await setupOrg(t);
    const p = payload(org);
    for (const n of p.rooms[0]?.nightlyPrices ?? []) n.amountMinor = 30_001; // one cent off Portico's quote
    const res = await org.run((tx) =>
      org.svc.ingestChannelBooking(tx, {
        connectionId: newId(),
        externalId: 'OTA-CENT',
        revision: 1,
        payload: p,
      }),
    );
    const b = await org.run((tx) => org.svc.getBooking(tx, res.bookingId ?? ''));
    // 3 nights: TGST 17% of 30 001 = 5 100 per night; Green Tax 2 adults × 1 200 per night.
    expect(b.totals).toMatchObject({
      net: { amountMinor: 90_003 },
      taxes: { amountMinor: 15_300 },
      fees: { amountMinor: 7_200 },
    });
    // Tax-inclusive channel prices are decomposed by the tax engine, never stored as net.
    const incl = payload(org, { amountsIncludeTax: true });
    for (const n of incl.rooms[0]?.nightlyPrices ?? []) n.amountMinor = 37_500;
    const r2 = await org.run((tx) =>
      org.svc.ingestChannelBooking(tx, {
        connectionId: newId(),
        externalId: 'OTA-INCL',
        revision: 1,
        payload: incl,
      }),
    );
    const b2 = await org.run((tx) => org.svc.getBooking(tx, r2.bookingId ?? ''));
    expect(b2.totals).toMatchObject({
      net: { amountMinor: 90_000 },
      taxes: { amountMinor: 15_300 },
      fees: { amountMinor: 7_200 },
      gross: { amountMinor: 112_500 },
    });
  });

  it('records channel prices as the agreed price and flags a discrepancy with Portico rates', async () => {
    const org = await setupOrg(t);
    const p = payload(org);
    for (const n of p.rooms[0]?.nightlyPrices ?? []) n.amountMinor = 27_000;
    const res = await org.run((tx) =>
      org.svc.ingestChannelBooking(tx, {
        connectionId: newId(),
        externalId: 'OTA-PRICE',
        revision: 1,
        payload: p,
      }),
    );
    const b = await org.run((tx) => org.svc.getBooking(tx, res.bookingId ?? ''));
    expect(b.totals.net.amountMinor).toBe(81_000);
    expect(b.issues.map((i) => i.code)).toContain('channel_rate_discrepancy');
  });
});

describe('S02 review regressions (steward R-05, R-06, R-19)', () => {
  it('R-05: a cancellation that arrives before its creation leaves no live booking', async () => {
    const org = await setupOrg(t);
    const connectionId = newId();
    const ingest = (revision: number, p: CanonicalChannelBooking) =>
      org.run((tx) =>
        org.svc.ingestChannelBooking(tx, { connectionId, externalId: 'OTA-ORDER', revision, payload: p }),
      );
    expect((await ingest(3, payload(org, { status: 'cancelled' }))).outcome).toBe('stale');
    const create = await ingest(1, payload(org));
    expect(create.outcome).toBe('stale');
    expect(create.bookingId).toBeUndefined();
    const count = await org.run((tx) =>
      sql<{ n: number }>`select count(*)::int as n from reservations.bookings`.execute(tx.db),
    );
    expect(count.rows[0]?.n).toBe(0);
    expect((await ingest(3, payload(org, { status: 'cancelled' }))).outcome).toBe('duplicate');
    const issues = await org.run((tx) => org.svc.listIssues(tx, { propertyId: org.propertyId }));
    expect(issues.map((i) => i.kind)).toContain('channel_cancelled_before_created');
  });

  it('R-06: a channel cancellation for an in-house guest is recorded for review, not thrown', async () => {
    const org = await setupOrg(t);
    const connectionId = newId();
    const p = payload(org, {}, { arrival: '2026-12-10', departure: '2026-12-12' });
    const r1 = await org.run((tx) =>
      org.svc.ingestChannelBooking(tx, { connectionId, externalId: 'OTA-INH', revision: 1, payload: p }),
    );
    const b = await org.run((tx) => org.svc.getBooking(tx, r1.bookingId ?? ''));
    const stayId = b.stays[0]?.id as string;
    await org.run((tx) =>
      org.svc.assignUnit(tx, { stayId, unitId: org.units.V101 as string, expectedVersion: b.version }),
    );
    await org.svc.performWorkflow(t.db, org.ctx, {
      stayId,
      kind: 'check_in',
      checkIn: { registration: { identityVerified: true } },
    });
    const r2 = await org.run((tx) =>
      org.svc.ingestChannelBooking(tx, {
        connectionId,
        externalId: 'OTA-INH',
        revision: 2,
        payload: { ...p, status: 'cancelled' },
      }),
    );
    expect(r2.outcome).toBe('needs_review');
    const after = await org.run((tx) => org.svc.getBooking(tx, r1.bookingId ?? ''));
    expect(after.stays[0]?.status.stay).toBe('in_house');
    expect(after.issues.map((i) => i.code)).toContain('channel_modification_review');
    // Redelivery is a duplicate, not another attempt.
    expect(
      (
        await org.run((tx) =>
          org.svc.ingestChannelBooking(tx, {
            connectionId,
            externalId: 'OTA-INH',
            revision: 2,
            payload: { ...p, status: 'cancelled' },
          }),
        )
      ).outcome,
    ).toBe('duplicate');
  });

  it('R-06: a past-dated channel booking is recorded with an urgent issue', async () => {
    const org = await setupOrg(t);
    const r = await org.run((tx) =>
      org.svc.ingestChannelBooking(tx, {
        connectionId: newId(),
        externalId: 'OTA-PAST',
        revision: 1,
        payload: payload(org, {}, { arrival: '2026-12-05', departure: '2026-12-07' }),
      }),
    );
    expect(['created', 'conflict']).toContain(r.outcome);
    const issues = await org.run((tx) => org.svc.listIssues(tx, { propertyId: org.propertyId }));
    expect(issues.find((i) => i.kind === 'channel_past_arrival')?.severity).toBe('urgent');
  });

  it('R-19: the same revision with different content raises an urgent issue', async () => {
    const org = await setupOrg(t);
    const connectionId = newId();
    const a = await org.run((tx) =>
      org.svc.ingestChannelBooking(tx, {
        connectionId,
        externalId: 'OTA-X',
        revision: 1,
        payload: payload(org),
      }),
    );
    const b = await org.run((tx) =>
      org.svc.ingestChannelBooking(tx, {
        connectionId,
        externalId: 'OTA-X',
        revision: 1,
        payload: payload(org, { specialRequests: ['wheelchair access'] }),
      }),
    );
    expect(b.outcome).toBe('duplicate');
    const booking = await org.run((tx) => org.svc.getBooking(tx, a.bookingId ?? ''));
    expect(booking.issues.map((i) => i.code)).toContain('channel_revision_conflict');
  });
});
