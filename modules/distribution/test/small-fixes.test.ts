/**
 * Review P3 fixes: one Verify at a time and no duplicate webhook registration after a token rotation (P3-1);
 * Dismiss never reaches a revision Portico has not tried (P3-4); search applies the property scope before its limit
 * (P3-5); the daily resync runs at the property's quiet hour (P3-7); a stopped scheduler is visible (P3-8);
 * records carry an owner (P3-9).
 */
import { sql, withTenantTx } from '@portico/db';
import { addDays } from '@portico/kernel';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { distributionSearch } from '../src/search';
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
  tick,
} from './harness';

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(async () => h?.close());

describe('P3-1 webhook registration', () => {
  it('after a token rotation Verify replaces the hub registration (old one removed) and two concurrent Verifies register once', async () => {
    const org = await setupOrg(h);
    const c = await connect(org);
    const conn = await org.run((tx) => svc.getConnection(tx, h.dist.deps, c.connectionId));
    const rotated = await org.run((tx) =>
      svc.rotateWebhookToken(tx, h.dist.deps, c.connectionId, conn.version),
    );
    const results = await Promise.allSettled([
      svc.verifyConnection(h.t.db, h.dist.deps, org.ctx, c.connectionId),
      svc.verifyConnection(h.t.db, h.dist.deps, org.ctx, c.connectionId),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((r) => r.status === 'rejected')).toMatchObject({
      reason: { code: 'verification_in_progress' },
    });
    const s = await simState(org, c);
    expect(s.log.filter((l) => l.endpoint === 'webhook_delete' && l.status === 200)).toHaveLength(1);
    expect(s.log.filter((l) => l.endpoint === 'webhooks')).toHaveLength(2); // connect + this one, never three
    // The hub now delivers with the NEW token only.
    const rev = await h.dist.deps.simulator.addRevision(org.tenantId, c.externalPropertyId, {
      status: 'new',
      rooms: [
        {
          roomTypeId: 'RT-WV',
          ratePlanId: 'RP-WV-BAR',
          checkin: addDays(BUSINESS_DATE, 20),
          checkout: addDays(BUSINESS_DATE, 21),
          adults: 1,
          nightly: { [addDays(BUSINESS_DATE, 20)]: '500.00' },
        },
      ],
    });
    const [d] = await h.dist.deps.simulator.deliver(org.tenantId, c.externalPropertyId, [rev.id]);
    expect(d?.status).toBe(200);
    expect(rotated.webhookToken).toBeTruthy();
  });
});

describe('P3-4 Dismiss', () => {
  it('a revision Portico has not tried yet cannot be dismissed (it is applied automatically)', async () => {
    const org = await setupOrg(h);
    const c = await connect(org);
    await runFor(org, 2_000);
    const rev = await h.dist.deps.simulator.addRevision(org.tenantId, c.externalPropertyId, {
      status: 'new',
      rooms: [
        {
          roomTypeId: 'RT-WV',
          ratePlanId: 'RP-WV-BAR',
          checkin: addDays(BUSINESS_DATE, 20),
          checkout: addDays(BUSINESS_DATE, 21),
          adults: 1,
          nightly: { [addDays(BUSINESS_DATE, 20)]: '500.00' },
        },
      ],
    });
    await h.dist.deps.simulator.deliver(org.tenantId, c.externalPropertyId, [rev.id]); // stored, not processed
    const [r] = await org.run((tx) => svc.listRevisions(tx, c.connectionId));
    expect(r?.status.revision).toBe('received');
    expect(r?.allowedActions.find((a) => a.action === 'dismiss')).toMatchObject({ enabled: false });
    await expect(
      org.run((tx) =>
        svc.resolveRevision(tx, h.dist.deps, r?.id as string, r?.version as number, {
          action: 'dismiss',
          reason: 'too early',
        }),
      ),
    ).rejects.toMatchObject({ code: 'revision_not_tried' });
    expect(r?.owner).toMatchObject({ kind: 'department', id: 'reservations' }); // P3-9
  });
});

describe('P3-5 search and P3-9 owner', () => {
  it('a property-scoped user finds its own connection even when other properties fill the limit; connections carry an owner', async () => {
    const org = await setupOrg(h);
    const c = await connect(org);
    // Twelve other properties' connections in the same organization, all matching the query.
    for (let i = 0; i < 12; i++) {
      await withTenantTx(h.t.db, sys(org), (tx) =>
        sql`insert into distribution.connections
              select (jsonb_populate_record(null::distribution.connections, to_jsonb(x) || jsonb_build_object(
                'id', gen_random_uuid(), 'property_id', gen_random_uuid(), 'webhook_endpoint_id', gen_random_uuid(),
                'external_property_id', ${`other-${i}`}::text, 'name', ${`Channex other ${i}`}::text,
                'verified_at', null))).*
              from distribution.connections x where x.id = ${c.connectionId}::uuid`.execute(tx.db),
      );
    }
    const hits = await withTenantTx(
      h.t.db,
      org.ctxWith(['distribution.channel.read'], [org.propertyId]),
      (tx) => distributionSearch.search(tx, 'Channex', { limit: 5 }),
    );
    expect(hits.map((x) => x.id)).toContain(c.connectionId);
    expect(hits.every((x) => x.propertyId === org.propertyId)).toBe(true);
    const view = await org.run((tx) => svc.getConnection(tx, h.dist.deps, c.connectionId));
    expect(view.owner).toMatchObject({ kind: 'department', id: 'distribution' });
  });
});

describe('P3-7 and P3-8', () => {
  it('the daily resync is scheduled at 03:00 property time; a scheduler silent for 30 minutes shows "failing" on read', async () => {
    const org = await setupOrg(h);
    const c = await connect(org);
    await runFor(org, 2_000);
    const view = await org.run((tx) => svc.getConnection(tx, h.dist.deps, c.connectionId));
    // START is 06:00 UTC = 11:00 in the Maldives (UTC+5): the next 03:00 local is 22:00 UTC the same day.
    expect(view.nextFullSyncAt).toBe('2026-11-07T22:00:00.000Z');
    expect((await org.run((tx) => svc.getHealth(tx, h.dist.deps, c.connectionId))).health).toBe('connected');
    h.clock.advance(30 * 60_000); // no scheduler pass for 30 minutes
    const silent = await org.run((tx) => svc.getHealth(tx, h.dist.deps, c.connectionId));
    expect(silent.health).toBe('failing');
    expect(silent.reason).toContain('has not run since');
    expect(silent.banner?.severity).toBe('urgent');
    await tick(org); // the scheduler is back
    expect((await org.run((tx) => svc.getHealth(tx, h.dist.deps, c.connectionId))).health).not.toBe(
      'failing',
    );
  });
});
