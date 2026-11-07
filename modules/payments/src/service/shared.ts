/** Shared helpers for the payments services: dependencies, loaders, guards, mappers, exceptions, journal. */
import { type PorticoDatabase, type Selectable, type TxContext, typed } from '@portico/db';
import {
  type Authorizer,
  BusinessRuleError,
  ConflictError,
  canonicalJson,
  DomainError,
  ForbiddenError,
  formatMoney,
  IdempotencyConflictError,
  money,
  NotFoundError,
  newId,
  type RequestContext,
  sha256Hex,
} from '@portico/kernel';
import type {
  Authorization,
  Payment,
  PaymentAccount,
  PaymentException,
  PaymentMethod,
  PaymentRequest,
  Refund,
} from '../contracts';
import { type BreakerConfig, OUTAGE_ACTIONS } from '../domain/circuit-breaker';
import { explainDecline } from '../domain/declines';
import { presentAuthorization, presentPayment, presentRefund, presentRequest } from '../domain/presentation';
import { capturableMinor, refundableMinor } from '../domain/states';
import { PaymentsEvents } from '../events';
import type { LedgerPort, PlatformPort, PropertyInfo } from '../ports';
import type { ProviderAccount, SimulatorControls } from '../providers/provider';
import type { ProviderRegistry } from '../providers/registry';
import type {
  AccountsTable,
  AuthorizationsTable,
  ExceptionsTable,
  PaymentMethodsTable,
  PaymentRequestsTable,
  PaymentsDB,
  PaymentsTable,
  RefundsTable,
} from '../tables';
import {
  authorizationRecord,
  exceptionRecord,
  paymentRecord,
  type RecordContext,
  refundRecord,
  requestRecord,
} from './records';

export interface PaymentsDeps {
  database: PorticoDatabase;
  ledger: LedgerPort;
  platform: PlatformPort;
  registry: ProviderRegistry;
  breaker: BreakerConfig;
}

export const db = (tx: TxContext) => typed<PaymentsDB>(tx.db);

export type AccountRow = Selectable<AccountsTable>;
export type MethodRow = Selectable<PaymentMethodsTable>;
export type AuthorizationRow = Selectable<AuthorizationsTable>;
export type PaymentRow = Selectable<PaymentsTable>;
export type RefundRow = Selectable<RefundsTable>;
export type RequestRow = Selectable<PaymentRequestsTable>;
export type ExceptionRow = Selectable<ExceptionsTable>;

/** Strip a TxContext down to the request context (for work that must run after commit). */
export function requestContextOf(ctx: RequestContext): RequestContext {
  return {
    tenantId: ctx.tenantId,
    environment: ctx.environment,
    actor: ctx.actor,
    authz: ctx.authz,
    correlationId: ctx.correlationId,
    ...(ctx.origin ? { origin: ctx.origin } : {}),
  };
}

export function actorKey(ctx: RequestContext): string {
  const a = ctx.actor;
  switch (a.kind) {
    case 'user':
      return `user:${a.userId}`;
    case 'api_client':
      return `api:${a.clientId}`;
    case 'system':
      return `system:${a.process}`;
    case 'guest':
      return 'guest';
  }
}

/** Reading payment information: `payments.payment.read`, or the desk's collect permission. */
export function requireRead(ctx: RequestContext, propertyId: string): void {
  if (ctx.authz.can('payments.payment.read', { propertyId })) return;
  if (ctx.authz.can('payments.payment.collect', { propertyId })) return;
  throw new ForbiddenError('payments.payment.read', { propertyId });
}

/** Property ids readable by the actor, or 'all'. */
export function readableProperties(ctx: RequestContext): readonly string[] | 'all' {
  const a = ctx.authz.propertyScope('payments.payment.read');
  const b = ctx.authz.propertyScope('payments.payment.collect');
  if (a === 'all' || b === 'all') return 'all';
  return [...new Set([...a, ...b])];
}

/** ADR-0014: payments must be writable here. Forwarding payments to another system is not available. */
export async function assertPaymentsWritable(
  d: PaymentsDeps,
  tx: TxContext,
  propertyId: string,
): Promise<void> {
  const mode = await d.platform.assertWritable(tx, propertyId, 'payments');
  if (mode === 'forward') {
    throw new BusinessRuleError(
      'payments_forwarding_unavailable',
      'Payments at this property are handled by another system of record. Take the payment in that system; Portico cannot forward payments to it yet.',
      { propertyId },
    );
  }
}

