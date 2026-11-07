/**
 * Delivery edges of the ARI pipeline: an unknown outcome (timeout after the hub applied the change) is retried
 * safely with the same message; a LATE answer for a send that was already taken over is logged and ignored, and an
 * older message can never overwrite a newer acknowledged state (DST-I04 under reordering, E02 "ARI acceptance out of
 * order").
 */
import { addDays } from '@portico/kernel';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AriResult, HubAdapter } from '../src/adapters/hub';
import type { DistributionDeps } from '../src/service/common';
import * as svc from '../src/services';
import {
  BUSINESS_DATE,
  connect,
  type Harness,
  runFor,
  setupOrg,
  simState,
  startHarness,
  sys,
} from './harness';

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(async () => h?.close());

const d = (n: number) => addDays(BUSINESS_DATE, n);

describe('ARI delivery edges', () => {
  it('a timeout after the hub applied the change is an unknown outcome: retried with the same message id, harmless', async () => {
    const org = await setupOrg(h);
    const c = await connect(org);
    await runFor(org, 3_000);
    await org.run((tx) =>
      svc.injectFault(tx, h.dist.deps, c.connectionId, {
        endpoint: 'restrictions',
        kind: 'timeout_after_apply',
        times: 1,
      }),
    );
    await org.run((tx) =>
      h.rates.applyPriceUpdate(tx, {
        propertyId: org.propertyId,
        ratePlanId: org.bar,
        unitTypeIds: [org.water],
        ranges: [{ from: d(3), to: d(4) }],
        set: { baseOccupancy: 2, baseAmountMinor: 58_800 },
      }),
    );
    await h.drain();
    await runFor(org, 1_000);
    const [m1] = await org.run((tx) => svc.listMessages(tx, c.connectionId));
    expect(m1).toMatchObject({ status: { message: 'failed_transient' }, attempts: 1 });
    expect((await simState(org, c)).restrictions['RP-WV-BAR']?.[d(3)]?.rate).toBe('588.00'); // applied despite the timeout
    await runFor(org, 6_000);
    const [m2] = await org.run((tx) => svc.listMessages(tx, c.connectionId));
    expect(m2).toMatchObject({ id: m1?.id, status: { message: 'accepted' }, attempts: 2 });
    const cal = await org.run((tx) =>
      svc.getChannelCalendar(tx, h.dist.deps, c.connectionId, {
        from: d(3),
        to: d(4),
        kind: 'restrictions',
        unitTypeId: org.water,
      }),
    );
    expect(cal[0]).toMatchObject({ state: 'in_sync', acked: { rateMinor: 58_800 } });
  });

  it('a late answer for a send that was taken over is logged and ignored; it never overwrites newer acknowledged state', async () => {
    const org = await setupOrg(h);
    const c = await connect(org);
    await runFor(org, 3_000);
    let calls = 0;
    // Wrap the real adapter: during the FIRST availability call, time passes beyond the lease and another worker
    // takes the message over, sends the newer value and records it. Then the first call returns "accepted".
    const slow: HubAdapter = {
      ...h.dist.deps.hub,
      async pushAvailability(ctx, runs): Promise<AriResult> {
        calls++;
        if (calls === 1) {
          const answer = await h.dist.deps.hub.pushAvailability(ctx, runs);
          h.clock.advance(61_000);
          await org.run((tx) =>
            h.inventory.createHold(tx, {
              propertyId: org.propertyId,
              unitTypeId: org.beach,
              nights: { from: d(2), to: d(3) },
              quantity: 2,
              expiresAt: new Date(h.clock.now().getTime() + 3_600_000),
              ref: { type: 'cart', id: '01a1b4a0-0000-7000-8000-0000000000aa' },
            }),
          );
          await h.drain();
          await svc.dispatchKind(h.t.db, h.dist.deps, sys(org), c.connectionId, 'availability');
          return answer;
        }
        return h.dist.deps.hub.pushAvailability(ctx, runs);
      },
    };
    const deps: DistributionDeps = { ...h.dist.deps, hub: slow };
    await org.run((tx) =>
      h.inventory.createHold(tx, {
        propertyId: org.propertyId,
        unitTypeId: org.beach,
        nights: { from: d(2), to: d(3) },
        quantity: 1,
        expiresAt: new Date(h.clock.now().getTime() + 3_600_000),
        ref: { type: 'cart', id: '01a1b4a0-0000-7000-8000-0000000000ab' },
      }),
    );
    await h.drain();
    const r = await svc.dispatchKind(h.t.db, deps, sys(org), c.connectionId, 'availability');
    expect(r.outcome).toBe('late');
    const log = await org.run((tx) =>
      tx.db
        .selectFrom('distribution.exchange_log')
        .select('outcome')
        .where('connection_id', '=', c.connectionId)
        .where('operation', '=', 'ari.availability')
        .execute(),
    );
    expect(log.map((x) => x.outcome)).toContain('late_answer_ignored');
    // The newer value (4 − 1 − 2 = 1) is what the channel holds and what Portico records as acknowledged.
    expect((await simState(org, c)).availability['RT-BV']?.[d(2)]).toBe(1);
    const cal = await org.run((tx) =>
      svc.getChannelCalendar(tx, h.dist.deps, c.connectionId, {
        from: d(2),
        to: d(3),
        kind: 'availability',
        unitTypeId: org.beach,
      }),
    );
    expect(cal[0]).toMatchObject({ acked: { availability: 1 }, state: 'in_sync' });
  });
});
