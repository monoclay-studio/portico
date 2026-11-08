/**
 * ARI engine (owner requirement 1 and 2): change capture from events (no polling), coalescing, the budget under
 * bursts, last-acknowledged state, rejection classification, backoff, environment safety and data authority.
 */
import { withTenantTx } from '@portico/db';
import { addDays, newId } from '@portico/kernel';
import { platform } from '@portico/platform';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { toDecimalString } from '../src/adapters/channex/wire';
import * as svc from '../src/services';
import {
  BUSINESS_DATE,
  connect,
  type Harness,
  maxPerMinute,
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

async function setPrice(
  org: Awaited<ReturnType<typeof setupOrg>>,
  unitTypeId: string,
  from: string,
  to: string,
  amount: number,
) {
  await org.run((tx) =>
    h.rates.applyPriceUpdate(tx, {
      propertyId: org.propertyId,
      ratePlanId: org.bar,
      unitTypeIds: [unitTypeId],
      ranges: [{ from, to }],
      set: { baseOccupancy: 2, baseAmountMinor: amount },
    }),
  );
}

describe('connect → full resync → the channel holds exactly what Portico publishes', () => {
  it('publishes 400 days of availability and rates in a few large messages, and records the acknowledged state per cell', async () => {
    const org = await setupOrg(h);
    const c = await connect(org);
    await runFor(org, 5_000);
    const s = await simState(org, c);
    // Availability: 2 water villas, 4 beach villas — every night of the 400-day window.
    expect(Object.keys(s.availability['RT-WV'] ?? {})).toHaveLength(400);
    expect(s.availability['RT-WV']?.[d(0)]).toBe(2);
    expect(s.availability['RT-BV']?.[d(399)]).toBe(4);
    expect(s.restrictions['RP-WV-BAR']?.[d(10)]).toMatchObject({ rate: '500.00', stop_sell: false });
    // Few, large messages: one per kind (2 room types × 400 nights compress to 2 values).
    expect(s.log.filter((l) => l.endpoint === 'availability')).toHaveLength(1);
    expect(s.log.filter((l) => l.endpoint === 'restrictions')).toHaveLength(1);
    // DST-I04: every acknowledged cell equals the last accepted payload.
    const states = await org.run((tx) =>
      tx.db
        .selectFrom('distribution.channel_state')
        .selectAll()
        .where('connection_id', '=', c.connectionId)
        .execute(),
    );
    expect(states).toHaveLength(400 * 2 + 400 * 2);
    for (const st of states) {
      if (st.kind === 'availability') {
        const sim = (st.unit_type_id === org.water ? s.availability['RT-WV'] : s.availability['RT-BV'])?.[
          st.stay_date
        ];
        expect(st.last_acked).toEqual({ availability: sim });
      }
    }
    const health = await org.run((tx) => svc.getHealth(tx, h.dist.deps, c.connectionId));
    expect(health).toMatchObject({ health: 'connected', banner: null, provenance: 'simulated' });
    expect(health.lastSuccessfulPushAt).not.toBeNull();
  });
});

describe('change capture is event-driven and coalesced', () => {
  it('fifty price edits in a minute become ONE message carrying only the latest price per night', async () => {
    const org = await setupOrg(h);
    const c = await connect(org);
    await runFor(org, 3_000);
    const before = (await simState(org, c)).log.filter((l) => l.endpoint === 'restrictions').length;
    for (let i = 0; i < 50; i++)
      await setPrice(org, org.water, d(20 + (i % 10)), d(21 + (i % 10)), 60_000 + i * 100);
    // Nothing is captured until the events are consumed (no polling of rates).
    const dirtyBefore = await org.run((tx) =>
      tx.db
        .selectFrom('distribution.ari_dirty')
        .selectAll()
        .where('connection_id', '=', c.connectionId)
        .execute(),
    );
    expect(dirtyBefore).toHaveLength(0);
    await h.drain();
    const dirty = await org.run((tx) =>
      tx.db
        .selectFrom('distribution.ari_dirty')
        .selectAll()
        .where('connection_id', '=', c.connectionId)
        .execute(),
    );
    expect(dirty).toHaveLength(1);
    expect(dirty[0]).toMatchObject({
      kind: 'restrictions',
      merged_deltas: 50,
      ranges: [{ from: d(20), to: d(30) }],
    });
    await runFor(org, 2_000);
    const s = await simState(org, c);
    expect(s.log.filter((l) => l.endpoint === 'restrictions').length - before).toBe(1);
    // Latest value wins per night (edit i=40..49 are the last for each night).
    for (let k = 0; k < 10; k++)
      expect(s.restrictions['RP-WV-BAR']?.[d(20 + k)]?.rate).toBe(`${(60_000 + (40 + k) * 100) / 100}.00`);
    const msgs = await org.run((tx) => svc.listMessages(tx, c.connectionId));
    expect(msgs[0]).toMatchObject({
      kind: 'restrictions',
      coalescedDeltas: 50,
      cellCount: 10,
      status: { message: 'accepted' },
    });
  });

  it('a burst far above the budget never exceeds 10 requests per minute per kind, and every change arrives', async () => {
    const org = await setupOrg(h);
    const c = await connect(org, { settings: { maxCellsPerMessage: 50 } });
    await runFor(org, 60_000, 2_000);
    // 3 minutes of continuous edits: one price change every 2 seconds on a different night.
    for (let i = 0; i < 90; i++) {
      await setPrice(org, org.beach, d(100 + i), d(101 + i), 70_000 + i);
      await h.drain();
      h.clock.advance(2_000);
      await tick(org);
    }
    await runFor(org, 120_000, 5_000);
    const s = await simState(org, c);
    expect(maxPerMinute(s, 'restrictions')).toBeLessThanOrEqual(10);
    expect(maxPerMinute(s, 'availability')).toBeLessThanOrEqual(10);
    for (let i = 0; i < 90; i++)
      expect(s.restrictions['RP-BV-BAR']?.[d(100 + i)]?.rate).toBe(toDecimalString(70_000 + i, 'USD'));
    const dirty = await org.run((tx) =>
      tx.db
        .selectFrom('distribution.ari_dirty')
        .selectAll()
        .where('connection_id', '=', c.connectionId)
        .execute(),
    );
    expect(dirty).toHaveLength(0);
  });
});

describe('concurrency: the budget is reserved atomically', () => {
  it('20 concurrent reservations against a limit of 10 → exactly 10 succeed', async () => {
    const org = await setupOrg(h);
    const c = await connect(org, { activate: false });
    const conn = await org.run((tx) => svc.getConnection(tx, h.dist.deps, c.connectionId));
    expect(conn.status.connection).toBe('setup');
    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        withTenantTx(h.t.db, sys(org), async (tx) => {
          const row = await tx.db
            .selectFrom('distribution.connections')
            .selectAll()
            .where('id', '=', c.connectionId)
            .executeTakeFirstOrThrow();
          return svc.reserveBudget(tx, h.dist.deps, row as never, 'availability');
        }),
      ),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(10);
  });
  it('concurrent dispatchers never build two open messages nor exceed the limit', async () => {
    const org = await setupOrg(h);
    const c = await connect(org);
    await Promise.all(
      Array.from({ length: 8 }, () =>
        svc.dispatchKind(h.t.db, h.dist.deps, sys(org), c.connectionId, 'availability'),
      ),
    );
    const s = await simState(org, c);
    expect(s.log.filter((l) => l.endpoint === 'availability')).toHaveLength(1);
    const open = await org.run((tx) =>
      tx.db
        .selectFrom('distribution.ari_messages')
        .selectAll()
        .where('connection_id', '=', c.connectionId)
        .where('status', 'in', ['queued', 'sending', 'failed_transient'])
        .execute(),
    );
    expect(open).toHaveLength(0);
  });
});

