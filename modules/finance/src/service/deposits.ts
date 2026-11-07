import { type Selectable, sql, type TxContext } from '@portico/db';
import {
  BusinessRuleError,
  DomainError,
  type EntityRef,
  type LocalDate,
  type Money,
  money,
  newId,
  requirePermission,
  ValidationError,
} from '@portico/kernel';
import type { DepositSummary, OpeningDepositsInput, OpeningImportReport } from '../contracts';
import { taxAccountKey } from '../domain/chart';
import type { LineDraft } from '../domain/ledger';
import { fromRatesTaxLine, normalizeLedgerKey, type PostingTax } from '../domain/tax-map';
import type { PaymentMethodKind } from '../domain/types';
import type { DepositAccountsTable } from '../tables';
import { syncDepartedFolios } from './departed-folios';
import { prepareDestination } from './folios';
import { assertTargetInScope, describeTarget } from './ledger-port';
import { chargeCodeByCode } from './setup';
import {
  accountId,
  claimEntry,
  type Deps,
  db,
  type FolioRow,
  findEntryByKey,
  functionalCurrencyOf,
  loadFolio,
  lockMoneyFolios,
  type PostingDraft,
  postingIdsOfEntry,
  raiseException,
  requestHash,
  writeEntryBody,
} from './support';
import { clearingSide, decodeMethod, encodeMethod, openSessionFor, recordCashMovement } from './tender';

/** Tax declared on a deposit, kept per tax account key (time of supply = receipt). */
export interface DeclaredTax {
  accountKey: string;
  ruleId: string;
  ruleVersionId: string;
  name: string;
  rate?: string;
  amountMinor: number;
}

type DeclaredMap = Record<string, number>;

const declaredOf = (a: Selectable<DepositAccountsTable>): DeclaredMap =>
  (a.declared_tax ?? {}) as DeclaredMap;

/**
 * The property of a booking's deposit (review P1-1, R2-P1-3). The owner comes from reservations (booking directory);
 * the deposit must then pass THE ledger-target predicate (`assertTargetInScope`, the one payments also asks before
 * charging): a booking that exists nowhere, a booking of another property than the caller's, or a booking whose
 * deposits are held at another property is refused. Never "whichever property takes the first deposit".
 */
async function resolveDepositProperty(
  tx: TxContext,
  deps: Deps,
  bookingId: string,
  propertyId?: string,
): Promise<string> {
  await lockBookingDeposits(tx, bookingId);
  const owner = await describeTarget(tx, deps, { type: 'booking', id: bookingId });
  const at = propertyId ?? owner?.propertyId;
  if (!at) {
    throw new BusinessRuleError(
      'ledger_target_unknown',
      'Portico has no booking with this reference, so the deposit could not be held for it. Check the booking code, or record the payment on the booking it belongs to. Nothing was posted.',
      { bookingId },
    );
  }
  const property = await deps.ports.platform.getProperty(tx, at);
  await assertTargetInScope(
    tx,
    deps,
    { type: 'booking', id: bookingId },
    { propertyId: property.id, legalEntityId: property.legalEntityId },
    'inflow',
  );
  return property.id;
}

/**
 * Re-review #3 R3-P2-3: one writer at a time per booking's deposits — every path that may create or add to a booking's
 * deposit account (desk or link deposit, opening import, migration) takes this lock BEFORE checking where the deposits
 * are held, so two concurrent imports (or an import and a deposit) cannot both pass the check.
 */
async function lockBookingDeposits(tx: TxContext, bookingId: string): Promise<void> {
  await sql`select pg_advisory_xact_lock(hashtext(${`finance:deposit:${bookingId}`}))`.execute(tx.db);
}

async function lockDepositAccount(
  tx: TxContext,
  input: { bookingId: string; propertyId: string; legalEntityId: string; currency: string; create: boolean },
): Promise<Selectable<DepositAccountsTable> | null> {
  if (input.create) {
    await db(tx)
      .insertInto('finance.deposit_accounts')
      .values({
        id: newId(tx.now.getTime()),
        tenant_id: tx.tenantId,
        legal_entity_id: input.legalEntityId,
        property_id: input.propertyId,
        booking_id: input.bookingId,
        currency: input.currency,
      })
      .onConflict((oc) => oc.columns(['tenant_id', 'booking_id']).doNothing())
      .execute();
  }
  const row = await db(tx)
    .selectFrom('finance.deposit_accounts')
    .selectAll()
    .where('booking_id', '=', input.bookingId)
    .forUpdate()
    .executeTakeFirst();
  if (row && row.currency !== input.currency) {
    throw new BusinessRuleError(
      'deposit_currency_mismatch',
      `Deposits for this booking are held in ${row.currency}. Record the deposit in ${row.currency}.`,
    );
  }
  // R3-P2-3 (defence in depth): the locked account must be held where this money is booked.
  if (row && (row.property_id !== input.propertyId || row.legal_entity_id !== input.legalEntityId)) {
    throw new BusinessRuleError(
      'deposit_account_conflict',
      "This booking's deposits are held at another property or hotel company. Finance must move them before more is added. Nothing was posted.",
      { bookingId: input.bookingId },
    );
  }
  return row ?? null;
}

