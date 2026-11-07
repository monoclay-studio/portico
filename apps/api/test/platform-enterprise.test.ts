import { newId } from '@portico/kernel';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type EnterpriseHarness,
  enterpriseOrg,
  legalEntityAndProperty,
  login,
  startEnterpriseApi,
} from './enterprise-harness';

let h: EnterpriseHarness;
beforeAll(async () => {
  h = await startEnterpriseApi();
});
afterAll(async () => h?.close());

const pilotScope = {
  effects: [{ effect: 'integration.read' }, { effect: 'message.guest', workflows: ['comms.preArrival'] }],
  workflows: ['comms.preArrival'],
  modules: ['comms'],
  startsOn: '2026-01-01',
  endsOn: '2027-12-31',
  successCriteria: 'Pre-arrival messages answered within 1 h',
  rollbackPlan: 'Disable the automation',
};

describe('property activation over HTTP', () => {
  it('requires a second administrator to approve a pilot, then reports status, scope and history', async () => {
    const o = await enterpriseOrg(h);
    const second = await o.addAdmin();
    const { propertyId } = await legalEntityAndProperty(h, o.auth);
    const req = await h.app.inject({
      method: 'POST',
      url: `/v1/properties/${propertyId}/activation-requests`,
      headers: { ...o.auth, 'idempotency-key': newId() },
      payload: { toStatus: 'pilot', reason: 'Guest communications pilot', scope: pilotScope },
    });
    expect(req.statusCode).toBe(201);
    const self = await h.app.inject({
      method: 'POST',
      url: `/v1/activation-requests/${req.json().id}/approve`,
      headers: o.auth,
      payload: {},
    });
    expect(self.json()).toMatchObject({ status: 422, code: 'segregation_of_duties' });
    const ok = await h.app.inject({
      method: 'POST',
      url: `/v1/activation-requests/${req.json().id}/approve`,
      headers: second.auth,
      payload: { note: 'Approved after review' },
    });
    expect(ok.json().status).toBe('approved');
    const overview = await h.app.inject({
      method: 'GET',
      url: `/v1/properties/${propertyId}/activation`,
      headers: o.auth,
    });
    expect(overview.json()).toMatchObject({
      status: 'pilot',
      allowedTransitions: ['setup', 'active'],
      scopes: { pilot: { version: 1 } },
      history: [expect.objectContaining({ fromStatus: 'setup', toStatus: 'pilot' })],
    });
    // Status can no longer be edited directly.
    const prop = await h.app.inject({ method: 'GET', url: `/v1/properties/${propertyId}`, headers: o.auth });
    const patch = await h.app.inject({
      method: 'PATCH',
      url: `/v1/properties/${propertyId}`,
      headers: { ...o.auth, 'if-match': prop.headers.etag as string },
      payload: { status: 'active' },
    });
    expect(patch.json().code).toBe('use_activation_workflow');
  });
});

