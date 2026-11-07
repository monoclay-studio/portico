import { type Selectable, sql, type TxContext } from '@portico/db';
import {
  BusinessRuleError,
  convert,
  type EntityRef,
  type LocalDate,
  type Money,
  money,
  type Occupancy,
  requirePermission,
  ValidationError,
} from '@portico/kernel';
import type { EntryResult, PostChargeResult, TransferInput } from '../contracts';
import { isEligible, usageFor } from '../domain/allowance';
import { revenueKeyForGroup, taxAccountKey } from '../domain/chart';
import type { LineDraft } from '../domain/ledger';
import { capPeriodKey, type RoutingRule, routeCharge } from '../domain/routing';
import { proportional, splitComponents } from '../domain/split';
import type { ChargeGroup, PaymentMethodKind, RuleCap, RuleSelector } from '../domain/types';
import type { TaxLine } from '../ports';
import type { AllowanceInstancesTable, ChargeCodesTable } from '../tables';
import { assertSameProperty, defaultFolio, prepareDestination, reopenInPlace } from './folios';
import { chargeCodeByCode } from './setup';
import {
  accountId,
  claimEntry,
  type Deps,
  db,
  type FolioRow,
  findEntryByKey,
  folioBalance,
  loadFolio,
  lockFolios,
  ownerDeparture,
  type PostingDraft,
  postingIdsOfEntry,
  raiseException,
  rateBetween,
  requestHash,
  writeEntryBody,
} from './support';
import {
  bridgeLines,
  clearingSide,
  decodeMethod,
  encodeMethod,
  openSessionFor,
  recordCashMovement,
} from './tender';

export interface ProvidedTaxLineInput {
  ruleId: string;
  ruleVersionId: string;
  name: string;
  accountKey: string;
  amount: Money;
  kind?: 'tax' | 'fee' | 'service_charge';
  units?: number;
  exemptUnits?: number;
  rateCategory?: string;
  rate?: string;
}

/** Provider contract (domain map) — `postCharge`. */
export interface PostChargeInput {
  propertyId: string;
  folioId?: string;
  target?: { type: 'stay' | 'booking' | 'group'; id: string };
  chargeCode: string;
  /** Total of the line (quantity × unit price), tax-exclusive unless priceMode = 'inclusive'. */
  amount: Money;
  quantity?: number;
  priceMode?: 'inclusive' | 'exclusive';
  serviceDate: LocalDate;
  revenueDate?: LocalDate;
  description: string;
  sourceRef: EntityRef;
  idempotencyKey: string;
  taxMode?: 'compute' | 'provided';
  taxLines?: ProvidedTaxLineInput[];
  allowanceRef?: 'auto' | string;
  /** Required from staff when the service date is before the business date (late-arriving charge). */
  reason?: string;
  occupancy?: Occupancy;
}

type Component = { kind: 'net' } | { kind: 'tax'; tax: TaxLine };

async function replayCharge(tx: TxContext, entryId: string): Promise<PostChargeResult> {
  const rows = await db(tx)
    .selectFrom('finance.postings')
    .select(['id', 'folio_id', 'kind', 'amount_minor', 'currency'])
    .where('entry_id', '=', entryId)
    .orderBy('created_at')
    .orderBy('id')
    .execute();
  const folioIds = [...new Set(rows.map((r) => r.folio_id))];
  const usage = rows.filter((r) => r.kind === 'allowance_usage');
  return {
    entryId,
    postingIds: rows.map((r) => r.id),
    folioId: folioIds[0] as string,
    folioIds,
    allowanceUsage: usage.length
      ? { amountMinor: -usage.reduce((s, r) => s + Number(r.amount_minor), 0), currency: usage[0]?.currency as string }
      : null,
    replayed: true,
  };
}

export async function loadRules(tx: TxContext, owner: { type: string; id: string }): Promise<RoutingRule[]> {
  const rows = await db(tx)
    .selectFrom('finance.billing_rules')
    .select(['id', 'label', 'destination_folio_id', 'selector', 'cap'])
    .where('owner_type', '=', owner.type)
    .where('owner_id', '=', owner.id)
    .where('active', '=', true)
    .execute();
  return rows.map((r) => ({
    id: r.id,
    label: r.label,
    destinationFolioId: r.destination_folio_id,
    selector: r.selector as RuleSelector,
    cap: (r.cap ?? null) as RuleCap | null,
  }));
}

/** Gross already routed through a capped rule in its period (charges, taxes and their adjustments). */
export async function capUsage(tx: TxContext, ruleId: string, periodKey: string): Promise<number> {
  let q = db(tx)
    .selectFrom('finance.postings')
    .select(sql<number>`coalesce(sum(amount_minor), 0)::bigint`.as('used'))
    .where('billing_rule_id', '=', ruleId)
    .where('kind', 'in', ['charge', 'tax', 'adjustment']);
  if (periodKey !== 'stay') q = q.where('service_date', '=', periodKey);
  const row = await q.executeTakeFirstOrThrow();
  return Number(row.used);
}