/** Ask the tax engine which taxes fall due on a prepayment (time of supply at receipt). */
async function prepaymentTaxes(
  tx: TxContext,
  deps: Deps,
  input: {
    propertyId: string;
    amount: Money;
    priceMode: 'inclusive' | 'exclusive';
    taxGroup: string;
    date: LocalDate;
  },
): Promise<{ taxes: PostingTax[]; unavailable: boolean }> {
  try {
    const r = await deps.ports.tax.computeTaxesDetailed(tx, {
      propertyId: input.propertyId,
      lines: [
        {
          lineId: 'deposit',
          chargeCode: 'DEPOSIT',
          taxCategory: input.taxGroup,
          amount: input.amount,
          quantity: 1,
          serviceDate: input.date,
          taxInclusion: { mode: input.priceMode },
          // ADR-0016 §4: the tax point of a prepayment is its receipt.
          taxPointDate: input.date,
          // Per-guest levies (Green Tax) are due per guest-day, never on a prepayment — and finance does not know
          // the booking's occupancy (integration-step fix: the engine refused deposits with tax_occupancy_required).
          valueOnly: true,
        },
      ],
    });
    // Only statutory value-based taxes fall due on a prepayment (e.g. TGST): not per-person levies (Green Tax is
    // due per guest-day) and not commercial fees such as the service charge.
    const taxes = (r.lines.find((l) => l.lineId === 'deposit')?.taxes ?? [])
      .map(fromRatesTaxLine)
      .filter((t) => t.kind === 'tax' && t.statutory && t.valueBased);
    if (taxes.some((t) => t.amount.currency !== input.amount.currency)) {
      throw new BusinessRuleError('tax_engine_error', 'The tax engine answered in another currency.');
    }
    return { taxes, unavailable: false };
  } catch (err) {
    if (err instanceof DomainError && err.code === 'module_not_available')
      return { taxes: [], unavailable: true };
    throw err;
  }
}

export interface RecordDepositInput {
  bookingId: string;
  amount: Money;
  paymentRef: EntityRef;
  idempotencyKey: string;
  propertyId?: string;
  method?: PaymentMethodKind;
  provider?: string;
  /** Tax group of the prepaid supply (default accommodation). */
  taxGroup?: string;
  cashierSessionId?: string;
  verification?: 'provider_confirmed' | 'recorded_unverified' | 'recorded_verified';
  /** See RecordPaymentInput.cashWithoutSession. */
  cashWithoutSession?: 'reject' | 'flag';
}

/**
 * Record a confirmed deposit (provider contract): a liability for the booking, never revenue. Tax falling due on
 * receipt (time of supply) is declared now and tracked so the final bill never taxes the same supply twice.
 */
export async function recordDeposit(
  tx: TxContext,
  deps: Deps,
  input: RecordDepositInput,
): Promise<{ entryId: string; balance: Money; taxDeclared: Money; replayed: boolean }> {
  if (input.amount.amountMinor <= 0)
    throw new ValidationError('invalid_amount', 'A deposit must be positive.');
  const propertyId = await resolveDepositProperty(tx, deps, input.bookingId, input.propertyId);
  requirePermission(tx, 'finance.posting.create', { propertyId });
  const { idempotencyKey, ...rest } = input;
  const hash = requestHash({ op: 'deposit', ...rest });
  const summary = async (entryId: string, replayed: boolean) => {
    const acct = await db(tx)
      .selectFrom('finance.deposit_accounts')
      .selectAll()
      .where('booking_id', '=', input.bookingId)
      .executeTakeFirstOrThrow();
    const mv = await db(tx)
      .selectFrom('finance.deposit_movements')
      .select('taxes')
      .where('entry_id', '=', entryId)
      .executeTakeFirst();
    const declared = ((mv?.taxes ?? []) as DeclaredTax[]).reduce((s, t) => s + t.amountMinor, 0);
    return {
      entryId,
      balance: money(Number(acct.balance_minor), acct.currency),
      taxDeclared: money(declared, acct.currency),
      replayed,
    };
  };
  const prior = await findEntryByKey(tx, idempotencyKey, hash);
  if (prior) return summary(prior, true);
  await deps.ports.platform.assertWritable(tx, propertyId, 'charges');
  const property = await deps.ports.platform.getProperty(tx, propertyId);
  const businessDate = await deps.ports.platform.getBusinessDate(tx, propertyId);
  const method = input.method ?? 'card';
  const sessionId = await openSessionFor(tx, propertyId, method, input.cashierSessionId, {
    cashRequiresSession: input.cashWithoutSession !== 'flag',
  });
  const { taxes, unavailable } = await prepaymentTaxes(tx, deps, {
    propertyId,
    amount: input.amount,
    priceMode: 'inclusive',
    taxGroup: input.taxGroup ?? 'accommodation',
    date: businessDate,
  });
  const claim = await claimEntry(tx, {
    legalEntityId: property.legalEntityId,
    propertyId,
    entryType: 'deposit',
    businessDate,
    idempotencyKey,
    requestHash: hash,
    source: input.paymentRef,
    description: `Deposit for booking ${input.bookingId}`,
  });
  if (!claim.claimed) return summary(claim.entryId, true);
  const acct = (await lockDepositAccount(tx, {
    bookingId: input.bookingId,
    propertyId,
    legalEntityId: property.legalEntityId,
    currency: input.amount.currency,
    create: true,
  })) as Selectable<DepositAccountsTable>;
  const cur = input.amount.currency;
  const sub = { type: 'booking_deposit' as const, id: input.bookingId };
  const lines: LineDraft[] = [
    {
      ...clearingSide(method, input.provider ?? null, sessionId),
      amountMinor: input.amount.amountMinor,
      currency: cur,
    },
    { accountKey: 'deposits_held', amountMinor: -input.amount.amountMinor, currency: cur, subLedger: sub },
  ];
  const declared: DeclaredTax[] = [];
  const map = { ...declaredOf(acct) };
  for (const t of taxes) {
    if (t.amount.amountMinor === 0) continue;
    const key = taxAccountKey(t.accountKey);
    lines.push({
      accountKey: 'deposit_tax_declared',
      amountMinor: t.amount.amountMinor,
      currency: cur,
      subLedger: sub,
      memo: `${t.name} declared on deposit`,
    });
    lines.push({
      accountKey: key,
      amountMinor: -t.amount.amountMinor,
      currency: cur,
      memo: `${t.name} — time of supply (deposit)`,
    });
    declared.push({
      accountKey: t.accountKey,
      ruleId: t.ruleId,
      ruleVersionId: t.ruleVersionId,
      name: t.name,
      ...(t.rate ? { rate: t.rate } : {}),
      amountMinor: t.amount.amountMinor,
    });
    map[t.accountKey] = (map[t.accountKey] ?? 0) + t.amount.amountMinor;
  }
  await writeEntryBody(
    tx,
    deps,
    claim.entryId,
    { legalEntityId: property.legalEntityId, propertyId, businessDate, description: 'Deposit' },
    [],
    lines,
  );
  await db(tx)
    .updateTable('finance.deposit_accounts')
    .set({
      balance_minor: sql`balance_minor + ${input.amount.amountMinor}`,
      declared_tax: JSON.stringify(map),
      version: sql`version + 1`,
    })
    .where('id', '=', acct.id)
    .execute();
  await db(tx)
    .insertInto('finance.deposit_movements')
    .values({
      id: newId(tx.now.getTime()),
      tenant_id: tx.tenantId,
      deposit_account_id: acct.id,
      booking_id: input.bookingId,
      kind: 'received',
      amount_minor: input.amount.amountMinor,
      currency: cur,
      entry_id: claim.entryId,
      folio_id: null,
      payment_ref_type: input.paymentRef.type,
      payment_ref_id: input.paymentRef.id,
      payment_method: encodeMethod(method, input.provider),
      payment_verification: input.verification ?? null,
      taxes: JSON.stringify(declared),
      business_date: businessDate,
    })
    .execute();
  if (sessionId && method === 'cash') {
    await recordCashMovement(tx, {
      sessionId,
      kind: 'payment',
      amount: input.amount,
      entryId: claim.entryId,
      reference: `deposit ${input.bookingId}`,
    });
  }
  if (unavailable) {
    await raiseException(tx, {
      propertyId,
      kind: 'deposit_tax_not_computed',
      severity: 'urgent',
      ref: { type: 'booking', id: input.bookingId },
      message:
        'A deposit was recorded while the tax engine was unavailable, so tax due on receipt was not declared. Finance must review this deposit.',
      details: { entryId: claim.entryId, amount: input.amount },
      businessDate,
    });
  }
  await tx.audit({
    action: 'finance.deposit.record',
    target: { type: 'booking', id: input.bookingId },
    propertyId,
    after: {
      amount: input.amount,
      method: encodeMethod(method, input.provider),
      paymentRef: input.paymentRef,
      taxDeclared: declared,
    },
  });
  await tx.emit({
    type: 'finance.deposit.recorded',
    propertyId,
    aggregate: { type: 'booking', id: input.bookingId },
    payload: { bookingId: input.bookingId, entryId: claim.entryId, amount: input.amount, businessDate },
  });
  return summary(claim.entryId, false);
}

