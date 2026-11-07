import { explainVersionMiss, type Selectable, sql, type TxContext, typed } from '@portico/db';
import {
  actorId,
  addDays,
  assertCurrency,
  BusinessRuleError,
  ConflictError,
  DomainError,
  EntitlementError,
  isValidTimeZone,
  type LocalDate,
  NotFoundError,
  newId,
  requirePermission,
  ValidationError,
} from '@portico/kernel';
import type {
  DataAuthority,
  DataDomain,
  LegalEntity,
  Organization,
  Property,
  PropertyInput,
  ResolvedPolicy,
} from './contracts';
import { authorityCombinationProblem, DATA_DOMAINS, SECOND_APPROVER_DOMAINS } from './domain/data-authority';
import { featuresOfGrant, planByCode } from './domain/plans';
import type { LegalEntitiesTable, PlatformDB, PropertiesTable } from './tables';

const db = (tx: TxContext) => typed<PlatformDB>(tx.db);

/** Stable actor reference stored on records and compared for separation of duties. */
export function actorKey(tx: Pick<TxContext, 'actor'>): string {
  return `${tx.actor.kind}:${actorId(tx.actor)}`;
}

/** Organization-level policy value (scope_type organization, scope_id = tenant id), or the default. */
export async function organizationPolicy<T>(tx: TxContext, key: string, defaultValue: T): Promise<T> {
  const row = await db(tx)
    .selectFrom('platform.policies')
    .select('value')
    .where('key', '=', key)
    .where('scope_type', '=', 'organization')
    .where('scope_id', '=', tx.tenantId)
    .executeTakeFirst();
  return row ? (row.value as T) : defaultValue;
}

// ───────────────────────────── Organizations ─────────────────────────────

export interface ProvisionOrganizationInput {
  id?: string;
  name: string;
  slug: string;
  environment: Organization['environment'];
  planCode: string;
  liveTenantId?: string;
}

/**
 * Create an organization. Callers must run this in a TxContext whose tenantId equals the new organization id
 * (RLS requires it) — use `provisioningContext()` in the composition root / tests.
 */
export async function provisionOrganization(
  tx: TxContext,
  input: ProvisionOrganizationInput,
): Promise<Organization> {
  if (!planByCode(input.planCode))
    throw new ValidationError('unknown_plan', `Plan "${input.planCode}" does not exist.`);
  if (!/^[a-z0-9-]{3,60}$/.test(input.slug)) {
    throw new ValidationError(
      'invalid_slug',
      'Organization short name must be 3–60 lowercase letters, digits or dashes.',
    );
  }
  const id = input.id ?? tx.tenantId;
  if (id !== tx.tenantId)
    throw new ValidationError('tenant_mismatch', 'Provisioning context must match the new organization id.');
  try {
    await db(tx)
      .insertInto('platform.tenants')
      .values({
        id,
        name: input.name,
        slug: input.slug,
        environment: input.environment,
        live_tenant_id: input.liveTenantId ?? null,
        status: 'active',
        plan_code: input.planCode,
      })
      .execute();
  } catch (err) {
    if ((err as { code?: string }).code === '23505') {
      throw new ConflictError(
        'slug_taken',
        `The short name "${input.slug}" is already used. Choose another.`,
      );
    }
    throw err;
  }
  await tx.audit({
    action: 'platform.organization.provision',
    target: { type: 'organization', id },
    after: input,
  });
  await tx.emit({
    type: 'platform.organization.provisioned',
    aggregate: { type: 'organization', id },
    payload: { ...input, id },
  });
  return getOrganization(tx);
}

export async function getOrganization(tx: TxContext): Promise<Organization> {
  const row = await db(tx)
    .selectFrom('platform.tenants')
    .selectAll()
    .where('id', '=', tx.tenantId)
    .executeTakeFirst();
  if (!row) throw new NotFoundError('organization', tx.tenantId);
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    environment: row.environment,
    status: row.status,
    planCode: row.plan_code,
    defaultLocale: row.default_locale,
  };
}

// ───────────────────────────── Entitlements ─────────────────────────────

/**
 * Whether the organization may use a feature: contract override, else plan, else an active add-on or Connect pack
 * grant — organization-wide, or for `opts.propertyId` when the grant is property-scoped (PLT-R22).
 */