describe('outlets, owners and entitlements over HTTP', () => {
  it('outlets use Idempotency-Key, ETag and If-Match, and stay invisible to other organizations', async () => {
    const o = await enterpriseOrg(h);
    const { propertyId } = await legalEntityAndProperty(h, o.auth);
    const key = newId();
    const body = {
      code: 'SUNSET',
      name: 'Sunset Bar',
      kind: 'bar',
      acceptsRoomCharge: true,
      openingHours: [{ day: 5, opens: '18:00', closes: '01:00' }],
    };
    const created = await h.app.inject({
      method: 'POST',
      url: `/v1/properties/${propertyId}/outlets`,
      headers: { ...o.auth, 'idempotency-key': key },
      payload: body,
    });
    expect(created.statusCode).toBe(201);
    const replay = await h.app.inject({
      method: 'POST',
      url: `/v1/properties/${propertyId}/outlets`,
      headers: { ...o.auth, 'idempotency-key': key },
      payload: body,
    });
    expect(replay.json().id).toBe(created.json().id);
    const id = created.json().id;
    const etag = created.headers.etag as string;
    expect(
      (
        await h.app.inject({
          method: 'PATCH',
          url: `/v1/outlets/${id}`,
          headers: { ...o.auth, 'if-match': etag },
          payload: { name: 'Sunset' },
        })
      ).statusCode,
    ).toBe(200);
    const stale = await h.app.inject({
      method: 'PATCH',
      url: `/v1/outlets/${id}`,
      headers: { ...o.auth, 'if-match': etag },
      payload: { name: 'x' },
    });
    expect(stale.json()).toMatchObject({ code: 'version_conflict', details: { currentVersion: 2 } });
    const other = await enterpriseOrg(h, { name: 'Other' });
    expect(
      (await h.app.inject({ method: 'GET', url: `/v1/outlets/${id}`, headers: other.auth })).statusCode,
    ).toBe(404);
    const ent = await h.app.inject({ method: 'GET', url: '/v1/organization/entitlements', headers: o.auth });
    expect(ent.json()).toMatchObject({ plan: { code: 'enterprise' } });
    expect(ent.json().features).toContain('owners.accounting');
    const owner = await h.app.inject({
      method: 'POST',
      url: '/v1/owners',
      headers: { ...o.auth, 'idempotency-key': newId() },
      payload: {
        reference: 'V-12',
        kind: 'person',
        displayName: 'Villa 12 owner',
        payoutHint: 'IBAN GB82WEST12345698765432',
      },
    });
    expect(owner.statusCode).toBe(400); // no bank data in plaintext
  });
});

describe('trial environments over HTTP (adoption brief §3)', () => {
  it('creates a trial from the live organization, labels it, carries configuration back, and closes it', async () => {
    const o = await enterpriseOrg(h, { name: 'Lagoon Group' });
    const { propertyId: liveProperty } = await legalEntityAndProperty(h, o.auth, 'LIVE');
    const created = await h.app.inject({
      method: 'POST',
      url: '/v1/environments/trials',
      headers: { ...o.auth, 'idempotency-key': newId() },
      payload: { name: 'Lagoon Group (trial)' },
    });
    expect(created.statusCode).toBe(201);
    const trialId = created.json().organizationId;
    const links = await h.app.inject({ method: 'GET', url: '/v1/environments', headers: o.auth });
    expect(links.json().items).toEqual([
      expect.objectContaining({ organizationId: trialId, environment: 'trial', status: 'active' }),
    ]);
    // Same person, separate trial-only membership.
    const choose = await h.app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email: o.email, password: 'correct horse battery staple' },
    });
    expect(choose.json().status).toBe('select_organization');
    const trialAuth = await login(h, o.email, trialId);
    const env = await h.app.inject({ method: 'GET', url: '/v1/environment', headers: trialAuth });
    expect(env.json()).toMatchObject({
      environment: 'trial',
      importedDataProvenance: 'copied',
      banner: { title: 'Trial' },
      effects: { 'integration.write': 'blocked', 'payment.charge': 'simulate', 'integration.read': 'live' },
      trial: { sourceOrganizationId: o.tenantId },
    });
    // Configure in the trial, then pull it into live as a reviewed bundle.
    const { propertyId: trialProperty } = await legalEntityAndProperty(h, trialAuth, 'TRL');
    await h.app.inject({
      method: 'POST',
      url: `/v1/properties/${trialProperty}/outlets`,
      headers: { ...trialAuth, 'idempotency-key': newId() },
      payload: { code: 'SPA', name: 'Island Spa', kind: 'spa' },
    });
    const pulled = await h.app.inject({
      method: 'POST',
      url: '/v1/configuration-bundles/from-trial',
      headers: { ...o.auth, 'idempotency-key': newId() },
      payload: { trialOrganizationId: trialId, trialPropertyId: trialProperty, bundleName: 'from-trial' },
    });
    expect(pulled.statusCode).toBe(201);
    expect(pulled.json()).toMatchObject({ sourceKind: 'trial' });
    const change = await h.app.inject({
      method: 'POST',
      url: '/v1/configuration-changes',
      headers: { ...o.auth, 'idempotency-key': newId() },
      payload: { bundleId: pulled.json().id, propertyIds: [liveProperty] },
    });
    expect(change.json()).toMatchObject({ status: 'approved', summary: { create: expect.any(Number) } });
    const applied = await h.app.inject({
      method: 'POST',
      url: `/v1/configuration-changes/${change.json().id}/apply`,
      headers: o.auth,
      payload: {},
    });
    expect(applied.json().status).toBe('applied');
    const outlets = await h.app.inject({
      method: 'GET',
      url: `/v1/properties/${liveProperty}/outlets`,
      headers: o.auth,
    });
    expect(outlets.json().items.map((x: { code: string }) => x.code)).toEqual(['SPA']);
    // A live organization cannot be reset as a trial; the trial can be closed with confirmation.
    const notTrial = await h.app.inject({
      method: 'POST',
      url: '/v1/environment/trial/reset',
      headers: o.auth,
      payload: { reason: 'oops', confirmOrganizationName: 'Lagoon Group' },
    });
    expect(notTrial.json().code).toBe('not_a_trial');
    const exported = await h.app.inject({
      method: 'GET',
      url: '/v1/environment/trial/export',
      headers: trialAuth,
    });
    expect(exported.headers['content-disposition']).toContain('TRIAL-export');
    const closed = await h.app.inject({
      method: 'POST',
      url: '/v1/environment/trial/close',
      headers: trialAuth,
      payload: { reason: 'Evaluation finished', confirmOrganizationName: 'Lagoon Group (trial)' },
    });
    expect(closed.statusCode).toBe(200);
    expect(
      (await h.app.inject({ method: 'GET', url: '/v1/environment', headers: trialAuth })).statusCode,
    ).toBe(401);
  });
});

