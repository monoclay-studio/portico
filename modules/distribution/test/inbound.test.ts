/**
 * Booking revisions (owner requirements 3 and 4): the webhook receives, authenticates, parses and durably stores
 * each revision; processing is ordered and parks orphans; acknowledgements go back to the hub ONLY after the
 * reservations transaction committed, and are retried until accepted; nothing is applied twice.
 */
import { createHmac } from 'node:crypto';
import { sql, withTenantTx } from '@portico/db';
import { addDays } from '@portico/kernel';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SimBookingInput } from '../src/adapters/channex/simulator';
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
  sys,
  tick,
} from './harness';

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(async () => h?.close());

const d = (n: number) => addDays(BUSINESS_DATE, n);

function room(over: Partial<SimBookingInput['rooms'][number]> = {}): SimBookingInput['rooms'][number] {
  return {
    roomTypeId: 'RT-WV',
    ratePlanId: 'RP-WV-BAR',
    checkin: d(30),
    checkout: d(33),
    adults: 2,
    nightly: { [d(30)]: '500.00', [d(31)]: '500.00', [d(32)]: '500.00' },
    ...over,
  };
}

/** Record a revision at the simulated hub (NOT delivered). */
function hubRevision(
  org: Org,
  c: Connected,
  input: Partial<SimBookingInput> & { status: SimBookingInput['status'] },
) {
  return h.dist.deps.simulator.addRevision(org.tenantId, c.externalPropertyId, { rooms: [room()], ...input });
}
const deliver = (
  org: Org,
  c: Connected,
  ids: string[],
  opts: { duplicate?: number; reverse?: boolean; notificationOnly?: boolean } = {},
) => h.dist.deps.simulator.deliver(org.tenantId, c.externalPropertyId, ids, opts);
const revisions = (org: Org, c: Connected) => org.run((tx) => svc.listRevisions(tx, c.connectionId));
const deliveries = (org: Org, c: Connected) =>
  org.run((tx) =>
    tx.db
      .selectFrom('distribution.inbound_deliveries')
      .selectAll()
      .where('connection_id', '=', c.connectionId)
      .orderBy('received_at')
      .execute(),
  );
const fakeBookings = (org: Org) =>
  org.run((tx) =>
    sql<{ external_id: string; status: string }>`select external_id, status from fake_res.bookings`
      .execute(tx.db)
      .then((r) => r.rows),
  );

async function ready() {
  const org = await setupOrg(h);
  const c = await connect(org);
  await runFor(org, 3_000);
  return { org, c };
}