export async function loadProperty(
  d: PaymentsDeps,
  tx: TxContext,
  propertyId: string,
): Promise<PropertyInfo> {
  return d.platform.getProperty(tx, propertyId);
}

/**
 * P0-1: the folio/booking a collection posts to must belong to the property the caller acts for AND to its
 * operating legal entity (merchant of record). Checked BEFORE any money moves; finance re-checks on posting.
 */
export async function assertLedgerTarget(
  d: PaymentsDeps,
  tx: TxContext,
  ref: { type: 'folio' | 'booking'; id: string },
  property: PropertyInfo,
): Promise<void> {
  const owner = await d.ledger.describeTarget(tx, ref);
  if (!owner) {
    if (ref.type === 'booking') return; // first deposit: finance binds the booking to this property on posting
    throw new BusinessRuleError(
      'ledger_target_unknown',
      'Finance does not know this folio, so a payment could not be shown on any bill. Open the folio first (or choose the right one), then collect.',
      { ref },
    );
  }
  if (owner.propertyId !== property.id) {
    throw new BusinessRuleError(
      'ledger_target_other_property',
      `This ${ref.type} belongs to another property. Collect at the property that owns it, or choose this property's ${ref.type}.`,
      { ref, propertyId: property.id },
    );
  }
  if (owner.legalEntityId !== property.legalEntityId) {
    throw new BusinessRuleError(
      'wrong_merchant_of_record',
      `This ${ref.type} belongs to a different legal entity than the one operating this property; the money would be booked in the wrong company's books.`,
      { ref },
    );
  }
}

/** Fingerprint of a command's business content, stored with the record to detect a reused key (rule 7). */
export function requestHash(input: unknown): string {
  return sha256Hex(canonicalJson(input));
}

export function assertSameRequest(existing: string | null, hash: string, what: string): void {
  if (existing && existing !== hash) {
    throw new IdempotencyConflictError(
      `This idempotency key was already used for a different ${what}. Use a new key for a new ${what}; reuse a key only to retry the same one.`,
    );
  }
}

export async function loadAccount(tx: TxContext, id: string, lock = false): Promise<AccountRow> {
  let q = db(tx).selectFrom('payments.accounts').selectAll().where('id', '=', id);
  if (lock) q = q.forUpdate();
  const row = await q.executeTakeFirst();
  if (!row) throw new NotFoundError('payment_account', id);
  return row;
}

export function toProviderAccount(a: AccountRow): ProviderAccount {
  return {
    id: a.id,
    tenantId: a.tenant_id,
    provider: a.provider,
    externalAccountId: a.external_account_id,
    currencies: a.currencies,
    applicationFeeBps: a.application_fee_bps,
    statementDescriptor: a.statement_descriptor,
    simulatorControls: (a.simulator_controls ?? {}) as SimulatorControls,
  };
}

/**
 * The account must belong to the property's operating legal entity (merchant of record), be active and
 * support the currency. Messages explain the recovery.
 */
export function assertAccountUsable(account: AccountRow, property: PropertyInfo, currency: string): void {
  if (account.legal_entity_id !== property.legalEntityId) {
    throw new BusinessRuleError(
      'wrong_merchant_of_record',
      "This payment account belongs to a different legal entity than the one operating this property. Payments must go to the operating legal entity's own account.",
      { accountId: account.id, propertyId: property.id },
    );
  }
  if (account.status === 'pending') {
    throw new BusinessRuleError(
      'payment_account_not_active',
      'This payment account has not finished onboarding with its provider. Use cash, the hotel’s own terminal, or another account until it is active.',
      { accountId: account.id },
    );
  }
  if (account.status === 'restricted' || account.status === 'disabled') {
    throw new BusinessRuleError(
      'payment_account_restricted',
      `This payment account is ${account.status}${account.status_reason ? ` (${account.status_reason})` : ''}. Nothing was charged. Accept cash, record a payment taken on the hotel’s own terminal, or send a payment link from another account; finance must resolve the account with the provider.`,
      { accountId: account.id, status: account.status },
    );
  }
  if (!account.currencies.includes(currency)) {
    throw new BusinessRuleError(
      'currency_not_supported_by_account',
      `This payment account does not accept ${currency} (it accepts ${account.currencies.join(', ')}). Charge in a supported currency or use another method.`,
      { accountId: account.id, currency },
    );
  }
}

