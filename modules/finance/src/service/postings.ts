import { type Selectable, sql, type TxContext, withSavepoint } from '@portico/db';
import {
  BusinessRuleError,
  ConflictError,
  convert,
  Decimal,
  DomainError,
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
import type { LineDraft, SubLedgerType } from '../domain/ledger';
import { capPeriodKey, type RoutingRule, routeCharge } from '../domain/routing';
import { proportional, splitComponents } from '../domain/split';
import { fromRatesTaxLine, normalizeLedgerKey, type PostingTax } from '../domain/tax-map';
import type { ChargeGroup, PaymentMethodKind, RuleCap, RuleSelector } from '../domain/types';
import type { AllowanceInstancesTable, ChargeCodesTable } from '../tables';
import { assertSameProperty, defaultFolio, prepareDestination, reopenInPlace } from './folios';
import { chargeCodeByCode, chargeGroupMap } from './setup';
import {
  accountId,
  claimEntry,
  type Deps,
  db,
  type FolioRow,
  findEntryByKey,
  folioBalance,
  isUniqueViolation,
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

type Component = { kind: 'net' } | { kind: 'tax'; tax: PostingTax };

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
      ? {
          amountMinor: -usage.reduce((s, r) => s + Number(r.amount_minor), 0),
          currency: usage[0]?.currency as string,
        }
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
  // Usage follows the rule's lineage: a rule re-applied by a successor keeps what its predecessors already paid.
  const { rows } = await sql<{ used: string }>`
    with recursive lineage(id) as (
      select ${ruleId}::uuid
      union all
      select r.supersedes_rule_id from finance.billing_rules r join lineage l on r.id = l.id
       where r.supersedes_rule_id is not null
    )
    select coalesce(sum(p.amount_minor), 0)::bigint as used
      from finance.postings p
     where p.billing_rule_id in (select id from lineage)
       and p.kind in ('charge', 'tax', 'adjustment')
       and (${periodKey} = 'stay' or p.service_date = ${periodKey === 'stay' ? null : periodKey}::date)`.execute(
    tx.db,
  );
  return Number(rows[0]?.used ?? 0);
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
  let taxes: PostingTax[] = [];
  if (taxMode === 'provided') {
    if (tx.actor.kind === 'user') {
      throw new ValidationError(
        'provided_taxes_not_allowed',
        'Staff postings always use the tax engine. Provided tax lines are accepted only from trusted integrations (channel prepaid totals, verified POS).',
      );
    }
    for (const t of input.taxLines ?? []) {
      if (t.amount.currency !== amount.currency) {
        throw new ValidationError(
          'tax_currency_mismatch',
          'Provided tax lines must be in the charge currency.',
        );
      }
      // Provided taxes may only post to tax accounts that already exist in the chart (no accounts made up by callers).
      const key = normalizeLedgerKey(t.accountKey);
      const exists = await db(tx)
        .selectFrom('finance.accounts')
        .select('id')
        .where('system_key', '=', `tax:${key}`)
        .executeTakeFirst();
      if (!exists) {
        throw new ValidationError(
          'unknown_tax_account',
          `Provided tax "${t.name}" maps to "${t.accountKey}", which is not a tax account in the chart. Map it first.`,
        );
      }
      taxes.push({
        lineId: 'l1',
        ruleId: t.ruleId,
        ruleVersionId: t.ruleVersionId,
        name: t.name,
        kind: t.kind ?? 'tax',
        accountKey: key,
        amount: t.amount,
        statutory: true,
        valueBased: (t.kind ?? 'tax') !== 'fee',
        ...(t.rate ? { rate: t.rate } : {}),
        ...(t.units !== undefined ? { units: t.units } : {}),
        ...(t.exemptUnits !== undefined ? { exemptUnits: t.exemptUnits } : {}),
        ...(t.rateCategory ? { rateCategory: t.rateCategory } : {}),
      });
    }
    if (priceMode === 'inclusive')
      net = amount.amountMinor - taxes.reduce((s, t) => s + t.amount.amountMinor, 0);
  } else if (code.tax_group) {
    const quantity =
      input.quantity && Number.isInteger(input.quantity) && input.quantity >= 1 ? input.quantity : 1;
    const result = await deps.ports.tax.computeTaxesDetailed(tx, {
      propertyId: input.propertyId,
      lines: [
        {
          lineId: 'l1',
          chargeCode: code.code,
          taxCategory: code.tax_group,
          amount,
          quantity,
          serviceDate: input.serviceDate,
          taxInclusion: { mode: priceMode },
          ...(amount.amountMinor < 0 ? { adjustment: 'price_adjustment' as const } : {}),
          ...(input.occupancy
            ? {
                occupancy: {
                  adults: input.occupancy.adults,
                  childrenAges: [...input.occupancy.childrenAges],
                },
              }
            : {}),
        },
      ],
    });
    const line = result.lines.find((l) => l.lineId === 'l1');
    if (!line)
      throw new BusinessRuleError(
        'tax_engine_error',
        'The tax engine returned no result for this charge. Nothing was posted.',
      );
    taxes = line.taxes.map(fromRatesTaxLine);
    net = line.net.amountMinor;
    if (line.net.currency !== amount.currency || taxes.some((t) => t.amount.currency !== amount.currency)) {
      throw new BusinessRuleError(
        'tax_engine_error',
        'The tax engine answered in another currency. Nothing was posted.',
      );
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
  let q = db(tx)
    .selectFrom('finance.allowance_instances')
    .selectAll()
    .where('stay_id', '=', stayId)
    .where('status', '=', 'active');
  if (ref !== 'auto') q = q.where('id', '=', ref);
  return q.orderBy('valid_to').orderBy('id').forUpdate().execute();
}

/**
 * Post a charge (provider contract). Billing rules decide the folio when the target is a stay/booking/group;
 * taxes come from the tax engine; charge, taxes and allowance usage are one balanced journal entry; the
 * idempotency key makes retries harmless.
 */
export async function postCharge(
  tx: TxContext,
  deps: Deps,
  input: PostChargeInput,
): Promise<PostChargeResult> {
  requirePermission(tx, 'finance.posting.create', { propertyId: input.propertyId });
  if (!input.folioId === !input.target) {
    throw new ValidationError(
      'charge_target_required',
      'Give either a folio or a target (stay, booking or group).',
    );
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
    throw new BusinessRuleError(
      'charge_code_inactive',
      `Charge code ${code.code} is no longer active. Use its replacement.`,
    );
  }
  if (code.charge_group === 'allowance') {
    throw new BusinessRuleError(
      'allowance_code_not_postable',
      'Allowance codes are posted when an allowance is granted (package posting), not as ordinary charges.',
    );
  }
  if (code.restricted)
    requirePermission(tx, 'finance.posting.restrictedCodes', { propertyId: input.propertyId });

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
    throw new BusinessRuleError(
      'intercompany_posting',
      'The folio belongs to another legal entity than the property operator.',
    );
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
  // Rules are compared against every charge code's group (ADR-0016 §1), not only the posted code's.
  const groupMap = rules.length ? await chargeGroupMap(tx, input.propertyId) : new Map<string, ChargeGroup>();
  const groupOf = (c: string) => groupMap.get(c);
  const capped = rules.filter((r) => r.cap && r.cap.kind !== 'percent').map((r) => r.id);
  if (capped.length) {
    await db(tx)
      .selectFrom('finance.billing_rules')
      .select('id')
      .where('id', 'in', capped)
      .orderBy('id')
      .forUpdate()
      .execute();
  }
  const usageCache = new Map<string, number>();
  for (const r of rules) {
    const key = r.cap ? capPeriodKey(r.cap, input.serviceDate) : null;
    if (key) usageCache.set(`${r.id}|${key}`, await capUsage(tx, r.id, key));
  }
  const allocations = input.folioId
    ? [
        {
          folioId: base.id,
          ruleId: null as string | null,
          grossMinor: gross,
          explanation: 'Posted to the selected folio',
        },
      ]
    : routeCharge(
        rules,
        {
          chargeCode: code.code,
          chargeGroup: code.charge_group as ChargeGroup,
          serviceDate: input.serviceDate,
          grossMinor: gross,
        },
        base.id,
        groupOf,
        (ruleId, key) => usageCache.get(`${ruleId}|${key}`) ?? 0,
      );
  const matrix = splitComponents(
    amounts,
    allocations.map((a) => a.grossMinor),
  );

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
  const locked = await lockFolios(
    tx,
    allocations.map((a) => a.folioId),
  );
  const destination = new Map<string, FolioRow>();
  for (const [id, f] of locked) {
    if (f.currency !== currency) {
      throw new BusinessRuleError(
        'folio_currency_mismatch',
        'A billing rule sends this charge to a folio in another currency. Fix the rule.',
      );
    }
    const prepared = await prepareDestination(tx, f, departure ? 'late_charge' : 'new_charge');
    if (departure && !prepared.folio.post_departure) {
      await db(tx)
        .updateTable('finance.folios')
        .set({ post_departure: true, version: sql`version + 1` })
        .where('id', '=', prepared.folio.id)
        .execute();
    }
    destination.set(id, prepared.folio);
  }

  // Allowance consumption (stay allowances only). A block per instance: [net covered, tax relief per component].
  // taxed_at_grant (ADR-0016 §5): the package already charged tax on the allowance, so the covered consumption's
  // value-based taxes are relieved (no tax charged twice). prepayment: the credit pays the gross like a payment.
  const blocks: Array<{ instance: Selectable<AllowanceInstancesTable>; comps: number[] }> = [];
  if (input.allowanceRef && gross > 0 && owner.type === 'stay') {
    const instances = await lockEligibleAllowances(tx, owner.id, input.allowanceRef);
    let netLeft = amounts[0] ?? 0;
    let grossLeft = gross;
    const taxLeft = amounts.slice(1);
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
      if (
        !isEligible(state, {
          chargeCode: code.code,
          chargeGroup: code.charge_group as ChargeGroup,
          tags: code.allowance_tags,
          serviceDate: input.serviceDate,
        })
      ) {
        if (input.allowanceRef !== 'auto') {
          throw new BusinessRuleError(
            'allowance_not_eligible',
            `This charge is not covered by the allowance "${inst.label}".`,
          );
        }
        continue;
      }
      if (inst.tax_treatment === 'taxed_at_grant') {
        const u = Math.max(0, Math.min(netLeft, state.grantedMinor - state.usedMinor));
        if (u <= 0) continue;
        const reliefs = components.slice(1).map((c, k) => {
          const tax = (c as Extract<Component, { kind: 'tax' }>).tax;
          if (!tax.valueBased || (amounts[0] ?? 0) === 0) return 0;
          const r = new Decimal(amounts[k + 1] ?? 0)
            .mul(u)
            .div(amounts[0] as number)
            .toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
            .toNumber();
          return Math.min(r, taxLeft[k] ?? 0);
        });
        reliefs.forEach((r, k) => {
          taxLeft[k] = (taxLeft[k] ?? 0) - r;
        });
        blocks.push({ instance: inst, comps: [u, ...reliefs] });
        netLeft -= u;
        grossLeft -= u + reliefs.reduce((x, y) => x + y, 0);
      } else {
        const u = usageFor(state, { netMinor: netLeft, grossMinor: grossLeft });
        if (u <= 0) continue;
        blocks.push({ instance: inst, comps: [u, ...components.slice(1).map(() => 0)] });
        grossLeft -= u;
        netLeft = Math.max(0, netLeft - u);
      }
    }
  }

  // Build postings and lines.
  const postings: PostingDraft[] = [];
  const lines: Array<LineDraft & { accountId?: string }> = [];
  const revenueAccount =
    code.revenue_account_id ??
    (await accountId(tx, deps, property.legalEntityId, revenueKeyForGroup(code.charge_group as ChargeGroup)));
  const allowanceAccount = blocks.length
    ? await accountId(tx, deps, property.legalEntityId, 'allowance_clearing')
    : null;
  const single = allocations.length === 1;
  const unitPrice =
    input.quantity && input.quantity > 0 ? Math.round(input.amount.amountMinor / input.quantity) : null;
  const usageQueue = blocks.map((b) => ({ instance: b.instance, comps: [...b.comps] }));
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
      ...(single && fxRateId
        ? { originalAmountMinor: chargeAmounts[0] ?? 0, originalCurrency: input.amount.currency }
        : {}),
    });
    lines.push({
      accountKey: 'guest_ledger',
      amountMinor: row[0] ?? 0,
      currency,
      subLedger: { type: 'folio', id: folio.id },
      postingIndex: chargeIndex,
      chargeCode: code.code,
      serviceDate: input.serviceDate,
    });
    lines.push({
      accountKey: '',
      accountId: revenueAccount,
      amountMinor: -(row[0] ?? 0),
      currency,
      chargeCode: code.code,
      serviceDate: input.serviceDate,
      revenueDate: input.revenueDate ?? input.serviceDate,
    });
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
        taxExemptUnits:
          comp.tax.exemptUnits !== undefined
            ? Math.round(comp.tax.exemptUnits * share * 10_000) / 10_000
            : null,
        taxRateCategory: comp.tax.rateCategory ?? null,
        taxRate: comp.tax.rate ?? null,
        counterAccountId: taxAcct,
      });
      lines.push({
        accountKey: 'guest_ledger',
        amountMinor: amt,
        currency,
        subLedger: { type: 'folio', id: folio.id },
        postingIndex: idx,
        chargeCode: code.code,
        serviceDate: input.serviceDate,
      });
      lines.push({
        accountKey: '',
        accountId: taxAcct,
        amountMinor: -amt,
        currency,
        chargeCode: code.code,
        serviceDate: input.serviceDate,
        memo: comp.tax.name,
      });
    }
    // Allowance cover on this allocation, capped by its gross; a block that does not fit is split exactly.
    let room = alloc.grossMinor;
    while (room > 0 && usageQueue.length > 0) {
      const head = usageQueue[0] as (typeof usageQueue)[number];
      const total = head.comps.reduce((x, y) => x + y, 0);
      const take = Math.min(room, total);
      const part =
        take === total ? head.comps : (splitComponents(head.comps, [take, total - take])[0] as number[]);
      const taxedAtGrant = head.instance.tax_treatment === 'taxed_at_grant';
      for (let j = 0; j < part.length; j++) {
        const amt = part[j] ?? 0;
        if (amt === 0) continue;
        const idx = postings.length;
        if (j === 0) {
          postings.push({
            ...common,
            billingRuleId: null,
            kind: 'allowance_usage',
            originKind: taxedAtGrant ? 'charge' : 'allowance_usage',
            amountMinor: -amt,
            description: `${head.instance.label} — covered by the package allowance`,
            parentIndex: chargeIndex,
            allowanceInstanceId: head.instance.id,
            counterAccountId: allowanceAccount,
          });
          lines.push({
            accountKey: 'guest_ledger',
            amountMinor: -amt,
            currency,
            subLedger: { type: 'folio', id: folio.id },
            postingIndex: idx,
          });
          lines.push({
            accountKey: '',
            accountId: allowanceAccount as string,
            amountMinor: amt,
            currency,
            subLedger: { type: 'allowance', id: head.instance.id },
          });
        } else {
          const tax = (components[j] as Extract<Component, { kind: 'tax' }>).tax;
          const taxAcct = await accountId(tx, deps, property.legalEntityId, taxAccountKey(tax.accountKey));
          postings.push({
            ...common,
            billingRuleId: null,
            kind: 'allowance_usage',
            originKind: 'tax',
            amountMinor: -amt,
            description: `${tax.name} — already charged with the package`,
            parentIndex: chargeIndex,
            allowanceInstanceId: head.instance.id,
            taxRuleId: tax.ruleId,
            taxRuleVersionId: tax.ruleVersionId,
            taxName: tax.name,
            taxKind: tax.kind,
            taxRate: tax.rate ?? null,
            counterAccountId: taxAcct,
          });
          lines.push({
            accountKey: 'guest_ledger',
            amountMinor: -amt,
            currency,
            subLedger: { type: 'folio', id: folio.id },
            postingIndex: idx,
          });
          lines.push({
            accountKey: '',
            accountId: taxAcct,
            amountMinor: amt,
            currency,
            memo: `${tax.name} relief (package allowance)`,
          });
        }
      }
      if (take === total) usageQueue.shift();
      else head.comps = head.comps.map((c, k) => c - (part[k] ?? 0));
      room -= take;
    }
  }
  const postingIds = await writeEntryBody(
    tx,
    deps,
    claim.entryId,
    {
      legalEntityId: property.legalEntityId,
      propertyId: input.propertyId,
      businessDate,
      description: input.description,
    },
    postings,
    lines,
  );

  for (const b of blocks) {
    const used = Number(b.instance.used_minor) + (b.comps[0] ?? 0);
    await db(tx)
      .updateTable('finance.allowance_instances')
      .set({
        used_minor: used,
        status: used >= Number(b.instance.granted_minor) ? 'consumed' : 'active',
        version: sql`version + 1`,
      })
      .where('id', '=', b.instance.id)
      .execute();
  }

  const folioIds = [...new Set(postings.map((p) => p.folioId))];
  if (departure) {
    for (const folioId of folioIds) {
      const share = postings.filter((p) => p.folioId === folioId).reduce((s, p) => s + p.amountMinor, 0);
      const f = await loadFolio(tx, folioId);
      // A refused or failed collection request never loses the late charge (ADR-0015 §6): it is listed instead.
      const collection: { status: string; detail?: string } =
        share > 0
          ? await withSavepoint(tx, 'finance_collection', () =>
              deps.ports.payments.requestCollection(tx, {
                propertyId: input.propertyId,
                folioId,
                amount: money(share, currency),
                reason: 'late_charge',
                ref: { type: 'journal_entry', id: claim.entryId },
                idempotencyKey: `${idempotencyKey}:collect:${folioId}`,
              }),
            ).catch((err: unknown) => ({
              status: 'failed',
              detail:
                err instanceof DomainError
                  ? err.message
                  : 'Payments could not record the collection request. Arrange collection manually.',
            }))
          : { status: 'not_possible', detail: 'Nothing to collect' };
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

  const allowanceTotal = blocks.reduce((s, b) => s + b.comps.reduce((x, y) => x + y, 0), 0);
  // One audit row per folio so each folio's history shows its charges.
  for (const folioId of folioIds) {
    await tx.audit({
      action: 'finance.posting.charge',
      target: { type: 'folio', id: folioId },
      propertyId: input.propertyId,
      ...(input.reason ? { reason: input.reason } : {}),
      after: {
        entryId: claim.entryId,
        chargeCode: code.code,
        description: input.description,
        amount: input.amount,
        onThisFolio: money(
          postings.filter((p) => p.folioId === folioId).reduce((s, p) => s + p.amountMinor, 0),
          currency,
        ),
        allocations,
        postDeparture: !!departure,
      },
    });
  }
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
  /** Provider-confirmed (PSP) or recorded from a slip/cash/bank transfer awaiting statement verification. */
  verification?: 'provider_confirmed' | 'recorded_unverified' | 'recorded_verified';
  /**
   * Cash recorded by another module without an open cashier session: 'reject' (default, desk flows) or 'flag'
   * (money already received — post it to cash without a session and raise an exception for the cashier).
   */
  cashWithoutSession?: 'reject' | 'flag';
}

async function entryResult(tx: TxContext, entryId: string, replayed: boolean): Promise<EntryResult> {
  return { entryId, postingIds: await postingIdsOfEntry(tx, entryId), replayed };
}

/**
 * Record a confirmed payment on a folio (provider contract). Payments calls this only after the provider
 * confirmed the capture; cash is entered by a cashier in an open session. Never creates revenue.
 */
export async function recordPayment(
  tx: TxContext,
  deps: Deps,
  input: RecordPaymentInput,
): Promise<EntryResult & { postingId: string }> {
  const f0 = await loadFolio(tx, input.folioId);
  requirePermission(tx, 'finance.posting.create', { propertyId: f0.property_id });
  if (input.amount.amountMinor <= 0)
    throw new ValidationError('invalid_amount', 'A payment amount must be positive.');
  const { idempotencyKey, ...rest } = input;
  const hash = requestHash({ op: 'payment', ...rest });
  const prior = await findEntryByKey(tx, idempotencyKey, hash);
  if (prior) {
    const r = await entryResult(tx, prior, true);
    return { ...r, postingId: r.postingIds[0] as string };
  }
  await deps.ports.platform.assertWritable(tx, f0.property_id, 'charges');
  const businessDate = await deps.ports.platform.getBusinessDate(tx, f0.property_id);
  const sessionId = await openSessionFor(tx, f0.property_id, input.method, input.cashierSessionId, {
    cashRequiresSession: input.cashWithoutSession !== 'flag',
  });
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
    {
      accountKey: 'guest_ledger',
      subLedger: { type: 'folio', id: folio.id },
      postingIndex: 0,
      currency: folio.currency,
    },
  );
  const clearing = await accountId(
    tx,
    deps,
    folio.legal_entity_id,
    clearingSide(input.method, input.provider ?? null, sessionId).accountKey,
  );
  const [postingId] = await writeEntryBody(
    tx,
    deps,
    claim.entryId,
    {
      legalEntityId: folio.legal_entity_id,
      propertyId: folio.property_id,
      businessDate,
      description: 'Payment',
    },
    [
      {
        folioId: folio.id,
        kind: 'payment',
        amountMinor: -bridge.creditAmount.amountMinor,
        currency: folio.currency,
        description: `Payment — ${input.method.replace('_', ' ')}${input.reference ? ` (${input.reference})` : ''}`,
        paymentRef: input.paymentRef,
        paymentMethod: encodeMethod(input.method, input.provider),
        paymentVerification: input.verification ?? null,
        cashierSessionId: sessionId,
        counterAccountId: clearing,
        fxRateId: bridge.fxRateId,
        ...(input.amount.currency !== folio.currency
          ? { originalAmountMinor: -input.amount.amountMinor, originalCurrency: input.amount.currency }
          : {}),
      },
    ],
    bridge.lines,
  );
  if (!sessionId && input.method === 'cash') {
    await raiseException(tx, {
      propertyId: folio.property_id,
      kind: 'cash_without_session',
      severity: 'routine',
      ref: { type: 'folio', id: folio.id },
      message: `Cash of ${input.amount.amountMinor} ${input.amount.currency} (minor units) was recorded without an open cashier session. The receiving cashier should include it in their count.`,
      details: { entryId: claim.entryId, paymentRef: input.paymentRef },
      businessDate,
    });
  }
  if (sessionId) {
    if (input.method === 'cash') {
      await recordCashMovement(tx, {
        sessionId,
        kind: 'payment',
        amount: input.amount,
        entryId: claim.entryId,
        postingId: postingId as string,
        reference: input.reference ?? null,
      });
    }
  }
  await tx.audit({
    action: 'finance.posting.payment',
    target: { type: 'folio', id: folio.id },
    propertyId: folio.property_id,
    after: {
      amount: input.amount,
      method: input.method,
      paymentRef: input.paymentRef,
      entryId: claim.entryId,
    },
  });
  await tx.emit({
    type: 'finance.posting.created',
    propertyId: folio.property_id,
    aggregate: { type: 'journal_entry', id: claim.entryId },
    payload: {
      entryId: claim.entryId,
      kind: 'payment',
      postingIds: [postingId],
      folioIds: [folio.id],
      amount: input.amount,
      paymentRef: input.paymentRef,
      businessDate,
    },
  });
  return {
    entryId: claim.entryId,
    postingIds: [postingId as string],
    postingId: postingId as string,
    replayed: false,
  };
}