describe('webhook endpoint: authenticate, parse, store durably', () => {
  it('refuses a wrong or missing token (logged, nothing stored), an unknown endpoint, and another hub property', async () => {
    const { org, c } = await ready();
    const rev = await hubRevision(org, c, { status: 'new' });
    const state = await simState(org, c);
    const [delivery] = (await import('../src/adapters/channex/simulator')).webhookDeliveries(state, [rev.id]);
    const body = delivery?.rawBody ?? '';
    const send = (endpointId: string, headers: Record<string, string>) =>
      svc.receiveWebhook(h.t.db, h.dist.deps, { endpointId, headers, rawBody: body });
    expect(await send(c.endpointId, { 'x-portico-webhook-token': 'wrong' })).toMatchObject({ status: 401 });
    expect(await send(c.endpointId, {})).toMatchObject({ status: 401 });
    expect(
      await send('01a1b49d-0000-7000-8000-000000000000', { 'x-portico-webhook-token': c.webhookToken }),
    ).toMatchObject({ status: 404 });
    expect(await revisions(org, c)).toHaveLength(0);
    expect((await deliveries(org, c)).map((x) => x.outcome)).toEqual(['unauthenticated', 'unauthenticated']);
    const other = await svc.receiveWebhook(h.t.db, h.dist.deps, {
      endpointId: c.endpointId,
      headers: { 'x-portico-webhook-token': c.webhookToken },
      rawBody: body.replace(c.externalPropertyId, 'someone-elses-property'),
    });
    expect(other.status).toBe(422);
    expect(await send(c.endpointId, { 'x-portico-webhook-token': c.webhookToken })).toMatchObject({
      status: 200,
      body: { outcome: 'stored' },
    });
    expect(await revisions(org, c)).toHaveLength(1);
  });

  it('the HMAC verifier accepts a fresh signature and refuses a stale or forged one', async () => {
    const { org, c } = await ready();
    await h.t.admin.kysely
      .updateTable('distribution.connections')
      .set({ webhook_verifier: 'hmac_sha256' })
      .where('id', '=', c.connectionId)
      .execute();
    const rev = await hubRevision(org, c, { status: 'new' });
    const { webhookDeliveries } = await import('../src/adapters/channex/simulator');
    const body = webhookDeliveries(await simState(org, c), [rev.id])[0]?.rawBody ?? '';
    const t = Math.floor(h.clock.now().getTime() / 1000);
    const sig = (secret: string, ts: number) =>
      createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex');
    const send = (header: string) =>
      svc.receiveWebhook(h.t.db, h.dist.deps, {
        endpointId: c.endpointId,
        headers: { 'x-portico-signature': header },
        rawBody: body,
      });
    expect((await send(`t=${t},v1=${sig('forged', t)}`)).status).toBe(401);
    expect((await send(`t=${t - 301},v1=${sig(c.webhookToken, t - 301)}`)).status).toBe(401);
    expect((await send(`t=${t},v1=${sig(c.webhookToken, t)}`)).status).toBe(200);
  });

  it('stores each revision immutably; a redelivery is a logged duplicate; the same id with other content is a conflict', async () => {
    const { org, c } = await ready();
    const rev = await hubRevision(org, c, { status: 'new' });
    await deliver(org, c, [rev.id], { duplicate: 2 });
    const rows = await revisions(org, c);
    expect(rows).toHaveLength(1);
    expect((await deliveries(org, c)).map((x) => x.outcome).sort()).toEqual([
      'duplicate',
      'duplicate',
      'stored',
    ]);
    await expect(
      withTenantTx(h.t.db, sys(org), (tx) =>
        sql`update distribution.inbound_revisions set channel_status = 'cancelled' where id = ${rows[0]?.id}::uuid`.execute(
          tx.db,
        ),
      ),
    ).rejects.toThrow(/permission denied|append-only/);
    // Same revision id, different content (the hub changed it): the first stands, urgent exception.
    await h.dist.deps.simulator.run(org.tenantId, c.externalPropertyId, (s) => {
      const r = s.revisions.find((x) => x.id === rev.id);
      if (r) r.attributes.notes = 'changed after delivery';
    });
    await deliver(org, c, [rev.id]);
    expect(await revisions(org, c)).toHaveLength(1);
    const exc = await org.run((tx) =>
      svc.listExceptions(tx, { connectionId: c.connectionId, status: 'open' }),
    );
    expect(exc.map((e) => e.code)).toContain('revision_conflict');
  });

  it('a notification without the revision (send_data = false) schedules a pull that stores it', async () => {
    const { org, c } = await ready();
    const rev = await hubRevision(org, c, { status: 'new' });
    expect(await deliver(org, c, [rev.id], { notificationOnly: true })).toEqual([
      { revisionId: rev.id, status: 200 },
    ]);
    expect(await revisions(org, c)).toHaveLength(0);
    await tick(org);
    const rows = await revisions(org, c);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ receivedVia: 'feed', status: { revision: 'applied', ack: 'acked' } });
  });
});

