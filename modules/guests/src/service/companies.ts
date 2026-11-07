/**
 * Companies and travel agents (GUE-R07/R08). An agency is a company with kind=agency. Booker, occupant and payer
 * are ROLES on bookings/stays (stay history role, company contact role) — never profile types.
 */
import { explainVersionMiss, type Selectable, sql, type TxContext } from '@portico/db';
import {
  BusinessRuleError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  newId,
  requirePermission,
  ValidationError,
} from '@portico/kernel';
import type { CompanyInput, CompanyUpdate, CompanyView } from '../contracts';
import {
  type CommissionTerms,
  type CompanyStatus,
  canTransitionCompany,
  validateCommission,
  validateIataCode,
} from '../domain/company';
import { normalizeLatin } from '../domain/names';
import type { GuestsPorts } from '../ports';
import type { CompaniesTable } from '../tables';
import { db, forwardingUnavailable, lockProfileForWrite, pgCode, requireVisibleProfile } from './internal';
import { companyRecord } from './record';

function requireCompanyRead(tx: TxContext): void {
  // Company basics are operational: anyone who may read profiles may read the companies they book for.
  if (!tx.authz.can('guests.company.read') && !tx.authz.can('guests.profile.read')) {
    throw new ForbiddenError('guests.company.read');
  }
}

function requireCompanyManage(tx: TxContext, propertyId?: string | null): void {
  requirePermission(tx, 'guests.company.manage', propertyId ? { propertyId } : undefined);
}

async function toView(tx: TxContext, r: Selectable<CompaniesTable>): Promise<CompanyView> {
  const contacts = await db(tx)
    .selectFrom('guests.company_contacts as cc')
    .innerJoin('guests.profiles as p', 'p.id', 'cc.profile_id')
    .select(['cc.id', 'cc.profile_id', 'cc.role'])
    .where('cc.company_id', '=', r.id)
    .where('p.status', '=', 'active')
    .orderBy('cc.created_at')
    .execute();
  const record = await companyRecord(tx, {
    ...r,
    contacts: contacts.map((c) => ({ profileId: c.profile_id, role: c.role })),
  });
  return {
    id: r.id,
    status: { company: r.status },
    ...record,
    kind: r.kind,
    legalName: r.legal_name,
    tradingName: r.trading_name,
    taxId: r.tax_id,
    iataCode: r.iata_code,
    parentCompanyId: r.parent_company_id,
    defaultMarketSegment: r.default_market_segment,
    commission: r.commission as CommissionTerms,
    arAccountRef: r.ar_account_ref,
    billingAddress: (r.billing_address ?? {}) as Record<string, string>,
    billingEmail: r.billing_email,
    notes: r.notes,
    provenance: r.provenance,
    contacts: contacts.map((c) => ({ id: c.id, profileId: c.profile_id, role: c.role })),
    version: r.version,
  };
}

function validateCompany(input: {
  kind?: 'company' | 'agency';
  iataCode?: string | null;
  commission?: CommissionTerms | undefined;
}): void {
  if (input.iataCode) {
    const v = validateIataCode(input.iataCode);
    if (!v.ok)
      throw new ValidationError('invalid_iata_code', v.reason ?? 'Invalid IATA code.', { field: 'iataCode' });
    if (input.kind === 'company') {
      throw new ValidationError(
        'iata_for_agency_only',
        'Only travel agents (kind agency) carry an IATA code.',
      );
    }
  }
  if (input.commission) {
    const problem = validateCommission(input.commission);
    if (problem) throw new ValidationError('invalid_commission', problem, { field: 'commission' });
  }
}

async function assertParent(
  tx: TxContext,
  companyId: string,
  parentId: string | null | undefined,
): Promise<void> {
  if (!parentId) return;
  const parent = await db(tx)
    .selectFrom('guests.companies')
    .select('id')
    .where('id', '=', parentId)
    .executeTakeFirst();
  if (!parent) throw new NotFoundError('company', parentId);
  // Walk up from the proposed parent (bounded); reaching the company itself would create a cycle.
  const { rows } = await sql<{ id: string }>`
    with recursive up(id, parent_company_id, depth) as (
      select id, parent_company_id, 0 from guests.companies where id = ${parentId}
      union all
      select c.id, c.parent_company_id, up.depth + 1
      from guests.companies c join up on c.id = up.parent_company_id
      where up.depth < 50
    ) select id from up`.execute(tx.db);
  if (rows.some((r) => r.id === companyId)) {
    throw new ValidationError(
      'company_hierarchy_cycle',
      'That parent would make the company its own ancestor. Choose a different parent company.',
    );
  }
}

function uniqueViolation(err: unknown): never {
  if (pgCode(err) === '23505') {
    throw new ConflictError(
      'company_exists',
      'A company with this tax id or IATA code already exists. Open the existing company instead of creating a new one.',
    );
  }
  throw err;
}

