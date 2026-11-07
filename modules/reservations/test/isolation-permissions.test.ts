import { sql } from '@portico/db';
import { newId } from '@portico/kernel';
import type { TestDatabase } from '@portico/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Booking } from '../src/contracts';
import { created, setupOrg, startDb } from './helpers';

/** S17 and least privilege: another organization cannot read or change bookings; permissions are property-scoped. */
let t: TestDatabase;
beforeAll(async () => {
  t = await startDb();
});
afterAll(async () => t?.drop());

describe('tenant isolation (S17)', () => {
  it('another organization cannot read, list, preview, change or search a booking — even by id', async () => {
    const victim = await setupOrg(t);
    const b = created<Booking>(await victim.run((tx) => victim.svc.createBooking(tx, victim.booking())));
    const attacker = await setupOrg(t);
    const stayId = b.stays[0]?.id as string;
    await expect(attacker.run((tx) => attacker.svc.getBooking(tx, b.id))).rejects.toThrow(
      /not found or you do not have access/,
    );
    await expect(attacker.run((tx) => attacker.svc.getStay(tx, stayId))).rejects.toThrow(/not found/);
    await expect(
      attacker.run((tx) =>
        attacker.svc.previewChange(tx, { kind: 'cancel_booking', bookingId: b.id, reason: 'x' }),
      ),
    ).rejects.toThrow(/not found/);
    await expect(
      attacker.run((tx) =>
        attacker.svc.patchBooking(tx, {
          bookingId: b.id,
          expectedVersion: b.version,
          patch: { notes: 'pwned' },
        }),
      ),
    ).rejects.toThrow(/not found/);
    await expect(
      attacker.run((tx) => attacker.svc.markNoShow(tx, { stayId, idempotencyKey: 'x' })),
    ).rejects.toThrow(/not found/);
    const list = await attacker.run((tx) =>
      attacker.svc.listBookings(tx, { propertyId: victim.propertyId, limit: 50 }),
    );
    expect(list.items).toHaveLength(0);
    expect(await attacker.run((tx) => attacker.svc.search().search(tx, b.code, { limit: 10 }))).toEqual([]);
    expect(await attacker.run((tx) => attacker.svc.search().summarize(tx, 'booking', b.id))).toBeNull();
    // Row Level Security, independent of the application: raw SQL sees nothing of the other tenant.
    const raw = await attacker.run((tx) =>
      sql<{ n: number }>`select count(*)::int as n from reservations.bookings`.execute(tx.db),
    );
    expect(raw.rows[0]?.n).toBe(0);
    expect((await victim.run((tx) => victim.svc.getBooking(tx, b.id))).notes).toBeNull();
  });
});

describe('permissions', () => {
  it('denies by default and scopes to the property', async () => {
    const org = await setupOrg(t);
    const otherProperty = newId();
    const readOnly = org.user('Read only', [
      { permission: 'reservations.booking.read', propertyIds: [org.propertyId] },
    ]);
    await expect(org.run((tx) => org.svc.createBooking(tx, org.booking()), readOnly)).rejects.toThrow(
      /reservations.booking.create/,
    );
    const elsewhere = org.user('Agent elsewhere', [
      { permission: 'reservations.booking.create', propertyIds: [otherProperty] },
    ]);
    await expect(org.run((tx) => org.svc.createBooking(tx, org.booking()), elsewhere)).rejects.toThrow(
      /permission/,
    );
    const b = created<Booking>(await org.run((tx) => org.svc.createBooking(tx, org.booking())));
    const stayId = b.stays[0]?.id as string;
    // Read-only users see the booking, with every action disabled and explained.
    const seen = await org.run((tx) => org.svc.getBooking(tx, b.id), readOnly);
    expect(seen.allowedActions.find((a) => a.action === 'cancel')).toMatchObject({
      enabled: false,
      reason: expect.stringMatching(/permission/),
    });
    expect(seen.stays[0]?.allowedActions.find((a) => a.action === 'changeDates')).toMatchObject({
      enabled: false,
    });
    await expect(
      org.run(
        (tx) =>
          org.svc.previewChange(tx, {
            kind: 'dates',
            stayId,
            arrival: '2026-12-10',
            departure: '2026-12-14',
          }),
        readOnly,
      ),
    ).rejects.toThrow(/reservations.booking.update/);
    await expect(
      org.run(
        (tx) => org.svc.previewChange(tx, { kind: 'cancel_booking', bookingId: b.id, reason: 'x' }),
        readOnly,
      ),
    ).rejects.toThrow(/reservations.booking.cancel/);
    await expect(
      org.run((tx) => org.svc.startWorkflow(tx, { stayId, kind: 'check_in' }), readOnly),
    ).rejects.toThrow(/reservations.stay.checkIn/);
    await expect(
      org.run((tx) => org.svc.markNoShow(tx, { stayId, idempotencyKey: 'k' }), readOnly),
    ).rejects.toThrow(/reservations.stay.noShow/);
    const outsider = org.user('Other property', [
      { permission: 'reservations.booking.read', propertyIds: [otherProperty] },
    ]);
    await expect(org.run((tx) => org.svc.getBooking(tx, b.id), outsider)).rejects.toThrow(/permission/);
    expect(await org.run((tx) => org.svc.search().search(tx, b.code, { limit: 5 }), outsider)).toEqual([]);
  });

  it('a committed preview re-checks permission at commit time', async () => {
    const org = await setupOrg(t);
    const b = created<Booking>(await org.run((tx) => org.svc.createBooking(tx, org.booking())));
    const p = await org.run((tx) =>
      org.svc.previewChange(tx, { kind: 'cancel_booking', bookingId: b.id, reason: 'x' }),
    );
    const readOnly = org.user('Read only', [
      { permission: 'reservations.booking.read', propertyIds: [org.propertyId] },
    ]);
    await expect(org.svc.commitChangeSafely(t.db, readOnly, { previewToken: p.token })).rejects.toThrow(
      /reservations.booking.cancel/,
    );
  });
});

describe('money only for roles that handle money (UX FD-15)', () => {
  it('housekeeping reads arrivals without payment detail and departures without balances', async () => {
    const org = await setupOrg(t);
    await org.run((tx) => org.svc.createBooking(tx, org.booking()));
    const scope = [org.propertyId];
    const housekeeping = org.user('Housekeeping supervisor', [
      { permission: 'reservations.booking.read', propertyIds: scope },
    ]);
    const desk = org.user('Front desk', [
      { permission: 'reservations.booking.read', propertyIds: scope },
      { permission: 'payments.payment.collect', propertyIds: scope },
      { permission: 'finance.folio.read', propertyIds: scope },
    ]);
    const hk = await org.run((tx) => org.svc.listArrivals(tx, { propertyId: org.propertyId }), housekeeping);
    const row = hk.items[0];
    expect(row?.redacted).toBe(true);
    const pay = row?.readiness?.checks.find((c) => c.key === 'payment_secured');
    expect(pay?.message).toBe('Payment detail is not shown for your role.');
    const seen = await org.run((tx) => org.svc.listArrivals(tx, { propertyId: org.propertyId }), desk);
    expect(seen.items[0]?.redacted).toBeUndefined();
    expect(seen.items[0]?.readiness?.checks.find((c) => c.key === 'payment_secured')?.message).not.toBe(
      'Payment detail is not shown for your role.',
    );
  });
});
