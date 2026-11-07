/**
 * Connection lifecycle and the channel calendar: mapping completeness blocks go-live (DST-R02), channel codes are
 * one-to-one, full and range resync are non-destructive (DST-R05), the nightly resync runs, the discrepancy check
 * finds unexplained differences and heals them (DST-R06), manual stop-sell closes and reopens, disconnect is refused
 * while a booking could be lost, and the key is crypto-shredded on disconnect.
 */
import { sql } from '@portico/db';
import { addDays } from '@portico/kernel';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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

describe('mapping and go-live', () => {
  it('counts sellable products, blocks activation until complete, keeps channel codes one-to-one', async () => {
    const org = await setupOrg(h);
    const deps = h.dist.deps;
    const created = await org.run((tx) =>
      svc.createConnection(tx, deps, {
        propertyId: org.propertyId,
        name: 'Channex',
        simulator: {
          roomTypes: ['RT-WV', 'RT-BV'],
          ratePlans: [
            { id: 'RP-WV-BAR', roomTypeId: 'RT-WV' },
            { id: 'RP-BV-BAR', roomTypeId: 'RT-BV' },
          ],
        },
      }),
    );
    const id = created.connection.id;
    await svc.verifyConnection(h.t.db, deps, org.ctx, id);
    await org.run((tx) =>
      svc.setRoomMapping(tx, deps, id, { unitTypeId: org.water, channelRoomTypeId: 'RT-WV' }),
    );
    await org.run((tx) =>
      svc.setRateMapping(tx, deps, id, {
        unitTypeId: org.water,
        ratePlanId: org.bar,
        channelRatePlanId: 'RP-WV-BAR',
      }),
    );
    const partial = await org.run((tx) => svc.getCompleteness(tx, deps, id));
    expect(partial).toMatchObject({
      mapped: 1,
      total: 2,
      complete: false,
      summary: '1 of 2 sellable product(s) mapped',
    });
    expect(partial.unmapped).toEqual([expect.objectContaining({ unitTypeId: org.beach, missing: 'room' })]);
    const v = (await org.run((tx) => svc.getConnection(tx, deps, id))).version;
    await expect(org.run((tx) => svc.activateConnection(tx, deps, id, v))).rejects.toMatchObject({
      code: 'mapping_incomplete',
    });
    // One channel room type sells one unit type; a channel rate plan needs its room first.
    await expect(
      org.run((tx) =>
        svc.setRoomMapping(tx, deps, id, { unitTypeId: org.beach, channelRoomTypeId: 'RT-WV' }),
      ),
    ).rejects.toMatchObject({
      code: 'channel_room_already_mapped',
    });
    await expect(
      org.run((tx) =>
        svc.setRateMapping(tx, deps, id, {
          unitTypeId: org.beach,
          ratePlanId: org.bar,
          channelRatePlanId: 'RP-BV-BAR',
        }),
      ),
    ).rejects.toMatchObject({ code: 'room_mapping_required' });
    await org.run((tx) =>
      svc.setRoomMapping(tx, deps, id, { unitTypeId: org.beach, channelRoomTypeId: 'RT-BV' }),
    );
    await org.run((tx) =>
      svc.setRateMapping(tx, deps, id, {
        unitTypeId: org.beach,
        ratePlanId: org.bar,
        channelRatePlanId: 'RP-BV-BAR',
      }),
    );
    expect((await org.run((tx) => svc.getCompleteness(tx, deps, id))).complete).toBe(true);
    const v2 = (await org.run((tx) => svc.getConnection(tx, deps, id))).version;
    const active = await org.run((tx) => svc.activateConnection(tx, deps, id, v2));
    expect(active.status.connection).toBe('active');
    // A stale If-Match is a version conflict, never a silent overwrite.
    await expect(org.run((tx) => svc.pauseConnection(tx, deps, id, v2, 'x'))).rejects.toMatchObject({
      code: 'version_conflict',
    });
    // Retiring a room mapping retires its rate mappings (a channel rate plan belongs to its room type).
    const maps = await org.run((tx) => svc.listMappings(tx, id));
    const wv = maps.rooms.find((m) => m.unitTypeId === org.water);
    await org.run((tx) => svc.retireMapping(tx, 'room', wv?.id as string, wv?.version as number));
    const after = await org.run((tx) => svc.listMappings(tx, id));
    expect(after.rooms.map((m) => m.unitTypeId)).toEqual([org.beach]);
    expect(after.rates.map((m) => m.unitTypeId)).toEqual([org.beach]);
  });
});

