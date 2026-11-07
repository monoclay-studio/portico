/**
 * Regression tests from the steward review of feat/inventory-core (docs/orchestration/reviews/review-inventory.md):
 * counterexamples CE1–CE8 now assert the correct behavior, plus the fixes for INV-04/07/10/13/15 and PAR-INV-011.
 * Concurrency tests prove real interleaving: the second transaction is observed waiting on the first one's lock in
 * pg_stat_activity before the first commits (INV-16).
 */
import { type TxContext, withTenantTx } from '@portico/db';
import { newId, systemContext } from '@portico/kernel';
import { platform } from '@portico/platform';
import type { TestDatabase } from '@portico/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { InventoryUnavailableError } from '../src';
import {
  adminQuery,
  assertLedgerConsistent,
  cell,
  createInventoryTestDatabase,
  inventory,
  type PropertyFixture,
  setupProperty,
  stay,
  unitTypeWithUnits,
} from './harness';

let t: TestDatabase;
beforeAll(async () => {
  t = await createInventoryTestDatabase();
});
afterAll(async () => {
  if (t) await assertLedgerConsistent(t);
  await t?.drop();
});

const N = { from: '2026-11-10', to: '2026-11-12' };
const D = '2026-11-10';

async function waitFor(check: () => Promise<boolean>, timeoutMs = 10_000): Promise<void> {
  const started = Date.now();
  while (!(await check())) {
    if (Date.now() - started > timeoutMs) throw new Error('waitFor: condition not met in time');
    await new Promise((r) => setTimeout(r, 20));
  }
}

const someoneWaitsOnALock = async () => {
  const rows = await adminQuery<{ n: number }>(
    t,
    `select count(*)::int as n from pg_stat_activity
      where datname = current_database() and wait_event_type = 'Lock' and application_name = 'portico-test'`,
  );
  return (rows[0]?.n ?? 0) >= 1;
};

/**
 * Run `first` and keep its transaction open; start `second` while it is open, prove `second` waits on a lock held by
 * `first`, then let `first` commit. Returns both outcomes.
 */
async function interleave<A, B>(
  p: PropertyFixture,
  first: (tx: TxContext) => Promise<A>,
  second: (tx: TxContext) => Promise<B>,
): Promise<[PromiseSettledResult<A>, PromiseSettledResult<B>]> {
  let markDone: () => void = () => {};
  const done = new Promise<void>((r) => {
    markDone = r;
  });
  let openGate: () => void = () => {};
  const gate = new Promise<void>((r) => {
    openGate = r;
  });
  const a = withTenantTx(t.db, p.ctx, async (tx) => {
    const r = await first(tx);
    markDone();
    await gate;
    return r;
  });
  await done;
  const b = withTenantTx(t.db, p.ctx, (tx) => second(tx));
  await waitFor(someoneWaitsOnALock);
  openGate();
  return Promise.allSettled([a, b]) as Promise<[PromiseSettledResult<A>, PromiseSettledResult<B>]>;
}

const hold = (p: PropertyFixture, unitTypeId: string, ref: { type: string; id: string }, ms: number) =>
  p.run((tx) =>
    inventory.createHold(tx, {
      propertyId: p.propertyId,
      unitTypeId,
      nights: N,
      quantity: 1,
      expiresAt: new Date(Date.now() + ms),
      ref,
    }),
  );

const sell = (p: PropertyFixture, unitTypeId: string, ref = stay()) =>
  p.run((tx) => inventory.consume(tx, { propertyId: p.propertyId, unitTypeId, nights: N, quantity: 1, ref }));

