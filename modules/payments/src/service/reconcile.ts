/**
 * Reconciliation: resolves pending verification by provider lookup (never by re-sending), retries ledger
 * postings, expires stale holds and requests, creates pending payment links, escalates what stays unresolved;
 * imports settlement / bank statements (file-based, clearly labeled) to verify recorded Route D payments; records
 * payouts (a payout is never revenue).
 */
import { explainVersionMiss, type TxContext, withTenantTx } from '@portico/db';
import {
  addDays,
  BusinessRuleError,
  ConflictError,
  ForbiddenError,
  localDateIn,
  money,
  NotFoundError,
  newId,
  type RequestContext,
  requirePermission,
  sha256Hex,
  ValidationError,
} from '@portico/kernel';
import type { z } from 'zod';
import type {
  Dispute,
  Payout,
  payoutInput,
  ReconciliationResult,
  StatementResult,
  statementImportInput,
} from '../contracts';
import { parseStatementCsv } from '../domain/csv';
import { matchSettlement, type RecordedItem, type SettlementIssue } from '../domain/settlement';
import { PaymentsEvents } from '../events';
import { ledgerKey, postPaymentLedger, postRefundLedger, tryLedger } from './ledger';
import { executeOperation, verifyOperation } from './operations';
import { ensurePaymentLink } from './requests';
import {
  actorKey,
  db,
  loadAccount,
  loadProperty,
  type PaymentsDeps,
  raiseException,
  requireRead,
  resolveExceptionsByKey,
} from './shared';
import { payoutFollowUp } from './webhooks';

