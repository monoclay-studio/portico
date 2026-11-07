import { createHash } from 'node:crypto';
import { newId, randomToken } from '@portico/kernel';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { identity, operatorDirectoryFromConfig } from '../src';
import { authenticate, type Harness, harness, org, PASSWORD, signIn } from './harness';

let h: Harness;
const operatorId = newId();
const operatorToken = `pto.${operatorId}.${randomToken(32)}`;
const operator = { id: operatorId, name: 'Ibrahim (Monoclay support)', email: 'ibrahim@monoclay.test' };

beforeAll(async () => {
  const country = new Map<string, string>([
    ['198.51.100.7', 'MV'],
    ['203.0.113.9', 'RU'],
  ]);
  h = await harness({
    operators: operatorDirectoryFromConfig(
      JSON.stringify([
        { ...operator, tokenSha256: createHash('sha256').update(operatorToken).digest('hex') },
      ]),
    ),
    geo: { countryOf: (ip) => country.get(ip) ?? null },
  });
});
afterAll(async () => h?.t.drop());

describe('operator principals', () => {
  it('authenticate only with the configured token, never as tenant users', () => {
    expect(h.ports.operators?.authenticate(operatorToken)).toEqual(operator);
    expect(h.ports.operators?.authenticate(`${operatorToken}x`)).toBeNull();
    expect(h.ports.operators?.authenticate(`pto.${newId()}.${randomToken(32)}`)).toBeNull();
    expect(() => operatorDirectoryFromConfig('[{"id":"x"}]')).toThrow(/tokenSha256/);
  });
});

describe('Monoclay support access (time-boxed, reasoned, customer-visible)', () => {
  it('pending until the customer approves; read-only scope; every request logged; impersonation marker on audit', async () => {
    const o = await org(h);
    const p = await o.property('SUP');
    const { session, token } = await identity.requestSupportSession(h.t.db, operator, {
      organizationId: o.tenantId,
      reason: 'Guest folio total looks wrong (ticket 4412)',
      ticketRef: 'T-4412',
      scope: 'read_only',
      durationMinutes: 60,
    });
    expect(session.status).toBe('pending_approval');
    expect(await identity.authenticateToken(h.t.db, token, h.ports)).toBeNull();
    // The customer sees the request (and an alert).
    const list = await o.tx((tx) => identity.listSupportSessions(tx));
    expect(list[0]).toMatchObject({ id: session.id, ticketRef: 'T-4412', status: 'pending_approval' });
    const alerts = await o.tx((tx) => identity.listSecurityAlerts(tx));
    expect(alerts.map((a) => a.rule)).toContain('support_session_started');
    await o.tx((tx) => identity.approveSupportSession(tx, session.id, 'ok for one hour'));
    const principal = await identity.authenticateToken(h.t.db, token, h.ports, {
      method: 'GET',
      path: `/v1/properties/${p.id}?x=1`,
    });
    expect(principal?.actor).toMatchObject({
      kind: 'user',
      impersonatedBy: `monoclay-operator:${operatorId}`,
      sessionId: session.id,
    });
    expect(principal?.authz.can('platform.property.read', { propertyId: p.id })).toBe(true);
    expect(principal?.authz.can('platform.property.update', { propertyId: p.id })).toBe(false); // read-only
    expect(principal?.authz.can('identity.user.manage')).toBe(false); // sensitive: never
    const log = await o.tx((tx) => identity.getSupportAccessLog(tx, session.id));
    expect(log).toEqual([expect.objectContaining({ method: 'GET', path: `/v1/properties/${p.id}` })]);
    // Anything the operator does is audited with the marker.
    if (!principal) throw new Error('expected principal');
    const supportCtx = {
      tenantId: principal.tenantId,
      environment: principal.environment,
      actor: principal.actor,
      authz: principal.authz,
      correlationId: newId(),
    };
    await o.tx((tx) => tx.audit({ action: 'test.read', target: { type: 'property', id: p.id } }), supportCtx);
    const row = await h.t.admin.kysely
      .selectFrom('core.audit_log')
      .select(['actor', 'actor_key'])
      .where('tenant_id', '=', o.tenantId)
      .where('action', '=', 'test.read')
      .executeTakeFirstOrThrow();
    expect(row.actor).toMatchObject({
      impersonatedBy: `monoclay-operator:${operatorId}`,
      via: 'support',
      supportSessionId: session.id,
    });
    // Support sessions can never export.
    await expect(
      o.tx((tx) => identity.recordExportActivity(tx, { resource: 'guests', recordCount: 10 }), supportCtx),
    ).rejects.toMatchObject({ code: 'support_export_prohibited' });
    // The time box ends the access with no job needed.
    h.clock.advance(61 * 60_000);
    expect(await identity.authenticateToken(h.t.db, token, h.ports)).toBeNull();
    expect((await o.tx((tx) => identity.listSupportSessions(tx)))[0]?.status).toBe('expired');
  });

  it('policy may pre-approve read-only, never read-write; the customer can revoke at any time', async () => {
    const o = await org(h);
    await o.tx((tx) =>
      identity.updateSecurityPolicy(tx, 0, { supportAccessApproval: 'auto_approve_read_only' }),
    );
    const ro = await identity.requestSupportSession(h.t.db, operator, {
      organizationId: o.tenantId,
      reason: 'Investigating sync delay (ticket 9)',
      ticketRef: 'T-9',
      scope: 'read_only',
      durationMinutes: 30,
    });
    expect(ro.session).toMatchObject({ status: 'active', approvalMode: 'policy_auto_read_only' });
    expect(await identity.authenticateToken(h.t.db, ro.token, h.ports)).not.toBeNull();
    const rw = await identity.requestSupportSession(h.t.db, operator, {
      organizationId: o.tenantId,
      reason: 'Fix a misconfigured outlet (ticket 10)',
      ticketRef: 'T-10',
      scope: 'read_write',
      durationMinutes: 30,
    });
    expect(rw.session.status).toBe('pending_approval');
    await o.tx((tx) => identity.revokeSupportSession(tx, ro.session.id, 'done'));
    expect(await identity.authenticateToken(h.t.db, ro.token, h.ports)).toBeNull();
    await expect(
      identity.requestSupportSession(h.t.db, operator, {
        organizationId: o.tenantId,
        reason: 'Too long a session request',
        ticketRef: 'T-11',
        scope: 'read_only',
        durationMinutes: 600,
      }),
    ).rejects.toMatchObject({ code: 'support_duration_too_long' });
    // Another organization never sees this organization's support sessions.
    const other = await org(h);
    expect(await other.tx((tx) => identity.listSupportSessions(tx))).toEqual([]);
  });
});

