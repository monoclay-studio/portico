import { explainVersionMiss, type Selectable, sql, type TxContext } from '@portico/db';
import {
  addDays,
  BusinessRuleError,
  ConflictError,
  type LocalDate,
  type Money,
  money,
  NotFoundError,
  newId,
  requirePermission,
  ValidationError,
} from '@portico/kernel';
import type { z } from 'zod';
import type { AgingReport, ReceivablesAccount, receivablesAccountInput, receivablesAccountUpdate } from '../contracts';
import { ageItems } from '../domain/aging';
import type { PaymentMethodKind } from '../domain/types';
import type { ReceivablesAccountsTable } from '../tables';
import { issueInvoice } from './fiscal';
import { receivablesRecord } from './records';
import { settleLocked } from './folios';
import {
  accountId,
  claimEntry,
  type Deps,
  db,
  delegated,
  type FolioRow,
  findEntryByKey,
  folioBalance,
  isUniqueViolation,
  loadFolio,
  lockFolios,
  raiseException,
  requestHash,
  writeEntryBody,
} from './support';
import { clearingSide } from './tender';

async function balanceOf(tx: TxContext, accountIdValue: string): Promise<number> {
  const r = await db(tx)
    .selectFrom('finance.receivables_items')
    .select(sql<number>`coalesce(sum(amount_minor), 0)::bigint`.as('b'))
    .where('account_id', '=', accountIdValue)
    .executeTakeFirstOrThrow();
  return Number(r.b);
}

async function toAccount(tx: TxContext, r: Selectable<ReceivablesAccountsTable>): Promise<ReceivablesAccount> {
  const balance = await balanceOf(tx, r.id);
  const limit = r.credit_limit_minor === null ? null : Number(r.credit_limit_minor);
  const overLimit = limit !== null && balance > limit;
  const asOf = tx.now.toISOString().slice(0, 10);
  const aging = await receivablesAgingRows(tx, r.id, asOf);
  return {
    id: r.id,
    legalEntityId: r.legal_entity_id,
    companyId: r.company_id,
    kind: r.kind,
    name: r.name,
    currency: r.currency,
    termsDays: r.terms_days,
    creditLimitMinor: limit,
    creditLimitMode: r.credit_limit_mode,
    status: { account: r.status, credit: limit === null ? 'no_limit' : overLimit ? 'over_limit' : 'within_limit' },
    balance: { amountMinor: balance, currency: r.currency },
    version: r.version,
    ...receivablesRecord(tx, {
      id: r.id,
      companyId: r.company_id,
      kind: r.kind,
      name: r.name,
      status: r.status,
      overLimit,
      balanceMinor: balance,
      limitMinor: limit,
      currency: r.currency,
      over90Minor: aging.buckets.over_90,
    }),
  };
}

async function receivablesAgingRows(tx: TxContext, accountIdValue: string, asOf: LocalDate) {
  const items = await db(tx).selectFrom('finance.receivables_items').selectAll().where('account_id', '=', accountIdValue).where('business_date', '<=', asOf).execute();
  const allocs = await db(tx).selectFrom('finance.receivables_allocations').selectAll().where('account_id', '=', accountIdValue).where('business_date', '<=', asOf).execute();
  return ageItems(
    items.map((i) => ({
      id: i.id,
      dueDate: i.due_date,
      businessDate: i.business_date,
      amountMinor: Number(i.amount_minor),
      allocatedMinor: allocs.filter((x) => x.debit_item_id === i.id || x.credit_item_id === i.id).reduce((s, x) => s + Number(x.amount_minor), 0),
    })),
    asOf,
  );
}

