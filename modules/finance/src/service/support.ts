import { type Insertable, pgCode, type Selectable, sql, type TxContext, typed } from '@portico/db';
import {
  type Authorizer,
  actorId,
  actorLabel,
  addDays,
  BusinessRuleError,
  canonicalJson,
  Decimal,
  type EntityRef,
  IdempotencyConflictError,
  type LocalDate,
  NotFoundError,
  newId,
  sha256Hex,
} from '@portico/kernel';
import { DEFAULT_CHART, derivedAccountTemplate } from '../domain/chart';
import { MAX_RATE_AGE_DAYS, pickRate, type StoredRate } from '../domain/fx';
import { assertBalanced, functionalize, type LineDraft, type RateQuote } from '../domain/ledger';
import type { EntryType, PostingKind } from '../domain/types';
import type { FinancePorts } from '../ports';
import type { FinanceDB, FoliosTable, PostingsTable } from '../tables';

export const db = (tx: TxContext) => typed<FinanceDB>(tx.db);

export interface Deps {
  ports: FinancePorts;
}

export const actorKey = (tx: TxContext) => `${tx.actor.kind}:${actorId(tx.actor)}`;
export const actorName = (tx: TxContext) => actorLabel(tx.actor);

/** Stable hash of a command's input (minus its idempotency key) to detect key reuse with different content. */
export function requestHash(input: unknown): string {
  return sha256Hex(canonicalJson(input ?? null));
}

export function isUniqueViolation(err: unknown): boolean {
  return pgCode(err) === '23505';
}

/**
 * A TxContext whose authorizer additionally grants the given finance permissions (provider delegation, ADR-0015).
 * `propertyId` scopes the grant: a string grants only at that property (and checks that name no property, such as
 * legal-entity ledger operations); `null` grants only checks without a property; omitted grants everywhere — used
 * only by finance itself after it has checked the actor's own permission for the command.
 */
export function delegated(tx: TxContext, permissions: readonly string[], propertyId?: string | null): TxContext {
  const base: Authorizer = tx.authz;
  const covers = (scope?: { propertyId?: string | null }) =>
    propertyId === undefined || !scope?.propertyId || scope.propertyId === propertyId;
  const authz: Authorizer = {
    can: (permission, scope) => (permissions.includes(permission) && covers(scope)) || base.can(permission, scope),
    propertyScope: (permission) => {
      if (!permissions.includes(permission)) return base.propertyScope(permission);
      if (propertyId === undefined) return 'all';
      const own = base.propertyScope(permission);
      if (own === 'all') return 'all';
      return propertyId === null || own.includes(propertyId) ? own : [...own, propertyId];
    },
  };
  return { ...tx, authz };
}

// ───────────────────────────── Accounts ─────────────────────────────

const accountCache = new WeakMap<TxContext, Map<string, string>>();

/** Seed the default chart for a legal entity (idempotent). */
export async function ensureChart(
  tx: TxContext,
  legalEntityId: string,
  functionalCurrency: string,
): Promise<void> {
  const existing = await db(tx)
    .selectFrom('finance.accounts')
    .select(sql<number>`count(*)::int`.as('n'))
    .where('legal_entity_id', '=', legalEntityId)
    .where('system_key', 'is not', null)
    .executeTakeFirstOrThrow();
  if (existing.n >= DEFAULT_CHART.length) return;
  for (const a of DEFAULT_CHART) {
    await sql`insert into finance.accounts (id, tenant_id, legal_entity_id, code, name, type, system_key, functional_currency)
      values (${newId()}, ${tx.tenantId}, ${legalEntityId}, ${a.code}, ${a.name}, ${a.type}, ${a.systemKey}, ${functionalCurrency})
      on conflict do nothing`.execute(tx.db);
  }
}

export async function functionalCurrencyOf(
  tx: TxContext,
  deps: Deps,
  legalEntityId: string,
): Promise<string> {
  const row = await db(tx)
    .selectFrom('finance.accounts')
    .select('functional_currency')
    .where('legal_entity_id', '=', legalEntityId)
    .limit(1)
    .executeTakeFirst();
  if (row) return row.functional_currency;
  const le = await deps.ports.platform.getLegalEntity(tx, legalEntityId);
  await ensureChart(tx, legalEntityId, le.baseCurrency);
  return le.baseCurrency;
}