describe('INV-01: release(ref) with an expired, not yet swept hold (CE1)', () => {
  it('a cancellation with only an expired hold succeeds and changes nothing twice', async () => {
    const p = await setupProperty(t);
    const { type } = await unitTypeWithUnits(p, { code: 'CEA', count: 2 });
    const cart = { type: 'cart', id: newId() };
    const { holdId } = await hold(p, type.id, cart, 1000);
    await new Promise((r) => setTimeout(r, 1200));
    const r = await p.run((tx) => inventory.release(tx, { ref: cart }));
    expect(r.holdsReleased).toEqual([]); // it had already expired (released lazily, not twice)
    expect((await p.run((tx) => inventory.getHold(tx, holdId))).status).toBe('expired');
    expect((await cell(p, type.id, D)).held).toBe(0);
    await assertLedgerConsistent(t);
  });

  it('another active hold on the same night keeps counting (CE1b: no oversell)', async () => {
    const p = await setupProperty(t);
    const { type } = await unitTypeWithUnits(p, { code: 'CEB', count: 2 });
    const cart1 = { type: 'cart', id: newId() };
    await hold(p, type.id, cart1, 1000);
    const { holdId: h2 } = await hold(p, type.id, { type: 'cart', id: newId() }, 3_600_000);
    await new Promise((r) => setTimeout(r, 1200));
    await p.run((tx) => inventory.release(tx, { ref: cart1 }));
    expect(await cell(p, type.id, D)).toMatchObject({ held: 1, available: 1 });
    await sell(p, type.id);
    await expect(sell(p, type.id)).rejects.toBeInstanceOf(InventoryUnavailableError);
    const converted = await p.run((tx) => inventory.convertHold(tx, { holdId: h2, ref: stay() }));
    expect(converted.applied).toBe(true);
    expect(await cell(p, type.id, D)).toMatchObject({ held: 0, sold: 2, available: 0, oversoldBy: 0 });
    await assertLedgerConsistent(t);
  });
});

describe('INV-02: releases are exactly-once under concurrency', () => {
  it('two concurrent cancellations of the same stay give back the villa once (CE2)', async () => {
    const p = await setupProperty(t);
    const { type } = await unitTypeWithUnits(p, { code: 'CEC', count: 2 });
    const a = stay();
    await sell(p, type.id, a);
    await sell(p, type.id); // stay B stays in house
    const [r1, r2] = await interleave(
      p,
      (tx) => inventory.release(tx, { ref: a }),
      (tx) => inventory.release(tx, { ref: a }),
    );
    expect(r1.status).toBe('fulfilled');
    expect(r2.status).toBe('fulfilled');
    const released = [r1, r2].map((r) => (r.status === 'fulfilled' ? r.value.releasedCells.length : -1));
    expect(released.sort()).toEqual([0, 2]); // the second one found nothing left to release
    expect(await cell(p, type.id, D)).toMatchObject({ sold: 1, available: 1 });
    await sell(p, type.id);
    await expect(sell(p, type.id)).rejects.toBeInstanceOf(InventoryUnavailableError);
    await assertLedgerConsistent(t);
  });

  it('a release and a shortening of the same nights do not both subtract (CE6)', async () => {
    const p = await setupProperty(t);
    const { type } = await unitTypeWithUnits(p, { code: 'CEF', count: 2 });
    const a = stay();
    const long = { from: '2026-11-10', to: '2026-11-13' };
    for (const ref of [a, stay()])
      await p.run((tx) =>
        inventory.consume(tx, {
          propertyId: p.propertyId,
          unitTypeId: type.id,
          nights: long,
          quantity: 1,
          ref,
        }),
      );
    const [r1, r2] = await interleave(
      p,
      (tx) =>
        inventory.changeConsumption(tx, {
          ref: a,
          from: { unitTypeId: type.id, nights: long },
          to: { unitTypeId: type.id, nights: { from: '2026-11-10', to: '2026-11-12' } },
        }),
      (tx) => inventory.release(tx, { ref: a, nights: { from: '2026-11-12', to: '2026-11-13' } }),
    );
    expect([r1.status, r2.status]).toEqual(['fulfilled', 'fulfilled']);
    expect(await cell(p, type.id, '2026-11-12')).toMatchObject({ sold: 1, available: 1 });
    await assertLedgerConsistent(t);
  });

  it('a cancellation racing the hold sweeper releases the hold once', async () => {
    const p = await setupProperty(t);
    const { type } = await unitTypeWithUnits(p, { code: 'CEH', count: 2 });
    const cart = { type: 'cart', id: newId() };
    await hold(p, type.id, cart, 1000);
    await new Promise((r) => setTimeout(r, 1200));
    const [r1, r2] = await interleave(
      p,
      (tx) => inventory.expireDueHolds(tx),
      (tx) => inventory.release(tx, { ref: cart }),
    );
    expect([r1.status, r2.status]).toEqual(['fulfilled', 'fulfilled']);
    expect(await cell(p, type.id, D)).toMatchObject({ held: 0, available: 2 });
    await assertLedgerConsistent(t);
  });
});

