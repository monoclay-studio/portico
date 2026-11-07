/**
 * Tenant isolation (RLS + application) and permissions: every service entry point checks its permission at the
 * RECORD's property (never a caller-declared scope); another organization cannot read or change anything by id;
 * simulator controls never work in live organizations; search is scope-aware.
 */
import { withTenantTx } from '@portico/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { distributionSearch } from '../src/search';
import * as svc from '../src/services';
import { connect, type Harness, runFor, setupOrg, startHarness } from './harness';

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(async () => h?.close());

describe('isolation', () => {
  it('another organization cannot read or change a connection, revision, exception or stop-sell by id', async () => {
    const a = await setupOrg(h);
    const b = await setupOrg(h);
    const c = await connect(a);
    await runFor(a, 2_000);
    const deps = h.dist.deps;
    const rev = await deps.simulator.addRevision(a.tenantId, c.externalPropertyId, {
      status: 'new',
      rooms: [
        {
          roomTypeId: 'RT-XX',
          ratePlanId: 'RP-XX',
          checkin: '2026-12-01',
          checkout: '2026-12-02',
          adults: 1,
          nightly: { '2026-12-01': '100.00' },
        },
      ],
    });
    await deps.simulator.deliver(a.tenantId, c.externalPropertyId, [rev.id]);
    await runFor(a, 1_000);
    const stop = await a.run((tx) =>
      svc.createStopSell(tx, deps, c.connectionId, {
        unitTypeId: null,
        from: '2026-12-01',
        to: '2026-12-02',
        reason: 'test closure',
      }),
    );
    const [r] = await a.run((tx) => svc.listRevisions(tx, c.connectionId));
    const [e] = await a.run((tx) => svc.listExceptions(tx, { connectionId: c.connectionId }));
    const nf = { code: expect.stringMatching(/_not_found$/) };
    await expect(b.run((tx) => svc.getConnection(tx, deps, c.connectionId))).rejects.toMatchObject(nf);
    await expect(b.run((tx) => svc.getHealth(tx, deps, c.connectionId))).rejects.toMatchObject(nf);
    await expect(b.run((tx) => svc.getRevision(tx, r?.id as string))).rejects.toMatchObject(nf);
    await expect(
      b.run((tx) =>
        svc.resolveRevision(tx, deps, r?.id as string, 1, { action: 'dismiss', reason: 'attack' }),
      ),
    ).rejects.toMatchObject(nf);
    await expect(b.run((tx) => svc.resolveException(tx, e?.id as string, 1, 'attack'))).rejects.toMatchObject(
      nf,
    );
    await expect(b.run((tx) => svc.releaseStopSell(tx, deps, stop.id, 1, 'attack'))).rejects.toMatchObject(
      nf,
    );
    await expect(
      b.run((tx) =>
        svc.setRoomMapping(tx, deps, c.connectionId, { unitTypeId: b.water, channelRoomTypeId: 'X' }),
      ),
    ).rejects.toMatchObject(nf);
    await expect(
      b.run((tx) => svc.pauseConnection(tx, deps, c.connectionId, 1, 'attack')),
    ).rejects.toMatchObject(nf);
    // RLS, not only the application: a raw query in B's context sees no row of A.
    const rows = await b.run((tx) => tx.db.selectFrom('distribution.connections').select('id').execute());
    expect(rows.map((x) => x.id)).not.toContain(c.connectionId);
    // Webhooks are routed by endpoint to A's organization only; B's token never authenticates A's endpoint.
    const cb = await connect(b);
    const res = await svc.receiveWebhook(h.t.db, deps, {
      endpointId: c.endpointId,
      headers: { 'x-portico-webhook-token': cb.webhookToken },
      rawBody: '{}',
    });
    expect(res.status).toBe(401);
  });
});

