/** Read side: views with presentation, authoritative status per reference, unresolved items, exceptions. */
import { explainVersionMiss, type TxContext } from '@portico/db';
import { ForbiddenError, NotFoundError, requirePermission } from '@portico/kernel';
import type { Authorization, Payment, PaymentException, PaymentsStatus, Refund } from '../contracts';
import { PaymentsEvents } from '../events';
import { accountHealth } from './accounts';
import { recordContext } from './records';
import {
  actorKey,
  db,
  type PaymentsDeps,
  readableProperties,
  requireRead,
  toAuthorizationView,
  toExceptionView,
  toPaymentView,
  toRefundView,
} from './shared';

export async function getPayment(tx: TxContext, id: string): Promise<Payment> {
  const p = await db(tx).selectFrom('payments.payments').selectAll().where('id', '=', id).executeTakeFirst();
  if (!p) throw new NotFoundError('payment', id);
  requireRead(tx, p.property_id);
  return toPaymentView(p, await recordContext(tx, [{ type: 'payment', id }]));
}

async function capabilitiesByAccount(tx: TxContext, accountIds: string[]): Promise<Map<string, string[]>> {
  if (!accountIds.length) return new Map();
  const rows = await db(tx).selectFrom('payments.accounts').select(['id', 'capabilities']).where('id', 'in', accountIds).execute();
  return new Map(rows.map((r) => [r.id, (r.capabilities as string[]) ?? []]));
}

export async function getAuthorization(tx: TxContext, id: string): Promise<Authorization> {
  const a = await db(tx).selectFrom('payments.authorizations').selectAll().where('id', '=', id).executeTakeFirst();
  if (!a) throw new NotFoundError('authorization', id);
  requireRead(tx, a.property_id);
  const caps = await capabilitiesByAccount(tx, [a.account_id]);
  return toAuthorizationView(a, await recordContext(tx, [{ type: 'authorization', id }]), caps.get(a.account_id) ?? []);
}

export async function getRefund(tx: TxContext, id: string): Promise<Refund> {
  const r = await db(tx).selectFrom('payments.refunds').selectAll().where('id', '=', id).executeTakeFirst();
  if (!r) throw new NotFoundError('refund', id);
  requireRead(tx, r.property_id);
  return toRefundView(r, await recordContext(tx, [{ type: 'refund', id }]));
}

/** History of provider interactions for a record (journal): what was sent, when, and what came back. */
export async function operationHistory(tx: TxContext, target: { type: string; id: string; propertyId: string }) {
  requireRead(tx, target.propertyId);
  const ops = await db(tx)
    .selectFrom('payments.provider_operations')
    .select(['id', 'kind', 'status', 'attempts', 'mode', 'failure_code', 'created_at', 'sent_at', 'completed_at'])
    .where((eb) =>
      eb.or([
        eb.and([eb('target_type', '=', target.type as 'payment'), eb('target_id', '=', target.id)]),
        ...(target.type === 'authorization' ? [eb('authorization_id', '=', target.id)] : []),
      ]),
    )
    .orderBy('created_at')
    .execute();
  const journal = ops.length
    ? await db(tx)
        .selectFrom('payments.operation_journal')
        .select(['operation_id', 'attempt', 'phase', 'status', 'recorded_at'])
        .where(
          'operation_id',
          'in',
          ops.map((o) => o.id),
        )
        .orderBy('recorded_at')
        .execute()
    : [];
  return ops.map((o) => ({
    operationId: o.id,
    kind: o.kind,
    status: o.status,
    attempts: o.attempts,
    mode: o.mode,
    failureCode: o.failure_code,
    createdAt: new Date(o.created_at).toISOString(),
    sentAt: o.sent_at ? new Date(o.sent_at).toISOString() : null,
    completedAt: o.completed_at ? new Date(o.completed_at).toISOString() : null,
    journal: journal
      .filter((j) => j.operation_id === o.id)
      .map((j) => ({ attempt: j.attempt, phase: j.phase, status: j.status, at: new Date(j.recorded_at).toISOString() })),
  }));
}

export interface PaymentStatusSummary {
  ref: { type: string; id: string };
  /** Per currency, in minor units. "confirmed" counts provider-confirmed and statement-verified money only. */
  totals: Array<{
    currency: string;
    confirmedMinor: number;
    recordedUnverifiedMinor: number;
    pendingVerificationMinor: number;
    refundedMinor: number;
    heldMinor: number;
  }>;
  payments: Payment[];
  authorizations: Authorization[];
  refunds: Refund[];
  hasPendingVerification: boolean;
}