/** Resolve an account id by system key, seeding the chart / derived accounts on first use. */
export async function accountId(
  tx: TxContext,
  deps: Deps,
  legalEntityId: string,
  systemKey: string,
): Promise<string> {
  let cache = accountCache.get(tx);
  if (!cache) {
    cache = new Map();
    accountCache.set(tx, cache);
  }
  const cacheKey = `${legalEntityId}|${systemKey}`;
  const hit = cache.get(cacheKey);
  if (hit) return hit;
  const find = () =>
    db(tx)
      .selectFrom('finance.accounts')
      .select('id')
      .where('legal_entity_id', '=', legalEntityId)
      .where('system_key', '=', systemKey)
      .executeTakeFirst();
  let row = await find();
  if (!row) {
    const functional = await functionalCurrencyOf(tx, deps, legalEntityId);
    row = await find();
    if (!row) {
      const tpl = derivedAccountTemplate(systemKey);
      if (!tpl) {
        throw new BusinessRuleError(
          'account_not_configured',
          `The ledger account "${systemKey}" is not set up for this legal entity. A finance administrator must add it to the chart of accounts.`,
          { systemKey, legalEntityId },
        );
      }
      await sql`insert into finance.accounts (id, tenant_id, legal_entity_id, code, name, type, system_key, functional_currency)
        values (${newId()}, ${tx.tenantId}, ${legalEntityId}, ${tpl.code}, ${tpl.name}, ${tpl.type}, ${tpl.systemKey}, ${functional})
        on conflict do nothing`.execute(tx.db);
      row = await find();
      if (!row) throw new NotFoundError('account', systemKey);
    }
  }
  cache.set(cacheKey, row.id);
  return row.id;
}

// ───────────────────────────── FX ─────────────────────────────

export async function loadRates(
  tx: TxContext,
  legalEntityId: string,
  currencies: readonly string[],
  date: LocalDate,
): Promise<StoredRate[]> {
  if (currencies.length === 0) return [];
  const rows = await db(tx)
    .selectFrom('finance.fx_rates')
    .select(['id', 'business_date', 'from_currency', 'to_currency', 'rate', 'source'])
    .where('legal_entity_id', '=', legalEntityId)
    .where('business_date', '<=', date)
    .where('business_date', '>=', addDays(date, -MAX_RATE_AGE_DAYS))
    .where((eb) =>
      eb.or([eb('from_currency', 'in', [...currencies]), eb('to_currency', 'in', [...currencies])]),
    )
    .execute();
  return rows.map((r) => ({
    id: r.id,
    businessDate: r.business_date,
    fromCurrency: r.from_currency,
    toCurrency: r.to_currency,
    rate: new Decimal(String(r.rate)).toString(),
    source: r.source,
  }));
}

export async function rateBetween(
  tx: TxContext,
  legalEntityId: string,
  from: string,
  to: string,
  date: LocalDate,
): Promise<RateQuote & { rateDate: LocalDate }> {
  const rates = await loadRates(tx, legalEntityId, [from, to], date);
  const r = pickRate(rates, from, to, date, addDays(date, -MAX_RATE_AGE_DAYS));
  return { rate: r.rate, rateId: r.rateId, rateDate: r.rateDate };
}

// ───────────────────────────── Journal writer ─────────────────────────────

export interface EntryHeader {
  legalEntityId: string;
  propertyId: string | null;
  entryType: EntryType;
  businessDate: LocalDate;
  idempotencyKey: string;
  requestHash: string;
  source?: EntityRef | null;
  reversesEntryId?: string | null;
  correctsEntryId?: string | null;
  relatesToBusinessDate?: LocalDate | null;
  sameDayCorrection?: boolean;
  reasonCode?: string | null;
  description: string;
}