export function uniqueViolation(err: unknown): boolean {
  return (err as { code?: string }).code === '23505';
}

/** Card payments unavailable (breaker open): nothing was created, the staff actions are listed. */
export class ProviderUnavailableError extends DomainError {
  constructor(accountId: string, retryAfter: Date) {
    super(
      'card_payments_unavailable',
      'Card payments are unavailable right now: the payment provider is not responding. Nothing was charged. Accept cash, send a payment link to be paid later, or take the card on the hotel’s own terminal and record it (manual authorization or recorded payment).',
      {
        status: 503,
        retryable: true,
        details: {
          accountId,
          retryAfter: retryAfter.toISOString(),
          actions: OUTAGE_ACTIONS.map((a) => ({ ...a })),
        },
      },
    );
  }
}

export class PendingVerificationBlockError extends ConflictError {
  constructor(input: {
    kind: 'payment' | 'authorization' | 'refund';
    id: string;
    amountMinor: number;
    currency: string;
    since: Date;
  }) {
    super(
      `${input.kind}_pending_verification`,
      `A ${input.kind} of ${formatMoney(money(input.amountMinor, input.currency))} started at ${input.since.toISOString()} is still being processed or verified with the provider. Check its status or wait — starting another one now could charge the guest twice.`,
      { ...input, since: input.since.toISOString() },
    );
  }
}

// ───────────────────────── exceptions ─────────────────────────

export interface ExceptionInput {
  propertyId: string | null;
  kind: string;
  severity: 'urgent' | 'routine';
  problem: string;
  businessImpact: string;
  nextStep: string;
  ownerRole: string;
  responsibleParty: 'hotel' | 'monoclay' | 'provider';
  ref?: { type: string; id: string };
  dedupeKey: string;
}

/** Raise a payment exception once per dedupe key; returns its id (existing one when already raised). */
export async function raiseException(tx: TxContext, e: ExceptionInput): Promise<string> {
  const id = newId();
  const inserted = await db(tx)
    .insertInto('payments.exceptions')
    .values({
      id,
      tenant_id: tx.tenantId,
      property_id: e.propertyId,
      kind: e.kind,
      severity: e.severity,
      problem: e.problem,
      business_impact: e.businessImpact,
      next_step: e.nextStep,
      owner_role: e.ownerRole,
      responsible_party: e.responsibleParty,
      assignee_user_id: null,
      ref_type: e.ref?.type ?? null,
      ref_id: e.ref?.id ?? null,
      dedupe_key: e.dedupeKey,
      status: 'open',
      resolution: null,
      resolved_by: null,
      resolved_at: null,
    })
    .onConflict((oc) => oc.columns(['tenant_id', 'dedupe_key']).doNothing())
    .returning('id')
    .executeTakeFirst();
  if (!inserted) {
    const existing = await db(tx)
      .selectFrom('payments.exceptions')
      .select(['id', 'status', 'version', 'occurrences'])
      .where('dedupe_key', '=', e.dedupeKey)
      .forUpdate()
      .executeTakeFirstOrThrow();
    if (existing.status === 'open') return existing.id;
    // The problem came back after someone resolved it: reopen it (a recurrence must never vanish).
    await db(tx)
      .updateTable('payments.exceptions')
      .set({
        status: 'open',
        problem: e.problem,
        next_step: e.nextStep,
        resolution: null,
        resolved_by: null,
        resolved_at: null,
        occurrences: existing.occurrences + 1,
        version: existing.version + 1,
      })
      .where('id', '=', existing.id)
      .execute();
    await tx.audit({
      action: 'payments.exception.reopen',
      target: { type: 'payment_exception', id: existing.id },
      propertyId: e.propertyId,
      after: e,
    });
    await tx.emit({
      type: PaymentsEvents.exceptionRaised,
      propertyId: e.propertyId,
      aggregate: { type: 'payment_exception', id: existing.id },
      payload: {
        exceptionId: existing.id,
        kind: e.kind,
        severity: e.severity,
        ownerRole: e.ownerRole,
        reopened: true,
      },
    });
    return existing.id;
  }
  await tx.audit({
    action: 'payments.exception.raise',
    target: { type: 'payment_exception', id },
    propertyId: e.propertyId,
    after: e,
  });
  await tx.emit({
    type: PaymentsEvents.exceptionRaised,
    propertyId: e.propertyId,
    aggregate: { type: 'payment_exception', id },
    payload: { exceptionId: id, kind: e.kind, severity: e.severity, ownerRole: e.ownerRole },
  });
  return id;
}

