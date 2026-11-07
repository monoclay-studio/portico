/**
 * Defense-in-depth layers that no current code path reaches, proven directly (so a future path cannot slip past
 * them): the database refuses an acknowledgement due for an unsettled revision (DST-I02 at rest), and an older
 * message's acceptance never overwrites a newer acknowledged cell (DST-I04 under reordering).
 */
import { sql, withTenantTx } from '@portico/db';
import { addDays } from '@portico/kernel';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as svc from '../src/services';
import { BUSINESS_DATE, connect, type Harness, runFor, setupOrg, startHarness, sys } from './harness';

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(async () => h?.close());

describe('invariants enforced by the database', () => {
  it('an acknowledgement can never be due for a revision that is received, failed or parked (CHECK)', async () => {
    const org = await setupOrg(h);
    const c = await connect(org);
    await runFor(org, 2_000);
    h.reservations.mode = { kind: 'unavailable', times: 1 };
    const rev = await h.dist.deps.simulator.addRevision(org.tenantId, c.externalPropertyId, {
      status: 'new',
      rooms: [{ roomTypeId: 'RT-WV', ratePlanId: 'RP-WV-BAR', checkin: addDays(BUSINESS_DATE, 9), checkout: addDays(BUSINESS_DATE, 10), adults: 1, nightly: { [addDays(BUSINESS_DATE, 9)]: '500.00' } }],
    });
    await h.dist.deps.simulator.deliver(org.tenantId, c.externalPropertyId, [rev.id]);
    await svc.processInbound(h.t.db, h.dist.deps, sys(org), c.connectionId);
    const [r] = await org.run((tx) => svc.listRevisions(tx, c.connectionId));
    expect(r?.status.revision).toBe('failed');
    for (const state of ['received', 'failed', 'parked']) {
      await expect(
        withTenantTx(h.t.db, sys(org), (tx) =>
          sql`update distribution.revision_processing set state = ${state}, ack_state = 'pending' where revision_row_id = ${r?.id}::uuid`.execute(tx.db),
        ),
      ).rejects.toMatchObject({ code: '23514' });
    }
  });

  it('a late acceptance of an OLDER message never overwrites a newer acknowledged cell (sequence guard)', async () => {
    const org = await setupOrg(h);
    const c = await connect(org);
    await runFor(org, 3_000);
    const date = addDays(BUSINESS_DATE, 2);
    const cell = (availability: number) => ({ u: org.water, r: null, d: date, v: { availability }, i: 0 });
    await withTenantTx(h.t.db, sys(org), async (tx) => {
      await svc.upsertChannelState(tx, c.connectionId, 'availability', { id: '01a1b4a0-0000-7000-8000-00000000ff02', seq: 1_000_002 }, [cell(7)]);
      await svc.upsertChannelState(tx, c.connectionId, 'availability', { id: '01a1b4a0-0000-7000-8000-00000000ff01', seq: 1_000_001 }, [cell(5)]);
    });
    const cal = await org.run((tx) => svc.getChannelCalendar(tx, h.dist.deps, c.connectionId, { from: date, to: addDays(date, 1), kind: 'availability', unitTypeId: org.water }));
    expect(cal[0]?.acked).toEqual({ availability: 7 });
  });
});
