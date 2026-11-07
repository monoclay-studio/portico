import { explainVersionMiss, sql, type TxContext } from '@portico/db';
import { addDays, BusinessRuleError, type LocalDate, NotFoundError, newId, requirePermission } from '@portico/kernel';
import type { DailyRevenue, FinanceException, IntegrityReport, TrialBalance, UnbalancedItem } from '../contracts';
import { imbalances } from '../domain/ledger';
import { actorKey, type Deps, db, functionalCurrencyOf } from './support';

/** Real-time trial balance in the functional currency (optionally as of a business date). */
export async function trialBalance(tx: TxContext, deps: Deps, input: { legalEntityId: string; asOf?: LocalDate }): Promise<TrialBalance> {
  requirePermission(tx, 'finance.ledger.read');
  const functional = await functionalCurrencyOf(tx, deps, input.legalEntityId);
  let q = db(tx)
    .selectFrom('finance.accounts as a')
    .leftJoin(
      (eb) => {
        let inner = eb
          .selectFrom('finance.journal_lines as l')
          .innerJoin('finance.journal_entries as e', 'e.id', 'l.entry_id')
          .select([
            'l.account_id',
            sql<number>`coalesce(sum(case when l.functional_amount_minor > 0 then l.functional_amount_minor else 0 end), 0)::bigint`.as('dr'),
            sql<number>`coalesce(sum(case when l.functional_amount_minor < 0 then -l.functional_amount_minor else 0 end), 0)::bigint`.as('cr'),
          ])
          .where('l.legal_entity_id', '=', input.legalEntityId)
          .groupBy('l.account_id');
        if (input.asOf) inner = inner.where('e.business_date', '<=', input.asOf);
        return inner.as('t');
      },
      (join) => join.onRef('t.account_id', '=', 'a.id'),
    )
    .select(['a.id', 'a.code', 'a.name', 'a.type', 'a.system_key', 't.dr', 't.cr'])
    .where('a.legal_entity_id', '=', input.legalEntityId)
    .orderBy('a.code');
  q = q.where((eb) => eb.or([eb('t.dr', 'is not', null), eb('a.active', '=', true)]));
  const rows = await q.execute();
  const accounts = rows.map((r) => {
    const dr = Number(r.dr ?? 0);
    const cr = Number(r.cr ?? 0);
    return { accountId: r.id, code: r.code, name: r.name, type: r.type, systemKey: r.system_key, debitMinor: dr, creditMinor: cr, balanceMinor: dr - cr };
  });
  const totalDebitMinor = accounts.reduce((s, a) => s + a.debitMinor, 0);
  const totalCreditMinor = accounts.reduce((s, a) => s + a.creditMinor, 0);
  return {
    legalEntityId: input.legalEntityId,
    functionalCurrency: functional,
    asOf: input.asOf ?? null,
    accounts,
    totalDebitMinor,
    totalCreditMinor,
    balanced: totalDebitMinor === totalCreditMinor,
  };
}