export async function createReceivablesAccount(
  tx: TxContext,
  deps: Deps,
  input: z.infer<typeof receivablesAccountInput>,
): Promise<ReceivablesAccount> {
  requirePermission(tx, 'finance.receivables.manage');
  await deps.ports.platform.getLegalEntity(tx, input.legalEntityId);
  try {
    const row = await db(tx)
      .insertInto('finance.receivables_accounts')
      .values({
        id: newId(),
        tenant_id: tx.tenantId,
        legal_entity_id: input.legalEntityId,
        company_id: input.companyId,
        kind: input.kind,
        name: input.name,
        currency: input.currency,
        terms_days: input.termsDays,
        credit_limit_minor: input.creditLimitMinor ?? null,
        credit_limit_mode: input.creditLimitMode ?? 'block',
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    await tx.audit({ action: 'finance.receivables.createAccount', target: { type: 'receivables_account', id: row.id }, after: input });
    return toAccount(tx, row);
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new ConflictError('receivables_account_exists', 'This company already has a receivables account with this legal entity.');
    }
    throw err;
  }
}

export async function updateReceivablesAccount(
  tx: TxContext,
  id: string,
  expectedVersion: number,
  patch: z.infer<typeof receivablesAccountUpdate>,
): Promise<ReceivablesAccount> {
  requirePermission(tx, 'finance.receivables.manage');
  const current = await db(tx).selectFrom('finance.receivables_accounts').selectAll().where('id', '=', id).executeTakeFirst();
  if (!current) throw new NotFoundError('receivables_account', id);
  if (patch.status === 'closed' && (await balanceOf(tx, id)) !== 0) {
    throw new BusinessRuleError('receivables_balance_not_zero', 'An account can only be closed at zero balance.');
  }
  const row = await db(tx)
    .updateTable('finance.receivables_accounts')
    .set({
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.termsDays !== undefined ? { terms_days: patch.termsDays } : {}),
      ...(patch.creditLimitMinor !== undefined ? { credit_limit_minor: patch.creditLimitMinor } : {}),
      ...(patch.creditLimitMode !== undefined ? { credit_limit_mode: patch.creditLimitMode } : {}),
      ...(patch.status !== undefined ? { status: patch.status } : {}),
      version: sql`version + 1`,
    })
    .where('id', '=', id)
    .where('version', '=', expectedVersion)
    .returningAll()
    .executeTakeFirst();
  if (!row) return explainVersionMiss('receivables_account', id, expectedVersion, async () => current.version);
  const after = await toAccount(tx, row);
  await tx.audit({ action: 'finance.receivables.updateAccount', target: { type: 'receivables_account', id }, before: await toAccount(tx, current), after });
  return after;
}

export async function getReceivablesAccount(tx: TxContext, id: string): Promise<ReceivablesAccount> {
  requirePermission(tx, 'finance.receivables.read');
  const row = await db(tx).selectFrom('finance.receivables_accounts').selectAll().where('id', '=', id).executeTakeFirst();
  if (!row) throw new NotFoundError('receivables_account', id);
  return toAccount(tx, row);
}

export async function listReceivablesAccounts(tx: TxContext, legalEntityId: string): Promise<ReceivablesAccount[]> {
  requirePermission(tx, 'finance.receivables.read');
  const rows = await db(tx).selectFrom('finance.receivables_accounts').selectAll().where('legal_entity_id', '=', legalEntityId).orderBy('name').execute();
  return Promise.all(rows.map((r) => toAccount(tx, r)));
}

export async function listReceivablesItems(tx: TxContext, id: string) {
  requirePermission(tx, 'finance.receivables.read');
  const items = await db(tx).selectFrom('finance.receivables_items').selectAll().where('account_id', '=', id).orderBy('business_date').orderBy('created_at').execute();
  const allocs = await db(tx).selectFrom('finance.receivables_allocations').selectAll().where('account_id', '=', id).execute();
  return items.map((i) => ({
    id: i.id,
    kind: i.kind,
    amount: { amountMinor: Number(i.amount_minor), currency: i.currency },
    businessDate: i.business_date,
    dueDate: i.due_date,
    documentId: i.document_id,
    folioId: i.folio_id,
    reference: i.reference,
    allocatedMinor: allocs
      .filter((a) => a.debit_item_id === i.id || a.credit_item_id === i.id)
      .reduce((s, a) => s + Number(a.amount_minor), 0),
  }));
}