/** The reconciliation job: callable on demand, by the worker consumer and by a scheduler. */
export async function runReconciliation(
  d: PaymentsDeps,
  ctx: RequestContext,
  opts: { propertyId?: string; limit?: number } = {},
): Promise<ReconciliationResult> {
  const limit = opts.limit ?? 200;
  const result: ReconciliationResult = {
    checked: 0,
    resolved: 0,
    stillPending: 0,
    ledgerRetried: 0,
    authorizationsExpired: 0,
    exceptionsRaised: 0,
  };
  const work = await withTenantTx(d.database, ctx, async (tx) => {
    let due = db(tx)
      .selectFrom('payments.provider_operations')
      .select(['id', 'status', 'created_at'])
      .where('status', 'in', ['sent', 'pending_verification', 'pending'])
      .where((eb) => eb.or([eb('next_check_at', 'is', null), eb('next_check_at', '<=', tx.now)]))
      .orderBy('created_at')
      .limit(limit);
    if (opts.propertyId) due = due.where('property_id', '=', opts.propertyId);
    const ops = await due.execute();
    let lp = db(tx)
      .selectFrom('payments.payments')
      .select('id')
      .where('ledger_status', 'in', ['pending', 'failed'])
      .limit(limit);
    if (opts.propertyId) lp = lp.where('property_id', '=', opts.propertyId);
    let lr = db(tx)
      .selectFrom('payments.refunds')
      .select('id')
      .where('ledger_status', 'in', ['pending', 'failed'])
      .limit(limit);
    if (opts.propertyId) lr = lr.where('property_id', '=', opts.propertyId);
    let links = db(tx)
      .selectFrom('payments.payment_requests')
      .select('id')
      .where('status', '=', 'open')
      .where('link_status', 'in', ['pending', 'unknown'])
      .limit(limit);
    if (opts.propertyId) links = links.where('property_id', '=', opts.propertyId);
    return {
      ops,
      ledgerPayments: await lp.execute(),
      ledgerRefunds: await lr.execute(),
      links: await links.execute(),
    };
  });

  for (const op of work.ops) {
    result.checked++;
    if (op.status === 'pending') {
      // An intent that was never sent: send it while fresh; expired intents are cancelled by the executor.
      const age = d.database.clock.now().getTime() - new Date(op.created_at).getTime();
      if (age >= 60_000) await executeOperation(d, ctx, op.id);
      continue;
    }
    const r = await verifyOperation(d, ctx, op.id);
    if (r.status === 'succeeded' || r.status === 'failed') result.resolved++;
    else result.stillPending++;
  }
  for (const p of work.ledgerPayments) {
    await withTenantTx(d.database, ctx, (tx) => postPaymentLedger(d, tx, p.id));
    result.ledgerRetried++;
  }
  for (const r of work.ledgerRefunds) {
    await withTenantTx(d.database, ctx, (tx) => postRefundLedger(d, tx, r.id));
    result.ledgerRetried++;
  }
  for (const l of work.links) await ensurePaymentLink(d, ctx, l.id);

  await withTenantTx(d.database, ctx, async (tx) => {
    let expiring = db(tx)
      .selectFrom('payments.authorizations')
      .selectAll()
      .where('status', 'in', ['authorized', 'partially_captured'])
      .where('expires_at', '<', tx.now)
      .where('capture_reserved_minor', '=', 0);
    if (opts.propertyId) expiring = expiring.where('property_id', '=', opts.propertyId);
    for (const a of await expiring.execute()) {
      await db(tx)
        .updateTable('payments.authorizations')
        .set({ status: 'expired', version: a.version + 1 })
        .where('id', '=', a.id)
        .execute();
      await tx.audit({
        action: 'payments.authorization.expire',
        target: { type: 'authorization', id: a.id },
        propertyId: a.property_id,
        before: { status: a.status },
        after: { status: 'expired' },
        reason: 'Authorization validity elapsed',
      });
      await tx.emit({
        type: PaymentsEvents.authorizationExpired,
        propertyId: a.property_id,
        aggregate: { type: 'authorization', id: a.id },
        payload: {
          authorizationId: a.id,
          ref: { type: a.ref_type, id: a.ref_id },
          uncapturedMinor: a.amount_minor - a.captured_minor,
        },
      });
      await resolveExceptionsByKey(tx, `auth-expiring:${a.id}`, 'The hold expired.');
      result.authorizationsExpired++;
    }
    // PAY-R10: holds about to expire get a renewal task (policy payments.authorization.renewBeforeDays, default 2).
    let soon = db(tx)
      .selectFrom('payments.authorizations')
      .select([
        'id',
        'property_id',
        'expires_at',
        'amount_minor',
        'captured_minor',
        'currency',
        'ref_type',
        'ref_id',
      ])
      .where('status', 'in', ['authorized', 'partially_captured'])
      .where('expires_at', '>=', tx.now)
      .where('expires_at', '<', new Date(tx.now.getTime() + 30 * 86_400_000));
    if (opts.propertyId) soon = soon.where('property_id', '=', opts.propertyId);
    for (const a of await soon.execute()) {
      const days = await d.platform.resolvePolicy(
        tx,
        a.property_id,
        'payments.authorization.renewBeforeDays',
        2,
      );
      const expires = new Date(a.expires_at as Date);
      if (expires.getTime() - tx.now.getTime() > Number(days.value) * 86_400_000) continue;
      await raiseException(tx, {
        propertyId: a.property_id,
        kind: 'authorization_expiring',
        severity: 'routine',
        problem: `A card hold of ${a.currency} ${a.amount_minor - a.captured_minor} (minor units) expires at ${expires.toISOString()}.`,
        businessImpact: 'After expiry the hold no longer guarantees payment for this stay.',
        nextStep:
          'Collect what is due now, or take a new authorization (with the guest’s agreement) before it expires.',
        ownerRole: 'front_office_manager',
        responsibleParty: 'hotel',
        ref: { type: 'authorization', id: a.id },
        dedupeKey: `auth-expiring:${a.id}`,
      });
    }
    let requests = db(tx)
      .selectFrom('payments.payment_requests')
      .select(['id', 'property_id', 'version'])
      .where('status', 'in', ['open', 'partially_paid'])
      .where('expires_at', '<', tx.now);
    if (opts.propertyId) requests = requests.where('property_id', '=', opts.propertyId);
    for (const r of await requests.execute()) {
      await db(tx)
        .updateTable('payments.payment_requests')
        .set({ status: 'expired', version: r.version + 1 })
        .where('id', '=', r.id)
        .execute();
      await tx.emit({
        type: PaymentsEvents.requestExpired,
        propertyId: r.property_id,
        aggregate: { type: 'payment_request', id: r.id },
        payload: { paymentRequestId: r.id },
      });
    }
    // Recorded payments still unmatched long after the money moved get an owner.
    const cutoff = new Date(tx.now.getTime() - 7 * 86_400_000);
    let stale = db(tx)
      .selectFrom('payments.payments')
      .select(['id', 'property_id', 'method', 'amount_minor', 'currency', 'external_reference'])
      .where('status', '=', 'recorded_unverified')
      .where('method', 'in', ['external_terminal', 'bank_transfer'])
      .where('received_at', '<', cutoff);
    if (opts.propertyId) stale = stale.where('property_id', '=', opts.propertyId);
    for (const p of await stale.execute()) {
      await raiseException(tx, {
        propertyId: p.property_id,
        kind: 'recorded_payment_unverified',
        severity: 'routine',
        problem: `A ${p.method.replace('_', ' ')} payment of ${p.currency} ${p.amount_minor} (minor units, ref ${p.external_reference ?? '—'}) has not been matched to any statement for 7 days.`,
        businessImpact: 'Portico cannot confirm the hotel actually received this money.',
        nextStep:
          'Import the settlement or bank statement covering that date, or investigate with the acquirer/bank.',
        ownerRole: 'finance',
        responsibleParty: 'hotel',
        ref: { type: 'payment', id: p.id },
        dedupeKey: `settlement-missing:${p.id}`,
      });
      result.exceptionsRaised++;
    }
  });
  return result;
}

