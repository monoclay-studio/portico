/** Policies, inclusions/allowances, packages (incl. meal plans) and promotions. */
import { explainVersionMiss, sql, type TxContext } from '@portico/db';
import { NotFoundError, newId, ValidationError } from '@portico/kernel';
import { z } from 'zod';
import {
  allowanceTerms,
  cancellationStructure,
  depositStructure,
  guaranteeStructure,
  type InclusionInput,
  type InclusionSnapshot,
  inclusionInput,
  inclusionPricing,
  inclusionRhythm,
  type PackageInput,
  type PolicyDto,
  type PolicyInput,
  type PolicyKind,
  type PromotionInput,
  packageInput,
  packageUpdate,
  policyInput,
  promotionConditions,
  promotionDiscount,
  promotionInput,
  promotionUpdate,
} from '../contracts';
import { renderCancellationText, renderDepositText, renderGuaranteeText } from '../domain/policies';
import type { PromotionCandidate } from '../domain/promotions';
import type { RatesPorts } from '../ports';
import {
  actorKey,
  db,
  guardConfigWrite,
  json,
  parseInput,
  parseStored,
  type Row,
  requireRead,
  withUniqueCode,
} from './shared';

// ───────────────────────────── Policies ─────────────────────────────

const structureSchema = {
  cancellation: cancellationStructure,
  guarantee: guaranteeStructure,
  deposit: depositStructure,
} as const;

export function policyText(kind: PolicyKind, structure: unknown, currency: string): string {
  if (kind === 'cancellation')
    return renderCancellationText(cancellationStructure.parse(structure), currency);
  if (kind === 'guarantee') return renderGuaranteeText(guaranteeStructure.parse(structure));
  return renderDepositText(depositStructure.parse(structure), currency);
}

function toPolicy(r: Row<'rates.policies'>, currency: string): PolicyDto {
  return {
    id: r.id,
    propertyId: r.property_id,
    kind: r.kind,
    code: r.code,
    name: r.name,
    structure: r.structure,
    text: policyText(r.kind, r.structure, currency),
    version: r.version,
  };
}

export async function createPolicy(ports: RatesPorts, tx: TxContext, raw: unknown): Promise<PolicyDto> {
  const input: PolicyInput = parseInput(policyInput, raw);
  await guardConfigWrite(ports, tx, input.propertyId, 'rates.policy.manage');
  const property = await ports.getProperty(tx, input.propertyId);
  const id = newId();
  const row = await withUniqueCode('policy', input.code, () =>
    db(tx)
      .insertInto('rates.policies')
      .values({
        id,
        tenant_id: tx.tenantId,
        property_id: input.propertyId,
        kind: input.kind,
        code: input.code,
        name: input.name,
        structure: json(input.structure),
      })
      .returningAll()
      .executeTakeFirstOrThrow(),
  );
  await db(tx)
    .insertInto('rates.policy_versions')
    .values({
      id: newId(),
      tenant_id: tx.tenantId,
      policy_id: id,
      version: 1,
      name: input.name,
      structure: json(input.structure),
      changed_at: tx.now,
      changed_by: actorKey(tx),
    })
    .execute();
  await tx.audit({
    action: 'rates.policy.create',
    target: { type: 'rate_policy', id },
    propertyId: input.propertyId,
    after: input,
  });
  return toPolicy(row, property.baseCurrency);
}

export async function updatePolicy(
  ports: RatesPorts,
  tx: TxContext,
  id: string,
  expectedVersion: number,
  patch: { name?: string | undefined; structure?: unknown },
): Promise<PolicyDto> {
  const before = await db(tx)
    .selectFrom('rates.policies')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst();
  if (!before) throw new NotFoundError('rate_policy', id);
  await guardConfigWrite(ports, tx, before.property_id, 'rates.policy.manage');
  const structure =
    patch.structure === undefined
      ? before.structure
      : parseInput(structureSchema[before.kind] as z.ZodType<unknown>, patch.structure);
  const row = await db(tx)
    .updateTable('rates.policies')
    .set({
      name: patch.name ?? before.name,
      structure: json(structure),
      version: sql`version + 1`,
      updated_at: tx.now,
    })
    .where('id', '=', id)
    .where('version', '=', expectedVersion)
    .returningAll()
    .executeTakeFirst();
  if (!row) return explainVersionMiss('rate_policy', id, expectedVersion, async () => before.version);
  await db(tx)
    .insertInto('rates.policy_versions')
    .values({
      id: newId(),
      tenant_id: tx.tenantId,
      policy_id: id,
      version: row.version,
      name: row.name,
      structure: json(structure),
      changed_at: tx.now,
      changed_by: actorKey(tx),
    })
    .execute();
  await tx.audit({
    action: 'rates.policy.update',
    target: { type: 'rate_policy', id },
    propertyId: row.property_id,
    before: { name: before.name, structure: before.structure, version: before.version },
    after: { name: row.name, structure, version: row.version },
  });
  const property = await ports.getProperty(tx, row.property_id);
  return toPolicy(row, property.baseCurrency);
}