async function computeComponents(
  tx: TxContext,
  deps: Deps,
  input: PostChargeInput,
  code: Selectable<ChargeCodesTable>,
): Promise<{ components: Component[]; amounts: number[] }> {
  const amount = input.amount;
  const priceMode = input.priceMode ?? 'exclusive';
  const taxMode = input.taxMode ?? (input.taxLines ? 'provided' : 'compute');
  let net = amount.amountMinor;
  let taxes: TaxLine[] = [];
  if (taxMode === 'provided') {
    if (tx.actor.kind === 'user') {
      throw new ValidationError(
        'provided_taxes_not_allowed',
        'Staff postings always use the tax engine. Provided tax lines are accepted only from trusted integrations (channel prepaid totals, verified POS).',
      );
    }
    taxes = (input.taxLines ?? []).map((t): TaxLine => {
      if (t.amount.currency !== amount.currency) {
        throw new ValidationError('tax_currency_mismatch', 'Provided tax lines must be in the charge currency.');
      }
      return {
        lineId: 'l1',
        ruleId: t.ruleId,
        ruleVersionId: t.ruleVersionId,
        name: t.name,
        kind: t.kind ?? 'tax',
        accountKey: t.accountKey,
        base: amount,
        amount: t.amount,
        ...(t.rate ? { rate: t.rate } : {}),
        ...(t.units !== undefined ? { units: t.units } : {}),
        ...(t.exemptUnits !== undefined ? { exemptUnits: t.exemptUnits } : {}),
        ...(t.rateCategory ? { rateCategory: t.rateCategory } : {}),
      };
    });
    if (priceMode === 'inclusive') net = amount.amountMinor - taxes.reduce((s, t) => s + t.amount.amountMinor, 0);
  } else if (code.tax_group) {
    const result = await deps.ports.tax.computeTaxes(tx, {
      propertyId: input.propertyId,
      lines: [
        {
          lineId: 'l1',
          chargeCode: code.code,
          chargeGroup: code.charge_group,
          taxGroup: code.tax_group,
          priceMode,
          amount,
          quantity: input.quantity ?? 1,
          serviceDate: input.serviceDate,
        },
      ],
      ...(input.occupancy ? { occupancy: input.occupancy } : {}),
      ...(input.target?.type === 'stay' ? { stayContext: { stayId: input.target.id } } : {}),
    });
    const line = result.lines.find((l) => l.lineId === 'l1');
    if (!line) throw new BusinessRuleError('tax_engine_error', 'The tax engine returned no result for this charge. Nothing was posted.');
    taxes = line.taxes;
    net = line.net.amountMinor;
    if (line.net.currency !== amount.currency || taxes.some((t) => t.amount.currency !== amount.currency)) {
      throw new BusinessRuleError('tax_engine_error', 'The tax engine answered in another currency. Nothing was posted.');
    }
    const sum = net + taxes.reduce((s, t) => s + t.amount.amountMinor, 0);
    const expected = priceMode === 'inclusive' ? amount.amountMinor : amount.amountMinor + (sum - net);
    if (sum !== expected || (priceMode === 'exclusive' && net !== amount.amountMinor)) {
      throw new BusinessRuleError(
        'tax_engine_error',
        'The tax engine result does not add up to the charge amount. Nothing was posted; report this to support.',
      );
    }
  }
  const components: Component[] = [{ kind: 'net' }, ...taxes.map((tax) => ({ kind: 'tax' as const, tax }))];
  return { components, amounts: [net, ...taxes.map((t) => t.amount.amountMinor)] };
}

async function lockEligibleAllowances(
  tx: TxContext,
  stayId: string,
  ref: 'auto' | string,
): Promise<Selectable<AllowanceInstancesTable>[]> {
  let q = db(tx).selectFrom('finance.allowance_instances').selectAll().where('stay_id', '=', stayId).where('status', '=', 'active');
  if (ref !== 'auto') q = q.where('id', '=', ref);
  return q.orderBy('valid_to').orderBy('id').forUpdate().execute();
}

/**
 * Post a charge (provider contract). Billing rules decide the folio when the target is a stay/booking/group;
 * taxes come from the tax engine; charge, taxes and allowance usage are one balanced journal entry; the
 * idempotency key makes retries harmless.
 */