export interface PostingDraft {
  folioId: string;
  kind: PostingKind;
  /** What the posting ultimately represents (defaults to `kind`); copied through transfers and corrections. */
  originKind?: string | null;
  amountMinor: number;
  currency: string;
  description: string;
  originalAmountMinor?: number | null;
  originalCurrency?: string | null;
  fxRateId?: string | null;
  chargeCodeId?: string | null;
  chargeCode?: string | null;
  taxRuleId?: string | null;
  taxRuleVersionId?: string | null;
  taxName?: string | null;
  taxKind?: 'tax' | 'fee' | 'service_charge' | null;
  taxUnits?: number | null;
  taxExemptUnits?: number | null;
  taxRateCategory?: string | null;
  taxRate?: string | null;
  quantity?: number | null;
  unitPriceMinor?: number | null;
  serviceDate?: LocalDate | null;
  revenueDate?: LocalDate | null;
  /** Index of the parent posting in the same draft list (taxes → charge, usage → charge). */
  parentIndex?: number;
  parentPostingId?: string | null;
  correctsPostingId?: string | null;
  /** Index of the paired posting (transfer in/out). */
  peerIndex?: number;
  billingRuleId?: string | null;
  allowanceInstanceId?: string | null;
  counterAccountId?: string | null;
  paymentRef?: EntityRef | null;
  paymentMethod?: string | null;
  paymentVerification?: 'provider_confirmed' | 'recorded_unverified' | 'recorded_verified' | null;
  cashierSessionId?: string | null;
  source?: EntityRef | null;
  postDeparture?: boolean;
}

export type LineSpec = LineDraft & { accountId?: string };

export type ClaimResult = { claimed: true; entryId: string } | { claimed: false; entryId: string };

/**
 * Claim an idempotency key by inserting the entry header (`on conflict do nothing`). A concurrent duplicate
 * blocks until the first transaction commits, then sees the existing entry and replays. A key reused with
 * different content is rejected.
 */
export async function claimEntry(tx: TxContext, h: EntryHeader): Promise<ClaimResult> {
  const id = newId(tx.now.getTime());
  const inserted = await db(tx)
    .insertInto('finance.journal_entries')
    .values({
      id,
      tenant_id: tx.tenantId,
      legal_entity_id: h.legalEntityId,
      property_id: h.propertyId,
      entry_type: h.entryType,
      business_date: h.businessDate,
      occurred_at: tx.now,
      idempotency_key: h.idempotencyKey,
      request_hash: h.requestHash,
      source_type: h.source?.type ?? null,
      source_id: h.source?.id ?? null,
      reverses_entry_id: h.reversesEntryId ?? null,
      corrects_entry_id: h.correctsEntryId ?? null,
      relates_to_business_date: h.relatesToBusinessDate ?? null,
      same_day_correction: h.sameDayCorrection ?? false,
      reason_code: h.reasonCode ?? null,
      description: h.description,
      actor: JSON.stringify(tx.actor),
      actor_key: actorKey(tx),
      correlation_id: tx.correlationId,
    })
    .onConflict((oc) => oc.columns(['tenant_id', 'idempotency_key']).doNothing())
    .returning('id')
    .executeTakeFirst();
  if (inserted) return { claimed: true, entryId: inserted.id };
  const existing = await findEntryByKey(tx, h.idempotencyKey, h.requestHash);
  if (!existing) {
    throw new BusinessRuleError(
      'idempotency_unresolved',
      'The posting key could not be resolved. Retry the request.',
    );
  }
  return { claimed: false, entryId: existing };
}

/** Existing entry id for an idempotency key (validating the request hash), or null. */
export async function findEntryByKey(tx: TxContext, key: string, hash: string): Promise<string | null> {
  const row = await db(tx)
    .selectFrom('finance.journal_entries')
    .select(['id', 'request_hash'])
    .where('idempotency_key', '=', key)
    .executeTakeFirst();
  if (!row) return null;
  if (row.request_hash !== hash) {
    throw new IdempotencyConflictError(
      `The posting key "${key}" was already used for a different posting. Nothing was posted. Use a new key for a new posting, or resend exactly the original request to retry it.`,
    );
  }
  return row.id;
}

/**
 * Write postings and balanced lines for a claimed entry. Lines referencing `postingIndex` mirror that posting on
 * the guest ledger. Functional amounts are derived from FX rates when the transaction currency differs.
 */
