/**
 * Platform regressions from the steward review (docs/orchestration/reviews/review-identity-plus.md):
 * P1-4 (approvals are human acts by a different person), P2-5 (transitions fail closed), P2-6 (refusal audits
 * survive rollback), P2-11 (no personal data in owner audits), P3-7 (no history for a change that did not happen).
 */
import { sourcesFromManifests, withTenantTx } from '@portico/db';
import { newId, type RequestContext } from '@portico/kernel';
import { createTestDatabase, type TestDatabase, testContext } from '@portico/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type ActivationScopeContent, platform, platformManifest } from '../src';
import { makeOrg } from './helpers';

let t: TestDatabase;
beforeAll(async () => {
  t = await createTestDatabase(sourcesFromManifests([platformManifest]));
});
afterAll(async () => t?.drop());

const scope: ActivationScopeContent = {
  effects: [{ effect: 'integration.read' }],
  workflows: ['operations.housekeepingBoard'],
  modules: ['operations'],
  startsOn: '2026-11-01',
  endsOn: '2027-01-31',
  successCriteria: 'x',
  rollbackPlan: 'y',
};

/** An API client issued by `createdBy` (identity puts `createdBy` on the actor). */
function apiClient(org: Awaited<ReturnType<typeof makeOrg>>, createdBy: string): RequestContext {
  const ctx = testContext({ tenantId: org.tenantId, environment: 'live' });
  return {
    ...ctx,
    actor: { kind: 'api_client', clientId: newId(), createdBy } as RequestContext['actor'],
  };
}

describe('P1-4: separation of duties compares people; approvals are human acts', () => {
  it('activation: an API client cannot approve, and its issuer cannot approve what it requested', async () => {
    const org = await makeOrg(t);
    const p = await org.property('SOD');
    const person = newId();
    const bot = apiClient(org, person);
    const r = await withTenantTx(t.db, bot, (tx) =>
      platform.requestStatusChange(tx, {}, p.id, { toStatus: 'pilot', reason: 'pilot', scope }),
    );
    expect(r.requestedBy).toBe(`user:${person}`);
    await expect(
      withTenantTx(t.db, org.as(person), (tx) => platform.approveActivationRequest(tx, {}, r.id)),
    ).rejects.toMatchObject({ code: 'segregation_of_duties' });
    await expect(
      withTenantTx(t.db, apiClient(org, newId()), (tx) => platform.approveActivationRequest(tx, {}, r.id)),
    ).rejects.toMatchObject({ code: 'human_approval_required' });
    const supportCtx: RequestContext = {
      ...org.as(),
      actor: { kind: 'user', userId: newId(), impersonatedBy: 'monoclay-operator:op-1' },
    };
    await expect(
      withTenantTx(t.db, supportCtx, (tx) => platform.approveActivationRequest(tx, {}, r.id)),
    ).rejects.toMatchObject({ code: 'human_approval_required' });
    const approved = await withTenantTx(t.db, org.as(), (tx) =>
      platform.approveActivationRequest(tx, {}, r.id),
    );
    expect(approved.status).toBe('approved');
  });

  it('authority transitions: the planner’s API client cannot approve', async () => {
    const org = await makeOrg(t);
    const p = await org.property('SODT');
    const planner = newId();
    const plan = await withTenantTx(t.db, org.as(planner), (tx) =>
      platform.planAuthorityTransition(tx, p.id, {
        changes: [
          { domain: 'charges', authority: 'external', connectionId: newId(), writeMode: 'read_only' },
        ],
        reason: 'connect alongside the PMS',
        freezeMinutes: 10,
      }),
    );
    await expect(
      withTenantTx(t.db, apiClient(org, planner), (tx) => platform.approveAuthorityTransition(tx, plan.id)),
    ).rejects.toMatchObject({ code: 'human_approval_required' });
  });
});

describe('P2-5: completing a transition out of forward mode fails closed without the guard', () => {
  it('refuses while nobody can check for pending forwarded changes, and proceeds when the guard says none', async () => {
    const org = await makeOrg(t);
    const p = await org.property('FWD');
    await withTenantTx(t.db, org.as(), (tx) =>
      platform.setDataAuthority(tx, {
        propertyId: p.id,
        domain: 'roomStatus',
        authority: 'external',
        connectionId: newId(),
        systemName: 'OPERA',
        writeMode: 'forward',
        reason: 'housekeeping forwards to OPERA',
      }),
    );
    const plan = await withTenantTx(t.db, org.as(), (tx) =>
      platform.planAuthorityTransition(tx, p.id, {
        changes: [{ domain: 'roomStatus', authority: 'portico', writeMode: 'exclusive' }],
        reason: 'take room status back',
        freezeMinutes: 10,
      }),
    );
    if (plan.approvalRequired)
      await withTenantTx(t.db, org.as(), (tx) => platform.approveAuthorityTransition(tx, plan.id));
    await withTenantTx(t.db, org.as(), (tx) => platform.freezeAuthorityTransition(tx, plan.id));
    await expect(
      withTenantTx(t.db, org.as(), (tx) => platform.completeAuthorityTransition(tx, {}, plan.id)),
    ).rejects.toMatchObject({ code: 'pending_operations_unknown' });
    const done = await withTenantTx(t.db, org.as(), (tx) =>
      platform.completeAuthorityTransition(
        tx,
        { transitionGuard: { pendingOperations: async () => [] } },
        plan.id,
      ),
    );
    expect(done.status).toBe('effective');
  });
});

describe('P2-6: an activation-scope refusal is audited even when the caller rolls back', () => {
  it('writes the refusal in its own transaction when given the database', async () => {
    const org = await makeOrg(t);
    const p = await org.property('AUD'); // setup: only reads are live
    await expect(
      withTenantTx(t.db, org.as(), (tx) =>
        platform.assertEffectInScope(tx, p.id, 'message.guest', { database: t.db }),
      ),
    ).rejects.toMatchObject({ code: 'effect_outside_activation_scope' });
    const rows = await t.admin.kysely
      .selectFrom('core.audit_log')
      .select('reason')
      .where('tenant_id', '=', org.tenantId)
      .where('action', '=', 'platform.activationScope.refuse')
      .execute();
    expect(rows).toEqual([{ reason: 'setup_allows_reads_only' }]);
  });
});

describe('P2-11: owner audits never hold personal data', () => {
  it('records which personal fields are set, not their values', async () => {
    const org = await makeOrg(t); // enterprise includes owners.accounting
    const owner = await withTenantTx(t.db, org.as(), (tx) =>
      platform.createOwner(tx, {
        reference: 'OWN-PII',
        kind: 'person',
        displayName: 'Villa 12 owner',
        legalName: 'Aminath Private Person',
        email: 'aminath.private@example.mv',
        phone: '+960 777 1234',
        taxId: 'TIN-998877',
      }),
    );
    await withTenantTx(t.db, org.as(), (tx) =>
      platform.updateOwner(tx, owner.id, owner.version, { email: 'aminath.new@example.mv' }),
    );
    const audit = await t.admin.kysely
      .selectFrom('core.audit_log')
      .select(['action', 'before', 'after', 'metadata'])
      .where('tenant_id', '=', org.tenantId)
      .where('target_id', '=', owner.id)
      .execute();
    expect(audit.map((a) => a.action).sort()).toEqual(['platform.owner.create', 'platform.owner.update']);
    const text = JSON.stringify(audit);
    for (const pii of ['aminath', '777 1234', 'TIN-998877', 'Private Person'])
      expect(text).not.toContain(pii);
    expect(text).toContain('"email":"set"');
    expect(text).toContain('changedFields');
  });
});