export async function hasEntitlement(
  tx: TxContext,
  feature: string,
  opts: { propertyId?: string } = {},
): Promise<boolean> {
  const org = await getOrganization(tx);
  const override = await db(tx)
    .selectFrom('platform.entitlement_overrides')
    .select(['enabled'])
    .where('feature', '=', feature)
    .executeTakeFirst();
  if (override?.enabled !== null && override?.enabled !== undefined) return override.enabled;
  if (planByCode(org.planCode)?.features.includes(feature)) return true;
  let q = db(tx)
    .selectFrom('platform.entitlement_grants')
    .select(['kind', 'key'])
    .where('revoked_at', 'is', null);
  q = opts.propertyId
    ? q.where((eb) =>
        eb.or([eb('property_id', 'is', null), eb('property_id', '=', opts.propertyId as string)]),
      )
    : q.where('property_id', 'is', null);
  const grants = await q.execute();
  return grants.some((g) => featuresOfGrant(g.kind, g.key).includes(feature));
}

export async function requireEntitlement(
  tx: TxContext,
  feature: string,
  opts: { propertyId?: string } = {},
): Promise<void> {
  if (!(await hasEntitlement(tx, feature, opts))) throw new EntitlementError(feature);
}

export async function getLimit(tx: TxContext, limitKey: string): Promise<number | null> {
  const org = await getOrganization(tx);
  const override = await db(tx)
    .selectFrom('platform.entitlement_overrides')
    .select(['limit_value'])
    .where('feature', '=', limitKey)
    .executeTakeFirst();
  if (override && override.limit_value !== null) return override.limit_value;
  const plan = planByCode(org.planCode);
  return plan?.limits[limitKey] ?? null;
}

// ───────────────────────────── Legal entities ─────────────────────────────

function toLegalEntity(r: Selectable<LegalEntitiesTable>): LegalEntity {
  return {
    id: r.id,
    name: r.name,
    legalName: r.legal_name,
    ...(r.registration_number ? { registrationNumber: r.registration_number } : {}),
    ...(r.tax_id ? { taxId: r.tax_id } : {}),
    countryCode: r.country_code,
    baseCurrency: r.base_currency,
    address: (r.address ?? {}) as Record<string, string>,
    version: r.version,
  };
}