export async function writeEntryBody(
  tx: TxContext,
  deps: Deps,
  entryId: string,
  h: Pick<EntryHeader, 'legalEntityId' | 'propertyId' | 'businessDate' | 'description'>,
  postings: readonly PostingDraft[],
  lines: readonly LineSpec[],
): Promise<string[]> {
  const functional = await functionalCurrencyOf(tx, deps, h.legalEntityId);
  const foreign = [
    ...new Set(
      lines
        .filter((l) => l.currency !== functional && l.functionalAmountMinor === undefined)
        .map((l) => l.currency),
    ),
  ];
  const rates = await loadRates(tx, h.legalEntityId, [...foreign, functional], h.businessDate);
  const rateFor = (currency: string) => {
    const r = pickRate(
      rates,
      currency,
      functional,
      h.businessDate,
      addDays(h.businessDate, -MAX_RATE_AGE_DAYS),
    );
    return { rate: r.rate, rateId: r.rateId };
  };
  const fLines = functionalize(lines, functional, rateFor);
  assertBalanced(fLines, h.description);

  const postingIds = postings.map(() => newId(tx.now.getTime()));
  if (postings.length > 0) {
    if (!h.propertyId) throw new BusinessRuleError('property_required', 'Folio postings need a property.');
    const propertyId = h.propertyId;
    const rows: Array<Insertable<PostingsTable>> = postings.map((p, i) => ({
      id: postingIds[i] as string,
      tenant_id: tx.tenantId,
      entry_id: entryId,
      legal_entity_id: h.legalEntityId,
      property_id: propertyId,
      folio_id: p.folioId,
      kind: p.kind,
      origin_kind: p.originKind ?? null,
      amount_minor: p.amountMinor,
      currency: p.currency,
      original_amount_minor: p.originalAmountMinor ?? null,
      original_currency: p.originalCurrency ?? null,
      fx_rate_id: p.fxRateId ?? null,
      charge_code_id: p.chargeCodeId ?? null,
      charge_code: p.chargeCode ?? null,
      tax_rule_id: p.taxRuleId ?? null,
      tax_rule_version_id: p.taxRuleVersionId ?? null,
      tax_name: p.taxName ?? null,
      tax_kind: p.taxKind ?? null,
      tax_units: p.taxUnits === undefined || p.taxUnits === null ? null : String(p.taxUnits),
      tax_exempt_units:
        p.taxExemptUnits === undefined || p.taxExemptUnits === null ? null : String(p.taxExemptUnits),
      tax_rate_category: p.taxRateCategory ?? null,
      tax_rate: p.taxRate ?? null,
      quantity: p.quantity === undefined || p.quantity === null ? null : String(p.quantity),
      unit_price_minor: p.unitPriceMinor ?? null,
      description: p.description,
      service_date: p.serviceDate ?? null,
      revenue_date: p.revenueDate ?? null,
      business_date: h.businessDate,
      parent_posting_id:
        p.parentIndex !== undefined ? (postingIds[p.parentIndex] as string) : (p.parentPostingId ?? null),
      corrects_posting_id: p.correctsPostingId ?? null,
      transfer_peer_id: p.peerIndex !== undefined ? (postingIds[p.peerIndex] as string) : null,
      billing_rule_id: p.billingRuleId ?? null,
      allowance_instance_id: p.allowanceInstanceId ?? null,
      counter_account_id: p.counterAccountId ?? null,
      payment_ref_type: p.paymentRef?.type ?? null,
      payment_ref_id: p.paymentRef?.id ?? null,
      payment_method: p.paymentMethod ?? null,
      payment_verification: p.paymentVerification ?? null,
      cashier_session_id: p.cashierSessionId ?? null,
      source_type: p.source?.type ?? null,
      source_id: p.source?.id ?? null,
      post_departure: p.postDeparture ?? false,
    }));
    // Parents must exist before children (self FK): insert in index order, parents always precede children.
    await db(tx).insertInto('finance.postings').values(rows).execute();
  }

  const lineRows = [];
  for (let i = 0; i < fLines.length; i++) {
    const l = fLines[i] as (typeof fLines)[number] & { accountId?: string };
    const acct = l.accountId ?? (await accountId(tx, deps, h.legalEntityId, l.accountKey));
    lineRows.push({
      id: newId(tx.now.getTime()),
      tenant_id: tx.tenantId,
      entry_id: entryId,
      legal_entity_id: h.legalEntityId,
      line_no: i + 1,
      account_id: acct,
      sub_ledger_type: l.subLedger?.type ?? null,
      sub_ledger_id: l.subLedger?.id ?? null,
      amount_minor: l.amountMinor,
      currency: l.currency,
      functional_amount_minor: l.functionalAmountMinor,
      functional_currency: functional,
      fx_rate_id: l.fxRateId ?? null,
      posting_id: l.postingIndex !== undefined ? (postingIds[l.postingIndex] as string) : null,
      charge_code: l.chargeCode ?? null,
      service_date: l.serviceDate ?? null,
      revenue_date: l.revenueDate ?? null,
      memo: l.memo ?? null,
    });
  }
  await db(tx).insertInto('finance.journal_lines').values(lineRows).execute();
  return postingIds;
}