export async function getPolicy(ports: RatesPorts, tx: TxContext, id: string): Promise<PolicyDto> {
  const row = await db(tx).selectFrom('rates.policies').selectAll().where('id', '=', id).executeTakeFirst();
  if (!row) throw new NotFoundError('rate_policy', id);
  requireRead(tx, row.property_id);
  const property = await ports.getProperty(tx, row.property_id);
  return toPolicy(row, property.baseCurrency);
}

export async function listPolicies(
  ports: RatesPorts,
  tx: TxContext,
  propertyId: string,
): Promise<PolicyDto[]> {
  requireRead(tx, propertyId);
  const property = await ports.getProperty(tx, propertyId);
  const rows = await db(tx)
    .selectFrom('rates.policies')
    .selectAll()
    .where('property_id', '=', propertyId)
    .orderBy('code')
    .execute();
  return rows.map((r) => toPolicy(r, property.baseCurrency));
}

export async function policyVersionHistory(tx: TxContext, policyId: string) {
  const policy = await db(tx)
    .selectFrom('rates.policies')
    .select('property_id')
    .where('id', '=', policyId)
    .executeTakeFirst();
  if (!policy) throw new NotFoundError('rate_policy', policyId);
  requireRead(tx, policy.property_id);
  return db(tx)
    .selectFrom('rates.policy_versions')
    .select(['version', 'name', 'structure', 'changed_at', 'changed_by'])
    .where('policy_id', '=', policyId)
    .orderBy('version')
    .execute();
}

// ───────────────────────────── Inclusions ─────────────────────────────

export function toInclusionSnapshot(r: Row<'rates.inclusions'>): InclusionSnapshot {
  return {
    id: r.id,
    version: r.version,
    code: r.code,
    name: r.name,
    kind: r.kind,
    chargeCode: r.charge_code,
    taxCategory: r.tax_category,
    pricing: parseStored(inclusionPricing, r.pricing, 'inclusion pricing'),
    basis: r.basis,
    rhythm: parseStored(inclusionRhythm, r.rhythm, 'inclusion rhythm'),
    priceMode: r.price_mode,
    fulfilmentOutlets: r.fulfilment_outlets,
    outletKind: r.outlet_kind,
    allowance: r.allowance ? parseStored(allowanceTerms, r.allowance, 'allowance terms') : null,
  };
}

function toInclusion(r: Row<'rates.inclusions'>) {
  return { ...toInclusionSnapshot(r), propertyId: r.property_id, status: r.status };
}

export async function createInclusion(ports: RatesPorts, tx: TxContext, raw: unknown) {
  const input: InclusionInput = parseInput(inclusionInput, raw);
  await guardConfigWrite(ports, tx, input.propertyId, 'rates.package.manage');
  const id = newId();
  const row = await withUniqueCode('inclusion', input.code, () =>
    db(tx)
      .insertInto('rates.inclusions')
      .values({
        id,
        tenant_id: tx.tenantId,
        property_id: input.propertyId,
        code: input.code,
        name: input.name,
        kind: input.kind,
        charge_code: input.chargeCode,
        tax_category: input.taxCategory,
        pricing: json(input.pricing),
        basis: input.basis,
        rhythm: json(input.rhythm),
        price_mode: input.priceMode,
        fulfilment_outlets: input.fulfilmentOutlets,
        outlet_kind: input.outletKind ?? null,
        allowance: input.allowance ? json(input.allowance) : null,
      })
      .returningAll()
      .executeTakeFirstOrThrow(),
  );
  await tx.audit({
    action: 'rates.inclusion.create',
    target: { type: 'inclusion', id },
    propertyId: input.propertyId,
    after: input,
  });
  return toInclusion(row);
}