/** Proportional share of declared tax for a part of the deposit balance. */
function releaseShare(map: DeclaredMap, part: number, balance: number): DeclaredMap {
  const out: DeclaredMap = {};
  for (const [k, v] of Object.entries(map)) out[k] = part === balance ? v : Math.round((v * part) / balance);
  return out;
}

function subtract(map: DeclaredMap, rel: DeclaredMap): DeclaredMap {
  const out: DeclaredMap = { ...map };
  for (const [k, v] of Object.entries(rel)) out[k] = (out[k] ?? 0) - v;
  for (const k of Object.keys(out)) if (out[k] === 0) delete out[k];
  return out;
}

/**
 * Apply held deposits to a folio (provider contract, at check-in). The deposit liability moves to the guest
 * ledger. Tax declared at receipt is released against the tax the stay's charges will carry; if tax rules
 * changed since receipt, the difference is credited to the folio so the prepaid part keeps the rate in force
 * when it was paid (time of supply, no re-rating).
 */
export async function applyDeposits(
  tx: TxContext,
  deps: Deps,
  input: {
    bookingId: string;
    toFolioId: string;
    amountMinor?: number;
    idempotencyKey?: string;
    taxGroup?: string;
  },
): Promise<{ entryId: string | null; applied: Money; postingIds: string[]; replayed: boolean }> {
  const f0 = await loadFolio(tx, input.toFolioId);
  requirePermission(tx, 'finance.posting.create', { propertyId: f0.property_id });
  const hash = requestHash({
    op: 'apply-deposit',
    bookingId: input.bookingId,
    toFolioId: input.toFolioId,
    amountMinor: input.amountMinor ?? null,
  });
  if (input.idempotencyKey) {
    const prior = await findEntryByKey(tx, input.idempotencyKey, hash);
    if (prior) {
      const mv = await db(tx)
        .selectFrom('finance.deposit_movements')
        .select(['amount_minor', 'currency'])
        .where('entry_id', '=', prior)
        .executeTakeFirstOrThrow();
      return {
        entryId: prior,
        applied: money(-Number(mv.amount_minor), mv.currency),
        postingIds: await postingIdsOfEntry(tx, prior),
        replayed: true,
      };
    }
  }
  await deps.ports.platform.assertWritable(tx, f0.property_id, 'charges');
  // Re-review #4 R4-P3-2: the shared collection lock FIRST, then the deposit account and the folio (domain-map order:
  // collection → folio / deposit account → payment request) — the link webhook takes it first too.
  await deps.ports.payments.lockCollections(tx, { folioIds: [input.toFolioId] });
  const acct = await db(tx)
    .selectFrom('finance.deposit_accounts')
    .selectAll()
    .where('booking_id', '=', input.bookingId)
    .forUpdate()
    .executeTakeFirst();
  const balance = Number(acct?.balance_minor ?? 0);
  const amount = Math.min(input.amountMinor ?? balance, balance);
  if (!acct || amount <= 0) {
    return { entryId: null, applied: money(0, f0.currency), postingIds: [], replayed: false };
  }
  if (acct.currency !== f0.currency) {
    throw new BusinessRuleError(
      'deposit_currency_mismatch',
      `The deposit is held in ${acct.currency} but the folio is in ${f0.currency}. Apply it to a ${acct.currency} folio.`,
    );
  }
  if (acct.legal_entity_id !== f0.legal_entity_id) {
    throw new BusinessRuleError(
      'intercompany_transfer',
      'The deposit belongs to another legal entity than the folio.',
    );
  }
  if (acct.property_id !== f0.property_id) {
    throw new BusinessRuleError(
      'deposit_property_mismatch',
      'The deposit was taken by another property than the folio’s. Refund it there, or transfer it through finance.',
      { bookingId: input.bookingId, folioId: f0.id },
    );
  }
  const businessDate = await deps.ports.platform.getBusinessDate(tx, f0.property_id);
  const movements = await db(tx)
    .selectFrom('finance.deposit_movements')
    .select(sql<number>`count(*)::int`.as('n'))
    .where('deposit_account_id', '=', acct.id)
    .executeTakeFirstOrThrow();
  const key = input.idempotencyKey ?? `deposit-apply:${input.bookingId}:${input.toFolioId}:${movements.n}`;
  const declared = declaredOf(acct);
  const released = releaseShare(declared, amount, balance);
  // Tax the charges will carry on the prepaid net, at today's rules (difference = rate change since receipt).
  const releasedTotal = Object.values(released).reduce((s, v) => s + v, 0);
  let current: DeclaredMap = released;
  let currentNames: Record<string, string> = {};
  if (releasedTotal > 0) {
    const now = await prepaymentTaxes(tx, deps, {
      propertyId: f0.property_id,
      amount: money(amount, acct.currency),
      priceMode: 'inclusive',
      taxGroup: input.taxGroup ?? 'accommodation',
      date: businessDate,
    });
    if (!now.unavailable) {
      current = {};
      for (const t of now.taxes) current[t.accountKey] = (current[t.accountKey] ?? 0) + t.amount.amountMinor;
      currentNames = Object.fromEntries(now.taxes.map((t) => [t.accountKey, t.name]));
    }
  }
  const claim = await claimEntry(tx, {
    legalEntityId: acct.legal_entity_id,
    propertyId: f0.property_id,
    entryType: 'deposit_application',
    businessDate,
    idempotencyKey: key,
    requestHash: hash,
    source: { type: 'booking', id: input.bookingId },
    description: `Deposit applied to folio (booking ${input.bookingId})`,
  });
  if (!claim.claimed) {
    return {
      entryId: claim.entryId,
      applied: money(amount, acct.currency),
      postingIds: await postingIdsOfEntry(tx, claim.entryId),
      replayed: true,
    };
  }
  const locked = (await lockMoneyFolios(tx, deps, [f0.id])).get(f0.id) as FolioRow;
  const { folio } = await prepareDestination(tx, locked, 'payment');
  const cur = acct.currency;
  const sub = { type: 'booking_deposit' as const, id: input.bookingId };
  const postings: PostingDraft[] = [
    {
      folioId: folio.id,
      kind: 'deposit_application',
      amountMinor: -amount,
      currency: cur,
      description: 'Deposit applied',
      source: { type: 'booking', id: input.bookingId },
      counterAccountId: await accountId(tx, deps, acct.legal_entity_id, 'deposits_held'),
    },
  ];
  const lines: LineDraft[] = [
    { accountKey: 'deposits_held', amountMinor: amount, currency: cur, subLedger: sub },
    {
      accountKey: 'guest_ledger',
      amountMinor: -amount,
      currency: cur,
      subLedger: { type: 'folio', id: folio.id },
      postingIndex: 0,
    },
  ];
  const taxes: Array<DeclaredTax & { currentMinor: number }> = [];
  // The declared rule (name, rate, version) of each tax key, from the deposits received (F-05: label credits by
  // the rule that was declared, not by today's rule).
  const received = await db(tx)
    .selectFrom('finance.deposit_movements')
    .select('taxes')
    .where('deposit_account_id', '=', acct.id)
    .where('kind', 'in', ['received', 'opening_balance'])
    .orderBy('created_at', 'desc')
    .execute();
  const declaredRule = new Map<string, DeclaredTax>();
  for (const m of received) {
    for (const t of (m.taxes ?? []) as DeclaredTax[])
      if (!declaredRule.has(t.accountKey)) declaredRule.set(t.accountKey, t);
  }
  const taxAccounts = new Map<string, string>();
  for (const k of new Set([...Object.keys(released), ...Object.keys(current)])) {
    taxAccounts.set(k, await accountId(tx, deps, acct.legal_entity_id, taxAccountKey(k)));
  }
  for (const k of new Set([...Object.keys(released), ...Object.keys(current)])) {
    const dep = released[k] ?? 0;
    // A difference of one minor unit is rounding (inclusive vs exclusive computation), not a rate change.
    const now = Math.abs((current[k] ?? 0) - dep) <= 1 ? dep : (current[k] ?? 0);
    if (dep !== 0)
      lines.push({
        accountKey: 'deposit_tax_declared',
        amountMinor: -dep,
        currency: cur,
        subLedger: sub,
        memo: 'release of tax declared on deposit',
      });
    if (now !== 0)
      lines.push({
        accountKey: taxAccountKey(k),
        amountMinor: now,
        currency: cur,
        memo: 'tax already declared at deposit (time of supply)',
      });
    const diff = now - dep;
    if (diff !== 0) {
      const idx = postings.length;
      const rule = declaredRule.get(k);
      // A tax line (not value): the prepaid part keeps the tax declared at receipt (time of supply).
      postings.push({
        folioId: folio.id,
        kind: 'adjustment',
        originKind: 'tax',
        amountMinor: -diff,
        currency: cur,
        description: `${rule?.name ?? currentNames[k] ?? k} declared on the deposit${rule?.rate ? ` at ${rule.rate}` : ''}: prepaid part keeps the rate in force when it was paid`,
        source: { type: 'booking', id: input.bookingId },
        taxKind: 'tax',
        taxName: `${rule?.name ?? k} (rate at deposit${rule?.rate ? ` ${rule.rate}` : ''})`,
        taxRate: rule?.rate ?? null,
        taxRuleId: rule?.ruleId || null,
        taxRuleVersionId: rule?.ruleVersionId || null,
        counterAccountId: taxAccounts.get(k) ?? null,
      });
      lines.push({
        accountKey: 'guest_ledger',
        amountMinor: -diff,
        currency: cur,
        subLedger: { type: 'folio', id: folio.id },
        postingIndex: idx,
      });
    }
    const rule = declaredRule.get(k);
    taxes.push({
      accountKey: k,
      ruleId: rule?.ruleId ?? '',
      ruleVersionId: rule?.ruleVersionId ?? '',
      name: rule?.name ?? currentNames[k] ?? k,
      ...(rule?.rate ? { rate: rule.rate } : {}),
      amountMinor: -dep,
      currentMinor: now,
    });
  }
  const postingIds = await writeEntryBody(
    tx,
    deps,
    claim.entryId,
    {
      legalEntityId: acct.legal_entity_id,
      propertyId: f0.property_id,
      businessDate,
      description: 'Deposit application',
    },
    postings,
    lines,
  );
  await db(tx)
    .updateTable('finance.deposit_accounts')
    .set({
      balance_minor: sql`balance_minor - ${amount}`,
      declared_tax: JSON.stringify(subtract(declared, released)),
      version: sql`version + 1`,
    })
    .where('id', '=', acct.id)
    .execute();
  await db(tx)
    .insertInto('finance.deposit_movements')
    .values({
      id: newId(tx.now.getTime()),
      tenant_id: tx.tenantId,
      deposit_account_id: acct.id,
      booking_id: input.bookingId,
      kind: 'applied',
      amount_minor: -amount,
      currency: cur,
      entry_id: claim.entryId,
      folio_id: folio.id,
      payment_ref_type: null,
      payment_ref_id: null,
      taxes: JSON.stringify(taxes),
      business_date: businessDate,
    })
    .execute();
  await tx.audit({
    action: 'finance.deposit.apply',
    target: { type: 'booking', id: input.bookingId },
    propertyId: f0.property_id,
    after: {
      folioId: folio.id,
      amount: money(amount, cur),
      taxReleased: released,
      taxAtServiceRules: current,
    },
  });
  await tx.emit({
    type: 'finance.deposit.applied',
    propertyId: f0.property_id,
    aggregate: { type: 'booking', id: input.bookingId },
    payload: {
      bookingId: input.bookingId,
      folioId: folio.id,
      entryId: claim.entryId,
      amount: money(amount, cur),
    },
  });
  // Review R2-P1-2: a deposit applied to a departed folio lowers what it owes; its balance request follows.
  await syncDepartedFolios(tx, deps, [input.toFolioId], {
    reason: 'Deposit applied',
    entryId: claim.entryId,
    businessDate,
  });
  return { entryId: claim.entryId, applied: money(amount, cur), postingIds, replayed: false };
}