describe('INV-05: one hold → at most one booking (CE5)', () => {
  it('concurrent conversions of the same hold: one succeeds, the other is told it was converted', async () => {
    const p = await setupProperty(t);
    const { type } = await unitTypeWithUnits(p, { code: 'CEE', count: 3 });
    const { holdId } = await hold(p, type.id, { type: 'cart', id: newId() }, 3_600_000);
    const [r1, r2] = await interleave(
      p,
      (tx) => inventory.convertHold(tx, { holdId, ref: stay() }),
      (tx) => inventory.convertHold(tx, { holdId, ref: stay() }),
    );
    expect(r1.status).toBe('fulfilled');
    expect(r2.status).toBe('rejected');
    expect((r2 as PromiseRejectedResult).reason).toMatchObject({ code: 'hold_already_converted' });
    expect(await cell(p, type.id, D)).toMatchObject({ sold: 1, held: 0, available: 2 });
  });

  it('a released hold cannot be converted; converting onto nights the ref already holds is explained', async () => {
    const p = await setupProperty(t);
    const { type } = await unitTypeWithUnits(p, { code: 'CEI', count: 3 });
    const { holdId } = await hold(p, type.id, { type: 'cart', id: newId() }, 3_600_000);
    await p.run((tx) => inventory.releaseHold(tx, { holdId }));
    await expect(p.run((tx) => inventory.convertHold(tx, { holdId, ref: stay() }))).rejects.toMatchObject({
      code: 'hold_not_active',
    });
    const s = stay();
    await sell(p, type.id, s);
    const { holdId: h2 } = await hold(p, type.id, { type: 'cart', id: newId() }, 3_600_000);
    await expect(p.run((tx) => inventory.convertHold(tx, { holdId: h2, ref: s }))).rejects.toMatchObject({
      code: 'consumption_mismatch',
    });
  });

  it('a hold that expires as the guest presses Book: sold if still free, clear message if not (EC-INV-008)', async () => {
    const p = await setupProperty(t);
    const { type: free } = await unitTypeWithUnits(p, { code: 'CEJ', count: 1 });
    const { type: taken } = await unitTypeWithUnits(p, { code: 'CEK', count: 1 });
    const { holdId: h1 } = await hold(p, free.id, { type: 'cart', id: newId() }, 800);
    const { holdId: h2 } = await hold(p, taken.id, { type: 'cart', id: newId() }, 800);
    await new Promise((r) => setTimeout(r, 1000));
    const ok = await p.run((tx) => inventory.convertHold(tx, { holdId: h1, ref: stay() }));
    expect(ok.applied).toBe(true);
    await sell(p, taken.id); // someone else bought the villa after the hold lapsed
    await expect(p.run((tx) => inventory.convertHold(tx, { holdId: h2, ref: stay() }))).rejects.toMatchObject(
      {
        code: 'inventory_unavailable',
        details: { reason: 'hold_expired_sold' },
        message: expect.stringMatching(/hold on .* expired and the inventory was sold/),
      },
    );
  });
});

