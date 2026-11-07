/**
 * S01 — Two reservation agents attempt to sell the final available room (+ parallel stress variant, E01).
 * Real composition: reservations previews and commits, inventory guards the last unit, rates prices the agreement.
 */
import type { Booking, ChangePreview, CommitResult } from '@portico/reservations';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  applied,
  assertGlobalConsistency,
  bookingInput,
  kandu,
  organization,
  type Scenario,
  startScenario,
} from './harness';

let s: Scenario;
beforeAll(async () => {
  s = await startScenario();
});
afterAll(async () => s?.close());

const NIGHTS = { arrival: '2027-03-10', departure: '2027-03-13' };

describe('S01 — the last Water Villa', () => {
  it('both agents preview "1 available"; exactly one commit wins; the other gets who sold it and alternatives', async () => {
    const org = await organization(s);
    const k = await kandu(s, org);
    const { reservations, inventory } = s.c.services;
    const setupAgent = org.staff('reservations_agent', 'Mohamed', [k.id]);
    // Two of the three Water Villas are already sold for 10–13 Mar.
    for (const last of ['Smith', 'Jones']) {
      await org.run(setupAgent, (tx) =>
        reservations.createBooking(
          tx,
          bookingInput(k, { ...NIGHTS, type: 'WV', guest: { firstName: 'A', lastName: last } }),
        ),
      );
    }
    s.clock.advance(5 * 60_000); // the race happens a few minutes after the earlier sales
    const aishath = org.staff('reservations_agent', 'Aishath', [k.id]);
    const hassan = org.staff('reservations_agent', 'Hassan', [k.id]);
    const request = (lastName: string) => ({
      kind: 'new_booking' as const,
      booking: bookingInput(k, { ...NIGHTS, type: 'WV', guest: { firstName: 'Guest', lastName } }),
    });
    const pa = await org.run(aishath, (tx) => reservations.previewChange(tx, request('Ahmed')));
    const ph = await org.run(hassan, (tx) => reservations.previewChange(tx, request('Brown')));
    for (const p of [pa, ph]) {
      expect(p.feasible).toBe(true);
      expect(p.stays[0]?.nights.every((n) => n.availability?.available === 1)).toBe(true);
    }
    const results = await Promise.allSettled([
      reservations.commitChangeSafely(s.t.db, aishath, { previewToken: pa.token }),
      reservations.commitChangeSafely(s.t.db, hassan, { previewToken: ph.token }),
    ]);
    const ok = results.filter((r) => r.status === 'fulfilled');
    const failed = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(1);
    const err = failed[0]?.reason as { code: string; status: number; details: Record<string, unknown> };
    expect(err).toMatchObject({ code: 'preview_stale', status: 409 });
    const winner = (ok[0] as PromiseFulfilledResult<{ booking: Booking }>).value.booking;
    const winnerAgent = winner.booker.name?.includes('Ahmed') ? 'Aishath' : 'Hassan';
    const explanation = ((err.details.explanation ?? []) as string[]).join(' ');
    expect(explanation).toContain(winner.code);
    expect(explanation).toContain(winnerAgent);
    const fresh = err.details.freshPreview as ChangePreview;
    expect(fresh.feasible).toBe(false);
    expect(fresh.alternatives.map((a) => a.label)).toEqual(
      expect.arrayContaining([expect.stringMatching(/Sunset Water Villa with Pool is available/)]),
    );
    // Money: only the winner has agreed terms with a deposit item; nothing is posted at booking.
    expect(winner.status.booking).toBe('confirmed');
    const cells = await org.run(aishath, (tx) =>
      inventory.getAvailability(tx, {
        propertyId: k.id,
        unitTypeIds: [k.types.WV as string],
        range: { from: NIGHTS.arrival, to: NIGHTS.departure },
      }),
    );
    expect(cells.map((c) => [c.sold, c.available])).toEqual([
      [3, 0],
      [3, 0],
      [3, 0],
    ]);
    // Recovery: the losing agent commits an alternative from the fresh preview at once.
    const alt = fresh.alternatives.find((a) => a.preview.feasible);
    const altCommit = applied<CommitResult>(
      await reservations.commitChangeSafely(s.t.db, winnerAgent === 'Aishath' ? hassan : aishath, {
        previewToken: alt?.preview.token ?? '',
      }),
    );
    expect(altCommit.booking.status.booking).toBe('confirmed');
    await assertGlobalConsistency(s, org, {
      auditActions: ['reservations.booking.create'],
    });
  });

  it('E01 stress: 20 parallel commits for the last 3 villas — exactly 3 bookings, no oversell', async () => {
    const org = await organization(s);
    const k = await kandu(s, org);
    const agent = org.staff('reservations_agent', 'Desk', [k.id]);
    const attempts = await Promise.allSettled(
      Array.from({ length: 20 }, (_, i) =>
        org.run(agent, (tx) =>
          s.c.services.reservations.createBooking(
            tx,
            bookingInput(k, { ...NIGHTS, type: 'WV', guest: { firstName: 'Racer', lastName: `No${i}` } }),
          ),
        ),
      ),
    );
    const won = attempts.filter((a) => a.status === 'fulfilled');
    expect(won).toHaveLength(3);
    for (const a of attempts.filter((x): x is PromiseRejectedResult => x.status === 'rejected')) {
      expect((a.reason as { code?: string }).code).toBe('inventory_unavailable');
    }
    await assertGlobalConsistency(s, org);
  });
});