/** Refund (part of) a held deposit — confirmed by payments. Tax declared on the refunded part is released. */
export async function refundDeposit(
  tx: TxContext,
  deps: Deps,
  input: {
    bookingId: string;
    amount: Money;
    refundRef: EntityRef;
    idempotencyKey: string;
    /** The deposit payment being refunded: its method is reused and the refund counts against it. */
    originalPaymentRef?: EntityRef;
    method?: PaymentMethodKind;
    provider?: string;
    cashierSessionId?: string;
    cashWithoutSession?: 'reject' | 'flag';
    /** 'adjusted' when payments corrects a recorded deposit found wrong by reconciliation. */
    movementKind?: 'refunded' | 'adjusted';
  },
): Promise<{ entryId: string; balance: Money; replayed: boolean }> {
  return depositOutflow(tx, deps, { ...input, kind: 'refunded' });
}

/** Forfeit (part of) a deposit to revenue by policy — an explicit entry; the tax declared at receipt stays due. */
export async function forfeitDeposit(
  tx: TxContext,
  deps: Deps,
  input: {
    bookingId: string;
    chargeCode: string;
    amountMinor?: number;
    reason: string;
    idempotencyKey: string;
  },
): Promise<{ entryId: string; balance: Money; replayed: boolean }> {
  return depositOutflow(tx, deps, { ...input, kind: 'forfeited' });
}