export async function postingIdsOfEntry(tx: TxContext, entryId: string): Promise<string[]> {
  const rows = await db(tx)
    .selectFrom('finance.postings')
    .select('id')
    .where('entry_id', '=', entryId)
    .orderBy('created_at')
    .orderBy('id')
    .execute();
  return rows.map((r) => r.id);
}

// ───────────────────────────── Folios ─────────────────────────────

export type FolioRow = Selectable<FoliosTable>;

export async function loadFolio(
  tx: TxContext,
  folioId: string,
  opts: { forUpdate?: boolean } = {},
): Promise<FolioRow> {
  let q = db(tx).selectFrom('finance.folios').selectAll().where('id', '=', folioId);
  if (opts.forUpdate) q = q.forUpdate();
  const row = await q.executeTakeFirst();
  if (!row) throw new NotFoundError('folio', folioId);
  return row;
}

/** Lock several folios in a deterministic order (deadlock-free). */
export async function lockFolios(tx: TxContext, folioIds: readonly string[]): Promise<Map<string, FolioRow>> {
  const ids = [...new Set(folioIds)].sort();
  const out = new Map<string, FolioRow>();
  for (const id of ids) out.set(id, await loadFolio(tx, id, { forUpdate: true }));
  return out;
}

export async function folioBalance(tx: TxContext, folioId: string): Promise<number> {
  const row = await db(tx)
    .selectFrom('finance.postings')
    .select(sql<number>`coalesce(sum(amount_minor), 0)::bigint`.as('balance'))
    .where('folio_id', '=', folioId)
    .executeTakeFirstOrThrow();
  return Number(row.balance);
}

export async function hasActiveInvoice(tx: TxContext, folioId: string): Promise<boolean> {
  const row = await db(tx)
    .selectFrom('finance.posting_document_locks as l')
    .innerJoin('finance.postings as p', 'p.id', 'l.posting_id')
    .select('l.document_id')
    .where('p.folio_id', '=', folioId)
    .limit(1)
    .executeTakeFirst();
  return !!row;
}

export async function ownerDeparture(
  tx: TxContext,
  owner: { type: string; id: string },
): Promise<{ departedOn: LocalDate } | null> {
  const row = await db(tx)
    .selectFrom('finance.owner_departures')
    .select('departed_on')
    .where('owner_type', '=', owner.type)
    .where('owner_id', '=', owner.id)
    .executeTakeFirst();
  return row ? { departedOn: row.departed_on } : null;
}

// ───────────────────────────── Exceptions ─────────────────────────────

export async function raiseException(
  tx: TxContext,
  input: {
    propertyId: string;
    kind: string;
    severity: 'urgent' | 'routine';
    ref: EntityRef;
    message: string;
    details?: Record<string, unknown>;
    businessDate: LocalDate;
  },
): Promise<void> {
  await sql`insert into finance.exceptions (id, tenant_id, property_id, kind, severity, ref_type, ref_id, message, details, business_date)
    values (${newId()}, ${tx.tenantId}, ${input.propertyId}, ${input.kind}, ${input.severity}, ${input.ref.type},
            ${input.ref.id}, ${input.message}, ${JSON.stringify(input.details ?? {})}, ${input.businessDate})
    on conflict (tenant_id, kind, ref_type, ref_id) where status = 'open'
    do update set message = excluded.message, details = excluded.details, version = finance.exceptions.version + 1`.execute(
    tx.db,
  );
}

export function displayName(f: Pick<FolioRow, 'payer_name' | 'label'>): string {
  return f.label ? `${f.payer_name} — ${f.label}` : f.payer_name;
}
