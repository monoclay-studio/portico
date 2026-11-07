/**
 * Ledger hand-off to finance (LedgerPort). Called in the SAME transaction that records a provider-confirmed
 * success (or a confirmed Route D payment), inside a savepoint: if finance refuses, the payments record still
 * commits with `ledger_status = failed` and an urgent exception — the truth about the money is never lost, and
 * the posting is retried by reconciliation with backoff and the same idempotency key (never twice).
 *
 * Every call carries the property and its operating legal entity (finance refuses cross-property targets) and the
 * clearing account (provider + payment account) the money sits in until payout.
 */
import { type TxContext, withSavepoint } from '@portico/db';
import { formatMoney, money } from '@portico/kernel';
import type { ClearingRef } from '../ports';
import { db, type PaymentRow, type PaymentsDeps, raiseException, resolveExceptionsByKey } from './shared';

/** Retry schedule for failed ledger postings: 1 min, 5 min, 30 min, 2 h, 6 h, then daily. */
const LEDGER_BACKOFF_MS = [60_000, 300_000, 1_800_000, 7_200_000, 21_600_000];
export function nextLedgerAttempt(attempts: number, now: Date): Date {
  return new Date(now.getTime() + (LEDGER_BACKOFF_MS[attempts - 1] ?? 86_400_000));
}

