/**
 * Owner requirement 2 under clock differences (review P2-2; probe A5 inverted). The production budget is accounted
 * on the DATABASE clock, read under the budget row lock: workers whose own clocks differ share one clock, so none
 * can erase another's slots or spend more than the limit in a window. (Every other test simulates time with the
 * transaction clock — `budgetClock: 'transaction'` in the harness.)
 */
import { withTenantTx } from '@portico/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConnection } from '../src/service/common';
import * as svc from '../src/services';
import { connect, type Harness, runFor, setupOrg, startHarness, sys } from './harness';

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(async () => h?.close());

describe('the budget runs on one shared clock (P2-2)', () => {
  it('A5 inverted: two workers whose clocks differ by 2 s are granted the limit, not twice it, and no slot is erased', async () => {
    const org = await setupOrg(h);
    const c = await connect(org, { activate: false }); // nothing else spends this budget
    await runFor(org, 1_000);
    const deps = { ...h.dist.deps, config: { ...h.dist.deps.config, budgetClock: 'database' as const } };
    const ahead = { ...h.t.db, clock: { now: () => new Date(Date.now() + 2_000) } };
    const behind = { ...h.t.db, clock: { now: () => new Date(Date.now() - 2_000) } };
    let granted = 0;
    for (const worker of [ahead, behind, ahead, behind]) {
      for (let i = 0; i < 5; i++) {
        const r = await withTenantTx(worker, sys(org), async (tx) =>
          svc.reserveBudget(tx, deps, await loadConnection(tx, c.connectionId), 'availability'),
        );
        if (r.ok) granted++;
      }
    }
    expect(granted).toBe(10);
    const row = await h.t.admin.kysely
      .selectFrom('distribution.ari_budget')
      .select('sends')
      .where('connection_id', '=', c.connectionId)
      .where('kind', '=', 'availability')
      .executeTakeFirstOrThrow();
    expect((row.sends as unknown[]).length).toBe(10);
  });

  it('a worker whose clock runs a minute fast cannot spend slots that are still live (only the shared clock prevents it)', async () => {
    const org = await setupOrg(h);
    const c = await connect(org, { activate: false });
    const fast = { ...h.t.db, clock: { now: () => new Date(Date.now() + 61_000 + 2_000) } };
    const reserve = (worker: typeof fast, clock: 'database' | 'transaction') =>
      withTenantTx(worker, sys(org), async (tx) =>
        svc.reserveBudget(
          tx,
          { config: { ...h.dist.deps.config, budgetClock: clock } },
          await loadConnection(tx, c.connectionId),
          'availability',
        ),
      );
    const realNow = { ...h.t.db, clock: { now: () => new Date() } };
    for (let i = 0; i < 10; i++) expect((await reserve(realNow, 'database')).ok).toBe(true);
    // On the database clock the fast worker sees the same minute: refused.
    expect((await reserve(fast, 'database')).ok).toBe(false);
    // Contrast (why the shared clock matters): trusting its own clock, the fast worker would be granted a slot the
    // hub still counts — an 11th request inside the same real minute.
    expect((await reserve(fast, 'transaction')).ok).toBe(true);
  });

  it('20 concurrent reservations on the database clock → exactly 10 succeed', async () => {
    const org = await setupOrg(h);
    const c = await connect(org, { activate: false });
    const deps = { ...h.dist.deps, config: { ...h.dist.deps.config, budgetClock: 'database' as const } };
    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        withTenantTx(h.t.db, sys(org), async (tx) =>
          svc.reserveBudget(tx, deps, await loadConnection(tx, c.connectionId), 'restrictions'),
        ),
      ),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(10);
  });
});