// ───────────────────────── statements (Route D verification) ─────────────────────────

const SOURCE_METHODS: Record<string, ReadonlyArray<'external_terminal' | 'cash' | 'bank_transfer'>> = {
  terminal_batch: ['external_terminal'],
  acquirer_settlement: ['external_terminal'],
  bank_statement: ['bank_transfer'],
  cash_deposit: ['cash'],
};

function issueException(statementId: string, propertyId: string, i: SettlementIssue, fileName: string) {
  const base = {
    propertyId,
    severity: (i.kind === 'missing_in_statement' || i.kind === 'ambiguous_match' ? 'routine' : 'urgent') as
      | 'urgent'
      | 'routine',
    ownerRole: 'finance',
    responsibleParty: 'hotel' as const,
    ...(i.itemId ? { ref: { type: i.itemKind ?? 'payment', id: i.itemId } } : {}),
  };
  const texts: Record<
    SettlementIssue['kind'],
    { problem: string; impact: string; next: string; key: string }
  > = {
    amount_mismatch: {
      problem: `Statement ${fileName}: ${i.detail}`,
      impact: 'The bill and the bank disagree about how much was paid.',
      next: 'Check the terminal receipt. If the statement is right, record a correction (adjustment) on the payment; never edit the original.',
      key: `settlement-amount:${i.itemId}`,
    },
    missing_in_statement: {
      problem: `Statement ${fileName}: ${i.detail}`,
      impact: 'This payment may never have reached the hotel’s account.',
      next: 'Check the terminal batch for that day; if the payment did not happen, record a correction and collect again.',
      key: `settlement-missing:${i.itemId}`,
    },
    unrecorded_in_portico: {
      problem: `Statement ${fileName}: ${i.detail}`,
      impact: 'Money arrived that no bill shows — a guest may be shown as owing money they paid.',
      next: 'Find the guest/booking and record the payment with this reference.',
      key: `settlement-unrecorded:${statementId}:${i.lineNo}`,
    },
    duplicate_in_statement: {
      problem: `Statement ${fileName}: ${i.detail}`,
      impact: 'The guest may have been charged twice on the terminal.',
      next: 'Check the terminal batch; refund the duplicate on the terminal and record the refund.',
      key: `settlement-duplicate-line:${statementId}:${i.lineNo}`,
    },
    duplicate_recorded: {
      problem: `${i.detail}`,
      impact: 'The same terminal payment may have been recorded twice, overstating what the guest paid.',
      next: 'Review both records; correct the duplicate with an adjustment.',
      key: `settlement-duplicate-record:${i.itemId}`,
    },
    ambiguous_match: {
      problem: `Statement ${fileName}: ${i.detail}`,
      impact: 'Portico cannot tell which record this line belongs to.',
      next: 'Compare approval codes on the terminal receipts and resolve manually.',
      key: `settlement-ambiguous:${statementId}:${i.lineNo}`,
    },
  };
  const t = texts[i.kind];
  return {
    ...base,
    kind: `settlement_${i.kind}`,
    problem: t.problem,
    businessImpact: t.impact,
    nextStep: t.next,
    dedupeKey: t.key,
  };
}