describe('acknowledgement only after the reservations transaction committed (DST-I02)', () => {
  it('while the booking transaction is still open, no acknowledgement can be sent; after commit it is', async () => {
    const { org, c } = await ready();
    const rev = await hubRevision(org, c, { status: 'new' });
    await deliver(org, c, [rev.id]);
    let entered!: () => void;
    let release!: () => void;
    const inside = new Promise<void>((r) => {
      entered = r;
    });
    h.reservations.hold = {
      entered,
      gate: new Promise<void>((r) => {
        release = r;
      }),
    };
    const processing = svc.processInbound(h.t.db, h.dist.deps, sys(org), c.connectionId);
    await inside; // the reservations write happened; the transaction is NOT committed
    const early = await svc.dispatchAcks(h.t.db, h.dist.deps, sys(org), c.connectionId);
    expect(early.sent).toBe(0);
    expect((await simState(org, c)).revisions.find((r) => r.id === rev.id)?.acked).toBe(false);
    release();
    await processing;
    const after = await svc.dispatchAcks(h.t.db, h.dist.deps, sys(org), c.connectionId);
    expect(after).toEqual({ sent: 1, acked: 1 });
    expect((await simState(org, c)).revisions.find((r) => r.id === rev.id)?.acked).toBe(true);
  });

  it('a revision that failed to apply is never acknowledged; it retries with backoff and is acked once applied', async () => {
    const { org, c } = await ready();
    h.reservations.mode = { kind: 'unavailable', times: 2 };
    const rev = await hubRevision(org, c, { status: 'new' });
    await deliver(org, c, [rev.id]);
    await tick(org);
    let [r] = await revisions(org, c);
    expect(r).toMatchObject({ status: { revision: 'failed', ack: 'not_due' }, attempts: 1 });
    expect(await fakeBookings(org)).toHaveLength(0); // the savepoint rolled the failed attempt back
    expect((await simState(org, c)).revisions[0]?.acked).toBe(false);
    const exc = await org.run((tx) =>
      svc.listExceptions(tx, { connectionId: c.connectionId, status: 'open' }),
    );
    expect(exc.find((e) => e.code === 'booking_not_applied')?.businessImpact).toMatch(
      /NOT been acknowledged/,
    );
    await runFor(org, 5_000);
    [r] = await revisions(org, c);
    expect(r).toMatchObject({ status: { revision: 'failed' }, attempts: 2 });
    await runFor(org, 10_000);
    [r] = await revisions(org, c);
    expect(r).toMatchObject({
      status: { revision: 'applied', ack: 'acked' },
      attempts: 3,
      outcome: 'created',
    });
    expect((await simState(org, c)).revisions[0]?.acked).toBe(true);
    expect(
      (await org.run((tx) => svc.listExceptions(tx, { connectionId: c.connectionId, status: 'open' }))).map(
        (e) => e.code,
      ),
    ).not.toContain('booking_not_applied');
  });

  it('a revision the reservations module refuses is rejected with a recovery path and NOT acknowledged; dismiss acknowledges', async () => {
    const { org, c } = await ready();
    h.reservations.mode = { kind: 'refuse', times: 1 };
    const rev = await hubRevision(org, c, { status: 'new' });
    await deliver(org, c, [rev.id]);
    await runFor(org, 120_000, 10_000);
    let [r] = await revisions(org, c);
    expect(r).toMatchObject({ status: { revision: 'rejected', ack: 'not_due' } });
    expect(r?.allowedActions.find((a) => a.action === 'retry')?.enabled).toBe(true);
    expect((await simState(org, c)).revisions[0]?.acked).toBe(false);
    // Recovery path 1: retry after fixing the cause.
    r = await org.run((tx) =>
      svc.resolveRevision(tx, h.dist.deps, r?.id as string, r?.version as number, {
        action: 'retry',
        reason: 'Reservations authority restored',
      }),
    );
    await tick(org);
    [r] = await revisions(org, c);
    expect(r).toMatchObject({ status: { revision: 'applied', ack: 'acked' } });
  });

  it('a lost acknowledgement makes the hub resend: the redelivery is a duplicate that is acknowledged again, never applied twice', async () => {
    const { org, c } = await ready();
    const rev = await hubRevision(org, c, { status: 'new' });
    await deliver(org, c, [rev.id]);
    await org.run((tx) =>
      svc.injectFault(tx, h.dist.deps, c.connectionId, {
        endpoint: 'ack',
        kind: 'timeout_after_apply',
        times: 1,
      }),
    );
    await tick(org);
    let [r] = await revisions(org, c);
    expect(r?.status.ack).toBe('failed');
    // The hub did record the ack (timeout after apply), but to be safe it may still resend:
    await deliver(org, c, [rev.id]);
    await runFor(org, 6_000);
    [r] = await revisions(org, c);
    expect(r?.status).toEqual({ revision: 'applied', ack: 'acked' });
    expect(h.reservations.calls.filter((x) => x.externalId === rev.booking_id)).toHaveLength(1);
    expect((await simState(org, c)).revisions[0]?.ack_count).toBeGreaterThanOrEqual(2);
  });
});

