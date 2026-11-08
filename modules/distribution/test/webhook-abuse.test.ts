/**
 * Abuse resistance of the public webhook receiver (review P2-5; probe B6 inverted). Limits are keyed on the
 * protected endpoint, not on the sender's address (the hub delivers every hotel's webhooks from a few addresses);
 * a delivery that passes the token check is never limited; refused requests cost one aggregated row, never one
 * append-only row each.
 */
import { sql } from '@portico/db';
import { addDays } from '@portico/kernel';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { webhookDeliveries } from '../src/adapters/channex/simulator';
import { WebhookAbuseGuard } from '../src/service/webhooks';
import * as svc from '../src/services';
import {
  BUSINESS_DATE,
  type Connected,
  connect,
  type Harness,
  type Org,
  runFor,
  setupOrg,
  simState,
  startHarness,
} from './harness';

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(async () => h?.close());

async function validBody(org: Org, c: Connected): Promise<string> {
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
  return webhookDeliveries(await simState(org, c), [rev.id])[0]?.rawBody ?? '';
}

const deliveriesOf = (org: Org) =>
  org.run((tx) =>
    sql<{ n: number }>`select count(*)::int as n from distribution.inbound_deliveries`
      .execute(tx.db)
      .then((r) => r.rows[0]?.n ?? 0),
  );

describe('webhook receiver limits (P2-5)', () => {
  it('B6 inverted: a wrong-token flood writes one aggregated row, is answered 429 past the endpoint limit, and never blocks the real hub', async () => {
    const org = await setupOrg(h);
    const c = await connect(org);
    await runFor(org, 2_000);
    const guard = new WebhookAbuseGuard({ refusedPerEndpoint: 30, unknownPerSource: 60, windowMs: 60_000 });
    const body = await validBody(org, c);
    const before = await deliveriesOf(org);
    const statuses: number[] = [];
    for (let i = 0; i < 50; i++) {
      const r = await svc.receiveWebhook(
        h.t.db,
        h.dist.deps,
        {
          endpointId: c.endpointId,
          headers: { 'x-portico-webhook-token': `wrong-${i}` },
          rawBody: body,
          ip: '203.0.113.9',
        },
        guard,
      );
      statuses.push(r.status);
      if (i === 40) {
        // The real hub delivers in the middle of the flood (same shared egress address): accepted.
        const real = await svc.receiveWebhook(
          h.t.db,
          h.dist.deps,
          {
            endpointId: c.endpointId,
            headers: { 'x-portico-webhook-token': c.webhookToken },
            rawBody: body,
            ip: '203.0.113.9',
          },
          guard,
        );
        expect(real).toMatchObject({ status: 200, body: { outcome: 'stored' } });
      }
    }
    expect(statuses.slice(0, 30).every((s) => s === 401)).toBe(true);
    expect(statuses.slice(30).every((s) => s === 429)).toBe(true);
    expect((await deliveriesOf(org)) - before).toBe(1); // only the real delivery
    const rows = await org.run((tx) =>
      sql<{ rejected_total: number }>`select rejected_total from distribution.webhook_rejections`
        .execute(tx.db)
        .then((r) => r.rows),
    );
    expect(rows).toEqual([{ rejected_total: 30 }]);
    const exc = await org.run((tx) =>
      svc.listExceptions(tx, { connectionId: c.connectionId, status: 'open' }),
    );
    expect(exc.filter((e) => e.code === 'webhook_rejected').map((e) => e.occurrences)).toEqual([1]);
  });

  it('the endpoint limit is per endpoint: another organization behind the same hub address is unaffected', async () => {
    const guard = new WebhookAbuseGuard({ refusedPerEndpoint: 5, unknownPerSource: 60, windowMs: 60_000 });
    const a = await setupOrg(h);
    const ca = await connect(a);
    const b = await setupOrg(h);
    const cb = await connect(b);
    const body = await validBody(a, ca);
    for (let i = 0; i < 10; i++)
      await svc.receiveWebhook(
        h.t.db,
        h.dist.deps,
        {
          endpointId: ca.endpointId,
          headers: { 'x-portico-webhook-token': 'wrong' },
          rawBody: body,
          ip: '203.0.113.9',
        },
        guard,
      );
    const other = await svc.receiveWebhook(
      h.t.db,
      h.dist.deps,
      {
        endpointId: cb.endpointId,
        headers: { 'x-portico-webhook-token': 'wrong' },
        rawBody: await validBody(b, cb),
        ip: '203.0.113.9',
      },
      guard,
    );
    expect(other.status).toBe(401); // its own bucket, not exhausted by the flood on A
  });

  it('unknown endpoints are limited per source address', async () => {
    const guard = new WebhookAbuseGuard({ refusedPerEndpoint: 30, unknownPerSource: 3, windowMs: 60_000 });
    const probe = (ip: string) =>
      svc.receiveWebhook(
        h.t.db,
        h.dist.deps,
        { endpointId: '01a1b49d-0000-7000-8000-000000000000', headers: {}, rawBody: '{}', ip },
        guard,
      );
    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) statuses.push((await probe('198.51.100.7')).status);
    expect(statuses).toEqual([404, 404, 404, 429, 429]);
    expect((await probe('198.51.100.8')).status).toBe(404);
  });
});
