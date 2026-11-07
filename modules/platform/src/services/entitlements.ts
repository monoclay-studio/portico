import { type TxContext, typed } from '@portico/db';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  newId,
  requirePermission,
  ValidationError,
} from '@portico/kernel';
import { featuresOfGrant, grantableOn, MODULE_PACKS, planByCode } from '../domain/plans';
import { actorKey, getLimit, getOrganization } from '../service';
import type { PlatformDB } from '../tables';

const db = (tx: TxContext) => typed<PlatformDB>(tx.db);

/** What the organization is entitled to, and what it could add (plan page; editions.md). */
export async function getEntitlementSummary(tx: TxContext) {
  requirePermission(tx, 'platform.plan.read');
  const org = await getOrganization(tx);
  const plan = planByCode(org.planCode);
  if (!plan) throw new NotFoundError('plan', org.planCode);
  const grants = await db(tx)
    .selectFrom('platform.entitlement_grants')
    .selectAll()
    .where('revoked_at', 'is', null)
    .orderBy('granted_at')
    .execute();
  const orgWide = new Set<string>(plan.features);
  for (const g of grants) if (!g.property_id) for (const f of featuresOfGrant(g.kind, g.key)) orgWide.add(f);
  const limits: Record<string, number | null> = {};
  for (const key of Object.keys(plan.limits)) limits[key] = await getLimit(tx, key);
  return {
    plan: { code: plan.code, name: plan.name },
    features: [...orgWide].sort(),
    limits,
    availableAddOns: [...plan.addOns],
    availablePacks: MODULE_PACKS.filter((p) => plan.packs.includes(p.key)).map((p) => ({
      key: p.key,
      name: p.name,
      features: [...p.features],
      requires: [...p.requires],
    })),
    grants: grants.map((g) => ({
      id: g.id,
      kind: g.kind,
      key: g.key,
      propertyId: g.property_id,
      features: [...featuresOfGrant(g.kind, g.key)],
      grantedAt: g.granted_at.toISOString(),
    })),
  };
}

/**
 * Grant an add-on or Connect pack. Commercial decision: only Monoclay operators (trusted system context from the
 * operator console or provisioning) may grant — never a tenant user, even an organization administrator.
 */
export async function grantEntitlement(
  tx: TxContext,
  input: { kind: 'add_on' | 'pack'; key: string; propertyId?: string; reason: string },
): Promise<{ id: string }> {
  if (tx.actor.kind !== 'system') throw new ForbiddenError('platform.entitlement.grant');
  const org = await getOrganization(tx);
  const plan = planByCode(org.planCode);
  if (!plan || !grantableOn(plan, input.kind, input.key)) {
    throw new ValidationError(
      'not_available_on_plan',
      `${input.kind === 'pack' ? 'Module pack' : 'Add-on'} "${input.key}" is not offered on the ${plan?.name ?? org.planCode} plan. Choose one listed for this plan or change the plan.`,
      { kind: input.kind, key: input.key, plan: org.planCode },
    );
  }
  if (input.propertyId) {
    const p = await db(tx)
      .selectFrom('platform.properties')
      .select('id')
      .where('id', '=', input.propertyId)
      .executeTakeFirst();
    if (!p) throw new NotFoundError('property', input.propertyId);
  }
  const id = newId();
  try {
    await db(tx)
      .insertInto('platform.entitlement_grants')
      .values({
        id,
        tenant_id: tx.tenantId,
        kind: input.kind,
        key: input.key,
        property_id: input.propertyId ?? null,
        reason: input.reason,
        granted_by: actorKey(tx),
        granted_at: tx.now,
        revoked_at: null,
        revoked_by: null,
        revoke_reason: null,
      })
      .execute();
  } catch (err) {
    if ((err as { code?: string }).code === '23505')
      throw new ConflictError('already_granted', `"${input.key}" is already granted for this scope.`);
    throw err;
  }
  await tx.audit({
    action: 'platform.entitlement.grant',
    target: { type: 'organization', id: tx.tenantId },
    propertyId: input.propertyId ?? null,
    reason: input.reason,
    after: input,
  });
  await tx.emit({
    type: 'platform.entitlement.changed',
    propertyId: input.propertyId ?? null,
    aggregate: { type: 'organization', id: tx.tenantId },
    payload: { change: 'granted', kind: input.kind, key: input.key, propertyId: input.propertyId ?? null },
  });
  return { id };
}

/** Revoking never deletes feature data (PLT-R23); the feature's data becomes read-only in its module. */
export async function revokeEntitlementGrant(tx: TxContext, grantId: string, reason: string): Promise<void> {
  if (tx.actor.kind !== 'system') throw new ForbiddenError('platform.entitlement.grant');
  const row = await db(tx)
    .updateTable('platform.entitlement_grants')
    .set({ revoked_at: tx.now, revoked_by: actorKey(tx), revoke_reason: reason })
    .where('id', '=', grantId)
    .where('revoked_at', 'is', null)
    .returningAll()
    .executeTakeFirst();
  if (!row) throw new NotFoundError('entitlement_grant', grantId);
  await tx.audit({
    action: 'platform.entitlement.revoke',
    target: { type: 'organization', id: tx.tenantId },
    propertyId: row.property_id,
    reason,
    before: { kind: row.kind, key: row.key, propertyId: row.property_id },
  });
  await tx.emit({
    type: 'platform.entitlement.changed',
    propertyId: row.property_id,
    aggregate: { type: 'organization', id: tx.tenantId },
    payload: { change: 'revoked', kind: row.kind, key: row.key, propertyId: row.property_id },
  });
}
