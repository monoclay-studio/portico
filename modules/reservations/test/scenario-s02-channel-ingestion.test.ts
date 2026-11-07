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
    specialRequests: ['Late arrival by seaplane'],
    marketSegment: 'ota',
    ...over,
  };
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