describe('permissions at the record’s property', () => {
  it('each entry point requires its own permission; read does not imply change', async () => {
    const org = await setupOrg(h);
    const c = await connect(org);
    await runFor(org, 2_000);
    const deps = h.dist.deps;
    const reader = (fn: Parameters<typeof org.as>[1]) => org.as(['distribution.channel.read'], fn);
    await expect(reader((tx) => svc.getHealth(tx, deps, c.connectionId))).resolves.toMatchObject({
      connectionId: c.connectionId,
    });
    await expect(
      reader((tx) =>
        svc.getChannelCalendar(tx, deps, c.connectionId, { from: '2026-11-10', to: '2026-11-11' }),
      ),
    ).resolves.toBeDefined();
    const forbidden = { code: 'forbidden' };
    await expect(
      reader((tx) =>
        svc.setRoomMapping(tx, deps, c.connectionId, { unitTypeId: org.water, channelRoomTypeId: 'RT-X' }),
      ),
    ).rejects.toMatchObject(forbidden);
    await expect(reader((tx) => svc.resyncConnection(tx, deps, c.connectionId, {}))).rejects.toMatchObject(
      forbidden,
    );
    await expect(
      reader((tx) =>
        svc.createStopSell(tx, deps, c.connectionId, {
          unitTypeId: null,
          from: '2026-12-01',
          to: '2026-12-02',
          reason: 'x closure',
        }),
      ),
    ).rejects.toMatchObject(forbidden);
    await expect(reader((tx) => svc.pauseConnection(tx, deps, c.connectionId, 1, 'x'))).rejects.toMatchObject(
      forbidden,
    );
    await expect(reader((tx) => svc.rotateWebhookToken(tx, deps, c.connectionId, 1))).rejects.toMatchObject(
      forbidden,
    );
    await expect(reader((tx) => svc.runDiscrepancyCheck(tx, deps, c.connectionId))).rejects.toMatchObject(
      forbidden,
    );
    await expect(
      reader((tx) =>
        svc.injectFault(tx, deps, c.connectionId, { endpoint: 'any', kind: 'server_error', times: 1 }),
      ),
    ).rejects.toMatchObject(forbidden);
    await expect(
      svc.verifyConnection(h.t.db, deps, org.ctxWith(['distribution.channel.read']), c.connectionId),
    ).rejects.toMatchObject(forbidden);
    // Scope: a reader of ANOTHER property is refused on this connection.
    const otherProperty = '01a1b4a0-0000-7000-8000-000000000000';
    await expect(
      org.as(['distribution.channel.read'], (tx) => svc.getHealth(tx, deps, c.connectionId), [otherProperty]),
    ).rejects.toMatchObject(forbidden);
    // The right permission works.
    await expect(
      org.as(['distribution.stopSell.manage'], (tx) =>
        svc.createStopSell(tx, deps, c.connectionId, {
          unitTypeId: org.water,
          from: '2026-12-01',
          to: '2026-12-03',
          reason: 'Renovation',
        }),
      ),
    ).resolves.toMatchObject({ source: 'manual' });
  });

  it('search returns connections and revisions only to readers of their property', async () => {
    const org = await setupOrg(h);
    await connect(org);
    const hits = await withTenantTx(h.t.db, org.ctxWith(['distribution.channel.read']), (tx) =>
      distributionSearch.search(tx, 'Channex', { limit: 10 }),
    );
    expect(hits.some((x) => x.type === 'distribution_connection')).toBe(true);
    const none = await withTenantTx(
      h.t.db,
      org.ctxWith(['distribution.channel.read'], ['01a1b4a0-0000-7000-8000-000000000000']),
      (tx) => distributionSearch.search(tx, 'Channex', { limit: 10 }),
    );
    expect(none).toEqual([]);
  });
});

describe('external identifiers', () => {
  it('a production hub property can be claimed by one active connection across ALL organizations', async () => {
    const a = await setupOrg(h, { environment: 'live' });
    const b = await setupOrg(h, { environment: 'live' });
    const create = (org: typeof a) =>
      org.run((tx) =>
        svc.createConnection(tx, h.dist.deps, {
          propertyId: org.propertyId,
          name: 'Channex',
          externalPropertyId: 'prod-shared-1',
          apiKey: 'prod-key-not-real',
        }),
      );
    await create(a);
    await expect(create(b)).rejects.toMatchObject({ code: 'connection_exists' });
  });
});

describe('simulator and environment', () => {
  it('simulator controls are refused for a real-hub connection and in live organizations', async () => {
    const live = await setupOrg(h, { environment: 'live' });
    const lc = await live.run((tx) =>
      svc.createConnection(tx, h.dist.deps, {
        propertyId: live.propertyId,
        name: 'Channex',
        externalPropertyId: 'prod-x',
        apiKey: 'prod-key-not-real',
      }),
    );
    await expect(
      live.run((tx) => svc.readSimulator(tx, h.dist.deps, lc.connection.id)),
    ).rejects.toMatchObject({ code: 'simulator_not_available' });
    await expect(live.run((tx) => svc.setOutage(tx, h.dist.deps, lc.connection.id, 5))).rejects.toMatchObject(
      { code: 'simulator_not_available' },
    );
  });
  it('a connection never reaches a hub its organization’s environment does not allow (re-checked at call time)', async () => {
    const org = await setupOrg(h, { environment: 'demo' });
    const c = await connect(org);
    // Tamper: pretend the simulator connection points at production.
    await h.t.admin.kysely
      .updateTable('distribution.connections')
      .set({ target: 'production' })
      .where('id', '=', c.connectionId)
      .execute();
    const sent = h.httpSent.length;
    await runFor(org, 3_000);
    expect(h.httpSent.length).toBe(sent);
    const exc = await org.run((tx) =>
      svc.listExceptions(tx, { connectionId: c.connectionId, status: 'open' }),
    );
    expect(exc.find((e) => e.code === 'publication_refused')?.problem).toMatch(
      /may only reach the simulator/,
    );
  });
});