export async function importStatement(
  d: PaymentsDeps,
  tx: TxContext,
  input: z.infer<typeof statementImportInput>,
): Promise<StatementResult> {
  requirePermission(tx, 'payments.reconciliation.manage', { propertyId: input.propertyId });
  if (input.periodTo < input.periodFrom) {
    throw new ValidationError('invalid_period', 'The statement period ends before it starts.');
  }
  const property = await loadProperty(d, tx, input.propertyId);
  if (input.accountId) {
    const account = await loadAccount(tx, input.accountId);
    if (account.legal_entity_id !== property.legalEntityId) {
      throw new BusinessRuleError(
        'wrong_merchant_of_record',
        'This account belongs to another legal entity.',
      );
    }
  }
  const lines = parseStatementCsv(input.csv);
  const fileHash = sha256Hex(input.csv);
  const dup = await db(tx)
    .selectFrom('payments.statements')
    .select(['id', 'imported_at'])
    .where('file_sha256', '=', fileHash)
    .executeTakeFirst();
  if (dup) {
    throw new ConflictError(
      'statement_already_imported',
      `This exact file was already imported at ${new Date(dup.imported_at).toISOString()}. Nothing was changed.`,
      { statementId: dup.id },
    );
  }
  const methods = SOURCE_METHODS[input.source] ?? [];
  const windowFrom = new Date(`${addDays(input.periodFrom, -3)}T00:00:00Z`);
  const windowTo = new Date(`${addDays(input.periodTo, 4)}T00:00:00Z`);
  let pq = db(tx)
    .selectFrom('payments.payments')
    .select(['id', 'currency', 'amount_minor', 'external_reference', 'card_last4', 'received_at', 'status'])
    .where('property_id', '=', input.propertyId)
    .where('mode', '=', 'recorded')
    .where('method', 'in', [...methods])
    .where('received_at', '>=', windowFrom)
    .where('received_at', '<', windowTo);
  if (input.accountId) pq = pq.where('account_id', '=', input.accountId);
  const payments = await pq.forUpdate().execute();
  const refunds = await db(tx)
    .selectFrom('payments.refunds')
    .innerJoin('payments.payments as p', 'p.id', 'payments.refunds.payment_id')
    .select([
      'payments.refunds.id as id',
      'payments.refunds.currency as currency',
      'payments.refunds.amount_minor as amount_minor',
      'payments.refunds.external_reference as reference',
      'payments.refunds.created_at as created_at',
      'payments.refunds.status as status',
    ])
    .where('payments.refunds.property_id', '=', input.propertyId)
    .where('payments.refunds.mode', '=', 'recorded')
    .where('p.method', 'in', [...methods])
    .where('payments.refunds.created_at', '>=', windowFrom)
    .where('payments.refunds.created_at', '<', windowTo)
    .execute();
  const items: RecordedItem[] = [
    ...payments.map((p) => ({
      id: p.id,
      kind: 'payment' as const,
      currency: p.currency,
      amountMinor: p.amount_minor,
      reference: p.external_reference,
      cardLast4: p.card_last4,
      day: localDateIn(new Date(p.received_at ?? tx.now), property.timezone),
      alreadyVerified: p.status === 'recorded_verified',
    })),
    ...refunds.map((r) => ({
      id: r.id,
      kind: 'refund' as const,
      currency: r.currency,
      amountMinor: -r.amount_minor,
      reference: r.reference,
      cardLast4: null,
      day: localDateIn(new Date(r.created_at), property.timezone),
      alreadyVerified: r.status === 'recorded_verified',
    })),
  ];
  const match = matchSettlement({ items, lines, period: { from: input.periodFrom, to: input.periodTo } });
  const statementId = newId(tx.now.getTime());
  const exceptionIds: string[] = [];
  const issueInputs = match.issues.map((i) =>
    issueException(statementId, input.propertyId, i, input.fileName),
  );
  await db(tx)
    .insertInto('payments.statements')
    .values({
      id: statementId,
      tenant_id: tx.tenantId,
      property_id: input.propertyId,
      account_id: input.accountId ?? null,
      source: input.source,
      file_name: input.fileName,
      file_sha256: fileHash,
      period_from: input.periodFrom,
      period_to: input.periodTo,
      line_count: lines.length,
      matched_count: match.verifiedItemIds.length,
      exception_count: issueInputs.length,
      imported_by: actorKey(tx),
      imported_at: tx.now,
    })
    .execute();
  const lineRows = lines.map((l) => {
    const m = match.lines.find((x) => x.lineNo === l.lineNo);
    return {
      id: newId(tx.now.getTime()),
      tenant_id: tx.tenantId,
      statement_id: statementId,
      line_no: l.lineNo,
      occurred_on: l.day,
      currency: l.currency,
      amount_minor: l.amountMinor,
      reference: l.reference,
      approval_code: l.approvalCode,
      card_last4: l.cardLast4,
      description: l.description,
      match_status: m?.status ?? 'unmatched',
      match_basis: m?.basis ?? null,
      matched_payment_id: m?.itemKind === 'payment' ? m.itemId : null,
      matched_refund_id: m?.itemKind === 'refund' ? m.itemId : null,
    };
  });
  if (lineRows.length) await db(tx).insertInto('payments.statement_lines').values(lineRows).execute();
  for (const id of match.verifiedItemIds) {
    const isPayment = payments.some((p) => p.id === id);
    if (isPayment) {
      await db(tx)
        .updateTable('payments.payments')
        .set({ status: 'recorded_verified', version: (eb) => eb('version', '+', 1) })
        .where('id', '=', id)
        .where('status', '=', 'recorded_unverified')
        .execute();
      await tx.emit({
        type: PaymentsEvents.paymentVerified,
        propertyId: input.propertyId,
        aggregate: { type: 'payment', id },
        payload: { paymentId: id, statementId },
      });
    } else {
      await db(tx)
        .updateTable('payments.refunds')
        .set({ status: 'recorded_verified', version: (eb) => eb('version', '+', 1) })
        .where('id', '=', id)
        .where('status', '=', 'recorded_unverified')
        .execute();
    }
    await resolveExceptionsByKey(tx, `settlement-missing:${id}`, `Matched in statement ${input.fileName}.`);
  }
  for (const e of issueInputs) exceptionIds.push(await raiseException(tx, e));
  await tx.audit({
    action: 'payments.statement.import',
    target: { type: 'statement', id: statementId },
    propertyId: input.propertyId,
    after: {
      source: input.source,
      fileName: input.fileName,
      lines: lines.length,
      matched: match.verifiedItemIds.length,
      exceptions: issueInputs.length,
    },
  });
  await tx.emit({
    type: PaymentsEvents.statementImported,
    propertyId: input.propertyId,
    aggregate: { type: 'statement', id: statementId },
    payload: { statementId, matched: match.verifiedItemIds.length, exceptions: issueInputs.length },
  });
  return {
    id: statementId,
    source: input.source,
    fileName: input.fileName,
    provenance: 'file_import',
    periodFrom: input.periodFrom,
    periodTo: input.periodTo,
    lineCount: lines.length,
    matchedCount: match.verifiedItemIds.length,
    exceptionCount: issueInputs.length,
    lines: lineRows.map((l) => ({
      lineNo: l.line_no,
      day: l.occurred_on,
      amount: { amountMinor: l.amount_minor, currency: l.currency },
      reference: l.reference ?? l.approval_code,
      matchStatus: l.match_status,
      matchBasis: l.match_basis,
      matchedPaymentId: l.matched_payment_id,
      matchedRefundId: l.matched_refund_id,
    })),
    exceptionIds,
  };
}