describe('rejections are classified (DST-R04)', () => {
  it('transient errors back off 5 → 10 → 20 s on the SAME message, which absorbs newer changes, then succeed', async () => {
    const org = await setupOrg(h);
    const c = await connect(org);
    await runFor(org, 3_000);
    await org.run((tx) =>
      svc.injectFault(tx, h.dist.deps, c.connectionId, {
        endpoint: 'restrictions',
        kind: 'server_error',
        times: 3,
      }),
    );
    await setPrice(org, org.water, d(5), d(6), 55_500);
    await h.drain();
    await tick(org);
    const first = (await org.run((tx) => svc.listMessages(tx, c.connectionId)))[0];
    expect(first).toMatchObject({ status: { message: 'failed_transient' }, attempts: 1 });
    const t0 = h.clock.now().getTime();
    expect(new Date(first?.nextAttemptAt ?? 0).getTime() - t0).toBe(5_000);
    await setPrice(org, org.water, d(6), d(7), 56_600); // a newer change while failing
    await h.drain();
    await runFor(org, 5_000);
    await runFor(org, 10_000);
    await runFor(org, 20_000);
    const msgs = await org.run((tx) => svc.listMessages(tx, c.connectionId));
    expect(msgs.find((m) => m.id === first?.id)).toMatchObject({
      status: { message: 'accepted' },
      attempts: 4,
      cellCount: 2,
    });
    // One open message per kind: the newer change was absorbed, not queued behind it.
    expect(msgs.filter((m) => m.kind === 'restrictions')).toHaveLength(2);
    const s = await simState(org, c);
    expect(s.restrictions['RP-WV-BAR']?.[d(5)]?.rate).toBe('555.00');
    expect(s.restrictions['RP-WV-BAR']?.[d(6)]?.rate).toBe('566.00');
    const exc = await org.run((tx) => svc.listExceptions(tx, { connectionId: c.connectionId }));
    expect(exc.find((e) => e.code === 'ari_delivery_failing')?.status.exception).toBe('resolved');
    // A failure fixed by a retry within the freshness target never degraded the connection (no protection flapping).
    expect(await org.run((tx) => svc.listStopSells(tx, c.connectionId))).toEqual([]);
  });

  it('a payload error is never retried: exception with a fix, the cells show "not accepted"', async () => {
    const org = await setupOrg(h);
    const c = await connect(org, {
      simRatePlans: [
        { id: 'RP-WV-BAR', roomTypeId: 'RT-WV', minRate: '520.00' },
        { id: 'RP-BV-BAR', roomTypeId: 'RT-BV' },
      ],
    });
    await runFor(org, 3_000);
    // The full resync sent USD 500 for the water villa plan: below the channel's minimum → refused.
    const msgs = await org.run((tx) => svc.listMessages(tx, c.connectionId));
    const restr = msgs.find((m) => m.kind === 'restrictions');
    expect(restr?.status.message).toBe('partially_accepted');
    const cal = await org.run((tx) =>
      svc.getChannelCalendar(tx, h.dist.deps, c.connectionId, { from: d(0), to: d(3), kind: 'restrictions' }),
    );
    expect(cal.filter((x) => x.unitTypeId === org.water).every((x) => x.state === 'not_accepted')).toBe(true);
    expect(cal.filter((x) => x.unitTypeId === org.beach).every((x) => x.state === 'in_sync')).toBe(true);
    const exc = await org.run((tx) => svc.listExceptions(tx, { connectionId: c.connectionId }));
    expect(exc.find((e) => e.code === 'ari_refused')).toMatchObject({
      responsibleParty: 'hotel',
      nextStep: expect.stringMatching(/does not resend/),
    });
    // Not retried: no further restriction request without a new change.
    const before = (await simState(org, c)).log.filter((l) => l.endpoint === 'restrictions').length;
    await runFor(org, 120_000, 10_000);
    expect((await simState(org, c)).log.filter((l) => l.endpoint === 'restrictions').length).toBe(before);
  });

  it('HTTP 429 pauses the connection budget for a minute', async () => {
    const org = await setupOrg(h);
    const c = await connect(org);
    await org.run((tx) =>
      svc.injectFault(tx, h.dist.deps, c.connectionId, {
        endpoint: 'availability',
        kind: 'rate_limit',
        times: 1,
      }),
    );
    await tick(org);
    const health = await org.run((tx) => svc.getHealth(tx, h.dist.deps, c.connectionId));
    expect(health.budget.availability?.pausedUntil).toBe(
      new Date(h.clock.now().getTime() + 60_000).toISOString(),
    );
    await runFor(org, 30_000, 5_000);
    expect((await simState(org, c)).log.filter((l) => l.endpoint === 'availability')).toHaveLength(1);
    await runFor(org, 35_000, 5_000);
    expect(
      (await simState(org, c)).log.filter((l) => l.endpoint === 'availability' && l.status === 200),
    ).toHaveLength(1);
  });

  it('a revoked key stops ARI for that connection only, with an urgent exception (E04)', async () => {
    const org = await setupOrg(h);
    const c = await connect(org);
    await org.run((tx) =>
      svc.injectFault(tx, h.dist.deps, c.connectionId, { endpoint: 'any', kind: 'unauthorized', times: 1 }),
    );
    await tick(org);
    const conn = await org.run((tx) => svc.getConnection(tx, h.dist.deps, c.connectionId));
    expect(conn.status.credentials).toBe('invalid');
    const health = await org.run((tx) => svc.getHealth(tx, h.dist.deps, c.connectionId));
    expect(health).toMatchObject({ health: 'credentials_invalid', banner: { severity: 'urgent' } });
    const before = (await simState(org, c)).log.length;
    await runFor(org, 120_000, 10_000);
    expect((await simState(org, c)).log.length).toBe(before); // nothing sent while the key is refused
    // Re-verify (the hotel restored access): publication resumes, the exception closes itself.
    await svc.verifyConnection(h.t.db, h.dist.deps, org.ctx, c.connectionId);
    await runFor(org, 3_000);
    // Publication resumed. The channel was behind for minutes, so stop-sell protection keeps the last 2 water
    // villas closed during the cool-down; the beach villas (4) are published as they are.
    const after = await simState(org, c);
    expect(after.availability['RT-BV']?.[d(0)]).toBe(4);
    expect(after.availability['RT-WV']?.[d(0)]).toBe(0);
    const cal = await org.run((tx) =>
      svc.getChannelCalendar(tx, h.dist.deps, c.connectionId, { from: d(0), to: d(1), kind: 'availability' }),
    );
    expect(cal.find((x) => x.unitTypeId === org.water)).toMatchObject({
      reason: 'protection',
      state: 'in_sync',
    });
    const exc = await org.run((tx) => svc.listExceptions(tx, { connectionId: c.connectionId }));
    expect(exc.find((e) => e.code === 'credentials_invalid')?.status.exception).toBe('resolved');
  });
});