export interface RecordRefundInput {
  folioId: string;
  amount: Money;
  refundRef: EntityRef;
  originalPaymentRef: EntityRef;
  idempotencyKey: string;
  cashierSessionId?: string;
  cashWithoutSession?: 'reject' | 'flag';
}

/** Record a confirmed refund as a new posting linked to the original payment (which stays unchanged). */
export async function recordRefund(
  tx: TxContext,
  deps: Deps,
  input: RecordRefundInput,
): Promise<EntryResult & { postingId: string }> {
  const f0 = await loadFolio(tx, input.folioId);
  requirePermission(tx, 'finance.posting.create', { propertyId: f0.property_id });
  if (input.amount.amountMinor <= 0)
    throw new ValidationError('invalid_amount', 'A refund amount must be positive.');
  const { idempotencyKey, ...rest } = input;
  const hash = requestHash({ op: 'refund', ...rest });
  const prior = await findEntryByKey(tx, idempotencyKey, hash);
  if (prior) {
    const r = await entryResult(tx, prior, true);
    return { ...r, postingId: r.postingIds[0] as string };
  }
  await deps.ports.platform.assertWritable(tx, f0.property_id, 'charges');
  const original = await findOriginalPayment(tx, input.originalPaymentRef);
  const raced = await findEntryByKey(tx, idempotencyKey, hash);
  if (raced) {
    const r = await entryResult(tx, raced, true);
    return { ...r, postingId: r.postingIds[0] as string };
  }
  if (input.amount.currency !== original.tenderCurrency) {
    throw new ValidationError(
      'refund_currency_mismatch',
      `Refund in ${original.tenderCurrency}, the currency of the original payment.`,
    );
  }
  if (original.refundedMinor + input.amount.amountMinor > original.tenderMinor) {
    throw new BusinessRuleError(
      'refund_exceeds_payment',
      `Only ${original.tenderMinor - original.refundedMinor} ${original.tenderCurrency} (minor units) of this payment can still be refunded.`,
      { paid: original.tenderMinor, refunded: original.refundedMinor },
    );
  }
  const { method, provider } = decodeMethod(original.paymentMethod);
  const businessDate = await deps.ports.platform.getBusinessDate(tx, f0.property_id);
  const sessionId = await openSessionFor(tx, f0.property_id, method, input.cashierSessionId, {
    cashRequiresSession: input.cashWithoutSession !== 'flag',
  });
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
  const bridge = await bridgeLines(
    tx,
    deps,
    folio.legal_entity_id,
    businessDate,
    { ...side, amount: input.amount },
    {
      accountKey: 'guest_ledger',
      subLedger: { type: 'folio', id: folio.id },
      postingIndex: 0,
      currency: folio.currency,
    },
  );
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
    {
      legalEntityId: folio.legal_entity_id,
      propertyId: folio.property_id,
      businessDate,
      description: 'Refund',
    },
    [
      {
        folioId: folio.id,
        kind: 'refund',
        amountMinor: bridge.creditAmount.amountMinor,
        currency: folio.currency,
        description: `Refund — ${method.replace('_', ' ')}`,
        paymentRef: input.refundRef,
        paymentMethod: original.paymentMethod,
        correctsPostingId: original.postingId,
        source: input.originalPaymentRef,
        cashierSessionId: sessionId,
        counterAccountId: clearing,
        fxRateId: bridge.fxRateId,
        ...(input.amount.currency !== folio.currency
          ? { originalAmountMinor: input.amount.amountMinor, originalCurrency: input.amount.currency }
          : {}),
      },
    ],
    lines,
  );
  if (sessionId && method === 'cash') {
    await recordCashMovement(tx, {
      sessionId,
      kind: 'refund',
      amount: money(-input.amount.amountMinor, input.amount.currency),
      entryId: claim.entryId,
      postingId: postingId as string,
    });
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
    payload: {
      entryId: claim.entryId,
      kind: 'refund',
      postingIds: [postingId],
      folioIds: [folio.id],
      amount: input.amount,
      refundRef: input.refundRef,
      businessDate,
    },
  });
  return {
    entryId: claim.entryId,
    postingIds: [postingId as string],
    postingId: postingId as string,
    replayed: false,
  };
}

