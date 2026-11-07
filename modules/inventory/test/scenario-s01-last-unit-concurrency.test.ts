/**
 * Scenario 1 (brief §17): two reservation agents attempt to sell the final available villa.
 * Evidence: truly concurrent database transactions — the second agent's transaction is observed WAITING on the
 * first one's row lock in pg_stat_activity before the first commits — end with exactly one success and one
 * InventoryUnavailableError carrying `shortNights`. Also: N parallel sellers, opposite-direction moves (no
 * deadlock surfaced), and a composite vs component race.
 */
import { withTenantTx } from '@portico/db';
import { newId } from '@portico/kernel';
import type { TestDatabase } from '@portico/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { InventoryUnavailableError } from '../src';
import {
  adminQuery,
  assertLedgerConsistent,
  cell,
  createInventoryTestDatabase,
  dropTestDatabase,
  inventory,
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
  await dropTestDatabase(t);
});

const NIGHTS = { from: '2026-12-20', to: '2026-12-24' };
const AGENT = ['inventory.availability.read'];

async function waitFor(check: () => Promise<boolean>, timeoutMs = 10_000): Promise<void> {
  const started = Date.now();
  while (!(await check())) {
    if (Date.now() - started > timeoutMs) throw new Error('waitFor: condition not met in time');
    await new Promise((r) => setTimeout(r, 20));
  }
}