// ───────────────────────── payouts ─────────────────────────

function toPayoutView(
  p: {
    id: string;
    account_id: string;
    legal_entity_id: string;
    provider_payout_id: string;
    currency: string;
    gross_minor: number | null;
    fees_minor: number | null;
    net_minor: number;
    arrival_date: string | null;
    status: string;
    failure_reason: string | null;
    source: string;
    ledger_status: string;
    ledger_ref: string | null;
    version: number;
  },
  itemCount: number,
): Payout {
  return {
    id: p.id,
    accountId: p.account_id,
    legalEntityId: p.legal_entity_id,
    providerPayoutId: p.provider_payout_id,
    currency: p.currency,
    grossMinor: p.gross_minor,
    feesMinor: p.fees_minor,
    netMinor: p.net_minor,
    arrivalDate: p.arrival_date,
    status: p.status,
    failureReason: p.failure_reason,
    source: p.source,
    ledger: { status: p.ledger_status, ref: p.ledger_ref },
    itemCount,
    version: p.version,
  };
}

/** Record (or complete) a payout with gross / fees / net and the payments it includes. Payout ≠ revenue. */
export async function recordPayout(
  d: PaymentsDeps,
  tx: TxContext,
  input: z.infer<typeof payoutInput>,
): Promise<Payout> {
  requirePermission(tx, 'payments.payout.manage');
  const account = await loadAccount(tx, input.accountId);
  const existing = await db(tx)
    .selectFrom('payments.payouts')
    .selectAll()
    .where('account_id', '=', account.id)
    .where('provider_payout_id', '=', input.providerPayoutId)
    .forUpdate()
    .executeTakeFirst();
  if (existing && existing.ledger_status === 'posted') {
    const n = await db(tx)
      .selectFrom('payments.payout_items')
      .select((eb) => eb.fn.countAll<number>().as('n'))
      .where('payout_id', '=', existing.id)
      .executeTakeFirstOrThrow();
    return toPayoutView(existing, Number(n.n));
  }
  if (existing && existing.net_minor !== input.netMinor) {
    throw new ConflictError(
      'payout_amount_mismatch',
      `The provider reported a net payout of ${existing.net_minor} (minor units) but this record says ${input.netMinor}. Check the payout report.`,
    );
  }
  const id = existing?.id ?? newId(tx.now.getTime());
  if (existing) {
    await db(tx)
      .updateTable('payments.payouts')
      .set({
        gross_minor: input.grossMinor,
        fees_minor: input.feesMinor,
        status: existing.status === 'failed' ? 'failed' : input.status,
        arrival_date: input.arrivalDate,
        version: existing.version + 1,
      })
      .where('id', '=', id)
      .execute();
  } else {
    await db(tx)
      .insertInto('payments.payouts')
      .values({
        id,
        tenant_id: tx.tenantId,
        account_id: account.id,
        legal_entity_id: account.legal_entity_id,
        provider_payout_id: input.providerPayoutId,
        currency: input.currency,
        gross_minor: input.grossMinor,
        fees_minor: input.feesMinor,
        net_minor: input.netMinor,
        arrival_date: input.arrivalDate,
        status: input.status,
        failure_reason: input.failureReason ?? null,
        source: 'manual',
        ledger_status: 'not_required',
        ledger_ref: null,
        ledger_error: null,
      })
      .execute();
  }
  for (const pid of input.paymentIds) {
    const p = await db(tx)
      .selectFrom('payments.payments')
      .select(['id', 'account_id', 'status', 'amount_minor', 'payout_id'])
      .where('id', '=', pid)
      .executeTakeFirst();
    if (!p || p.account_id !== account.id) throw new NotFoundError('payment', pid);
    if (p.status !== 'succeeded' && p.status !== 'recorded_verified' && p.status !== 'recorded_unverified') {
      throw new BusinessRuleError(
        'payment_not_settled',
        `Payment ${pid} was not collected, so it cannot be part of a payout.`,
      );
    }
    if (p.payout_id && p.payout_id !== id) {
      throw new ConflictError('payment_in_other_payout', `Payment ${pid} is already part of another payout.`);
    }
    await db(tx)
      .insertInto('payments.payout_items')
      .values({
        id: newId(tx.now.getTime()),
        tenant_id: tx.tenantId,
        payout_id: id,
        kind: 'payment',
        payment_id: pid,
        refund_id: null,
        amount_minor: p.amount_minor,
      })
      .onConflict((oc) => oc.columns(['payout_id', 'payment_id']).doNothing())
      .execute();
    await db(tx).updateTable('payments.payments').set({ payout_id: id }).where('id', '=', pid).execute();
  }
  for (const rid of input.refundIds) {
    const r = await db(tx)
      .selectFrom('payments.refunds')
      .select(['id', 'amount_minor', 'account_id'])
      .where('id', '=', rid)
      .executeTakeFirst();
    if (!r || r.account_id !== account.id) throw new NotFoundError('refund', rid);
    await db(tx)
      .insertInto('payments.payout_items')
      .values({
        id: newId(tx.now.getTime()),
        tenant_id: tx.tenantId,
        payout_id: id,
        kind: 'refund',
        payment_id: null,
        refund_id: rid,
        amount_minor: -r.amount_minor,
      })
      .onConflict((oc) => oc.columns(['payout_id', 'refund_id']).doNothing())
      .execute();
  }
  const row = await db(tx)
    .selectFrom('payments.payouts')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirstOrThrow();
  if (row.status === 'paid') {
    const posted = await tryLedger(tx, () =>
      d.ledger.recordPayout(tx, {
        legalEntityId: row.legal_entity_id,
        payoutRef: { type: 'payout', id },
        gross: money(input.grossMinor, row.currency),
        fees: money(input.feesMinor, row.currency),
        net: money(input.netMinor, row.currency),
        currency: row.currency,
        idempotencyKey: ledgerKey.payout(id),
      }),
    );
    await db(tx)
      .updateTable('payments.payouts')
      .set(
        posted.ok
          ? { ledger_status: 'posted', ledger_ref: posted.value.journalEntryId, ledger_error: null }
          : { ledger_status: 'failed', ledger_error: posted.error },
      )
      .where('id', '=', id)
      .execute();
    if (posted.ok)
      await resolveExceptionsByKey(tx, `payout-breakdown:${id}`, 'Payout breakdown recorded and posted.');
    else {
      await raiseException(tx, {
        propertyId: null,
        kind: 'ledger_posting_failed',
        severity: 'urgent',
        problem: `Payout ${input.providerPayoutId} could not be posted to the ledger: ${posted.error}`,
        businessImpact: 'The bank balance in the books does not include this payout.',
        nextStep: 'Finance checks the clearing accounts and records the payout again.',
        ownerRole: 'finance',
        responsibleParty: 'hotel',
        ref: { type: 'payout', id },
        dedupeKey: `ledger:payout:${id}`,
      });
    }
  }
  if (!existing || existing.status !== row.status) {
    await payoutFollowUp(tx, id, row.legal_entity_id, row.status, row.failure_reason, false);
  }
  await tx.audit({
    action: 'payments.payout.record',
    target: { type: 'payout', id },
    after: { ...input },
  });
  const final = await db(tx)
    .selectFrom('payments.payouts')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirstOrThrow();
  const n = await db(tx)
    .selectFrom('payments.payout_items')
    .select((eb) => eb.fn.countAll<number>().as('n'))
    .where('payout_id', '=', id)
    .executeTakeFirstOrThrow();
  return toPayoutView(final, Number(n.n));
}

