import { type Selectable, sql, type TxContext } from '@portico/db';
import { addDays, BusinessRuleError, ConflictError, type LocalDate, newId, requirePermission, ValidationError } from '@portico/kernel';
import type { AllowanceInstance, GrantAllowanceInput } from '../contracts';
import { closeOutcome, type UnusedPolicy } from '../domain/allowance';
import type { LineDraft } from '../domain/ledger';
import type { AllowanceInstancesTable } from '../tables';
import { assertSameProperty, prepareDestination } from './folios';
import { chargeCodeByCode } from './setup';
import {
  accountId,
  claimEntry,
  type Deps,
  db,
  type FolioRow,
  findEntryByKey,
  isUniqueViolation,
  loadFolio,
  lockFolios,
  type PostingDraft,
  requestHash,
  writeEntryBody,
} from './support';

function toInstance(r: Selectable<AllowanceInstancesTable>): AllowanceInstance {
  const granted = Number(r.granted_minor);
  const used = Number(r.used_minor);
  return {
    id: r.id,
    stayId: r.stay_id,
    folioId: r.folio_id,
    definitionRef: r.definition_ref,
    label: r.label,
    periodKey: r.period_key,
    validFrom: r.valid_from,
    validTo: r.valid_to,
    granted: { amountMinor: granted, currency: r.currency },
    used: { amountMinor: used, currency: r.currency },
    remaining: { amountMinor: granted - used, currency: r.currency },
    unusedPolicy: r.unused_policy,
    status: r.status,
  };
}

/**
 * Grant an allowance (package posting): the allowance value is charged to the payer's folio against allowance
 * clearing (a liability, not revenue). Consumption credits it back; unused remainders follow the policy.
 */
export async function grantAllowance(
  tx: TxContext,
  deps: Deps,
  input: GrantAllowanceInput & { idempotencyKey: string },
): Promise<{ instance: AllowanceInstance; entryId: string; replayed: boolean }> {
  requirePermission(tx, 'finance.posting.create', { propertyId: input.propertyId });
  if (input.amount.amountMinor <= 0) throw new ValidationError('invalid_amount', 'An allowance must be positive.');
  const { idempotencyKey, ...rest } = input;
  const hash = requestHash({ op: 'allowance', ...rest });
  const periodKey = 'night' in input.period ? input.period.night : 'stay';
  const validFrom = 'night' in input.period ? input.period.night : input.period.stay.from;
  const validTo = 'night' in input.period ? addDays(input.period.night, 1) : input.period.stay.to;
  if (validTo <= validFrom) throw new ValidationError('invalid_period', 'The allowance period must end after it starts.');
  const find = () =>
    db(tx)
      .selectFrom('finance.allowance_instances')
      .selectAll()
      .where('stay_id', '=', input.stayId)
      .where('definition_ref', '=', input.definitionRef)
      .where('period_key', '=', periodKey)
      .executeTakeFirst();
  const prior = await findEntryByKey(tx, idempotencyKey, hash);
  if (prior) return { instance: toInstance((await find()) as Selectable<AllowanceInstancesTable>), entryId: prior, replayed: true };
  await deps.ports.platform.assertWritable(tx, input.propertyId, 'charges');
  const f0 = await loadFolio(tx, input.folioId);
  assertSameProperty(f0, input.propertyId);
  if (input.amount.currency !== f0.currency) {
    throw new ValidationError('allowance_currency_mismatch', `Allowances are granted in the folio currency (${f0.currency}).`);
  }
  const code = await chargeCodeByCode(tx, input.propertyId, input.chargeCode);
  if (code.charge_group !== 'allowance') {
    throw new ValidationError('not_an_allowance_code', `Charge code ${code.code} is not an allowance code (group "allowance").`);
  }
  const businessDate = await deps.ports.platform.getBusinessDate(tx, input.propertyId);
  const claim = await claimEntry(tx, {
    legalEntityId: f0.legal_entity_id,
    propertyId: input.propertyId,
    entryType: 'allowance_grant',
    businessDate,
    idempotencyKey,
    requestHash: hash,
    source: { type: 'stay', id: input.stayId },
    description: `${input.label} granted`,
  });
  if (!claim.claimed) return { instance: toInstance((await find()) as Selectable<AllowanceInstancesTable>), entryId: claim.entryId, replayed: true };
  const locked = (await lockFolios(tx, [f0.id])).get(f0.id) as FolioRow;
  const { folio } = await prepareDestination(tx, locked, 'new_charge');
  // Top up an instance created earlier for the same period (e.g. carried forward), otherwise create it.
  const existing = await db(tx)
    .selectFrom('finance.allowance_instances')
    .selectAll()
    .where('stay_id', '=', input.stayId)
    .where('definition_ref', '=', input.definitionRef)
    .where('period_key', '=', periodKey)
    .forUpdate()
    .executeTakeFirst();
  let instanceId: string;
  if (existing) {
    if (existing.status === 'closed' || existing.status === 'cancelled') {
      throw new BusinessRuleError('allowance_period_closed', `The allowance "${existing.label}" for this period is already closed.`);
    }
    instanceId = existing.id;
    await db(tx)
      .updateTable('finance.allowance_instances')
      .set({ granted_minor: sql`granted_minor + ${input.amount.amountMinor}`, status: 'active', version: sql`version + 1` })
      .where('id', '=', existing.id)
      .execute();
  } else {
    instanceId = newId(tx.now.getTime());
    try {
      await db(tx)
        .insertInto('finance.allowance_instances')
        .values({
          id: instanceId,
          tenant_id: tx.tenantId,
          property_id: input.propertyId,
          legal_entity_id: folio.legal_entity_id,
          stay_id: input.stayId,
          folio_id: folio.id,
          definition_ref: input.definitionRef,
          label: input.label,
          period_key: periodKey,
          valid_from: validFrom,
          valid_to: validTo,
          eligible_charge_codes: input.eligibleChargeCodes ?? [],
          eligible_groups: input.eligibleGroups ?? [],
          eligible_tags: input.eligibleTags ?? [],
          covers_taxes: input.coversTaxes ?? true,
          unused_policy: input.unusedPolicy,
          currency: input.amount.currency,
          granted_minor: input.amount.amountMinor,
          grant_entry_id: claim.entryId,
          close_entry_id: null,
          carried_to_id: null,
          carried_from_id: null,
        })
        .execute();
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictError('allowance_exists', 'This allowance was granted concurrently. Retry.');
      throw err;
    }
  }
  const clearing = await accountId(tx, deps, folio.legal_entity_id, 'allowance_clearing');
  const postings: PostingDraft[] = [
    {
      folioId: folio.id,
      kind: 'charge',
      amountMinor: input.amount.amountMinor,
      currency: folio.currency,
      description: input.label,
      chargeCodeId: code.id,
      chargeCode: code.code,
      serviceDate: validFrom < businessDate ? validFrom : businessDate,
      revenueDate: validFrom,
      allowanceInstanceId: instanceId,
      counterAccountId: clearing,
      source: { type: 'stay', id: input.stayId },
    },
  ];
  const lines: Array<LineDraft & { accountId?: string }> = [
    { accountKey: 'guest_ledger', amountMinor: input.amount.amountMinor, currency: folio.currency, subLedger: { type: 'folio', id: folio.id }, postingIndex: 0, chargeCode: code.code },
    { accountKey: '', accountId: clearing, amountMinor: -input.amount.amountMinor, currency: folio.currency, subLedger: { type: 'allowance', id: instanceId } },
  ];
  await writeEntryBody(tx, deps, claim.entryId, { legalEntityId: folio.legal_entity_id, propertyId: input.propertyId, businessDate, description: input.label }, postings, lines);
  await tx.audit({
    action: 'finance.allowance.grant',
    target: { type: 'allowance', id: instanceId },
    propertyId: input.propertyId,
    after: { stayId: input.stayId, amount: input.amount, periodKey, unusedPolicy: input.unusedPolicy },
  });
  const instance = (await find()) as Selectable<AllowanceInstancesTable>;
  return { instance: toInstance(instance), entryId: claim.entryId, replayed: false };
}