export async function createCompany(
  tx: TxContext,
  ports: GuestsPorts,
  input: CompanyInput,
): Promise<CompanyView> {
  requireCompanyManage(tx, input.propertyId);
  validateCompany(input);
  if (input.propertyId) {
    const mode = await ports.platform.assertWritable(tx, input.propertyId, 'guestProfiles');
    if (mode === 'forward') throw forwardingUnavailable();
  }
  const id = newId(tx.now.getTime());
  await assertParent(tx, id, input.parentCompanyId);
  try {
    await db(tx)
      .insertInto('guests.companies')
      .values({
        id,
        tenant_id: tx.tenantId,
        kind: input.kind,
        legal_name: input.legalName,
        trading_name: input.tradingName ?? null,
        search_name: normalizeLatin(`${input.legalName} ${input.tradingName ?? ''}`),
        tax_id: input.taxId ?? null,
        iata_code: input.iataCode ?? null,
        parent_company_id: input.parentCompanyId ?? null,
        default_market_segment: input.defaultMarketSegment ?? null,
        commission: JSON.stringify(input.commission ?? { model: 'none' }),
        ar_account_ref: input.arAccountRef ?? null,
        billing_address: JSON.stringify(input.billingAddress ?? {}),
        billing_email: input.billingEmail ?? null,
        notes: input.notes ?? null,
        home_property_id: input.propertyId ?? null,
        provenance: tx.environment === 'trial' ? 'copied' : 'live',
      })
      .execute();
  } catch (err) {
    uniqueViolation(err);
  }
  await tx.audit({
    action: 'guests.company.create',
    target: { type: 'company', id },
    propertyId: input.propertyId ?? null,
    // Free text (notes) and contact details are not copied into the audit trail.
    after: {
      kind: input.kind,
      legalName: input.legalName,
      tradingName: input.tradingName,
      taxId: input.taxId,
      iataCode: input.iataCode,
      parentCompanyId: input.parentCompanyId,
      commission: input.commission,
      billingEmail: input.billingEmail ? '(set)' : undefined,
      billingAddress: input.billingAddress ? '(set)' : undefined,
      notes: input.notes ? '(set)' : undefined,
    },
  });
  await tx.emit({
    type: 'guests.company.created',
    aggregate: { type: 'company', id },
    payload: { companyId: id, kind: input.kind },
  });
  return getCompany(tx, id);
}

/** Provider (domain map) + HTTP. */
export async function getCompany(tx: TxContext, companyId: string): Promise<CompanyView> {
  requireCompanyRead(tx);
  const row = await db(tx)
    .selectFrom('guests.companies')
    .selectAll()
    .where('id', '=', companyId)
    .executeTakeFirst();
  if (!row) throw new NotFoundError('company', companyId);
  return toView(tx, row);
}

export async function listCompanies(
  tx: TxContext,
  opts: { q?: string; kind?: 'company' | 'agency'; status?: CompanyStatus; limit?: number } = {},
): Promise<CompanyView[]> {
  requireCompanyRead(tx);
  let q = db(tx).selectFrom('guests.companies').selectAll();
  if (opts.kind) q = q.where('kind', '=', opts.kind);
  if (opts.status) q = q.where('status', '=', opts.status);
  if (opts.q) {
    const n = normalizeLatin(opts.q);
    q = q
      .where((eb) =>
        eb.or([
          sql<boolean>`search_name % ${n}`,
          sql<boolean>`search_name like ${`%${n}%`}`,
          eb('iata_code', '=', opts.q ?? ''),
          sql<boolean>`upper(tax_id) = upper(${opts.q})`,
        ]),
      )
      .orderBy(sql`similarity(search_name, ${n})`, 'desc');
  }
  const rows = await q
    .orderBy('legal_name')
    .limit(opts.limit ?? 50)
    .execute();
  const out: CompanyView[] = [];
  for (const r of rows) out.push(await toView(tx, r));
  return out;
}

