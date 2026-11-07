/**
 * S20 — A channel integration goes unavailable during a busy shift (docs/scenarios/README.md), distribution part:
 * a 45-minute hub outage at the 18:00 peak.
 *
 * Binding manifest: platform, inventory, rates, integration secrets = REAL; hub = simulator; reservations = strict
 * fake (see scenario-s02 header). Payments' part of S20 belongs to the payments module.
 *
 * Assertion map:
 *  - banners state what is stale and since when; nothing shown as synced while failing → "banner during the outage"
 *  - stop-sell protection closes the last 2 Water Villas on the degraded channel        → "protection closes"
 *  - ARI queued (and coalesced)                                                          → "queued, coalesced, bounded"
 *  - on recovery ARI resent                                                              → "resent on recovery"
 *  - recovery pull ingests 2 OTA bookings made during the outage, one conflict          → "recovery pull"
 *    (the relocation case is reservations' — RES-R34 — and stays with the real provider)
 *  - all queued work resolved; health timeline and recovery actions audited              → "all resolved"
 */
import { addDays, newId } from '@portico/kernel';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { requestInstants } from '../src/adapters/channex/simulator';
import { toDecimalString } from '../src/adapters/channex/wire';
import { maxInAnyWindow } from '../src/domain/budget';
import * as svc from '../src/services';
import {
  BUSINESS_DATE,
  connect,
  type Harness,
  runFor,
  setupOrg,
  simState,
  startHarness,
  tick,
} from './harness';

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(async () => h?.close());

const d = (n: number) => addDays(BUSINESS_DATE, n);