describe('ordering, parking and recovery (DST-R09, DST-R11)', () => {
  it('cancel-before-create: the cancellation is parked, then applied after the creation (one booking, cancelled)', async () => {
    const { org, c } = await ready();
    const create = await hubRevision(org, c, { status: 'new' });
    const cancel = await hubRevision(org, c, { status: 'cancelled', bookingId: create.booking_id });
    await deliver(org, c, [cancel.id]);
    // Process before the feed pull runs: the cancellation is parked as an orphan.
    await svc.processInbound(h.t.db, h.dist.deps, sys(org), c.connectionId);
    let rows = await revisions(org, c);
    expect(rows[0]).toMatchObject({
      channelStatus: 'cancelled',
      status: { revision: 'parked', ack: 'not_due' },
      parkReason: 'orphan',
    });
    await deliver(org, c, [create.id]);
    await tick(org);
    rows = await revisions(org, c);
    expect(rows.map((x) => [x.channelStatus, x.status.revision, x.status.ack]).sort()).toEqual([
      ['cancelled', 'applied', 'acked'],
      ['new', 'applied', 'acked'],
    ]);
    expect(await fakeBookings(org)).toEqual([{ external_id: create.booking_id, status: 'cancelled' }]);
    expect(
      h.reservations.calls.filter((x) => x.externalId === create.booking_id).map((x) => x.status),
    ).toEqual(['confirmed', 'cancelled']);
  });

  it('revisions delivered in reverse order are applied in revision order; an older one arriving last is stale', async () => {
    const { org, c } = await ready();
    const r1 = await hubRevision(org, c, { status: 'new' });
    const r2 = await hubRevision(org, c, {
      status: 'modified',
      bookingId: r1.booking_id,
      rooms: [
        room({
          checkout: d(34),
          nightly: { [d(30)]: '500.00', [d(31)]: '500.00', [d(32)]: '500.00', [d(33)]: '500.00' },
        }),
      ],
    });
    const r3 = await hubRevision(org, c, {
      status: 'modified',
      bookingId: r1.booking_id,
      notes: 'Honeymoon',
    });
    await deliver(org, c, [r1.id, r3.id], { reverse: true }); // r3 then r1
    await tick(org);
    expect(h.reservations.calls.filter((x) => x.externalId === r1.booking_id).map((x) => x.status)).toEqual([
      'confirmed',
      'modified',
    ]);
    await deliver(org, c, [r2.id]); // older than r3, arrives last
    await tick(org);
    const byRev = new Map((await revisions(org, c)).map((x) => [x.revisionId, x]));
    expect(byRev.get(r2.id)).toMatchObject({ status: { revision: 'stale', ack: 'acked' } });
    expect(byRev.get(r3.id)).toMatchObject({ status: { revision: 'applied', ack: 'acked' } });
  });

  it('an orphan never matched escalates after 15 minutes; staff can dismiss it (acknowledged on that decision)', async () => {
    const { org, c } = await ready();
    const ghost = await hubRevision(org, c, { status: 'cancelled', bookingId: 'never-created' });
    await deliver(org, c, [ghost.id]);
    await tick(org);
    let [r] = await revisions(org, c);
    expect(r?.status.revision).toBe('parked');
    await runFor(org, 14 * 60_000, 60_000);
    expect(
      (await org.run((tx) => svc.listExceptions(tx, { connectionId: c.connectionId, status: 'open' }))).map(
        (e) => e.code,
      ),
    ).not.toContain('orphan_revision');
    await runFor(org, 2 * 60_000, 60_000);
    const exc = await org.run((tx) =>
      svc.listExceptions(tx, { connectionId: c.connectionId, status: 'open' }),
    );
    expect(exc.find((e) => e.code === 'orphan_revision')).toMatchObject({ severity: 'urgent' });
    expect((await org.run((tx) => svc.getHealth(tx, h.dist.deps, c.connectionId))).health).toBe('failing');
    [r] = await revisions(org, c);
    r = await org.run((tx) =>
      svc.resolveRevision(tx, h.dist.deps, r?.id as string, r?.version as number, {
        action: 'dismiss',
        reason: 'Confirmed with Booking.com: never existed',
      }),
    );
    expect(r.status).toEqual({ revision: 'rejected', ack: 'pending' });
    await tick(org);
    expect((await simState(org, c)).revisions.find((x) => x.id === ghost.id)?.acked).toBe(true);
    expect(
      (await org.run((tx) => svc.listExceptions(tx, { connectionId: c.connectionId, status: 'open' }))).map(
        (e) => e.code,
      ),
    ).not.toContain('orphan_revision');
    // Inverse of dismiss: a dismissed (and acknowledged) revision is never re-opened by Retry.
    const [closed] = await revisions(org, c);
    expect(closed?.allowedActions.find((a) => a.action === 'retry')?.enabled).toBe(false);
    await expect(
      org.run((tx) =>
        svc.resolveRevision(tx, h.dist.deps, closed?.id as string, closed?.version as number, {
          action: 'retry',
          reason: 'second thoughts',
        }),
      ),
    ).rejects.toMatchObject({ code: 'revision_not_retryable' });
  });

  it('missed webhooks are recovered by the feed pull, exactly once, and the gap degrades health', async () => {
    const { org, c } = await ready();
    const a = await hubRevision(org, c, { status: 'new' });
    const b = await hubRevision(org, c, {
      status: 'new',
      rooms: [room({ roomTypeId: 'RT-BV', ratePlanId: 'RP-BV-BAR' })],
    });
    // No webhook at all. The safety-net pull runs every 15 minutes.
    await runFor(org, 16 * 60_000, 60_000);
    const rows = await revisions(org, c);
    expect(rows.map((x) => x.status.revision).sort()).toEqual(['applied', 'applied']);
    expect(rows.every((x) => x.receivedVia === 'feed' && x.status.ack === 'acked')).toBe(true);
    expect(
      h.reservations.calls.filter((x) => [a.booking_id, b.booking_id].includes(x.externalId)),
    ).toHaveLength(2);
    // "Re-request since T" finds nothing new (already ingested) and creates no duplicates.
    const rec = await svc.recoverSince(
      h.t.db,
      h.dist.deps,
      sys(org),
      c.connectionId,
      new Date(h.clock.now().getTime() - 3_600_000),
    );
    expect(rec).toMatchObject({ listed: 2, stored: 0, notAtChannel: 0 });
  });

  it('"re-request since T" ingests bookings whose revisions were already acknowledged elsewhere, and flags extra Portico bookings', async () => {
    const { org, c } = await ready();
    const a = await hubRevision(org, c, { status: 'new' });
    // Someone acknowledged it at the hub (it will never be in the feed).
    await h.dist.deps.simulator.run(org.tenantId, c.externalPropertyId, (s) => {
      const r = s.revisions.find((x) => x.id === a.id);
      if (r) r.acked = true;
    });
    await runFor(org, 16 * 60_000, 60_000);
    expect(await revisions(org, c)).toHaveLength(0);
    const rec = await svc.recoverSince(
      h.t.db,
      h.dist.deps,
      sys(org),
      c.connectionId,
      new Date(h.clock.now().getTime() - 3_600_000),
    );
    expect(rec).toMatchObject({ listed: 1, stored: 1 });
    await tick(org);
    expect((await revisions(org, c))[0]).toMatchObject({
      receivedVia: 'recovery',
      status: { revision: 'applied' },
    });
  });
});

