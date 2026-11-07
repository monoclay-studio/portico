/** INV-R16: the scheduled sweeper releases expired holds in every organization, once, inside RLS. */
import { runDueJobs } from '@portico/db';
import { newId } from '@portico/kernel';
import type { TestDatabase } from '@portico/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createInventoryJobs } from '../src';
import {
  adminQuery,
  assertLedgerConsistent,
  cell,
  createInventoryTestDatabase,
  dropTestDatabase,
  inventory,
  setupProperty,
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

describe('inventory.expireHolds job', () => {
  it('expires due holds across organizations and emits hold.expired once per hold', async () => {
    const N = { from: '2026-11-10', to: '2026-11-12' };
    const orgs = [await setupProperty(t), await setupProperty(t)];
    const holds: string[] = [];
    const types: string[] = [];
    for (const p of orgs) {
      const { type } = await unitTypeWithUnits(p, { code: 'BV', count: 2 });
      types.push(type.id);
      const { holdId } = await p.run((tx) =>
        inventory.createHold(tx, {
          propertyId: p.propertyId,
          unitTypeId: type.id,
          nights: N,
          quantity: 1,
          expiresAt: new Date(Date.now() + 1000),
          ref: { type: 'cart', id: newId() },
        }),
      );
      holds.push(holdId);
      // a hold that is not due stays active
      await p.run((tx) =>
        inventory.createHold(tx, {
          propertyId: p.propertyId,
          unitTypeId: type.id,
          nights: N,
          quantity: 1,
          expiresAt: new Date(Date.now() + 3600_000),
          ref: { type: 'quote', id: newId() },
        }),
      );
    }
    await new Promise((r) => setTimeout(r, 1100));
    const ran = await runDueJobs(t.db, createInventoryJobs(inventory));
    expect(ran).toEqual(['inventory.expireHolds']);
    for (const [i, p] of orgs.entries()) {
      expect((await p.run((tx) => inventory.getHold(tx, holds[i] as string))).status).toBe('expired');
      const ledger = await adminQuery<{ held: number }>(
        t,
        `select held from inventory.ledger where unit_type_id = $1 and night = '2026-11-10'`,
        [types[i]],
      );
      expect(ledger[0]?.held).toBe(1);
      expect((await cell(p, types[i] as string, '2026-11-10')).held).toBe(1);
    }
    const events = await adminQuery<{ n: number }>(
      t,
      `select count(*)::int as n from core.outbox where type = 'inventory.hold.expired' and payload->>'holdId' = any($1)`,
      [holds],
    );
    expect(events[0]?.n).toBe(2);
    // claimed once per interval: an immediate second run does nothing
    expect(await runDueJobs(t.db, createInventoryJobs(inventory))).toEqual([]);
  });
});