/** Revenue and taxes posted on a business date at a property, with restatements relating to that date. */
export async function dailyRevenue(tx: TxContext, deps: Deps, input: { propertyId: string; businessDate: LocalDate }): Promise<DailyRevenue> {
  requirePermission(tx, 'finance.report.read', { propertyId: input.propertyId });
  const property = await deps.ports.platform.getProperty(tx, input.propertyId);
  const functional = await functionalCurrencyOf(tx, deps, property.legalEntityId);
  const base = db(tx)
    .selectFrom('finance.journal_lines as l')
    .innerJoin('finance.journal_entries as e', 'e.id', 'l.entry_id')
    .innerJoin('finance.accounts as a', 'a.id', 'l.account_id')
    .where('e.property_id', '=', input.propertyId)
    .where('e.business_date', '=', input.businessDate);
  const revenue = await base
    .select(['a.code', sql<string>`coalesce(l.charge_code, '—')`.as('charge_code'), sql<number>`-sum(l.functional_amount_minor)::bigint`.as('net')])
    .where('a.type', '=', 'revenue')
    .groupBy(['a.code', sql`coalesce(l.charge_code, '—')`])
    .orderBy('a.code')
    .execute();
  const taxes = await base
    .select(['a.code', 'a.name', sql<number>`-sum(l.functional_amount_minor)::bigint`.as('amount')])
    .where('a.system_key', 'like', 'tax:%')
    .groupBy(['a.code', 'a.name'])
    .orderBy('a.code')
    .execute();
  const restatements = await db(tx)
    .selectFrom('finance.journal_entries as e')
    .innerJoin('finance.journal_lines as l', 'l.entry_id', 'e.id')
    .innerJoin('finance.accounts as a', 'a.id', 'l.account_id')
    .select(['e.id', 'e.relates_to_business_date', 'e.reason_code', sql<number>`-sum(l.functional_amount_minor)::bigint`.as('amount')])
    .where('e.property_id', '=', input.propertyId)
    .where('a.type', '=', 'revenue')
    .where((eb) =>
      eb.or([
        eb('e.relates_to_business_date', '=', input.businessDate),
        eb.and([eb('e.business_date', '=', input.businessDate), eb('e.relates_to_business_date', 'is not', null)]),
      ]),
    )
    .groupBy(['e.id', 'e.relates_to_business_date', 'e.reason_code'])
    .execute();
  return {
    propertyId: input.propertyId,
    businessDate: input.businessDate,
    currency: functional,
    byChargeCode: revenue.map((r) => ({ chargeCode: r.charge_code, accountCode: r.code, netMinor: Number(r.net) })),
    taxes: taxes.map((t) => ({ accountCode: t.code, name: t.name, amountMinor: Number(t.amount) })),
    totalRevenueMinor: revenue.reduce((s, r) => s + Number(r.net), 0),
    restatements: restatements.map((r) => ({ entryId: r.id, relatesTo: r.relates_to_business_date as string, reason: r.reason_code, amountMinor: Number(r.amount) })),
  };
}

export async function listExceptions(tx: TxContext, input: { propertyId: string; status?: 'open' | 'resolved' }): Promise<FinanceException[]> {
  requirePermission(tx, 'finance.folio.read', { propertyId: input.propertyId });
  const rows = await db(tx)
    .selectFrom('finance.exceptions')
    .selectAll()
    .where('property_id', '=', input.propertyId)
    .where('status', '=', input.status ?? 'open')
    .orderBy('created_at')
    .execute();
  return rows.map((r) => ({
    id: r.id,
    propertyId: r.property_id,
    kind: r.kind,
    severity: r.severity,
    ref: { type: r.ref_type, id: r.ref_id },
    message: r.message,
    details: (r.details ?? {}) as Record<string, unknown>,
    status: r.status,
    businessDate: r.business_date,
    createdAt: new Date(r.created_at).toISOString(),
    version: r.version,
  }));
}

export async function resolveException(tx: TxContext, input: { id: string; expectedVersion: number; resolution: string }): Promise<void> {
  const row = await db(tx).selectFrom('finance.exceptions').selectAll().where('id', '=', input.id).executeTakeFirst();
  if (!row) throw new NotFoundError('finance_exception', input.id);
  requirePermission(tx, 'finance.posting.create', { propertyId: row.property_id });
  const updated = await db(tx)
    .updateTable('finance.exceptions')
    .set({ status: 'resolved', resolved_at: tx.now, resolution: input.resolution, version: sql`version + 1` })
    .where('id', '=', input.id)
    .where('version', '=', input.expectedVersion)
    .where('status', '=', 'open')
    .executeTakeFirst();
  if (Number(updated.numUpdatedRows) === 0) {
    return explainVersionMiss('finance_exception', input.id, input.expectedVersion, async () => row.version);
  }
  await tx.audit({ action: 'finance.exception.resolve', target: { type: 'finance_exception', id: input.id }, propertyId: row.property_id, reason: input.resolution });
}

