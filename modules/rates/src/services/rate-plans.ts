/** Rate plans: base and derived (multi-level, cycle-safe), inheritance choices, status lifecycle. */
import { explainVersionMiss, sql, type TxContext } from '@portico/db';
import { assertCurrency, BusinessRuleError, NotFoundError, newId, ValidationError } from '@portico/kernel';
import {
  commission,
  derivationInput,
  eligibility,
  inheritance,
  type RatePlanDto,
  type RatePlanInput,
  ratePlanInput,
  ratePlanStatusChange,
  ratePlanUpdate,
  taxInclusion,
} from '../contracts';
import { DerivationError } from '../domain/errors';
import { ancestry, descendants, validateDerivationGraph } from '../domain/pricing';
import { RATES_EVENTS } from '../events';
import type { RatesPorts } from '../ports';
import { assertPackagesAtProperty } from './catalog';
import { db, guardConfigWrite, json, lockPlanGraph, parseInput, parseStored, type Row, requireRead, withUniqueCode } from './shared';

export function toRatePlan(r: Row<'rates.rate_plans'>): RatePlanDto {
  return {
    id: r.id,
    propertyId: r.property_id,
    code: r.code,
    name: r.name,
    description: r.description,
    currency: r.currency,
    kind: r.parent_id ? 'derived' : 'base',
    derivation: r.derivation ? parseStored(derivationInput, r.derivation, 'derivation') : null,
    inherit: parseStored(inheritance, r.inherit, 'inheritance'),
    mealPlan: r.meal_plan,
    packageIds: r.package_ids,
    cancellationPolicyId: r.cancellation_policy_id,
    guaranteePolicyId: r.guarantee_policy_id,
    depositPolicyId: r.deposit_policy_id,
    eligibility: parseStored(eligibility, r.eligibility, 'eligibility'),
    commission: r.commission ? parseStored(commission, r.commission, 'commission') : null,
    taxInclusion: parseStored(taxInclusion, r.tax_inclusion, 'tax inclusion'),
    roomChargeCode: r.room_charge_code,
    marketSegment: r.market_segment,
    status: r.status,
    version: r.version,
  };
}

export async function loadPlansForProperty(tx: TxContext, propertyId: string): Promise<RatePlanDto[]> {
  const rows = await db(tx).selectFrom('rates.rate_plans').selectAll().where('property_id', '=', propertyId).orderBy('code').execute();
  return rows.map(toRatePlan);
}

/** Plans as graph nodes (`parentId` from the derivation). */
export const asNodes = (plans: readonly RatePlanDto[]) =>
  plans.map((p) => ({ ...p, parentId: p.derivation?.parentRatePlanId ?? null }));

async function validatePolicyRefs(
  tx: TxContext,
  propertyId: string,
  refs: Array<{ id: string | undefined | null; kind: 'cancellation' | 'guarantee' | 'deposit' }>,
): Promise<void> {
  for (const ref of refs) {
    if (!ref.id) continue;
    const p = await db(tx).selectFrom('rates.policies').select(['kind', 'property_id', 'status']).where('id', '=', ref.id).executeTakeFirst();
    if (!p || p.property_id !== propertyId)
      throw new ValidationError('policy_not_found', `The ${ref.kind} policy ${ref.id} does not exist at this property.`);
    if (p.kind !== ref.kind)
      throw new ValidationError('policy_kind_mismatch', `Policy ${ref.id} is a ${p.kind} policy, not a ${ref.kind} policy.`);
  }
}