export async function postCharge(tx: TxContext, deps: Deps, input: PostChargeInput): Promise<PostChargeResult> {
  requirePermission(tx, 'finance.posting.create', { propertyId: input.propertyId });
  if (!input.folioId === !input.target) {
    throw new ValidationError('charge_target_required', 'Give either a folio or a target (stay, booking or group).');
  }
  if (input.amount.amountMinor === 0 || !Number.isSafeInteger(input.amount.amountMinor)) {
    throw new ValidationError('invalid_amount', 'A charge needs a non-zero amount in whole minor units.');
  }
  const { idempotencyKey, ...rest } = input;
  const hash = requestHash(rest);
  const prior = await findEntryByKey(tx, idempotencyKey, hash);
  if (prior) return replayCharge(tx, prior);

  const mode = await deps.ports.platform.assertWritable(tx, input.propertyId, 'charges');
  if (mode === 'forward') {
    throw new BusinessRuleError(
      'charges_forwarding_unavailable',
      'Charges at this property are kept in another system. Forwarding charges to it is not connected yet, so post this charge in that system.',
    );
  }
  const property = await deps.ports.platform.getProperty(tx, input.propertyId);
  const businessDate = await deps.ports.platform.getBusinessDate(tx, input.propertyId);
  if (input.serviceDate > businessDate) {
    throw new ValidationError(
      'service_date_in_future',
      `The service date ${input.serviceDate} is after the business date ${businessDate}. Charges are posted when the service is provided; take a deposit for advance payments.`,
    );
  }
  if (input.serviceDate < businessDate && tx.actor.kind === 'user' && !input.reason?.trim()) {
    throw new ValidationError(
      'late_service_date_reason_required',
      `The service date ${input.serviceDate} is before today's business date ${businessDate}. Add a reason for the late posting.`,
    );
  }
  const code = await chargeCodeByCode(tx, input.propertyId, input.chargeCode);
  if (!code.active) {
    throw new BusinessRuleError('charge_code_inactive', `Charge code ${code.code} is no longer active. Use its replacement.`);
  }
  if (code.charge_group === 'allowance') {
    throw new BusinessRuleError(
      'allowance_code_not_postable',
      'Allowance codes are posted when an allowance is granted (package posting), not as ordinary charges.',
    );
  }
  if (code.restricted) requirePermission(tx, 'finance.posting.restrictedCodes', { propertyId: input.propertyId });

  // Destination and owner.
  let owner: { type: string; id: string };
  let base: FolioRow;
  let rules: RoutingRule[] = [];
  if (input.folioId) {
    base = await loadFolio(tx, input.folioId);
    assertSameProperty(base, input.propertyId);
    owner = { type: base.owner_type, id: base.owner_id };
  } else {
    owner = input.target as { type: string; id: string };
    base = await defaultFolio(tx, owner);
    assertSameProperty(base, input.propertyId);
    rules = await loadRules(tx, owner);
  }
  if (base.legal_entity_id !== property.legalEntityId) {
    throw new BusinessRuleError('intercompany_posting', 'The folio belongs to another legal entity than the property operator.');
  }
  const currency = base.currency;

  // Taxes (charge currency), then explicit conversion to the folio currency.
  const { components, amounts: chargeAmounts } = await computeComponents(tx, deps, input, code);
  let amounts = chargeAmounts;
  let fxRateId: string | null = null;
  if (input.amount.currency !== currency) {
    const r = await rateBetween(tx, property.legalEntityId, input.amount.currency, currency, businessDate);
    const gross = chargeAmounts.reduce((s, a) => s + a, 0);
    const converted = convert(money(gross, input.amount.currency), currency, r.rate).amountMinor;
    amounts = proportional(converted, chargeAmounts);
    fxRateId = r.rateId;
  }
  const gross = amounts.reduce((s, a) => s + a, 0);

  // Route (lock capped rules so concurrent charges cannot both use the same remaining limit).
  const groupOf = (c: string) => (c === code.code ? (code.charge_group as ChargeGroup) : undefined);
  const capped = rules.filter((r) => r.cap && r.cap.kind !== 'percent').map((r) => r.id);
  if (capped.length) {
    await db(tx).selectFrom('finance.billing_rules').select('id').where('id', 'in', capped).orderBy('id').forUpdate().execute();
  }
  const usageCache = new Map<string, number>();
  for (const r of rules) {
    const key = r.cap ? capPeriodKey(r.cap, input.serviceDate) : null;
    if (key) usageCache.set(`${r.id}|${key}`, await capUsage(tx, r.id, key));
  }
  const allocations = input.folioId
    ? [{ folioId: base.id, ruleId: null as string | null, grossMinor: gross, explanation: 'Posted to the selected folio' }]
    : routeCharge(
        rules,
        { chargeCode: code.code, chargeGroup: code.charge_group as ChargeGroup, serviceDate: input.serviceDate, grossMinor: gross },
        base.id,
        groupOf,
        (ruleId, key) => usageCache.get(`${ruleId}|${key}`) ?? 0,
      );
  const matrix = splitComponents(amounts, allocations.map((a) => a.grossMinor));

  // Claim the idempotency key before any state change.
  const claim = await claimEntry(tx, {
    legalEntityId: property.legalEntityId,
    propertyId: input.propertyId,
    entryType: 'charge',
    businessDate,
    idempotencyKey,
    requestHash: hash,
    source: input.sourceRef,
    description: input.description,
    ...(input.serviceDate < businessDate ? { reasonCode: 'late_posting' } : {}),
  });
  if (!claim.claimed) return replayCharge(tx, claim.entryId);

  // Prepare destination folios (reopen settled / supplementary for invoiced), flag post-departure.
  const departure = await ownerDeparture(tx, owner);
  const locked = await lockFolios(tx, allocations.map((a) => a.folioId));
  const destination = new Map<string, FolioRow>();
  for (const [id, f] of locked) {
    if (f.currency !== currency) {
      throw new BusinessRuleError('folio_currency_mismatch', 'A billing rule sends this charge to a folio in another currency. Fix the rule.');
    }
    const prepared = await prepareDestination(tx, f, departure ? 'late_charge' : 'new_charge');
    if (departure && !prepared.folio.post_departure) {
      await db(tx).updateTable('finance.folios').set({ post_departure: true, version: sql`version + 1` }).where('id', '=', prepared.folio.id).execute();
    }
    destination.set(id, prepared.folio);
  }

  // Allowance consumption (stay allowances only).
  const consumption: Array<{ instance: Selectable<AllowanceInstancesTable>; amount: number }> = [];
  if (input.allowanceRef && gross > 0 && owner.type === 'stay') {
    const instances = await lockEligibleAllowances(tx, owner.id, input.allowanceRef);
    let netLeft = amounts[0] ?? 0;
    let grossLeft = gross;
    for (const inst of instances) {
      const state = {
        id: inst.id,
        grantedMinor: Number(inst.granted_minor),
        usedMinor: Number(inst.used_minor),
        coversTaxes: inst.covers_taxes,
        validFrom: inst.valid_from,
        validTo: inst.valid_to,
        eligibleChargeCodes: inst.eligible_charge_codes,
        eligibleGroups: inst.eligible_groups,
        eligibleTags: inst.eligible_tags,
        status: inst.status,
      };
      if (inst.currency !== currency) continue;
      if (!isEligible(state, { chargeCode: code.code, chargeGroup: code.charge_group as ChargeGroup, tags: code.allowance_tags, serviceDate: input.serviceDate })) {
        if (input.allowanceRef !== 'auto') {
          throw new BusinessRuleError('allowance_not_eligible', `This charge is not covered by the allowance "${inst.label}".`);
        }
        continue;
      }
      const u = usageFor(state, { netMinor: netLeft, grossMinor: grossLeft });
      if (u > 0) {
        consumption.push({ instance: inst, amount: u });
        grossLeft -= u;
        netLeft = Math.max(0, netLeft - u);
      }
    }
  }

  // Build postings and lines.
  const postings: PostingDraft[] = [];
  const lines: Array<LineDraft & { accountId?: string }> = [];
  const revenueAccount = code.revenue_account_id ?? (await accountId(tx, deps, property.legalEntityId, revenueKeyForGroup(code.charge_group as ChargeGroup)));
  const allowanceAccount = consumption.length ? await accountId(tx, deps, property.legalEntityId, 'allowance_clearing') : null;
  const single = allocations.length === 1;
  const unitPrice = input.quantity && input.quantity > 0 ? Math.round(input.amount.amountMinor / input.quantity) : null;
  const usageQueue = consumption.map((c) => ({ ...c }));
  const totalTaxPerComponent = components.map((_, j) => amounts[j] ?? 0);
  for (let i = 0; i < allocations.length; i++) {
    const alloc = allocations[i] as (typeof allocations)[number];
    const row = matrix[i] as number[];
    const folio = destination.get(alloc.folioId) as FolioRow;
    const common = {
      folioId: folio.id,
      currency,
      serviceDate: input.serviceDate,
      revenueDate: input.revenueDate ?? input.serviceDate,
      chargeCodeId: code.id,
      chargeCode: code.code,
      billingRuleId: alloc.ruleId,
      source: input.sourceRef,
      postDeparture: !!departure,
      fxRateId,
    };
    const chargeIndex = postings.length;
    postings.push({
      ...common,
      kind: 'charge',
      amountMinor: row[0] ?? 0,
      description: input.description,
      quantity: input.quantity ?? null,
      unitPriceMinor: unitPrice,
      counterAccountId: revenueAccount,
      ...(single && fxRateId ? { originalAmountMinor: chargeAmounts[0] ?? 0, originalCurrency: input.amount.currency } : {}),
    });
    lines.push({ accountKey: 'guest_ledger', amountMinor: row[0] ?? 0, currency, subLedger: { type: 'folio', id: folio.id }, postingIndex: chargeIndex, chargeCode: code.code, serviceDate: input.serviceDate });
    lines.push({ accountKey: '', accountId: revenueAccount, amountMinor: -(row[0] ?? 0), currency, chargeCode: code.code, serviceDate: input.serviceDate, revenueDate: input.revenueDate ?? input.serviceDate });
    for (let j = 1; j < components.length; j++) {
      const comp = components[j] as Extract<Component, { kind: 'tax' }>;
      const amt = row[j] ?? 0;
      if (amt === 0) continue;
      const share = (totalTaxPerComponent[j] ?? 0) === 0 ? 0 : amt / (totalTaxPerComponent[j] as number);
      const taxAcct = await accountId(tx, deps, property.legalEntityId, taxAccountKey(comp.tax.accountKey));
      const idx = postings.length;
      postings.push({
        ...common,
        kind: 'tax',
        amountMinor: amt,
        description: comp.tax.name,
        parentIndex: chargeIndex,
        taxRuleId: comp.tax.ruleId,
        taxRuleVersionId: comp.tax.ruleVersionId,
        taxName: comp.tax.name,
        taxKind: comp.tax.kind,
        taxUnits: comp.tax.units !== undefined ? Math.round(comp.tax.units * share * 10_000) / 10_000 : null,
        taxExemptUnits: comp.tax.exemptUnits !== undefined ? Math.round(comp.tax.exemptUnits * share * 10_000) / 10_000 : null,
        taxRateCategory: comp.tax.rateCategory ?? null,
        taxRate: comp.tax.rate ?? null,
        counterAccountId: taxAcct,
      });
      lines.push({ accountKey: 'guest_ledger', amountMinor: amt, currency, subLedger: { type: 'folio', id: folio.id }, postingIndex: idx, chargeCode: code.code, serviceDate: input.serviceDate });
      lines.push({ accountKey: '', accountId: taxAcct, amountMinor: -amt, currency, chargeCode: code.code, serviceDate: input.serviceDate, memo: comp.tax.name });
    }
    // Allowance usage credits on this allocation, capped by its gross.
    let room = alloc.grossMinor;
    while (room > 0 && usageQueue.length > 0) {
      const head = usageQueue[0] as (typeof usageQueue)[number];
      const take = Math.min(room, head.amount);
      const idx = postings.length;
      postings.push({
        ...common,
        billingRuleId: null,
        kind: 'allowance_usage',
        amountMinor: -take,
        description: `${head.instance.label} — allowance used`,
        parentIndex: chargeIndex,
        allowanceInstanceId: head.instance.id,
        counterAccountId: allowanceAccount,
      });
      lines.push({ accountKey: 'guest_ledger', amountMinor: -take, currency, subLedger: { type: 'folio', id: folio.id }, postingIndex: idx });
      lines.push({ accountKey: '', accountId: allowanceAccount as string, amountMinor: take, currency, subLedger: { type: 'allowance', id: head.instance.id } });
      head.amount -= take;
      room -= take;
      if (head.amount === 0) usageQueue.shift();
    }
  }
  const postingIds = await writeEntryBody(tx, deps, claim.entryId, { legalEntityId: property.legalEntityId, propertyId: input.propertyId, businessDate, description: input.description }, postings, lines);

  for (const c of consumption) {
    const used = Number(c.instance.used_minor) + c.amount;
    await db(tx)
      .updateTable('finance.allowance_instances')
      .set({ used_minor: used, status: used >= Number(c.instance.granted_minor) ? 'consumed' : 'active', version: sql`version + 1` })
      .where('id', '=', c.instance.id)
      .execute();
  }

  const folioIds = [...new Set(postings.map((p) => p.folioId))];
  if (departure) {
    for (const folioId of folioIds) {
      const share = postings.filter((p) => p.folioId === folioId).reduce((s, p) => s + p.amountMinor, 0);
      const f = await loadFolio(tx, folioId);
      const collection = share > 0
        ? await deps.ports.payments.requestCollection(tx, {
            propertyId: input.propertyId,
            folioId,
            amount: money(share, currency),
            reason: 'late_charge',
            ref: { type: 'journal_entry', id: claim.entryId },
            idempotencyKey: `${idempotencyKey}:collect:${folioId}`,
          })
        : { status: 'not_possible' as const, detail: 'Nothing to collect' };
      await raiseException(tx, {
        propertyId: input.propertyId,
        kind: 'late_charge',
        severity: 'urgent',
        ref: { type: 'folio', id: folioId },
        message: `Charge "${input.description}" (${share} ${currency} minor units) was posted after departure to ${f.payer_name}'s folio. Collect payment from the guest or the card on file.`,
        details: {
          entryId: claim.entryId,
          departedOn: departure.departedOn,
          collection: collection.status,
          ...(collection.detail ? { collectionDetail: collection.detail } : {}),
        },
        businessDate,
      });
    }
  }

  const allowanceTotal = consumption.reduce((s, c) => s + c.amount, 0);
  await tx.audit({
    action: 'finance.posting.charge',
    target: { type: 'journal_entry', id: claim.entryId },
    propertyId: input.propertyId,
    ...(input.reason ? { reason: input.reason } : {}),
    after: { chargeCode: code.code, amount: input.amount, gross: money(gross, currency), folioIds, allocations, postDeparture: !!departure },
  });
  await tx.emit({
    type: 'finance.posting.created',
    propertyId: input.propertyId,
    aggregate: { type: 'journal_entry', id: claim.entryId },
    payload: {
      entryId: claim.entryId,
      kind: 'charge',
      postingIds,
      folioIds,
      chargeCode: code.code,
      gross: money(gross, currency),
      serviceDate: input.serviceDate,
      businessDate,
      sourceRef: input.sourceRef,
      postDeparture: !!departure,
    },
  });
  return {
    entryId: claim.entryId,
    postingIds,
    folioId: folioIds[0] as string,
    folioIds,
    allowanceUsage: allowanceTotal ? money(allowanceTotal, currency) : null,
    replayed: false,
  };
}

