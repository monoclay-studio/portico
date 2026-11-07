/**
 * P2-13: per-table tenant isolation for the enterprise identity and platform records. Organization B (acting with
 * full permissions) can neither read nor change organization A's records, even when it knows their ids.
 */
import { newId } from '@portico/kernel';
import { platform } from '@portico/platform';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { identity } from '../src';
import { fakeIdp } from './fake-idp';
import { type Harness, harness, org, signInWithMfa } from './harness';

let h: Harness;
const issuer = 'https://idp.isolation.test';
beforeAll(async () => {
  const idp = await fakeIdp(issuer, 'c', 'secret');
  h = await harness({ oidcHttp: idp.http });
});
afterAll(async () => h?.t.drop());

describe('P2-13: another organization cannot read or change identity records by id', () => {
  it('members, roles, API clients, elevations, alerts, SSO, SCIM groups, MFA factors and approvals stay in A', async () => {
    const a = await org(h, { name: 'Org A' });
    const b = await org(h, { name: 'Org B' });
    const pa = await a.property('ISO');
    const member = await a.member([{ roleKey: 'front_desk', scopeType: 'property', scopeId: pa.id }]);
    const role = await a.tx((tx) =>
      identity.createRole(tx, h.ports, {
        key: 'iso_role',
        name: 'Iso',
        permissions: ['platform.property.read'],
      }),
    );
    const client = await a.tx((tx) =>
      identity.createApiClient(tx, { name: 'A bot', permissions: ['platform.property.read'] }),
    );
    await a.tx((tx) => identity.updateSecurityPolicy(tx, 0, { breakGlassUserIds: [member.userId] }));
    const m = await signInWithMfa(h, member.email);
    const elevation = await a.tx(
      (tx) =>
        identity.startElevation(tx, h.ports, {
          reason: 'Isolation test: night manager unreachable',
          durationMinutes: 10,
        }),
      m.ctx,
    );
    const alert = (await a.tx((tx) => identity.listSecurityAlerts(tx)))[0];
    if (!alert) throw new Error('expected an alert in A');
    await a.tx((tx) =>
      identity.configureSso(tx, h.ports, {
        displayName: 'A IdP',
        issuer,
        clientId: 'c',
        clientSecret: 'secret',
        allowedEmailDomains: ['lagoon.mv'],
      }),
    );
    const group = await a.tx((tx) =>
      identity.scimCreateGroup(tx, h.ports, 'https://api.test/v1/scim/v2', { displayName: 'A group' }),
    );
    const request = await a.tx((tx) =>
      platform.requestStatusChange(tx, {}, pa.id, {
        toStatus: 'pilot',
        reason: 'pilot',
        scope: {
          effects: [{ effect: 'integration.read' }],
          workflows: ['operations.housekeepingBoard'],
          modules: ['operations'],
          startsOn: '2026-11-01',
          endsOn: '2027-01-31',
          successCriteria: 'x',
          rollbackPlan: 'y',
        },
      }),
    );
    const transition = await a.tx((tx) =>
      platform.planAuthorityTransition(tx, pa.id, {
        changes: [
          { domain: 'charges', authority: 'external', connectionId: newId(), writeMode: 'read_only' },
        ],
        reason: 'connect alongside',
        freezeMinutes: 5,
      }),
    );

    const notFound = { status: 404 };
    await expect(b.tx((tx) => identity.getMember(tx, member.userId))).rejects.toMatchObject(notFound);
    await expect(b.tx((tx) => identity.getRole(tx, h.ports, role.id))).rejects.toMatchObject(notFound);
    await expect(
      b.tx((tx) => identity.updateRole(tx, h.ports, role.id, role.version, { name: 'stolen' })),
    ).rejects.toMatchObject(notFound);
    await expect(b.tx((tx) => identity.revokeApiClient(tx, client.clientId, 'x'))).rejects.toMatchObject(
      notFound,
    );
    expect((await b.tx((tx) => identity.listApiClients(tx))).map((c) => c.clientId)).not.toContain(
      client.clientId,
    );
    await expect(
      b.tx((tx) => identity.reviewElevation(tx, elevation.elevationId, 'reviewing someone else')),
    ).rejects.toMatchObject(notFound);
    expect(await b.tx((tx) => identity.listElevations(tx))).toEqual([]);
    await expect(b.tx((tx) => identity.acknowledgeSecurityAlert(tx, alert.id))).rejects.toMatchObject(
      notFound,
    );
    expect(await b.tx((tx) => identity.getSsoConnection(tx))).toBeNull();
    await expect(
      b.tx((tx) => identity.scimGetGroup(tx, h.ports, 'https://api.test/v1/scim/v2', group.id)),
    ).rejects.toMatchObject(notFound);
    expect((await b.tx((tx) => identity.mfaStatus(tx, member.userId))).enrolled).toBe(false);
    await expect(
      b.tx((tx) => identity.resetMemberMfa(tx, member.userId, 'x', h.ports)),
    ).rejects.toMatchObject(notFound);
    await expect(b.tx((tx) => platform.approveActivationRequest(tx, {}, request.id))).rejects.toMatchObject(
      notFound,
    );
    await expect(b.tx((tx) => platform.approveAuthorityTransition(tx, transition.id))).rejects.toMatchObject(
      notFound,
    );
    // A still sees all of it.
    expect((await a.tx((tx) => identity.mfaStatus(tx, member.userId))).enrolled).toBe(true);
    expect((await a.tx((tx) => identity.getSsoConnection(tx)))?.issuer).toBe(issuer);
  });
});
