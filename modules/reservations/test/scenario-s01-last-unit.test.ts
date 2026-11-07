import type { TestDatabase } from '@portico/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Booking, ChangePreview } from '../src/contracts';
import { PreviewStaleError } from '../src/errors';
import { created, setupOrg, startDb } from './helpers';

/**
 * S01 — two reservation agents attempt to sell the final available unit.
 *
 * Runs twice: against the Postgres-backed fake inventory AND against the REAL `@portico/inventory` module bound
 * through reservations' adapter (review R-13). The assertions are provider-agnostic: exactly one commit succeeds,
 * the other gets 409 `preview_stale` with a fresh preview, an explanation naming who sold it and the booking code
 * (from reservations' own booking history — inventory's `sold[]` names the stay), and alternatives; no oversell.
 */
let t: TestDatabase;
beforeAll(async () => {
  t = await startDb({ realInventory: true });
});
afterAll(async () => t?.drop());

describe.each(['fake', 'real'] as const)('S01: two agents, last villa (%s inventory)', (inventory) => {
  it('both previews show the villa available; exactly one commit succeeds; the other gets a fresh preview with who sold it', async () => {
    const org = await setupOrg(t, { inventory, units: { family: ['F301'] } });
    const aishath = org.user('Aishath');
    const ibrahim = org.user('Ibrahim');
    const request = (name: string) => ({
      kind: 'new_booking' as const,
      booking: org.booking(
        { booker: { kind: 'profile' as const, profile: { lastName: name } } },
        { unitTypeId: org.types.family },
      ),
    });
    const pa = await org.run((tx) => org.svc.previewChange(tx, request('Ahmed')), aishath);
    const pb = await org.run((tx) => org.svc.previewChange(tx, request('Brown')), ibrahim);
    expect(pa.feasible).toBe(true);
    expect(pb.feasible).toBe(true);
    expect(pa.stays[0]?.nights.every((n) => n.availability?.available === 1)).toBe(true);

    const results = await Promise.allSettled([
      org.svc.commitChangeSafely(t.db, aishath, { previewToken: pa.token }),
      org.svc.commitChangeSafely(t.db, ibrahim, { previewToken: pb.token }),
    ]);
    const ok = results.filter((r) => r.status === 'fulfilled');
    const failed = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(1);
    const err = failed[0]?.reason as PreviewStaleError;
    expect(err).toBeInstanceOf(PreviewStaleError);
    expect(err.status).toBe(409);
    expect(err.code).toBe('preview_stale');
    const winner = (ok[0] as PromiseFulfilledResult<{ booking: Booking }>).value.booking;
    const winnerName = winner.booker.name === 'Ahmed' ? 'Aishath' : 'Ibrahim';
    const fresh = err.details?.freshPreview as ChangePreview;
    expect(fresh.feasible).toBe(false);
    expect(fresh.blockers[0]?.code).toBe('unavailable');
    expect(fresh.stays[0]?.nights[0]?.availability).toMatchObject({ available: 0, sufficient: false });
    const explanation = ((err.details?.explanation ?? []) as string[]).join(' ');
    expect(explanation).toContain(winner.code);
    expect(explanation).toContain(winnerName);
    expect(explanation).toMatch(/sold \d+ seconds? ago/);
    // "Just sold — here are the alternatives": other unit types with every night free.
    expect(fresh.alternatives.map((a) => a.label)).toEqual(
      expect.arrayContaining(['Beach Villa is available', 'Overwater Villa is available']),
    );
    expect(fresh.alternatives.every((a) => a.preview.feasible)).toBe(true);
    // Ledger consistent: exactly one sold, no oversell.
    const cells = await org.run((tx) =>
      org.inventory.getAvailability(tx, {
        propertyId: org.propertyId,
        unitTypeIds: [org.types.family],
        range: { from: '2026-12-10', to: '2026-12-13' },
      }),
    );
    expect(cells.map((c) => [c.sold, c.available])).toEqual([
      [1, 0],
      [1, 0],
      [1, 0],
    ]);
    // The losing agent can commit an alternative immediately.
    const alt = fresh.alternatives[0];
    const commit = await org.svc.commitChangeSafely(t.db, ibrahim.environment ? ibrahim : ibrahim, {
      previewToken: alt?.preview.token ?? '',
    });
    expect(created(commit).booking.status.booking).toBe('confirmed');
  });

  it('a sequential second commit is refused before any write (stale fingerprint)', async () => {
    const org = await setupOrg(t, { inventory, units: { family: ['F301'] } });
    const req = { kind: 'new_booking' as const, booking: org.booking({}, { unitTypeId: org.types.family }) };
    const p1 = await org.run((tx) => org.svc.previewChange(tx, req));
    const p2 = await org.run((tx) => org.svc.previewChange(tx, req));
    await org.svc.commitChangeSafely(t.db, org.ctx, { previewToken: p1.token });
    const err = await org.svc
      .commitChangeSafely(t.db, org.ctx, { previewToken: p2.token })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PreviewStaleError);
    expect((err as PreviewStaleError).details?.differences).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: 'feasible', from: true, to: false })]),
    );
  });

  it('under load: N agents race for K units — exactly K bookings succeed', async () => {
    const org = await setupOrg(t, { inventory, units: { overwater: ['W201', 'W202', 'W203'] } });
    const attempts = Array.from({ length: 10 }, (_, i) =>
      org.run(
        (tx) =>
          org.svc.createBooking(
            tx,
            org.booking(
              {},
              { unitTypeId: org.types.overwater, arrival: '2026-12-20', departure: '2026-12-23' },
            ),
          ),
        org.user(`agent ${i}`),
      ),
    );
    const results = await Promise.allSettled(attempts);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(3);
    for (const r of results.filter((x): x is PromiseRejectedResult => x.status === 'rejected')) {
      expect((r.reason as { code?: string }).code).toBe('inventory_unavailable');
    }
    const cells = await org.run((tx) =>
      org.inventory.getAvailability(tx, {
        propertyId: org.propertyId,
        unitTypeIds: [org.types.overwater],
        range: { from: '2026-12-20', to: '2026-12-23' },
      }),
    );
    expect(cells.every((c) => c.sold === 3 && c.available === 0)).toBe(true);
  });
});