describe('S20 — hub outage at peak (distribution)', () => {
  it('banner, protection, queued and coalesced ARI, resend and recovery pull on recovery, protection released after the cool-down', async () => {
    const org = await setupOrg(h, { water: 2, beach: 4 });
    const c = await connect(org);
    await runFor(org, 3_000);
    const sim = h.dist.deps.simulator;
    const health = () => org.run((tx) => svc.getHealth(tx, h.dist.deps, c.connectionId));

    // 18:00 — the hub goes down for 45 minutes.
    await org.run((tx) => svc.setOutage(tx, h.dist.deps, c.connectionId, 45));
    const outageStart = h.clock.now();
    // Peak-hour changes keep coming: 12 price edits and a beach villa taken by the desk.
    for (let i = 0; i < 12; i++) {
      await org.run((tx) =>
        h.rates.applyPriceUpdate(tx, {
          propertyId: org.propertyId,
          ratePlanId: org.bar,
          unitTypeIds: [org.water, org.beach],
          ranges: [{ from: d(1 + i), to: d(2 + i) }],
          set: { baseOccupancy: 2, baseAmountMinor: 61_000 + i },
        }),
      );
    }
    await org.run((tx) =>
      h.inventory.createHold(tx, {
        propertyId: org.propertyId,
        unitTypeId: org.beach,
        nights: { from: d(0), to: d(1) },
        quantity: 1,
        expiresAt: new Date(h.clock.now().getTime() + 6 * 3_600_000),
        ref: { type: 'desk_sale', id: newId() },
      }),
    );
    await h.drain();
    // The OTAs keep selling during the outage; the hub records the bookings but cannot notify Portico.
    const room = (rt: string, rp: string) => ({
      roomTypeId: rt,
      ratePlanId: rp,
      checkin: d(3),
      checkout: d(5),
      adults: 2,
      nightly: { [d(3)]: '610.00', [d(4)]: '610.00' },
    });
    const b1 = await sim.addRevision(org.tenantId, c.externalPropertyId, {
      status: 'new',
      rooms: [room('RT-WV', 'RP-WV-BAR')],
    });
    const b2 = await sim.addRevision(org.tenantId, c.externalPropertyId, {
      status: 'new',
      rooms: [room('RT-BV', 'RP-BV-BAR')],
    });

    // Banner during the outage: never "connected"; says what is stale and since when.
    await runFor(org, 3 * 60_000, 30_000);
    let hv = await health();
    expect(hv.health).toBe('degraded');
    expect(hv.banner).toMatchObject({ severity: 'warning', staleSince: outageStart.toISOString() });
    expect(hv.banner?.message).toMatch(/NOT confirmed since/);
    // Protection: the last 2 water villas are closed on this channel (recorded, audited, evented).
    expect(hv.protection).toMatchObject({ threshold: 2 });
    const stops = await org.run((tx) => svc.listStopSells(tx, c.connectionId, { status: 'active' }));
    expect(stops).toEqual([
      expect.objectContaining({ source: 'protection', status: { stopSell: 'active', source: 'protection' } }),
    ]);
    await runFor(org, 30 * 60_000, 60_000);
    hv = await health();
    expect(hv).toMatchObject({ health: 'failing', banner: { severity: 'urgent' } });
    // Queued and coalesced: one open message per kind; the hub was never hit more than 10 times a minute.
    expect(hv.queue.openMessages.map((m) => m.kind).sort()).toEqual(['availability', 'restrictions']);
    const during = await simState(org, c);
    expect(maxInAnyWindow(requestInstants(during, 'availability'))).toBeLessThanOrEqual(10);
    expect(maxInAnyWindow(requestInstants(during, 'restrictions'))).toBeLessThanOrEqual(10);
    const exc = await org.run((tx) =>
      svc.listExceptions(tx, { connectionId: c.connectionId, status: 'open' }),
    );
    expect(exc.find((e) => e.code === 'ari_delivery_failing')).toMatchObject({ severity: 'urgent' });

    // 18:45 — the hub is back. One of the two missed bookings conflicts in reservations.
    h.reservations.mode = { kind: 'conflict', times: 1 };
    await runFor(org, 13 * 60_000, 60_000);
    const after = await simState(org, c);
    // Resent on recovery: the latest prices, the desk sale, and the protected (closed) water villas.
    for (let i = 0; i < 12; i++)
      expect(after.restrictions['RP-WV-BAR']?.[d(1 + i)]?.rate).toBe(toDecimalString(61_000 + i, 'USD'));
    expect(after.availability['RT-BV']?.[d(0)]).toBe(3);
    expect(after.availability['RT-WV']?.[d(10)]).toBe(0);
    // Recovery pull: both bookings made during the outage are in Portico exactly once and acknowledged.
    const revs = await org.run((tx) => svc.listRevisions(tx, c.connectionId));
    expect(
      revs.map((r) => [r.channelBookingId, r.receivedVia, r.status.revision, r.status.ack]).sort(),
    ).toEqual(
      [
        [b1.booking_id, 'feed', 'applied', 'acked'],
        [b2.booking_id, 'feed', 'applied', 'acked'],
      ].sort(),
    );
    expect(revs.map((r) => r.outcome).sort()).toEqual(['conflict', 'created']);
    expect(after.revisions.every((r) => r.acked)).toBe(true);

    // Missed bookings were found by a pull: health stays degraded for the gap cool-down (10 min), then protection
    // needs 10 healthy minutes before it is released and every water villa is published again.
    await runFor(org, 5 * 60_000, 60_000);
    expect((await health()).protection).not.toBeNull();
    await runFor(org, 17 * 60_000, 60_000);
    hv = await health();
    expect(hv).toMatchObject({ health: 'connected', banner: null, protection: null });
    const final = await simState(org, c);
    expect(final.availability['RT-WV']?.[d(10)]).toBe(2);
    // All queued work resolved.
    expect(hv.queue).toMatchObject({ dirtyProducts: 0, openMessages: [] });
    expect(hv.revisions).toEqual({ parked: 0, failed: 0, awaitingAck: 0 });
    const open = await org.run((tx) =>
      svc.listExceptions(tx, { connectionId: c.connectionId, status: 'open' }),
    );
    expect(open.map((e) => e.code)).not.toContain('ari_delivery_failing');
    const events = await org.run((tx) =>
      tx.db.selectFrom('core.outbox').select('type').where('type', 'like', 'distribution.%').execute(),
    );
    const types = new Set(events.map((e) => e.type));
    for (const t of [
      'distribution.channel.degraded',
      'distribution.channel.restored',
      'distribution.stopSell.applied',
      'distribution.stopSell.released',
    ]) {
      expect(types.has(t)).toBe(true);
    }
    await tick(org);
  });
});