describe('unmapped bookings hold inventory (DST-R10 / DST-I03)', () => {
  it('parks with a provisional hold and an urgent alert; mapping the product applies it and releases the hold', async () => {
    const { org, c } = await ready();
    const held = async () =>
      (
        await org.run((tx) =>
          h.inventory.getAvailability(tx, {
            propertyId: org.propertyId,
            unitTypeIds: [org.water],
            range: { from: d(30), to: d(31) },
          }),
        )
      )[0]?.held;
    expect(await held()).toBe(0);
    const rev = await hubRevision(org, c, { status: 'new', rooms: [room({ ratePlanId: 'RP-PROMO' })] });
    await deliver(org, c, [rev.id]);
    await tick(org);
    let [r] = await revisions(org, c);
    expect(r).toMatchObject({ status: { revision: 'parked', ack: 'not_due' }, parkReason: 'unmapped' });
    expect(await held()).toBe(1);
    const exc = await org.run((tx) =>
      svc.listExceptions(tx, { connectionId: c.connectionId, status: 'open' }),
    );
    expect(exc.find((e) => e.code === 'unmapped_booking')).toMatchObject({
      severity: 'urgent',
      problem: expect.stringMatching(/provisional hold/),
    });
    await org.run((tx) =>
      svc.setRateMapping(tx, h.dist.deps, c.connectionId, {
        unitTypeId: org.water,
        ratePlanId: org.bar,
        channelRatePlanId: 'RP-PROMO',
      }),
    );
    await tick(org);
    [r] = await revisions(org, c);
    expect(r).toMatchObject({ status: { revision: 'applied', ack: 'acked' } });
    expect(await held()).toBe(0);
    expect(
      (await org.run((tx) => svc.listExceptions(tx, { connectionId: c.connectionId, status: 'open' }))).map(
        (e) => e.code,
      ),
    ).not.toContain('unmapped_booking');
  });
  it('with no matching unit type, nothing can be held: the alert says the property total may be overbooked', async () => {
    const { org, c } = await ready();
    const rev = await hubRevision(org, c, {
      status: 'new',
      rooms: [room({ roomTypeId: 'RT-XX', ratePlanId: 'RP-XX' })],
    });
    await deliver(org, c, [rev.id]);
    await tick(org);
    const exc = await org.run((tx) =>
      svc.listExceptions(tx, { connectionId: c.connectionId, status: 'open' }),
    );
    expect(exc.find((e) => e.code === 'unmapped_booking')?.problem).toMatch(
      /property total may be overbooked/,
    );
  });
});