/** The original payment of a refund: a folio payment posting, or a deposit received on a booking. */
export async function findOriginalPayment(
  tx: TxContext,
  ref: EntityRef,
): Promise<{
  postingId: string | null;
  bookingId: string | null;
  paymentMethod: string | null;
  tenderMinor: number;
  tenderCurrency: string;
  refundedMinor: number;
}> {
  const tender = (p: {
    original_amount_minor: number | null;
    original_currency: string | null;
    amount_minor: number;
    currency: string;
  }) =>
    p.original_currency
      ? { amount: Math.abs(Number(p.original_amount_minor)), currency: p.original_currency }
      : { amount: Math.abs(Number(p.amount_minor)), currency: p.currency };
  // Serialize everything that reduces one payment (refunds, corrections) before measuring what is left.
  await sql`select pg_advisory_xact_lock(hashtext(${`finance.payment:${ref.type}:${ref.id}`}))`.execute(
    tx.db,
  );
  const posting = await db(tx)
    .selectFrom('finance.postings')
    .selectAll()
    .where('payment_ref_type', '=', ref.type)
    .where('payment_ref_id', '=', ref.id)
    .where('kind', '=', 'payment')
    .orderBy('created_at')
    .executeTakeFirst();
  if (posting) {
    const refunds = await db(tx)
      .selectFrom('finance.postings')
      .selectAll()
      .where('corrects_posting_id', '=', posting.id)
      .where('kind', 'in', ['refund', 'adjustment'])
      .execute();
    const t = tender(posting);
    // Refunds reduce what can still be refunded; payment corrections (adjustments) move it either way:
    // a correction posting of +X on the folio means the recorded payment was reduced by X.
    const signedTender = (r: (typeof refunds)[number]) =>
      Math.sign(Number(r.amount_minor)) * tender(r).amount;
    return {
      postingId: posting.id,
      bookingId: null,
      paymentMethod: posting.payment_method,
      tenderMinor: t.amount,
      tenderCurrency: t.currency,
      refundedMinor: refunds.reduce(
        (s, r) => s + (r.kind === 'refund' ? tender(r).amount : signedTender(r)),
        0,
      ),
    };
  }
  const deposit = await db(tx)
    .selectFrom('finance.deposit_movements')
    .selectAll()
    .where('payment_ref_type', '=', ref.type)
    .where('payment_ref_id', '=', ref.id)
    .where('kind', '=', 'received')
    .executeTakeFirst();
  if (deposit) {
    const folioRefunds = await db(tx)
      .selectFrom('finance.postings')
      .selectAll()
      .where('source_type', '=', ref.type)
      .where('source_id', '=', ref.id)
      .where('kind', '=', 'refund')
      .execute();
    const depositRefunds = await db(tx)
      .selectFrom('finance.journal_entries as e')
      .innerJoin('finance.deposit_movements as m', 'm.entry_id', 'e.id')
      .select('m.amount_minor')
      .where('e.reason_code', '=', `refund_of:${ref.type}:${ref.id}`)
      .where('m.kind', 'in', ['refunded', 'adjusted'])
      .execute();
    return {
      postingId: null,
      bookingId: deposit.booking_id,
      paymentMethod: deposit.payment_method ?? 'card',
      tenderMinor: Number(deposit.amount_minor),
      tenderCurrency: deposit.currency,
      refundedMinor:
        folioRefunds.reduce((s, r) => s + tender(r).amount, 0) +
        depositRefunds.reduce((s, r) => s - Number(r.amount_minor), 0),
    };
  }
  throw new BusinessRuleError(
    'original_payment_not_found',
    'The payment being refunded is not recorded in the ledger. Record or reconcile the original payment first.',
    { originalPaymentRef: ref },
  );
}