async function residences(p: PropertyFixture) {
  const { type: pool, unitIds: villas } = await unitTypeWithUnits(p, { code: 'BPV', count: 4, prefix: 'P' });
  const out = await p.run(async (tx) => {
    const residence = await inventory.createUnitType(tx, p.propertyId, {
      code: 'RES2',
      name: 'Two-Bedroom Residence',
      kind: 'villa',
      noun: 'Residence',
      baseOccupancy: 4,
      maxAdults: 4,
      maxChildren: 2,
      maxOccupancy: 6,
      isComposite: true,
    });
    const r1 = await inventory.createCompositeUnit(tx, p.propertyId, {
      unitTypeId: residence.id,
      number: 'R1',
      componentUnitIds: [villas[0] as string, villas[1] as string],
    });
    const r2 = await inventory.createCompositeUnit(tx, p.propertyId, {
      unitTypeId: residence.id,
      number: 'R2',
      componentUnitIds: [villas[2] as string, villas[3] as string],
    });
    return { residence, r1, r2 };
  });
  return { pool, villas, ...out };
}

describe('INV-04 / INV-09: combined units stay honest (CE3, CE4, CE8)', () => {
  it('assigning component villas cannot silently break a residence hold (CE3)', async () => {
    const p = await setupProperty(t);
    const { pool, villas, residence } = await residences(p);
    const { holdId } = await hold(p, residence.id, { type: 'quote', id: newId() }, 3_600_000);
    const x = stay();
    const y = stay();
    await sell(p, pool.id, x);
    await sell(p, pool.id, y);
    const ax = await p.run((tx) =>
      inventory.assignUnit(tx, { unitId: villas[0] as string, ref: x, nights: N }),
    );
    expect(ax).toMatchObject({ change: 'assigned', conflictsCreated: [] });
    const refused = await p
      .run((tx) => inventory.assignUnit(tx, { unitId: villas[2] as string, ref: y, nights: N }))
      .catch((e: unknown) => e);
    expect(refused).toMatchObject({ code: 'composite_hold_at_risk' });
    expect((refused as Error).message).toMatch(/Choose another unit/);
    // the residence hold is still convertible, and P02 (same residence as P01) was fine for the second stay
    await p.run((tx) => inventory.assignUnit(tx, { unitId: villas[1] as string, ref: y, nights: N }));
    const converted = await p.run((tx) => inventory.convertHold(tx, { holdId, ref: stay() }));
    expect(converted.assignedUnitId).not.toBeNull();
    await assertLedgerConsistent(t);
  });

  it('an explicit override records the conflict it opens and returns it', async () => {
    const p = await setupProperty(t);
    const { pool, villas, residence } = await residences(p);
    await hold(p, residence.id, { type: 'quote', id: newId() }, 3_600_000);
    const x = stay();
    const y = stay();
    await sell(p, pool.id, x);
    await sell(p, pool.id, y);
    await p.run((tx) => inventory.assignUnit(tx, { unitId: villas[0] as string, ref: x, nights: N }));
    const r = await p.run((tx) =>
      inventory.assignUnit(tx, {
        unitId: villas[2] as string,
        ref: y,
        nights: N,
        allowCompositeConflict: true,
      }),
    );
    expect(r.conflictsCreated).toHaveLength(2);
    const conflicts = await p.run((tx) => inventory.listConflicts(tx, { propertyId: p.propertyId }));
    expect(conflicts.every((c) => c.unitTypeId === residence.id && c.causes[0]?.kind === 'assignment')).toBe(
      true,
    );
  });

  it('a residence sale racing an assignment of one of its villas: never both (CE4, interleaved)', async () => {
    const p = await setupProperty(t);
    const { pool, villas, residence, r1 } = await residences(p);
    const z = stay();
    await p.run(async (tx) => {
      await inventory.consume(tx, {
        propertyId: p.propertyId,
        unitTypeId: pool.id,
        nights: N,
        quantity: 1,
        ref: z,
      });
      await inventory.assignUnit(tx, { unitId: villas[2] as string, ref: z, nights: N });
    });
    const x = stay();
    await sell(p, pool.id, x);
    const [assign, sale] = await interleave(
      p,
      (tx) => inventory.assignUnit(tx, { unitId: villas[0] as string, ref: x, nights: N }),
      (tx) =>
        inventory.consume(tx, {
          propertyId: p.propertyId,
          unitTypeId: residence.id,
          nights: N,
          quantity: 1,
          ref: stay(),
        }),
    );
    expect(assign.status).toBe('fulfilled');
    expect(sale.status).toBe('rejected');
    expect((sale as PromiseRejectedResult).reason).toBeInstanceOf(InventoryUnavailableError);
    const rows = await adminQuery<{ unit_id: string }>(
      t,
      'select unit_id from inventory.assignments where unit_id = any($1::uuid[])',
      [[villas[0], villas[1], r1.id]],
    );
    expect(rows.map((r) => r.unit_id)).toEqual([villas[0]]);
  });

  it('a residence sale racing a sale of one of its villa types (interleaved): exactly one succeeds', async () => {
    const p = await setupProperty(t);
    const { pool, residence } = await residences(p);
    await sell(p, pool.id);
    await sell(p, pool.id); // 2 villas left → one residence
    const [res, villa] = await interleave(
      p,
      (tx) =>
        inventory.consume(tx, {
          propertyId: p.propertyId,
          unitTypeId: residence.id,
          nights: N,
          quantity: 1,
          ref: stay(),
        }),
      (tx) =>
        inventory.consume(tx, {
          propertyId: p.propertyId,
          unitTypeId: pool.id,
          nights: N,
          quantity: 1,
          ref: stay(),
        }),
    );
    expect(res.status).toBe('fulfilled');
    expect(villa.status).toBe('rejected');
    expect(await cell(p, pool.id, D)).toMatchObject({ sold: 4, available: 0, oversoldBy: 0 });
  });

  it('a residence stay cannot be left unassigned (CE8); moving it to another residence is fine', async () => {
    const p = await setupProperty(t);
    const { residence, r2 } = await residences(p);
    const s = stay();
    await p.run((tx) =>
      inventory.consume(tx, {
        propertyId: p.propertyId,
        unitTypeId: residence.id,
        nights: N,
        quantity: 1,
        ref: s,
      }),
    );
    await expect(p.run((tx) => inventory.unassignUnit(tx, { ref: s }))).rejects.toMatchObject({
      code: 'composite_must_stay_assigned',
    });
    const moved = await p.run((tx) => inventory.assignUnit(tx, { unitId: r2.id, ref: s, nights: N }));
    expect(moved.change).toBe('moved');
    expect((await cell(p, residence.id, D)).composite).toMatchObject({ unassignedSold: 0 });
  });
});

