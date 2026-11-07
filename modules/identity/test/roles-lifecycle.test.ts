import { newId } from '@portico/kernel';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { identity } from '../src';
import { authenticate, type Harness, harness, org, PASSWORD, signIn } from './harness';

let h: Harness;
beforeAll(async () => {
  h = await harness();
});
afterAll(async () => h?.t.drop());

describe('custom roles from the permission catalog', () => {
  it('validates keys and wildcards against registered permissions and flags sensitive ones', async () => {
    const o = await org(h);
    await expect(
      o.tx((tx) =>
        identity.createRole(tx, h.ports, {
          key: 'night_lead',
          name: 'Night lead',
          permissions: ['platform.property.read', 'finanse.*', 'platform.property.fly'],
        }),
      ),
    ).rejects.toMatchObject({
      code: 'invalid_permissions',
      details: {
        issues: [
          { entry: 'finanse.*', problem: 'wildcard_matches_nothing' },
          { entry: 'platform.property.fly', problem: 'unknown_permission' },
        ],
      },
    });
    const role = await o.tx((tx) =>
      identity.createRole(tx, h.ports, {
        key: 'night_lead',
        name: 'Night lead',
        permissions: ['platform.property.read', 'platform.businessDate.advance'],
      }),
    );
    expect(role).toMatchObject({
      isSystem: false,
      version: 1,
      sensitivePermissions: ['platform.businessDate.advance'],
    });
    const catalog = identity.getPermissionCatalog(h.ports);
    expect(catalog.modules.map((m) => m.module)).toEqual(['identity', 'platform']);
    expect(catalog.totals.sensitive).toBeGreaterThan(0);
  });

  it('system templates are immutable but clonable; edits are versioned, previewed and guarded', async () => {
    const o = await org(h);
    const roles = await o.tx((tx) => identity.listRoleViews(tx, h.ports));
    const gm = roles.find((r) => r.key === 'general_manager');
    if (!gm) throw new Error('missing template');
    await expect(
      o.tx((tx) => identity.updateRole(tx, h.ports, gm.id, gm.version, { name: 'x' })),
    ).rejects.toMatchObject({
      code: 'system_role_immutable',
    });
    const clone = await o.tx((tx) =>
      identity.cloneRole(tx, h.ports, gm.id, { key: 'gm_lite', name: 'GM (lite)' }),
    );
    expect(clone).toMatchObject({ templateKey: 'general_manager', isSystem: false });
    // Only catalog-valid entries of the template are kept (other modules are not installed in this test).
    expect(clone.permissions).toEqual(expect.arrayContaining(['platform.property.*', 'identity.user.read']));
    expect(clone.permissions).not.toContain('inventory.*');
    const p = await o.property('R1');
    const holder = await o.member([{ roleKey: 'gm_lite', scopeType: 'property', scopeId: p.id }]);
    const preview = await o.tx((tx) =>
      identity.previewRoleChange(tx, h.ports, clone.id, [...clone.permissions, 'identity.user.manage']),
    );
    expect(preview).toMatchObject({
      added: ['identity.user.manage'],
      addedSensitive: ['identity.user.manage'],
      affectedMembers: 1,
    });
    const updated = await o.tx((tx) =>
      identity.updateRole(tx, h.ports, clone.id, clone.version, {
        permissions: [...clone.permissions, 'identity.user.manage'],
      }),
    );
    expect(updated.version).toBe(2);
    await expect(
      o.tx((tx) => identity.updateRole(tx, h.ports, clone.id, clone.version, { name: 'stale' })),
    ).rejects.toMatchObject({ code: 'version_conflict' });
    // An editor cannot add permissions they do not hold themselves.
    await o.tx((tx) =>
      identity.createRole(tx, h.ports, {
        key: 'role_editor',
        name: 'Role editor',
        permissions: ['identity.role.manage', 'identity.user.read', 'platform.property.read'],
      }),
    );
    const editor = await o.member([{ roleKey: 'role_editor', scopeType: 'organization' }]);
    const editorCtx = (await signIn(h, editor.email)).ctx;
    await expect(
      o.tx(
        (tx) =>
          identity.updateRole(tx, h.ports, clone.id, updated.version, {
            permissions: [...updated.permissions, 'platform.organization.manage'],
          }),
        editorCtx,
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(o.tx((tx) => identity.archiveRole(tx, h.ports, clone.id, 'unused'))).rejects.toMatchObject({
      code: 'role_in_use',
    });
    expect(holder.userId).toBeTruthy();
  });

  it('prevents self-grants and privilege escalation when assigning roles', async () => {
    const o = await org(h);
    const p = await o.property('R2');
    // A property manager who may assign roles but holds only property-level permissions.
    const role = await o.tx((tx) =>
      identity.createRole(tx, h.ports, {
        key: 'hr_assistant',
        name: 'HR assistant',
        permissions: ['identity.role.assign', 'identity.user.read', 'platform.property.read'],
      }),
    );
    expect(role.key).toBe('hr_assistant');
    const hr = await o.member([{ roleKey: 'hr_assistant', scopeType: 'organization' }]);
    const target = await o.member([]);
    const s = await signIn(h, hr.email);
    await expect(
      o.tx(
        (tx) =>
          identity.assignRole(tx, { userId: hr.userId, roleKey: 'read_only', scopeType: 'organization' }),
        s.ctx,
      ),
    ).rejects.toMatchObject({ code: 'segregation_of_duties' });
    await expect(
      o.tx(
        (tx) =>
          identity.assignRole(tx, { userId: target.userId, roleKey: 'org_admin', scopeType: 'organization' }),
        s.ctx,
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      o.tx(
        (tx) =>
          identity.assignRole(tx, {
            userId: target.userId,
            roleKey: 'hr_assistant',
            scopeType: 'property',
            scopeId: p.id,
          }),
        s.ctx,
      ),
    ).resolves.toMatchObject({ assignmentId: expect.any(String) });
  });
});

describe('staff lifecycle', () => {
  it('invites (simulated outside live), accepts with a password, then signs in', async () => {
    const o = await org(h, { environment: 'trial' });
    const p = await o.property('INV');
    const email = `new-${newId()}@lagoon.mv`;
    const before = h.sent.length;
    const invite = await o.tx((tx) =>
      identity.inviteMember(tx, h.ports, {
        email,
        displayName: 'Mariyam',
        roles: [{ roleKey: 'front_desk', scopeType: 'property', scopeId: p.id }],
      }),
    );
    expect(invite.delivery.mode).toBe('simulate');
    const link = invite.delivery.simulated?.link as string;
    expect(link).toMatch(/^https:\/\/app\.portico\.test\/accept-invitation\?token=inv\./);
    expect(h.sent.length).toBe(before + 1);
    // Invited members cannot sign in yet.
    await expect(identity.login(h.t.db, { email, password: PASSWORD })).rejects.toMatchObject({
      code: 'unauthenticated',
    });
    const token = decodeURIComponent(link.split('token=')[1] as string);
    await expect(identity.acceptInvitation(h.t.db, { token })).rejects.toMatchObject({
      code: 'password_required',
    });
    await identity.acceptInvitation(h.t.db, { token, password: PASSWORD });
    await expect(identity.acceptInvitation(h.t.db, { token, password: PASSWORD })).rejects.toMatchObject({
      code: 'unauthenticated',
    });
    const s = await signIn(h, email);
    expect(s.ctx.authz.can('reservations.stay.checkIn', { propertyId: p.id })).toBe(true);
  });

  it('enforces time-limited assignments (ends_at)', async () => {
    const o = await org(h);
    const p = await o.property('TL');
    const m = await o.member([]);
    await o.tx((tx) =>
      identity.assignRole(tx, {
        userId: m.userId,
        roleKey: 'front_desk',
        scopeType: 'property',
        scopeId: p.id,
        endsAt: new Date(h.clock.now().getTime() + 60 * 60_000),
        reason: 'seasonal cover',
      }),
    );
    const s = await signIn(h, m.email);
    expect(s.ctx.authz.can('reservations.stay.checkIn', { propertyId: p.id })).toBe(true);
    h.clock.advance(61 * 60_000);
    const later = await authenticate(h, s.token);
    expect(later?.authz.can('reservations.stay.checkIn', { propertyId: p.id })).toBe(false);
  });

  it('transfers between properties in one audited operation, now or scheduled', async () => {
    const o = await org(h);
    const a = await o.property('TA');
    const b = await o.property('TB');
    const m = await o.member([{ roleKey: 'front_desk', scopeType: 'property', scopeId: a.id }]);
    const preview = await o.tx((tx) =>
      identity.previewTransfer(tx, { userId: m.userId, fromPropertyId: a.id, toPropertyId: b.id }),
    );
    expect(preview.add).toEqual([{ roleKey: 'front_desk', propertyId: b.id }]);
    await o.tx((tx) =>
      identity.transferMember(tx, h.ports, {
        userId: m.userId,
        fromPropertyId: a.id,
        toPropertyId: b.id,
        reason: 'moved to Hulhumalé',
      }),
    );
    const s = await signIn(h, m.email);
    expect(s.ctx.authz.can('reservations.stay.checkIn', { propertyId: a.id })).toBe(false);
    expect(s.ctx.authz.can('reservations.stay.checkIn', { propertyId: b.id })).toBe(true);
    const audit = await h.t.admin.kysely
      .selectFrom('core.audit_log')
      .select('action')
      .where('tenant_id', '=', o.tenantId)
      .where('target_id', '=', m.userId)
      .where('action', '=', 'identity.user.transfer')
      .execute();
    expect(audit).toHaveLength(1);
    // Scheduled transfer back: effective in one day.
    const at = new Date(h.clock.now().getTime() + 86_400_000);
    await o.tx((tx) =>
      identity.transferMember(tx, h.ports, {
        userId: m.userId,
        fromPropertyId: b.id,
        toPropertyId: a.id,
        effectiveAt: at,
        reason: 'season ends',
      }),
    );
    let ctx = await authenticate(h, s.token);
    expect(ctx?.authz.can('reservations.stay.checkIn', { propertyId: b.id })).toBe(true);
    expect(ctx?.authz.can('reservations.stay.checkIn', { propertyId: a.id })).toBe(false);
    h.clock.advance(86_400_000 + 1);
    // Sessions expire after 12 h; sign in again.
    ctx = (await signIn(h, m.email)).ctx;
    expect(ctx.authz.can('reservations.stay.checkIn', { propertyId: a.id })).toBe(true);
    expect(ctx.authz.can('reservations.stay.checkIn', { propertyId: b.id })).toBe(false);
    await expect(
      o.tx((tx) =>
        identity.transferMember(tx, h.ports, {
          userId: m.userId,
          fromPropertyId: b.id,
          toPropertyId: a.id,
          reason: 'x',
        }),
      ),
    ).rejects.toMatchObject({ code: 'nothing_to_transfer' });
  });

  it('lists and revokes sessions (self and admin)', async () => {
    const o = await org(h);
    const m = await o.member([]);
    const s1 = await signIn(h, m.email);
    const s2 = await signIn(h, m.email);
    const mine = await o.tx((tx) => identity.listSessions(tx, m.userId), s1.ctx);
    expect(mine).toHaveLength(2);
    expect(mine.filter((x) => x.current)).toHaveLength(1);
    const other = mine.find((x) => !x.current);
    await o.tx((tx) => identity.revokeSessionById(tx, other?.id as string, 'lost tablet'), s1.ctx);
    expect(await authenticate(h, s2.token)).toBeNull();
    expect(await authenticate(h, s1.token)).not.toBeNull();
    const peer = await o.member([{ roleKey: 'read_only', scopeType: 'organization' }]);
    const peerCtx = (await signIn(h, peer.email)).ctx;
    await expect(o.tx((tx) => identity.listSessions(tx, m.userId), peerCtx)).rejects.toMatchObject({
      code: 'forbidden',
    });
    expect(await o.tx((tx) => identity.revokeAllSessions(tx, m.userId, 'security review'))).toBe(1);
    expect(await authenticate(h, s1.token)).toBeNull();
  });

  it('removal revokes sessions, roles and the API keys the person issued; audit is kept', async () => {
    const o = await org(h);
    const admin = await o.member([{ roleKey: 'org_admin', scopeType: 'organization' }]);
    const s = await signIn(h, admin.email);
    const { token } = await o.tx(
      (tx) => identity.createApiClient(tx, { name: 'POS bridge', permissions: ['platform.property.read'] }),
      s.ctx,
    );
    expect(await identity.authenticateToken(h.t.db, token, h.ports)).not.toBeNull();
    const counts = await o.tx((tx) => identity.removeMember(tx, admin.userId, 'left the company'));
    expect(counts).toEqual({ sessions: 1, assignments: 1, apiClients: 1 });
    expect(await authenticate(h, s.token)).toBeNull();
    expect(await identity.authenticateToken(h.t.db, token, h.ports)).toBeNull();
    const audit = await h.t.admin.kysely
      .selectFrom('core.audit_log')
      .select('action')
      .where('tenant_id', '=', o.tenantId)
      .where('target_id', '=', admin.userId)
      .execute();
    expect(audit.map((a) => a.action)).toEqual(
      expect.arrayContaining(['identity.user.create', 'identity.user.remove']),
    );
    // Rehire: a new invitation reuses the membership.
    const again = await o.tx((tx) =>
      identity.inviteMember(tx, h.ports, { email: admin.email, displayName: 'Back', roles: [] }),
    );
    expect(again.userId).toBe(admin.userId);
  });

  it('password reset: no enumeration, single-use token, sessions revoked in every organization', async () => {
    const a = await org(h);
    const b = await org(h);
    const m = await a.member([]);
    await b.tx((tx) => identity.createUser(tx, { email: m.email, displayName: 'M', roles: [] }));
    const sa = await signIn(h, m.email, a.tenantId);
    const sb = await signIn(h, m.email, b.tenantId);
    await identity.requestPasswordReset(h.t.db, h.ports, { email: `nobody-${newId()}@lagoon.mv` });
    const before = h.sent.length;
    await identity.requestPasswordReset(h.t.db, h.ports, { email: m.email });
    expect(h.sent.length).toBe(before + 1);
    const link = h.sent.at(-1)?.link as string;
    const token = decodeURIComponent(link.split('token=')[1] as string);
    const newPassword = 'another long passphrase';
    const res = await identity.completePasswordReset(h.t.db, { token, newPassword });
    expect(res.sessionsRevoked).toBe(2);
    expect(await authenticate(h, sa.token)).toBeNull();
    expect(await authenticate(h, sb.token)).toBeNull();
    await expect(identity.completePasswordReset(h.t.db, { token, newPassword })).rejects.toMatchObject({
      code: 'unauthenticated',
    });
    const login = await identity.login(h.t.db, {
      email: m.email,
      password: newPassword,
      organizationId: a.tenantId,
    });
    expect(login.status).toBe('signed_in');
  });
});
