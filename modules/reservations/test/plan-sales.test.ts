import type { TestDatabase } from '@portico/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Booking } from '../src/contracts';
import { created, setupOrg, startDb } from './helpers';

/**
 * Review R-15 / RAT-R08: every stay that consumes inventory also counts against its rate plan's sales limits, in the
 * same transaction (rates' recordPlanSale / releasePlanSale), so a limited offer cannot oversell. Proven with the
 * Postgres-backed fake that mirrors rates.plan_sales (advisory lock per property-night, idempotent per ref/night).
 */
let t: TestDatabase;
beforeAll(async () => {
  t = await startDb();
});
afterAll(async () => t?.drop());

describe('rate-plan sales limits', () => {
  it('a full limited offer is refused atomically; cancellation and shortening give nights back', async () => {
    const org = await setupOrg(t);
    await org.run((tx) =>
      org.fakes.rates.setSalesLimit(tx, {
        propertyId: org.propertyId,
        ratePlanId: org.plans.nonRef,
        nights: { from: '2026-12-10', to: '2026-12-14' },
        limit: 1,
      }),
    );
    const book = (last: string, ratePlanId: string, departure = '2026-12-13') =>
      org.run((tx) =>
        org.svc.createBooking(
          tx,
          org.booking(
            { booker: { kind: 'profile', profile: { lastName: last } } },
            { ratePlanId, departure },
          ),
        ),
      );
    const a = created<Booking>(await book('First', org.plans.nonRef));
    const stayA = a.stays[0]?.id as string;
    expect(await org.run((tx) => org.fakes.rates.planSales(tx, org.plans.nonRef))).toEqual([
      { date: '2026-12-10', refId: stayA },
      { date: '2026-12-11', refId: stayA },
      { date: '2026-12-12', refId: stayA },
    ]);

    // The offer is full: the second booking is refused and NOTHING is written (inventory included).
    await expect(book('Second', org.plans.nonRef)).rejects.toMatchObject({ code: 'sales_limit_reached' });
    const cells = await org.run((tx) =>
      org.inventory.getAvailability(tx, {
        propertyId: org.propertyId,
        unitTypeIds: [org.types.beach],
        range: { from: '2026-12-10', to: '2026-12-11' },
      }),
    );
    expect(cells[0]?.sold).toBe(1);
    // Another plan is not limited.
    created<Booking>(await book('Flexible', org.plans.bar));

    // Shortening the first stay gives its last night back (change preview → commit).
    const preview = await org.run((tx) =>
      org.svc.previewChange(tx, {
        kind: 'dates',
        stayId: stayA,
        arrival: '2026-12-10',
        departure: '2026-12-12',
      }),
    );
    await org.svc.commitChangeSafely(t.db, org.ctx, { previewToken: preview.token });
    expect(
      (await org.run((tx) => org.fakes.rates.planSales(tx, org.plans.nonRef))).map((s) => s.date),
    ).toEqual(['2026-12-10', '2026-12-11']);

    // Cancelling it frees the offer for the next guest.
    const cancel = await org.run((tx) =>
      org.svc.previewChange(tx, { kind: 'cancel_booking', bookingId: a.id, reason: 'Guest changed plans' }),
    );
    await org.svc.commitChangeSafely(t.db, org.ctx, { previewToken: cancel.token });
    expect(await org.run((tx) => org.fakes.rates.planSales(tx, org.plans.nonRef))).toEqual([]);
    const second = created<Booking>(await book('Second', org.plans.nonRef));
    expect(await org.run((tx) => org.fakes.rates.planSales(tx, org.plans.nonRef))).toHaveLength(3);
    expect(second.stays[0]?.status.stay).toBe('expected');
  });
});