describe('INV-07: lapsed overbooking allowances open conflicts (CE7, EC-INV-016)', () => {
  it('the sweeper turns an expired allowance with sales inside it into an open conflict', async () => {
    const p = await setupProperty(t);
    const { type } = await unitTypeWithUnits(p, { code: 'CEG', count: 1 });
    await p.run((tx) =>
      inventory.setOverbookingAllowance(tx, p.propertyId, {
        unitTypeId: type.id,
        nights: N,
        quantity: 1,
        reason: 'Expected no-shows',
        expiresAt: new Date(Date.now() + 1000).toISOString(),
      }),
    );
    await sell(p, type.id);
    await sell(p, type.id);
    await new Promise((r) => setTimeout(r, 1200));
    const sys = systemContext(p.tenantId, 'test-sweeper', 'live', newId());
    const r = await withTenantTx(t.db, sys, (tx) => inventory.expireDueAllowances(tx));
    expect(r.expired).toBe(2);
    const c = await cell(p, type.id, D);
    expect(c).toMatchObject({ status: 'oversold', oversoldBy: 1, sellable: 0 });
    expect(c.conflictId).not.toBeNull();
    const conflicts = await p.run((tx) => inventory.listConflicts(tx, { propertyId: p.propertyId }));
    expect(conflicts).toHaveLength(2);
    expect(conflicts[0]?.causes[0]).toMatchObject({ kind: 'allowance_change' });
  });
});