describe('exactly once under concurrency (DST-I01)', () => {
  it('10 concurrent deliveries and 5 concurrent processors: one stored revision, one booking, one acknowledgement', async () => {
    const { org, c } = await ready();
    const rev = await hubRevision(org, c, { status: 'new' });
    const { webhookDeliveries } = await import('../src/adapters/channex/simulator');
    const [one] = webhookDeliveries(await simState(org, c), [rev.id]);
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        svc.receiveWebhook(h.t.db, h.dist.deps, {
          endpointId: c.endpointId,
          headers: one?.headers ?? {},
          rawBody: one?.rawBody ?? '',
        }),
      ),
    );
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(results.filter((r) => r.body.outcome === 'stored')).toHaveLength(1);
    await Promise.all(
      Array.from({ length: 5 }, () => svc.processInbound(h.t.db, h.dist.deps, sys(org), c.connectionId)),
    );
    await Promise.all(
      Array.from({ length: 3 }, () => svc.dispatchAcks(h.t.db, h.dist.deps, sys(org), c.connectionId)),
    );
    expect(h.reservations.calls.filter((x) => x.externalId === rev.booking_id)).toHaveLength(1);
    expect(await fakeBookings(org)).toEqual([{ external_id: rev.booking_id, status: 'confirmed' }]);
    expect((await simState(org, c)).revisions[0]?.ack_count).toBe(1);
  });
});