/** Folios whose service is complete (owner departed, or non-stay folios) with charges not invoiced within 3 days. */
export async function invoicesOverdueForIssue(
  tx: TxContext,
  input: { propertyId: string; businessDate: LocalDate; deadlineDays?: number },
): Promise<Array<{ folioId: string; payer: string; oldestServiceDate: string; dueBy: string; uninvoicedMinor: number; currency: string }>> {
  const deadline = input.deadlineDays ?? 3;
  const rows = await db(tx)
    .selectFrom('finance.postings as p')
    .innerJoin('finance.folios as f', 'f.id', 'p.folio_id')
    .leftJoin('finance.posting_document_locks as l', 'l.posting_id', 'p.id')
    .leftJoin('finance.owner_departures as d', (j) => j.onRef('d.owner_type', '=', 'f.owner_type').onRef('d.owner_id', '=', 'f.owner_id'))
    .select([
      'f.id',
      'f.payer_name',
      'f.currency',
      'f.owner_type',
      sql<string>`min(coalesce(p.service_date, p.business_date))::text`.as('oldest'),
      sql<string | null>`max(d.departed_on)::text`.as('departed'),
      sql<number>`sum(p.amount_minor)::bigint`.as('amt'),
    ])
    .where('f.property_id', '=', input.propertyId)
    .where('l.posting_id', 'is', null)
    .where('p.kind', 'in', ['charge', 'tax', 'adjustment', 'transfer_in', 'transfer_out', 'paid_out'])
    .groupBy(['f.id', 'f.payer_name', 'f.currency', 'f.owner_type'])
    .execute();
  const out = [];
  for (const r of rows) {
    if (Number(r.amt) === 0) continue;
    const completed = r.owner_type === 'stay' || r.owner_type === 'booking' ? r.departed : r.oldest;
    if (!completed) continue;
    const dueBy = addDays(completed, deadline);
    if (dueBy < input.businessDate) {
      out.push({ folioId: r.id, payer: r.payer_name, oldestServiceDate: r.oldest, dueBy, uninvoicedMinor: Number(r.amt), currency: r.currency });
    }
  }
  return out;
}

/**
 * Day Close checks (provider contract `getUnbalancedItems`): anything that must be resolved or acknowledged
 * before the business date advances. Integrity breaches are blocking; operational follow-ups are warnings.
 */