/**
 * Settle a folio's balance to a company/agency receivables account (direct bill). Issues the invoice for any
 * un-invoiced charges, checks the credit limit (block or warn), moves the balance from the guest ledger to the
 * city ledger and settles the folio.
 */
export async function transferToReceivables(
  tx: TxContext,
  deps: Deps,
  input: { folioId: string; receivablesAccountId: string; overrideCreditLimit?: boolean; idempotencyKey: string },
): Promise<{ entryId: string; itemId: string; amount: Money; creditWarning: string | null; replayed: boolean }> {
  const f0 = await loadFolio(tx, input.folioId);
  requirePermission(tx, 'finance.folio.settleToReceivables', { propertyId: f0.property_id });
  const { idempotencyKey, ...rest } = input;
  const hash = requestHash({ op: 'to-receivables', ...rest });
  const replay = async (entryId: string) => {
    const item = await db(tx).selectFrom('finance.receivables_items').selectAll().where('entry_id', '=', entryId).executeTakeFirstOrThrow();
    return { entryId, itemId: item.id, amount: money(Number(item.amount_minor), item.currency), creditWarning: null, replayed: true };
  };
  const prior = await findEntryByKey(tx, idempotencyKey, hash);
  if (prior) return replay(prior);
  await deps.ports.platform.assertWritable(tx, f0.property_id, 'charges');
  const acct0 = await db(tx).selectFrom('finance.receivables_accounts').selectAll().where('id', '=', input.receivablesAccountId).forUpdate().executeTakeFirst();
  if (!acct0) throw new NotFoundError('receivables_account', input.receivablesAccountId);
  if (acct0.status !== 'active') {
    throw new BusinessRuleError('receivables_account_not_active', `The receivables account of ${acct0.name} is ${acct0.status.replace('_', ' ')}; new direct-bill transfers are not accepted.`);
  }
  if (acct0.legal_entity_id !== f0.legal_entity_id) {
    throw new BusinessRuleError('intercompany_transfer', 'The receivables account belongs to another legal entity.');
  }
  if (acct0.currency !== f0.currency) {
    throw new BusinessRuleError('receivables_currency_mismatch', `The receivables account is kept in ${acct0.currency}; the folio is in ${f0.currency}.`);
  }
  const folio = (await lockFolios(tx, [f0.id])).get(f0.id) as FolioRow;
  if (folio.status !== 'open') throw new BusinessRuleError('folio_not_open', 'Only an open folio can be transferred to a receivables account.');
  // Invoice whatever is not invoiced yet (the receivables item references the invoice).
  const uninvoiced = await db(tx)
    .selectFrom('finance.postings as p')
    .leftJoin('finance.posting_document_locks as l', 'l.posting_id', 'p.id')
    .select('p.id')
    .where('p.folio_id', '=', folio.id)
    .where('l.posting_id', 'is', null)
    .where('p.kind', 'not in', ['payment', 'refund', 'deposit_application', 'receivables_transfer'])
    .limit(1)
    .executeTakeFirst();
  const invoice = uninvoiced
    ? await issueInvoice(delegated(tx, ['finance.invoice.issue']), deps, { folioId: folio.id, idempotencyKey: `${idempotencyKey}:invoice` })
    : null;
  const amount = await folioBalance(tx, folio.id);
  if (amount <= 0) {
    throw new BusinessRuleError('nothing_to_transfer', 'The folio has no balance due to transfer to the receivables account.');
  }
  const current = await balanceOf(tx, acct0.id);
  let creditWarning: string | null = null;
  if (acct0.credit_limit_minor !== null && current + amount > Number(acct0.credit_limit_minor)) {
    const msg = `This transfer takes ${acct0.name} to ${current + amount} against a credit limit of ${acct0.credit_limit_minor} ${acct0.currency} (minor units).`;
    if (acct0.credit_limit_mode === 'block') {
      if (!input.overrideCreditLimit) {
        throw new BusinessRuleError('credit_limit_exceeded', `${msg} A manager with credit-limit override permission can approve it, or collect payment instead.`, {
          limitMinor: Number(acct0.credit_limit_minor),
          balanceMinor: current,
          transferMinor: amount,
        });
      }
      requirePermission(tx, 'finance.creditLimit.override', { propertyId: folio.property_id });
      creditWarning = `${msg} Approved by override.`;
    } else {
      creditWarning = `${msg} The limit is advisory for this account.`;
    }
  }
  const businessDate = await deps.ports.platform.getBusinessDate(tx, folio.property_id);
  const claim = await claimEntry(tx, {
    legalEntityId: folio.legal_entity_id,
    propertyId: folio.property_id,
    entryType: 'receivables_transfer',
    businessDate,
    idempotencyKey,
    requestHash: hash,
    source: { type: 'receivables_account', id: acct0.id },
    description: `Direct bill to ${acct0.name}`,
  });
  if (!claim.claimed) return replay(claim.entryId);
  await writeEntryBody(
    tx,
    deps,
    claim.entryId,
    { legalEntityId: folio.legal_entity_id, propertyId: folio.property_id, businessDate, description: 'Direct bill' },
    [
      {
        folioId: folio.id,
        kind: 'receivables_transfer',
        amountMinor: -amount,
        currency: folio.currency,
        description: `Transferred to receivables account — ${acct0.name}${invoice ? ` (invoice ${invoice.documentNumber})` : ''}`,
        counterAccountId: await accountId(tx, deps, folio.legal_entity_id, 'receivables'),
      },
    ],
    [
      { accountKey: 'receivables', amountMinor: amount, currency: folio.currency, subLedger: { type: 'receivables_account', id: acct0.id } },
      { accountKey: 'guest_ledger', amountMinor: -amount, currency: folio.currency, subLedger: { type: 'folio', id: folio.id }, postingIndex: 0 },
    ],
  );
  const itemId = newId(tx.now.getTime());
  const lastInvoice = invoice
    ? invoice.id
    : ((await db(tx).selectFrom('finance.fiscal_documents').select('id').where('folio_id', '=', folio.id).where('kind', '=', 'invoice').orderBy('chain_position', 'desc').limit(1).executeTakeFirst())?.id ?? null);
  await db(tx)
    .insertInto('finance.receivables_items')
    .values({
      id: itemId,
      tenant_id: tx.tenantId,
      account_id: acct0.id,
      kind: 'invoice',
      amount_minor: amount,
      currency: folio.currency,
      business_date: businessDate,
      due_date: addDays(businessDate, acct0.terms_days),
      document_id: lastInvoice,
      folio_id: folio.id,
      entry_id: claim.entryId,
      reference: invoice?.documentNumber ?? null,
    })
    .execute();
  await settleLocked(tx, await loadFolio(tx, folio.id));
  if (creditWarning) {
    await raiseException(tx, {
      propertyId: folio.property_id,
      kind: 'credit_limit_exceeded',
      severity: 'routine',
      ref: { type: 'receivables_account', id: acct0.id },
      message: creditWarning,
      details: { entryId: claim.entryId },
      businessDate,
    });
  }
  await tx.audit({
    action: 'finance.receivables.transfer',
    target: { type: 'receivables_account', id: acct0.id },
    propertyId: folio.property_id,
    after: { folioId: folio.id, amount: money(amount, folio.currency), invoice: invoice?.documentNumber ?? null, creditWarning },
  });
  await tx.emit({
    type: 'finance.receivables.transferred',
    propertyId: folio.property_id,
    aggregate: { type: 'receivables_account', id: acct0.id },
    payload: { accountId: acct0.id, folioId: folio.id, entryId: claim.entryId, amount: money(amount, folio.currency) },
  });
  return { entryId: claim.entryId, itemId, amount: money(amount, folio.currency), creditWarning, replayed: false };
}

