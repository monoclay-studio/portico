import { explainVersionMiss, type Selectable, sql, type TxContext, typed } from '@portico/db';
import {
  BusinessRuleError,
  ConflictError,
  NotFoundError,
  newId,
  requirePermission,
  ValidationError,
} from '@portico/kernel';
import type { Owner, OwnerInput, OwnershipShare } from '../contracts';
import {
  FULL_SHARE_BPS,
  looksLikeBankData,
  maxConcurrentShare,
  sharesOn,
  validateSharePeriod,
} from '../domain/ownership';
import { actorKey, requireEntitlement } from '../service';
import type { OwnersTable, PlatformDB } from '../tables';

/**
 * Owners and effective-dated unit ownership shares (brief §2 "individual owners where ownership arrangements
 * require separate accounting"). Owner statements are finance's (LATER); platform exposes the data.
 * Units belong to inventory and are referenced by id only.
 */
const db = (tx: TxContext) => typed<PlatformDB>(tx.db);

function toOwner(r: Selectable<OwnersTable>): Owner {
  return {
    id: r.id,
    reference: r.reference,
    kind: r.kind,
    displayName: r.display_name,
    ...(r.legal_name ? { legalName: r.legal_name } : {}),
    ...(r.tax_id ? { taxId: r.tax_id } : {}),
    ...(r.country_code ? { countryCode: r.country_code } : {}),
    ...(r.email ? { email: r.email } : {}),
    ...(r.phone ? { phone: r.phone } : {}),
    ...(r.payout_account_ref ? { payoutAccountRef: r.payout_account_ref } : {}),
    ...(r.payout_hint ? { payoutHint: r.payout_hint } : {}),
    status: r.status,
    version: r.version,
  };
}

/** Owner fields that are personal data: never copied into the append-only audit log (P2-11). */
const OWNER_PERSONAL_FIELDS = [
  'legalName',
  'taxId',
  'email',
  'phone',
  'payoutAccountRef',
  'payoutHint',
] as const;

/** Audit view of an owner: identifying, non-personal fields plus which personal fields are filled. */
function auditOwner(o: Owner) {
  const personal = Object.fromEntries(
    OWNER_PERSONAL_FIELDS.map((f) => [f, o[f] === undefined ? 'empty' : 'set']),
  );
  return {
    reference: o.reference,
    kind: o.kind,
    displayName: o.displayName,
    ...(o.countryCode ? { countryCode: o.countryCode } : {}),
    status: o.status,
    personalFields: personal,
  };
}

function assertNoBankData(input: Partial<OwnerInput>) {
  for (const [field, v] of [
    ['payoutAccountRef', input.payoutAccountRef],
    ['payoutHint', input.payoutHint],
  ] as const) {
    if (v && looksLikeBankData(v)) {
      throw new ValidationError(
        'bank_data_not_allowed',
        'Payout details are not stored here. Record a reference to the payout account held by finance (and at most the last 4 digits as a hint).',
        { field },
      );
    }
  }
}