export async function listPayouts(tx: TxContext, accountId?: string): Promise<Payout[]> {
  if (!tx.authz.can('payments.payout.manage') && !tx.authz.can('payments.account.read')) {
    throw new ForbiddenError('payments.account.read');
  }
  let q = db(tx).selectFrom('payments.payouts').selectAll().orderBy('created_at', 'desc').limit(200);
  if (accountId) q = q.where('account_id', '=', accountId);
  const rows = await q.execute();
  return rows.map((r) => toPayoutView(r, 0));
}

// ───────────────────────── disputes ─────────────────────────

function toDisputeView(r: {
  id: string;
  payment_id: string;
  property_id: string;
  provider_dispute_id: string;
  currency: string;
  amount_minor: number;
  reason: string;
  status: string;
  evidence_due_at: Date | null;
  evidence: unknown;
  funds_withdrawn: boolean;
  ledger_movements: unknown;
  version: number;
}): Dispute {
  return {
    id: r.id,
    paymentId: r.payment_id,
    propertyId: r.property_id,
    providerDisputeId: r.provider_dispute_id,
    amount: { amountMinor: r.amount_minor, currency: r.currency },
    reason: r.reason,
    status: r.status,
    evidenceDueAt: r.evidence_due_at ? new Date(r.evidence_due_at).toISOString() : null,
    evidence: (r.evidence as Dispute['evidence']) ?? [],
    fundsWithdrawn: r.funds_withdrawn,
    ledgerMovements: (r.ledger_movements as Array<Record<string, unknown>>) ?? [],
    version: r.version,
  };
}

