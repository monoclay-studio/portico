import { explainVersionMiss, type Selectable, sql, type TxContext } from '@portico/db';
import {
  BusinessRuleError,
  ConflictError,
  type Money,
  NotFoundError,
  newId,
  requirePermission,
  ValidationError,
} from '@portico/kernel';
import type { CashierSummary } from '../contracts';
import { type CurrencyAmounts, cashVariance } from '../domain/cashier';
import type { LineDraft } from '../domain/ledger';
import type { CashierSessionsTable } from '../tables';
import { prepareDestination } from './folios';
import { cashierRecord } from './records';
import {
  actorKey,
  actorName,
  claimEntry,
  type Deps,
  db,
  type FolioRow,
  findEntryByKey,
  isUniqueViolation,
  loadFolio,
  lockFolios,
  postingIdsOfEntry,
  requestHash,
  writeEntryBody,
} from './support';
import { bridgeLines, recordCashMovement } from './tender';

const asAmounts = (v: unknown): CurrencyAmounts => (v ?? {}) as CurrencyAmounts;

async function summary(
  tx: TxContext,
  s: Selectable<CashierSessionsTable>,
  currentBusinessDate?: string,
): Promise<CashierSummary> {
  const moves = await db(tx)
    .selectFrom('finance.cash_movements')
    .select(['currency', 'amount_minor', 'kind'])
    .where('session_id', '=', s.id)
    .execute();
  const { expected } = cashVariance(
    asAmounts(s.opening_floats),
    moves
      .filter((m) => m.kind !== 'variance')
      .map((m) => ({ currency: m.currency, amountMinor: Number(m.amount_minor) })),
    {},
  );
  const byMethod = await db(tx)
    .selectFrom('finance.postings')
    .select([
      'payment_method',
      sql<string>`coalesce(original_currency, currency)`.as('cur'),
      sql<number>`-sum(coalesce(original_amount_minor, amount_minor))::bigint`.as('total'),
      sql<number>`count(*)::int`.as('n'),
    ])
    .where('cashier_session_id', '=', s.id)
    .where('kind', 'in', ['payment', 'refund'])
    .groupBy(['payment_method', sql`coalesce(original_currency, currency)`])
    .execute();
  const variance = s.variance ? asAmounts(s.variance) : null;
  const count: CashierSummary['status']['count'] = !variance
    ? 'not_counted'
    : Object.values(variance).some((v) => v < 0)
      ? 'short'
      : Object.values(variance).some((v) => v > 0)
        ? 'over'
        : 'balanced';
  return {
    id: s.id,
    propertyId: s.property_id,
    cashierName: s.cashier_name,
    status: { session: s.status, count },
    openedAt: new Date(s.opened_at).toISOString(),
    closedAt: s.closed_at ? new Date(s.closed_at).toISOString() : null,
    openingFloats: asAmounts(s.opening_floats),
    expected: s.status === 'closed' ? asAmounts(s.expected) : expected,
    counted: s.counted ? asAmounts(s.counted) : null,
    variance: s.variance ? asAmounts(s.variance) : null,
    byMethod: byMethod.map((m) => ({
      method: m.payment_method ?? 'other',
      currency: m.cur,
      totalMinor: Number(m.total),
      count: m.n,
    })),
    version: s.version,
    ...cashierRecord(tx, {
      propertyId: s.property_id,
      userKey: s.user_key,
      mine: s.user_key === actorKey(tx),
      cashierName: s.cashier_name,
      status: s.status,
      openedBusinessDate: s.opened_business_date,
      businessDate: currentBusinessDate ?? null,
      variance,
    }),
  };
}