export async function updateInclusion(
  ports: RatesPorts,
  tx: TxContext,
  id: string,
  expectedVersion: number,
  raw: unknown,
) {
  const before = await db(tx)
    .selectFrom('rates.inclusions')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst();
  if (!before) throw new NotFoundError('inclusion', id);
  await guardConfigWrite(ports, tx, before.property_id, 'rates.package.manage');
  const current = toInclusion(before);
  const patch = parseInput(
    z.object({
      name: z.string().min(1).max(200).optional(),
      pricing: inclusionPricing.optional(),
      rhythm: inclusionRhythm.optional(),
      basis: z.enum(['per_unit', 'per_person', 'per_adult', 'per_child', 'per_stay']).optional(),
      priceMode: z.enum(['included', 'added']).optional(),
      fulfilmentOutlets: z.array(z.string()).optional(),
      allowance: allowanceTerms.optional(),
      status: z.enum(['active', 'retired']).optional(),
    }),
    raw,
  );
  const merged = parseInput(inclusionInput, {
    propertyId: current.propertyId,
    code: current.code,
    name: patch.name ?? current.name,
    kind: current.kind,
    chargeCode: current.chargeCode,
    taxCategory: current.taxCategory,
    pricing: patch.pricing ?? current.pricing,
    basis: patch.basis ?? current.basis,
    rhythm: patch.rhythm ?? current.rhythm,
    priceMode: patch.priceMode ?? current.priceMode,
    fulfilmentOutlets: patch.fulfilmentOutlets ?? current.fulfilmentOutlets,
    ...(patch.allowance || current.allowance ? { allowance: patch.allowance ?? current.allowance } : {}),
  });
  const row = await db(tx)
    .updateTable('rates.inclusions')
    .set({
      name: merged.name,
      pricing: json(merged.pricing),
      basis: merged.basis,
      rhythm: json(merged.rhythm),
      price_mode: merged.priceMode,
      fulfilment_outlets: merged.fulfilmentOutlets,
      allowance: merged.allowance ? json(merged.allowance) : null,
      ...(patch.status ? { status: patch.status } : {}),
      version: sql`version + 1`,
      updated_at: tx.now,
    })
    .where('id', '=', id)
    .where('version', '=', expectedVersion)
    .returningAll()
    .executeTakeFirst();
  if (!row) return explainVersionMiss('inclusion', id, expectedVersion, async () => before.version);
  await tx.audit({
    action: 'rates.inclusion.update',
    target: { type: 'inclusion', id },
    propertyId: row.property_id,
    before: current,
    after: toInclusion(row),
  });
  return toInclusion(row);
}

export async function listInclusions(tx: TxContext, propertyId: string) {
  requireRead(tx, propertyId);
  const rows = await db(tx)
    .selectFrom('rates.inclusions')
    .selectAll()
    .where('property_id', '=', propertyId)
    .orderBy('code')
    .execute();
  return rows.map(toInclusion);
}

// ───────────────────────────── Packages ─────────────────────────────

function toPackage(r: Row<'rates.packages'>) {
  return {
    id: r.id,
    propertyId: r.property_id,
    code: r.code,
    name: r.name,
    description: r.description,
    mealPlanCode: r.meal_plan_code,
    inclusionIds: r.inclusion_ids,
    version: r.version,
  };
}

async function assertInclusionsAtProperty(
  tx: TxContext,
  propertyId: string,
  ids: readonly string[],
): Promise<void> {
  if (ids.length === 0) return;
  const found = await db(tx)
    .selectFrom('rates.inclusions')
    .select('id')
    .where('property_id', '=', propertyId)
    .where('id', 'in', [...ids])
    .where('status', '=', 'active')
    .execute();
  const missing = ids.filter((id) => !found.some((f) => f.id === id));
  if (missing.length > 0) {
    throw new ValidationError(
      'inclusion_not_found',
      'Some inclusions do not exist at this property or are retired.',
      { missing },
    );
  }
}