export async function getDispute(tx: TxContext, id: string): Promise<Dispute> {
  const r = await db(tx).selectFrom('payments.disputes').selectAll().where('id', '=', id).executeTakeFirst();
  if (!r) throw new NotFoundError('dispute', id);
  requireRead(tx, r.property_id);
  return toDisputeView(r);
}

export async function listDisputes(tx: TxContext, propertyId: string): Promise<Dispute[]> {
  requireRead(tx, propertyId);
  const rows = await db(tx)
    .selectFrom('payments.disputes')
    .selectAll()
    .where('property_id', '=', propertyId)
    .orderBy('opened_at', 'desc')
    .execute();
  return rows.map(toDisputeView);
}

export async function updateDisputeEvidence(
  tx: TxContext,
  id: string,
  expectedVersion: number,
  items: Array<{ key: string; done: boolean; note?: string }>,
): Promise<Dispute> {
  const r = await db(tx).selectFrom('payments.disputes').selectAll().where('id', '=', id).executeTakeFirst();
  if (!r) throw new NotFoundError('dispute', id);
  requirePermission(tx, 'payments.dispute.manage', { propertyId: r.property_id });
  const current = (r.evidence as Dispute['evidence']) ?? [];
  for (const i of items) {
    if (!current.some((c) => c.key === i.key)) {
      throw new ValidationError(
        'unknown_evidence_item',
        `"${i.key}" is not on this dispute's evidence checklist.`,
      );
    }
  }
  const next = current.map((c) => {
    const u = items.find((i) => i.key === c.key);
    return u ? { ...c, done: u.done, note: u.note ?? c.note } : c;
  });
  const row = await db(tx)
    .updateTable('payments.disputes')
    .set({ evidence: JSON.stringify(next), version: r.version + 1 })
    .where('id', '=', id)
    .where('version', '=', expectedVersion)
    .returningAll()
    .executeTakeFirst();
  if (!row) return explainVersionMiss('dispute', id, expectedVersion, async () => r.version);
  await tx.audit({
    action: 'payments.dispute.evidence',
    target: { type: 'dispute', id },
    propertyId: r.property_id,
    before: current,
    after: next,
  });
  return toDisputeView(row);
}