describe('resync and the channel calendar', () => {
  it('range resync re-sends only that range and never removes anything; the nightly resync runs every 24 h', async () => {
    const org = await setupOrg(h);
    const c = await connect(org);
    await runFor(org, 3_000);
    // Something outside Portico changed the channel (e.g. an extranet edit): the hub now differs on d(100).
    await h.dist.deps.simulator.run(org.tenantId, c.externalPropertyId, (s) => {
      (s.availability['RT-WV'] as Record<string, number>)[d(100)] = 9;
      (s.availability['RT-WV'] as Record<string, number>)[d(5)] = 9;
    });
    const before = await simState(org, c);
    const r = await org.run((tx) =>
      svc.resyncConnection(tx, h.dist.deps, c.connectionId, {
        from: d(0),
        to: d(30),
        kinds: ['availability'],
      }),
    );
    expect(r).toEqual({ products: 2, range: { from: d(0), to: d(30) } });
    await runFor(org, 2_000);
    const after = await simState(org, c);
    expect(after.availability['RT-WV']?.[d(5)]).toBe(2); // repaired
    expect(after.availability['RT-WV']?.[d(100)]).toBe(9); // outside the range: untouched (non-destructive)
    expect(Object.keys(after.availability['RT-WV'] ?? {}).length).toBe(
      Object.keys(before.availability['RT-WV'] ?? {}).length,
    );
    const runs = await org.run((tx) =>
      tx.db
        .selectFrom('distribution.resync_runs')
        .select('trigger')
        .where('connection_id', '=', c.connectionId)
        .execute(),
    );
    expect(runs.map((x) => x.trigger).sort()).toEqual(['connect', 'on_demand']);
    // 24 hours later the nightly full resync runs and repairs d(100) too.
    h.clock.advance(24 * 3_600_000);
    await tick(org);
    await runFor(org, 2_000);
    expect((await simState(org, c)).availability['RT-WV']?.[d(100)]).toBe(2);
    const nightly = await org.run((tx) =>
      tx.db
        .selectFrom('distribution.resync_runs')
        .select('trigger')
        .where('trigger', '=', 'nightly')
        .execute(),
    );
    expect(nightly).toHaveLength(1);
  });

  it('a difference no queued work explains becomes a discrepancy, is re-pushed and resolves itself', async () => {
    const org = await setupOrg(h);
    const c = await connect(org);
    await runFor(org, 3_000);
    // Drift: a price changed in rates WITHOUT an event (simulates a missed event); nothing polls rates, so only
    // the discrepancy check (nightly, or on demand) can find it.
    await h.t.admin.kysely
      .updateTable('rates.prices' as never)
      .set({ base_amount_minor: 52_000 } as never)
      .where('rate_plan_id' as never, '=', org.bar as never)
      .where('stay_date' as never, '=', d(7) as never)
      .where('unit_type_id' as never, '=', org.water as never)
      .execute();
    const cal = await org.run((tx) =>
      svc.getChannelCalendar(tx, h.dist.deps, c.connectionId, {
        from: d(7),
        to: d(8),
        kind: 'restrictions',
        unitTypeId: org.water,
      }),
    );
    expect(cal[0]).toMatchObject({
      state: 'differs',
      expected: { rateMinor: 52_000 },
      acked: { rateMinor: 50_000 },
    });
    const check = await org.run((tx) => svc.runDiscrepancyCheck(tx, h.dist.deps, c.connectionId));
    expect(check).toEqual({ differing: 1, discrepancies: 1 });
    const disc = await org.run((tx) => svc.listDiscrepancies(tx, c.connectionId));
    expect(disc[0]).toMatchObject({ kind: 'rate', status: { discrepancy: 'open' } });
    await runFor(org, 2_000);
    expect((await simState(org, c)).restrictions['RP-WV-BAR']?.[d(7)]?.rate).toBe('520.00');
    await org.run((tx) => svc.runDiscrepancyCheck(tx, h.dist.deps, c.connectionId));
    expect((await org.run((tx) => svc.listDiscrepancies(tx, c.connectionId)))[0]?.status).toEqual({
      discrepancy: 'resolved',
    });
  });

  it('a manual stop-sell closes a unit type on this channel and its release reopens it', async () => {
    const org = await setupOrg(h);
    const c = await connect(org);
    await runFor(org, 3_000);
    const stop = await org.run((tx) =>
      svc.createStopSell(tx, h.dist.deps, c.connectionId, {
        unitTypeId: org.beach,
        from: d(40),
        to: d(43),
        reason: 'Ramadan renovation',
      }),
    );
    await runFor(org, 2_000);
    let s = await simState(org, c);
    expect([d(40), d(41), d(42), d(43)].map((x) => s.availability['RT-BV']?.[x])).toEqual([0, 0, 0, 4]);
    const cal = await org.run((tx) =>
      svc.getChannelCalendar(tx, h.dist.deps, c.connectionId, {
        from: d(40),
        to: d(41),
        kind: 'availability',
        unitTypeId: org.beach,
      }),
    );
    expect(cal[0]).toMatchObject({ reason: 'stop_sell', state: 'in_sync' });
    await org.run((tx) => svc.releaseStopSell(tx, h.dist.deps, stop.id, stop.version, 'Renovation finished'));
    await runFor(org, 2_000);
    s = await simState(org, c);
    expect(s.availability['RT-BV']?.[d(41)]).toBe(4);
    const audit = await org.run((tx) =>
      tx.db
        .selectFrom('core.audit_log')
        .select('action')
        .where('target_id', '=', stop.id)
        .orderBy('occurred_at')
        .execute(),
    );
    expect(audit.map((a) => a.action)).toEqual([
      'distribution.stopSell.applied',
      'distribution.stopSell.released',
    ]);
  });
});