export async function createPackage(ports: RatesPorts, tx: TxContext, raw: unknown) {
  const input: PackageInput = parseInput(packageInput, raw);
  await guardConfigWrite(ports, tx, input.propertyId, 'rates.package.manage');
  await assertInclusionsAtProperty(tx, input.propertyId, input.inclusionIds);
  const id = newId();
  const row = await withUniqueCode('package', input.code, () =>
    db(tx)
      .insertInto('rates.packages')
      .values({
        id,
        tenant_id: tx.tenantId,
        property_id: input.propertyId,
        code: input.code,
        name: input.name,
        description: input.description ?? null,
        meal_plan_code: input.mealPlanCode ?? null,
        inclusion_ids: input.inclusionIds,
      })
      .returningAll()
      .executeTakeFirstOrThrow(),
  );
  await tx.audit({
    action: 'rates.package.create',
    target: { type: 'package', id },
    propertyId: input.propertyId,
    after: input,
  });
  return toPackage(row);
}

export async function updatePackage(
  ports: RatesPorts,
  tx: TxContext,
  id: string,
  expectedVersion: number,
  raw: unknown,
) {
  const patch = parseInput(packageUpdate, raw);
  const before = await db(tx)
    .selectFrom('rates.packages')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst();
  if (!before) throw new NotFoundError('package', id);
  await guardConfigWrite(ports, tx, before.property_id, 'rates.package.manage');
  if (patch.inclusionIds) await assertInclusionsAtProperty(tx, before.property_id, patch.inclusionIds);
  const row = await db(tx)
    .updateTable('rates.packages')
    .set({
      ...(patch.name ? { name: patch.name } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      ...(patch.inclusionIds ? { inclusion_ids: patch.inclusionIds } : {}),
      version: sql`version + 1`,
      updated_at: tx.now,
    })
    .where('id', '=', id)
    .where('version', '=', expectedVersion)
    .returningAll()
    .executeTakeFirst();
  if (!row) return explainVersionMiss('package', id, expectedVersion, async () => before.version);
  await tx.audit({
    action: 'rates.package.update',
    target: { type: 'package', id },
    propertyId: row.property_id,
    before: toPackage(before),
    after: toPackage(row),
  });
  return toPackage(row);
}

export async function listPackages(tx: TxContext, propertyId: string) {
  requireRead(tx, propertyId);
  const rows = await db(tx)
    .selectFrom('rates.packages')
    .selectAll()
    .where('property_id', '=', propertyId)
    .orderBy('code')
    .execute();
  return rows.map(toPackage);
}

export async function assertPackagesAtProperty(
  tx: TxContext,
  propertyId: string,
  ids: readonly string[],
): Promise<void> {
  if (ids.length === 0) return;
  const found = await db(tx)
    .selectFrom('rates.packages')
    .select('id')
    .where('property_id', '=', propertyId)
    .where('id', 'in', [...ids])
    .execute();
  const missing = ids.filter((id) => !found.some((f) => f.id === id));
  if (missing.length > 0)
    throw new ValidationError('package_not_found', 'Some packages do not exist at this property.', {
      missing,
    });
}

/** Inclusion snapshots for a set of packages (deduplicated, package order kept). */
export async function inclusionsForPackages(
  tx: TxContext,
  packageIds: readonly string[],
): Promise<InclusionSnapshot[]> {
  if (packageIds.length === 0) return [];
  const packages = await db(tx)
    .selectFrom('rates.packages')
    .selectAll()
    .where('id', 'in', [...packageIds])
    .where('status', '=', 'active')
    .execute();
  const ordered = packageIds
    .map((id) => packages.find((p) => p.id === id))
    .filter((p): p is Row<'rates.packages'> => !!p);
  const ids = [...new Set(ordered.flatMap((p) => p.inclusion_ids))];
  if (ids.length === 0) return [];
  const rows = await db(tx)
    .selectFrom('rates.inclusions')
    .selectAll()
    .where('id', 'in', ids)
    .where('status', '=', 'active')
    .execute();
  return ids
    .map((id) => rows.find((r) => r.id === id))
    .filter((r): r is Row<'rates.inclusions'> => !!r)
    .map(toInclusionSnapshot);
}

// ───────────────────────────── Promotions ─────────────────────────────

function toPromotion(r: Row<'rates.promotions'>) {
  return {
    id: r.id,
    propertyId: r.property_id,
    code: r.code,
    name: r.name,
    discount: r.discount,
    conditions: r.conditions,
    combinability: r.combinability,
    stackableWith: r.stackable_with,
    sequence: r.sequence,
    status: r.status,
    version: r.version,
  };
}

export function toPromotionCandidate(r: Row<'rates.promotions'>): PromotionCandidate {
  return {
    id: r.id,
    version: r.version,
    code: r.code,
    name: r.name,
    discount: parseStored(promotionDiscount, r.discount, 'promotion discount'),
    conditions: parseStored(promotionConditions, r.conditions, 'promotion conditions'),
    combinability: r.combinability,
    stackableWith: r.stackable_with,
    sequence: r.sequence,
  };
}

async function withPromoCodeUnique<T>(code: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if ((err as { code?: string; constraint?: string }).constraint === 'promotions_code_idx') {
      throw new ValidationError(
        'promo_code_taken',
        'Another active promotion at this property already uses this promo code.',
        { code },
      );
    }
    throw err;
  }
}