describe('S01 — two agents sell the last villa', () => {
  it('truly concurrent transactions: one sale succeeds, the other gets InventoryUnavailableError with shortNights', async () => {
    const p = await setupProperty(t);
    const { type } = await unitTypeWithUnits(p, {
      code: 'SWVP',
      name: 'Sunset Water Villa with Pool',
      count: 2,
    });
    // one villa already sold on the night of the 22nd → that night has exactly one villa left
    await p.run((tx) =>
      inventory.consume(tx, {
        propertyId: p.propertyId,
        unitTypeId: type.id,
        nights: { from: '2026-12-22', to: '2026-12-23' },
        quantity: 1,
        ref: stay(),
      }),
    );

    let markAConsumed: () => void = () => {};
    const aConsumed = new Promise<void>((r) => {
      markAConsumed = r;
    });
    let openGate: () => void = () => {};
    const gate = new Promise<void>((r) => {
      openGate = r;
    });
    const agentA = p.ctxWith(AGENT, undefined, { kind: 'user', userId: newId(), displayName: 'Agent Aisha' });
    const agentB = p.ctxWith(AGENT, undefined, {
      kind: 'user',
      userId: newId(),
      displayName: 'Agent Ibrahim',
    });
    const stayA = stay();
    const stayB = stay();

    // Agent A sells and keeps the transaction open (rows locked) until the gate opens.
    const saleA = withTenantTx(t.db, agentA, async (tx) => {
      const r = await inventory.consume(tx, {
        propertyId: p.propertyId,
        unitTypeId: type.id,
        nights: NIGHTS,
        quantity: 1,
        ref: stayA,
      });
      markAConsumed();
      await gate;
      return r;
    });
    await aConsumed;
    // Agent B sells the same villa type for the same nights while A's transaction is still open.
    const saleB = withTenantTx(t.db, agentB, (tx) =>
      inventory.consume(tx, {
        propertyId: p.propertyId,
        unitTypeId: type.id,
        nights: NIGHTS,
        quantity: 1,
        ref: stayB,
      }),
    );
    // Proof of true concurrency: B is blocked on A's ledger row lock inside Postgres.
    await waitFor(async () => {
      const rows = await adminQuery<{ n: number }>(
        t,
        `select count(*)::int as n from pg_stat_activity
          where datname = current_database() and wait_event_type = 'Lock' and application_name = 'portico-test'`,
      );
      return (rows[0]?.n ?? 0) >= 1;
    });
    openGate();
    const [a, b] = await Promise.allSettled([saleA, saleB]);

    expect(a.status).toBe('fulfilled');
    expect(b.status).toBe('rejected');
    const err = (b as PromiseRejectedResult).reason;
    expect(err).toBeInstanceOf(InventoryUnavailableError);
    expect(err.code).toBe('inventory_unavailable');
    expect(err.status).toBe(409);
    expect(err.shortNights).toEqual([{ date: '2026-12-22', available: 0 }]);
    expect(err.message).toMatch(/just sold or held — nothing was booked/);

    const night = await cell(p, type.id, '2026-12-22');
    expect(night).toMatchObject({ capacity: 2, sold: 2, available: 0, status: 'sold_out', oversoldBy: 0 });
    // B consumed nothing on any night (all-or-nothing)
    expect((await cell(p, type.id, '2026-12-20')).sold).toBe(1);
    const explanation = await p.run((tx) =>
      inventory.explainAvailability(tx, {
        propertyId: p.propertyId,
        unitTypeId: type.id,
        date: '2026-12-22',
      }),
    );
    expect(explanation.sold.map((s) => s.ref)).toContainEqual(stayA);
    expect(explanation.sold.map((s) => s.ref)).not.toContainEqual(stayB);

    // The winner's sale published coalescible availability changes (unit type + date range).
    const events = await adminQuery<{
      payload: { unitTypeId: string; range: { from: string; to: string }; coalesceKey: string };
    }>(
      t,
      `select payload from core.outbox where type = 'inventory.availability.changed' and tenant_id = $1
        and correlation_id = $2`,
      [p.tenantId, agentA.correlationId],
    );
    expect(events.map((e) => e.payload)).toEqual([
      {
        propertyId: p.propertyId,
        unitTypeId: type.id,
        range: NIGHTS,
        coalesceKey: `inventory.availability:${type.id}`,
        cause: 'consumption',
      },
    ]);
  });

  it('20 agents racing for the last 3 villas: exactly 3 sell, 17 are told what is left', async () => {
    const p = await setupProperty(t);
    const { type } = await unitTypeWithUnits(p, { code: 'BV', count: 3 });
    const results = await Promise.allSettled(
      Array.from({ length: 20 }, () =>
        withTenantTx(t.db, p.ctxWith(AGENT), (tx) =>
          inventory.consume(tx, {
            propertyId: p.propertyId,
            unitTypeId: type.id,
            nights: NIGHTS,
            quantity: 1,
            ref: stay(),
          }),
        ),
      ),
    );
    const ok = results.filter((r) => r.status === 'fulfilled');
    const failed = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(ok).toHaveLength(3);
    expect(failed).toHaveLength(17);
    for (const f of failed) {
      expect(f.reason).toBeInstanceOf(InventoryUnavailableError);
      expect(f.reason.shortNights).toHaveLength(4);
    }
    for (const n of ['2026-12-20', '2026-12-21', '2026-12-22', '2026-12-23']) {
      expect(await cell(p, type.id, n)).toMatchObject({ sold: 3, available: 0, oversoldBy: 0 });
    }
  });

  it('opposite-direction moves between two unit types never surface a deadlock (deterministic lock order)', async () => {
    const p = await setupProperty(t);
    const { type: x } = await unitTypeWithUnits(p, { code: 'XA', count: 12 });
    const { type: y } = await unitTypeWithUnits(p, { code: 'YB', count: 12 });
    const inX = Array.from({ length: 6 }, () => stay());
    const inY = Array.from({ length: 6 }, () => stay());
    await p.run(async (tx) => {
      for (const s of inX)
        await inventory.consume(tx, {
          propertyId: p.propertyId,
          unitTypeId: x.id,
          nights: NIGHTS,
          quantity: 1,
          ref: s,
        });
      for (const s of inY)
        await inventory.consume(tx, {
          propertyId: p.propertyId,
          unitTypeId: y.id,
          nights: NIGHTS,
          quantity: 1,
          ref: s,
        });
    });
    const move = (ref: { type: string; id: string }, from: string, to: string) =>
      withTenantTx(t.db, p.ctxWith(AGENT), (tx) =>
        inventory.changeConsumption(tx, {
          ref,
          from: { unitTypeId: from, nights: NIGHTS },
          to: { unitTypeId: to, nights: NIGHTS },
        }),
      );
    const results = await Promise.allSettled([
      ...inX.map((s) => move(s, x.id, y.id)),
      ...inY.map((s) => move(s, y.id, x.id)),
    ]);
    expect(
      results.filter((r) => r.status === 'rejected').map((r) => (r as PromiseRejectedResult).reason),
    ).toEqual([]);
    expect((await cell(p, x.id, '2026-12-21')).sold).toBe(6);
    expect((await cell(p, y.id, '2026-12-21')).sold).toBe(6);
  });

  it('a two-bedroom residence and one of its villas sold at the same time: never both', async () => {
    const p = await setupProperty(t);
    const { type: pool, unitIds } = await unitTypeWithUnits(p, {
      code: 'BPV',
      name: 'Beach Pool Villa',
      count: 2,
    });
    const residence = await p.run(async (tx) => {
      const type = await inventory.createUnitType(tx, p.propertyId, {
        code: 'RES2',
        name: 'Two-Bedroom Beach Residence',
        kind: 'villa',
        noun: 'Residence',
        baseOccupancy: 4,
        maxAdults: 4,
        maxChildren: 2,
        maxOccupancy: 6,
        isComposite: true,
      });
      await inventory.createCompositeUnit(tx, p.propertyId, {
        unitTypeId: type.id,
        number: 'R1',
        componentUnitIds: unitIds,
      });
      return type;
    });
    for (let round = 0; round < 5; round++) {
      const nights = {
        from: `2027-01-${String(10 + round * 3).padStart(2, '0')}`,
        to: `2027-01-${String(12 + round * 3).padStart(2, '0')}`,
      };
      const results = await Promise.allSettled([
        withTenantTx(t.db, p.ctxWith(AGENT), (tx) =>
          inventory.consume(tx, {
            propertyId: p.propertyId,
            unitTypeId: residence.id,
            nights,
            quantity: 1,
            ref: stay(),
          }),
        ),
        withTenantTx(t.db, p.ctxWith(AGENT), (tx) =>
          inventory.consume(tx, {
            propertyId: p.propertyId,
            unitTypeId: pool.id,
            nights,
            quantity: 1,
            ref: stay(),
          }),
        ),
      ]);
      const winners = results.filter((r) => r.status === 'fulfilled');
      expect(winners).toHaveLength(1);
      const loser = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
      expect(loser?.reason).toBeInstanceOf(InventoryUnavailableError);
      const resCell = await cell(p, residence.id, nights.from);
      const poolCell = await cell(p, pool.id, nights.from);
      expect(resCell.available).toBe(0);
      expect(poolCell.oversoldBy).toBe(0);
    }
  });
});