/** Record a payment received on a receivables account, with optional allocation to open invoices. */
export async function recordReceivablesPayment(
  tx: TxContext,
  deps: Deps,
  input: {
    accountId: string;
    amount: Money;
    method: PaymentMethodKind;
    provider?: string;
    reference?: string;
    allocations?: Array<{ itemId: string; amountMinor: number }>;
    idempotencyKey: string;
  },
): Promise<{ entryId: string; itemId: string; unallocated: Money; replayed: boolean }> {
  requirePermission(tx, 'finance.receivables.manage');
  if (input.amount.amountMinor <= 0) throw new ValidationError('invalid_amount', 'A payment must be positive.');
  const { idempotencyKey, ...rest } = input;
  const hash = requestHash({ op: 'receivables-payment', ...rest });
  const replay = async (entryId: string) => {
    const item = await db(tx).selectFrom('finance.receivables_items').selectAll().where('entry_id', '=', entryId).executeTakeFirstOrThrow();
    const alloc = await db(tx).selectFrom('finance.receivables_allocations').select(sql<number>`coalesce(sum(amount_minor),0)::bigint`.as('a')).where('credit_item_id', '=', item.id).executeTakeFirstOrThrow();
    return { entryId, itemId: item.id, unallocated: money(-Number(item.amount_minor) - Number(alloc.a), item.currency), replayed: true };
  };
  const prior = await findEntryByKey(tx, idempotencyKey, hash);
  if (prior) return replay(prior);
  const acct = await db(tx).selectFrom('finance.receivables_accounts').selectAll().where('id', '=', input.accountId).forUpdate().executeTakeFirst();
  if (!acct) throw new NotFoundError('receivables_account', input.accountId);
  if (acct.currency !== input.amount.currency) {
    throw new ValidationError('receivables_currency_mismatch', `Payments on this account are recorded in ${acct.currency}.`);
  }
  if (input.method === 'cash') {
    throw new ValidationError('cash_not_supported', 'Record cash received for an account at the desk through a cashier session folio payment, or as a bank deposit.');
  }
  const le = await deps.ports.platform.getLegalEntity(tx, acct.legal_entity_id);
  const businessDate = tx.now.toISOString().slice(0, 10);
  const claim = await claimEntry(tx, {
    legalEntityId: acct.legal_entity_id,
    propertyId: null,
    entryType: 'receivables_payment',
    businessDate,
    idempotencyKey,
    requestHash: hash,
    source: { type: 'receivables_account', id: acct.id },
    description: `Payment from ${acct.name}${input.reference ? ` (${input.reference})` : ''}`,
  });
  if (!claim.claimed) return replay(claim.entryId);
  await writeEntryBody(tx, deps, claim.entryId, { legalEntityId: le.id, propertyId: null, businessDate, description: 'Receivables payment' }, [], [
    { ...clearingSide(input.method, input.provider ?? null, null), amountMinor: input.amount.amountMinor, currency: acct.currency },
    { accountKey: 'receivables', amountMinor: -input.amount.amountMinor, currency: acct.currency, subLedger: { type: 'receivables_account', id: acct.id } },
  ]);
  const itemId = newId(tx.now.getTime());
  await db(tx)
    .insertInto('finance.receivables_items')
    .values({
      id: itemId,
      tenant_id: tx.tenantId,
      account_id: acct.id,
      kind: 'payment',
      amount_minor: -input.amount.amountMinor,
      currency: acct.currency,
      business_date: businessDate,
      due_date: null,
      document_id: null,
      folio_id: null,
      entry_id: claim.entryId,
      reference: input.reference ?? null,
    })
    .execute();
  const allocated = await allocate(tx, acct.id, itemId, input.amount.amountMinor, input.allocations ?? [], businessDate);
  await tx.audit({ action: 'finance.receivables.payment', target: { type: 'receivables_account', id: acct.id }, after: { amount: input.amount, allocations: input.allocations ?? [] } });
  await tx.emit({
    type: 'finance.receivables.paymentRecorded',
    aggregate: { type: 'receivables_account', id: acct.id },
    payload: { accountId: acct.id, entryId: claim.entryId, amount: input.amount },
  });
  return { entryId: claim.entryId, itemId, unallocated: money(input.amount.amountMinor - allocated, acct.currency), replayed: false };
}

