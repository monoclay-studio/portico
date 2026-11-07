/**
 * Tenant isolation (S17) and permissions: another organization can never read or change a connection, mapping,
 * exception or credential, even with its id; property scope limits what staff see and manage; technical detail
 * is only shown with integration.technical.read.
 */
import { sql } from '@portico/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { integration, integrationSearch } from '../src';
import { activeSimulatorConnection, type Harness, setupOrg, startHarness, tx, userCtx } from './harness';

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(async () => h?.close());

describe('tenant isolation', () => {
  it('another organization cannot read or modify connections, mappings, exceptions or credentials by id', async () => {
    const victim = await setupOrg(h);
    const { conn, account } = await activeSimulatorConnection(h, victim);
    await account.createReservation(h.clock.now(), { roomTypeCode: 'ZZ' });
    await integration.runSync(h.t.db, h.deps, victim.ctx, conn.id, { trigger: 'manual' });
    const [ex] = await tx(h, victim.ctx, (t) =>
      integration.listExceptions(t, { connectionId: conn.id, status: 'unresolved' }),
    );
    const set = await tx(h, victim.ctx, (t) => integration.getMappingSet(t, conn.id));
    const attacker = await setupOrg(h);
    await expect(
      tx(h, attacker.ctx, (t) => integration.getConnection(t, h.deps, conn.id)),
    ).rejects.toMatchObject({ code: 'connection_not_found' });
    expect(await tx(h, attacker.ctx, (t) => integration.listConnections(t, h.deps, {}))).toEqual([]);
    await expect(tx(h, attacker.ctx, (t) => integration.getException(t, ex?.id ?? ''))).rejects.toMatchObject(
      { status: 404 },
    );
    await expect(
      tx(h, attacker.ctx, (t) =>
        integration.reviewMapping(t, h.deps, set.items[0]?.id ?? '', 1, { decision: 'ignore' }),
      ),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      tx(h, attacker.ctx, (t) => integration.pause(t, h.deps, conn.id, conn.version, { reason: 'x' })),
    ).rejects.toMatchObject({ status: 404 });
    expect(await tx(h, attacker.ctx, (t) => integration.listExceptions(t, { status: 'unresolved' }))).toEqual(
      [],
    );
    expect(await tx(h, attacker.ctx, (t) => integrationSearch.search(t, 'Lagoon', { limit: 10 }))).toEqual(
      [],
    );
    // Even the attacker's own simulator account namespace cannot reach the victim's simulated PMS.
    await expect(
      tx(h, attacker.ctx, async (t) => integration.describePmsSimulator(t, h.deps, account.accountId)),
    ).rejects.toMatchObject({ code: 'simulator_not_found' });
    // Row Level Security: a raw query in the attacker's tenant sees none of the victim's rows.
    const rows = await tx(h, attacker.ctx, (t) =>
      sql<{ n: number }>`select count(*)::int as n from integration.inbound_messages`.execute(t.db),
    );
    expect(rows.rows[0]?.n).toBe(0);
  });
});