function validateDerivation(
  plans: RatePlanDto[],
  planId: string,
  currency: string,
  derivation: RatePlanInput['derivation'] | null,
): void {
  const nodes = plans.map((p) => ({ id: p.id, parentId: p.derivation?.parentRatePlanId ?? null, code: p.code }));
  if (!nodes.some((n) => n.id === planId)) nodes.push({ id: planId, parentId: null, code: 'the new plan' });
  if (!derivation) {
    validateDerivationGraph(nodes, planId, null);
    return;
  }
  const parent = plans.find((p) => p.id === derivation.parentRatePlanId);
  if (!parent) throw new DerivationError('parent_plan_not_found', 'The parent rate plan does not exist at this property.');
  if (parent.status === 'retired') throw new DerivationError('parent_plan_retired', `The parent rate plan ${parent.code} is retired. Choose an active plan.`);
  if (parent.currency !== currency)
    throw new DerivationError('derivation_currency_mismatch', `A derived plan must use its parent's currency (${parent.currency}).`);
  validateDerivationGraph(nodes, planId, parent.id);
}

export async function createRatePlan(ports: RatesPorts, tx: TxContext, raw: unknown): Promise<RatePlanDto> {
  const input: RatePlanInput = parseInput(ratePlanInput, raw);
  await guardConfigWrite(ports, tx, input.propertyId, 'rates.ratePlan.manage');
  const property = await ports.getProperty(tx, input.propertyId);
  const currency = input.currency ?? property.baseCurrency;
  assertCurrency(currency);
  await lockPlanGraph(tx, input.propertyId);
  const id = newId();
  validateDerivation(await loadPlansForProperty(tx, input.propertyId), id, currency, input.derivation ?? null);
  await validatePolicyRefs(tx, input.propertyId, [
    { id: input.cancellationPolicyId, kind: 'cancellation' },
    { id: input.guaranteePolicyId, kind: 'guarantee' },
    { id: input.depositPolicyId, kind: 'deposit' },
  ]);
  await assertPackagesAtProperty(tx, input.propertyId, input.packageIds);
  const row = await withUniqueCode('rate_plan', input.code, () =>
    db(tx)
      .insertInto('rates.rate_plans')
      .values({
        id,
        tenant_id: tx.tenantId,
        property_id: input.propertyId,
        code: input.code,
        name: input.name,
        description: input.description ?? null,
        currency,
        parent_id: input.derivation?.parentRatePlanId ?? null,
        derivation: input.derivation ? json(input.derivation) : null,
        inherit: json(input.inherit),
        meal_plan: input.mealPlan,
        package_ids: input.packageIds,
        cancellation_policy_id: input.cancellationPolicyId ?? null,
        guarantee_policy_id: input.guaranteePolicyId ?? null,
        deposit_policy_id: input.depositPolicyId ?? null,
        eligibility: json(input.eligibility),
        commission: input.commission ? json(input.commission) : null,
        tax_inclusion: json(input.taxInclusion),
        room_charge_code: input.roomChargeCode,
        market_segment: input.marketSegment ?? null,
      })
      .returningAll()
      .executeTakeFirstOrThrow(),
  );
  const plan = toRatePlan(row);
  await tx.audit({ action: 'rates.ratePlan.create', target: { type: 'rate_plan', id }, propertyId: input.propertyId, after: plan });
  await tx.emit({
    type: RATES_EVENTS.ratePlanChanged,
    propertyId: input.propertyId,
    aggregate: { type: 'rate_plan', id },
    payload: { propertyId: input.propertyId, ratePlanId: id, change: 'created' },
  });
  return plan;
}