export async function createOwner(tx: TxContext, input: OwnerInput): Promise<Owner> {
  requirePermission(tx, 'platform.owner.manage');
  await requireEntitlement(tx, 'owners.accounting');
  assertNoBankData(input);
  const id = newId();
  try {
    const row = await db(tx)
      .insertInto('platform.owners')
      .values({
        id,
        tenant_id: tx.tenantId,
        reference: input.reference,
        kind: input.kind,
        display_name: input.displayName,
        legal_name: input.legalName ?? null,
        tax_id: input.taxId ?? null,
        country_code: input.countryCode ?? null,
        email: input.email ?? null,
        phone: input.phone ?? null,
        payout_account_ref: input.payoutAccountRef ?? null,
        payout_hint: input.payoutHint ?? null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    await tx.audit({
      action: 'platform.owner.create',
      target: { type: 'owner', id },
      after: auditOwner(toOwner(row)),
    });
    await tx.emit({
      type: 'platform.owner.created',
      aggregate: { type: 'owner', id },
      payload: { ownerId: id },
    });
    return toOwner(row);
  } catch (err) {
    if ((err as { code?: string }).code === '23505')
      throw new ConflictError('owner_reference_taken', `Owner reference ${input.reference} is already used.`);
    throw err;
  }
}

export async function getOwner(tx: TxContext, id: string): Promise<Owner> {
  requirePermission(tx, 'platform.owner.read');
  const row = await db(tx).selectFrom('platform.owners').selectAll().where('id', '=', id).executeTakeFirst();
  if (!row) throw new NotFoundError('owner', id);
  return toOwner(row);
}

export async function listOwners(tx: TxContext, opts: { includeArchived?: boolean } = {}): Promise<Owner[]> {
  requirePermission(tx, 'platform.owner.read');
  let q = db(tx).selectFrom('platform.owners').selectAll().orderBy('display_name');
  if (!opts.includeArchived) q = q.where('status', '=', 'active');
  return (await q.execute()).map(toOwner);
}

export async function updateOwner(
  tx: TxContext,
  id: string,
  expectedVersion: number,
  patch: Partial<Omit<OwnerInput, 'reference'>>,
): Promise<Owner> {
  requirePermission(tx, 'platform.owner.manage');
  await requireEntitlement(tx, 'owners.accounting');
  assertNoBankData(patch);
  const before = await getOwner(tx, id);
  const set: Record<string, unknown> = { version: sql`version + 1` };
  const map: Array<[keyof typeof patch, string]> = [
    ['kind', 'kind'],
    ['displayName', 'display_name'],
    ['legalName', 'legal_name'],
    ['taxId', 'tax_id'],
    ['countryCode', 'country_code'],
    ['email', 'email'],
    ['phone', 'phone'],
    ['payoutAccountRef', 'payout_account_ref'],
    ['payoutHint', 'payout_hint'],
  ];
  for (const [k, col] of map) if (patch[k] !== undefined) set[col] = patch[k];
  const row = await db(tx)
    .updateTable('platform.owners')
    .set(set)
    .where('id', '=', id)
    .where('version', '=', expectedVersion)
    .returningAll()
    .executeTakeFirst();
  if (!row)
    return explainVersionMiss('owner', id, expectedVersion, async () => (await getOwner(tx, id)).version);
  const after = toOwner(row);
  const changed = (Object.keys(patch) as Array<keyof typeof patch>).filter((k) => patch[k] !== undefined);
  await tx.audit({
    action: 'platform.owner.update',
    target: { type: 'owner', id },
    before: auditOwner(before),
    after: auditOwner(after),
    metadata: { changedFields: changed },
  });
  return after;
}

/** Archive an owner with no current or future shares (history stays). */
export async function archiveOwner(tx: TxContext, id: string, reason: string): Promise<Owner> {
  requirePermission(tx, 'platform.owner.manage');
  const today = tx.now.toISOString().slice(0, 10);
  const current = await db(tx)
    .selectFrom('platform.unit_ownership')
    .select('id')
    .where('owner_id', '=', id)
    .where((eb) => eb.or([eb('effective_to', 'is', null), eb('effective_to', '>', today)]))
    .executeTakeFirst();
  if (current) {
    throw new BusinessRuleError(
      'owner_has_current_shares',
      'This owner still holds current or future unit shares. End those shares first, then archive the owner.',
      { ownerId: id },
    );
  }
  const row = await db(tx)
    .updateTable('platform.owners')
    .set({ status: 'archived', version: sql`version + 1` })
    .where('id', '=', id)
    .returningAll()
    .executeTakeFirst();
  if (!row) throw new NotFoundError('owner', id);
  await tx.audit({ action: 'platform.owner.archive', target: { type: 'owner', id }, reason });
  return toOwner(row);
}

function toShare(r: {
  id: string;
  owner_id: string;
  property_id: string;
  unit_id: string;
  share_bps: number;
  effective_from: string;
  effective_to: string | null;
  display_name: string;
  end_reason: string | null;
}): OwnershipShare {
  return {
    id: r.id,
    ownerId: r.owner_id,
    propertyId: r.property_id,
    unitId: r.unit_id,
    shareBps: r.share_bps,
    effectiveFrom: r.effective_from,
    effectiveTo: r.effective_to,
    ownerDisplayName: r.display_name,
    endReason: r.end_reason,
  };
}

async function lockUnit(tx: TxContext, unitId: string) {
  await sql`select pg_advisory_xact_lock(hashtext(${`platform.unit_ownership:${unitId}`}))`.execute(tx.db);
}

async function unitPeriods(tx: TxContext, unitId: string, excludeId?: string) {
  let q = db(tx)
    .selectFrom('platform.unit_ownership')
    .select(['id', 'share_bps', 'effective_from', 'effective_to'])
    .where('unit_id', '=', unitId);
  if (excludeId) q = q.where('id', '<>', excludeId);
  return (await q.execute()).map((r) => ({
    shareBps: r.share_bps,
    effectiveFrom: r.effective_from,
    effectiveTo: r.effective_to,
  }));
}

/**
 * Add an effective-dated share. Invariant: for every unit and date the shares total at most 100 % (10 000 bp) —
 * checked under a per-unit advisory lock so concurrent additions cannot both pass.
 */
export async function addOwnershipShare(
  tx: TxContext,
  input: {
    ownerId: string;
    propertyId: string;
    unitId: string;
    shareBps: number;
    effectiveFrom: string;
    effectiveTo?: string;
  },
): Promise<OwnershipShare> {
  requirePermission(tx, 'platform.owner.manage');
  await requireEntitlement(tx, 'owners.accounting');
  const period = {
    shareBps: input.shareBps,
    effectiveFrom: input.effectiveFrom,
    effectiveTo: input.effectiveTo ?? null,
  };
  const problem = validateSharePeriod(period);
  if (problem) throw new ValidationError('invalid_share', problem);
  const owner = await getOwner(tx, input.ownerId);
  if (owner.status !== 'active')
    throw new BusinessRuleError(
      'owner_archived',
      'This owner is archived. Reactivate or choose another owner.',
    );
  const prop = await db(tx)
    .selectFrom('platform.properties')
    .select('id')
    .where('id', '=', input.propertyId)
    .executeTakeFirst();
  if (!prop) throw new NotFoundError('property', input.propertyId);
  await lockUnit(tx, input.unitId);
  const max = maxConcurrentShare(await unitPeriods(tx, input.unitId), period);
  if (max.maxBps > FULL_SHARE_BPS) {
    throw new BusinessRuleError(
      'ownership_exceeds_100_percent',
      `On ${max.onDate} this unit's shares would total ${(max.maxBps / 100).toFixed(2)} %. Reduce this share or end another owner's share first.`,
      { unitId: input.unitId, onDate: max.onDate, totalBps: max.maxBps },
    );
  }
  const id = newId();
  try {
    await db(tx)
      .insertInto('platform.unit_ownership')
      .values({
        id,
        tenant_id: tx.tenantId,
        owner_id: input.ownerId,
        property_id: input.propertyId,
        unit_id: input.unitId,
        share_bps: input.shareBps,
        effective_from: input.effectiveFrom,
        effective_to: input.effectiveTo ?? null,
        created_by: actorKey(tx),
        ended_at: null,
        ended_by: null,
        end_reason: null,
      })
      .execute();
  } catch (err) {
    if ((err as { code?: string }).code === '23P01') {
      throw new ConflictError(
        'overlapping_share',
        'This owner already holds a share of this unit in that period. End or adjust the existing share instead.',
      );
    }
    throw err;
  }
  await tx.audit({
    action: 'platform.ownership.add',
    target: { type: 'unit', id: input.unitId },
    propertyId: input.propertyId,
    after: input,
  });
  await tx.emit({
    type: 'platform.unitOwnership.changed',
    propertyId: input.propertyId,
    aggregate: { type: 'unit', id: input.unitId },
    payload: { shareId: id, ...input },
  });
  return toShare({
    id,
    owner_id: input.ownerId,
    property_id: input.propertyId,
    unit_id: input.unitId,
    share_bps: input.shareBps,
    effective_from: input.effectiveFrom,
    effective_to: input.effectiveTo ?? null,
    display_name: owner.displayName,
    end_reason: null,
  });
}

/** End a share on a date (exclusive). Shares can only be shortened — history is never rewritten backwards. */
export async function endOwnershipShare(
  tx: TxContext,
  shareId: string,
  input: { effectiveTo: string; reason: string },
): Promise<OwnershipShare> {
  requirePermission(tx, 'platform.owner.manage');
  const share = await db(tx)
    .selectFrom('platform.unit_ownership')
    .selectAll()
    .where('id', '=', shareId)
    .executeTakeFirst();
  if (!share) throw new NotFoundError('ownership_share', shareId);
  if (
    input.effectiveTo <= share.effective_from ||
    (share.effective_to && input.effectiveTo > share.effective_to)
  ) {
    throw new ValidationError(
      'invalid_end_date',
      `The end date must be after ${share.effective_from}${share.effective_to ? ` and no later than ${share.effective_to}` : ''}. To extend a share, add a new one.`,
    );
  }
  await db(tx)
    .updateTable('platform.unit_ownership')
    .set({
      effective_to: input.effectiveTo,
      ended_at: tx.now,
      ended_by: actorKey(tx),
      end_reason: input.reason,
    })
    .where('id', '=', shareId)
    .execute();
  await tx.audit({
    action: 'platform.ownership.end',
    target: { type: 'unit', id: share.unit_id },
    propertyId: share.property_id,
    reason: input.reason,
    before: { effectiveTo: share.effective_to },
    after: { effectiveTo: input.effectiveTo },
  });
  await tx.emit({
    type: 'platform.unitOwnership.changed',
    propertyId: share.property_id,
    aggregate: { type: 'unit', id: share.unit_id },
    payload: { shareId, effectiveTo: input.effectiveTo },
  });
  const [out] = await listOwnershipShares(tx, { unitId: share.unit_id }).then((l) =>
    l.filter((s) => s.id === shareId),
  );
  return out as OwnershipShare;
}

export async function listOwnershipShares(
  tx: TxContext,
  filter: { propertyId?: string; unitId?: string; ownerId?: string; onDate?: string },
): Promise<OwnershipShare[]> {
  requirePermission(tx, 'platform.owner.read');
  let q = db(tx)
    .selectFrom('platform.unit_ownership as s')
    .innerJoin('platform.owners as o', 'o.id', 's.owner_id')
    .select([
      's.id',
      's.owner_id',
      's.property_id',
      's.unit_id',
      's.share_bps',
      's.effective_from',
      's.effective_to',
      's.end_reason',
      'o.display_name',
    ])
    .orderBy('s.unit_id')
    .orderBy('s.effective_from');
  if (filter.propertyId) q = q.where('s.property_id', '=', filter.propertyId);
  if (filter.unitId) q = q.where('s.unit_id', '=', filter.unitId);
  if (filter.ownerId) q = q.where('s.owner_id', '=', filter.ownerId);
  const rows = (await q.execute()).map(toShare);
  return filter.onDate ? sharesOn(rows, filter.onDate) : rows;
}

/** Owners of a unit on a date (provider for finance owner statements, LATER). */
export async function getUnitOwnership(tx: TxContext, input: { unitId: string; date: string }) {
  const shares = await listOwnershipShares(tx, { unitId: input.unitId, onDate: input.date });
  const allocated = shares.reduce((n, s) => n + s.shareBps, 0);
  return {
    unitId: input.unitId,
    date: input.date,
    owners: shares.map((s) => ({
      ownerId: s.ownerId,
      displayName: s.ownerDisplayName,
      shareBps: s.shareBps,
    })),
    allocatedBps: allocated,
    unallocatedBps: FULL_SHARE_BPS - allocated,
  };
}
