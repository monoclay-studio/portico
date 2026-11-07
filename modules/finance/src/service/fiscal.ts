import { type Selectable, sql, type TxContext } from '@portico/db';
import {
  BusinessRuleError,
  ConflictError,
  convert,
  Decimal,
  IdempotencyConflictError,
  type LocalDate,
  money,
  NotFoundError,
  newId,
  requirePermission,
  ValidationError,
} from '@portico/kernel';
import type { z } from 'zod';
import type { FiscalDocument, FiscalSeries, fiscalSeriesInput } from '../contracts';
import {
  deviationPercent,
  documentHash,
  findNumberingGaps,
  formatDocumentNumber,
  GENESIS_HASH,
  retainUntil,
  verifyChain,
  withinTolerance,
} from '../domain/fiscal';
import { isReferenceRate } from '../domain/fx';
import { categorize, type InvoiceItem, invoiceTotals, taxSummary } from '../domain/invoice';
import { renderTextPdf } from '../domain/pdf';
import type { FiscalDocumentsTable, FiscalSeriesTable } from '../tables';
import { adjustPosting } from './postings';
import { documentRecord } from './records';
import {
  actorKey,
  type Deps,
  db,
  delegated,
  displayName,
  isUniqueViolation,
  loadFolio,
  requestHash,
} from './support';

/** Tolerance between the conversion rate used on an invoice and the central bank (MMA) rate — MIRA ±2%. */
const MV_USD_TOLERANCE_PERCENT = '2';

function toSeries(r: Selectable<FiscalSeriesTable>): FiscalSeries {
  return {
    id: r.id,
    legalEntityId: r.legal_entity_id,
    propertyId: r.property_id,
    kind: r.kind,
    prefix: r.prefix,
    nextNumber: r.next_number,
    active: r.active,
  };
}