async function depositOutflow(
  tx: TxContext,
  deps: Deps,
  input:
    | {
        kind: 'refunded';
        bookingId: string;
        amount: Money;
        refundRef: EntityRef;
        idempotencyKey: string;
        originalPaymentRef?: EntityRef;
        method?: PaymentMethodKind;
        provider?: string;
        cashierSessionId?: string;
        cashWithoutSession?: 'reject' | 'flag';
        movementKind?: 'refunded' | 'adjusted';
      }
    | {
        kind: 'forfeited';
        bookingId: string;
        chargeCode: string;
        amountMinor?: number;
        reason: string;
        idempotencyKey: string;
      },
): Promise<{ entryId: string; balance: Money; replayed: boolean }> {
  const acct0 = await db(tx)
    .selectFrom('finance.deposit_accounts')
    .selectAll()
    .where('booking_id', '=', input.bookingId)
    .executeTakeFirst();
  if (!acct0) throw new BusinessRuleError('no_deposit', 'No deposit is held for this booking.');
  requirePermission(tx, 'finance.posting.create', { propertyId: acct0.property_id });
  const { idempotencyKey, ...rest } = input;
  const hash = requestHash({ op: `deposit-${input.kind}`, ...rest });
  const done = async (entryId: string, replayed: boolean) => {
    const a = await db(tx)
      .selectFrom('finance.deposit_accounts')
      .selectAll()
      .where('id', '=', acct0.id)
      .executeTakeFirstOrThrow();
    return { entryId, balance: money(Number(a.balance_minor), a.currency), replayed };
  };
  const prior = await findEntryByKey(tx, idempotencyKey, hash);
  if (prior) return done(prior, true);
  await deps.ports.platform.assertWritable(tx, acct0.property_id, 'charges');
  const businessDate = await deps.ports.platform.getBusinessDate(tx, acct0.property_id);
  let method: PaymentMethodKind = 'other';
  let provider: string | null = null;
  if (input.kind === 'refunded') {
    const orig = input.originalPaymentRef
      ? await db(tx)
          .selectFrom('finance.deposit_movements')
          .select('payment_method')
          .where('booking_id', '=', input.bookingId)
          .where('kind', '=', 'received')
          .where('payment_ref_type', '=', input.originalPaymentRef.type)
          .where('payment_ref_id', '=', input.originalPaymentRef.id)
          .executeTakeFirst()
      : undefined;
    const decoded = decodeMethod(orig?.payment_method ?? null);
    method = input.method ?? (orig?.payment_method ? decoded.method : 'card');
    provider = input.provider ?? (orig?.payment_method ? decoded.provider : null);
  }
  const sessionId =
    input.kind === 'refunded'
      ? await openSessionFor(tx, acct0.property_id, method, input.cashierSessionId, {
          cashRequiresSession: input.cashWithoutSession !== 'flag',
        })
      : null;
  const claim = await claimEntry(tx, {
    legalEntityId: acct0.legal_entity_id,
    propertyId: acct0.property_id,
    entryType: input.kind === 'refunded' ? 'deposit_refund' : 'deposit_forfeit',
    businessDate,
    idempotencyKey,
    requestHash: hash,
    ...(input.kind === 'refunded'
      ? {
          source: input.refundRef,
          ...(input.originalPaymentRef
            ? { reasonCode: `refund_of:${input.originalPaymentRef.type}:${input.originalPaymentRef.id}` }
            : {}),
        }
      : { reasonCode: 'forfeit' }),
    description:
      input.kind === 'refunded'
        ? `Deposit refund (booking ${input.bookingId})`
        : `Deposit forfeited: ${input.reason}`,
  });
  if (!claim.claimed) return done(claim.entryId, true);
  const acct = (await db(tx)
    .selectFrom('finance.deposit_accounts')
    .selectAll()
    .where('id', '=', acct0.id)
    .forUpdate()
    .executeTakeFirstOrThrow()) as Selectable<DepositAccountsTable>;
  const balance = Number(acct.balance_minor);
  const amount = input.kind === 'refunded' ? input.amount.amountMinor : (input.amountMinor ?? balance);
  if (input.kind === 'refunded' && input.amount.currency !== acct.currency) {
    throw new ValidationError('deposit_currency_mismatch', `Refund the deposit in ${acct.currency}.`);
  }
  if (amount <= 0 || amount > balance) {
    throw new BusinessRuleError(
      'deposit_insufficient',
      `Only ${balance} ${acct.currency} (minor units) of deposit is held for this booking.`,
      { balance },
    );
  }
  const cur = acct.currency;
  const sub = { type: 'booking_deposit' as const, id: input.bookingId };
  const declared = declaredOf(acct);
  const released = releaseShare(declared, amount, balance);
  const releasedTotal = Object.values(released).reduce((s, v) => s + v, 0);
  const lines: Array<LineDraft & { accountId?: string }> = [
    { accountKey: 'deposits_held', amountMinor: amount, currency: cur, subLedger: sub },
  ];
  if (input.kind === 'refunded') {
    lines.push({
      ...clearingSide(method, provider, sessionId),
      amountMinor: -amount,
      currency: cur,
    });
    for (const [k, v] of Object.entries(released)) {
      if (v === 0) continue;
      lines.push({ accountKey: 'deposit_tax_declared', amountMinor: -v, currency: cur, subLedger: sub });
      lines.push({
        accountKey: taxAccountKey(k),
        amountMinor: v,
        currency: cur,
        memo: 'tax credit on refunded deposit',
      });
    }
  } else {
    const code = await chargeCodeByCode(tx, acct.property_id, input.chargeCode);
    const revenue =
      code.revenue_account_id ??
      (await accountId(tx, deps, acct.legal_entity_id, `revenue:${code.charge_group}`));
    lines.push({
      accountKey: '',
      accountId: revenue,
      amountMinor: -(amount - releasedTotal),
      currency: cur,
      chargeCode: code.code,
    });
    for (const [k, v] of Object.entries(released)) {
      if (v !== 0)
        lines.push({
          accountKey: 'deposit_tax_declared',
          amountMinor: -v,
          currency: cur,
          subLedger: sub,
          memo: `tax declared on deposit stays due (${k})`,
        });
    }
  }
  await writeEntryBody(
    tx,
    deps,
    claim.entryId,
    {
      legalEntityId: acct.legal_entity_id,
      propertyId: acct.property_id,
      businessDate,
      description: 'Deposit outflow',
    },
    [],
    lines,
  );
  await db(tx)
    .updateTable('finance.deposit_accounts')
    .set({
      balance_minor: sql`balance_minor - ${amount}`,
      declared_tax: JSON.stringify(subtract(declared, released)),
      version: sql`version + 1`,
    })
    .where('id', '=', acct.id)
    .execute();
  await db(tx)
    .insertInto('finance.deposit_movements')
    .values({
      id: newId(tx.now.getTime()),
      tenant_id: tx.tenantId,
      deposit_account_id: acct.id,
      booking_id: input.bookingId,
      kind: input.kind === 'refunded' ? (input.movementKind ?? 'refunded') : input.kind,
      amount_minor: -amount,
      currency: cur,
      entry_id: claim.entryId,
      folio_id: null,
      payment_ref_type: input.kind === 'refunded' ? input.refundRef.type : null,
      payment_ref_id: input.kind === 'refunded' ? input.refundRef.id : null,
      taxes: JSON.stringify(Object.entries(released).map(([k, v]) => ({ accountKey: k, amountMinor: -v }))),
      business_date: businessDate,
    })
    .execute();
  if (sessionId && method === 'cash') {
    await recordCashMovement(tx, {
      sessionId,
      kind: 'refund',
      amount: money(-amount, cur),
      entryId: claim.entryId,
      reference: `deposit refund ${input.bookingId}`,
    });
  }
  await tx.audit({
    action: input.kind === 'refunded' ? 'finance.deposit.refund' : 'finance.deposit.forfeit',
    target: { type: 'booking', id: input.bookingId },
    propertyId: acct.property_id,
    ...(input.kind === 'forfeited' ? { reason: input.reason } : {}),
    after: { amount: money(amount, cur), taxReleased: released },
  });
  await tx.emit({
    type: input.kind === 'refunded' ? 'finance.deposit.refunded' : 'finance.deposit.forfeited',
    propertyId: acct.property_id,
    aggregate: { type: 'booking', id: input.bookingId },
    payload: { bookingId: input.bookingId, entryId: claim.entryId, amount: money(amount, cur) },
  });
  return done(claim.entryId, false);
}

