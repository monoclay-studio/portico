/**
 * Ledger hand-off to finance (LedgerPort). Called in the SAME transaction that records a provider-confirmed
 * success (or a recorded Route D payment), inside a savepoint: if finance refuses, the payments record still
 * commits with `ledger_status = failed` and an urgent exception — the truth about the money is never lost, and
 * the posting is retried by reconciliation with the same idempotency key (so it can never post twice).
 */
import { sql, type TxContext } from '@portico/db';
import { money } from '@portico/kernel';
import { db, type PaymentsDeps, raiseException, resolveExceptionsByKey } from './shared';

async function withSavepoint<T>(tx: TxContext, fn: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
  await sql`savepoint payments_ledger`.execute(tx.db);
  try {
    const value = await fn();
    await sql`release savepoint payments_ledger`.execute(tx.db);
    return { ok: true, value };
  } catch (err) {
    await sql`rollback to savepoint payments_ledger`.execute(tx.db);
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export const ledgerKey = {
  payment: (id: string) => `payments:payment:${id}`,
  refund: (id: string) => `payments:refund:${id}`,
  payout: (id: string) => `payments:payout:${id}`,
  adjustment: (id: string) => `payments:adjustment:${id}`,
  dispute: (id: string, kind: 'debit' | 'reversal') => `payments:dispute:${id}:${kind}`,
};

export async function postPaymentLedger(d: PaymentsDeps, tx: TxContext, paymentId: string): Promise<boolean> {
  const p = await db(tx).selectFrom('payments.payments').selectAll().where('id', '=', paymentId).forUpdate().executeTakeFirstOrThrow();
  if (p.ledger_status !== 'pending' && p.ledger_status !== 'failed') return p.ledger_status === 'posted';
  const amount = money(p.amount_minor, p.currency);
  const paymentRef = { type: 'payment', id: p.id };
  const verification = p.mode === 'recorded' ? ('recorded_unverified' as const) : ('provider_confirmed' as const);
  const result = await withSavepoint(tx, () =>
    p.ref_type === 'folio'
      ? d.ledger.recordPayment(tx, {
          folioId: p.ref_id,
          amount,
          paymentRef,
          method: p.method,
          idempotencyKey: ledgerKey.payment(p.id),
          verification,
        })
      : d.ledger.recordDeposit(tx, {
          bookingId: p.ref_id,
          amount,
          paymentRef,
          method: p.method,
          idempotencyKey: ledgerKey.payment(p.id),
          verification,
        }),
  );
  if (result.ok) {
    await db(tx)
      .updateTable('payments.payments')
      .set({ ledger_status: 'posted', ledger_posting_id: result.value.postingId, ledger_error: null })
      .where('id', '=', p.id)
      .execute();
    await resolveExceptionsByKey(tx, `ledger:payment:${p.id}`, 'Posted to the ledger on retry.');
    return true;
  }
  await db(tx)
    .updateTable('payments.payments')
    .set({ ledger_status: 'failed', ledger_error: result.error.slice(0, 1000) })
    .where('id', '=', p.id)
    .execute();
  await raiseException(tx, {
    propertyId: p.property_id,
    kind: 'ledger_posting_failed',
    severity: 'urgent',
    problem: `A ${p.status === 'succeeded' ? 'confirmed' : 'recorded'} payment of ${p.currency} ${p.amount_minor} (minor units) could not be posted to the ${p.ref_type}: ${result.error}`,
    businessImpact: 'The guest has paid but the bill does not show it yet; balances and Day Close are affected.',
    nextStep: 'Portico retries automatically. If it keeps failing, finance checks the folio/booking and posts the payment.',
    ownerRole: 'finance',
    responsibleParty: 'hotel',
    ref: { type: 'payment', id: p.id },
    dedupeKey: `ledger:payment:${p.id}`,
  });
  return false;
}

export async function postRefundLedger(d: PaymentsDeps, tx: TxContext, refundId: string): Promise<boolean> {
  const r = await db(tx).selectFrom('payments.refunds').selectAll().where('id', '=', refundId).forUpdate().executeTakeFirstOrThrow();
  if (r.ledger_status !== 'pending' && r.ledger_status !== 'failed') return r.ledger_status === 'posted';
  const p = await db(tx).selectFrom('payments.payments').selectAll().where('id', '=', r.payment_id).executeTakeFirstOrThrow();
  const result = await withSavepoint(tx, () =>
    d.ledger.recordRefund(tx, {
      folioId: p.ref_type === 'folio' ? p.ref_id : null,
      bookingId: p.ref_type === 'booking' ? p.ref_id : null,
      amount: money(r.amount_minor, r.currency),
      refundRef: { type: 'refund', id: r.id },
      originalPaymentRef: { type: 'payment', id: p.id },
      idempotencyKey: ledgerKey.refund(r.id),
    }),
  );
  if (result.ok) {
    await db(tx)
      .updateTable('payments.refunds')
      .set({ ledger_status: 'posted', ledger_posting_id: result.value.postingId, ledger_error: null })
      .where('id', '=', r.id)
      .execute();
    await resolveExceptionsByKey(tx, `ledger:refund:${r.id}`, 'Posted to the ledger on retry.');
    return true;
  }
  await db(tx)
    .updateTable('payments.refunds')
    .set({ ledger_status: 'failed', ledger_error: result.error.slice(0, 1000) })
    .where('id', '=', r.id)
    .execute();
  await raiseException(tx, {
    propertyId: r.property_id,
    kind: 'ledger_posting_failed',
    severity: 'urgent',
    problem: `A refund of ${r.currency} ${r.amount_minor} (minor units) could not be posted to the ledger: ${result.error}`,
    businessImpact: 'Money has left the hotel but the bill does not show the refund yet.',
    nextStep: 'Portico retries automatically. If it keeps failing, finance posts the refund on the folio/booking.',
    ownerRole: 'finance',
    responsibleParty: 'hotel',
    ref: { type: 'refund', id: r.id },
    dedupeKey: `ledger:refund:${r.id}`,
  });
  return false;
}

/** Run a ledger call inside a savepoint; used by payouts and disputes. */
export async function tryLedger<T>(tx: TxContext, fn: () => Promise<T>) {
  return withSavepoint(tx, fn);
}