// ───────────────────────────── Payments & refunds (LedgerPort) ─────────────────────────────

export interface RecordPaymentInput {
  folioId: string;
  amount: Money;
  paymentRef: EntityRef;
  method: PaymentMethodKind;
  provider?: string;
  idempotencyKey: string;
  cashierSessionId?: string;
  reference?: string;
}

async function entryResult(tx: TxContext, entryId: string, replayed: boolean): Promise<EntryResult> {
  return { entryId, postingIds: await postingIdsOfEntry(tx, entryId), replayed };
}

/**
 * Record a confirmed payment on a folio (provider contract). Payments calls this only after the provider
 * confirmed the capture; cash is entered by a cashier in an open session. Never creates revenue.
 */
export async function recordPayment(tx: TxContext, deps: Deps, input: RecordPaymentInput): Promise<EntryResult & { postingId: string }> {
  const f0 = await loadFolio(tx, input.folioId);
  requirePermission(tx, 'finance.posting.create', { propertyId: f0.property_id });
  if (input.amount.amountMinor <= 0) throw new ValidationError('invalid_amount', 'A payment amount must be positive.');
  const { idempotencyKey, ...rest } = input;
  const hash = requestHash({ op: 'payment', ...rest });
  const prior = await findEntryByKey(tx, idempotencyKey, hash);
  if (prior) {
    const r = await entryResult(tx, prior, true);
    return { ...r, postingId: r.postingIds[0] as string };
  }
  await deps.ports.platform.assertWritable(tx, f0.property_id, 'charges');
  const businessDate = await deps.ports.platform.getBusinessDate(tx, f0.property_id);
  const sessionId = await openSessionFor(tx, f0.property_id, input.method, input.cashierSessionId);
  const claim = await claimEntry(tx, {
    legalEntityId: f0.legal_entity_id,
    propertyId: f0.property_id,
    entryType: 'payment',
    businessDate,
    idempotencyKey,
    requestHash: hash,
    source: input.paymentRef,
    description: `Payment (${input.method})${input.reference ? ` ${input.reference}` : ''}`,
  });
  if (!claim.claimed) {
    const r = await entryResult(tx, claim.entryId, true);
    return { ...r, postingId: r.postingIds[0] as string };
  }
  const locked = (await lockFolios(tx, [f0.id])).get(f0.id) as FolioRow;
  const { folio } = await prepareDestination(tx, locked, 'payment');
  const bridge = await bridgeLines(
    tx,
    deps,
    folio.legal_entity_id,
    businessDate,
    { ...clearingSide(input.method, input.provider ?? null, sessionId), amount: input.amount },
    { accountKey: 'guest_ledger', subLedger: { type: 'folio', id: folio.id }, postingIndex: 0, currency: folio.currency },
  );
  const clearing = await accountId(tx, deps, folio.legal_entity_id, clearingSide(input.method, input.provider ?? null, sessionId).accountKey);
  const [postingId] = await writeEntryBody(
    tx,
    deps,
    claim.entryId,
    { legalEntityId: folio.legal_entity_id, propertyId: folio.property_id, businessDate, description: 'Payment' },
    [
      {
        folioId: folio.id,
        kind: 'payment',
        amountMinor: -bridge.creditAmount.amountMinor,
        currency: folio.currency,
        description: `Payment — ${input.method.replace('_', ' ')}${input.reference ? ` (${input.reference})` : ''}`,
        paymentRef: input.paymentRef,
        paymentMethod: encodeMethod(input.method, input.provider),
        cashierSessionId: sessionId,
        counterAccountId: clearing,
        fxRateId: bridge.fxRateId,
        ...(input.amount.currency !== folio.currency ? { originalAmountMinor: -input.amount.amountMinor, originalCurrency: input.amount.currency } : {}),
      },
    ],
    bridge.lines,
  );
  if (sessionId) {
    if (input.method === 'cash') {
      await recordCashMovement(tx, { sessionId, kind: 'payment', amount: input.amount, entryId: claim.entryId, postingId: postingId as string, reference: input.reference ?? null });
    }
  }
  await tx.audit({
    action: 'finance.posting.payment',
    target: { type: 'folio', id: folio.id },
    propertyId: folio.property_id,
    after: { amount: input.amount, method: input.method, paymentRef: input.paymentRef, entryId: claim.entryId },
  });
  await tx.emit({
    type: 'finance.posting.created',
    propertyId: folio.property_id,
    aggregate: { type: 'journal_entry', id: claim.entryId },
    payload: { entryId: claim.entryId, kind: 'payment', postingIds: [postingId], folioIds: [folio.id], amount: input.amount, paymentRef: input.paymentRef, businessDate },
  });
  return { entryId: claim.entryId, postingIds: [postingId as string], postingId: postingId as string, replayed: false };
}

