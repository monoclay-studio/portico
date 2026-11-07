import { explainVersionMiss, type Selectable, sql, type TxContext } from '@portico/db';
import { ConflictError, NotFoundError, newId, requirePermission, ValidationError } from '@portico/kernel';
import type { z } from 'zod';
import type {
  Account,
  accountInput,
  ChargeCode,
  ChargeCodeInput,
  chargeCodeUpdate,
  FxRate,
  fxRateInput,
} from '../contracts';
import type { ChargeGroup } from '../domain/types';
import type { AccountsTable, ChargeCodesTable } from '../tables';
import { actorKey, type Deps, db, ensureChart, isUniqueViolation } from './support';

// ───────────────────────────── Chart of accounts ─────────────────────────────

function toAccount(r: Selectable<AccountsTable>): Account {
  return {
    id: r.id,
    legalEntityId: r.legal_entity_id,
    code: r.code,
    name: r.name,
    type: r.type,
    systemKey: r.system_key,
    functionalCurrency: r.functional_currency,
    active: r.active,
  };
}

/** The chart of accounts of a legal entity (seeded with the hospitality template on first use). */
export async function listAccounts(tx: TxContext, deps: Deps, legalEntityId: string): Promise<Account[]> {
  requirePermission(tx, 'finance.ledger.read');
  const le = await deps.ports.platform.getLegalEntity(tx, legalEntityId);
  await ensureChart(tx, legalEntityId, le.baseCurrency);
  const rows = await db(tx)
    .selectFrom('finance.accounts')
    .selectAll()
    .where('legal_entity_id', '=', legalEntityId)
    .orderBy('code')
    .execute();
  return rows.map(toAccount);
}