describe('disconnect', () => {
  it('is refused while a booking revision is unsettled; afterwards the key is destroyed and nothing is published', async () => {
    const org = await setupOrg(h);
    const c = await connect(org);
    await runFor(org, 3_000);
    const deps = h.dist.deps;
    h.reservations.mode = { kind: 'unavailable', times: 1 };
    const rev = await deps.simulator.addRevision(org.tenantId, c.externalPropertyId, {
      status: 'new',
      rooms: [
        {
          roomTypeId: 'RT-WV',
          ratePlanId: 'RP-WV-BAR',
          checkin: d(9),
          checkout: d(10),
          adults: 1,
          nightly: { [d(9)]: '500.00' },
        },
      ],
    });
    await deps.simulator.deliver(org.tenantId, c.externalPropertyId, [rev.id]);
    await tick(org);
    let v = (await org.run((tx) => svc.getConnection(tx, deps, c.connectionId))).version;
    await expect(
      org.run((tx) => svc.disconnectConnection(tx, deps, c.connectionId, v, 'switching hubs')),
    ).rejects.toMatchObject({
      code: 'unsettled_bookings',
    });
    await runFor(org, 10_000);
    v = (await org.run((tx) => svc.getConnection(tx, deps, c.connectionId))).version;
    const ref = await org.run((tx) =>
      tx.db
        .selectFrom('distribution.connections')
        .select('credential_ref')
        .where('id', '=', c.connectionId)
        .executeTakeFirstOrThrow(),
    );
    const done = await org.run((tx) =>
      svc.disconnectConnection(tx, deps, c.connectionId, v, 'switching hubs'),
    );
    expect(done.status).toMatchObject({ connection: 'disconnected', health: 'not_active' });
    const secretLeft = await h.t.admin.kysely
      .selectFrom('integration.secrets' as never)
      .select(sql`count(*)::int`.as('n'))
      .where('id' as never, '=', (ref.credential_ref as string).slice(6) as never)
      .executeTakeFirst();
    expect((secretLeft as { n: number }).n).toBe(0);
    const sent = (await simState(org, c)).log.length;
    await org.run((tx) =>
      h.rates.applyPriceUpdate(tx, {
        propertyId: org.propertyId,
        ratePlanId: org.bar,
        unitTypeIds: [org.water],
        ranges: [{ from: d(1), to: d(2) }],
        set: { baseOccupancy: 2, baseAmountMinor: 1 },
      }),
    );
    await h.drain();
    await runFor(org, 60_000, 10_000);
    expect((await simState(org, c)).log.length).toBe(sent);
  });
});
