import { sourcesFromManifests, withTenantTx } from '@portico/db';
import { newId } from '@portico/kernel';
import { createTestDatabase, type TestDatabase } from '@portico/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type ActivationScopeContent, platform, platformManifest } from '../src';
import { makeOrg } from './helpers';

let t: TestDatabase;
beforeAll(async () => {
  t = await createTestDatabase(sourcesFromManifests([platformManifest]));
});
afterAll(async () => t?.drop());

const connection = newId();
const pilotScope: ActivationScopeContent = {
  effects: [
    { effect: 'integration.read' },
    { effect: 'integration.write', connectionIds: [connection], workflows: ['roomStatus.forward'] },
    { effect: 'message.guest', workflows: ['comms.preArrival'] },
  ],
  workflows: ['operations.housekeepingBoard', 'comms.preArrival'],
  modules: ['operations', 'comms'],
  startsOn: '2026-11-01',
  endsOn: '2027-01-31',
  successCriteria: 'Room status p95 ≤ 30 s; zero lost updates',
  rollbackPlan: 'Disable workflows; authority stays with the PMS',
};

describe('property activation (adoption brief §3 stages 4–5, G-04)', () => {
  it('pilot needs a request and approval by a different person with the activate permission', async () => {
    const org = await makeOrg(t);
    const a = await org.property('ACT1');
    const b = await org.property('ACT2');
    const manager = newId();
    const gm = newId();
    const req = await withTenantTx(t.db, org.as(manager), (tx) =>
      platform.requestStatusChange(tx, {}, a.id, {
        toStatus: 'pilot',
        reason: 'housekeeping pilot',
        scope: pilotScope,
      }),
    );
    expect(req.status).toBe('pending');
    expect(req.checklist.every((c) => c.passed)).toBe(true);
    await expect(
      withTenantTx(t.db, org.as(manager), (tx) => platform.approveActivationRequest(tx, {}, req.id)),
    ).rejects.toMatchObject({ code: 'segregation_of_duties' });
    const noPermission = org.as(newId(), [{ permission: 'platform.property.read', propertyIds: 'all' }]);
    await expect(
      withTenantTx(t.db, noPermission, (tx) => platform.approveActivationRequest(tx, {}, req.id)),
    ).rejects.toMatchObject({ code: 'forbidden' });
    const approved = await withTenantTx(t.db, org.as(gm), (tx) =>
      platform.approveActivationRequest(tx, {}, req.id, { note: 'go' }),
    );
    expect(approved).toMatchObject({ status: 'approved', decidedBy: `user:${gm}` });
    const overview = await withTenantTx(t.db, org.as(), (tx) => platform.getActivationOverview(tx, a.id));
    expect(overview).toMatchObject({ status: 'pilot', scopes: { pilot: { version: 1 } } });
    expect(overview.history).toEqual([
      expect.objectContaining({ fromStatus: 'setup', toStatus: 'pilot', approvedBy: `user:${gm}` }),
    ]);
    // EV-06: the other property is untouched.
    expect((await withTenantTx(t.db, org.as(), (tx) => platform.getProperty(tx, b.id))).status).toBe('setup');
    const audit = await t.admin.kysely
      .selectFrom('core.audit_log')
      .select('action')
      .where('tenant_id', '=', org.tenantId)
      .where('target_id', '=', a.id)
      .execute();
    expect(audit.map((x) => x.action)).toEqual(
      expect.arrayContaining([
        'platform.activation.request',
        'platform.activationScope.approve',
        'platform.property.statusChange',
      ]),
    );
  });

  it('enforces the approved scope on live effects and workflows (EV-05)', async () => {
    const org = await makeOrg(t);
    const p = await org.property('ACT3');
    const setupProp = await org.property('ACT4');
    const r = await withTenantTx(t.db, org.as(), (tx) =>
      platform.requestStatusChange(tx, {}, p.id, { toStatus: 'pilot', reason: 'pilot', scope: pilotScope }),
    );
    await withTenantTx(t.db, org.as(), (tx) => platform.approveActivationRequest(tx, {}, r.id));
    const check = (
      propertyId: string,
      effect: Parameters<typeof platform.assertEffectInScope>[2],
      opts = {},
    ) => withTenantTx(t.db, org.as(), (tx) => platform.assertEffectInScope(tx, propertyId, effect, opts));
    expect(await check(p.id, 'integration.read')).toBe('live');
    expect(
      await check(p.id, 'integration.write', { connectionId: connection, workflow: 'roomStatus.forward' }),
    ).toBe('live');
    await expect(check(p.id, 'payment.charge')).rejects.toMatchObject({
      code: 'effect_outside_activation_scope',
      details: { reason: 'effect_not_in_scope', scopeRef: 'pilot scope v1' },
    });
    await expect(
      check(p.id, 'integration.write', { connectionId: newId(), workflow: 'roomStatus.forward' }),
    ).rejects.toMatchObject({
      details: { reason: 'connection_not_in_scope' },
    });
    // setup: only reads are live
    expect(await check(setupProp.id, 'integration.read')).toBe('live');
    await expect(check(setupProp.id, 'message.guest')).rejects.toMatchObject({
      details: { reason: 'setup_allows_reads_only' },
    });
    // The refusal is audited when the caller records the blocked outcome and commits.
    await withTenantTx(t.db, org.as(), async (tx) => {
      await platform.assertEffectInScope(tx, p.id, 'channel.publish').catch(() => 'blocked');
    });
    const refused = await t.admin.kysely
      .selectFrom('core.audit_log')
      .select(['reason', 'metadata'])
      .where('tenant_id', '=', org.tenantId)
      .where('action', '=', 'platform.activationScope.refuse')
      .execute();
    expect(refused).toHaveLength(1);
    expect(refused[0]?.reason).toBe('effect_not_in_scope');
    // Workflows
    await withTenantTx(t.db, org.as(), (tx) =>
      platform.assertWorkflowInScope(tx, p.id, 'operations.housekeepingBoard'),
    );
    await expect(
      withTenantTx(t.db, org.as(), (tx) => platform.assertWorkflowInScope(tx, p.id, 'reservations.checkIn')),
    ).rejects.toMatchObject({ code: 'workflow_outside_activation_scope' });
  });

  it('non-live environments keep simulating regardless of scope', async () => {
    const org = await makeOrg(t, { environment: 'trial' });
    const p = await org.property('TRL');
    expect(
      await withTenantTx(t.db, org.as(), (tx) => platform.assertEffectInScope(tx, p.id, 'payment.charge')),
    ).toBe('simulate');
    await expect(
      withTenantTx(t.db, org.as(), (tx) => platform.assertEffectInScope(tx, p.id, 'integration.write')),
    ).rejects.toMatchObject({ code: 'effect_blocked_in_environment' });
    // Activation in a non-live organization is blocked by the checklist.
    const r = await withTenantTx(t.db, org.as(), (tx) =>
      platform.requestStatusChange(tx, {}, p.id, { toStatus: 'pilot', reason: 'try', scope: pilotScope }),
    );
    expect(r.checklist.find((c) => c.key === 'platform.liveEnvironment')?.passed).toBe(false);
    await expect(
      withTenantTx(t.db, org.as(), (tx) => platform.approveActivationRequest(tx, {}, r.id)),
    ).rejects.toMatchObject({ code: 'activation_blocked' });
  });

  it('counts pilot and active properties against the plan limit (PLT-R10)', async () => {
    const org = await makeOrg(t, { planCode: 'essentials' });
    const p = await org.property('ESS');
    const r = await withTenantTx(t.db, org.as(), (tx) =>
      platform.requestStatusChange(tx, {}, p.id, { toStatus: 'active', reason: 'go live' }),
    );
    await withTenantTx(t.db, org.as(), (tx) => platform.approveActivationRequest(tx, {}, r.id));
    // Production scope defaults to every effect.
    expect(
      await withTenantTx(t.db, org.as(), (tx) => platform.assertEffectInScope(tx, p.id, 'payment.charge')),
    ).toBe('live');
    const overview = await withTenantTx(t.db, org.as(), (tx) => platform.getActivationOverview(tx, p.id));
    expect(overview.allowedTransitions).toEqual(['inactive']);
  });

  it('refuses direct status edits and supports stopping a pilot', async () => {
    const org = await makeOrg(t);
    const p = await org.property('ACT5');
    await expect(
      withTenantTx(t.db, org.as(), (tx) =>
        platform.updateProperty(tx, p.id, p.version, { status: 'active' }),
      ),
    ).rejects.toMatchObject({ code: 'use_activation_workflow' });
    const r = await withTenantTx(t.db, org.as(), (tx) =>
      platform.requestStatusChange(tx, {}, p.id, { toStatus: 'pilot', reason: 'pilot', scope: pilotScope }),
    );
    // Only one pending request at a time.
    await expect(
      withTenantTx(t.db, org.as(), (tx) =>
        platform.requestStatusChange(tx, {}, p.id, { toStatus: 'active', reason: 'again' }),
      ),
    ).rejects.toMatchObject({ code: 'activation_request_pending' });
    await withTenantTx(t.db, org.as(), (tx) => platform.approveActivationRequest(tx, {}, r.id));
    // Scope change → new version after approval.
    const sc = await withTenantTx(t.db, org.as(), (tx) =>
      platform.requestScopeChange(tx, p.id, {
        stage: 'pilot',
        scope: { ...pilotScope, effects: [...pilotScope.effects, { effect: 'message.staff' }] },
        reason: 'notify supervisors',
      }),
    );
    await withTenantTx(t.db, org.as(), (tx) => platform.approveActivationRequest(tx, {}, sc.id));
    expect((await withTenantTx(t.db, org.as(), (tx) => platform.getPilotScope(tx, p.id)))?.version).toBe(2);
    const stopped = await withTenantTx(t.db, org.as(), (tx) =>
      platform.changePropertyStatusDirect(tx, p.id, {
        toStatus: 'setup',
        reason: 'pilot paused for training',
      }),
    );
    expect(stopped.status).toBe('setup');
    await expect(
      withTenantTx(t.db, org.as(), (tx) =>
        platform.changePropertyStatusDirect(tx, p.id, { toStatus: 'inactive', reason: 'x' }),
      ),
    ).rejects.toMatchObject({ code: 'invalid_status_transition' });
  });

  it('rejects an invalid pilot scope', async () => {
    const org = await makeOrg(t);
    const p = await org.property('ACT6');
    await expect(
      withTenantTx(t.db, org.as(), (tx) =>
        platform.requestStatusChange(tx, {}, p.id, {
          toStatus: 'pilot',
          reason: 'x',
          scope: { effects: [], workflows: ['*'], modules: [] },
        }),
      ),
    ).rejects.toMatchObject({ code: 'invalid_scope' });
  });
});

describe('property facts for module-internal use', () => {
  it('returns facts without a permission check, but only inside the tenant', async () => {
    const org = await makeOrg(t);
    const p = await org.property('FACT', { classification: { 'mv.establishmentType': 'resort' } });
    const noGrants = org.as(newId(), []);
    const facts = await withTenantTx(t.db, noGrants, (tx) => platform.getPropertyFacts(tx, p.id));
    expect(facts).toMatchObject({
      id: p.id,
      timezone: 'Indian/Maldives',
      baseCurrency: 'USD',
      countryCode: 'MV',
      legalEntityId: org.le.id,
      status: 'setup',
      businessDate: '2026-11-07',
      classification: { 'mv.establishmentType': 'resort' },
    });
    await expect(withTenantTx(t.db, noGrants, (tx) => platform.getProperty(tx, p.id))).rejects.toMatchObject({
      code: 'forbidden',
    });
    const other = await makeOrg(t);
    await expect(
      withTenantTx(t.db, other.as(), (tx) => platform.getPropertyFacts(tx, p.id)),
    ).rejects.toMatchObject({
      code: 'property_not_found',
    });
  });
});