async function openAmount(tx: TxContext, itemId: string, side: 'debit' | 'credit'): Promise<number> {
  const item = await db(tx).selectFrom('finance.receivables_items').selectAll().where('id', '=', itemId).executeTakeFirstOrThrow();
  const col = side === 'debit' ? 'debit_item_id' : 'credit_item_id';
  const a = await db(tx).selectFrom('finance.receivables_allocations').select(sql<number>`coalesce(sum(amount_minor),0)::bigint`.as('a')).where(col, '=', itemId).executeTakeFirstOrThrow();
  return Math.abs(Number(item.amount_minor)) - Number(a.a);
}

async function allocate(
  tx: TxContext,
  accountIdValue: string,
  creditItemId: string,
  creditAmount: number,
  allocations: ReadonlyArray<{ itemId: string; amountMinor: number }>,
  businessDate: LocalDate,
): Promise<number> {
  let total = 0;
  for (const a of allocations) {
    const item = await db(tx).selectFrom('finance.receivables_items').selectAll().where('id', '=', a.itemId).executeTakeFirst();
    if (!item || item.account_id !== accountIdValue || Number(item.amount_minor) <= 0) {
      throw new ValidationError('invalid_allocation', 'Allocate payments only to open invoices of the same account.', { itemId: a.itemId });
    }
    const open = await openAmount(tx, a.itemId, 'debit');
    if (a.amountMinor > open) {
      throw new BusinessRuleError('allocation_exceeds_open_amount', `Only ${open} (minor units) of this invoice is still open.`, { itemId: a.itemId, open });
    }
    total += a.amountMinor;
    if (total > creditAmount) throw new BusinessRuleError('allocation_exceeds_payment', 'Allocations exceed the payment amount.');
    await db(tx)
      .insertInto('finance.receivables_allocations')
      .values({ id: newId(tx.now.getTime()), tenant_id: tx.tenantId, account_id: accountIdValue, debit_item_id: a.itemId, credit_item_id: creditItemId, amount_minor: a.amountMinor, business_date: businessDate })
      .execute();
  }
  return total;
}