describe('authority transitions over HTTP', () => {
  it('plans, freezes and completes a move of the system of record with history', async () => {
    const o = await enterpriseOrg(h);
    const second = await o.addAdmin();
    const { propertyId } = await legalEntityAndProperty(h, o.auth);
    const connectionId = newId();
    const plan = await h.app.inject({
      method: 'POST',
      url: `/v1/properties/${propertyId}/authority-transitions`,
      headers: { ...o.auth, 'idempotency-key': newId() },
      payload: {
        changes: [
          {
            domain: 'availability',
            authority: 'external',
            connectionId,
            systemName: 'Legacy PMS',
            writeMode: 'read_only',
          },
        ],
        reason: 'Connect alongside the legacy PMS',
        freezeMinutes: 30,
      },
    });
    expect(plan.json()).toMatchObject({ status: 'planned', approvalRequired: true });
    const id = plan.json().id;
    expect(
      (
        await h.app.inject({
          method: 'POST',
          url: `/v1/authority-transitions/${id}/freeze`,
          headers: o.auth,
          payload: {},
        })
      ).json().code,
    ).toBe('approval_required');
    await h.app.inject({
      method: 'POST',
      url: `/v1/authority-transitions/${id}/approve`,
      headers: second.auth,
      payload: { note: 'ok' },
    });
    const frozen = await h.app.inject({
      method: 'POST',
      url: `/v1/authority-transitions/${id}/freeze`,
      headers: o.auth,
      payload: {},
    });
    expect(frozen.json().status).toBe('frozen');
    const direct = await h.app.inject({
      method: 'POST',
      url: `/v1/properties/${propertyId}/data-authority`,
      headers: o.auth,
      payload: { domain: 'availability', authority: 'portico', writeMode: 'exclusive', reason: 'shortcut' },
    });
    expect(direct.json().code).toBe('authority_transition_open');
    const done = await h.app.inject({
      method: 'POST',
      url: `/v1/authority-transitions/${id}/complete`,
      headers: o.auth,
      payload: {},
    });
    expect(done.json().status).toBe('effective');
    const history = await h.app.inject({
      method: 'GET',
      url: `/v1/properties/${propertyId}/data-authority/history?domain=availability`,
      headers: o.auth,
    });
    expect(history.json().items).toEqual([
      expect.objectContaining({ version: 1, authority: 'external', transitionId: id }),
    ]);
    const matrix = await h.app.inject({
      method: 'GET',
      url: `/v1/properties/${propertyId}/data-authority`,
      headers: o.auth,
    });
    expect(matrix.json().items).toHaveLength(10);
  });
});