export async function updateRatePlan(
  ports: RatesPorts,
  tx: TxContext,
  id: string,
  expectedVersion: number,
  raw: unknown,
): Promise<RatePlanDto> {
  const patch = parseInput(ratePlanUpdate, raw);
  const beforeRow = await db(tx).selectFrom('rates.rate_plans').selectAll().where('id', '=', id).executeTakeFirst();
  if (!beforeRow) throw new NotFoundError('rate_plan', id);
  const before = toRatePlan(beforeRow);
  await guardConfigWrite(ports, tx, before.propertyId, 'rates.ratePlan.manage');
  if (before.status === 'retired') throw new BusinessRuleError('rate_plan_retired', 'This rate plan is retired and can no longer be changed.');
  await lockPlanGraph(tx, before.propertyId);
  if (patch.derivation !== undefined) {
    validateDerivation(await loadPlansForProperty(tx, before.propertyId), id, before.currency, patch.derivation);
  }
  await validatePolicyRefs(tx, before.propertyId, [
    { id: patch.cancellationPolicyId, kind: 'cancellation' },
    { id: patch.guaranteePolicyId, kind: 'guarantee' },
    { id: patch.depositPolicyId, kind: 'deposit' },
  ]);
  if (patch.packageIds) await assertPackagesAtProperty(tx, before.propertyId, patch.packageIds);
  const row = await db(tx)
    .updateTable('rates.rate_plans')
    .set({
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      ...(patch.derivation !== undefined
        ? { parent_id: patch.derivation?.parentRatePlanId ?? null, derivation: patch.derivation ? json(patch.derivation) : null }
        : {}),
      ...(patch.inherit !== undefined ? { inherit: json(patch.inherit) } : {}),
      ...(patch.mealPlan !== undefined ? { meal_plan: patch.mealPlan } : {}),
      ...(patch.packageIds !== undefined ? { package_ids: patch.packageIds } : {}),
      ...(patch.cancellationPolicyId !== undefined ? { cancellation_policy_id: patch.cancellationPolicyId } : {}),
      ...(patch.guaranteePolicyId !== undefined ? { guarantee_policy_id: patch.guaranteePolicyId } : {}),
      ...(patch.depositPolicyId !== undefined ? { deposit_policy_id: patch.depositPolicyId } : {}),
      ...(patch.eligibility !== undefined ? { eligibility: json(patch.eligibility) } : {}),
      ...(patch.commission !== undefined ? { commission: patch.commission ? json(patch.commission) : null } : {}),
      ...(patch.taxInclusion !== undefined ? { tax_inclusion: json(patch.taxInclusion) } : {}),
      ...(patch.roomChargeCode !== undefined ? { room_charge_code: patch.roomChargeCode } : {}),
      ...(patch.marketSegment !== undefined ? { market_segment: patch.marketSegment } : {}),
      version: sql`version + 1`,
      updated_at: tx.now,
    })
    .where('id', '=', id)
    .where('version', '=', expectedVersion)
    .returningAll()
    .executeTakeFirst();
  if (!row) return explainVersionMiss('rate_plan', id, expectedVersion, async () => before.version);
  const after = toRatePlan(row);
  await tx.audit({ action: 'rates.ratePlan.update', target: { type: 'rate_plan', id }, propertyId: after.propertyId, before, after });
  const priceShapeChanged = patch.derivation !== undefined;
  await tx.emit({
    type: RATES_EVENTS.ratePlanChanged,
    propertyId: after.propertyId,
    aggregate: { type: 'rate_plan', id },
    payload: { propertyId: after.propertyId, ratePlanId: id, change: 'updated', pricesAffected: priceShapeChanged },
  });
  return after;
}

const TRANSITIONS: Record<string, string[]> = {
  draft: ['active', 'retired'],
  active: ['paused', 'retired'],
  paused: ['active', 'retired'],
  retired: [],
};

/** Effective policy id for a plan honouring inheritance (nearest plan in the chain that owns it). */
export function effectivePolicyId(
  chain: readonly RatePlanDto[],
  kind: 'cancellationPolicy' | 'guaranteePolicy' | 'depositPolicy',
): string | null {
  for (let i = chain.length - 1; i >= 0; i--) {
    const p = chain[i] as RatePlanDto;
    const own = kind === 'cancellationPolicy' ? p.cancellationPolicyId : kind === 'guaranteePolicy' ? p.guaranteePolicyId : p.depositPolicyId;
    if (i === 0 || !p.inherit[kind]) return own;
  }
  return null;
}