describe('INV-10: ledger consistency check (EC-INV-029)', () => {
  it('reports sold/held that do not match consumption/holds, without correcting them', async () => {
    const p = await setupProperty(t);
    const { type } = await unitTypeWithUnits(p, { code: 'CEL', count: 3 });
    await sell(p, type.id);
    expect(await p.run((tx) => inventory.checkLedgerConsistency(tx, { fromNight: '2026-11-01' }))).toEqual(
      [],
    );
    await adminQuery(
      t,
      `update inventory.ledger set sold = sold + 1 where unit_type_id = $1 and night = $2`,
      [type.id, D],
    );
    const bad = await p.run((tx) => inventory.checkLedgerConsistency(tx, { fromNight: '2026-11-01' }));
    expect(bad).toEqual([
      {
        propertyId: p.propertyId,
        unitTypeId: type.id,
        night: D,
        sold: 2,
        consumed: 1,
        held: 0,
        activeHolds: 0,
      },
    ]);
    const events = await adminQuery<{ n: number }>(
      t,
      `select count(*)::int as n from core.outbox where type = 'inventory.ledger.inconsistent' and tenant_id = $1`,
      [p.tenantId],
    );
    expect(events[0]?.n).toBe(1);
    // not corrected: restore so the file-level consistency assertion passes
    await adminQuery(
      t,
      `update inventory.ledger set sold = sold - 1 where unit_type_id = $1 and night = $2`,
      [type.id, D],
    );
  });
});

describe('PAR-INV-021 / EC-INV-020: house totals and non-negative sellable', () => {
  it('sums physical unit types only; an oversold type publishes 0 while the house still has rooms', async () => {
    const p = await setupProperty(t);
    const { pool, residence } = await residences(p);
    const { type: beach } = await unitTypeWithUnits(p, { code: 'BV', count: 3 });
    await p.run((tx) =>
      inventory.consume(tx, {
        propertyId: p.propertyId,
        unitTypeId: residence.id,
        nights: N,
        quantity: 1,
        ref: stay(),
      }),
    );
    for (let i = 0; i < 4; i++)
      await p.run((tx) =>
        inventory.consume(tx, {
          propertyId: p.propertyId,
          unitTypeId: beach.id,
          nights: N,
          quantity: 1,
          ref: stay(),
          onShortfall: 'record_conflict',
        }),
      );
    const grid = await p.run((tx) =>
      inventory.getAvailabilityGrid(tx, { propertyId: p.propertyId, range: N, unitTypeIds: [beach.id] }),
    );
    expect(grid.cells.every((c) => c.unitTypeId === beach.id)).toBe(true);
    expect(grid.cells[0]).toMatchObject({ available: -1, sellable: 0, oversoldBy: 1 });
    // house: 4 pool villas + 3 beach villas = 7; sold 2 (residence components) + 4 = 6 → 1 net available
    expect(grid.houseTotals[0]).toMatchObject({
      date: D,
      capacity: 7,
      sold: 6,
      available: 1,
      sellable: 1,
      oversoldTypes: 1,
    });
    expect(pool.id).toBeDefined();
  });

  it('reads a two-year horizon in one request (PAR-INV-032)', async () => {
    const p = await setupProperty(t);
    const { type } = await unitTypeWithUnits(p, { code: 'BV', count: 1 });
    const cells = await p.run((tx) =>
      inventory.getAvailability(tx, {
        propertyId: p.propertyId,
        unitTypeIds: [type.id],
        range: { from: '2026-11-07', to: '2028-11-06' },
      }),
    );
    expect(cells.length).toBe(730);
  });
});