export async function openCashierSession(
  tx: TxContext,
  deps: Deps,
  input: { propertyId: string; openingFloats: CurrencyAmounts },
): Promise<CashierSummary> {
  requirePermission(tx, 'finance.cashier.operate', { propertyId: input.propertyId });
  for (const v of Object.values(input.openingFloats)) {
    if (!Number.isSafeInteger(v) || v < 0)
      throw new ValidationError('invalid_float', 'Opening floats are non-negative whole minor units.');
  }
  const property = await deps.ports.platform.getProperty(tx, input.propertyId);
  const businessDate = await deps.ports.platform.getBusinessDate(tx, input.propertyId);
  try {
    const row = await db(tx)
      .insertInto('finance.cashier_sessions')
      .values({
        id: newId(tx.now.getTime()),
        tenant_id: tx.tenantId,
        property_id: input.propertyId,
        legal_entity_id: property.legalEntityId,
        user_key: actorKey(tx),
        cashier_name: actorName(tx),
        opened_at: tx.now,
        opened_business_date: businessDate,
        opening_floats: JSON.stringify(input.openingFloats),
        closed_at: null,
        counted: null,
        expected: null,
        variance: null,
        close_note: null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    await tx.audit({
      action: 'finance.cashier.open',
      target: { type: 'cashier_session', id: row.id },
      propertyId: input.propertyId,
      after: input,
    });
    return summary(tx, row);
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new ConflictError(
        'cashier_session_already_open',
        'You already have an open cashier session at this property. Close it before opening a new one.',
      );
    }
    throw err;
  }
}

export async function getCashierSession(tx: TxContext, deps: Deps, id: string): Promise<CashierSummary> {
  const s = await db(tx)
    .selectFrom('finance.cashier_sessions')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst();
  if (!s) throw new NotFoundError('cashier_session', id);
  if (s.user_key !== actorKey(tx))
    requirePermission(tx, 'finance.cashier.review', { propertyId: s.property_id });
  else requirePermission(tx, 'finance.cashier.operate', { propertyId: s.property_id });
  return summary(tx, s, await deps.ports.platform.getBusinessDate(tx, s.property_id));
}

export async function listOpenCashierSessions(
  tx: TxContext,
  deps: Deps,
  propertyId: string,
): Promise<CashierSummary[]> {
  requirePermission(tx, 'finance.cashier.review', { propertyId });
  const businessDate = await deps.ports.platform.getBusinessDate(tx, propertyId);
  const rows = await db(tx)
    .selectFrom('finance.cashier_sessions')
    .selectAll()
    .where('property_id', '=', propertyId)
    .where('status', '=', 'open')
    .execute();
  return Promise.all(rows.map((r) => summary(tx, r, businessDate)));
}

/**
 * Close a session with a blind count per currency. The variance (counted − expected) is posted to cash over/short;
 * closing is final — later corrections go through the next session with a reason.
 */
export async function closeCashierSession(
  tx: TxContext,
  deps: Deps,
  input: { sessionId: string; expectedVersion: number; counted: CurrencyAmounts; note?: string },
): Promise<CashierSummary> {
  const s = await db(tx)
    .selectFrom('finance.cashier_sessions')
    .selectAll()
    .where('id', '=', input.sessionId)
    .forUpdate()
    .executeTakeFirst();
  if (!s) throw new NotFoundError('cashier_session', input.sessionId);
  if (s.user_key !== actorKey(tx))
    requirePermission(tx, 'finance.cashier.review', { propertyId: s.property_id });
  else requirePermission(tx, 'finance.cashier.operate', { propertyId: s.property_id });
  if (s.status !== 'open')
    throw new BusinessRuleError('cashier_session_closed', 'This cashier session is already closed.');
  if (s.version !== input.expectedVersion) {
    return explainVersionMiss('cashier_session', s.id, input.expectedVersion, async () => s.version);
  }
  const moves = await db(tx)
    .selectFrom('finance.cash_movements')
    .select(['currency', 'amount_minor'])
    .where('session_id', '=', s.id)
    .execute();
  const { expected, variance } = cashVariance(
    asAmounts(s.opening_floats),
    moves.map((m) => ({ currency: m.currency, amountMinor: Number(m.amount_minor) })),
    input.counted,
  );
  const businessDate = await deps.ports.platform.getBusinessDate(tx, s.property_id);
  const nonZero = Object.entries(variance).filter(([, v]) => v !== 0);
  if (nonZero.length) {
    const claim = await claimEntry(tx, {
      legalEntityId: s.legal_entity_id,
      propertyId: s.property_id,
      entryType: 'cash_variance',
      businessDate,
      idempotencyKey: `cash-variance:${s.id}`,
      requestHash: requestHash({ session: s.id, variance }),
      source: { type: 'cashier_session', id: s.id },
      description: `Cash over/short at close of ${s.cashier_name}'s session`,
      reasonCode: 'cash_count',
    });
    if (claim.claimed) {
      const lines: LineDraft[] = [];
      for (const [currency, v] of nonZero) {
        lines.push({
          accountKey: 'cash',
          amountMinor: v,
          currency,
          subLedger: { type: 'cashier_session', id: s.id },
        });
        lines.push({ accountKey: 'cash_over_short', amountMinor: -v, currency });
      }
      await writeEntryBody(
        tx,
        deps,
        claim.entryId,
        {
          legalEntityId: s.legal_entity_id,
          propertyId: s.property_id,
          businessDate,
          description: 'Cash variance',
        },
        [],
        lines,
      );
      for (const [currency, v] of nonZero) {
        await recordCashMovement(tx, {
          sessionId: s.id,
          kind: 'variance',
          amount: { amountMinor: v, currency },
          entryId: claim.entryId,
          reference: 'count variance',
        });
      }
    }
  }
  const row = await db(tx)
    .updateTable('finance.cashier_sessions')
    .set({
      status: 'closed',
      closed_at: tx.now,
      counted: JSON.stringify(input.counted),
      expected: JSON.stringify(expected),
      variance: JSON.stringify(variance),
      close_note: input.note ?? null,
      version: sql`version + 1`,
    })
    .where('id', '=', s.id)
    .returningAll()
    .executeTakeFirstOrThrow();
  await tx.audit({
    action: 'finance.cashier.close',
    target: { type: 'cashier_session', id: s.id },
    propertyId: s.property_id,
    ...(input.note ? { reason: input.note } : {}),
    after: { expected, counted: input.counted, variance },
  });
  await tx.emit({
    type: 'finance.cashierSession.closed',
    propertyId: s.property_id,
    aggregate: { type: 'cashier_session', id: s.id },
    aggregateVersion: row.version,
    payload: { sessionId: s.id, variance },
  });
  return summary(tx, row);
}

/** Cash advance to a guest (paid-out): charged to the folio, taken from the drawer. */
export async function recordPaidOut(
  tx: TxContext,
  deps: Deps,
  input: { sessionId: string; folioId: string; amount: Money; description: string; idempotencyKey: string },
): Promise<{ entryId: string; postingIds: string[]; replayed: boolean }> {
  const s = await db(tx)
    .selectFrom('finance.cashier_sessions')
    .selectAll()
    .where('id', '=', input.sessionId)
    .executeTakeFirst();
  if (!s) throw new NotFoundError('cashier_session', input.sessionId);
  requirePermission(tx, 'finance.cashier.paidOut', { propertyId: s.property_id });
  if (s.status !== 'open' || s.user_key !== actorKey(tx)) {
    throw new BusinessRuleError(
      'cashier_session_not_open',
      'Paid-outs come from your own open cashier session.',
    );
  }
  if (input.amount.amountMinor <= 0)
    throw new ValidationError('invalid_amount', 'A paid-out must be positive.');
  const { idempotencyKey, ...rest } = input;
  const hash = requestHash({ op: 'paid-out', ...rest });
  const prior = await findEntryByKey(tx, idempotencyKey, hash);
  if (prior) return { entryId: prior, postingIds: await postingIdsOfEntry(tx, prior), replayed: true };
  const f0 = await loadFolio(tx, input.folioId);
  if (f0.property_id !== s.property_id)
    throw new ValidationError('folio_property_mismatch', 'The folio belongs to another property.');
  await deps.ports.platform.assertWritable(tx, f0.property_id, 'charges');
  const businessDate = await deps.ports.platform.getBusinessDate(tx, s.property_id);
  const claim = await claimEntry(tx, {
    legalEntityId: f0.legal_entity_id,
    propertyId: f0.property_id,
    entryType: 'paid_out',
    businessDate,
    idempotencyKey,
    requestHash: hash,
    source: { type: 'cashier_session', id: s.id },
    description: `Paid-out: ${input.description}`,
  });
  if (!claim.claimed)
    return { entryId: claim.entryId, postingIds: await postingIdsOfEntry(tx, claim.entryId), replayed: true };
  const locked = (await lockFolios(tx, [f0.id])).get(f0.id) as FolioRow;
  const { folio } = await prepareDestination(tx, locked, 'new_charge');
  // Folio debit in folio currency, drawer credit in the paid currency (converted explicitly when different).
  const bridge = await bridgeLines(
    tx,
    deps,
    folio.legal_entity_id,
    businessDate,
    {
      accountKey: 'cash',
      subLedger: { type: 'cashier_session', id: s.id },
      amount: { amountMinor: -input.amount.amountMinor, currency: input.amount.currency },
    },
    {
      accountKey: 'guest_ledger',
      subLedger: { type: 'folio', id: folio.id },
      postingIndex: 0,
      currency: folio.currency,
    },
  );
  const postingIds = await writeEntryBody(
    tx,
    deps,
    claim.entryId,
    {
      legalEntityId: folio.legal_entity_id,
      propertyId: folio.property_id,
      businessDate,
      description: 'Paid-out',
    },
    [
      {
        folioId: folio.id,
        kind: 'paid_out',
        amountMinor: -bridge.creditAmount.amountMinor,
        currency: folio.currency,
        description: `Paid-out: ${input.description}`,
        cashierSessionId: s.id,
        fxRateId: bridge.fxRateId,
        ...(input.amount.currency !== folio.currency
          ? { originalAmountMinor: input.amount.amountMinor, originalCurrency: input.amount.currency }
          : {}),
      },
    ],
    bridge.lines,
  );
  await recordCashMovement(tx, {
    sessionId: s.id,
    kind: 'paid_out',
    amount: { amountMinor: -input.amount.amountMinor, currency: input.amount.currency },
    entryId: claim.entryId,
    postingId: postingIds[0] ?? null,
  });
  await tx.audit({
    action: 'finance.cashier.paidOut',
    target: { type: 'folio', id: folio.id },
    propertyId: folio.property_id,
    after: { amount: input.amount, description: input.description },
  });
  return { entryId: claim.entryId, postingIds, replayed: false };
}