export async function changeRatePlanStatus(
  ports: RatesPorts,
  tx: TxContext,
  id: string,
  expectedVersion: number,
  raw: unknown,
): Promise<RatePlanDto> {
  const { status, reason } = parseInput(ratePlanStatusChange, raw);
  const beforeRow = await db(tx).selectFrom('rates.rate_plans').selectAll().where('id', '=', id).executeTakeFirst();
  if (!beforeRow) throw new NotFoundError('rate_plan', id);
  const before = toRatePlan(beforeRow);
  await guardConfigWrite(ports, tx, before.propertyId, 'rates.ratePlan.manage');
  if (!TRANSITIONS[before.status]?.includes(status)) {
    throw new BusinessRuleError('invalid_status_change', `A ${before.status} rate plan cannot become ${status}.`, { from: before.status, to: status });
  }
  const plans = await loadPlansForProperty(tx, before.propertyId);
  const chain = ancestry(asNodes(plans), id);
  if (status === 'active') {
    const root = chain[0] as RatePlanDto;
    const priced = await db(tx).selectFrom('rates.prices').select('id').where('rate_plan_id', '=', root.id).limit(1).executeTakeFirst();
    if (!priced) {
      throw new BusinessRuleError(
        'rate_plan_has_no_prices',
        `${before.code} has no prices yet${root.id !== id ? ` (its base plan ${root.code} has none)` : ''}. Add prices in the rate calendar before activating it.`,
      );
    }
    if (!effectivePolicyId(chain, 'cancellationPolicy')) {
      throw new BusinessRuleError('rate_plan_needs_cancellation_policy', `${before.code} needs a cancellation policy (its own or inherited) before it can be sold.`);
    }
    const inactiveAncestor = chain.slice(0, -1).find((p) => p.status !== 'active');
    if (inactiveAncestor) {
      throw new BusinessRuleError('parent_plan_not_active', `${before.code} derives from ${inactiveAncestor.code}, which is ${inactiveAncestor.status}. Activate it first.`);
    }
  }
  if (status === 'retired') {
    const children = descendants(asNodes(plans), id).filter((p) => p.status !== 'retired');
    if (children.length > 0) {
      throw new BusinessRuleError(
        'rate_plan_has_derived_plans',
        `Plans derived from ${before.code} must be re-parented or retired first: ${children.map((c) => c.code).join(', ')}.`,
        { derived: children.map((c) => c.id) },
      );
    }
  }
  const row = await db(tx)
    .updateTable('rates.rate_plans')
    .set({ status, version: sql`version + 1`, updated_at: tx.now })
    .where('id', '=', id)
    .where('version', '=', expectedVersion)
    .returningAll()
    .executeTakeFirst();
  if (!row) return explainVersionMiss('rate_plan', id, expectedVersion, async () => before.version);
  const after = toRatePlan(row);
  await tx.audit({
    action: 'rates.ratePlan.status',
    target: { type: 'rate_plan', id },
    propertyId: after.propertyId,
    reason: reason ?? null,
    before: { status: before.status },
    after: { status },
  });
  await tx.emit({
    type: RATES_EVENTS.ratePlanStatusChanged,
    propertyId: after.propertyId,
    aggregate: { type: 'rate_plan', id },
    payload: { propertyId: after.propertyId, ratePlanId: id, from: before.status, to: status },
  });
  return after;
}

/** Provider: getRatePlan (domain map). */
export async function getRatePlan(tx: TxContext, id: string): Promise<RatePlanDto> {
  const row = await db(tx).selectFrom('rates.rate_plans').selectAll().where('id', '=', id).executeTakeFirst();
  if (!row) throw new NotFoundError('rate_plan', id);
  requireRead(tx, row.property_id);
  return toRatePlan(row);
}

/** Provider: listRatePlans (domain map). */
export async function listRatePlans(
  tx: TxContext,
  input: { propertyId: string; status?: RatePlanDto['status'] | undefined },
): Promise<RatePlanDto[]> {
  requireRead(tx, input.propertyId);
  let q = db(tx).selectFrom('rates.rate_plans').selectAll().where('property_id', '=', input.propertyId).orderBy('code');
  if (input.status) q = q.where('status', '=', input.status);
  return (await q.execute()).map(toRatePlan);
}