async function attempt<T>(
  tx: TxContext,
  fn: () => Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
  try {
    return { ok: true, value: await withSavepoint(tx, 'payments_ledger', fn) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export const ledgerKey = {
  payment: (id: string) => `payments:payment:${id}`,
  refund: (id: string) => `payments:refund:${id}`,
  payout: (id: string) => `payments:payout:${id}`,
  adjustment: (id: string) => `payments:adjustment:${id}`,
  dispute: (id: string, kind: 'debit' | 'reversal') => `payments:dispute:${id}:${kind}`,
  verified: (type: 'payment' | 'refund', id: string) => `payments:verified:${type}:${id}`,
  fees: (statementId: string) => `payments:settlement-fees:${statementId}`,
};

export async function clearingOf(
  tx: TxContext,
  p: Pick<PaymentRow, 'account_id' | 'method'>,
): Promise<ClearingRef> {
  if (p.method === 'cash') return { provider: 'cash', accountId: null };
  if (p.method === 'bank_transfer') return { provider: 'bank_transfer', accountId: null };
  if (!p.account_id) return { provider: 'external_terminal', accountId: null };
  const a = await db(tx)
    .selectFrom('payments.accounts')
    .select(['provider'])
    .where('id', '=', p.account_id)
    .executeTakeFirst();
  return { provider: a?.provider ?? 'external_terminal', accountId: p.account_id };
}

function verificationOf(p: PaymentRow): 'provider_confirmed' | 'recorded_unverified' | 'recorded_verified' {
  if (p.mode !== 'recorded') return 'provider_confirmed';
  return p.status === 'recorded_verified' ? 'recorded_verified' : 'recorded_unverified';
}

export async function postPaymentLedger(d: PaymentsDeps, tx: TxContext, paymentId: string): Promise<boolean> {
  const p = await db(tx)
    .selectFrom('payments.payments')
    .selectAll()
    .where('id', '=', paymentId)
    .forUpdate()
    .executeTakeFirstOrThrow();
  if (p.ledger_status !== 'pending' && p.ledger_status !== 'failed') return p.ledger_status === 'posted';
  const amount = money(p.amount_minor, p.currency);
  const paymentRef = { type: 'payment', id: p.id };
  const scope = { propertyId: p.property_id, legalEntityId: p.legal_entity_id };
  const clearing = await clearingOf(tx, p);
  const result = await attempt(tx, () =>
    p.ref_type === 'folio'
      ? d.ledger.recordPayment(tx, {
          ...scope,
          folioId: p.ref_id,
          amount,
          paymentRef,
          method: p.method,
          idempotencyKey: ledgerKey.payment(p.id),
          verification: verificationOf(p),
          clearing,
        })
      : d.ledger.recordDeposit(tx, {
          ...scope,
          bookingId: p.ref_id,
          amount,
          paymentRef,
          method: p.method,
          idempotencyKey: ledgerKey.payment(p.id),
          verification: verificationOf(p),
          clearing,
        }),
  );
  if (result.ok) {
    await db(tx)
      .updateTable('payments.payments')
      .set({
        ledger_status: 'posted',
        ledger_posting_id: result.value.postingId,
        ledger_error: null,
        ledger_next_attempt_at: null,
      })
      .where('id', '=', p.id)
      .execute();
    await resolveExceptionsByKey(tx, `ledger:payment:${p.id}`, 'Posted to the ledger on retry.');
    return true;
  }
  const attempts = p.ledger_attempts + 1;
  await db(tx)
    .updateTable('payments.payments')
    .set({
      ledger_status: 'failed',
      ledger_error: result.error.slice(0, 1000),
      ledger_attempts: attempts,
      ledger_next_attempt_at: nextLedgerAttempt(attempts, tx.now),
    })
    .where('id', '=', p.id)
    .execute();
  await raiseException(tx, {
    propertyId: p.property_id,
    kind: 'ledger_posting_failed',
    severity: 'urgent',
    problem: `A ${p.mode === 'recorded' ? 'recorded' : 'confirmed'} payment of ${formatMoney(amount)} could not be posted to the ${p.ref_type}: ${result.error}`,
    businessImpact:
      'The guest has paid but the bill does not show it yet; balances and Day Close are affected.',
    nextStep:
      'Portico retries automatically with backoff. If it keeps failing, finance checks the folio/booking and posts the payment.',
    ownerRole: 'finance',
    responsibleParty: 'hotel',
    ref: { type: 'payment', id: p.id },
    dedupeKey: `ledger:payment:${p.id}`,
  });
  return false;
}

export async function postRefundLedger(d: PaymentsDeps, tx: TxContext, refundId: string): Promise<boolean> {
  const r = await db(tx)
    .selectFrom('payments.refunds')
    .selectAll()
    .where('id', '=', refundId)
    .forUpdate()
    .executeTakeFirstOrThrow();
  if (r.ledger_status !== 'pending' && r.ledger_status !== 'failed') return r.ledger_status === 'posted';
  const p = await db(tx)
    .selectFrom('payments.payments')
    .selectAll()
    .where('id', '=', r.payment_id)
    .executeTakeFirstOrThrow();
  const amount = money(r.amount_minor, r.currency);
  const clearing = await clearingOf(tx, p);
  const result = await attempt(tx, () =>
    d.ledger.recordRefund(tx, {
      propertyId: p.property_id,
      legalEntityId: p.legal_entity_id,
      folioId: p.ref_type === 'folio' ? p.ref_id : null,
      bookingId: p.ref_type === 'booking' ? p.ref_id : null,
      amount,
      refundRef: { type: 'refund', id: r.id },
      originalPaymentRef: { type: 'payment', id: p.id },
      idempotencyKey: ledgerKey.refund(r.id),
      clearing,
    }),
  );
  if (result.ok) {
    await db(tx)
      .updateTable('payments.refunds')
      .set({
        ledger_status: 'posted',
        ledger_posting_id: result.value.postingId,
        ledger_error: null,
        ledger_next_attempt_at: null,
      })
      .where('id', '=', r.id)
      .execute();
    await resolveExceptionsByKey(tx, `ledger:refund:${r.id}`, 'Posted to the ledger on retry.');
    return true;
  }
  const attempts = r.ledger_attempts + 1;
  await db(tx)
    .updateTable('payments.refunds')
    .set({
      ledger_status: 'failed',
      ledger_error: result.error.slice(0, 1000),
      ledger_attempts: attempts,
      ledger_next_attempt_at: nextLedgerAttempt(attempts, tx.now),
    })
    .where('id', '=', r.id)
    .execute();
  await raiseException(tx, {
    propertyId: r.property_id,
    kind: 'ledger_posting_failed',
    severity: 'urgent',
    problem: `A refund of ${formatMoney(amount)} could not be posted to the ledger: ${result.error}`,
    businessImpact: 'Money has left the hotel but the bill does not show the refund yet.',
    nextStep:
      'Portico retries automatically with backoff. If it keeps failing, finance posts the refund on the folio/booking.',
    ownerRole: 'finance',
    responsibleParty: 'hotel',
    ref: { type: 'refund', id: r.id },
    dedupeKey: `ledger:refund:${r.id}`,
  });
  return false;
}

/** Tell finance that a recorded payment/refund is now verified (statement match or confirmed receipt). */
export async function postVerification(
  d: PaymentsDeps,
  tx: TxContext,
  target: { type: 'payment' | 'refund'; id: string },
  evidence: { type: string; id: string },
): Promise<boolean> {
  const scope =
    target.type === 'payment'
      ? await db(tx)
          .selectFrom('payments.payments')
          .select(['property_id', 'legal_entity_id', 'verification_ledger_status'])
          .where('id', '=', target.id)
          .forUpdate()
          .executeTakeFirstOrThrow()
      : await db(tx)
          .selectFrom('payments.refunds as r')
          .innerJoin('payments.payments as p', 'p.id', 'r.payment_id')
          .select(['r.property_id', 'p.legal_entity_id', 'r.verification_ledger_status'])
          .where('r.id', '=', target.id)
          .executeTakeFirstOrThrow();
  if (scope.verification_ledger_status === 'posted') return true;
  const result = await attempt(tx, () =>
    d.ledger.markPaymentVerified(tx, {
      propertyId: scope.property_id,
      legalEntityId: scope.legal_entity_id,
      paymentRef: target,
      evidenceRef: evidence,
      idempotencyKey: ledgerKey.verified(target.type, target.id),
    }),
  );
  const status = result.ok ? ('posted' as const) : ('failed' as const);
  if (target.type === 'payment') {
    await db(tx)
      .updateTable('payments.payments')
      .set({ verification_ledger_status: status })
      .where('id', '=', target.id)
      .execute();
  } else {
    await db(tx)
      .updateTable('payments.refunds')
      .set({ verification_ledger_status: status })
      .where('id', '=', target.id)
      .execute();
  }
  if (!result.ok) {
    await raiseException(tx, {
      propertyId: scope.property_id,
      kind: 'ledger_verification_failed',
      severity: 'routine',
      problem: `Finance could not record that a ${target.type} was verified against the statement: ${result.error}`,
      businessImpact: 'The bill still shows the payment as "awaiting verification".',
      nextStep: 'Portico retries automatically; finance can check the folio.',
      ownerRole: 'finance',
      responsibleParty: 'hotel',
      ref: target,
      dedupeKey: `ledger-verified:${target.type}:${target.id}`,
    });
  } else {
    await resolveExceptionsByKey(
      tx,
      `ledger-verified:${target.type}:${target.id}`,
      'Verification recorded in finance.',
    );
  }
  return result.ok;
}

/** Run a ledger call inside a savepoint; used by payouts, disputes, adjustments and settlement fees. */
export async function tryLedger<T>(tx: TxContext, fn: () => Promise<T>) {
  return attempt(tx, fn);
}
