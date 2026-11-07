import { explainVersionMiss, sql, type TxContext, typed } from '@portico/db';
import { actorId, BusinessRuleError, requirePermission, ValidationError } from '@portico/kernel';
import type { IdentityDB } from '../tables';
import { assertCanGrantRole, assertNotElevated } from './guard';
import { raiseSecurityAlert } from './security';

const db = (tx: TxContext) => typed<IdentityDB>(tx.db);

/** Organization security policy (MFA step-up, enrolment grace, support access approval, break-glass). */
export interface SecurityPolicy {
  mfaStepUpWindowMinutes: number;
  mfaGracePeriodHours: number;
  requireMfaForAll: boolean;
  supportAccessApproval: 'always_required' | 'auto_approve_read_only';
  supportMaxMinutes: number;
  breakGlassUserIds: string[];
  breakGlassRoleKey: string;
  breakGlassMaxMinutes: number;
  version: number;
}

export const DEFAULT_SECURITY_POLICY: SecurityPolicy = {
  mfaStepUpWindowMinutes: 15,
  mfaGracePeriodHours: 72,
  requireMfaForAll: false,
  supportAccessApproval: 'always_required',
  supportMaxMinutes: 240,
  breakGlassUserIds: [],
  breakGlassRoleKey: 'org_admin',
  breakGlassMaxMinutes: 240,
  version: 0,
};

export async function getSecurityPolicy(tx: TxContext): Promise<SecurityPolicy> {
  const r = await db(tx).selectFrom('identity.organization_security').selectAll().executeTakeFirst();
  if (!r) return DEFAULT_SECURITY_POLICY;
  return {
    mfaStepUpWindowMinutes: r.mfa_step_up_window_minutes,
    mfaGracePeriodHours: r.mfa_grace_period_hours,
    requireMfaForAll: r.require_mfa_for_all,
    supportAccessApproval: r.support_access_approval,
    supportMaxMinutes: r.support_max_minutes,
    breakGlassUserIds: r.break_glass_user_ids,
    breakGlassRoleKey: r.break_glass_role_key,
    breakGlassMaxMinutes: r.break_glass_max_minutes,
    version: r.version,
  };
}

export type SecurityPolicyPatch = Partial<Omit<SecurityPolicy, 'version'>>;

/** Update the policy (optimistic: `expectedVersion` 0 means "no policy row yet"). */
export async function updateSecurityPolicy(
  tx: TxContext,
  expectedVersion: number,
  patch: SecurityPolicyPatch,
): Promise<SecurityPolicy> {
  requirePermission(tx, 'identity.security.manage');
  assertNotElevated(tx, 'Changing the security policy');
  const before = await getSecurityPolicy(tx);
  const next = { ...before, ...patch };
  const designationChanged =
    (patch.breakGlassUserIds !== undefined &&
      [...patch.breakGlassUserIds].sort().join() !== [...before.breakGlassUserIds].sort().join()) ||
    (patch.breakGlassRoleKey !== undefined && patch.breakGlassRoleKey !== before.breakGlassRoleKey);
  if (designationChanged) {
    // ADR-0017 §10: nobody designates themselves, and the designator must hold everything the role grants.
    const added = next.breakGlassUserIds.filter((u) => !before.breakGlassUserIds.includes(u));
    if (tx.actor.kind === 'user' && added.includes(tx.actor.userId)) {
      throw new BusinessRuleError(
        'segregation_of_duties',
        'You cannot designate yourself for emergency access. Ask another administrator.',
      );
    }
    const role = await db(tx)
      .selectFrom('identity.roles')
      .select(['permissions'])
      .where('key', '=', next.breakGlassRoleKey)
      .where('archived_at', 'is', null)
      .executeTakeFirst();
    if (!role)
      throw new ValidationError(
        'unknown_role',
        `There is no role "${next.breakGlassRoleKey}" in this organization.`,
      );
    await assertCanGrantRole(
      tx,
      role.permissions,
      { type: 'organization', id: null },
      undefined,
      'Only someone who holds every permission of the emergency role can designate emergency-access users.',
    );
    for (const u of added) {
      const m = await db(tx)
        .selectFrom('identity.memberships')
        .select('status')
        .where('user_id', '=', u)
        .executeTakeFirst();
      if (m?.status !== 'active')
        throw new ValidationError(
          'not_an_active_member',
          'Emergency access can only be given to active members.',
        );
    }
  }
  if (next.breakGlassUserIds.length > 5)
    throw new ValidationError('too_many_break_glass_users', 'Designate at most 5 break-glass users.');
  const values = {
    mfa_step_up_window_minutes: next.mfaStepUpWindowMinutes,
    mfa_grace_period_hours: next.mfaGracePeriodHours,
    require_mfa_for_all: next.requireMfaForAll,
    support_access_approval: next.supportAccessApproval,
    support_max_minutes: next.supportMaxMinutes,
    break_glass_user_ids: next.breakGlassUserIds,
    break_glass_role_key: next.breakGlassRoleKey,
    break_glass_max_minutes: next.breakGlassMaxMinutes,
    updated_by: `${tx.actor.kind}:${actorId(tx.actor)}`,
  };
  if (before.version === 0) {
    if (expectedVersion !== 0) {
      return explainVersionMiss('security_policy', tx.tenantId, expectedVersion, async () => 0);
    }
    await db(tx)
      .insertInto('identity.organization_security')
      .values({ tenant_id: tx.tenantId, ...values })
      .onConflict((oc) => oc.column('tenant_id').doNothing())
      .execute();
  } else {
    const res = await db(tx)
      .updateTable('identity.organization_security')
      .set({ ...values, version: sql`version + 1` })
      .where('version', '=', expectedVersion)
      .executeTakeFirst();
    if (Number(res.numUpdatedRows) === 0)
      return explainVersionMiss('security_policy', tx.tenantId, expectedVersion, async () => before.version);
  }
  const after = await getSecurityPolicy(tx);
  await tx.audit({
    action: 'identity.securityPolicy.update',
    target: { type: 'organization', id: tx.tenantId },
    before,
    after,
  });
  if (designationChanged) {
    await raiseSecurityAlert(tx, {
      rule: 'break_glass_designation_changed',
      severity: 'high',
      summary: `Emergency-access designation changed (role ${after.breakGlassRoleKey}, ${after.breakGlassUserIds.length} designated).`,
      details: {
        before: before.breakGlassUserIds,
        after: after.breakGlassUserIds,
        role: after.breakGlassRoleKey,
      },
      dedupeKey: `break-glass-designation:${after.version}`,
    });
  }
  return after;
}