/** Allocate an earlier payment's unallocated credit to open invoices. */
export async function allocateReceivablesPayment(
  tx: TxContext,
  input: { accountId: string; paymentItemId: string; allocations: Array<{ itemId: string; amountMinor: number }> },
): Promise<{ unallocated: number }> {
  requirePermission(tx, 'finance.receivables.manage');
  await db(tx).selectFrom('finance.receivables_accounts').select('id').where('id', '=', input.accountId).forUpdate().executeTakeFirstOrThrow();
  const credit = await db(tx).selectFrom('finance.receivables_items').selectAll().where('id', '=', input.paymentItemId).executeTakeFirst();
  if (!credit || credit.account_id !== input.accountId || Number(credit.amount_minor) >= 0) {
    throw new ValidationError('invalid_payment_item', 'Choose a payment of this account.');
  }
  const open = await openAmount(tx, credit.id, 'credit');
  const allocated = await allocate(tx, input.accountId, credit.id, open, input.allocations, tx.now.toISOString().slice(0, 10));
  await tx.audit({ action: 'finance.receivables.allocate', target: { type: 'receivables_account', id: input.accountId }, after: input });
  return { unallocated: open - allocated };
}

/** Aging as of a date (buckets by due date: current, 1–30, 31–60, 61–90, over 90). */
export async function receivablesAging(tx: TxContext, input: { legalEntityId: string; asOf: LocalDate; accountId?: string }): Promise<AgingReport> {
  requirePermission(tx, 'finance.receivables.read');
  let q = db(tx).selectFrom('finance.receivables_accounts').selectAll().where('legal_entity_id', '=', input.legalEntityId);
  if (input.accountId) q = q.where('id', '=', input.accountId);
  const accounts = await q.orderBy('name').execute();
  const out: AgingReport['accounts'] = [];
  for (const a of accounts) {
    const summary = await receivablesAgingRows(tx, a.id, input.asOf);
    out.push({ accountId: a.id, name: a.name, currency: a.currency, ...summary });
  }
  return { asOf: input.asOf, accounts: out };
}

