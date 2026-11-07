import { sql, withTenantTx } from '@portico/db';
import type { TestDatabase } from '@portico/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Booking } from '../src/contracts';
import { reservationsJobs } from '../src/jobs';
import { BUSINESS_DATE, created, setupOrg, startDb } from './helpers';

let t: TestDatabase;
beforeAll(async () => {
  t = await startDb();
});
afterAll(async () => t?.drop());

describe('booking lifecycle', () => {
  it('confirms a booking: agreed terms persisted immutably, inventory consumed, record contract populated', async () => {
    const org = await setupOrg(t);
    const b = created<Booking>(await org.run((tx) => org.svc.createBooking(tx, org.booking())));
    expect(b.code).toMatch(/^[2-9A-HJKMNP-TV-Z]{8}$/);
    expect(b.status).toMatchObject({ booking: 'confirmed' });
    const stay = b.stays[0];
    expect(stay?.status).toMatchObject({ stay: 'expected', booking: 'confirmed' });
    // 3 nights × (30 000 net + 17% TGST 5 100 + green tax 2 × 1 200) = 3 × 37 500
    expect(b.totals.gross).toEqual({ amountMinor: 112_500, currency: 'USD' });
    const consumption = await org.run((tx) =>
      org.fakes.inventory.consumptionOf(tx, { type: 'stay', id: stay?.id ?? '' }),
    );
    expect(consumption.map((c) => c.night)).toEqual(['2026-12-10', '2026-12-11', '2026-12-12']);
    // Universal record contract
    expect(stay?.allowedActions.find((a) => a.action === 'checkIn')).toMatchObject({
      enabled: false,
      reason: 'No unit is assigned yet.',
    });
    expect(stay?.issues.map((i) => i.code)).toContain('unit_unassigned');
    expect(b.links.some((l) => l.rel === 'stay')).toBe(true);
    // Terms snapshots are append-only (RES-I04)
    await expect(
      withTenantTx(t.db, org.ctx, (tx) =>
        sql`update reservations.terms_snapshots set hash = 'x'`.execute(tx.db),
      ),
    ).rejects.toThrow();
  });

  it('booking and stay events carry per-stay facts for housekeeping and readiness (payload version 2)', async () => {
    const org = await setupOrg(t);
    const b = created<Booking>(
      await org.run((tx) =>
        org.svc.createBooking(
          tx,
          org.booking(
            { tags: ['vip:gold'], specialRequests: ['Honeymoon'] },
            {
              unitId: org.units.V101,
              eta: '15:40',
              occupancy: { adults: 2, childrenAges: [6] },
              requests: ['Baby cot'],
            },
          ),
        ),
      ),
    );
    const { rows } = await org.run((tx) =>
      sql<{
        type: string;
        version: number;
        payload: { bookingId: string; code: string; stays: Array<Record<string, unknown>> };
      }>`
        select type, version, payload from core.outbox where type = 'reservations.booking.confirmed'`.execute(
        tx.db,
      ),
    );
    expect(rows[0]?.version).toBe(2);
    expect(rows[0]?.payload).toMatchObject({ bookingId: b.id, code: b.code });
    expect(rows[0]?.payload.stays).toEqual([
      expect.objectContaining({
        stayId: b.stays[0]?.id,
        propertyId: org.propertyId,
        unitTypeId: org.types.beach,
        unitId: org.units.V101,
        arrival: BUSINESS_DATE,
        departure: '2026-12-13',
        eta: '15:40',
        earlyCheckIn: null,
        vipLevel: 'gold',
        occupants: { adults: 2, children: 1, childrenAges: [6] },
        requests: { open: 1, total: 1, bookingSpecialRequests: 1 },
      }),
    ]);
    // No personal data in event payloads.
    expect(JSON.stringify(rows[0]?.payload)).not.toMatch(/Hoffmann|Baby cot|Honeymoon/);
  });

  it('quote → hold → confirm keeps the held price and converts the hold', async () => {
    const org = await setupOrg(t);
    const quoted = created<Booking>(
      await org.run((tx) => org.svc.createBooking(tx, org.booking({ intent: 'quote' }))),
    );
    expect(quoted.status.booking).toBe('quoted');
    const held = created<Booking>(
      await org.run((tx) =>
        org.svc.transitionBooking(tx, { bookingId: quoted.id, expectedVersion: quoted.version, to: 'held' }),
      ),
    );
    expect(held.holdExpiresAt).not.toBeNull();
    const avail = await org.run((tx) =>
      org.fakes.inventory.getAvailability(tx, {
        propertyId: org.propertyId,
        unitTypeIds: [org.types.beach],
        range: { from: BUSINESS_DATE, to: '2026-12-11' },
      }),
    );
    expect(avail[0]).toMatchObject({ held: 1, sold: 0 });
    org.fakes.rates.setBase(org.propertyId, org.plans.bar, org.types.beach, 99_000);
    const confirmed = created<Booking>(
      await org.run((tx) =>
        org.svc.transitionBooking(tx, { bookingId: held.id, expectedVersion: held.version, to: 'confirmed' }),
      ),
    );
    expect(confirmed.status.booking).toBe('confirmed');
    expect(confirmed.totals.net.amountMinor).toBe(90_000);
    const after = await org.run((tx) =>
      org.fakes.inventory.getAvailability(tx, {
        propertyId: org.propertyId,
        unitTypeIds: [org.types.beach],
        range: { from: BUSINESS_DATE, to: '2026-12-11' },
      }),
    );
    expect(after[0]).toMatchObject({ held: 0, sold: 1 });
  });

  it('the expiry job expires lapsed holds (inventory released) and flags tentative option dates', async () => {
    const org = await setupOrg(t);
    const held = created<Booking>(
      await org.run((tx) => org.svc.createBooking(tx, org.booking({ intent: 'hold' }))),
    );
    const tentative = created<Booking>(
      await org.run((tx) =>
        org.svc.createBooking(
          tx,
          org.booking(
            { intent: 'tentative', optionDate: '2026-12-10' },
            { arrival: '2026-12-20', departure: '2026-12-22' },
          ),
        ),
      ),
    );
    await org.run((tx) =>
      sql`update reservations.bookings set hold_expires_at = now() - interval '1 minute' where id = ${held.id}`.execute(
        tx.db,
      ),
    );
    const [job] = reservationsJobs(org.svc);
    await job?.run(t.db, new Date());
    expect((await org.run((tx) => org.svc.getBooking(tx, held.id))).status.booking).toBe('expired');
    expect(
      await org.run((tx) =>
        org.fakes.inventory.consumptionOf(tx, { type: 'stay', id: held.stays[0]?.id ?? '' }),
      ),
    ).toEqual([]);
    const avail = await org.run((tx) =>
      org.fakes.inventory.getAvailability(tx, {
        propertyId: org.propertyId,
        unitTypeIds: [org.types.beach],
        range: { from: BUSINESS_DATE, to: '2026-12-11' },
      }),
    );
    expect(avail[0]?.held).toBe(0);
    const t2 = await org.run((tx) => org.svc.getBooking(tx, tentative.id));
    expect(t2.status.booking).toBe('tentative');
    expect(t2.issues.map((i) => i.code)).toContain('option_date_reached');
  });

  it('refuses invalid transitions and tentative bookings without an option date', async () => {
    const org = await setupOrg(t);
    await expect(
      org.run((tx) => org.svc.createBooking(tx, org.booking({ intent: 'tentative' }))),
    ).rejects.toThrow(/option date/);
    const b = created<Booking>(await org.run((tx) => org.svc.createBooking(tx, org.booking())));
    await expect(
      org.run((tx) =>
        org.svc.transitionBooking(tx, { bookingId: b.id, expectedVersion: b.version, to: 'held' }),
      ),
    ).rejects.toThrow(/cannot become held/);
  });

  it('complimentary and house-use stays need permission and a reason, consume inventory and price zero', async () => {
    const org = await setupOrg(t);
    const agent = org.user('Reservations agent', [
      { permission: 'reservations.booking.create', propertyIds: [org.propertyId] },
      { permission: 'reservations.booking.read', propertyIds: [org.propertyId] },
    ]);
    await expect(
      org.run(
        (tx) =>
          org.svc.createBooking(
            tx,
            org.booking(
              {},
              { commercialType: 'complimentary', commercialReason: 'Travel agent familiarisation' },
            ),
          ),
        agent,
      ),
    ).rejects.toThrow(/reservations.stay.complimentary/);
    await expect(
      org.run((tx) => org.svc.createBooking(tx, org.booking({}, { commercialType: 'house_use' }))),
    ).rejects.toThrow(/needs a reason/);
    const b = created<Booking>(
      await org.run((tx) =>
        org.svc.createBooking(
          tx,
          org.booking(
            {},
            { commercialType: 'complimentary', commercialReason: 'Travel agent familiarisation' },
          ),
        ),
      ),
    );
    expect(b.totals.gross.amountMinor).toBe(0);
    expect(b.stays[0]?.commercialType).toBe('complimentary');
    expect(
      await org.run((tx) =>
        org.fakes.inventory.consumptionOf(tx, { type: 'stay', id: b.stays[0]?.id ?? '' }),
      ),
    ).toHaveLength(3);
  });

  it('walk-in arrives today and is confirmed with the unit assigned', async () => {
    const org = await setupOrg(t);
    const unitId = org.units.V102 as string;
    const b = created<Booking>(
      await org.run((tx) =>
        org.svc.createWalkIn(tx, { ...org.booking(), stay: { ...org.stay({ unitId }), arrival: undefined } }),
      ),
    );
    expect(b.source).toBe('walk_in');
    expect(b.stays[0]).toMatchObject({ arrival: BUSINESS_DATE, unitId });
    expect(b.stays[0]?.allowedActions.find((a) => a.action === 'checkIn')?.enabled).toBe(true);
  });

  it('refuses a requested unit of another unit type', async () => {
    const org = await setupOrg(t);
    await expect(
      org.run((tx) => org.svc.createBooking(tx, org.booking({}, { unitId: org.units.W201 }))),
    ).rejects.toThrow(/not a unit of the booked unit type/);
  });

  it('waitlisted stays never consume; confirming from the waitlist consumes', async () => {
    const org = await setupOrg(t);
    const b = created<Booking>(
      await org.run((tx) =>
        org.svc.createBooking(
          tx,
          org.booking({ intent: 'waitlist' }, { waitlist: { priority: 3, expiresAt: '2026-12-09' } }),
        ),
      ),
    );
    const stay = b.stays[0];
    expect(stay?.status.stay).toBe('waitlisted');
    expect(
      await org.run((tx) => org.fakes.inventory.consumptionOf(tx, { type: 'stay', id: stay?.id ?? '' })),
    ).toHaveLength(0);
    const after = await org.run((tx) =>
      org.svc.confirmWaitlistedStay(tx, { stayId: stay?.id ?? '', expectedVersion: b.version }),
    );
    expect(after.stays[0]?.status.stay).toBe('expected');
    expect(
      await org.run((tx) => org.fakes.inventory.consumptionOf(tx, { type: 'stay', id: stay?.id ?? '' })),
    ).toHaveLength(3);
  });

  it('lists bookings with filters and cursor pagination', async () => {
    const org = await setupOrg(t);
    for (let i = 0; i < 5; i++)
      await org.run((tx) =>
        org.svc.createBooking(
          tx,
          org.booking(
            {},
            {
              arrival: `2026-12-${String(11 + i).padStart(2, '0')}`,
              departure: `2026-12-${String(13 + i).padStart(2, '0')}`,
            },
          ),
        ),
      );
    const page1 = await org.run((tx) => org.svc.listBookings(tx, { propertyId: org.propertyId, limit: 2 }));
    expect(page1.items).toHaveLength(2);
    const page2 = await org.run((tx) =>
      org.svc.listBookings(tx, {
        propertyId: org.propertyId,
        limit: 2,
        cursor: page1.nextCursor ?? undefined,
      }),
    );
    expect(page2.items.map((i) => i.id)).not.toContain(page1.items[0]?.id);
    const filtered = await org.run((tx) =>
      org.svc.listBookings(tx, { propertyId: org.propertyId, limit: 50, arrivalFrom: '2026-12-14' }),
    );
    expect(filtered.items).toHaveLength(2);
    const byCode = await org.run((tx) =>
      org.svc.listBookings(tx, {
        propertyId: org.propertyId,
        limit: 50,
        code: page1.items[0]?.code.toLowerCase(),
      }),
    );
    expect(byCode.items).toHaveLength(1);
  });
});