export async function getUnbalancedItems(tx: TxContext, deps: Deps, input: { propertyId: string; businessDate: LocalDate }): Promise<UnbalancedItem[]> {
  requirePermission(tx, 'finance.report.read', { propertyId: input.propertyId });
  const items: UnbalancedItem[] = [];
  // 1. Unbalanced entries (must never happen — the database refuses them; checked as an alarm).
  const lines = await db(tx)
    .selectFrom('finance.journal_lines as l')
    .innerJoin('finance.journal_entries as e', 'e.id', 'l.entry_id')
    .select(['l.entry_id', 'l.currency', 'l.amount_minor', 'l.functional_amount_minor'])
    .where('e.property_id', '=', input.propertyId)
    .where('e.business_date', '=', input.businessDate)
    .execute();
  const byEntry = new Map<string, Array<{ currency: string; amountMinor: number; functionalAmountMinor: number; accountKey: string }>>();
  for (const l of lines) {
    const list = byEntry.get(l.entry_id) ?? [];
    list.push({ currency: l.currency, amountMinor: Number(l.amount_minor), functionalAmountMinor: Number(l.functional_amount_minor), accountKey: '' });
    byEntry.set(l.entry_id, list);
  }
  for (const [entryId, ls] of byEntry) {
    const diff = imbalances(ls);
    if (diff.length) items.push({ code: 'entry_unbalanced', severity: 'blocking', ref: { type: 'journal_entry', id: entryId }, message: 'A journal entry does not balance. Contact support immediately.', details: { imbalances: diff } });
  }
  // 2. Folio balance ≠ its guest-ledger sub-account (projection drift — must never happen).
  const drift = await sql<{ folio_id: string; postings: string; ledger: string }>`
    select f.id as folio_id,
           coalesce((select sum(p.amount_minor) from finance.postings p where p.folio_id = f.id), 0) as postings,
           coalesce((select sum(l.amount_minor) from finance.journal_lines l where l.sub_ledger_type = 'folio' and l.sub_ledger_id = f.id), 0) as ledger
      from finance.folios f where f.property_id = ${input.propertyId}`.execute(tx.db);
  for (const r of drift.rows) {
    if (Number(r.postings) !== Number(r.ledger)) {
      items.push({ code: 'folio_ledger_mismatch', severity: 'blocking', ref: { type: 'folio', id: r.folio_id }, message: 'Folio balance differs from its ledger sub-account.', details: { postings: Number(r.postings), ledger: Number(r.ledger) } });
    }
  }
  // 3. Departed owners with a balance; settled/closed folios with a balance.
  const balances = await sql<{ id: string; payer_name: string; status: string; currency: string; balance: string; departed: string | null }>`
    select f.id, f.payer_name, f.status, f.currency,
           coalesce((select sum(p.amount_minor) from finance.postings p where p.folio_id = f.id), 0) as balance,
           d.departed_on::text as departed
      from finance.folios f
      left join finance.owner_departures d on d.owner_type = f.owner_type and d.owner_id = f.owner_id
     where f.property_id = ${input.propertyId} and f.status <> 'voided'`.execute(tx.db);
  for (const r of balances.rows) {
    const b = Number(r.balance);
    if (b === 0) continue;
    if (r.status === 'settled' || r.status === 'closed') {
      items.push({ code: 'settled_folio_with_balance', severity: 'blocking', ref: { type: 'folio', id: r.id }, message: `A ${r.status} folio of ${r.payer_name} has a balance.`, details: { balanceMinor: b, currency: r.currency } });
    } else if (r.departed) {
      items.push({ code: 'departed_with_balance', severity: 'warning', ref: { type: 'folio', id: r.id }, message: `${r.payer_name} has departed with an open balance. Collect payment or transfer it to a receivables account.`, details: { balanceMinor: b, currency: r.currency, departedOn: r.departed } });
    }
  }
  // 4. Open cashier sessions.
  const sessions = await db(tx).selectFrom('finance.cashier_sessions').select(['id', 'cashier_name', 'opened_business_date']).where('property_id', '=', input.propertyId).where('status', '=', 'open').execute();
  for (const s of sessions) {
    items.push({ code: 'cashier_session_open', severity: 'warning', ref: { type: 'cashier_session', id: s.id }, message: `${s.cashier_name}'s cashier session is still open.`, details: { openedBusinessDate: s.opened_business_date } });
  }
  // 5. Negative deposit balances (integrity alarm — the database forbids them).
  const neg = await db(tx).selectFrom('finance.deposit_accounts').select(['booking_id', 'balance_minor']).where('property_id', '=', input.propertyId).where('balance_minor', '<', 0).execute();
  for (const n of neg) items.push({ code: 'negative_deposit', severity: 'blocking', ref: { type: 'booking', id: n.booking_id }, message: 'A deposit balance is negative.', details: { balanceMinor: Number(n.balance_minor) } });
  // 6. Open finance exceptions (late charges, collection follow-ups, import differences…).
  for (const e of await listExceptions(tx, { propertyId: input.propertyId })) {
    items.push({ code: `exception:${e.kind}`, severity: 'warning', ref: e.ref, message: e.message, details: { exceptionId: e.id, ...e.details } });
  }
  // 7. Invoices overdue for issue (Maldives: within 3 days of completing the service).
  for (const o of await invoicesOverdueForIssue(tx, input)) {
    items.push({ code: 'invoice_overdue_for_issue', severity: 'warning', ref: { type: 'folio', id: o.folioId }, message: `Issue the tax invoice for ${o.payer}: the service was completed and the invoice was due by ${o.dueBy}.`, details: o });
  }
  // 8. Suspense and unmapped-tax balances.
  const property = await deps.ports.platform.getProperty(tx, input.propertyId);
  const susp = await db(tx)
    .selectFrom('finance.journal_lines as l')
    .innerJoin('finance.accounts as a', 'a.id', 'l.account_id')
    .select(['a.system_key', 'l.currency', sql<number>`sum(l.amount_minor)::bigint`.as('b')])
    .where('a.legal_entity_id', '=', property.legalEntityId)
    .where('a.system_key', 'in', ['suspense', 'tax:unmapped', 'migration_suspense'])
    .groupBy(['a.system_key', 'l.currency'])
    .execute();
  for (const s of susp) {
    if (Number(s.b) !== 0) {
      items.push({ code: 'suspense_balance', severity: 'warning', ref: null, message: `Account ${s.system_key} holds ${s.b} ${s.currency} (minor units) awaiting review.`, details: { systemKey: s.system_key, balanceMinor: Number(s.b), currency: s.currency } });
    }
  }
  return items;
}