export async function createLegalEntity(
  tx: TxContext,
  input: Omit<LegalEntity, 'id' | 'version'>,
): Promise<LegalEntity> {
  requirePermission(tx, 'platform.legalEntity.manage');
  assertCurrency(input.baseCurrency);
  const id = newId();
  const row = await db(tx)
    .insertInto('platform.legal_entities')
    .values({
      id,
      tenant_id: tx.tenantId,
      name: input.name,
      legal_name: input.legalName,
      registration_number: input.registrationNumber ?? null,
      tax_id: input.taxId ?? null,
      country_code: input.countryCode,
      base_currency: input.baseCurrency,
      address: JSON.stringify(input.address ?? {}),
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  await tx.audit({
    action: 'platform.legalEntity.create',
    target: { type: 'legal_entity', id },
    after: input,
  });
  return toLegalEntity(row);
}

export async function getLegalEntity(tx: TxContext, id: string): Promise<LegalEntity> {
  const row = await db(tx)
    .selectFrom('platform.legal_entities')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst();
  if (!row) throw new NotFoundError('legal_entity', id);
  return toLegalEntity(row);
}

export async function listLegalEntities(tx: TxContext): Promise<LegalEntity[]> {
  const rows = await db(tx).selectFrom('platform.legal_entities').selectAll().orderBy('name').execute();
  return rows.map((r) => toLegalEntity(r));
}

// ───────────────────────────── Properties ─────────────────────────────

function toProperty(r: Selectable<PropertiesTable>): Property {
  return {
    id: r.id,
    code: r.code,
    name: r.name,
    profile: r.profile,
    legalEntityId: r.legal_entity_id,
    ...(r.brand_id ? { brandId: r.brand_id } : {}),
    ...(r.region_id ? { regionId: r.region_id } : {}),
    countryCode: r.country_code,
    timezone: r.timezone,
    baseCurrency: r.base_currency,
    classification: (r.classification ?? {}) as Property['classification'],
    businessDate: r.business_date,
    status: r.status,
    checkInTime: r.check_in_time.slice(0, 5),
    checkOutTime: r.check_out_time.slice(0, 5),
    version: r.version,
  };
}

export async function createProperty(tx: TxContext, input: PropertyInput): Promise<Property> {
  requirePermission(tx, 'platform.property.create');
  if (!isValidTimeZone(input.timezone)) {
    throw new ValidationError(
      'invalid_timezone',
      `"${input.timezone}" is not a recognised time zone. Use an IANA name such as Indian/Maldives.`,
    );
  }
  const limit = await getLimit(tx, 'limits.properties');
  if (limit !== null) {
    const count = await db(tx)
      .selectFrom('platform.properties')
      .select(sql<number>`count(*)::int`.as('n'))
      .executeTakeFirstOrThrow();
    if (count.n >= limit) {
      throw new BusinessRuleError(
        'plan_limit_reached',
        `Your plan allows ${limit} propert${limit === 1 ? 'y' : 'ies'}. Upgrade the plan to add more.`,
        {
          limit: 'limits.properties',
          value: limit,
        },
      );
    }
  }
  await getLegalEntity(tx, input.legalEntityId);
  const id = newId();
  try {
    const row = await db(tx)
      .insertInto('platform.properties')
      .values({
        id,
        tenant_id: tx.tenantId,
        code: input.code,
        name: input.name,
        profile: input.profile,
        legal_entity_id: input.legalEntityId,
        brand_id: input.brandId ?? null,
        region_id: input.regionId ?? null,
        country_code: input.countryCode,
        timezone: input.timezone,
        base_currency: input.baseCurrency,
        classification: JSON.stringify(input.classification ?? {}),
        business_date: input.businessDate,
        check_in_time: input.checkInTime ?? '14:00',
        check_out_time: input.checkOutTime ?? '12:00',
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    await tx.audit({
      action: 'platform.property.create',
      target: { type: 'property', id },
      propertyId: id,
      after: input,
    });
    await tx.emit({
      type: 'platform.property.created',
      propertyId: id,
      aggregate: { type: 'property', id },
      payload: { propertyId: id, profile: input.profile },
    });
    return toProperty(row);
  } catch (err) {
    if ((err as { code?: string }).code === '23505')
      throw new ConflictError('property_code_taken', `Property code ${input.code} is already in use.`);
    throw err;
  }
}

export async function getProperty(tx: TxContext, id: string): Promise<Property> {
  requirePermission(tx, 'platform.property.read', { propertyId: id });
  const row = await db(tx)
    .selectFrom('platform.properties')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst();
  if (!row) throw new NotFoundError('property', id);
  return toProperty(row);
}

/** Facts other modules need about a property for their own calculations (no permission check). */
export interface PropertyFacts {
  id: string;
  code: string;
  name: string;
  profile: Property['profile'];
  status: Property['status'];
  legalEntityId: string;
  countryCode: string;
  timezone: string;
  baseCurrency: string;
  classification: Property['classification'];
  businessDate: LocalDate;
  brandId: string | null;
  regionId: string | null;
}

/**
 * Property facts for MODULE-INTERNAL use (tax, rates, guests, scheduling): time zone, base currency, country,
 * classification, legal entity, profile, status and business date. No permission check — callers have already
 * authorized their own command — but still tenant-scoped by RLS. Never expose this directly over HTTP; user-facing
 * reads go through `getProperty` (which requires `platform.property.read` for the property).
 */
export async function getPropertyFacts(tx: TxContext, propertyId: string): Promise<PropertyFacts> {
  const r = await db(tx)
    .selectFrom('platform.properties')
    .select([
      'id',
      'code',
      'name',
      'profile',
      'status',
      'legal_entity_id',
      'country_code',
      'timezone',
      'base_currency',
      'classification',
      'business_date',
      'brand_id',
      'region_id',
    ])
    .where('id', '=', propertyId)
    .executeTakeFirst();
  if (!r) throw new NotFoundError('property', propertyId);
  return {
    id: r.id,
    code: r.code,
    name: r.name,
    profile: r.profile,
    status: r.status,
    legalEntityId: r.legal_entity_id,
    countryCode: r.country_code,
    timezone: r.timezone,
    baseCurrency: r.base_currency,
    classification: (r.classification ?? {}) as Property['classification'],
    businessDate: r.business_date,
    brandId: r.brand_id,
    regionId: r.region_id,
  };
}

/** Properties the actor may read. */
export async function listProperties(tx: TxContext): Promise<Property[]> {
  const scope = tx.authz.propertyScope('platform.property.read');
  if (scope !== 'all' && scope.length === 0) return [];
  let q = db(tx).selectFrom('platform.properties').selectAll().orderBy('name');
  if (scope !== 'all') q = q.where('id', 'in', scope as string[]);
  const rows = await q.execute();
  return rows.map((r) => toProperty(r));
}

export async function updateProperty(
  tx: TxContext,
  id: string,
  expectedVersion: number,
  patch: Partial<Omit<Property, 'id' | 'code' | 'businessDate' | 'legalEntityId' | 'version'>>,
): Promise<Property> {
  requirePermission(tx, 'platform.property.update', { propertyId: id });
  const before = await getProperty(tx, id);
  if (patch.status !== undefined && patch.status !== before.status) {
    throw new BusinessRuleError(
      'use_activation_workflow',
      `Property status cannot be edited directly (it is ${before.status}). Request the change on the activation page: entering pilot or production needs a second person's approval, stopping a pilot or deactivating is a separate recorded action.`,
      { currentStatus: before.status, requestedStatus: patch.status },
    );
  }
  if (patch.timezone && !isValidTimeZone(patch.timezone)) {
    throw new ValidationError('invalid_timezone', `"${patch.timezone}" is not a recognised time zone.`);
  }
  const row = await db(tx)
    .updateTable('platform.properties')
    .set({
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.profile !== undefined ? { profile: patch.profile } : {}),
      ...(patch.brandId !== undefined ? { brand_id: patch.brandId } : {}),
      ...(patch.regionId !== undefined ? { region_id: patch.regionId } : {}),
      ...(patch.timezone !== undefined ? { timezone: patch.timezone } : {}),
      ...(patch.baseCurrency !== undefined ? { base_currency: patch.baseCurrency } : {}),
      ...(patch.classification !== undefined ? { classification: JSON.stringify(patch.classification) } : {}),
      ...(patch.checkInTime !== undefined ? { check_in_time: patch.checkInTime } : {}),
      ...(patch.checkOutTime !== undefined ? { check_out_time: patch.checkOutTime } : {}),
      version: sql`version + 1`,
    })
    .where('id', '=', id)
    .where('version', '=', expectedVersion)
    .returningAll()
    .executeTakeFirst();
  if (!row) {
    return explainVersionMiss(
      'property',
      id,
      expectedVersion,
      async () => (await getProperty(tx, id)).version,
    );
  }
  const after = toProperty(row);
  await tx.audit({
    action: 'platform.property.update',
    target: { type: 'property', id },
    propertyId: id,
    before,
    after,
  });
  return after;
}

// ───────────────────────────── Business date ─────────────────────────────

export async function getBusinessDate(tx: TxContext, propertyId: string): Promise<LocalDate> {
  const row = await db(tx)
    .selectFrom('platform.properties')
    .select('business_date')
    .where('id', '=', propertyId)
    .executeTakeFirst();
  if (!row) throw new NotFoundError('property', propertyId);
  return row.business_date;
}

/**
 * Advance the business date by exactly one day. Optimistic: `expected` must equal the current business date,
 * so a retried or duplicated Day Close can never skip a day.
 */
export async function advanceBusinessDate(
  tx: TxContext,
  propertyId: string,
  expected: LocalDate,
  opts: { dayCloseRunId?: string } = {},
): Promise<LocalDate> {
  requirePermission(tx, 'platform.businessDate.advance', { propertyId });
  const next = addDays(expected, 1);
  const updated = await db(tx)
    .updateTable('platform.properties')
    .set({ business_date: next, version: sql`version + 1` })
    .where('id', '=', propertyId)
    .where('business_date', '=', expected)
    .returning('business_date')
    .executeTakeFirst();
  if (!updated) {
    const current = await getBusinessDate(tx, propertyId);
    throw new ConflictError(
      'business_date_mismatch',
      `The business date is ${current}, not ${expected}. It may already have been advanced by another Day Close. Refresh and review before retrying.`,
      { expected, current },
    );
  }
  await db(tx)
    .insertInto('platform.business_date_log')
    .values({
      id: newId(),
      tenant_id: tx.tenantId,
      property_id: propertyId,
      from_date: expected,
      to_date: next,
      advanced_at: tx.now,
      advanced_by: `${tx.actor.kind}`,
      day_close_run_id: opts.dayCloseRunId ?? null,
    })
    .execute();
  await tx.audit({
    action: 'platform.businessDate.advance',
    target: { type: 'property', id: propertyId },
    propertyId,
    before: { businessDate: expected },
    after: { businessDate: next },
  });
  await tx.emit({
    type: 'platform.property.businessDateAdvanced',
    propertyId,
    aggregate: { type: 'property', id: propertyId },
    payload: { propertyId, from: expected, to: next },
  });
  return next;
}

// ───────────────────────────── Policies (central + local overrides) ─────────────────────────────

type ScopeType = 'organization' | 'brand' | 'region' | 'property';

async function propertyScopeChain(
  tx: TxContext,
  propertyId: string,
): Promise<Array<{ type: ScopeType; id: string }>> {
  const p = await db(tx)
    .selectFrom('platform.properties')
    .select(['id', 'brand_id', 'region_id'])
    .where('id', '=', propertyId)
    .executeTakeFirst();
  if (!p) throw new NotFoundError('property', propertyId);
  const chain: Array<{ type: ScopeType; id: string }> = [{ type: 'property', id: p.id }];
  // Regions nest: walk up the parent chain (bounded).
  let regionId = p.region_id;
  for (let depth = 0; regionId && depth < 10; depth++) {
    chain.push({ type: 'region', id: regionId });
    const r = await db(tx)
      .selectFrom('platform.regions')
      .select('parent_region_id')
      .where('id', '=', regionId)
      .executeTakeFirst();
    regionId = r?.parent_region_id ?? null;
  }
  if (p.brand_id) chain.push({ type: 'brand', id: p.brand_id });
  chain.push({ type: 'organization', id: tx.tenantId });
  return chain;
}

/** Most specific value wins: property → region(s) → brand → organization → default. */
export async function resolvePolicy<T>(
  tx: TxContext,
  propertyId: string,
  key: string,
  defaultValue: T,
): Promise<ResolvedPolicy & { value: T }> {
  const chain = await propertyScopeChain(tx, propertyId);
  const rows = await db(tx)
    .selectFrom('platform.policies')
    .select(['scope_type', 'scope_id', 'value'])
    .where('key', '=', key)
    .where(
      'scope_id',
      'in',
      chain.map((c) => c.id),
    )
    .execute();
  for (const level of chain) {
    const hit = rows.find((r) => r.scope_type === level.type && r.scope_id === level.id);
    if (hit) {
      return {
        key,
        value: hit.value as T,
        source: level.type,
        isLocalOverride: level.type === 'property' && rows.some((r) => r.scope_type !== 'property'),
      };
    }
  }
  return { key, value: defaultValue, source: 'default', isLocalOverride: false };
}

export interface PolicyChangePreview {
  key: string;
  scope: { type: ScopeType; id: string };
  affected: Array<{
    propertyId: string;
    propertyName: string;
    currentValue: unknown;
    currentSource: string;
    newValue: unknown;
    changes: boolean;
  }>;
  /** Properties whose own (more specific) override keeps them on their current value. */
  unaffectedDueToOverride: Array<{
    propertyId: string;
    propertyName: string;
    overrideSource: string;
    value: unknown;
  }>;
}

/** Show exactly which properties a central policy change would affect before applying it (scenario 16). */
export async function previewPolicyChange(
  tx: TxContext,
  input: { key: string; scopeType: ScopeType; scopeId: string; value: unknown; defaultValue: unknown },
): Promise<PolicyChangePreview> {
  requirePermission(tx, 'platform.policy.manage');
  const properties = await db(tx)
    .selectFrom('platform.properties')
    .select(['id', 'name'])
    .orderBy('name')
    .execute();
  const preview: PolicyChangePreview = {
    key: input.key,
    scope: { type: input.scopeType, id: input.scopeId },
    affected: [],
    unaffectedDueToOverride: [],
  };
  const rank: Record<ScopeType, number> = { property: 0, region: 1, brand: 2, organization: 3 };
  for (const p of properties) {
    const chain = await propertyScopeChain(tx, p.id);
    const inScope = chain.some((c) => c.type === input.scopeType && c.id === input.scopeId);
    if (!inScope) continue;
    const current = await resolvePolicy(tx, p.id, input.key, input.defaultValue);
    const currentRank = current.source === 'default' ? 99 : rank[current.source];
    if (currentRank < rank[input.scopeType]) {
      preview.unaffectedDueToOverride.push({
        propertyId: p.id,
        propertyName: p.name,
        overrideSource: current.source,
        value: current.value,
      });
    } else {
      preview.affected.push({
        propertyId: p.id,
        propertyName: p.name,
        currentValue: current.value,
        currentSource: current.source,
        newValue: input.value,
        changes: JSON.stringify(current.value) !== JSON.stringify(input.value),
      });
    }
  }
  return preview;
}

export async function setPolicy(
  tx: TxContext,
  input: { key: string; scopeType: ScopeType; scopeId: string; value: unknown; reason: string },
): Promise<void> {
  if (input.scopeType === 'property')
    requirePermission(tx, 'platform.policy.override', { propertyId: input.scopeId });
  else requirePermission(tx, 'platform.policy.manage');
  const existing = await db(tx)
    .selectFrom('platform.policies')
    .select(['value'])
    .where('key', '=', input.key)
    .where('scope_type', '=', input.scopeType)
    .where('scope_id', '=', input.scopeId)
    .executeTakeFirst();
  await db(tx)
    .insertInto('platform.policies')
    .values({
      id: newId(),
      tenant_id: tx.tenantId,
      key: input.key,
      scope_type: input.scopeType,
      scope_id: input.scopeId,
      value: JSON.stringify(input.value),
      updated_by: tx.actor.kind,
    })
    .onConflict((oc) =>
      oc.columns(['tenant_id', 'key', 'scope_type', 'scope_id']).doUpdateSet({
        value: JSON.stringify(input.value),
        updated_at: tx.now,
        version: sql`platform.policies.version + 1`,
      }),
    )
    .execute();
  await tx.audit({
    action: 'platform.policy.set',
    target: { type: 'policy', id: `${input.key}@${input.scopeType}:${input.scopeId}` },
    ...(input.scopeType === 'property' ? { propertyId: input.scopeId } : {}),
    reason: input.reason,
    before: existing?.value ?? null,
    after: input.value,
  });
  await tx.emit({
    type: 'platform.policy.changed',
    aggregate: { type: 'policy', id: input.key },
    payload: { ...input },
  });
}

export async function createBrand(
  tx: TxContext,
  input: { code: string; name: string },
): Promise<{ id: string }> {
  requirePermission(tx, 'platform.organization.manage');
  const id = newId();
  await db(tx)
    .insertInto('platform.brands')
    .values({ id, tenant_id: tx.tenantId, ...input })
    .execute();
  await tx.audit({ action: 'platform.brand.create', target: { type: 'brand', id }, after: input });
  return { id };
}

export async function createRegion(
  tx: TxContext,
  input: { code: string; name: string; parentRegionId?: string },
): Promise<{ id: string }> {
  requirePermission(tx, 'platform.organization.manage');
  const id = newId();
  await db(tx)
    .insertInto('platform.regions')
    .values({
      id,
      tenant_id: tx.tenantId,
      code: input.code,
      name: input.name,
      parent_region_id: input.parentRegionId ?? null,
    })
    .execute();
  await tx.audit({ action: 'platform.region.create', target: { type: 'region', id }, after: input });
  return { id };
}

export async function createDepartment(
  tx: TxContext,
  input: { propertyId: string; code: string; name: string; kind: string },
): Promise<{ id: string }> {
  requirePermission(tx, 'platform.department.manage', { propertyId: input.propertyId });
  const id = newId();
  await db(tx)
    .insertInto('platform.departments')
    .values({
      id,
      tenant_id: tx.tenantId,
      property_id: input.propertyId,
      code: input.code,
      name: input.name,
      kind: input.kind,
    })
    .execute();
  await tx.audit({
    action: 'platform.department.create',
    target: { type: 'department', id },
    propertyId: input.propertyId,
    after: input,
  });
  return { id };
}

export async function listDepartments(tx: TxContext, propertyId: string) {
  requirePermission(tx, 'platform.property.read', { propertyId });
  return db(tx)
    .selectFrom('platform.departments')
    .select(['id', 'code', 'name', 'kind'])
    .where('property_id', '=', propertyId)
    .orderBy('name')
    .execute();
}

/** All property ids under a brand/region (used by identity to expand scoped role assignments). */
export async function propertyIdsInScope(
  tx: TxContext,
  scope: { type: 'brand' | 'region'; id: string },
): Promise<string[]> {
  if (scope.type === 'brand') {
    const rows = await db(tx)
      .selectFrom('platform.properties')
      .select('id')
      .where('brand_id', '=', scope.id)
      .execute();
    return rows.map((r) => r.id);
  }
  const { rows } = await sql<{ id: string }>`
    with recursive r as (
      select id from platform.regions where id = ${scope.id}
      union all select c.id from platform.regions c join r on c.parent_region_id = r.id
    )
    select p.id from platform.properties p where p.region_id in (select id from r)`.execute(tx.db);
  return rows.map((r) => r.id);
}

// ───────────────────────────── Data authority (system of record) ─────────────────────────────

export async function getDataAuthority(
  tx: TxContext,
  propertyId: string,
  domain: DataDomain,
): Promise<DataAuthority> {
  const row = await db(tx)
    .selectFrom('platform.data_authority')
    .selectAll()
    .where('property_id', '=', propertyId)
    .where('domain', '=', domain)
    .executeTakeFirst();
  if (!row)
    return {
      domain,
      authority: 'portico',
      connectionId: null,
      systemName: null,
      writeMode: 'exclusive',
      isDefault: true,
    };
  return {
    domain,
    authority: row.authority,
    connectionId: row.connection_id,
    systemName: row.system_name,
    writeMode: row.write_mode,
    isDefault: false,
  };
}

export async function listDataAuthority(tx: TxContext, propertyId: string): Promise<DataAuthority[]> {
  requirePermission(tx, 'platform.property.read', { propertyId });
  return Promise.all(DATA_DOMAINS.map((d) => getDataAuthority(tx, propertyId, d)));
}

/** Open (planned or frozen) authority transition for a property and domain, if any (G-02). */
export async function openTransitionFor(tx: TxContext, propertyId: string, domain: DataDomain) {
  return db(tx)
    .selectFrom('platform.data_authority_transition_domains as d')
    .innerJoin('platform.data_authority_transitions as t', 't.id', 'd.transition_id')
    .select(['t.id', 't.status', 't.expected_end_at', 't.planned_start_at'])
    .where('d.property_id', '=', propertyId)
    .where('d.domain', '=', domain)
    .where('d.open', '=', true)
    .executeTakeFirst();
}

export function transitionInProgressError(
  domain: string,
  t: { id: string; expected_end_at: Date | null },
): DomainError {
  const until = t.expected_end_at ? ` until about ${t.expected_end_at.toISOString()}` : '';
  return new DomainError(
    'authority_transition_in_progress',
    `The system of record for ${domain} is being moved at this property, so neither system may change it${until}. Record the change on the cutover freeze log and enter it after the switch, or try again later.`,
    {
      status: 409,
      retryable: true,
      details: { domain, transitionId: t.id, expectedEndAt: t.expected_end_at?.toISOString() ?? null },
    },
  );
}

/**
 * Guard for every write in an authority-governed domain. Returns 'portico' when Portico may write directly, or
 * 'forward' when the change must be sent to the external system of record (and only becomes effective when it
 * acknowledges). Throws an explanatory error when the domain is read-only here.
 */
export async function assertWritable(
  tx: TxContext,
  propertyId: string,
  domain: DataDomain,
): Promise<'portico' | 'forward'> {
  const open = await openTransitionFor(tx, propertyId, domain);
  if (open?.status === 'frozen') throw transitionInProgressError(domain, open);
  const a = await getDataAuthority(tx, propertyId, domain);
  if (a.authority === 'portico') return 'portico';
  if (a.writeMode === 'forward') return 'forward';
  throw new BusinessRuleError(
    'external_system_of_record',
    `${a.systemName ?? 'Another system'} is the system of record for ${domain} at this property, so this change must be made there. Portico shows this information but does not change it.`,
    { domain, systemName: a.systemName, connectionId: a.connectionId },
  );
}

/**
 * Write a new authority version: upsert the current row, close the previous history row and append the new one.
 * Shared by the direct change (`setDataAuthority`) and authority transitions. Caller checks permissions.
 */
export async function writeAuthorityVersion(
  tx: TxContext,
  input: {
    propertyId: string;
    domain: DataDomain;
    authority: 'portico' | 'external';
    connectionId?: string | undefined;
    systemName?: string | undefined;
    writeMode: 'exclusive' | 'forward' | 'read_only';
    reason: string;
    approvedBy?: string | null;
    transitionId?: string | null;
  },
): Promise<{ before: DataAuthority; after: DataAuthority; version: number }> {
  const problem = authorityCombinationProblem(input);
  if (problem) throw new ValidationError(problem.code, problem.message, { domain: input.domain });
  const before = await getDataAuthority(tx, input.propertyId, input.domain);
  const row = await db(tx)
    .insertInto('platform.data_authority')
    .values({
      id: newId(),
      tenant_id: tx.tenantId,
      property_id: input.propertyId,
      domain: input.domain,
      authority: input.authority,
      connection_id: input.connectionId ?? null,
      system_name: input.systemName ?? null,
      write_mode: input.writeMode,
      effective_from: tx.now,
      updated_by: actorKey(tx),
      reason: input.reason,
    })
    .onConflict((oc) =>
      oc.columns(['property_id', 'domain']).doUpdateSet({
        authority: input.authority,
        connection_id: input.connectionId ?? null,
        system_name: input.systemName ?? null,
        write_mode: input.writeMode,
        effective_from: tx.now,
        updated_by: actorKey(tx),
        reason: input.reason,
        version: sql`platform.data_authority.version + 1`,
      }),
    )
    .returning(['version'])
    .executeTakeFirstOrThrow();
  await db(tx)
    .updateTable('platform.data_authority_history')
    .set({ effective_to: tx.now })
    .where('property_id', '=', input.propertyId)
    .where('domain', '=', input.domain)
    .where('effective_to', 'is', null)
    .execute();
  await db(tx)
    .insertInto('platform.data_authority_history')
    .values({
      id: newId(),
      tenant_id: tx.tenantId,
      property_id: input.propertyId,
      domain: input.domain,
      version: row.version,
      authority: input.authority,
      connection_id: input.connectionId ?? null,
      system_name: input.systemName ?? null,
      write_mode: input.writeMode,
      effective_from: tx.now,
      effective_to: null,
      changed_by: actorKey(tx),
      approved_by: input.approvedBy ?? null,
      reason: input.reason,
      transition_id: input.transitionId ?? null,
    })
    .execute();
  const after = await getDataAuthority(tx, input.propertyId, input.domain);
  await tx.audit({
    action: 'platform.dataAuthority.set',
    target: { type: 'property', id: input.propertyId },
    propertyId: input.propertyId,
    reason: input.reason,
    before,
    after,
    metadata: { domain: input.domain, version: row.version, transitionId: input.transitionId ?? null },
  });
  await tx.emit({
    type: 'platform.dataAuthority.changed',
    propertyId: input.propertyId,
    aggregate: { type: 'property', id: input.propertyId },
    payload: { propertyId: input.propertyId, domain: input.domain, before, after, version: row.version },
  });
  return { before, after, version: row.version };
}

/**
 * Change the system of record for a domain directly. Sensitive: affects which system staff must use.
 * Rejected while an authority transition is open for the domain, and for `charges`, `payments`, `accounting`
 * and `availability` (which need a second person's approval — use an authority transition; CR-10) unless the
 * actor is a trusted system process (provisioning, import).
 */
export async function setDataAuthority(
  tx: TxContext,
  input: {
    propertyId: string;
    domain: DataDomain;
    authority: 'portico' | 'external';
    connectionId?: string;
    systemName?: string;
    writeMode: 'exclusive' | 'forward' | 'read_only';
    reason: string;
  },
): Promise<DataAuthority> {
  requirePermission(tx, 'platform.dataAuthority.manage', { propertyId: input.propertyId });
  const problem = authorityCombinationProblem(input);
  if (problem) throw new ValidationError(problem.code, problem.message, { domain: input.domain });
  const open = await openTransitionFor(tx, input.propertyId, input.domain);
  if (open) {
    throw new ConflictError(
      'authority_transition_open',
      `An authority transition for ${input.domain} is ${open.status} at this property. Complete or cancel it before changing the system of record another way.`,
      { transitionId: open.id, domain: input.domain },
    );
  }
  if (SECOND_APPROVER_DOMAINS.includes(input.domain) && tx.actor.kind !== 'system') {
    throw new BusinessRuleError(
      'second_approval_required',
      `Changing the system of record for ${input.domain} needs a second person's approval. Plan an authority transition (plan, approve, freeze, make effective) instead.`,
      { domain: input.domain },
    );
  }
  const { after } = await writeAuthorityVersion(tx, input);
  return after;
}

/** Version history of the system of record for a property (G-02, ST-13). */
export async function listDataAuthorityHistory(tx: TxContext, propertyId: string, domain?: DataDomain) {
  requirePermission(tx, 'platform.property.read', { propertyId });
  let q = db(tx)
    .selectFrom('platform.data_authority_history')
    .selectAll()
    .where('property_id', '=', propertyId)
    .orderBy('domain')
    .orderBy('version');
  if (domain) q = q.where('domain', '=', domain);
  const rows = await q.execute();
  return rows.map((r) => ({
    domain: r.domain as DataDomain,
    version: r.version,
    authority: r.authority,
    connectionId: r.connection_id,
    systemName: r.system_name,
    writeMode: r.write_mode,
    effectiveFrom: r.effective_from.toISOString(),
    effectiveTo: r.effective_to?.toISOString() ?? null,
    changedBy: r.changed_by,
    approvedBy: r.approved_by,
    reason: r.reason,
    transitionId: r.transition_id,
  }));
}