export async function getDeposits(tx: TxContext, bookingId: string): Promise<DepositSummary | null> {
  const acct = await db(tx)
    .selectFrom('finance.deposit_accounts')
    .selectAll()
    .where('booking_id', '=', bookingId)
    .executeTakeFirst();
  if (!acct) return null;
  requirePermission(tx, 'finance.folio.read', { propertyId: acct.property_id });
  const mv = await db(tx)
    .selectFrom('finance.deposit_movements')
    .selectAll()
    .where('deposit_account_id', '=', acct.id)
    .orderBy('created_at')
    .execute();
  return {
    bookingId,
    balance: { amountMinor: Number(acct.balance_minor), currency: acct.currency },
    movements: mv.map((m) => ({
      kind: m.kind,
      amount: { amountMinor: Number(m.amount_minor), currency: m.currency },
      folioId: m.folio_id,
      businessDate: m.business_date,
      entryId: m.entry_id,
    })),
  };
}

// ───────────────────────────── Opening balances (scenario 18) ─────────────────────────────

/**
 * Import the previous system's deposit balances as opening balances (migration). Imported amounts are posted
 * against a migration suspense account; the reconciliation report compares the imported total with the closing
 * balance the previous system reported. A difference is reported and raised as an exception — never plugged.
 */
export async function importOpeningDeposits(
  tx: TxContext,
  deps: Deps,
  input: OpeningDepositsInput & { idempotencyKey: string },
): Promise<OpeningImportReport> {
  requirePermission(tx, 'finance.openingBalance.import', { propertyId: input.propertyId });
  const existing = await db(tx)
    .selectFrom('finance.opening_balance_imports')
    .selectAll()
    .where('import_ref', '=', input.importRef)
    .executeTakeFirst();
  if (existing) return existing.report as OpeningImportReport;
  await deps.ports.platform.assertWritable(tx, input.propertyId, 'accounting');
  const property = await deps.ports.platform.getProperty(tx, input.propertyId);
  const businessDate = await deps.ports.platform.getBusinessDate(tx, input.propertyId);
  const rejected: OpeningImportReport['rejected'] = [];
  const seen = new Set<string>();
  const accepted: Array<{ bookingId: string; amountMinor: number; taxes: DeclaredTax[] }> = [];
  await functionalCurrencyOf(tx, deps, property.legalEntityId); // chart seeded
  const taxAccounts = new Set(
    (
      await db(tx)
        .selectFrom('finance.accounts')
        .select('system_key')
        .where('legal_entity_id', '=', property.legalEntityId)
        .where('system_key', 'like', 'tax:%')
        .execute()
    ).map((a) => a.system_key),
  );
  // R3-P2-3: every booking of the file is locked (in one order) before any "held elsewhere" check.
  for (const id of [...new Set(input.items.map((it) => it.bookingId))].sort()) {
    await lockBookingDeposits(tx, id);
  }
  let legacyCount = 0;
  for (const [i, it] of input.items.entries()) {
    if (seen.has(it.bookingId)) {
      rejected.push({
        row: i + 1,
        bookingId: it.bookingId,
        reason: 'Duplicate booking in this file — only the first row was imported.',
      });
      continue;
    }
    if (it.amountMinor <= 0) {
      rejected.push({
        row: i + 1,
        bookingId: it.bookingId,
        reason:
          'A held deposit must be positive. Check the source system for refunds or overdrafts on this booking.',
      });
      continue;
    }
    // Review R2-P1-3: a deposit account exists only for a booking its owning module confirms belongs to this
    // property (and legal entity), or — explicitly flagged — for a booking not migrated yet (frozen for new money).
    const booking = await deps.ports.bookings.describeBooking(tx, it.bookingId);
    if (booking && booking.propertyId !== input.propertyId) {
      rejected.push({
        row: i + 1,
        bookingId: it.bookingId,
        reason:
          'This booking belongs to another property in Portico. Import its deposit at the property that owns the booking.',
      });
      continue;
    }
    if (!booking && !it.legacyNotMigrated) {
      rejected.push({
        row: i + 1,
        bookingId: it.bookingId,
        reason:
          'Portico has no booking with this id. Import the bookings first, or mark the row legacyNotMigrated to carry the deposit as a legacy balance (no new money is taken for it until the booking is migrated).',
      });
      continue;
    }
    const held = await db(tx)
      .selectFrom('finance.deposit_accounts')
      .select(['property_id', 'legal_entity_id'])
      .where('booking_id', '=', it.bookingId)
      .executeTakeFirst();
    if (held && (held.property_id !== input.propertyId || held.legal_entity_id !== property.legalEntityId)) {
      rejected.push({
        row: i + 1,
        bookingId: it.bookingId,
        reason: "This booking's deposits are already held at another property or hotel company.",
      });
      continue;
    }
    const taxes: DeclaredTax[] = (it.declaredTaxes ?? [])
      .filter((t) => t.amountMinor > 0)
      .map((t) => ({
        accountKey: normalizeLedgerKey(t.accountKey),
        ruleId: `opening:${normalizeLedgerKey(t.accountKey)}`,
        ruleVersionId: t.ruleVersionId ?? `opening:${input.importRef}`,
        name: t.name,
        ...(t.rate ? { rate: t.rate } : {}),
        amountMinor: t.amountMinor,
      }));
    const unknown = taxes.filter((t) => !taxAccounts.has(taxAccountKey(t.accountKey)));
    if (unknown.length) {
      rejected.push({
        row: i + 1,
        bookingId: it.bookingId,
        reason: `Declared tax ${unknown.map((t) => `"${t.accountKey}"`).join(', ')} is not a tax account in the chart. Map it to an existing tax account (e.g. tgst) and import the row again.`,
      });
      continue;
    }
    if (taxes.reduce((s, t) => s + t.amountMinor, 0) >= it.amountMinor) {
      rejected.push({
        row: i + 1,
        bookingId: it.bookingId,
        reason: 'The tax declared on this deposit is not smaller than the deposit. Check the source system.',
      });
      continue;
    }
    seen.add(it.bookingId);
    if (!booking) legacyCount++;
    accepted.push({ bookingId: it.bookingId, amountMinor: it.amountMinor, taxes });
  }
  const total = accepted.reduce((s, a) => s + a.amountMinor, 0);
  const difference = input.providedClosingMinor - total;
  const importId = newId(tx.now.getTime());
  let entryId: string | null = null;
  if (accepted.length) {
    const claim = await claimEntry(tx, {
      legalEntityId: property.legalEntityId,
      propertyId: input.propertyId,
      entryType: 'opening_balance',
      businessDate,
      idempotencyKey: `opening:deposits:${input.importRef}`,
      requestHash: requestHash(input),
      source: { type: 'opening_balance_import', id: importId },
      description: `Opening deposit balances imported (${input.importRef})`,
      reasonCode: 'migration',
    });
    if (!claim.claimed)
      throw new BusinessRuleError('import_in_progress', 'This import is already being processed.');
    entryId = claim.entryId;
    const lines: LineDraft[] = [
      {
        accountKey: 'migration_suspense',
        amountMinor: total,
        currency: input.currency,
        memo: 'opening deposits',
      },
    ];
    for (const a of accepted) {
      lines.push({
        accountKey: 'deposits_held',
        amountMinor: -a.amountMinor,
        currency: input.currency,
        subLedger: { type: 'booking_deposit', id: a.bookingId },
      });
      // Tax the previous system declared: carried as declared (released at application), its liability is part of
      // the previous system's tax balances, which the general-ledger opening import clears from suspense.
      for (const t of a.taxes) {
        lines.push({
          accountKey: 'deposit_tax_declared',
          amountMinor: t.amountMinor,
          currency: input.currency,
          subLedger: { type: 'booking_deposit', id: a.bookingId },
          memo: `${t.name} declared on deposit by the previous system`,
        });
        lines.push({
          accountKey: 'migration_suspense',
          amountMinor: -t.amountMinor,
          currency: input.currency,
          memo: `${t.name} declared by the previous system`,
        });
      }
    }
    await writeEntryBody(
      tx,
      deps,
      entryId,
      {
        legalEntityId: property.legalEntityId,
        propertyId: input.propertyId,
        businessDate,
        description: 'Opening deposits',
      },
      [],
      lines,
    );
    for (const a of accepted) {
      const acct = (await lockDepositAccount(tx, {
        bookingId: a.bookingId,
        propertyId: input.propertyId,
        legalEntityId: property.legalEntityId,
        currency: input.currency,
        create: true,
      })) as Selectable<DepositAccountsTable>;
      const map = { ...declaredOf(acct) };
      for (const t of a.taxes) map[t.accountKey] = (map[t.accountKey] ?? 0) + t.amountMinor;
      await db(tx)
        .updateTable('finance.deposit_accounts')
        .set({
          balance_minor: sql`balance_minor + ${a.amountMinor}`,
          declared_tax: JSON.stringify(map),
          version: sql`version + 1`,
        })
        .where('id', '=', acct.id)
        .execute();
      await db(tx)
        .insertInto('finance.deposit_movements')
        .values({
          id: newId(tx.now.getTime()),
          tenant_id: tx.tenantId,
          deposit_account_id: acct.id,
          booking_id: a.bookingId,
          kind: 'opening_balance',
          amount_minor: a.amountMinor,
          currency: input.currency,
          entry_id: entryId,
          folio_id: null,
          payment_ref_type: 'opening_balance_import',
          payment_ref_id: importId,
          taxes: JSON.stringify(a.taxes),
          business_date: businessDate,
        })
        .execute();
    }
  }
  const suspense = await db(tx)
    .selectFrom('finance.journal_lines as l')
    .innerJoin('finance.accounts as a', 'a.id', 'l.account_id')
    .select(sql<number>`coalesce(sum(l.amount_minor), 0)::bigint`.as('b'))
    .where('a.legal_entity_id', '=', property.legalEntityId)
    .where('a.system_key', '=', 'migration_suspense')
    .where('l.currency', '=', input.currency)
    .executeTakeFirstOrThrow();
  const status = difference === 0 && rejected.length === 0 ? 'reconciled' : 'difference';
  const report: OpeningImportReport = {
    importId,
    importRef: input.importRef,
    status,
    currency: input.currency,
    importedCount: accepted.length,
    ...(legacyCount ? { legacyCount } : {}),
    importedTotalMinor: total,
    providedClosingMinor: input.providedClosingMinor,
    differenceMinor: difference,
    rejected,
    entryId,
    suspenseBalanceMinor: Number(suspense.b),
    explanation:
      status === 'reconciled'
        ? 'Imported deposits match the closing balance reported by the previous system.'
        : `Imported deposits total ${total} but the previous system reported ${input.providedClosingMinor} (difference ${difference}, ${rejected.length} rejected row(s)). Nothing was adjusted automatically: investigate the listed rows and the previous system's deposit ledger, then import corrections.`,
  };
  await db(tx)
    .insertInto('finance.opening_balance_imports')
    .values({
      id: importId,
      tenant_id: tx.tenantId,
      legal_entity_id: property.legalEntityId,
      property_id: input.propertyId,
      import_ref: input.importRef,
      kind: 'deposits',
      currency: input.currency,
      provided_closing_minor: input.providedClosingMinor,
      imported_total_minor: total,
      difference_minor: difference,
      status,
      entry_id: entryId,
      report: JSON.stringify(report),
      business_date: businessDate,
    })
    .execute();
  if (status === 'difference') {
    await raiseException(tx, {
      propertyId: input.propertyId,
      kind: 'opening_balance_difference',
      severity: 'urgent',
      ref: { type: 'opening_balance_import', id: importId },
      message: report.explanation,
      details: { differenceMinor: difference, rejected: rejected.length, currency: input.currency },
      businessDate,
    });
  }
  await tx.audit({
    action: 'finance.openingBalance.import',
    target: { type: 'opening_balance_import', id: importId },
    propertyId: input.propertyId,
    after: { importRef: input.importRef, status, total, difference, rejected: rejected.length },
  });
  return report;
}