describe('no dual control (DST-R15 / DST-I05) and environment safety', () => {
  it('nothing is published while an external system is authoritative for availability; a switch back re-sends', async () => {
    const org = await setupOrg(h);
    const c = await connect(org);
    await runFor(org, 3_000);
    const setAuthority = (authority: 'external' | 'portico') =>
      withTenantTx(h.t.db, sys(org), (tx) =>
        platform.setDataAuthority(tx, {
          propertyId: org.propertyId,
          domain: 'availability',
          authority,
          ...(authority === 'external'
            ? { connectionId: newId(), systemName: 'Legacy PMS', writeMode: 'read_only' as const }
            : { writeMode: 'exclusive' as const }),
          reason: 'test',
        }),
      );
    await setAuthority('external');
    await h.drain();
    // A price changes in Portico (rates is still Portico's), but with availability external NO ARI is published.
    await setPrice(org, org.water, d(1), d(2), 77_700);
    await h.drain();
    const before = (await simState(org, c)).log.length;
    await runFor(org, 60_000, 5_000);
    const during = await simState(org, c);
    expect(during.log.length).toBe(before);
    expect(during.restrictions['RP-WV-BAR']?.[d(1)]?.rate).toBe('500.00');
    const health = await org.run((tx) => svc.getHealth(tx, h.dist.deps, c.connectionId));
    expect(health.health).toBe('blocked');
    const exc = await org.run((tx) =>
      svc.listExceptions(tx, { connectionId: c.connectionId, status: 'open' }),
    );
    expect(exc.map((e) => e.code)).toContain('publication_blocked');
    await setAuthority('portico');
    await h.drain();
    await runFor(org, 5_000);
    expect((await simState(org, c)).restrictions['RP-WV-BAR']?.[d(1)]?.rate).toBe('777.00');
  });
  it('activation is refused while another system is authoritative (DST-R15)', async () => {
    const org = await setupOrg(h);
    const c = await connect(org, { activate: false });
    await withTenantTx(h.t.db, sys(org), (tx) =>
      platform.setDataAuthority(tx, {
        propertyId: org.propertyId,
        domain: 'rates',
        authority: 'external',
        connectionId: newId(),
        systemName: 'Legacy PMS',
        writeMode: 'read_only',
        reason: 'test',
      }),
    );
    const v = await org.run((tx) => svc.getConnection(tx, h.dist.deps, c.connectionId));
    await expect(
      org.run((tx) => svc.activateConnection(tx, h.dist.deps, c.connectionId, v.version)),
    ).rejects.toMatchObject({
      code: 'external_system_of_record',
    });
  });
  it('a sandbox organization reaches Channex STAGING only; demo/trial use the simulator; live is refused without live scope', async () => {
    const sandbox = await setupOrg(h, { environment: 'sandbox' });
    const created = await sandbox.run((tx) =>
      svc.createConnection(tx, h.dist.deps, {
        propertyId: sandbox.propertyId,
        name: 'Channex staging',
        externalPropertyId: 'staging-prop-1',
        apiKey: 'staging-key-not-real',
      }),
    );
    expect(created.connection).toMatchObject({ target: 'staging', provenance: 'sandbox' });
    await expect(
      svc.verifyConnection(h.t.db, h.dist.deps, sandbox.ctx, created.connection.id),
    ).rejects.toMatchObject({
      code: 'hub_verification_failed',
    });
    expect(h.httpSent.at(-1)?.url).toMatch(
      /^https:\/\/staging\.channex\.io\/api\/v1\/properties\/staging-prop-1$/,
    );
    expect(h.httpSent.at(-1)?.headers['user-api-key']).toBe('staging-key-not-real');
    const trial = await setupOrg(h, { environment: 'trial' });
    await expect(
      trial.run((tx) =>
        svc.createConnection(tx, h.dist.deps, {
          propertyId: trial.propertyId,
          name: 'x',
          externalPropertyId: 'p',
          apiKey: 'k-12345678',
        }),
      ),
    ).rejects.toMatchObject({ code: 'simulator_only' });
    const live = await setupOrg(h, { environment: 'live' });
    const lc = await live.run((tx) =>
      svc.createConnection(tx, h.dist.deps, {
        propertyId: live.propertyId,
        name: 'Channex',
        externalPropertyId: 'prod-1',
        apiKey: 'prod-key-not-real',
      }),
    );
    expect(lc.connection.target).toBe('production');
    const sent = h.httpSent.length;
    await expect(svc.verifyConnection(h.t.db, h.dist.deps, live.ctx, lc.connection.id)).rejects.toThrow(
      /live channel connections are not allowed/,
    );
    expect(h.httpSent.length).toBe(sent); // refused BEFORE anything left Portico
  });
});