export async function createPromotion(ports: RatesPorts, tx: TxContext, raw: unknown) {
  const input: PromotionInput = parseInput(promotionInput, raw);
  await guardConfigWrite(ports, tx, input.propertyId, 'rates.promotion.manage');
  const id = newId();
  const row = await withPromoCodeUnique(input.conditions.promoCode ?? '', () =>
    withUniqueCode('promotion', input.code, () =>
      db(tx)
        .insertInto('rates.promotions')
        .values({
          id,
          tenant_id: tx.tenantId,
          property_id: input.propertyId,
          code: input.code,
          name: input.name,
          discount: json(input.discount),
          conditions: json(input.conditions),
          combinability: input.combinability,
          stackable_with: input.stackableWith,
          sequence: input.sequence,
        })
        .returningAll()
        .executeTakeFirstOrThrow(),
    ),
  );
  await tx.audit({
    action: 'rates.promotion.create',
    target: { type: 'promotion', id },
    propertyId: input.propertyId,
    after: input,
  });
  return toPromotion(row);
}

export async function updatePromotion(
  ports: RatesPorts,
  tx: TxContext,
  id: string,
  expectedVersion: number,
  raw: unknown,
) {
  const patch = parseInput(promotionUpdate, raw);
  const before = await db(tx)
    .selectFrom('rates.promotions')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst();
  if (!before) throw new NotFoundError('promotion', id);
  await guardConfigWrite(ports, tx, before.property_id, 'rates.promotion.manage');
  const row = await withPromoCodeUnique(patch.conditions?.promoCode ?? '', () =>
    db(tx)
      .updateTable('rates.promotions')
      .set({
        ...(patch.name ? { name: patch.name } : {}),
        ...(patch.discount ? { discount: json(patch.discount) } : {}),
        ...(patch.conditions ? { conditions: json(patch.conditions) } : {}),
        ...(patch.combinability ? { combinability: patch.combinability } : {}),
        ...(patch.stackableWith ? { stackable_with: patch.stackableWith } : {}),
        ...(patch.sequence !== undefined ? { sequence: patch.sequence } : {}),
        ...(patch.status ? { status: patch.status } : {}),
        version: sql`version + 1`,
        updated_at: tx.now,
      })
      .where('id', '=', id)
      .where('version', '=', expectedVersion)
      .returningAll()
      .executeTakeFirst(),
  );
  if (!row) return explainVersionMiss('promotion', id, expectedVersion, async () => before.version);
  await tx.audit({
    action: 'rates.promotion.update',
    target: { type: 'promotion', id },
    propertyId: row.property_id,
    before: toPromotion(before),
    after: toPromotion(row),
  });
  return toPromotion(row);
}

export async function listPromotions(tx: TxContext, propertyId: string) {
  requireRead(tx, propertyId);
  const rows = await db(tx)
    .selectFrom('rates.promotions')
    .selectAll()
    .where('property_id', '=', propertyId)
    .orderBy('code')
    .execute();
  return rows.map(toPromotion);
}