export interface RecordRefundInput {
  folioId: string;
  amount: Money;
  refundRef: EntityRef;
  originalPaymentRef: EntityRef;
  idempotencyKey: string;
  cashierSessionId?: string;
}

/** Record a confirmed refund as a new posting linked to the original payment (which stays unchanged). */
export async function recordRefund(tx: TxContext, deps: Deps, input: RecordRefundInput): Promise<EntryResult & { postingId: string }> {
  const f0 = await loadFolio(tx, input.folioId);
  requirePermission(tx, 'finance.posting.create', { propertyId: f0.property_id });
  if (input.amount.amountMinor <= 0) throw new ValidationError('invalid_amount', 'A refund amount must be positive.');
  const { idempotencyKey, ...rest } = input;
  const hash = requestHash({ op: 'refund', ...rest });
  const prior = await findEntryByKey(tx, idempotencyKey, hash);
  if (prior) {
    const r = await entryResult(tx, prior, true);
    return { ...r, postingId: r.postingIds[0] as string };
  }
  await deps.ports.platform.assertWritable(tx, f0.property_id, 'charges');
  const originals = await db(tx)
    .selectFrom('finance.postings')
    .selectAll()
    .where('payment_ref_type', '=', input.originalPaymentRef.type)
    .where('payment_ref_id', '=', input.originalPaymentRef.id)
    .where('kind', '=', 'payment')
    .orderBy('created_at')
    .execute();
  const original = originals[0];
  if (!original) {
    throw new BusinessRuleError(
      'original_payment_not_found',
      'The payment being refunded is not recorded in the ledger. Record or reconcile the original payment first.',
      { originalPaymentRef: input.originalPaymentRef },
    );
  }
  const tender = (p: { original_amount_minor: number | null; original_currency: string | null; amount_minor: number; currency: string }) =>
    p.original_currency ? { amount: Math.abs(Number(p.original_amount_minor)), currency: p.original_currency } : { amount: Math.abs(Number(p.amount_minor)), currency: p.currency };
  const paidTender = tender(original);
  if (paidTender.currency !== input.amount.currency) {
    throw new ValidationError('refund_currency_mismatch', `Refund in ${paidTender.currency}, the currency of the original payment.`);
  }
  const prior_refunds = await db(tx)
    .selectFrom('finance.postings')
    .selectAll()
    .where('corrects_posting_id', '=', original.id)
    .where('kind', '=', 'refund')
    .execute();
  const refunded = prior_refunds.reduce((s, p) => s + tender(p).amount, 0);
  if (refunded + input.amount.amountMinor > paidTender.amount) {
    throw new BusinessRuleError(
      'refund_exceeds_payment',
      `Only ${paidTender.amount - refunded} ${paidTender.currency} (minor units) of this payment can still be refunded.`,
      { paid: paidTender.amount, refunded },
    );
  }
  const { method, provider } = decodeMethod(original.payment_method);
  const businessDate = await deps.ports.platform.getBusinessDate(tx, f0.property_id);
  const sessionId = await openSessionFor(tx, f0.property_id, method, input.cashierSessionId);
  const claim = await claimEntry(tx, {
    legalEntityId: f0.legal_entity_id,
    propertyId: f0.property_id,
    entryType: 'refund',
    businessDate,
    idempotencyKey,
    requestHash: hash,
    source: input.refundRef,
    description: 'Refund',
  });
  if (!claim.claimed) {
    const r = await entryResult(tx, claim.entryId, true);
    return { ...r, postingId: r.postingIds[0] as string };
  }
  const locked = (await lockFolios(tx, [f0.id])).get(f0.id) as FolioRow;
  const { folio } = await prepareDestination(tx, locked, 'payment');
  const side = clearingSide(method, provider, sessionId);
  const bridge = await bridgeLines(tx, deps, folio.legal_entity_id, businessDate, { ...side, amount: input.amount }, {
    accountKey: 'guest_ledger',
    subLedger: { type: 'folio', id: folio.id },
    postingIndex: 0,
    currency: folio.currency,
  });
  const lines = bridge.lines.map((l) => ({
    ...l,
    amountMinor: -l.amountMinor,
    ...(l.functionalAmountMinor !== undefined ? { functionalAmountMinor: -l.functionalAmountMinor } : {}),
  }));
  const clearing = await accountId(tx, deps, folio.legal_entity_id, side.accountKey);
  const [postingId] = await writeEntryBody(
    tx,
    deps,
    claim.entryId,
    { legalEntityId: folio.legal_entity_id, propertyId: folio.property_id, businessDate, description: 'Refund' },
    [
      {
        folioId: folio.id,
        kind: 'refund',
        amountMinor: bridge.creditAmount.amountMinor,
        currency: folio.currency,
        description: `Refund — ${method.replace('_', ' ')}`,
        paymentRef: input.refundRef,
        paymentMethod: original.payment_method,
        correctsPostingId: original.id,
        cashierSessionId: sessionId,
        counterAccountId: clearing,
        fxRateId: bridge.fxRateId,
        ...(input.amount.currency !== folio.currency ? { originalAmountMinor: input.amount.amountMinor, originalCurrency: input.amount.currency } : {}),
      },
    ],
    lines,
  );
  if (sessionId && method === 'cash') {
    await recordCashMovement(tx, { sessionId, kind: 'refund', amount: money(-input.amount.amountMinor, input.amount.currency), entryId: claim.entryId, postingId: postingId as string });
  }
  await tx.audit({
    action: 'finance.posting.refund',
    target: { type: 'folio', id: folio.id },
    propertyId: folio.property_id,
    after: { amount: input.amount, refundRef: input.refundRef, originalPaymentRef: input.originalPaymentRef },
  });
  await tx.emit({
    type: 'finance.posting.created',
    propertyId: folio.property_id,
    aggregate: { type: 'journal_entry', id: claim.entryId },
    payload: { entryId: claim.entryId, kind: 'refund', postingIds: [postingId], folioIds: [folio.id], amount: input.amount, refundRef: input.refundRef, businessDate },
  });
  return { entryId: claim.entryId, postingIds: [postingId as string], postingId: postingId as string, replayed: false };
}