/** Control accounts vs sub-ledgers (FIN-I14) and trial balance (FIN-I02). */
export async function integrityReport(tx: TxContext, deps: Deps, legalEntityId: string): Promise<IntegrityReport> {
  requirePermission(tx, 'finance.ledger.read');
  const tb = await trialBalance(tx, deps, { legalEntityId });
  const control = async (key: string) => {
    const r = await db(tx)
      .selectFrom('finance.journal_lines as l')
      .innerJoin('finance.accounts as a', 'a.id', 'l.account_id')
      .select(sql<number>`coalesce(sum(l.amount_minor), 0)::bigint`.as('b'))
      .where('a.legal_entity_id', '=', legalEntityId)
      .where('a.system_key', '=', key)
      .executeTakeFirstOrThrow();
    return Number(r.b);
  };
  const sumOf = async (q: Promise<{ b: number | string | null } | undefined>) => Number((await q)?.b ?? 0);
  const folios = await sumOf(
    db(tx).selectFrom('finance.postings').select(sql<number>`coalesce(sum(amount_minor), 0)::bigint`.as('b')).where('legal_entity_id', '=', legalEntityId).executeTakeFirst(),
  );
  const deposits = await sumOf(
    db(tx).selectFrom('finance.deposit_accounts').select(sql<number>`coalesce(sum(balance_minor), 0)::bigint`.as('b')).where('legal_entity_id', '=', legalEntityId).executeTakeFirst(),
  );
  const receivables = await sumOf(
    db(tx)
      .selectFrom('finance.receivables_items as i')
      .innerJoin('finance.receivables_accounts as a', 'a.id', 'i.account_id')
      .select(sql<number>`coalesce(sum(i.amount_minor), 0)::bigint`.as('b'))
      .where('a.legal_entity_id', '=', legalEntityId)
      .executeTakeFirst(),
  );
  const allowanceOutstanding = await sumOf(
    db(tx)
      .selectFrom('finance.allowance_instances')
      .select(sql<number>`coalesce(sum(granted_minor - used_minor), 0)::bigint`.as('b'))
      .where('legal_entity_id', '=', legalEntityId)
      .where('status', 'in', ['active', 'consumed'])
      .executeTakeFirst(),
  );
  const checks = [
    { check: 'trial_balance_balanced', ok: tb.balanced, expectedMinor: tb.totalDebitMinor, actualMinor: tb.totalCreditMinor, detail: 'Σ debits = Σ credits (functional currency)' },
    { check: 'guest_ledger_equals_folios', expectedMinor: await control('guest_ledger'), actualMinor: folios, detail: 'Guest ledger control = Σ folio balances' },
    { check: 'deposits_equal_booking_balances', expectedMinor: -(await control('deposits_held')), actualMinor: deposits, detail: 'Deposits held control = Σ booking deposit balances' },
    { check: 'receivables_equal_accounts', expectedMinor: await control('receivables'), actualMinor: receivables, detail: 'City ledger control = Σ receivables accounts' },
    { check: 'allowance_clearing_equals_outstanding', expectedMinor: -(await control('allowance_clearing')), actualMinor: allowanceOutstanding, detail: 'Allowance clearing = Σ unused open allowances' },
  ].map((c) => ({ ...c, ok: 'ok' in c ? (c.ok as boolean) : c.expectedMinor === c.actualMinor }));
  return { legalEntityId, checks, ok: checks.every((c) => c.ok) };
}

/**
 * Monthly Green Tax (per-person-per-day levy) projection per legal entity: guest-days, exempt guest-days and
 * amounts by rate category and property, from the levy postings (service-date month), in the functional
 * currency (USD for Maldives tourism-sector reporting). Corrections are included with their sign.
 */