/** Domain-map provider: authoritative payment status for a business reference, incl. pending verification. */
export async function getPaymentStatus(tx: TxContext, ref: { type: string; id: string }): Promise<PaymentStatusSummary> {
  const paymentRows = await db(tx)
    .selectFrom('payments.payments')
    .selectAll()
    .where('ref_type', '=', ref.type as 'folio')
    .where('ref_id', '=', ref.id)
    .orderBy('created_at')
    .execute();
  const authRows = await db(tx)
    .selectFrom('payments.authorizations')
    .selectAll()
    .where('ref_type', '=', ref.type)
    .where('ref_id', '=', ref.id)
    .orderBy('created_at')
    .execute();
  const props = new Set([...paymentRows.map((p) => p.property_id), ...authRows.map((a) => a.property_id)]);
  for (const p of props) requireRead(tx, p);
  const refundRows = paymentRows.length
    ? await db(tx)
        .selectFrom('payments.refunds')
        .selectAll()
        .where(
          'payment_id',
          'in',
          paymentRows.map((p) => p.id),
        )
        .orderBy('created_at')
        .execute()
    : [];
  const totals = new Map<string, PaymentStatusSummary['totals'][number]>();
  const t = (c: string) => {
    let x = totals.get(c);
    if (!x) {
      x = { currency: c, confirmedMinor: 0, recordedUnverifiedMinor: 0, pendingVerificationMinor: 0, refundedMinor: 0, heldMinor: 0 };
      totals.set(c, x);
    }
    return x;
  };
  for (const p of paymentRows) {
    if (p.status === 'succeeded' || p.status === 'recorded_verified') t(p.currency).confirmedMinor += p.amount_minor;
    if (p.status === 'recorded_unverified') t(p.currency).recordedUnverifiedMinor += p.amount_minor;
    if (p.status === 'pending_verification' || p.status === 'processing') t(p.currency).pendingVerificationMinor += p.amount_minor;
  }
  for (const r of refundRows) {
    if (r.status === 'succeeded' || r.status === 'recorded_verified' || r.status === 'recorded_unverified') {
      t(r.currency).refundedMinor += r.amount_minor;
    }
  }
  for (const a of authRows) {
    if (a.status === 'authorized' || a.status === 'partially_captured') t(a.currency).heldMinor += a.amount_minor - a.captured_minor;
  }
  const rc = await recordContext(tx, [
    ...paymentRows.map((p) => ({ type: 'payment', id: p.id })),
    ...authRows.map((a) => ({ type: 'authorization', id: a.id })),
    ...refundRows.map((r) => ({ type: 'refund', id: r.id })),
  ]);
  const caps = await capabilitiesByAccount(tx, [...new Set(authRows.map((a) => a.account_id))]);
  return {
    ref,
    totals: [...totals.values()],
    payments: paymentRows.map((p) => toPaymentView(p, rc)),
    authorizations: authRows.map((a) => toAuthorizationView(a, rc, caps.get(a.account_id) ?? [])),
    refunds: refundRows.map((r) => toRefundView(r, rc)),
    hasPendingVerification:
      paymentRows.some((p) => p.status === 'pending_verification' || p.status === 'processing') ||
      authRows.some((a) => a.status === 'pending_verification' || a.status === 'processing') ||
      refundRows.some((r) => r.status === 'pending_verification' || r.status === 'processing'),
  };
}

export interface UnresolvedItems {
  propertyId: string;
  pendingVerification: Array<{ type: 'payment' | 'authorization' | 'refund'; id: string; amountMinor: number; currency: string; since: string }>;
  recordedUnverified: number;
  ledgerPending: number;
  openExceptions: number;
}

/** Domain-map provider for Day Close and dashboards. */
export async function listUnresolved(tx: TxContext, input: { propertyId: string }): Promise<UnresolvedItems> {
  requireRead(tx, input.propertyId);
  const pid = input.propertyId;
  const pv = ['processing', 'pending_verification'] as const;
  const [pays, auths, refunds, recorded, ledger, exceptions] = await Promise.all([
    db(tx).selectFrom('payments.payments').select(['id', 'amount_minor', 'currency', 'created_at']).where('property_id', '=', pid).where('status', 'in', [...pv]).execute(),
    db(tx).selectFrom('payments.authorizations').select(['id', 'amount_minor', 'currency', 'created_at']).where('property_id', '=', pid).where('status', 'in', [...pv]).execute(),
    db(tx).selectFrom('payments.refunds').select(['id', 'amount_minor', 'currency', 'created_at']).where('property_id', '=', pid).where('status', 'in', [...pv]).execute(),
    db(tx).selectFrom('payments.payments').select((eb) => eb.fn.countAll<number>().as('n')).where('property_id', '=', pid).where('status', '=', 'recorded_unverified').executeTakeFirstOrThrow(),
    db(tx).selectFrom('payments.payments').select((eb) => eb.fn.countAll<number>().as('n')).where('property_id', '=', pid).where('ledger_status', 'in', ['pending', 'failed']).executeTakeFirstOrThrow(),
    db(tx).selectFrom('payments.exceptions').select((eb) => eb.fn.countAll<number>().as('n')).where('status', '=', 'open').where((eb) => eb.or([eb('property_id', '=', pid), eb('property_id', 'is', null)])).executeTakeFirstOrThrow(),
  ]);
  const item = (type: 'payment' | 'authorization' | 'refund') => (r: { id: string; amount_minor: number; currency: string; created_at: Date }) => ({
    type,
    id: r.id,
    amountMinor: r.amount_minor,
    currency: r.currency,
    since: new Date(r.created_at).toISOString(),
  });
  return {
    propertyId: pid,
    pendingVerification: [...pays.map(item('payment')), ...auths.map(item('authorization')), ...refunds.map(item('refund'))],
    recordedUnverified: Number(recorded.n),
    ledgerPending: Number(ledger.n),
    openExceptions: Number(exceptions.n),
  };
}