describe('permissions and property scope', () => {
  it('scopes reads and management to the properties a staff member holds', async () => {
    const org = await setupOrg(h, {
      properties: [
        { code: 'LGN', name: 'Lagoon' },
        { code: 'REF', name: 'Reef' },
      ],
    });
    const { conn } = await activeSimulatorConnection(h, org);
    const [p1, p2] = org.propertyIds as [string, string];
    const reefOnly = userCtx(org, [
      { permission: 'integration.connection.read', propertyIds: [p2] },
      { permission: 'integration.connection.manage', propertyIds: [p2] },
    ]);
    await expect(tx(h, reefOnly, (t) => integration.getConnection(t, h.deps, conn.id))).rejects.toMatchObject(
      { code: 'forbidden' },
    );
    expect(await tx(h, reefOnly, (t) => integration.listConnections(t, h.deps, {}))).toEqual([]);
    const lagoonReader = userCtx(org, [
      { permission: 'integration.connection.read', propertyIds: [p1] },
      { permission: 'platform.property.read', propertyIds: [p1] },
    ]);
    const seen = await tx(h, lagoonReader, (t) => integration.getConnection(t, h.deps, conn.id));
    expect(seen.allowedActions.filter((a) => a.enabled)).toEqual([]);
    expect(seen.allowedActions.find((a) => a.action === 'pause')?.reason).toMatch(/permission/);
    await expect(
      tx(h, lagoonReader, (t) => integration.pause(t, h.deps, conn.id, seen.version, { reason: 'x' })),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      tx(h, lagoonReader, (t) =>
        integration.createConnection(t, h.deps, {
          connectorKey: 'pms.simulator',
          name: 'X',
          propertyIds: [p1],
        }),
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
    // An organization-wide connection needs an organization-wide grant.
    await expect(
      tx(h, userCtx(org, [{ permission: 'integration.connection.manage', propertyIds: [p1, p2] }]), (t) =>
        integration.createConnection(t, h.deps, {
          connectorKey: 'file.csv',
          name: 'Org files',
          propertyIds: [],
        }),
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('shows technical detail only with integration.technical.read; staff see plain English', async () => {
    const org = await setupOrg(h);
    const { conn, account } = await activeSimulatorConnection(h, org);
    await account.createReservation(h.clock.now(), { roomTypeCode: 'QQ' });
    await integration.runSync(h.t.db, h.deps, org.ctx, conn.id, { trigger: 'manual' });
    const staff = userCtx(org, [
      { permission: 'integration.connection.read', propertyIds: [org.propertyId] },
    ]);
    const [forStaff] = await tx(h, staff, (t) =>
      integration.listExceptions(t, { connectionId: conn.id, status: 'unresolved' }),
    );
    expect(forStaff?.technicalDetail).toBeUndefined();
    expect(forStaff?.allowedActions.every((a) => !a.enabled)).toBe(true);
    const admin = userCtx(org, [
      { permission: 'integration.connection.read', propertyIds: [org.propertyId] },
      { permission: 'integration.technical.read', propertyIds: [org.propertyId] },
    ]);
    const [forAdmin] = await tx(h, admin, (t) =>
      integration.listExceptions(t, { connectionId: conn.id, status: 'unresolved' }),
    );
    expect(forAdmin?.technicalDetail).toMatchObject({ externalId: expect.any(String) });
    const log = await tx(h, staff, (t) => integration.listExchanges(t, conn.id, { limit: 5 }));
    expect(log.every((e) => e.detail === undefined)).toBe(true);
  });

  it('exceptions can be owned by a person or department and appear in "My work"', async () => {
    const org = await setupOrg(h);
    const { conn, account } = await activeSimulatorConnection(h, org);
    await account.createReservation(h.clock.now(), { roomTypeCode: 'YY' });
    await integration.runSync(h.t.db, h.deps, org.ctx, conn.id, { trigger: 'manual' });
    const [ex] = await tx(h, org.ctx, (t) =>
      integration.listExceptions(t, { connectionId: conn.id, status: 'unresolved' }),
    );
    const dept = '0190a000-0000-7000-8000-000000000001';
    const assigned = await tx(h, org.ctx, (t) =>
      integration.assignException(t, {
        exceptionId: ex?.id ?? '',
        ownerDepartmentId: dept,
        expectedVersion: ex?.version ?? 0,
      }),
    );
    expect(assigned).toMatchObject({
      owner: { kind: 'department', id: dept },
      status: { exception: 'acknowledged' },
    });
    const { createIntegrationProvider } = await import('../src');
    const provider = createIntegrationProvider(h.deps);
    expect(await tx(h, org.ctx, (t) => provider.listWorkItems(t, { departmentIds: [dept] }))).toHaveLength(1);
    expect(
      await tx(h, org.ctx, (t) =>
        provider.listWorkItems(t, { departmentIds: ['0190a000-0000-7000-8000-000000000002'] }),
      ),
    ).toHaveLength(0);
    // Urgent exceptions cannot be ignored; they are resolved with a note (audited).
    await expect(
      tx(h, org.ctx, (t) =>
        integration.ignoreException(t, {
          exceptionId: assigned.id,
          reason: 'meh',
          expectedVersion: assigned.version,
        }),
      ),
    ).rejects.toMatchObject({
      code: 'urgent_exception_cannot_be_ignored',
    });
    const resolved = await tx(h, org.ctx, (t) =>
      integration.resolveException(t, {
        exceptionId: assigned.id,
        resolution: 'Mapped YY manually',
        expectedVersion: assigned.version,
      }),
    );
    expect(resolved.status.exception).toBe('resolved');
  });
});