describe('PAR-INV-011: preview before a unit leaves inventory', () => {
  it('lists the stays to move and the nights that would oversell, committing nothing', async () => {
    const p = await setupProperty(t);
    const { type, unitIds } = await unitTypeWithUnits(p, { code: 'CEM', count: 2 });
    const guest = stay();
    await p.run(async (tx) => {
      await inventory.consume(tx, {
        propertyId: p.propertyId,
        unitTypeId: type.id,
        nights: N,
        quantity: 1,
        ref: guest,
      });
      await inventory.assignUnit(tx, { unitId: unitIds[0] as string, ref: guest, nights: N });
      await inventory.consume(tx, {
        propertyId: p.propertyId,
        unitTypeId: type.id,
        nights: N,
        quantity: 1,
        ref: stay(),
      });
    });
    const blocked = await p.run((tx) =>
      inventory.previewUnitChange(tx, unitIds[0] as string, { status: 'inactive' }),
    );
    expect(blocked).toMatchObject({ allowed: false, affectedAssignments: [{ ref: guest, nights: N }] });
    expect(blocked.reason).toMatch(/Move them to other units first/);
    const free = await p.run((tx) =>
      inventory.previewUnitChange(tx, unitIds[1] as string, { status: 'inactive' }),
    );
    expect(free).toMatchObject({ allowed: true, affectedAssignments: [] });
    expect(free.oversoldNights.map((n) => n.night)).toEqual(['2026-11-10', '2026-11-11']);
    // nothing changed
    expect((await p.run((tx) => inventory.getUnit(tx, unitIds[1] as string))).status).toBe('active');
    expect(await cell(p, type.id, D)).toMatchObject({ capacity: 2, oversoldBy: 0 });
    expect(
      await p.run((tx) => inventory.listConflicts(tx, { propertyId: p.propertyId, status: 'all' })),
    ).toEqual([]);
  });
});

describe('INV-13: holds beyond the policy maximum need permission', () => {
  it('uses the property policy (default 14 days) and the 180-day ceiling', async () => {
    const p = await setupProperty(t);
    const { type } = await unitTypeWithUnits(p, { code: 'CEN', count: 3 });
    const days = (n: number) => new Date(Date.now() + n * 86_400_000);
    const desk = ['inventory.availability.read'];
    const create = (perms: string[], expiresAt: Date) =>
      p.as(perms, (tx) =>
        inventory.createHold(tx, {
          propertyId: p.propertyId,
          unitTypeId: type.id,
          nights: N,
          quantity: 1,
          expiresAt,
          ref: { type: 'quote', id: newId() },
        }),
      );
    await create(desk, days(10));
    await expect(create(desk, days(20))).rejects.toThrow(/inventory\.availability\.manage/);
    await create([...desk, 'inventory.availability.manage'], days(20));
    await expect(create([...desk, 'inventory.availability.manage'], days(200))).rejects.toThrow(
      /at most 180 days/,
    );
    await p.run((tx) =>
      platform.setPolicy(tx, {
        key: 'inventory.hold.maxDays',
        scopeType: 'property',
        scopeId: p.propertyId,
        value: 30,
        reason: 'Island weddings need longer options',
      }),
    );
    const { holdId } = await create(desk, days(20));
    // extending follows the same rule
    await expect(
      p.as(desk, (tx) => inventory.extendHold(tx, { holdId, expiresAt: days(40) })),
    ).rejects.toThrow(/inventory\.availability\.manage/);
    const extended = await p.as([...desk, 'inventory.availability.manage'], (tx) =>
      inventory.extendHold(tx, { holdId, expiresAt: days(40) }),
    );
    expect(extended.status).toBe('active');
  });
});