export async function greenTaxReport(
  tx: TxContext,
  deps: Deps,
  input: { legalEntityId: string; month: string; accountKey?: string },
): Promise<{
  legalEntityId: string;
  month: string;
  currency: string;
  rows: Array<{ propertyId: string; rateCategory: string; rate: string | null; guestDays: number; exemptGuestDays: number; amountMinor: number }>;
  totalMinor: number;
}> {
  requirePermission(tx, 'finance.ledger.read');
  if (!/^\d{4}-\d{2}$/.test(input.month)) throw new BusinessRuleError('invalid_month', 'Give the month as YYYY-MM.');
  const from = `${input.month}-01`;
  const to = `${addDays(from, 31).slice(0, 7)}-01`;
  const functional = await functionalCurrencyOf(tx, deps, input.legalEntityId);
  const key = `tax:${input.accountKey ?? 'green_tax'}`;
  const rows = await db(tx)
    .selectFrom('finance.postings as p')
    .innerJoin('finance.accounts as a', 'a.id', 'p.counter_account_id')
    .innerJoin('finance.journal_lines as l', 'l.posting_id', 'p.id')
    .select([
      'p.property_id',
      sql<string>`coalesce(p.tax_rate_category, 'uncategorized')`.as('cat'),
      'p.tax_rate',
      sql<string>`coalesce(sum(p.tax_units), 0)`.as('units'),
      sql<string>`coalesce(sum(p.tax_exempt_units), 0)`.as('exempt'),
      sql<number>`sum(l.functional_amount_minor)::bigint`.as('amt'),
    ])
    .where('p.legal_entity_id', '=', input.legalEntityId)
    .where('a.system_key', '=', key)
    .where('p.service_date', '>=', from)
    .where('p.service_date', '<', to)
    .where('p.kind', 'in', ['tax', 'adjustment'])
    .groupBy(['p.property_id', sql`coalesce(p.tax_rate_category, 'uncategorized')`, 'p.tax_rate'])
    .orderBy('p.property_id')
    .execute();
  const out = rows.map((r) => ({
    propertyId: r.property_id,
    rateCategory: r.cat,
    rate: r.tax_rate,
    guestDays: Number(r.units),
    exemptGuestDays: Number(r.exempt),
    amountMinor: Number(r.amt),
  }));
  return { legalEntityId: input.legalEntityId, month: input.month, currency: functional, rows: out, totalMinor: out.reduce((s, r) => s + r.amountMinor, 0) };
}

// ───────────────────────────── Retention (≥ 5 years after tax-year end; legal holds extend) ─────────────────────────────

export async function placeLegalHold(tx: TxContext, input: { legalEntityId: string; reason: string }): Promise<{ id: string }> {
  requirePermission(tx, 'finance.ledger.manage');
  const id = newId(tx.now.getTime());
  await db(tx)
    .insertInto('finance.legal_holds')
    .values({ id, tenant_id: tx.tenantId, legal_entity_id: input.legalEntityId, reason: input.reason, placed_by: actorKey(tx), placed_at: tx.now, released_by: null, released_at: null, release_reason: null })
    .execute();
  await tx.audit({ action: 'finance.legalHold.place', target: { type: 'legal_hold', id }, reason: input.reason, after: input });
  return { id };
}

export async function releaseLegalHold(tx: TxContext, input: { holdId: string; reason: string }): Promise<void> {
  requirePermission(tx, 'finance.ledger.manage');
  const r = await db(tx)
    .updateTable('finance.legal_holds')
    .set({ released_at: tx.now, released_by: actorKey(tx), release_reason: input.reason, version: sql`version + 1` })
    .where('id', '=', input.holdId)
    .where('released_at', 'is', null)
    .executeTakeFirst();
  if (Number(r.numUpdatedRows) === 0) throw new NotFoundError('legal_hold', input.holdId);
  await tx.audit({ action: 'finance.legalHold.release', target: { type: 'legal_hold', id: input.holdId }, reason: input.reason });
}

/**
 * Retention status of a legal entity's financial records on a date. Portico never deletes financial records in
 * this wave; this answers "could anything be purged yet, and what holds it" for a future retention job.
 */
export async function retentionStatus(
  tx: TxContext,
  input: { legalEntityId: string; asOf: LocalDate },
): Promise<{ activeHolds: number; earliestRetainUntil: string | null; purgeableDocuments: number }> {
  requirePermission(tx, 'finance.ledger.read');
  const holds = await db(tx).selectFrom('finance.legal_holds').select(sql<number>`count(*)::int`.as('n')).where('legal_entity_id', '=', input.legalEntityId).where('released_at', 'is', null).executeTakeFirstOrThrow();
  const docs = await db(tx)
    .selectFrom('finance.fiscal_documents')
    .select([sql<string | null>`min(retain_until)::text`.as('min'), sql<number>`count(*) filter (where retain_until < ${input.asOf})::int`.as('purgeable')])
    .where('legal_entity_id', '=', input.legalEntityId)
    .executeTakeFirstOrThrow();
  return { activeHolds: holds.n, earliestRetainUntil: docs.min, purgeableDocuments: holds.n > 0 ? 0 : docs.purgeable };
}
