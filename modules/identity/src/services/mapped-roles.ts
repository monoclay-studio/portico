import { type TxContext, typed } from '@portico/db';
import { actorId, BusinessRuleError, newId } from '@portico/kernel';
import {
  desiredAssignments,
  type GroupRoleMapping,
  reconcileMappedAssignments,
  type ScopeType,
} from '../domain/role-mapping';
import type { IdentityDB } from '../tables';
import { assertAdministratorRemains } from './guard';
import { raiseSecurityAlert } from './security';

/**
 * Applies the organization's group → role mappings to one member. The privileged act is configuring the mappings
 * (identity.sso.manage, with the escalation guardrail); reconciliation applies them for SSO sign-ins and SCIM
 * group changes. Only assignments with the same `source` are touched — manual grants never change here.
 */
const db = (tx: TxContext) => typed<IdentityDB>(tx.db);

export async function loadMappings(tx: TxContext): Promise<GroupRoleMapping[]> {
  const rows = await db(tx)
    .selectFrom('identity.group_role_mappings as m')
    .innerJoin('identity.roles as r', 'r.id', 'm.role_id')
    .select(['m.id', 'm.group_name', 'r.key', 'm.scope_type', 'm.scope_id'])
    .where('r.archived_at', 'is', null)
    .execute();
  return rows.map((r) => ({
    id: r.id,
    group: r.group_name,
    roleKey: r.key,
    scopeType: r.scope_type as ScopeType,
    scopeId: r.scope_id,
  }));
}

export async function reconcileMappedRoles(
  tx: TxContext,
  userId: string,
  source: 'sso' | 'scim',
  groups: readonly string[],
): Promise<{ granted: number; revoked: number; desired: number }> {
  const mappings = await loadMappings(tx);
  const desired = desiredAssignments(groups, mappings);
  const existing = await db(tx)
    .selectFrom('identity.role_assignments as a')
    .innerJoin('identity.roles as r', 'r.id', 'a.role_id')
    .select(['a.id', 'r.key', 'a.scope_type', 'a.scope_id'])
    .where('a.user_id', '=', userId)
    .where('a.source', '=', source)
    .where('a.revoked_at', 'is', null)
    .execute();
  const plan = reconcileMappedAssignments(
    desired,
    existing.map((e) => ({
      assignmentId: e.id,
      roleKey: e.key,
      scopeType: e.scope_type,
      scopeId: e.scope_id,
    })),
  );
  const by = `${tx.actor.kind}:${actorId(tx.actor)}`;
  const roleIds = new Map(
    (await db(tx).selectFrom('identity.roles').select(['id', 'key']).execute()).map((r) => [r.key, r.id]),
  );
  for (const g of plan.grant) {
    const roleId = roleIds.get(g.roleKey);
    if (!roleId) continue;
    await db(tx)
      .insertInto('identity.role_assignments')
      .values({
        id: newId(),
        tenant_id: tx.tenantId,
        user_id: userId,
        role_id: roleId,
        scope_type: g.scopeType,
        scope_id: g.scopeId,
        starts_at: null,
        ends_at: null,
        granted_by: by,
        reason: `${source.toUpperCase()} group mapping`,
        source,
        source_ref: g.mappingId,
      })
      .execute();
  }
  const kept: string[] = [];
  for (const r of plan.revoke) {
    // Review R2-P2-3 / ADR-0017 §6: a group change never removes the organization's last administrator. The
    // assignment is kept and the organization's administrators are alerted to fix the identity provider's groups.
    try {
      await assertAdministratorRemains(tx, { assignmentIds: [r.assignmentId] });
    } catch (err) {
      if (!(err instanceof BusinessRuleError)) throw err;
      kept.push(r.assignmentId);
      await raiseSecurityAlert(tx, {
        rule: 'last_administrator_kept',
        severity: 'high',
        summary: `A ${source.toUpperCase()} group change would have removed the organization's last administrator; the role was kept. Make someone else an administrator or fix the group membership in the identity provider.`,
        subjectUserId: userId,
        details: { source, roleKey: r.roleKey },
        dedupeKey: `last_administrator_kept:${userId}:${r.assignmentId}`,
      });
      continue;
    }
    await db(tx)
      .updateTable('identity.role_assignments')
      .set({ revoked_at: tx.now, revoked_by: by, revoke_reason: `no longer in a mapped ${source} group` })
      .where('id', '=', r.assignmentId)
      .execute();
  }
  plan.revoke = plan.revoke.filter((r) => !kept.includes(r.assignmentId));
  if (plan.grant.length || plan.revoke.length) {
    await tx.audit({
      action: 'identity.role.reconcile',
      target: { type: 'user', id: userId },
      after: {
        source,
        groups,
        granted: plan.grant.map((g) => `${g.roleKey}@${g.scopeType}:${g.scopeId ?? '-'}`),
        revoked: plan.revoke.map((r) => `${r.roleKey}@${r.scopeType}:${r.scopeId ?? '-'}`),
      },
    });
    await tx.emit({
      type: 'identity.roleAssignment.changed',
      aggregate: { type: 'user', id: userId },
      payload: {
        change: 'reconciled',
        userId,
        source,
        granted: plan.grant.length,
        revoked: plan.revoke.length,
      },
    });
  }
  return { granted: plan.grant.length, revoked: plan.revoke.length, desired: desired.length };
}