export async function updateCompany(
  tx: TxContext,
  ports: GuestsPorts,
  companyId: string,
  expectedVersion: number,
  patch: CompanyUpdate,
): Promise<CompanyView> {
  const current = await db(tx)
    .selectFrom('guests.companies')
    .selectAll()
    .where('id', '=', companyId)
    .executeTakeFirst();
  if (!current) throw new NotFoundError('company', companyId);
  requireCompanyManage(tx, current.home_property_id);
  if (current.provenance === 'external') {
    throw new BusinessRuleError(
      'external_system_of_record',
      'This company is mirrored from the external system of record. Change it there; Portico follows after the next sync.',
    );
  }
  if (current.home_property_id) {
    const mode = await ports.platform.assertWritable(tx, current.home_property_id, 'guestProfiles');
    if (mode === 'forward') throw forwardingUnavailable();
  }
  validateCompany({
    kind: current.kind,
    iataCode: patch.iataCode,
    ...(patch.commission ? { commission: patch.commission } : {}),
  });
  if (patch.status && !canTransitionCompany(current.status, patch.status)) {
    throw new BusinessRuleError(
      'invalid_status_change',
      `A company cannot go from ${current.status} to ${patch.status}. Reactivate it first.`,
      { from: current.status, to: patch.status },
    );
  }
  if (patch.parentCompanyId !== undefined) await assertParent(tx, companyId, patch.parentCompanyId);
  const legalName = patch.legalName ?? current.legal_name;
  const tradingName = patch.tradingName === undefined ? current.trading_name : patch.tradingName;
  let row: Selectable<CompaniesTable> | undefined;
  try {
    row = await db(tx)
      .updateTable('guests.companies')
      .set({
        legal_name: legalName,
        trading_name: tradingName,
        search_name: normalizeLatin(`${legalName} ${tradingName ?? ''}`),
        ...(patch.taxId !== undefined ? { tax_id: patch.taxId } : {}),
        ...(patch.iataCode !== undefined ? { iata_code: patch.iataCode } : {}),
        ...(patch.parentCompanyId !== undefined ? { parent_company_id: patch.parentCompanyId } : {}),
        ...(patch.status !== undefined ? { status: patch.status } : {}),
        ...(patch.defaultMarketSegment !== undefined
          ? { default_market_segment: patch.defaultMarketSegment }
          : {}),
        ...(patch.commission !== undefined ? { commission: JSON.stringify(patch.commission) } : {}),
        ...(patch.arAccountRef !== undefined ? { ar_account_ref: patch.arAccountRef } : {}),
        ...(patch.billingAddress !== undefined
          ? { billing_address: JSON.stringify(patch.billingAddress) }
          : {}),
        ...(patch.billingEmail !== undefined ? { billing_email: patch.billingEmail } : {}),
        ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
        version: sql`version + 1`,
      })
      .where('id', '=', companyId)
      .where('version', '=', expectedVersion)
      .returningAll()
      .executeTakeFirst();
  } catch (err) {
    uniqueViolation(err);
  }
  if (!row) {
    return explainVersionMiss('company', companyId, expectedVersion, async () => {
      const r = await db(tx)
        .selectFrom('guests.companies')
        .select('version')
        .where('id', '=', companyId)
        .executeTakeFirst();
      return r?.version;
    });
  }
  await tx.audit({
    action: 'guests.company.update',
    target: { type: 'company', id: companyId },
    propertyId: current.home_property_id,
    before: { status: current.status, version: current.version, commission: current.commission },
    after: { status: row.status, version: row.version, commission: row.commission },
    metadata: { changedFields: Object.keys(patch) },
  });
  await tx.emit({
    type: 'guests.company.updated',
    aggregate: { type: 'company', id: companyId },
    payload: { companyId, changedFields: Object.keys(patch) },
  });
  if (patch.status && patch.status !== current.status) {
    await tx.emit({
      type: 'guests.company.statusChanged',
      aggregate: { type: 'company', id: companyId },
      payload: { companyId, from: current.status, to: patch.status },
    });
  }
  return toView(tx, row);
}

export async function addCompanyContact(
  tx: TxContext,
  ports: GuestsPorts,
  companyId: string,
  input: { profileId: string; role: 'primary' | 'booker' | 'billing' | 'travel_manager' | 'other' },
): Promise<CompanyView> {
  const company = await db(tx)
    .selectFrom('guests.companies')
    .selectAll()
    .where('id', '=', companyId)
    .executeTakeFirst();
  if (!company) throw new NotFoundError('company', companyId);
  requireCompanyManage(tx, company.home_property_id);
  const vp = await requireVisibleProfile(tx, ports, input.profileId);
  await lockProfileForWrite(tx, vp.row.id);
  await db(tx)
    .insertInto('guests.company_contacts')
    .values({
      id: newId(tx.now.getTime()),
      tenant_id: tx.tenantId,
      company_id: companyId,
      profile_id: vp.row.id,
      role: input.role,
    })
    .onConflict((oc) => oc.columns(['company_id', 'profile_id', 'role']).doNothing())
    .execute();
  await tx.audit({
    action: 'guests.company.contactAdd',
    target: { type: 'company', id: companyId },
    metadata: { profileId: vp.row.id, role: input.role },
  });
  return getCompany(tx, companyId);
}

export async function removeCompanyContact(tx: TxContext, contactId: string): Promise<CompanyView> {
  const row = await db(tx)
    .selectFrom('guests.company_contacts')
    .selectAll()
    .where('id', '=', contactId)
    .executeTakeFirst();
  if (!row) throw new NotFoundError('company_contact', contactId);
  const company = await db(tx)
    .selectFrom('guests.companies')
    .select('home_property_id')
    .where('id', '=', row.company_id)
    .executeTakeFirstOrThrow();
  requireCompanyManage(tx, company.home_property_id);
  await db(tx).deleteFrom('guests.company_contacts').where('id', '=', contactId).execute();
  await tx.audit({
    action: 'guests.company.contactRemove',
    target: { type: 'company', id: row.company_id },
    metadata: { profileId: row.profile_id, role: row.role },
  });
  return getCompany(tx, row.company_id);
}