/** Payments status for a property: provider health per account (s20), unresolved items, a clear banner. */
export async function paymentsStatus(d: PaymentsDeps, tx: TxContext, propertyId: string): Promise<PaymentsStatus> {
  requireRead(tx, propertyId);
  const property = await d.platform.getProperty(tx, propertyId);
  const accounts = await db(tx)
    .selectFrom('payments.accounts')
    .select('id')
    .where('legal_entity_id', '=', property.legalEntityId)
    .orderBy('created_at')
    .execute();
  const health = [];
  for (const a of accounts) health.push(await accountHealth(d, tx, a.id));
  const unresolved = await listUnresolved(tx, { propertyId });
  const card = health.filter((h) => h.provider !== 'external_terminal');
  const available = card.some((h) => h.cardPaymentsAvailable);
  const down = card.filter((h) => !h.cardPaymentsAvailable);
  return {
    propertyId,
    environment: tx.environment,
    cardPaymentsAvailable: available,
    banner:
      card.length === 0
        ? null
        : !available
          ? (down[0]?.message ?? 'Card payments unavailable.')
          : down.length
            ? `Some payment accounts are unavailable: ${down.map((h) => h.displayName).join(', ')}.`
            : null,
    accounts: health,
    unresolved,
  };
}

// ───────────────────────── exceptions ─────────────────────────

export async function listExceptions(
  tx: TxContext,
  filter: { propertyId?: string; status?: 'open' | 'resolved' },
): Promise<PaymentException[]> {
  const scope = readableProperties(tx);
  if (scope !== 'all' && scope.length === 0 && !tx.authz.can('payments.account.read')) {
    throw new ForbiddenError('payments.payment.read');
  }
  let q = db(tx).selectFrom('payments.exceptions').selectAll().orderBy('created_at', 'desc').limit(500);
  if (filter.status) q = q.where('status', '=', filter.status);
  if (filter.propertyId) {
    requireRead(tx, filter.propertyId);
    q = q.where((eb) => eb.or([eb('property_id', '=', filter.propertyId as string), eb('property_id', 'is', null)]));
  }
  const rows = await q.execute();
  return rows
    .filter((e) => (e.property_id === null ? true : scope === 'all' || scope.includes(e.property_id)))
    .map((e) => toExceptionView(e, tx.authz));
}

export async function resolveException(
  tx: TxContext,
  id: string,
  expectedVersion: number,
  resolution: string,
): Promise<PaymentException> {
  const e = await db(tx).selectFrom('payments.exceptions').selectAll().where('id', '=', id).executeTakeFirst();
  if (!e) throw new NotFoundError('payment_exception', id);
  if (e.property_id) requirePermission(tx, 'payments.reconciliation.manage', { propertyId: e.property_id });
  else requirePermission(tx, 'payments.account.manage');
  const row = await db(tx)
    .updateTable('payments.exceptions')
    .set({ status: 'resolved', resolution, resolved_by: actorKey(tx), resolved_at: tx.now, version: e.version + 1 })
    .where('id', '=', id)
    .where('version', '=', expectedVersion)
    .where('status', '=', 'open')
    .returningAll()
    .executeTakeFirst();
  if (!row) return explainVersionMiss('payment_exception', id, expectedVersion, async () => e.version);
  await tx.audit({
    action: 'payments.exception.resolve',
    target: { type: 'payment_exception', id },
    propertyId: e.property_id,
    reason: resolution,
    before: { status: e.status },
    after: { status: 'resolved' },
  });
  await tx.emit({
    type: PaymentsEvents.exceptionResolved,
    propertyId: e.property_id,
    aggregate: { type: 'payment_exception', id },
    payload: { exceptionId: id, resolution },
  });
  return toExceptionView(row, tx.authz);
}