export async function createAccount(
  tx: TxContext,
  deps: Deps,
  input: z.infer<typeof accountInput>,
): Promise<Account> {
  requirePermission(tx, 'finance.ledger.manage');
  const le = await deps.ports.platform.getLegalEntity(tx, input.legalEntityId);
  await ensureChart(tx, input.legalEntityId, le.baseCurrency);
  try {
    const row = await db(tx)
      .insertInto('finance.accounts')
      .values({
        id: newId(),
        tenant_id: tx.tenantId,
        legal_entity_id: input.legalEntityId,
        code: input.code,
        name: input.name,
        type: input.type,
        system_key: input.systemKey ?? null,
        functional_currency: le.baseCurrency,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    await tx.audit({ action: 'finance.account.create', target: { type: 'account', id: row.id }, after: input });
    return toAccount(row);
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new ConflictError(
        'account_exists',
        `An account with code ${input.code}${input.systemKey ? ` or key ${input.systemKey}` : ''} already exists for this legal entity.`,
      );
    }
    throw err;
  }
}

// ───────────────────────────── Charge codes ─────────────────────────────

export function toChargeCode(r: Selectable<ChargeCodesTable>): ChargeCode {
  return {
    id: r.id,
    propertyId: r.property_id,
    code: r.code,
    name: r.name,
    group: r.charge_group as ChargeGroup,
    revenueAccountId: r.revenue_account_id,
    taxGroup: r.tax_group,
    department: r.department,
    allowanceTags: r.allowance_tags,
    restricted: r.restricted,
    active: r.active,
    version: r.version,
  };
}

async function assertRevenueAccount(tx: TxContext, deps: Deps, propertyId: string, accountId: string): Promise<void> {
  const property = await deps.ports.platform.getProperty(tx, propertyId);
  const acct = await db(tx)
    .selectFrom('finance.accounts')
    .select(['legal_entity_id'])
    .where('id', '=', accountId)
    .executeTakeFirst();
  if (!acct || acct.legal_entity_id !== property.legalEntityId) {
    throw new ValidationError(
      'invalid_revenue_account',
      'The revenue account must belong to the legal entity that operates this property.',
    );
  }
}

export async function createChargeCode(tx: TxContext, deps: Deps, input: ChargeCodeInput): Promise<ChargeCode> {
  requirePermission(tx, 'finance.chargeCode.manage', { propertyId: input.propertyId });
  if (input.revenueAccountId) await assertRevenueAccount(tx, deps, input.propertyId, input.revenueAccountId);
  try {
    const row = await db(tx)
      .insertInto('finance.charge_codes')
      .values({
        id: newId(),
        tenant_id: tx.tenantId,
        property_id: input.propertyId,
        code: input.code,
        name: input.name,
        charge_group: input.group,
        revenue_account_id: input.revenueAccountId ?? null,
        tax_group: input.taxGroup ?? null,
        department: input.department ?? null,
        allowance_tags: input.allowanceTags ?? [],
        restricted: input.restricted ?? false,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    await tx.audit({
      action: 'finance.chargeCode.create',
      target: { type: 'charge_code', id: row.id },
      propertyId: input.propertyId,
      after: input,
    });
    return toChargeCode(row);
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new ConflictError('charge_code_exists', `Charge code ${input.code} already exists at this property.`);
    }
    throw err;
  }
}

export async function updateChargeCode(
  tx: TxContext,
  deps: Deps,
  id: string,
  expectedVersion: number,
  patch: z.infer<typeof chargeCodeUpdate>,
): Promise<ChargeCode> {
  const current = await db(tx).selectFrom('finance.charge_codes').selectAll().where('id', '=', id).executeTakeFirst();
  if (!current) throw new NotFoundError('charge_code', id);
  requirePermission(tx, 'finance.chargeCode.manage', { propertyId: current.property_id });
  if (patch.revenueAccountId) await assertRevenueAccount(tx, deps, current.property_id, patch.revenueAccountId);
  const row = await db(tx)
    .updateTable('finance.charge_codes')
    .set({
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.revenueAccountId !== undefined ? { revenue_account_id: patch.revenueAccountId } : {}),
      ...(patch.taxGroup !== undefined ? { tax_group: patch.taxGroup } : {}),
      ...(patch.department !== undefined ? { department: patch.department } : {}),
      ...(patch.allowanceTags !== undefined ? { allowance_tags: patch.allowanceTags } : {}),
      ...(patch.restricted !== undefined ? { restricted: patch.restricted } : {}),
      ...(patch.active !== undefined ? { active: patch.active } : {}),
      version: sql`version + 1`,
    })
    .where('id', '=', id)
    .where('version', '=', expectedVersion)
    .returningAll()
    .executeTakeFirst();
  if (!row) return explainVersionMiss('charge_code', id, expectedVersion, async () => current.version);
  await tx.audit({
    action: 'finance.chargeCode.update',
    target: { type: 'charge_code', id },
    propertyId: current.property_id,
    before: toChargeCode(current),
    after: toChargeCode(row),
  });
  return toChargeCode(row);
}

export async function listChargeCodes(tx: TxContext, propertyId: string): Promise<ChargeCode[]> {
  requirePermission(tx, 'finance.folio.read', { propertyId });
  const rows = await db(tx)
    .selectFrom('finance.charge_codes')
    .selectAll()
    .where('property_id', '=', propertyId)
    .orderBy('code')
    .execute();
  return rows.map(toChargeCode);
}

export async function chargeCodeByCode(
  tx: TxContext,
  propertyId: string,
  code: string,
): Promise<Selectable<ChargeCodesTable>> {
  const row = await db(tx)
    .selectFrom('finance.charge_codes')
    .selectAll()
    .where('property_id', '=', propertyId)
    .where('code', '=', code)
    .executeTakeFirst();
  if (!row) {
    throw new ValidationError(
      'unknown_charge_code',
      `Charge code "${code}" is not set up at this property. Choose an existing charge code or ask finance to add it.`,
      { chargeCode: code },
    );
  }
  return row;
}

/** Map of code → group for a property (billing-rule overlap analysis). */
export async function chargeGroupMap(tx: TxContext, propertyId: string): Promise<Map<string, ChargeGroup>> {
  const rows = await db(tx)
    .selectFrom('finance.charge_codes')
    .select(['code', 'charge_group'])
    .where('property_id', '=', propertyId)
    .execute();
  return new Map(rows.map((r) => [r.code, r.charge_group as ChargeGroup]));
}

/** Default charge codes for a property (demo and onboarding). Tax groups are rate-pack keys, not rates. */
export const DEFAULT_CHARGE_CODES: ReadonlyArray<Omit<ChargeCodeInput, 'propertyId'>> = [
  { code: 'ROOM', name: 'Accommodation', group: 'room', taxGroup: 'accommodation', department: 'rooms' },
  { code: 'PKG', name: 'Package', group: 'package', taxGroup: 'accommodation', department: 'rooms' },
  { code: 'BRKF', name: 'Breakfast', group: 'food', taxGroup: 'food_beverage', department: 'fnb' },
  { code: 'FOOD', name: 'Restaurant — food', group: 'food', taxGroup: 'food_beverage', department: 'fnb', allowanceTags: ['dining'] },
  { code: 'BEV', name: 'Bar — beverages', group: 'beverage', taxGroup: 'food_beverage', department: 'fnb', allowanceTags: ['dining'] },
  { code: 'MINIBAR', name: 'Minibar', group: 'minibar', taxGroup: 'food_beverage', department: 'rooms' },
  { code: 'SPA', name: 'Spa treatment', group: 'spa', taxGroup: 'services', department: 'spa' },
  { code: 'DIVE', name: 'Diving and excursions', group: 'activity', taxGroup: 'services', department: 'recreation' },
  { code: 'TRANSFER', name: 'Seaplane / speedboat transfer', group: 'transfer', taxGroup: 'transport', department: 'transport' },
  { code: 'RETAIL', name: 'Boutique', group: 'retail', taxGroup: 'goods', department: 'retail' },
  { code: 'CXL', name: 'Cancellation / no-show fee', group: 'penalty', taxGroup: null, department: 'rooms' },
  { code: 'MISC', name: 'Miscellaneous', group: 'misc', taxGroup: 'services', department: 'other' },
  { code: 'ALLOW', name: 'Package allowance (dining credit)', group: 'allowance', taxGroup: null, department: 'fnb' },
];

/** Seed default charge codes (idempotent: existing codes are left untouched). */
export async function seedDefaultChargeCodes(tx: TxContext, propertyId: string): Promise<void> {
  requirePermission(tx, 'finance.chargeCode.manage', { propertyId });
  for (const c of DEFAULT_CHARGE_CODES) {
    await db(tx)
      .insertInto('finance.charge_codes')
      .values({
        id: newId(),
        tenant_id: tx.tenantId,
        property_id: propertyId,
        code: c.code,
        name: c.name,
        charge_group: c.group,
        revenue_account_id: null,
        tax_group: c.taxGroup ?? null,
        department: c.department ?? null,
        allowance_tags: c.allowanceTags ?? [],
        restricted: c.restricted ?? false,
      })
      .onConflict((oc) => oc.columns(['tenant_id', 'property_id', 'code']).doNothing())
      .execute();
  }
}

// ───────────────────────────── FX rates ─────────────────────────────

export async function recordFxRate(tx: TxContext, deps: Deps, input: z.infer<typeof fxRateInput>): Promise<FxRate> {
  requirePermission(tx, 'finance.fx.manage');
  if (input.fromCurrency === input.toCurrency) {
    throw new ValidationError('invalid_fx_pair', 'An exchange rate needs two different currencies.');
  }
  await deps.ports.platform.getLegalEntity(tx, input.legalEntityId);
  const id = newId();
  try {
    await db(tx)
      .insertInto('finance.fx_rates')
      .values({
        id,
        tenant_id: tx.tenantId,
        legal_entity_id: input.legalEntityId,
        business_date: input.businessDate,
        from_currency: input.fromCurrency,
        to_currency: input.toCurrency,
        rate: input.rate,
        source: input.source,
        entered_by: actorKey(tx),
      })
      .execute();
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new ConflictError(
        'fx_rate_exists',
        `A ${input.fromCurrency}→${input.toCurrency} rate for ${input.businessDate} is already recorded and may have been used for postings, so it cannot be replaced. Record the corrected rate for the next business date.`,
      );
    }
    throw err;
  }
  await tx.audit({ action: 'finance.fxRate.record', target: { type: 'fx_rate', id }, after: input });
  return { id, ...input };
}

export async function listFxRates(tx: TxContext, legalEntityId: string, from?: string): Promise<FxRate[]> {
  requirePermission(tx, 'finance.ledger.read');
  let q = db(tx)
    .selectFrom('finance.fx_rates')
    .selectAll()
    .where('legal_entity_id', '=', legalEntityId)
    .orderBy('business_date', 'desc')
    .limit(500);
  if (from) q = q.where('business_date', '>=', from);
  const rows = await q.execute();
  return rows.map((r) => ({
    id: r.id,
    legalEntityId: r.legal_entity_id,
    businessDate: r.business_date,
    fromCurrency: r.from_currency,
    toCurrency: r.to_currency,
    rate: String(r.rate),
    source: r.source,
  }));
}