export async function createFiscalSeries(
  tx: TxContext,
  deps: Deps,
  input: z.infer<typeof fiscalSeriesInput>,
): Promise<FiscalSeries> {
  requirePermission(tx, 'finance.ledger.manage');
  await deps.ports.platform.getLegalEntity(tx, input.legalEntityId);
  try {
    const row = await db(tx)
      .insertInto('finance.fiscal_series')
      .values({
        id: newId(),
        tenant_id: tx.tenantId,
        legal_entity_id: input.legalEntityId,
        property_id: input.propertyId ?? null,
        kind: input.kind,
        prefix: input.prefix,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    await tx.audit({
      action: 'finance.fiscalSeries.create',
      target: { type: 'fiscal_series', id: row.id },
      after: input,
    });
    return toSeries(row);
  } catch (err) {
    if (isUniqueViolation(err))
      throw new ConflictError(
        'series_exists',
        `A ${input.kind} series with prefix ${input.prefix} already exists.`,
      );
    throw err;
  }
}

export async function listFiscalSeries(tx: TxContext, legalEntityId: string): Promise<FiscalSeries[]> {
  requirePermission(tx, 'finance.ledger.read');
  const rows = await db(tx)
    .selectFrom('finance.fiscal_series')
    .selectAll()
    .where('legal_entity_id', '=', legalEntityId)
    .orderBy('kind')
    .orderBy('prefix')
    .execute();
  return rows.map(toSeries);
}

/** Lock the legal entity's hash chain, then the series row (fixed order → no deadlocks). Gapless numbering. */
async function lockChainAndSeries(
  tx: TxContext,
  legalEntityId: string,
  propertyId: string,
  kind: 'invoice' | 'credit_note',
  seriesId?: string,
): Promise<{ chain: { last_hash: string; document_count: number }; series: Selectable<FiscalSeriesTable> }> {
  await sql`insert into finance.fiscal_chains (tenant_id, legal_entity_id, last_hash) values (${tx.tenantId}, ${legalEntityId}, ${GENESIS_HASH})
    on conflict do nothing`.execute(tx.db);
  const chain = await db(tx)
    .selectFrom('finance.fiscal_chains')
    .select(['last_hash', 'document_count'])
    .where('legal_entity_id', '=', legalEntityId)
    .forUpdate()
    .executeTakeFirstOrThrow();
  let series: Selectable<FiscalSeriesTable> | undefined;
  if (seriesId) {
    series = await db(tx)
      .selectFrom('finance.fiscal_series')
      .selectAll()
      .where('id', '=', seriesId)
      .forUpdate()
      .executeTakeFirst();
    if (!series || series.legal_entity_id !== legalEntityId || series.kind !== kind || !series.active) {
      throw new ValidationError(
        'invalid_series',
        `Choose an active ${kind.replace('_', ' ')} series of this legal entity.`,
      );
    }
  } else {
    const pick = () =>
      db(tx)
        .selectFrom('finance.fiscal_series')
        .selectAll()
        .where('legal_entity_id', '=', legalEntityId)
        .where('kind', '=', kind)
        .where('active', '=', true)
        .where((eb) => eb.or([eb('property_id', '=', propertyId), eb('property_id', 'is', null)]))
        .orderBy(sql`property_id is null`)
        .orderBy('created_at')
        .limit(1)
        .forUpdate()
        .executeTakeFirst();
    series = await pick();
    if (!series) {
      await sql`insert into finance.fiscal_series (id, tenant_id, legal_entity_id, kind, prefix)
        values (${newId()}, ${tx.tenantId}, ${legalEntityId}, ${kind}, ${kind === 'invoice' ? 'INV-' : 'CN-'}) on conflict do nothing`.execute(
        tx.db,
      );
      series = await pick();
    }
    if (!series) throw new BusinessRuleError('series_unavailable', 'No document series is available.');
  }
  return { chain: { last_hash: chain.last_hash, document_count: chain.document_count }, series };
}

async function allocateAndInsert(
  tx: TxContext,
  args: {
    legalEntityId: string;
    propertyId: string;
    kind: 'invoice' | 'credit_note';
    seriesId?: string;
    folioId: string;
    originalDocumentId: string | null;
    creditMode: 'cancel' | 'adjust' | null;
    currency: string;
    totalMinor: number;
    businessDate: LocalDate;
    idempotencyKey: string;
    requestHash: string;
    buildSnapshot: (documentNumber: string) => Record<string, unknown>;
    postingIds: readonly string[];
  },
): Promise<Selectable<FiscalDocumentsTable> | { replayId: string }> {
  const { chain, series } = await lockChainAndSeries(
    tx,
    args.legalEntityId,
    args.propertyId,
    args.kind,
    args.seriesId,
  );
  // Re-check the key after taking the locks (a concurrent identical request may have just committed).
  const dup = await db(tx)
    .selectFrom('finance.fiscal_documents')
    .select(['id', 'request_hash'])
    .where('idempotency_key', '=', args.idempotencyKey)
    .executeTakeFirst();
  if (dup) {
    if (dup.request_hash !== args.requestHash)
      throw new IdempotencyConflictError(
        'This idempotency key was already used to issue a different document.',
      );
    return { replayId: dup.id };
  }
  const number = series.next_number;
  const documentNumber = formatDocumentNumber(series.prefix, number);
  const snapshot = { ...args.buildSnapshot(documentNumber), retainUntil: retainUntil(args.businessDate) };
  const position = chain.document_count + 1;
  const hash = documentHash({
    previousHash: chain.last_hash,
    chainPosition: position,
    documentNumber,
    kind: args.kind,
    totalMinor: args.totalMinor,
    currency: args.currency,
    snapshot,
  });
  const id = newId(tx.now.getTime());
  const row = await db(tx)
    .insertInto('finance.fiscal_documents')
    .values({
      id,
      tenant_id: tx.tenantId,
      legal_entity_id: args.legalEntityId,
      property_id: args.propertyId,
      series_id: series.id,
      number,
      document_number: documentNumber,
      kind: args.kind,
      folio_id: args.folioId,
      original_document_id: args.originalDocumentId,
      credit_mode: args.creditMode,
      currency: args.currency,
      total_minor: args.totalMinor,
      snapshot: JSON.stringify(snapshot),
      business_date: args.businessDate,
      issued_at: tx.now,
      idempotency_key: args.idempotencyKey,
      request_hash: args.requestHash,
      chain_position: position,
      previous_hash: chain.last_hash,
      hash,
      issued_by: actorKey(tx),
      retain_until: retainUntil(args.businessDate),
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  await db(tx)
    .updateTable('finance.fiscal_series')
    .set({ next_number: number + 1, version: sql`version + 1` })
    .where('id', '=', series.id)
    .execute();
  await db(tx)
    .updateTable('finance.fiscal_chains')
    .set({ last_hash: hash, document_count: position })
    .where('legal_entity_id', '=', args.legalEntityId)
    .execute();
  if (args.postingIds.length) {
    await db(tx)
      .insertInto('finance.posting_document_locks')
      .values(args.postingIds.map((p) => ({ tenant_id: tx.tenantId, posting_id: p, document_id: id })))
      .execute();
  }
  return row;
}

async function creditedTotal(
  tx: TxContext,
  invoiceId: string,
): Promise<{ total: number; cancelled: boolean }> {
  const rows = await db(tx)
    .selectFrom('finance.fiscal_documents')
    .select(['total_minor', 'credit_mode'])
    .where('original_document_id', '=', invoiceId)
    .execute();
  return {
    total: rows.reduce((s, r) => s + Math.abs(Number(r.total_minor)), 0),
    cancelled: rows.some((r) => r.credit_mode === 'cancel'),
  };
}

async function toDocument(tx: TxContext, r: Selectable<FiscalDocumentsTable>): Promise<FiscalDocument> {
  let status: 'issued' | 'partially_credited' | 'credited' = 'issued';
  let creditNotes: Array<{ id: string; number: string }> = [];
  if (r.kind === 'invoice') {
    const c = await creditedTotal(tx, r.id);
    if (c.cancelled || (c.total > 0 && c.total >= Math.abs(Number(r.total_minor)))) status = 'credited';
    else if (c.total > 0) status = 'partially_credited';
    creditNotes = (
      await db(tx)
        .selectFrom('finance.fiscal_documents')
        .select(['id', 'document_number'])
        .where('original_document_id', '=', r.id)
        .orderBy('chain_position')
        .execute()
    ).map((d) => ({ id: d.id, number: d.document_number }));
  }
  const snapshot = r.snapshot as Record<string, unknown>;
  return {
    id: r.id,
    kind: r.kind,
    documentNumber: r.document_number,
    number: r.number,
    seriesId: r.series_id,
    folioId: r.folio_id,
    originalDocumentId: r.original_document_id,
    creditMode: r.credit_mode,
    total: { amountMinor: Number(r.total_minor), currency: r.currency },
    businessDate: r.business_date,
    issuedAt: new Date(r.issued_at).toISOString(),
    hash: r.hash,
    previousHash: r.previous_hash,
    status: { document: status },
    snapshot,
    ...documentRecord(tx, {
      id: r.id,
      propertyId: r.property_id,
      kind: r.kind,
      status,
      folioId: r.folio_id,
      originalDocumentId: r.original_document_id,
      snapshot,
      creditNotes,
    }),
  };
}

interface ItemRow {
  id: string;
  kind: string;
  amount_minor: number;
  description: string;
  charge_code: string | null;
  service_date: string | null;
  business_date: string;
  quantity: string | null;
  tax_name: string | null;
  tax_rate: string | null;
  tax_rule_id: string | null;
  tax_kind: string | null;
  origin_kind: string | null;
  entry_id: string;
  orig_kind: string | null;
  orig_tax_kind: string | null;
  charge_group: string | null;
}

async function invoiceableItems(
  tx: TxContext,
  folioId: string,
  postingIds?: readonly string[],
): Promise<ItemRow[]> {
  let q = db(tx)
    .selectFrom('finance.postings as p')
    .leftJoin('finance.posting_document_locks as l', 'l.posting_id', 'p.id')
    .leftJoin('finance.postings as o', 'o.id', 'p.corrects_posting_id')
    .leftJoin('finance.charge_codes as c', 'c.id', 'p.charge_code_id')
    .select([
      'p.id',
      'p.kind',
      'p.amount_minor',
      'p.description',
      'p.charge_code',
      'p.service_date',
      'p.business_date',
      'p.quantity',
      'p.tax_name',
      'p.tax_rate',
      'p.tax_rule_id',
      'p.tax_kind',
      'p.origin_kind',
      'p.entry_id',
      'o.kind as orig_kind',
      'o.tax_kind as orig_tax_kind',
      'c.charge_group',
    ])
    .where('p.folio_id', '=', folioId)
    .orderBy('p.created_at')
    .orderBy('p.id');
  q = postingIds ? q.where('p.id', 'in', [...postingIds]) : q.where('l.posting_id', 'is', null);
  return (await q.execute()) as ItemRow[];
}

function toItems(rows: readonly ItemRow[]): InvoiceItem[] {
  return rows.map((r) => {
    // What the line ultimately is (charge, tax, payment, prepayment…) — stored on every derived posting.
    const effectiveKind =
      r.origin_kind ??
      (['transfer_in', 'transfer_out', 'adjustment'].includes(r.kind) && r.orig_kind
        ? r.orig_kind
        : r.kind === 'transfer_in' || r.kind === 'transfer_out'
          ? 'charge'
          : r.kind);
    return {
      postingId: r.id,
      category: categorize({
        kind: r.kind,
        effectiveKind,
        taxKind: r.tax_kind ?? r.orig_tax_kind,
        chargeGroup: r.charge_group,
      }),
      description: r.description,
      chargeCode: r.charge_code,
      date: r.service_date ?? r.business_date,
      quantity: r.quantity === null ? null : String(r.quantity),
      amountMinor: Number(r.amount_minor),
      taxName: r.tax_name,
      taxRate: r.tax_rate,
      taxRuleId: r.tax_rule_id,
    };
  });
}

/** Mandatory tax-invoice particulars; missing supplier particulars block issuance in the live environment. */
function particulars(
  le: { name: string; legalName: string; taxId?: string; address?: Record<string, string> },
  buyer: { name: string; type: string; taxId?: string; address?: string },
): { missing: string[]; warnings: string[] } {
  const missing: string[] = [];
  const warnings: string[] = [];
  if (!le.legalName?.trim()) missing.push('supplier name');
  if (!le.taxId?.trim()) missing.push('supplier tax identification number (TIN)');
  if (!le.address || Object.values(le.address).every((v) => !v?.trim())) missing.push('supplier address');
  if (!buyer.name.trim()) missing.push('buyer name');
  if ((buyer.type === 'company' || buyer.type === 'agency') && !buyer.taxId) {
    warnings.push('Buyer TIN not given — required when the buyer is a GST-registered business.');
  }
  if ((buyer.type === 'company' || buyer.type === 'agency') && !buyer.address) {
    warnings.push('Buyer address not given — required for business buyers.');
  }
  return { missing, warnings };
}

async function usdConversion(
  tx: TxContext,
  legalEntityId: string,
  currency: string,
  date: LocalDate,
  totals: { totalMinor: number; taxChargedMinor: number },
): Promise<Record<string, unknown>> {
  const rows = await db(tx)
    .selectFrom('finance.fx_rates')
    .selectAll()
    .where('legal_entity_id', '=', legalEntityId)
    .where('from_currency', '=', currency)
    .where('to_currency', '=', 'USD')
    .where('business_date', '<=', date)
    .orderBy('business_date', 'desc')
    .execute();
  const mma = rows.find((r) => isReferenceRate(r.source) && r.business_date === date);
  const used = rows.find((r) => !isReferenceRate(r.source) && r.business_date === date) ?? mma;
  if (!mma || !used) {
    throw new BusinessRuleError(
      'usd_conversion_rate_missing',
      `Invoices in ${currency} must show the USD equivalent at the Maldives Monetary Authority rate for the date of supply. Enter today's ${currency}→USD rate with source "MMA" before issuing.`,
      { currency, date },
    );
  }
  const rate = new Decimal(String(used.rate)).toString();
  const mmaRate = new Decimal(String(mma.rate)).toString();
  if (!withinTolerance(rate, mmaRate, MV_USD_TOLERANCE_PERCENT)) {
    throw new BusinessRuleError(
      'usd_conversion_out_of_tolerance',
      `The ${currency}→USD rate ${rate} differs from the MMA rate ${mmaRate} by more than ±${MV_USD_TOLERANCE_PERCENT}%. Correct the rate before issuing.`,
      { rate, mmaRate, deviationPercent: deviationPercent(rate, mmaRate) },
    );
  }
  return {
    rate,
    rateSource: used.source,
    rateDate: used.business_date,
    mmaRate,
    deviationPercent: deviationPercent(rate, mmaRate),
    totalUsdMinor: convert(money(totals.totalMinor, currency), 'USD', rate).amountMinor,
    taxUsdMinor: convert(money(totals.taxChargedMinor, currency), 'USD', rate).amountMinor,
  };
}

export interface IssueInvoiceInput {
  folioId: string;
  seriesId?: string;
  payerDetails?: { name?: string; address?: string; taxId?: string; email?: string };
  idempotencyKey: string;
}

/**
 * Issue a tax invoice for every not-yet-invoiced posting of a folio. Number allocated gaplessly under a series
 * lock inside the transaction; content snapshotted immutably and hash-chained; retries return the same document.
 */
export async function issueInvoice(
  tx: TxContext,
  deps: Deps,
  input: IssueInvoiceInput,
): Promise<FiscalDocument> {
  const folio = await loadFolio(tx, input.folioId);
  requirePermission(tx, 'finance.invoice.issue', { propertyId: folio.property_id });
  const { idempotencyKey, ...rest } = input;
  const hash = requestHash({ op: 'invoice', ...rest });
  const existing = await db(tx)
    .selectFrom('finance.fiscal_documents')
    .selectAll()
    .where('idempotency_key', '=', idempotencyKey)
    .executeTakeFirst();
  if (existing) {
    if (existing.request_hash !== hash)
      throw new IdempotencyConflictError(
        'This idempotency key was already used to issue a different document.',
      );
    return toDocument(tx, existing);
  }
  await deps.ports.platform.assertWritable(tx, folio.property_id, 'charges');
  const property = await deps.ports.platform.getProperty(tx, folio.property_id);
  const le = await deps.ports.platform.getLegalEntity(tx, folio.legal_entity_id);
  const businessDate = await deps.ports.platform.getBusinessDate(tx, folio.property_id);
  const pack = await deps.ports.tax.getRulePackStatus(tx, folio.property_id);
  const live = tx.environment === 'live';
  if (live && !pack.verified) {
    throw new BusinessRuleError(
      'tax_rules_unverified',
      'Invoices cannot be issued in the live environment while the property’s tax rules are unverified. A tax adviser must verify the rule pack first.',
      { note: pack.note ?? null },
    );
  }
  // Buyer name: the folio's, unless it is a placeholder — then the name given now, or the payer directory's.
  let buyerName = folio.payer_name_unresolved ? null : folio.payer_name;
  let named: { name: string; taxId?: string; address?: string } | null = null;
  if (input.payerDetails?.name?.trim()) named = { name: input.payerDetails.name.trim() };
  else if (!buyerName && folio.payer_id && folio.payer_type !== 'house') {
    named = await deps.ports.payers.describePayer(tx, {
      type: folio.payer_type as 'guest' | 'company' | 'agency',
      id: folio.payer_id,
      propertyId: folio.property_id,
    });
  }
  if (named) buyerName = named.name;
  if (!buyerName && live) {
    throw new BusinessRuleError(
      'buyer_name_required',
      `The payer of this folio is only known as "${folio.payer_name}". Enter the buyer's name (and tax number for a business) to issue the tax invoice.`,
      { folioId: folio.id },
    );
  }
  const taxId = input.payerDetails?.taxId ?? named?.taxId;
  const address = input.payerDetails?.address ?? named?.address;
  const buyer = {
    name: buyerName ?? folio.payer_name,
    type: folio.payer_type,
    ...(taxId ? { taxId } : {}),
    ...(address ? { address } : {}),
  };
  const check = particulars(le, buyer);
  if (live && check.missing.length) {
    throw new BusinessRuleError(
      'invoice_particulars_missing',
      `A tax invoice must show: ${check.missing.join(', ')}. Complete the legal entity and payer details, then issue.`,
      { missing: check.missing },
    );
  }
  // Lock the folio so no posting slips in between selection and locking; a concurrent identical request that
  // committed meanwhile is replayed (read committed: this statement sees it).
  await loadFolio(tx, folio.id, { forUpdate: true });
  const raced = await db(tx)
    .selectFrom('finance.fiscal_documents')
    .selectAll()
    .where('idempotency_key', '=', idempotencyKey)
    .executeTakeFirst();
  if (raced) {
    if (raced.request_hash !== hash)
      throw new IdempotencyConflictError(
        'This idempotency key was already used to issue a different document.',
      );
    return toDocument(tx, raced);
  }
  const rows = await invoiceableItems(tx, folio.id);
  const items = toItems(rows);
  if (!items.some((i) => i.category !== 'settlement')) {
    throw new BusinessRuleError(
      'nothing_to_invoice',
      'This folio has no charges that are not already on an issued invoice.',
    );
  }
  const totals = invoiceTotals(items);
  const usd =
    le.countryCode === 'MV' && folio.currency !== 'USD'
      ? await usdConversion(tx, folio.legal_entity_id, folio.currency, businessDate, totals)
      : null;
  const depositEntries = rows.filter((r) => r.kind === 'deposit_application').map((r) => r.entry_id);
  const depositTax = depositEntries.length
    ? await db(tx)
        .selectFrom('finance.deposit_movements')
        .select(['taxes', 'business_date'])
        .where('entry_id', 'in', depositEntries)
        .execute()
    : [];
  const depositTaxCredits = depositTax.flatMap((m) =>
    (
      (m.taxes ?? []) as Array<{
        name: string;
        rate?: string;
        ruleVersionId?: string;
        amountMinor: number;
        currentMinor?: number;
      }>
    ).map((t) => ({
      name: t.name,
      rate: t.rate ?? null,
      ruleVersionId: t.ruleVersionId || null,
      declaredAtDepositMinor: -t.amountMinor,
      appliedOn: m.business_date,
    })),
  );
  const result = await allocateAndInsert(tx, {
    legalEntityId: folio.legal_entity_id,
    propertyId: folio.property_id,
    kind: 'invoice',
    ...(input.seriesId ? { seriesId: input.seriesId } : {}),
    folioId: folio.id,
    originalDocumentId: null,
    creditMode: null,
    currency: folio.currency,
    totalMinor: totals.totalMinor,
    businessDate,
    idempotencyKey,
    requestHash: hash,
    postingIds: items.map((i) => i.postingId),
    buildSnapshot: (documentNumber) => ({
      title: 'Tax Invoice',
      templateVersion: 'tax-invoice-v1',
      documentNumber,
      issueDate: businessDate,
      issuedAt: tx.now.toISOString(),
      supplier: {
        name: le.name,
        legalName: le.legalName,
        taxId: le.taxId ?? null,
        registrationNumber: le.registrationNumber ?? null,
        address: le.address ?? {},
        countryCode: le.countryCode,
      },
      buyer: {
        name: buyer.name,
        type: buyer.type,
        taxId: buyer.taxId ?? null,
        address: buyer.address ?? null,
        email: input.payerDetails?.email ?? null,
      },
      property: { id: property.id, name: property.name },
      folio: {
        id: folio.id,
        label: displayName(folio),
        owner: { type: folio.owner_type, id: folio.owner_id },
      },
      currency: folio.currency,
      lines: items.filter((i) => i.category !== 'settlement'),
      taxSummary: taxSummary(items),
      settlements: items.filter((i) => i.category === 'settlement'),
      depositTaxCredits,
      totals,
      usdConversion: usd,
      taxRulePack: { verified: pack.verified, note: pack.note ?? null },
      environment: tx.environment,
      sample: !live,
      particularsWarnings: [...check.warnings, ...check.missing.map((m) => `Missing: ${m}`)],
    }),
  });
  if ('replayId' in result) {
    return toDocument(
      tx,
      await db(tx)
        .selectFrom('finance.fiscal_documents')
        .selectAll()
        .where('id', '=', result.replayId)
        .executeTakeFirstOrThrow(),
    );
  }
  await tx.audit({
    action: 'finance.invoice.issue',
    target: { type: 'fiscal_document', id: result.id },
    propertyId: folio.property_id,
    after: { documentNumber: result.document_number, total: totals.totalMinor },
  });
  if (folio.payer_name_unresolved && named) {
    // The buyer named for the invoice becomes the folio's payer name (it was a placeholder).
    await db(tx)
      .updateTable('finance.folios')
      .set({
        payer_name: named.name,
        payer_name_unresolved: false,
        updated_at: tx.now,
        version: sql`version + 1`,
      })
      .where('id', '=', folio.id)
      .execute();
    await tx.audit({
      action: 'finance.folio.payerNamed',
      target: { type: 'folio', id: folio.id },
      propertyId: folio.property_id,
      before: { payerName: folio.payer_name },
      after: { payerName: named.name },
    });
  }
  await tx.emit({
    type: 'finance.invoice.issued',
    propertyId: folio.property_id,
    aggregate: { type: 'fiscal_document', id: result.id },
    payload: {
      documentId: result.id,
      documentNumber: result.document_number,
      folioId: folio.id,
      total: { amountMinor: totals.totalMinor, currency: folio.currency },
    },
  });
  return toDocument(tx, result);
}

export interface CreditNoteInput {
  invoiceId: string;
  mode: 'cancel' | 'adjust';
  reason: string;
  lines?: Array<{ postingId: string; amountMinor?: number }>;
  seriesId?: string;
  idempotencyKey: string;
}

/**
 * Issue a credit note referencing an invoice. `cancel`: the whole invoice is cancelled (e.g. wrong payer
 * details) and its postings can be invoiced again; `adjust`: selected charges are corrected by linked
 * adjustment postings which the credit note documents. The original invoice never changes.
 */
export async function issueCreditNote(
  tx: TxContext,
  deps: Deps,
  input: CreditNoteInput,
): Promise<FiscalDocument> {
  const inv = await db(tx)
    .selectFrom('finance.fiscal_documents')
    .selectAll()
    .where('id', '=', input.invoiceId)
    .executeTakeFirst();
  if (inv?.kind !== 'invoice') throw new NotFoundError('invoice', input.invoiceId);
  requirePermission(tx, 'finance.creditNote.issue', { propertyId: inv.property_id });
  const { idempotencyKey, ...rest } = input;
  const hash = requestHash({ op: 'credit-note', ...rest });
  // Lock the invoice's folio BEFORE checking how much is already credited: concurrent credit notes serialize
  // here, so an invoice can never be credited beyond its total.
  await loadFolio(tx, inv.folio_id, { forUpdate: true });
  const existing = await db(tx)
    .selectFrom('finance.fiscal_documents')
    .selectAll()
    .where('idempotency_key', '=', idempotencyKey)
    .executeTakeFirst();
  if (existing) {
    if (existing.request_hash !== hash)
      throw new IdempotencyConflictError(
        'This idempotency key was already used to issue a different document.',
      );
    return toDocument(tx, existing);
  }
  await deps.ports.platform.assertWritable(tx, inv.property_id, 'charges');
  const credited = await creditedTotal(tx, inv.id);
  if (credited.cancelled || credited.total >= Math.abs(Number(inv.total_minor))) {
    throw new BusinessRuleError(
      'invoice_already_credited',
      `Invoice ${inv.document_number} is already fully credited.`,
    );
  }
  const businessDate = await deps.ports.platform.getBusinessDate(tx, inv.property_id);
  const original = inv.snapshot as Record<string, unknown>;
  let postingIds: string[] = [];
  let items: InvoiceItem[];
  if (input.mode === 'cancel') {
    if (input.lines)
      throw new ValidationError(
        'cancel_is_full',
        'A cancelling credit note always covers the whole invoice; omit lines.',
      );
    if (credited.total > 0)
      throw new BusinessRuleError(
        'invoice_partially_credited',
        'This invoice already has a credit note; credit the remaining lines with an adjusting credit note.',
      );
    items = ((original.lines ?? []) as InvoiceItem[]).map((i) => ({ ...i, amountMinor: -i.amountMinor }));
  } else {
    const locked = await db(tx)
      .selectFrom('finance.posting_document_locks as l')
      .innerJoin('finance.postings as p', 'p.id', 'l.posting_id')
      .select(['p.id', 'p.kind'])
      .where('l.document_id', '=', inv.id)
      .execute();
    const charges = locked.filter((p) => p.kind === 'charge').map((p) => p.id);
    const lines: Array<{ postingId: string; amountMinor?: number }> =
      input.lines ?? charges.map((postingId) => ({ postingId }));
    if (lines.length === 0)
      throw new ValidationError('nothing_to_credit', 'Choose at least one charge of the invoice to credit.');
    for (const l of lines) {
      if (!charges.includes(l.postingId)) {
        throw new ValidationError(
          'posting_not_on_invoice',
          'Each credited line must be a charge on this invoice.',
          { postingId: l.postingId },
        );
      }
      const res = await adjustPosting(delegated(tx, ['finance.posting.correct'], inv.property_id), deps, {
        postingId: l.postingId,
        ...(l.amountMinor !== undefined ? { amountMinor: l.amountMinor } : {}),
        reasonCode: 'credit_note',
        note: input.reason,
        idempotencyKey: `${idempotencyKey}:adj:${l.postingId}`,
        allowInvoiced: true,
      });
      postingIds.push(...res.postingIds);
    }
    items = toItems(await invoiceableItems(tx, inv.folio_id, postingIds));
  }
  const totals = invoiceTotals(items);
  const result = await allocateAndInsert(tx, {
    legalEntityId: inv.legal_entity_id,
    propertyId: inv.property_id,
    kind: 'credit_note',
    ...(input.seriesId ? { seriesId: input.seriesId } : {}),
    folioId: inv.folio_id,
    originalDocumentId: inv.id,
    creditMode: input.mode,
    currency: inv.currency,
    totalMinor: totals.totalMinor,
    businessDate,
    idempotencyKey,
    requestHash: hash,
    postingIds,
    buildSnapshot: (documentNumber) => ({
      title: 'Credit Note',
      templateVersion: 'credit-note-v1',
      documentNumber,
      issueDate: businessDate,
      issuedAt: tx.now.toISOString(),
      creditsInvoice: { id: inv.id, documentNumber: inv.document_number, issueDate: inv.business_date },
      reason: input.reason,
      mode: input.mode,
      supplier: original.supplier,
      buyer: original.buyer,
      property: original.property,
      currency: inv.currency,
      lines: items,
      taxSummary: taxSummary(items),
      totals,
      environment: tx.environment,
      sample: tx.environment !== 'live',
    }),
  });
  if ('replayId' in result) {
    return toDocument(
      tx,
      await db(tx)
        .selectFrom('finance.fiscal_documents')
        .selectAll()
        .where('id', '=', result.replayId)
        .executeTakeFirstOrThrow(),
    );
  }
  if (input.mode === 'cancel') {
    // The cancelled invoice's postings may be invoiced again (e.g. with corrected payer details).
    await db(tx).deleteFrom('finance.posting_document_locks').where('document_id', '=', inv.id).execute();
  }
  postingIds = [];
  await tx.audit({
    action: 'finance.creditNote.issue',
    target: { type: 'fiscal_document', id: result.id },
    propertyId: inv.property_id,
    reason: input.reason,
    after: {
      documentNumber: result.document_number,
      credits: inv.document_number,
      mode: input.mode,
      total: totals.totalMinor,
    },
  });
  await tx.emit({
    type: 'finance.creditNote.issued',
    propertyId: inv.property_id,
    aggregate: { type: 'fiscal_document', id: result.id },
    payload: {
      documentId: result.id,
      invoiceId: inv.id,
      mode: input.mode,
      total: { amountMinor: totals.totalMinor, currency: inv.currency },
    },
  });
  return toDocument(tx, result);
}

export async function getDocument(tx: TxContext, id: string): Promise<FiscalDocument> {
  const r = await db(tx)
    .selectFrom('finance.fiscal_documents')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst();
  if (!r) throw new NotFoundError('fiscal_document', id);
  requirePermission(tx, 'finance.folio.read', { propertyId: r.property_id });
  return toDocument(tx, r);
}

export async function listDocuments(tx: TxContext, folioId: string): Promise<FiscalDocument[]> {
  const f = await loadFolio(tx, folioId);
  requirePermission(tx, 'finance.folio.read', { propertyId: f.property_id });
  const rows = await db(tx)
    .selectFrom('finance.fiscal_documents')
    .selectAll()
    .where('folio_id', '=', folioId)
    .orderBy('chain_position')
    .execute();
  return Promise.all(rows.map((r) => toDocument(tx, r)));
}

/** Reproducible PDF rendering of a document from its immutable snapshot. */
export async function renderDocumentPdf(
  tx: TxContext,
  id: string,
): Promise<{ filename: string; pdf: Buffer }> {
  const d = await getDocument(tx, id);
  const s = d.snapshot as Record<string, unknown> & {
    supplier?: { legalName?: string; taxId?: string | null; address?: Record<string, string> };
    buyer?: { name?: string; taxId?: string | null; address?: string | null };
    lines?: InvoiceItem[];
    taxSummary?: Array<{ name: string; rate: string | null; amountMinor: number }>;
    totals?: Record<string, number>;
    usdConversion?: Record<string, unknown> | null;
  };
  const fmt = (n: number | undefined) => `${((n ?? 0) / 100).toFixed(2)} ${d.total.currency}`;
  const lines = [
    `${String(s.title ?? d.kind).toUpperCase()}${s.sample ? '  (SAMPLE - not a valid tax document)' : ''}`,
    `Number: ${d.documentNumber}    Date: ${d.businessDate}`,
    '',
    `Supplier: ${s.supplier?.legalName ?? ''}    TIN: ${s.supplier?.taxId ?? '-'}`,
    `Address: ${Object.values(s.supplier?.address ?? {}).join(', ')}`,
    `Buyer: ${s.buyer?.name ?? ''}    TIN: ${s.buyer?.taxId ?? '-'}    ${s.buyer?.address ?? ''}`,
    '',
    ...(s.lines ?? []).map((l) => `${l.date ?? ''}  ${l.description}  ${fmt(l.amountMinor)}`),
    '',
    ...(s.taxSummary ?? []).map((t) => `${t.name}${t.rate ? ` (${t.rate})` : ''}: ${fmt(t.amountMinor)}`),
    '',
    `Value before tax: ${fmt(s.totals?.valueBeforeTaxMinor)}`,
    `Tax charged: ${fmt(s.totals?.taxChargedMinor)}`,
    `Levies stated separately (e.g. Green Tax): ${fmt(s.totals?.leviesMinor)}`,
    `Outside the tax base (gratuities, disbursements): ${fmt(s.totals?.outsideTaxBaseMinor)}`,
    `Total including tax: ${fmt(s.totals?.totalMinor)}`,
    ...(s.usdConversion
      ? [
          `USD equivalent at ${String(s.usdConversion.rate)} (${String(s.usdConversion.rateSource)}, ${String(s.usdConversion.rateDate)})`,
        ]
      : []),
    '',
    `Document hash: ${d.hash}`,
  ];
  return {
    filename: `${d.documentNumber}.pdf`,
    pdf: renderTextPdf(lines, `${String(s.title ?? d.kind)} ${d.documentNumber}`),
  };
}

/** Verify the legal entity's fiscal chain end to end and gapless numbering per series. */
export async function verifyFiscalLedger(
  tx: TxContext,
  legalEntityId: string,
): Promise<{
  ok: boolean;
  documents: number;
  brokenAt: number | null;
  reason: string | null;
  gaps: Array<{ seriesId: string; missing: number[] }>;
}> {
  requirePermission(tx, 'finance.ledger.read');
  const rows = await db(tx)
    .selectFrom('finance.fiscal_documents')
    .selectAll()
    .where('legal_entity_id', '=', legalEntityId)
    .orderBy('chain_position')
    .execute();
  const broken = verifyChain(
    rows.map((r) => ({
      chainPosition: r.chain_position,
      previousHash: r.previous_hash,
      hash: r.hash,
      documentNumber: r.document_number,
      kind: r.kind,
      totalMinor: Number(r.total_minor),
      currency: r.currency,
      snapshot: r.snapshot,
    })),
  );
  const bySeries = new Map<string, number[]>();
  for (const r of rows) bySeries.set(r.series_id, [...(bySeries.get(r.series_id) ?? []), r.number]);
  const gaps = [...bySeries.entries()]
    .map(([seriesId, nums]) => ({ seriesId, missing: findNumberingGaps(nums) }))
    .filter((g) => g.missing.length > 0);
  return {
    ok: !broken && gaps.length === 0,
    documents: rows.length,
    brokenAt: broken?.brokenAt ?? null,
    reason: broken?.reason ?? null,
    gaps,
  };
}