export async function listAllowances(tx: TxContext, stayId: string): Promise<AllowanceInstance[]> {
  const rows = await db(tx).selectFrom('finance.allowance_instances').selectAll().where('stay_id', '=', stayId).orderBy('valid_from').orderBy('id').execute();
  const first = rows[0];
  if (first) requirePermission(tx, 'finance.folio.read', { propertyId: first.property_id });
  return rows.map(toInstance);
}

/**
 * Close allowance periods that ended on or before `upTo` (Day Close per night; check-out for the rest).
 * The unused remainder follows the instance's policy: forfeit → breakage revenue; credit_back → returned to
 * the folio; carry_forward → moved to the next night's instance (or forfeited when the stay ends).
 * Deterministic keys (`breakage:{instance}:{period}`) make a re-run after an interruption harmless.
 */
export async function closeAllowances(
  tx: TxContext,
  deps: Deps,
  input: { stayId: string; upTo: LocalDate; departureDate?: LocalDate },
): Promise<{ closed: AllowanceInstance[] }> {
  const rows = await db(tx)
    .selectFrom('finance.allowance_instances')
    .selectAll()
    .where('stay_id', '=', input.stayId)
    .where('status', 'in', ['active', 'consumed'])
    .where('valid_to', '<=', input.upTo)
    .orderBy('valid_to')
    .orderBy('id')
    .forUpdate()
    .execute();
  const closed: AllowanceInstance[] = [];
  for (const inst of rows) {
    requirePermission(tx, 'finance.posting.create', { propertyId: inst.property_id });
    const businessDate = await deps.ports.platform.getBusinessDate(tx, inst.property_id);
    const hasNext = !!input.departureDate && inst.period_key !== 'stay' && inst.valid_to < input.departureDate;
    const outcome = closeOutcome({ grantedMinor: Number(inst.granted_minor), usedMinor: Number(inst.used_minor) }, inst.unused_policy as UnusedPolicy, hasNext);
    let closeEntryId: string | null = null;
    let carriedTo: string | null = null;
    if (outcome.kind !== 'none') {
      const r = outcome.amountMinor;
      const clearing = await accountId(tx, deps, inst.legal_entity_id, 'allowance_clearing');
      const key = outcome.kind === 'carry_forward' ? `carry:${inst.id}` : `breakage:${inst.id}:${inst.period_key}`;
      const claim = await claimEntry(tx, {
        legalEntityId: inst.legal_entity_id,
        propertyId: inst.property_id,
        entryType: 'allowance_close',
        businessDate,
        idempotencyKey: key,
        requestHash: requestHash({ op: 'allowance-close', instance: inst.id, outcome }),
        source: { type: 'allowance', id: inst.id },
        description: `${inst.label}: unused ${r} (${outcome.kind.replace('_', ' ')})`,
      });
      if (!claim.claimed) continue;
      closeEntryId = claim.entryId;
      const postings: PostingDraft[] = [];
      const lines: Array<LineDraft & { accountId?: string }> = [
        { accountKey: '', accountId: clearing, amountMinor: r, currency: inst.currency, subLedger: { type: 'allowance', id: inst.id } },
      ];
      if (outcome.kind === 'forfeit') {
        lines.push({ accountKey: 'revenue:breakage', amountMinor: -r, currency: inst.currency, memo: inst.label });
      } else if (outcome.kind === 'credit_back') {
        const locked = (await lockFolios(tx, [inst.folio_id])).get(inst.folio_id) as FolioRow;
        const { folio } = await prepareDestination(tx, locked, 'correction');
        postings.push({ folioId: folio.id, kind: 'allowance_return', amountMinor: -r, currency: inst.currency, description: `${inst.label} — unused allowance credited`, allowanceInstanceId: inst.id, counterAccountId: clearing });
        lines.push({ accountKey: 'guest_ledger', amountMinor: -r, currency: inst.currency, subLedger: { type: 'folio', id: folio.id }, postingIndex: 0 });
      } else {
        const nextKey = inst.valid_to;
        const next = await db(tx)
          .selectFrom('finance.allowance_instances')
          .selectAll()
          .where('stay_id', '=', inst.stay_id)
          .where('definition_ref', '=', inst.definition_ref)
          .where('period_key', '=', nextKey)
          .forUpdate()
          .executeTakeFirst();
        if (next) {
          carriedTo = next.id;
          await db(tx).updateTable('finance.allowance_instances').set({ granted_minor: sql`granted_minor + ${r}`, status: 'active', carried_from_id: inst.id, version: sql`version + 1` }).where('id', '=', next.id).execute();
        } else {
          carriedTo = newId(tx.now.getTime());
          await db(tx)
            .insertInto('finance.allowance_instances')
            .values({
              id: carriedTo,
              tenant_id: tx.tenantId,
              property_id: inst.property_id,
              legal_entity_id: inst.legal_entity_id,
              stay_id: inst.stay_id,
              folio_id: inst.folio_id,
              definition_ref: inst.definition_ref,
              label: inst.label,
              period_key: nextKey,
              valid_from: inst.valid_to,
              valid_to: addDays(inst.valid_to, 1),
              eligible_charge_codes: inst.eligible_charge_codes,
              eligible_groups: inst.eligible_groups,
              eligible_tags: inst.eligible_tags,
              covers_taxes: inst.covers_taxes,
              unused_policy: inst.unused_policy,
              currency: inst.currency,
              granted_minor: r,
              grant_entry_id: claim.entryId,
              close_entry_id: null,
              carried_to_id: null,
              carried_from_id: inst.id,
            })
            .execute();
        }
        lines.push({ accountKey: '', accountId: clearing, amountMinor: -r, currency: inst.currency, subLedger: { type: 'allowance', id: carriedTo } });
      }
      await writeEntryBody(tx, deps, claim.entryId, { legalEntityId: inst.legal_entity_id, propertyId: inst.property_id, businessDate, description: 'Allowance close' }, postings, lines);
      if (outcome.kind === 'forfeit') {
        await tx.emit({
          type: 'finance.allowance.breakagePosted',
          propertyId: inst.property_id,
          aggregate: { type: 'allowance', id: inst.id },
          payload: { allowanceId: inst.id, stayId: inst.stay_id, amountMinor: r, currency: inst.currency, entryId: claim.entryId },
        });
      }
    }
    const row = await db(tx)
      .updateTable('finance.allowance_instances')
      .set({ status: 'closed', close_entry_id: closeEntryId, carried_to_id: carriedTo, version: sql`version + 1` })
      .where('id', '=', inst.id)
      .returningAll()
      .executeTakeFirstOrThrow();
    await tx.audit({
      action: 'finance.allowance.close',
      target: { type: 'allowance', id: inst.id },
      propertyId: inst.property_id,
      after: { outcome, closeEntryId, carriedTo },
    });
    closed.push(toInstance(row));
  }
  return { closed };
}