// ───────────────────────────── Transfers ─────────────────────────────

const TRANSFERABLE = ['charge', 'tax', 'adjustment', 'payment', 'refund', 'deposit_application', 'paid_out', 'allowance_usage', 'transfer_in'];

/** Move postings (or an amount) between two folios of the same legal entity — traceable on both sides. */
export async function transferPostings(
  tx: TxContext,
  deps: Deps,
  input: TransferInput & { idempotencyKey: string },
): Promise<EntryResult> {
  if (input.fromFolioId === input.toFolioId) throw new ValidationError('same_folio', 'Choose two different folios.');
  const from0 = await loadFolio(tx, input.fromFolioId);
  requirePermission(tx, 'finance.posting.transfer', { propertyId: from0.property_id });
  const { idempotencyKey, ...rest } = input;
  const hash = requestHash({ op: 'transfer', ...rest });
  const prior = await findEntryByKey(tx, idempotencyKey, hash);
  if (prior) return entryResult(tx, prior, true);
  await deps.ports.platform.assertWritable(tx, from0.property_id, 'charges');
  const to0 = await loadFolio(tx, input.toFolioId);
  if (to0.legal_entity_id !== from0.legal_entity_id) {
    throw new BusinessRuleError(
      'intercompany_transfer',
      'These folios belong to different legal entities. Transfers between legal entities are not supported; settle each folio separately.',
    );
  }
  if (to0.currency !== from0.currency) {
    throw new BusinessRuleError('transfer_currency_mismatch', 'Both folios must use the same currency for a transfer.');
  }
  const businessDate = await deps.ports.platform.getBusinessDate(tx, from0.property_id);
  const claim = await claimEntry(tx, {
    legalEntityId: from0.legal_entity_id,
    propertyId: from0.property_id,
    entryType: 'transfer',
    businessDate,
    idempotencyKey,
    requestHash: hash,
    description: `Transfer: ${input.reason}`,
    reasonCode: 'transfer',
  });
  if (!claim.claimed) return entryResult(tx, claim.entryId, true);
  const locked = await lockFolios(tx, [from0.id, to0.id]);
  const prepared: FolioRow[] = [];
  for (const id of [from0.id, to0.id]) {
    const f = locked.get(id) as FolioRow;
    if (f.status === 'closed' || f.status === 'voided') {
      throw new BusinessRuleError('folio_not_open', `Folio of ${f.payer_name} is ${f.status}; transfers need open folios.`);
    }
    prepared.push(await reopenInPlace(tx, f, 'transfer'));
  }
  const [from, to] = prepared as [FolioRow, FolioRow];
  const currency = from.currency;
  const pairs: Array<{ amount: number; original: Selectable<import('../tables').PostingsTable> | null; description: string }> = [];
  if (input.items) {
    const ids = input.items.map((i) => i.postingId);
    const rows = await db(tx)
      .selectFrom('finance.postings as p')
      .leftJoin('finance.posting_document_locks as l', 'l.posting_id', 'p.id')
      .selectAll('p')
      .select('l.document_id')
      .where('p.id', 'in', ids)
      .execute();
    const children = await db(tx)
      .selectFrom('finance.postings')
      .selectAll()
      .where('parent_posting_id', 'in', ids)
      .where('kind', '=', 'tax')
      .execute();
    for (const item of input.items) {
      const p = rows.find((r) => r.id === item.postingId);
      if (!p || p.folio_id !== from.id) {
        throw new ValidationError('posting_not_on_folio', 'Every selected posting must be on the source folio.', { postingId: item.postingId });
      }
      if (p.document_id) {
        throw new BusinessRuleError('posting_invoiced', `"${p.description}" is on an issued invoice and cannot be moved. Issue a credit note first.`);
      }
      if (!TRANSFERABLE.includes(p.kind)) {
        throw new BusinessRuleError('posting_not_transferable', `Postings of kind ${p.kind} cannot be transferred.`);
      }
      // A charge moves with its taxes; partial amounts are split proportionally across charge and taxes.
      const group = p.kind === 'charge' ? [p, ...children.filter((c) => c.parent_posting_id === p.id)] : [p];
      const remaining = [];
      for (const g of group) {
        const moved = await db(tx)
          .selectFrom('finance.postings')
          .select(sql<number>`coalesce(sum(amount_minor), 0)::bigint`.as('m'))
          .where('corrects_posting_id', '=', g.id)
          .where('kind', 'in', ['transfer_out', 'adjustment'])
          .where('folio_id', '=', from.id)
          .executeTakeFirstOrThrow();
        remaining.push(Number(g.amount_minor) + Number(moved.m));
      }
      const groupRemaining = remaining.reduce((s, v) => s + v, 0);
      const want = item.amountMinor === undefined ? groupRemaining : Math.sign(groupRemaining) * item.amountMinor;
      if (groupRemaining === 0 || Math.abs(want) > Math.abs(groupRemaining)) {
        throw new BusinessRuleError('transfer_exceeds_posting', `Only ${groupRemaining} (minor units) of "${p.description}" remain on this folio.`);
      }
      const split = splitComponents(remaining, [want, groupRemaining - want])[0] as number[];
      group.forEach((g, k) => {
        if ((split[k] ?? 0) !== 0) pairs.push({ amount: split[k] as number, original: g, description: g.description });
      });
    }
  } else {
    pairs.push({ amount: input.amountMinor as number, original: null, description: 'Balance transfer' });
  }
  const postings: PostingDraft[] = [];
  const lines: Array<LineDraft & { accountId?: string }> = [];
  for (const pr of pairs) {
    const outIdx = postings.length;
    const base = {
      currency,
      chargeCodeId: pr.original?.charge_code_id ?? null,
      chargeCode: pr.original?.charge_code ?? null,
      serviceDate: pr.original?.service_date ?? null,
      revenueDate: pr.original?.revenue_date ?? null,
      correctsPostingId: pr.original?.id ?? null,
      taxName: pr.original?.tax_name ?? null,
    };
    postings.push({ ...base, folioId: from.id, kind: 'transfer_out', amountMinor: -pr.amount, description: `${pr.description} → ${to.payer_name}`, peerIndex: outIdx + 1 });
    postings.push({ ...base, folioId: to.id, kind: 'transfer_in', amountMinor: pr.amount, description: `${pr.description} ← ${from.payer_name}`, peerIndex: outIdx });
    lines.push({ accountKey: 'guest_ledger', amountMinor: -pr.amount, currency, subLedger: { type: 'folio', id: from.id }, postingIndex: outIdx });
    lines.push({ accountKey: 'guest_ledger', amountMinor: pr.amount, currency, subLedger: { type: 'folio', id: to.id }, postingIndex: outIdx + 1 });
  }
  const postingIds = await writeEntryBody(tx, deps, claim.entryId, { legalEntityId: from.legal_entity_id, propertyId: from.property_id, businessDate, description: 'Transfer' }, postings, lines);
  await tx.audit({
    action: 'finance.posting.transfer',
    target: { type: 'folio', id: from.id },
    propertyId: from.property_id,
    reason: input.reason,
    after: { toFolioId: to.id, pairs: pairs.map((p) => ({ amount: p.amount, postingId: p.original?.id ?? null })) },
  });
  await tx.emit({
    type: 'finance.postings.transferred',
    propertyId: from.property_id,
    aggregate: { type: 'journal_entry', id: claim.entryId },
    payload: { entryId: claim.entryId, fromFolioId: from.id, toFolioId: to.id, total: pairs.reduce((s, p) => s + p.amount, 0), currency },
  });
  return { entryId: claim.entryId, postingIds, replayed: false };
}