/** Resolve open exceptions by dedupe key (system-detected recovery). */
export async function resolveExceptionsByKey(
  tx: TxContext,
  dedupeKey: string,
  resolution: string,
): Promise<void> {
  const rows = await db(tx)
    .updateTable('payments.exceptions')
    .set({
      status: 'resolved',
      resolution,
      resolved_by: actorKey(tx),
      resolved_at: tx.now,
      version: (eb) => eb('version', '+', 1),
    })
    .where('dedupe_key', '=', dedupeKey)
    .where('status', '=', 'open')
    .returning(['id', 'property_id'])
    .execute();
  for (const r of rows) {
    await tx.audit({
      action: 'payments.exception.resolve',
      target: { type: 'payment_exception', id: r.id },
      propertyId: r.property_id,
      after: { resolution },
    });
    await tx.emit({
      type: PaymentsEvents.exceptionResolved,
      propertyId: r.property_id,
      aggregate: { type: 'payment_exception', id: r.id },
      payload: { exceptionId: r.id, resolution },
    });
  }
}

// ───────────────────────── mappers ─────────────────────────

const iso = (d: Date | null | undefined) => (d ? new Date(d).toISOString() : null);

function decline(v: unknown) {
  if (!v || typeof v !== 'object') return null;
  const code = (v as { code?: string }).code;
  return explainDecline(code);
}

export function effectiveModeFor(
  d: PaymentsDeps,
  ctx: RequestContext,
  a: AccountRow,
): 'live' | 'sandbox' | 'simulate' | 'recorded' {
  if (a.provider === 'external_terminal') return 'recorded';
  try {
    return d.registry.modeFor(ctx, a);
  } catch {
    return a.provider === 'simulator' ? 'simulate' : 'live';
  }
}

export function toAccountView(d: PaymentsDeps, ctx: RequestContext, a: AccountRow): PaymentAccount {
  return {
    id: a.id,
    legalEntityId: a.legal_entity_id,
    provider: a.provider,
    externalAccountId: a.external_account_id,
    displayName: a.display_name,
    capabilities: (a.capabilities as string[]) ?? [],
    onboardingStatus: a.onboarding_status,
    countryCode: a.country_code,
    currencies: a.currencies,
    statementDescriptor: a.statement_descriptor,
    status: a.status,
    statusReason: a.status_reason,
    applicationFeeBps: a.application_fee_bps,
    effectiveMode: effectiveModeFor(d, ctx, a),
    version: a.version,
  };
}

export function toMethodView(m: MethodRow): PaymentMethod {
  return {
    id: m.id,
    accountId: m.account_id,
    propertyId: m.property_id,
    kind: m.kind,
    brand: m.brand,
    last4: m.last4,
    expMonth: m.exp_month,
    expYear: m.exp_year,
    holderName: m.holder_name,
    owner: { type: m.owner_type, id: m.owner_id },
    mitAgreement: m.mit_agreement,
    mandate: (m.mandate ?? {}) as Record<string, unknown>,
    tokenPortability: m.token_portability,
    portabilityNote:
      m.portability_note ??
      (m.token_portability === 'provider_bound'
        ? 'This token only works with the provider account that issued it. It cannot be moved to another provider or system.'
        : m.token_portability === 'vault_portable'
          ? 'Held by a PCI vault/proxy; portability depends on the vault contract (not yet selected).'
          : 'Portability not verified — do not promise the guest that this saved card moves between systems.'),
    status: m.status,
    version: m.version,
  };
}