// ───────────────────────────── Transfers ─────────────────────────────

const TRANSFERABLE = [
  'charge',
  'tax',
  'adjustment',
  'payment',
  'refund',
  'deposit_application',
  'paid_out',
  'allowance_usage',
  'transfer_in',
];

/** Move postings (or an amount) between two folios of the same legal entity — traceable on both sides. */
export async function transferPostings(
  tx: TxContext,
  deps: Deps,
  input: TransferInput & { idempotencyKey: string },
): Promise<EntryResult> {
  if (input.fromFolioId === input.toFolioId)
    throw new ValidationError('same_folio', 'Choose two different folios.');
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
    throw new BusinessRuleError(
      'transfer_currency_mismatch',
      'Both folios must use the same currency for a transfer.',
    );
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
      throw new BusinessRuleError(
        'folio_not_open',
        `Folio of ${f.payer_name} is ${f.status}; transfers need open folios.`,
      );
    }
    prepared.push(await reopenInPlace(tx, f, 'transfer'));
  }
  const [from, to] = prepared as [FolioRow, FolioRow];
  const currency = from.currency;
  const pairs: Array<{
    amount: number;
    original: Selectable<import('../tables').PostingsTable> | null;
    description: string;
  }> = [];
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
        throw new ValidationError(
          'posting_not_on_folio',
          'Every selected posting must be on the source folio.',
          { postingId: item.postingId },
        );
      }
      if (p.document_id) {
        throw new BusinessRuleError(
          'posting_invoiced',
          `"${p.description}" is on an issued invoice and cannot be moved. Issue a credit note first.`,
        );
      }
      if (!TRANSFERABLE.includes(p.kind)) {
        throw new BusinessRuleError(
          'posting_not_transferable',
          `Postings of kind ${p.kind} cannot be transferred.`,
        );
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
      const want =
        item.amountMinor === undefined ? groupRemaining : Math.sign(groupRemaining) * item.amountMinor;
      if (groupRemaining === 0 || Math.abs(want) > Math.abs(groupRemaining)) {
        throw new BusinessRuleError(
          'transfer_exceeds_posting',
          `Only ${groupRemaining} (minor units) of "${p.description}" remain on this folio.`,
        );
      }
      const split = splitComponents(remaining, [want, groupRemaining - want])[0] as number[];
      group.forEach((g, k) => {
        if ((split[k] ?? 0) !== 0)
          pairs.push({ amount: split[k] as number, original: g, description: g.description });
      });
    }
  } else {
    pairs.push({ amount: input.amountMinor as number, original: null, description: 'Balance transfer' });
  }
  const postings: PostingDraft[] = [];
  const lines: Array<LineDraft & { accountId?: string }> = [];
  for (const pr of pairs) {
    const outIdx = postings.length;
    // Moved lines keep what they are (charge, tax, levy…) and their tax facts, however many hops (F-05).
    const o = pr.original;
    const base = {
      currency,
      originKind: o ? (o.origin_kind ?? o.kind) : null,
      chargeCodeId: o?.charge_code_id ?? null,
      chargeCode: o?.charge_code ?? null,
      serviceDate: o?.service_date ?? null,
      revenueDate: o?.revenue_date ?? null,
      correctsPostingId: o?.id ?? null,
      taxName: o?.tax_name ?? null,
      taxKind: (o?.tax_kind as PostingDraft['taxKind']) ?? null,
      taxRate: o?.tax_rate ?? null,
      taxRuleId: o?.tax_rule_id ?? null,
      taxRuleVersionId: o?.tax_rule_version_id ?? null,
      allowanceInstanceId: o?.allowance_instance_id ?? null,
    };
    postings.push({
      ...base,
      folioId: from.id,
      kind: 'transfer_out',
      amountMinor: -pr.amount,
      description: `${pr.description} → ${to.payer_name}`,
      peerIndex: outIdx + 1,
    });
    postings.push({
      ...base,
      folioId: to.id,
      kind: 'transfer_in',
      amountMinor: pr.amount,
      description: `${pr.description} ← ${from.payer_name}`,
      peerIndex: outIdx,
    });
    lines.push({
      accountKey: 'guest_ledger',
      amountMinor: -pr.amount,
      currency,
      subLedger: { type: 'folio', id: from.id },
      postingIndex: outIdx,
    });
    lines.push({
      accountKey: 'guest_ledger',
      amountMinor: pr.amount,
      currency,
      subLedger: { type: 'folio', id: to.id },
      postingIndex: outIdx + 1,
    });
  }
  const postingIds = await writeEntryBody(
    tx,
    deps,
    claim.entryId,
    {
      legalEntityId: from.legal_entity_id,
      propertyId: from.property_id,
      businessDate,
      description: 'Transfer',
    },
    postings,
    lines,
  );
  for (const [folio, other, direction] of [
    [from, to, 'out'],
    [to, from, 'in'],
  ] as const) {
    await tx.audit({
      action: 'finance.posting.transfer',
      target: { type: 'folio', id: folio.id },
      propertyId: from.property_id,
      reason: input.reason,
      after: {
        entryId: claim.entryId,
        direction,
        otherFolioId: other.id,
        pairs: pairs.map((p) => ({ amount: p.amount, postingId: p.original?.id ?? null })),
      },
    });
  }
  await tx.emit({
    type: 'finance.postings.transferred',
    propertyId: from.property_id,
    aggregate: { type: 'journal_entry', id: claim.entryId },
    payload: {
      entryId: claim.entryId,
      fromFolioId: from.id,
      toFolioId: to.id,
      total: pairs.reduce((s, p) => s + p.amount, 0),
      currency,
    },
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
export async function adjustPosting(
  tx: TxContext,
  deps: Deps,
  input: AdjustPostingInput,
): Promise<EntryResult> {
  const p = await db(tx)
    .selectFrom('finance.postings')
    .selectAll()
    .where('id', '=', input.postingId)
    .executeTakeFirst();
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
    const lock = await db(tx)
      .selectFrom('finance.posting_document_locks')
      .select('document_id')
      .where('posting_id', '=', p.id)
      .executeTakeFirst();
    if (lock) {
      throw new BusinessRuleError(
        'posting_invoiced',
        'This charge is on an issued invoice. Issue a credit note (it corrects the charge and keeps the invoice intact).',
        { documentId: lock.document_id },
      );
    }
  }
  // Lock the folio BEFORE measuring what is left to correct: concurrent corrections (different keys) serialize
  // here and each sees the previous one's effect, so the total corrected can never exceed the original.
  const locked = (await lockFolios(tx, [p.folio_id])).get(p.folio_id) as FolioRow;
  const raced = await findEntryByKey(tx, idempotencyKey, hash);
  if (raced) return entryResult(tx, raced, true);
  const family = [
    p,
    ...(await db(tx)
      .selectFrom('finance.postings')
      .selectAll()
      .where('parent_posting_id', '=', p.id)
      .where('kind', 'in', ['tax', 'allowance_usage'])
      .orderBy('created_at')
      .orderBy('id')
      .execute()),
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
  if (total === 0)
    throw new BusinessRuleError(
      'posting_already_corrected',
      'This charge has already been fully corrected or moved.',
    );
  const want = input.amountMinor === undefined ? total : Math.sign(total) * input.amountMinor;
  if (Math.abs(want) > Math.abs(total)) {
    throw new BusinessRuleError(
      'adjustment_exceeds_posting',
      `At most ${Math.abs(total)} (minor units) of this charge can still be adjusted.`,
    );
  }
  const part = splitComponents(remaining, [want, total - want])[0] as number[];
  const usageRemaining = [];
  for (const u of usageFamily) usageRemaining.push(await remainingOf(u.id, Number(u.amount_minor)));
  const usageTotal = usageRemaining.reduce((s, v) => s + v, 0);
  const usageBack = usageTotal === 0 ? 0 : Math.round((usageTotal * want) / total);
  const usagePart =
    usageBack === 0
      ? usageRemaining.map(() => 0)
      : (splitComponents(usageRemaining, [usageBack, usageTotal - usageBack])[0] as number[]);

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
  if (locked.status === 'closed' && !allowInvoiced) {
    throw new BusinessRuleError(
      'folio_not_open',
      'The folio is closed. Corrections go through a credit note.',
    );
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
      originKind: orig.origin_kind ?? orig.kind,
      amountMinor: -amount,
      currency: orig.currency,
      description: `Correction: ${orig.description} (${input.reasonCode})`,
      chargeCodeId: orig.charge_code_id,
      chargeCode: orig.charge_code,
      taxRuleId: orig.tax_rule_id,
      taxRuleVersionId: orig.tax_rule_version_id,
      taxName: orig.tax_name,
      taxKind: (orig.tax_kind as PostingDraft['taxKind']) ?? null,
      taxUnits:
        orig.tax_units !== null && Number(orig.amount_minor) !== 0
          ? -Math.round((Number(orig.tax_units) * amount * 10_000) / Number(orig.amount_minor)) / 10_000
          : null,
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
    lines.push({
      accountKey: 'guest_ledger',
      amountMinor: -amount,
      currency: orig.currency,
      subLedger: { type: 'folio', id: orig.folio_id },
      postingIndex: idx,
    });
    lines.push({
      accountKey: '',
      accountId: orig.counter_account_id as string,
      amountMinor: amount,
      currency: orig.currency,
      subLedger,
      chargeCode: orig.charge_code,
      serviceDate: orig.service_date,
      revenueDate: orig.revenue_date,
    });
  };
  for (let k = 0; k < chargeFamily.length; k++)
    push(chargeFamily[k] as (typeof chargeFamily)[number], part[k] ?? 0);
  for (let k = 0; k < usageFamily.length; k++) {
    const u = usageFamily[k] as (typeof usageFamily)[number];
    const amt = usagePart[k] ?? 0;
    if (amt === 0) continue;
    const inst = await db(tx)
      .selectFrom('finance.allowance_instances')
      .selectAll()
      .where('id', '=', u.allowance_instance_id as string)
      .forUpdate()
      .executeTakeFirstOrThrow();
    if (inst.status === 'closed' || inst.status === 'cancelled') {
      throw new BusinessRuleError(
        'allowance_period_closed',
        `The allowance "${inst.label}" used by this charge is already closed. Correct the charge with a manual posting reviewed by finance.`,
      );
    }
    // Tax relief lines (package allowance) post against the tax account; only the net cover counts as usage.
    const isRelief = !!u.tax_kind;
    push(u, amt, isRelief ? null : { type: 'allowance', id: inst.id });
    if (!isRelief) {
      const used = Number(inst.used_minor) + amt; // amt is negative (usage credits are negative)
      await db(tx)
        .updateTable('finance.allowance_instances')
        .set({ used_minor: used, status: 'active', version: sql`version + 1` })
        .where('id', '=', inst.id)
        .execute();
    }
  }
  const postingIds = await writeEntryBody(
    tx,
    deps,
    claim.entryId,
    { legalEntityId: p.legal_entity_id, propertyId: p.property_id, businessDate, description: 'Correction' },
    postings,
    lines,
  );
  await tx.audit({
    action: 'finance.posting.correct',
    target: { type: 'folio', id: p.folio_id },
    propertyId: p.property_id,
    reason: `${input.reasonCode}: ${input.note}`,
    before: { amount: total },
    after: {
      postingId: p.id,
      adjustedBy: -want,
      entryId: claim.entryId,
      restatementOf: p.business_date !== businessDate ? p.business_date : null,
    },
  });
  await tx.emit({
    type: 'finance.posting.adjusted',
    propertyId: p.property_id,
    aggregate: { type: 'journal_entry', id: claim.entryId },
    payload: {
      entryId: claim.entryId,
      postingId: p.id,
      amountMinor: -want,
      reasonCode: input.reasonCode,
      relatesToBusinessDate: p.business_date,
    },
  });
  return { entryId: claim.entryId, postingIds, replayed: false };
}

/** Collect several tenders (split tender) at the desk in one command: cash, bank transfer, cheque, other. */
export async function collectPayment(
  tx: TxContext,
  deps: Deps,
  input: {
    folioId: string;
    tenders: Array<{
      method: 'cash' | 'bank_transfer' | 'cheque' | 'other';
      amount: Money;
      reference?: string;
    }>;
    idempotencyKey: string;
  },
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

/**
 * Reverse a whole charge entry (e.g. posted to the wrong stay): an exact mirror of every journal line and
 * posting, linked with `reverses_entry_id` (at most once per entry, enforced by a unique index). Refused when
 * any of its postings was invoiced, moved or already partly corrected — correct the remainder instead.
 */
export async function reverseEntry(
  tx: TxContext,
  deps: Deps,
  input: { entryId: string; reasonCode: string; note: string; idempotencyKey: string },
): Promise<EntryResult> {
  const entry = await db(tx)
    .selectFrom('finance.journal_entries')
    .selectAll()
    .where('id', '=', input.entryId)
    .executeTakeFirst();
  if (!entry?.property_id) throw new ValidationError('entry_not_found', 'The journal entry was not found.');
  requirePermission(tx, 'finance.posting.correct', { propertyId: entry.property_id });
  if (entry.entry_type !== 'charge') {
    throw new BusinessRuleError(
      'entry_not_reversible',
      'Only charge entries can be reversed here. Payments are corrected by refunds; transfers by a transfer back.',
    );
  }
  const { idempotencyKey, ...rest } = input;
  const hash = requestHash({ op: 'reverse', ...rest });
  const prior = await findEntryByKey(tx, idempotencyKey, hash);
  if (prior) return entryResult(tx, prior, true);
  await deps.ports.platform.assertWritable(tx, entry.property_id, 'charges');
  // Lock every folio of the entry BEFORE checking that nothing was corrected or moved meanwhile.
  const entryFolios = await db(tx)
    .selectFrom('finance.postings')
    .select('folio_id')
    .where('entry_id', '=', entry.id)
    .execute();
  const locked = await lockFolios(
    tx,
    entryFolios.map((f) => f.folio_id),
  );
  const raced = await findEntryByKey(tx, idempotencyKey, hash);
  if (raced) return entryResult(tx, raced, true);
  const already = await db(tx)
    .selectFrom('finance.journal_entries')
    .select('id')
    .where('reverses_entry_id', '=', entry.id)
    .executeTakeFirst();
  if (already)
    throw new ConflictError('entry_already_reversed', 'This entry was already reversed.', {
      reversalEntryId: already.id,
    });
  const postings = await db(tx)
    .selectFrom('finance.postings as p')
    .leftJoin('finance.posting_document_locks as l', 'l.posting_id', 'p.id')
    .selectAll('p')
    .select('l.document_id')
    .where('p.entry_id', '=', entry.id)
    .orderBy('p.created_at')
    .orderBy('p.id')
    .execute();
  if (postings.some((p) => p.document_id)) {
    throw new BusinessRuleError(
      'posting_invoiced',
      'Part of this entry is on an issued invoice. Issue a credit note instead.',
    );
  }
  const touched = await db(tx)
    .selectFrom('finance.postings')
    .select('id')
    .where(
      'corrects_posting_id',
      'in',
      postings.map((p) => p.id),
    )
    .executeTakeFirst();
  if (touched) {
    throw new BusinessRuleError(
      'entry_partly_corrected',
      'Part of this entry was already corrected or moved to another folio. Correct the remaining amount with an adjustment instead.',
    );
  }
  const businessDate = await deps.ports.platform.getBusinessDate(tx, entry.property_id);
  let claim: Awaited<ReturnType<typeof claimEntry>>;
  try {
    claim = await claimEntry(tx, {
      legalEntityId: entry.legal_entity_id,
      propertyId: entry.property_id,
      entryType: 'adjustment',
      businessDate,
      idempotencyKey,
      requestHash: hash,
      reversesEntryId: entry.id,
      correctsEntryId: entry.id,
      relatesToBusinessDate: entry.business_date !== businessDate ? entry.business_date : null,
      sameDayCorrection: entry.business_date === businessDate,
      reasonCode: input.reasonCode,
      description: `Reversal of "${entry.description}": ${input.note}`,
    });
  } catch (err) {
    if (isUniqueViolation(err))
      throw new ConflictError('entry_already_reversed', 'This entry was already reversed.');
    throw err;
  }
  if (!claim.claimed) return entryResult(tx, claim.entryId, true);
  for (const f of locked.values()) {
    if (f.status === 'closed') {
      throw new BusinessRuleError(
        'folio_not_open',
        'A folio of this entry is closed. Corrections go through a credit note.',
      );
    }
    await reopenInPlace(tx, f, 'correction');
  }
  for (const p of postings.filter((x) => x.kind === 'allowance_usage' && x.allowance_instance_id)) {
    const inst = await db(tx)
      .selectFrom('finance.allowance_instances')
      .selectAll()
      .where('id', '=', p.allowance_instance_id as string)
      .forUpdate()
      .executeTakeFirstOrThrow();
    if (inst.status === 'closed' || inst.status === 'cancelled') {
      throw new BusinessRuleError(
        'allowance_period_closed',
        `The allowance "${inst.label}" used by this charge is already closed.`,
      );
    }
    if (p.tax_kind) continue; // tax relief: only the net cover counts as allowance usage
    await db(tx)
      .updateTable('finance.allowance_instances')
      .set({
        used_minor: Number(inst.used_minor) + Number(p.amount_minor),
        status: 'active',
        version: sql`version + 1`,
      })
      .where('id', '=', inst.id)
      .execute();
  }
  const index = new Map(postings.map((p, i) => [p.id, i]));
  const drafts: PostingDraft[] = postings.map((p) => ({
    folioId: p.folio_id,
    kind: 'adjustment',
    originKind: p.origin_kind ?? p.kind,
    amountMinor: -Number(p.amount_minor),
    currency: p.currency,
    description: `Reversal: ${p.description} (${input.reasonCode})`,
    chargeCodeId: p.charge_code_id,
    chargeCode: p.charge_code,
    taxRuleId: p.tax_rule_id,
    taxRuleVersionId: p.tax_rule_version_id,
    taxName: p.tax_name,
    taxKind: (p.tax_kind as PostingDraft['taxKind']) ?? null,
    taxUnits: p.tax_units === null ? null : -Number(p.tax_units),
    taxExemptUnits: p.tax_exempt_units === null ? null : -Number(p.tax_exempt_units),
    taxRateCategory: p.tax_rate_category,
    taxRate: p.tax_rate,
    serviceDate: p.service_date,
    revenueDate: p.revenue_date,
    correctsPostingId: p.id,
    billingRuleId: p.billing_rule_id,
    allowanceInstanceId: p.allowance_instance_id,
    counterAccountId: p.counter_account_id,
    fxRateId: p.fx_rate_id,
    postDeparture: p.post_departure,
  }));
  const original = await db(tx)
    .selectFrom('finance.journal_lines')
    .selectAll()
    .where('entry_id', '=', entry.id)
    .orderBy('line_no')
    .execute();
  const lines: Array<LineDraft & { accountId?: string }> = original.map((l) => ({
    accountKey: '',
    accountId: l.account_id,
    amountMinor: -Number(l.amount_minor),
    currency: l.currency,
    functionalAmountMinor: -Number(l.functional_amount_minor),
    fxRateId: l.fx_rate_id,
    subLedger: l.sub_ledger_type
      ? { type: l.sub_ledger_type as SubLedgerType, id: l.sub_ledger_id as string }
      : null,
    ...(l.posting_id && index.has(l.posting_id) ? { postingIndex: index.get(l.posting_id) as number } : {}),
    chargeCode: l.charge_code,
    serviceDate: l.service_date,
    revenueDate: l.revenue_date,
    memo: `reversal${l.memo ? `: ${l.memo}` : ''}`,
  }));
  const postingIds = await writeEntryBody(
    tx,
    deps,
    claim.entryId,
    {
      legalEntityId: entry.legal_entity_id,
      propertyId: entry.property_id,
      businessDate,
      description: 'Reversal',
    },
    drafts,
    lines,
  );
  for (const folioId of [...new Set(postings.map((p) => p.folio_id))]) {
    await tx.audit({
      action: 'finance.posting.reverse',
      target: { type: 'folio', id: folioId },
      propertyId: entry.property_id,
      reason: `${input.reasonCode}: ${input.note}`,
      after: { reversedEntryId: entry.id, entryId: claim.entryId },
    });
  }
  await tx.emit({
    type: 'finance.posting.adjusted',
    propertyId: entry.property_id,
    aggregate: { type: 'journal_entry', id: claim.entryId },
    payload: {
      entryId: claim.entryId,
      reversesEntryId: entry.id,
      reasonCode: input.reasonCode,
      relatesToBusinessDate: entry.business_date,
    },
  });
  return { entryId: claim.entryId, postingIds, replayed: false };
}