// ───────────────────────────── Corrections ─────────────────────────────

export interface AdjustPostingInput {
  postingId: string;
  /** Positive gross amount to take off (charge + its taxes); omit for the full remaining amount. */
  amountMinor?: number;
  reasonCode: string;
  note: string;
  idempotencyKey: string;
  /** Internal: credit notes may adjust invoiced postings (the credit note is the sanctioned path). */
  allowInvoiced?: boolean;
}

/**
 * Correct a charge with a linked adjustment entry (never by changing the original). Taxes and allowance usage
 * are reversed proportionally; corrections to an earlier business date are recorded as restatements.
 */
export async function adjustPosting(tx: TxContext, deps: Deps, input: AdjustPostingInput): Promise<EntryResult> {
  const p = await db(tx).selectFrom('finance.postings').selectAll().where('id', '=', input.postingId).executeTakeFirst();
  if (!p) throw new ValidationError('posting_not_found', 'The posting to correct was not found.');
  requirePermission(tx, 'finance.posting.correct', { propertyId: p.property_id });
  if (p.kind !== 'charge') {
    throw new BusinessRuleError(
      'posting_not_adjustable',
      'Only charges can be adjusted. Payments are corrected by refunds; transfers by a transfer back.',
    );
  }
  const { idempotencyKey, allowInvoiced, ...rest } = input;
  const hash = requestHash({ op: 'adjust', ...rest });
  const prior = await findEntryByKey(tx, idempotencyKey, hash);
  if (prior) return entryResult(tx, prior, true);
  await deps.ports.platform.assertWritable(tx, p.property_id, 'charges');
  if (!allowInvoiced) {
    const lock = await db(tx).selectFrom('finance.posting_document_locks').select('document_id').where('posting_id', '=', p.id).executeTakeFirst();
    if (lock) {
      throw new BusinessRuleError(
        'posting_invoiced',
        'This charge is on an issued invoice. Issue a credit note (it corrects the charge and keeps the invoice intact).',
        { documentId: lock.document_id },
      );
    }
  }
  const family = [
    p,
    ...(await db(tx).selectFrom('finance.postings').selectAll().where('parent_posting_id', '=', p.id).where('kind', 'in', ['tax', 'allowance_usage']).orderBy('created_at').orderBy('id').execute()),
  ];
  const chargeFamily = family.filter((f) => f.kind !== 'allowance_usage');
  const usageFamily = family.filter((f) => f.kind === 'allowance_usage');
  const remainingOf = async (id: string, amount: number) => {
    const r = await db(tx)
      .selectFrom('finance.postings')
      .select(sql<number>`coalesce(sum(amount_minor), 0)::bigint`.as('m'))
      .where('corrects_posting_id', '=', id)
      .where('kind', 'in', ['adjustment', 'transfer_out'])
      .where('folio_id', '=', p.folio_id)
      .executeTakeFirstOrThrow();
    return amount + Number(r.m);
  };
  const remaining = [];
  for (const f of chargeFamily) remaining.push(await remainingOf(f.id, Number(f.amount_minor)));
  const total = remaining.reduce((s, v) => s + v, 0);
  if (total === 0) throw new BusinessRuleError('posting_already_corrected', 'This charge has already been fully corrected or moved.');
  const want = input.amountMinor === undefined ? total : Math.sign(total) * input.amountMinor;
  if (Math.abs(want) > Math.abs(total)) {
    throw new BusinessRuleError('adjustment_exceeds_posting', `At most ${Math.abs(total)} (minor units) of this charge can still be adjusted.`);
  }
  const part = splitComponents(remaining, [want, total - want])[0] as number[];
  const usageRemaining = [];
  for (const u of usageFamily) usageRemaining.push(await remainingOf(u.id, Number(u.amount_minor)));
  const usageTotal = usageRemaining.reduce((s, v) => s + v, 0);
  const usageBack = usageTotal === 0 ? 0 : Math.round((usageTotal * want) / total);
  const usagePart = usageBack === 0 ? usageRemaining.map(() => 0) : (splitComponents(usageRemaining, [usageBack, usageTotal - usageBack])[0] as number[]);

  const businessDate = await deps.ports.platform.getBusinessDate(tx, p.property_id);
  const claim = await claimEntry(tx, {
    legalEntityId: p.legal_entity_id,
    propertyId: p.property_id,
    entryType: 'adjustment',
    businessDate,
    idempotencyKey,
    requestHash: hash,
    correctsEntryId: p.entry_id,
    relatesToBusinessDate: p.business_date !== businessDate ? p.business_date : null,
    sameDayCorrection: p.business_date === businessDate,
    reasonCode: input.reasonCode,
    description: `Correction of "${p.description}": ${input.note}`,
  });
  if (!claim.claimed) return entryResult(tx, claim.entryId, true);
  const locked = (await lockFolios(tx, [p.folio_id])).get(p.folio_id) as FolioRow;
  if (locked.status === 'closed' && !allowInvoiced) {
    throw new BusinessRuleError('folio_not_open', 'The folio is closed. Corrections go through a credit note.');
  }
  await reopenInPlace(tx, locked, allowInvoiced ? 'credit_note' : 'correction');
  const postings: PostingDraft[] = [];
  const lines: Array<LineDraft & { accountId?: string }> = [];
  const push = (orig: (typeof family)[number], amount: number, subLedger: LineDraft['subLedger'] = null) => {
    if (amount === 0) return;
    const idx = postings.length;
    postings.push({
      folioId: orig.folio_id,
      kind: 'adjustment',
      amountMinor: -amount,
      currency: orig.currency,
      description: `Correction: ${orig.description} (${input.reasonCode})`,
      chargeCodeId: orig.charge_code_id,
      chargeCode: orig.charge_code,
      taxRuleId: orig.tax_rule_id,
      taxRuleVersionId: orig.tax_rule_version_id,
      taxName: orig.tax_name,
      taxKind: (orig.tax_kind as PostingDraft['taxKind']) ?? null,
      taxUnits: orig.tax_units !== null && Number(orig.amount_minor) !== 0 ? -Math.round((Number(orig.tax_units) * amount * 10_000) / Number(orig.amount_minor)) / 10_000 : null,
      taxRateCategory: orig.tax_rate_category,
      taxRate: orig.tax_rate,
      serviceDate: orig.service_date,
      revenueDate: orig.revenue_date,
      correctsPostingId: orig.id,
      billingRuleId: orig.billing_rule_id,
      allowanceInstanceId: orig.allowance_instance_id,
      counterAccountId: orig.counter_account_id,
      postDeparture: orig.post_departure,
    });
    lines.push({ accountKey: 'guest_ledger', amountMinor: -amount, currency: orig.currency, subLedger: { type: 'folio', id: orig.folio_id }, postingIndex: idx });
    lines.push({ accountKey: '', accountId: orig.counter_account_id as string, amountMinor: amount, currency: orig.currency, subLedger, chargeCode: orig.charge_code, serviceDate: orig.service_date, revenueDate: orig.revenue_date });
  };
  chargeFamily.forEach((f, k) => push(f, part[k] ?? 0));
  for (let k = 0; k < usageFamily.length; k++) {
    const u = usageFamily[k] as (typeof usageFamily)[number];
    const amt = usagePart[k] ?? 0;
    if (amt === 0) continue;
    const inst = await db(tx).selectFrom('finance.allowance_instances').selectAll().where('id', '=', u.allowance_instance_id as string).forUpdate().executeTakeFirstOrThrow();
    if (inst.status === 'closed' || inst.status === 'cancelled') {
      throw new BusinessRuleError(
        'allowance_period_closed',
        `The allowance "${inst.label}" used by this charge is already closed. Correct the charge with a manual posting reviewed by finance.`,
      );
    }
    push(u, amt, { type: 'allowance', id: inst.id });
    const used = Number(inst.used_minor) + amt; // amt is negative (usage credits are negative)
    await db(tx).updateTable('finance.allowance_instances').set({ used_minor: used, status: 'active', version: sql`version + 1` }).where('id', '=', inst.id).execute();
  }
  const postingIds = await writeEntryBody(tx, deps, claim.entryId, { legalEntityId: p.legal_entity_id, propertyId: p.property_id, businessDate, description: 'Correction' }, postings, lines);
  await tx.audit({
    action: 'finance.posting.correct',
    target: { type: 'posting', id: p.id },
    propertyId: p.property_id,
    reason: `${input.reasonCode}: ${input.note}`,
    before: { amount: total },
    after: { adjustedBy: -want, entryId: claim.entryId, restatementOf: p.business_date !== businessDate ? p.business_date : null },
  });
  await tx.emit({
    type: 'finance.posting.adjusted',
    propertyId: p.property_id,
    aggregate: { type: 'journal_entry', id: claim.entryId },
    payload: { entryId: claim.entryId, postingId: p.id, amountMinor: -want, reasonCode: input.reasonCode, relatesToBusinessDate: p.business_date },
  });
  return { entryId: claim.entryId, postingIds, replayed: false };
}

/** Collect several tenders (split tender) at the desk in one command: cash, bank transfer, cheque, other. */
export async function collectPayment(
  tx: TxContext,
  deps: Deps,
  input: { folioId: string; tenders: Array<{ method: 'cash' | 'bank_transfer' | 'cheque' | 'other'; amount: Money; reference?: string }>; idempotencyKey: string },
): Promise<{ entries: Array<EntryResult & { postingId: string }>; balance: Money }> {
  const f = await loadFolio(tx, input.folioId);
  requirePermission(tx, 'finance.cashier.operate', { propertyId: f.property_id });
  const entries = [];
  for (let i = 0; i < input.tenders.length; i++) {
    const t = input.tenders[i] as (typeof input.tenders)[number];
    entries.push(
      await recordPayment(tx, deps, {
        folioId: input.folioId,
        amount: t.amount,
        method: t.method,
        paymentRef: { type: 'desk_tender', id: `${input.idempotencyKey}:${i}` },
        idempotencyKey: `${input.idempotencyKey}:${i}`,
        ...(t.reference ? { reference: t.reference } : {}),
      }),
    );
  }
  return { entries, balance: money(await folioBalance(tx, input.folioId), f.currency) };
}