export function toAuthorizationView(
  a: AuthorizationRow,
  rc: RecordContext,
  capabilities: readonly string[],
): Authorization {
  return {
    id: a.id,
    propertyId: a.property_id,
    accountId: a.account_id,
    methodId: a.method_id,
    ref: { type: a.ref_type, id: a.ref_id },
    amount: { amountMinor: a.amount_minor, currency: a.currency },
    capturedMinor: a.captured_minor,
    capturableMinor: capturableMinor({
      amountMinor: a.amount_minor,
      capturedMinor: a.captured_minor,
      captureReservedMinor: a.capture_reserved_minor,
    }),
    ...authorizationRecord(a, rc, capabilities),
    mode: a.mode,
    providerRef: a.provider_ref,
    externalReference: a.external_reference,
    expiresAt: iso(a.expires_at),
    decline: decline(a.decline),
    presentation: presentAuthorization(a.status, a.mode),
    version: a.version,
  };
}

export function toPaymentView(p: PaymentRow, rc: RecordContext): Payment {
  return {
    id: p.id,
    propertyId: p.property_id,
    legalEntityId: p.legal_entity_id,
    accountId: p.account_id,
    kind: p.kind,
    method: p.method,
    ref: { type: p.ref_type, id: p.ref_id },
    amount: { amountMinor: p.amount_minor, currency: p.currency },
    adjustedMinor: p.adjusted_minor,
    refundedMinor: p.refunded_minor,
    refundableMinor:
      p.status === 'succeeded' || p.status === 'recorded_unverified' || p.status === 'recorded_verified'
        ? refundableMinor({
            amountMinor: p.amount_minor,
            adjustedMinor: p.adjusted_minor,
            refundedMinor: p.refunded_minor,
            refundReservedMinor: p.refund_reserved_minor,
          })
        : 0,
    purpose: p.purpose,
    ...paymentRecord(p, rc),
    mode: p.mode,
    providerVerified: p.status === 'succeeded' && p.mode !== 'recorded',
    providerRef: p.provider_ref,
    externalReference: p.external_reference,
    cardBrand: p.card_brand,
    cardLast4: p.card_last4,
    authorizationId: p.authorization_id,
    paymentRequestId: p.payment_request_id,
    receivedAt: iso(p.received_at),
    decline: decline(p.decline),
    ledger: { status: p.ledger_status, postingId: p.ledger_posting_id },
    presentation: presentPayment(p.status, p.mode, p.method),
    createdAt: iso(p.created_at) as string,
    version: p.version,
  };
}

export function toRefundView(r: RefundRow, rc: RecordContext): Refund {
  return {
    id: r.id,
    paymentId: r.payment_id,
    propertyId: r.property_id,
    amount: { amountMinor: r.amount_minor, currency: r.currency },
    reason: r.reason,
    ...refundRecord(r, rc),
    mode: r.mode,
    providerVerified: r.status === 'succeeded' && r.mode !== 'recorded',
    providerRef: r.provider_ref,
    externalReference: r.external_reference,
    failure: decline(r.failure),
    ledger: { status: r.ledger_status, postingId: r.ledger_posting_id },
    presentation: presentRefund(r.status, r.mode),
    createdAt: iso(r.created_at) as string,
    version: r.version,
  };
}

export function toRequestView(r: RequestRow, rc: RecordContext): PaymentRequest {
  return {
    id: r.id,
    propertyId: r.property_id,
    legalEntityId: r.legal_entity_id,
    accountId: r.account_id,
    payer: (r.payer ?? {}) as Record<string, unknown>,
    amount: { amountMinor: r.amount_minor, currency: r.currency },
    paidMinor: r.paid_minor,
    purpose: r.purpose,
    description: r.description,
    ref: { type: r.ref_type, id: r.ref_id },
    expiresAt: iso(r.expires_at) as string,
    ...requestRecord(r, rc),
    mode: r.mode,
    link: { status: r.link_status, url: r.link_url },
    presentation: presentRequest(r.status, r.paid_minor),
    version: r.version,
  };
}

export function toExceptionView(e: ExceptionRow, authz: Authorizer): PaymentException {
  return {
    id: e.id,
    propertyId: e.property_id,
    kind: e.kind,
    severity: e.severity,
    problem: e.problem,
    businessImpact: e.business_impact,
    nextStep: e.next_step,
    ownerRole: e.owner_role,
    responsibleParty: e.responsible_party,
    ref: e.ref_type && e.ref_id ? { type: e.ref_type, id: e.ref_id } : null,
    ...exceptionRecord(e, authz),
    resolution: e.resolution,
    createdAt: iso(e.created_at) as string,
    version: e.version,
  };
}