describe('break-glass emergency access', () => {
  it('only designated members, mandatory reason, tagged actions, alert, auto-expiry, review by someone else', async () => {
    const o = await org(h);
    const p = await o.property('BG');
    const desk = await o.member([{ roleKey: 'front_desk', scopeType: 'property', scopeId: p.id }]);
    const reviewer = await o.member([{ roleKey: 'org_admin', scopeType: 'organization' }]);
    const s = await signIn(h, desk.email);
    await expect(
      o.tx(
        (tx) =>
          identity.startElevation(tx, h.ports, {
            reason: 'Night manager unreachable, guest locked out',
            durationMinutes: 60,
          }),
        s.ctx,
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await o.tx((tx) => identity.updateSecurityPolicy(tx, 0, { breakGlassUserIds: [desk.userId] }));
    await expect(
      o.tx((tx) => identity.startElevation(tx, h.ports, { reason: 'urgent', durationMinutes: 60 }), s.ctx),
    ).rejects.toMatchObject({ code: 'reason_required' });
    await expect(
      o.tx(
        (tx) =>
          identity.startElevation(tx, h.ports, {
            reason: 'Night manager unreachable, guest locked out',
            durationMinutes: 300,
          }),
        s.ctx,
      ),
    ).rejects.toMatchObject({ code: 'invalid_duration' });
    const before = h.sent.length;
    const e = await o.tx(
      (tx) =>
        identity.startElevation(tx, h.ports, {
          reason: 'Night manager unreachable, guest locked out',
          durationMinutes: 60,
        }),
      s.ctx,
    );
    expect(h.sent.slice(before).map((m) => m.to)).toContain(reviewer.email); // admins notified
    const elevated = await authenticate(h, s.token);
    expect(elevated?.actor).toMatchObject({ via: 'elevation', elevationId: e.elevationId });
    expect(elevated?.authz.can('platform.property.update', { propertyId: p.id })).toBe(true);
    const alerts = await o.tx((tx) => identity.listSecurityAlerts(tx));
    expect(alerts.find((a) => a.rule === 'break_glass_activated')).toMatchObject({ severity: 'high' });
    const events = await h.t.admin.kysely
      .selectFrom('core.outbox')
      .select('type')
      .where('tenant_id', '=', o.tenantId)
      .where('type', 'in', ['identity.elevation.started', 'identity.security.alert'])
      .execute();
    expect(events.map((x) => x.type)).toEqual(
      expect.arrayContaining(['identity.elevation.started', 'identity.security.alert']),
    );
    // Other sessions of the same person are not elevated.
    const other = await signIn(h, desk.email);
    expect(other.ctx.authz.can('platform.property.update', { propertyId: p.id })).toBe(false);
    // Review cannot happen while active, nor by the elevated person.
    const reviewerCtx = (await signIn(h, reviewer.email)).ctx;
    await expect(
      o.tx((tx) => identity.reviewElevation(tx, e.elevationId, 'Checked the lock reset; fine.'), reviewerCtx),
    ).rejects.toMatchObject({ code: 'elevation_active' });
    h.clock.advance(61 * 60_000);
    const expired = await authenticate(h, s.token);
    expect(expired?.authz.can('platform.property.update', { propertyId: p.id })).toBe(false);
    await expect(
      o.tx((tx) => identity.reviewElevation(tx, e.elevationId, 'Self review is not allowed.'), s.ctx),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await o.tx(
      (tx) => identity.reviewElevation(tx, e.elevationId, 'Checked the lock reset; fine.'),
      reviewerCtx,
    );
    const list = await o.tx((tx) => identity.listElevations(tx));
    expect(list[0]).toMatchObject({ reviewStatus: 'reviewed', active: false });
  });
});

describe('suspicious activity signals', () => {
  it('flags failed sign-ins across accounts from one IP (credential stuffing)', async () => {
    const o = await org(h);
    const victim = await o.member([]);
    const ip = `192.0.2.${Math.floor(Math.random() * 200) + 1}`;
    const emails = [victim.email, `ghost1-${newId()}@lagoon.mv`, `ghost2-${newId()}@lagoon.mv`];
    for (let i = 0; i < 10; i++)
      await identity
        .login(h.t.db, { email: emails[i % 3] as string, password: 'wrong-password', ip })
        .catch(() => {});
    const platformAlerts = await identity.listPlatformAlerts(h.t.db);
    expect(platformAlerts.find((a) => a.subject === ip)).toMatchObject({
      rule: 'credential_stuffing_suspected',
    });
    const tenantAlerts = await o.tx((tx) => identity.listSecurityAlerts(tx));
    expect(tenantAlerts.filter((a) => a.rule === 'credential_stuffing_suspected')).toHaveLength(1); // de-duplicated
  });

  it('flags a sign-in from a new country once a baseline exists', async () => {
    const o = await org(h);
    const m = await o.member([]);
    await identity.login(h.t.db, { email: m.email, password: PASSWORD, ip: '198.51.100.7' }, h.ports);
    expect(
      (await o.tx((tx) => identity.listSecurityAlerts(tx))).filter((a) => a.rule === 'new_country_sign_in'),
    ).toHaveLength(0);
    await identity.login(h.t.db, { email: m.email, password: PASSWORD, ip: '203.0.113.9' }, h.ports);
    const alerts = await o.tx((tx) => identity.listSecurityAlerts(tx));
    expect(alerts.find((a) => a.rule === 'new_country_sign_in')).toMatchObject({
      subjectUserId: m.userId,
      details: { country: 'RU' },
    });
  });

  it('flags mass exports by one actor', async () => {
    const o = await org(h);
    const m = await o.member([{ roleKey: 'read_only', scopeType: 'organization' }]);
    const s = await signIn(h, m.email);
    for (let i = 0; i < 4; i++)
      await o.tx((tx) => identity.recordExportActivity(tx, { resource: 'guests', recordCount: 100 }), s.ctx);
    expect(
      (await o.tx((tx) => identity.listSecurityAlerts(tx))).filter((a) => a.rule === 'mass_export'),
    ).toHaveLength(0);
    await o.tx((tx) => identity.recordExportActivity(tx, { resource: 'guests', recordCount: 100 }), s.ctx);
    const alert = (await o.tx((tx) => identity.listSecurityAlerts(tx))).find((a) => a.rule === 'mass_export');
    expect(alert).toMatchObject({ severity: 'high', subjectUserId: m.userId });
    await o.tx((tx) =>
      identity.acknowledgeSecurityAlert(tx, alert?.id as string, 'monthly export by finance'),
    );
    expect(
      (await o.tx((tx) => identity.listSecurityAlerts(tx))).find((a) => a.id === alert?.id)?.acknowledgedAt,
    ).not.toBeNull();
  });
});
