/** Payment accounts (per legal entity = merchant of record), provider health, payment methods (tokens only). */
import { explainVersionMiss, type TxContext, withSavepoint } from '@portico/db';
import {
  BusinessRuleError,
  ConflictError,
  ForbiddenError,
  formatMoney,
  money,
  NotFoundError,
  newId,
  requirePermission,
  ValidationError,
} from '@portico/kernel';
import type { z } from 'zod';
import type {
  AccountHealth,
  accountInput,
  accountUpdate,
  PaymentAccount,
  PaymentMethod,
  paymentMethodInput,
  SimulatorControlsInput,
} from '../contracts';
import { effectiveState, OUTAGE_ACTIONS } from '../domain/circuit-breaker';
import { containsPossiblePan } from '../domain/pci';
import { PaymentsEvents } from '../events';
import type { Capability } from '../providers/provider';
import { isSimulatorTestToken } from '../providers/simulator';
import { consentProblem } from './consent';
import { loadBreaker } from './operations';
import {
  assertPaymentsWritable,
  bookingConsentEvidence,
  db,
  loadAccount,
  loadProperty,
  type PaymentsDeps,
  toAccountView,
  toMethodView,
  uniqueViolation,
} from './shared';

const PROVIDER_CAPABILITIES: Record<string, readonly (Capability | 'recordOnly')[]> = {
  simulator: [
    'hostedCardEntry',
    'authorize',
    'incrementalAuthorize',
    'capture',
    'partialCapture',
    'multiCapture',
    'void',
    'charge',
    'refund',
    'partialRefund',
    'paymentLinks',
    'webhooks',
    'payoutReports',
    'disputes',
    'lookup',
  ],
  stripe_connect: [
    'hostedCardEntry',
    'authorize',
    'incrementalAuthorize',
    'capture',
    'partialCapture',
    'void',
    'charge',
    'refund',
    'partialRefund',
    'paymentLinks',
    'webhooks',
    'disputes',
    'lookup',
  ],
  external_terminal: ['recordOnly'],
};

export async function createAccount(
  d: PaymentsDeps,
  tx: TxContext,
  input: z.infer<typeof accountInput>,
): Promise<PaymentAccount> {
  requirePermission(tx, 'payments.account.manage');
  const le = await d.platform.getLegalEntity(tx, input.legalEntityId);
  if (input.provider === 'simulator' && tx.environment === 'live') {
    throw new BusinessRuleError(
      'simulator_in_live',
      'Simulated payment accounts are only available in demo, trial, training and sandbox organizations. In live, connect the hotel’s real provider account or add its own terminal as a recorded account.',
    );
  }
  if (input.provider === 'stripe_connect' && input.externalAccountId) {
    // P0-2: a connected account id proves nothing about ownership. It is linked only by Portico-initiated
    // onboarding (Stripe Account Links / OAuth — R1) or by a Monoclay operator who verified it.
    throw new ValidationError(
      'stripe_account_link_required',
      'A Stripe connected account cannot be claimed by typing its id. Create the account here and complete Stripe onboarding (or ask Monoclay support to link your existing account after verifying ownership).',
    );
  }
  const id = newId(tx.now.getTime());
  const externalAccountId =
    input.provider === 'simulator'
      ? `sim_acct_${id.replace(/-/g, '')}`
      : input.provider === 'external_terminal'
        ? (input.externalAccountId ?? null)
        : null;
  try {
    const row = await db(tx)
      .insertInto('payments.accounts')
      .values({
        id,
        tenant_id: tx.tenantId,
        legal_entity_id: le.id,
        provider: input.provider,
        external_account_id: externalAccountId,
        display_name: input.displayName,
        capabilities: JSON.stringify(PROVIDER_CAPABILITIES[input.provider]),
        onboarding_status:
          input.provider === 'stripe_connect'
            ? 'not_started'
            : input.provider === 'external_terminal'
              ? 'not_applicable'
              : 'complete',
        country_code: input.countryCode ?? le.countryCode,
        currencies: input.currencies,
        statement_descriptor: input.statementDescriptor ?? null,
        // Stripe accounts stay pending until the PROVIDER reports charges enabled (account.updated); simulator and
        // own-terminal accounts are usable immediately. Platform fees are operator-only and off until Q3.
        status: input.provider === 'stripe_connect' ? 'pending' : 'active',
        status_reason:
          input.provider === 'stripe_connect'
            ? 'Waiting for Stripe onboarding of the hotel’s account.'
            : null,
        application_fee_bps: null,
        simulator_controls: JSON.stringify({}),
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    await tx.audit({
      action: 'payments.account.create',
      target: { type: 'payment_account', id },
      after: input,
    });
    await tx.emit({
      type: PaymentsEvents.accountCreated,
      aggregate: { type: 'payment_account', id },
      payload: { accountId: id, legalEntityId: le.id, provider: input.provider },
    });
    return toAccountView(d, tx, row);
  } catch (err) {
    if (uniqueViolation(err)) {
      throw new ConflictError('payment_account_exists', 'This provider account is already connected.');
    }
    throw err;
  }
}

/**
 * Monoclay-operator only (not exposed on tenant routes): link a provider account whose ownership by this
 * organization's legal entity was verified (Stripe onboarding / support check). The id is globally unique — an
 * account already linked to any organization is refused, so webhook routing is never ambiguous (P0-2).
 */
export async function operatorLinkProviderAccount(
  tx: TxContext,
  input: { accountId: string; externalAccountId: string; verifiedBy: string },
): Promise<void> {
  if (tx.actor.kind !== 'system' || !tx.actor.process.startsWith('operator:')) {
    throw new ForbiddenError('payments.operator.linkProviderAccount');
  }
  if (!/^acct_[A-Za-z0-9]+$/.test(input.externalAccountId)) {
    throw new ValidationError(
      'stripe_account_id_invalid',
      'A Stripe connected account id looks like acct_….',
    );
  }
  const a = await loadAccount(tx, input.accountId, true);
  if (a.provider !== 'stripe_connect') {
    throw new BusinessRuleError('not_a_stripe_account', 'Only Stripe Connect accounts are linked this way.');
  }
  try {
    await withSavepoint(tx, 'payments_link', () =>
      db(tx)
        .updateTable('payments.accounts')
        .set({
          external_account_id: input.externalAccountId,
          linked_by: input.verifiedBy,
          onboarding_status: 'in_progress',
          version: a.version + 1,
        })
        .where('id', '=', a.id)
        .execute(),
    );
  } catch (err) {
    if (uniqueViolation(err)) {
      throw new ConflictError(
        'provider_account_claimed',
        'This provider account is already linked to an organization. Ownership must be resolved by Monoclay support before it can be linked again.',
      );
    }
    throw err;
  }
  await tx.audit({
    action: 'payments.account.linkProvider',
    target: { type: 'payment_account', id: a.id },
    after: { externalAccountId: input.externalAccountId, verifiedBy: input.verifiedBy },
  });
}

/** Operator only: the platform application fee (Route A) — disabled until owner question Q3 is answered. */
export async function operatorSetApplicationFee(
  tx: TxContext,
  input: { accountId: string; applicationFeeBps: number | null; approvedBy: string },
): Promise<void> {
  if (tx.actor.kind !== 'system' || !tx.actor.process.startsWith('operator:')) {
    throw new ForbiddenError('payments.operator.applicationFee');
  }
  const a = await loadAccount(tx, input.accountId, true);
  await db(tx)
    .updateTable('payments.accounts')
    .set({ application_fee_bps: input.applicationFeeBps, version: a.version + 1 })
    .where('id', '=', a.id)
    .execute();
  await tx.audit({
    action: 'payments.account.applicationFee',
    target: { type: 'payment_account', id: a.id },
    before: { applicationFeeBps: a.application_fee_bps },
    after: { applicationFeeBps: input.applicationFeeBps, approvedBy: input.approvedBy },
  });
}

export async function listAccounts(
  d: PaymentsDeps,
  tx: TxContext,
  legalEntityId?: string,
): Promise<PaymentAccount[]> {
  requirePermission(tx, 'payments.account.read');
  let q = db(tx).selectFrom('payments.accounts').selectAll().orderBy('display_name');
  if (legalEntityId) q = q.where('legal_entity_id', '=', legalEntityId);
  return (await q.execute()).map((a) => toAccountView(d, tx, a));
}

export async function getAccount(d: PaymentsDeps, tx: TxContext, id: string): Promise<PaymentAccount> {
  requirePermission(tx, 'payments.account.read');
  return toAccountView(d, tx, await loadAccount(tx, id));
}

export async function updateAccount(
  d: PaymentsDeps,
  tx: TxContext,
  id: string,
  expectedVersion: number,
  patch: z.infer<typeof accountUpdate>,
): Promise<PaymentAccount> {
  requirePermission(tx, 'payments.account.manage');
  const before = await loadAccount(tx, id);
  if (before.provider === 'stripe_connect' && patch.status !== undefined && patch.status !== 'disabled') {
    // P0-2: activation/restriction of a Stripe account comes only from the provider (account.updated).
    throw new BusinessRuleError(
      'provider_controlled_status',
      'The status of a Stripe account is set by Stripe (onboarding and verification). You can only disable it here.',
    );
  }
  const row = await db(tx)
    .updateTable('payments.accounts')
    .set({
      ...(patch.displayName !== undefined ? { display_name: patch.displayName } : {}),
      ...(patch.status !== undefined ? { status: patch.status } : {}),
      ...(patch.statusReason !== undefined ? { status_reason: patch.statusReason } : {}),
      ...(patch.currencies !== undefined ? { currencies: patch.currencies } : {}),
      ...(patch.statementDescriptor !== undefined ? { statement_descriptor: patch.statementDescriptor } : {}),
      version: before.version + 1,
    })
    .where('id', '=', id)
    .where('version', '=', expectedVersion)
    .returningAll()
    .executeTakeFirst();
  if (!row) return explainVersionMiss('payment_account', id, expectedVersion, async () => before.version);
  await tx.audit({
    action: 'payments.account.update',
    target: { type: 'payment_account', id },
    before: toAccountView(d, tx, before),
    after: toAccountView(d, tx, row),
  });
  if (patch.status && patch.status !== before.status) {
    await tx.emit({
      type: PaymentsEvents.accountStatusChanged,
      aggregate: { type: 'payment_account', id },
      payload: { accountId: id, from: before.status, to: patch.status },
    });
  }
  return toAccountView(d, tx, row);
}

export async function setSimulatorControls(
  d: PaymentsDeps,
  tx: TxContext,
  id: string,
  controls: SimulatorControlsInput,
): Promise<PaymentAccount> {
  requirePermission(tx, 'payments.account.manage');
  const a = await loadAccount(tx, id, true);
  if (effectiveMode(d, tx, a.provider) !== 'simulate') {
    throw new BusinessRuleError(
      'not_simulated',
      'Simulator controls only apply to accounts that run on the simulator in this environment.',
    );
  }
  const row = await db(tx)
    .updateTable('payments.accounts')
    .set({ simulator_controls: JSON.stringify(controls), version: a.version + 1 })
    .where('id', '=', id)
    .returningAll()
    .executeTakeFirstOrThrow();
  await tx.audit({
    action: 'payments.account.simulatorControls',
    target: { type: 'payment_account', id },
    before: a.simulator_controls,
    after: controls,
  });
  return toAccountView(d, tx, row);
}

function effectiveMode(
  d: PaymentsDeps,
  tx: TxContext,
  provider: 'simulator' | 'stripe_connect' | 'external_terminal',
) {
  if (provider === 'external_terminal') return 'recorded';
  try {
    return d.registry.modeFor(tx, { provider });
  } catch {
    return 'blocked';
  }
}

export async function accountHealth(_d: PaymentsDeps, tx: TxContext, id: string): Promise<AccountHealth> {
  const a = await loadAccount(tx, id);
  const s = await loadBreaker(tx, a.id);
  const state = effectiveState(s, tx.now);
  const restricted = a.status === 'restricted' || a.status === 'disabled' || a.status === 'pending';
  const recordedOnly = a.provider === 'external_terminal';
  const available = !recordedOnly && state === 'closed' && !restricted;
  let message: string;
  if (recordedOnly) {
    message =
      "Payments on this account are taken on the hotel's own terminal or gateway and recorded in Portico; they stay unverified until matched to the settlement statement.";
  } else if (restricted) {
    message = `Card payments through "${a.display_name}" are unavailable: the account is ${a.status}. Nothing will be charged through it.`;
  } else if (state === 'open') {
    message = `Card payments unavailable — the payment provider is not responding (since ${s.openedAt?.toISOString() ?? 'recently'}). Nothing is being charged. Accept cash, send a payment link to be paid later, or record a manual authorization taken on your own terminal.`;
  } else if (state === 'half_open') {
    message =
      'Checking whether the payment provider is back. The next card payment is a test of the connection.';
  } else {
    message = 'Card payments available.';
  }
  return {
    accountId: a.id,
    displayName: a.display_name,
    provider: a.provider,
    state,
    cardPaymentsAvailable: available,
    consecutiveFailures: s.consecutiveFailures,
    lastSuccessAt: s.lastSuccessAt?.toISOString() ?? null,
    lastFailureAt: s.lastFailureAt?.toISOString() ?? null,
    lastError: s.lastError,
    retryAfter: state === 'open' ? (s.probeAfter?.toISOString() ?? null) : null,
    message,
    actions: available || recordedOnly ? [] : OUTAGE_ACTIONS.map((x) => ({ ...x })),
  };
}

// ───────────────────────── payment methods ─────────────────────────

export async function createMethod(
  d: PaymentsDeps,
  tx: TxContext,
  input: z.input<typeof paymentMethodInput>,
): Promise<PaymentMethod> {
  requirePermission(tx, 'payments.method.manage', { propertyId: input.propertyId });
  await assertPaymentsWritable(d, tx, input.propertyId);
  for (const [field, value] of [
    ['providerToken', input.providerToken],
    ['providerCustomerRef', input.providerCustomerRef ?? ''],
    ['holderName', input.holderName ?? ''],
  ] as const) {
    if (containsPossiblePan(value)) {
      throw new ValidationError(
        'card_number_refused',
        `${field} looks like a card number. Portico never accepts card numbers — use the provider’s hosted card entry and save only its token.`,
        { field },
      );
    }
  }
  const property = await loadProperty(d, tx, input.propertyId);
  const account = await loadAccount(tx, input.accountId);
  if (account.legal_entity_id !== property.legalEntityId) {
    throw new BusinessRuleError(
      'wrong_merchant_of_record',
      'This payment account belongs to a different legal entity than the one operating this property.',
    );
  }
  if (account.provider === 'external_terminal') {
    throw new BusinessRuleError(
      'recorded_only_account',
      "Cards are not saved for the hotel's own terminal; payments taken there are recorded with their approval code.",
    );
  }
  const simulated = effectiveMode(d, tx, account.provider) === 'simulate';
  if (simulated && !isSimulatorTestToken(input.providerToken)) {
    throw new ValidationError(
      'simulator_test_token_required',
      'In this environment payments are simulated: use one of the simulator test tokens (see GET /v1/payments/simulator/test-tokens). Real card tokens are never used here.',
    );
  }
  if (input.mandate && !input.mandate.scope) {
    throw new ValidationError(
      'mandate_scope_required',
      'Record what the cardholder agreed to: the hotel company, the purposes, and optionally the amount limit and the bookings it covers. An agreement without its scope is not used for any charge.',
    );
  }
  if (input.mitAgreement && (!input.mandate?.termsVersion || !input.mandate?.acceptedAt)) {
    throw new ValidationError(
      'mandate_required',
      'A card saved for later charges needs the guest’s recorded agreement: the terms version and when they accepted.',
    );
  }
  const scope = input.mandate?.scope;
  if (scope && scope.legalEntityId !== property.legalEntityId) {
    throw new ValidationError(
      'mandate_scope_other_entity',
      'The cardholder’s agreement must name the hotel company that operates this property (its legal entity).',
    );
  }
  // ADR-0015 Amendment 1 (a): a guest saving their own card (self-service) saves it for themselves or their booking.
  if (tx.actor.kind === 'guest') {
    const own =
      (input.owner.type === 'guest_profile' && input.owner.id === tx.actor.guestProfileId) ||
      (input.owner.type === 'booking' && input.owner.id === tx.actor.bookingId);
    if (!own) {
      throw new ValidationError(
        'card_owner_not_self',
        'A guest can save a card only for themselves or for their own booking.',
      );
    }
  }
  // Fix sweep SW-PAY-4: how the card was entered is a server fact. Only the guest acting for themselves is a
  // guest-present (hosted) entry; anything staff save is a staff entry, whatever the client declares.
  const entryChannel =
    tx.actor.kind === 'guest' ? 'hosted_entry' : input.entryChannel === 'import' ? 'import' : 'staff_entry';
  // Review R2-P2-1: a saved token is ONE cardholder's card at ONE property. The simulator's public test tokens are
  // shared by every tester, so each save is stored under its own token (a real provider issues a new token per card
  // entry); a real token already saved for another owner or property is refused, never handed over.
  const storedToken = simulated
    ? `${input.providerToken}#${input.propertyId}:${input.owner.type}:${input.owner.id}`
    : input.providerToken;
  // ADR-0015 Amendment 4 rule 3: an agreement staff record (terminal, phone, paper form) states the most the hotel may
  // take or hold on the card. Only the cardholder, saving their own card, may choose no limit, and only explicitly.
  const recordedBy = tx.actor.kind === 'guest' ? 'cardholder' : 'staff';
  if (input.mandate && scope && !scope.maxAmount) {
    if (recordedBy === 'staff' || !scope.noLimitChosenByCardholder) {
      throw new ValidationError(
        'mandate_limit_required',
        recordedBy === 'staff'
          ? 'An agreement recorded by staff must state the most the cardholder agreed the hotel may take or hold on the card (maxAmount).'
          : 'State the most the hotel may take or hold on your card, or choose explicitly to set no limit.',
      );
    }
  }
  if (recordedBy === 'staff' && scope?.noLimitChosenByCardholder) {
    throw new ValidationError(
      'mandate_no_limit_cardholder_only',
      'Only the cardholder, saving their own card, can choose no amount limit. Record the limit the cardholder agreed to.',
    );
  }
  // ADR-0015 Amendments 3 and 4: the evidence of each booking the agreement names (when — the server's clock —, who
  // recorded it — the server's channel —, the channel the client declared, and the booking's stays then) and of a card
  // its cardholder entered for their booking is built here, never taken from the client.
  const serverChannel = recordedBy === 'cardholder' ? 'guest_self_service' : 'staff_recorded';
  const storedMandate: Record<string, unknown> = input.mandate ? { ...input.mandate, recordedBy } : {};
  if (input.mandate && scope?.noLimitChosenByCardholder) {
    storedMandate.scope = { ...scope, noLimitChosenAt: tx.now.toISOString() };
  }
  if (input.mandate && scope?.bookingIds?.length) {
    const bookingEvidence: Record<string, { at: string; channel: string; stayIds?: string[] }> = {};
    for (const bookingId of new Set(scope.bookingIds)) {
      const booking = await d.references.describeReference(tx, { type: 'booking', id: bookingId });
      const at = booking ? await loadProperty(d, tx, booking.propertyId) : null;
      if (
        !booking ||
        !at ||
        at.legalEntityId !== scope.legalEntityId ||
        (scope.propertyIds !== undefined && !scope.propertyIds.includes(at.id))
      ) {
        throw new ValidationError(
          'mandate_booking_unknown',
          'A booking the agreement names is not a booking of this hotel company (or of the properties it covers). Name the cardholder’s bookings here, or leave the bookings out and let the guest confirm the card for their booking.',
        );
      }
      bookingEvidence[bookingId] = await bookingConsentEvidence(
        d,
        tx,
        bookingId,
        serverChannel,
        input.mandate.channel,
      );
    }
    storedMandate.scope = {
      ...(storedMandate.scope as object | undefined),
      ...scope,
      bookingIds: Object.keys(bookingEvidence),
      bookingEvidence,
    };
  }
  for (const folioId of scope?.folioIds ?? []) {
    const f = await d.ledger.describeTarget(tx, { type: 'folio', id: folioId });
    if (
      !f ||
      f.legalEntityId !== scope?.legalEntityId ||
      (scope.propertyIds !== undefined && !scope.propertyIds.includes(f.propertyId))
    ) {
      throw new ValidationError(
        'mandate_folio_unknown',
        'A folio the agreement names is not a folio of this hotel company (or of the properties it covers). Name the cardholder’s own folio here.',
      );
    }
  }
  if (tx.actor.kind === 'guest' && input.owner.type === 'booking') {
    storedMandate.supplied = await bookingConsentEvidence(d, tx, input.owner.id, 'hosted_entry').then(
      (e) => ({
        bookingId: input.owner.id,
        ...e,
      }),
    );
  }
  const id = newId(tx.now.getTime());
  // P2-2: saving the same token again for the same owner returns the existing method (no aborted transaction).
  const row = await db(tx)
    .insertInto('payments.payment_methods')
    .values({
      id,
      tenant_id: tx.tenantId,
      account_id: account.id,
      property_id: input.propertyId,
      kind: input.kind,
      provider_token: storedToken,
      provider_customer_ref: input.providerCustomerRef ?? null,
      brand: input.brand ?? null,
      last4: input.last4 ?? null,
      exp_month: input.expMonth ?? null,
      exp_year: input.expYear ?? null,
      holder_name: input.holderName ?? null,
      owner_type: input.owner.type,
      owner_id: input.owner.id,
      cardholder_ref: `${input.owner.type}:${input.owner.id}`,
      mit_agreement: input.mitAgreement ?? false,
      mandate: JSON.stringify(storedMandate),
      entry_channel: entryChannel,
      declared_entry_channel: input.entryChannel ?? null,
      token_portability:
        input.tokenPortability ?? (input.kind === 'virtual_card' ? 'vault_portable' : 'provider_bound'),
      portability_note: input.portabilityNote ?? null,
      status: 'active',
      created_at: tx.now,
    })
    .onConflict((oc) => oc.columns(['tenant_id', 'account_id', 'provider_token']).doNothing())
    .returningAll()
    .executeTakeFirst();
  if (!row) {
    const existing = await db(tx)
      .selectFrom('payments.payment_methods')
      .selectAll()
      .where('account_id', '=', account.id)
      .where('provider_token', '=', storedToken)
      .executeTakeFirstOrThrow();
    if (
      existing.owner_type !== input.owner.type ||
      existing.owner_id !== input.owner.id ||
      existing.property_id !== input.propertyId
    ) {
      throw new ConflictError(
        'payment_method_token_in_use',
        'This card token is already saved for another cardholder or property. A saved card belongs to one cardholder: ask the guest to enter the card again (a new entry gives a new token), or use the card they already saved here.',
      );
    }
    return toMethodView(existing);
  }
  // Audit without the token itself (tokens are not card data, but they are credentials to charge).
  await tx.audit({
    action: 'payments.method.create',
    target: { type: 'payment_method', id },
    propertyId: input.propertyId,
    after: { ...toMethodView(row) },
  });
  return toMethodView(row);
}

export async function getMethod(tx: TxContext, id: string): Promise<PaymentMethod> {
  const m = await db(tx)
    .selectFrom('payments.payment_methods')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst();
  if (!m) throw new NotFoundError('payment_method', id);
  if (
    !tx.authz.can('payments.payment.read', { propertyId: m.property_id }) &&
    !tx.authz.can('payments.method.manage', { propertyId: m.property_id })
  ) {
    throw new NotFoundError('payment_method', id);
  }
  return toMethodView(m);
}

export async function listMethods(
  tx: TxContext,
  owner: { type: string; id: string },
): Promise<PaymentMethod[]> {
  const rows = await db(tx)
    .selectFrom('payments.payment_methods')
    .selectAll()
    .where('owner_type', '=', owner.type as 'guest_profile')
    .where('owner_id', '=', owner.id)
    .orderBy('created_at', 'desc')
    .execute();
  return rows
    .filter(
      (m) =>
        tx.authz.can('payments.payment.read', { propertyId: m.property_id }) ||
        tx.authz.can('payments.method.manage', { propertyId: m.property_id }),
    )
    .map(toMethodView);
}

export async function detachMethod(
  d: PaymentsDeps,
  tx: TxContext,
  id: string,
  expectedVersion: number,
): Promise<PaymentMethod> {
  const m = await db(tx)
    .selectFrom('payments.payment_methods')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst();
  if (!m) throw new NotFoundError('payment_method', id);
  requirePermission(tx, 'payments.method.manage', { propertyId: m.property_id });
  await assertPaymentsWritable(d, tx, m.property_id);
  const row = await db(tx)
    .updateTable('payments.payment_methods')
    .set({ status: 'detached', version: m.version + 1 })
    .where('id', '=', id)
    .where('version', '=', expectedVersion)
    .returningAll()
    .executeTakeFirst();
  if (!row) return explainVersionMiss('payment_method', id, expectedVersion, async () => m.version);
  await tx.audit({
    action: 'payments.method.detach',
    target: { type: 'payment_method', id },
    propertyId: m.property_id,
    before: { status: m.status },
    after: { status: 'detached' },
  });
  return toMethodView(row);
}

// ───────────────────────── guarantee cards (ADR-0015 Amendment 1) ─────────────────────────

export interface GuaranteeCardAssessment {
  /** The card exists, is active, was saved at this property and belongs to this property's hotel company. */
  usable: boolean;
  /**
   * Why staff WITHOUT `payments.payment.collect` may hold this card for this booking, or null:
   *  - `cardholder_supplied`: the cardholder entered it for this booking (hosted entry / self-service);
   *  - `channel_card`: the virtual card the booking's own channel connection issued for it;
   *  - `mandate`: the cardholder's recorded agreement names this booking, for guarantees, up to its amount.
   */
  basis: 'cardholder_supplied' | 'channel_card' | 'mandate' | null;
  card: { brand: string | null; last4: string | null } | null;
  /** Who the card belongs to (the calling module checks a payment user's choice against the booking's people). */
  owner: { type: string; id: string } | null;
  /**
   * ADR-0015 Amendment 2: whether a guarantee hold on this booking (for `amount`, when given) lies inside the
   * cardholder's consent — required for every hotel-initiated use, also when a payment user chooses the card.
   */
  withinConsent: boolean;
  consentReason: string | null;
  /** Plain-language explanation (shown when the card cannot be used). */
  reason: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * ADR-0015 Amendment 1: is this saved card the booking's AGREED guarantee? Only if its cardholder supplied it for
 * THIS booking (hosted entry, payment link, terminal, self-service; or the booking's own channel virtual card), or a
 * recorded mandate covers it (names the booking, for guarantees, at this hotel company, within its amount). Staff
 * linking a person to a booking (booker, occupant, payer, company, agency) never makes that person's card usable.
 * Any other card is an explicit payments decision (`payments.payment.collect`), which the calling module checks.
 */
export async function assessGuaranteeCard(
  d: PaymentsDeps,
  tx: TxContext,
  input: {
    propertyId: string;
    methodId: string;
    bookingId: string;
    amount?: { amountMinor: number; currency: string };
  },
): Promise<GuaranteeCardAssessment> {
  const notHere: GuaranteeCardAssessment = {
    usable: false,
    basis: null,
    card: null,
    owner: null,
    withinConsent: false,
    consentReason: null,
    reason:
      "This payment method is not a saved card of this property (unknown, removed, or saved at another property or hotel company). Save the guest's card here first.",
  };
  if (!UUID_RE.test(input.methodId)) return notHere;
  const m = await db(tx)
    .selectFrom('payments.payment_methods')
    .selectAll()
    .where('id', '=', input.methodId)
    .executeTakeFirst();
  if (m?.status !== 'active' || m.property_id !== input.propertyId) return notHere;
  const property = await loadProperty(d, tx, input.propertyId);
  const account = await loadAccount(tx, m.account_id);
  if (account.legal_entity_id !== property.legalEntityId) return notHere;
  const card = { brand: m.brand, last4: m.last4 };
  const owner = { type: m.owner_type, id: m.owner_id };
  const problem = await consentProblem(
    d,
    tx,
    m,
    property,
    'merchant',
    {
      kind: 'hold',
      purpose: 'guarantee',
      ...(input.amount ? { amount: input.amount } : {}),
      ref: { type: 'booking', id: input.bookingId },
    },
    { lock: false },
  );
  const consent = { withinConsent: problem === null, consentReason: problem?.message ?? null };
  const mandate = (m.mandate ?? {}) as {
    kind?: string;
    termsVersion?: string;
    acceptedAt?: string;
    channelConnectionId?: string;
    scope?: {
      legalEntityId?: string;
      propertyIds?: string[];
      purposes?: string[];
      maxAmount?: { amountMinor: number; currency: string };
      bookingIds?: string[];
    };
  };
  const scope = mandate.scope;
  const withinAmount = () =>
    !input.amount ||
    !scope?.maxAmount ||
    (scope.maxAmount.currency === input.amount.currency &&
      input.amount.amountMinor <= scope.maxAmount.amountMinor);
  const tooMuch = (): GuaranteeCardAssessment => ({
    usable: true,
    basis: null,
    card,
    owner,
    ...consent,
    reason: `The cardholder agreed to holds of at most ${formatMoney(money(scope?.maxAmount?.amountMinor ?? 0, scope?.maxAmount?.currency ?? 'USD'))} on this card. Hold that amount, or ask a colleague with payment rights.`,
  });
  const forThisBooking = m.owner_type === 'booking' && m.owner_id === input.bookingId;
  if (forThisBooking && m.entry_channel === 'hosted_entry') {
    return {
      usable: true,
      basis: 'cardholder_supplied',
      card,
      owner,
      ...consent,
      reason: 'The cardholder entered this card for this booking.',
    };
  }
  if (forThisBooking && m.kind === 'virtual_card' && mandate.kind === 'ota_virtual_card') {
    const b = await d.references.describeReference(tx, { type: 'booking', id: input.bookingId });
    if (
      b?.source === 'channel' &&
      b.channelConnectionId &&
      b.channelConnectionId === mandate.channelConnectionId
    ) {
      if (!withinAmount()) return tooMuch();
      return {
        usable: true,
        basis: 'channel_card',
        card,
        owner,
        ...consent,
        reason: "The booking's channel issued this virtual card for it.",
      };
    }
  }
  const named = forThisBooking || (scope?.bookingIds ?? []).includes(input.bookingId);
  if (
    m.mit_agreement &&
    mandate.termsVersion &&
    mandate.acceptedAt &&
    scope &&
    named &&
    scope.legalEntityId === property.legalEntityId &&
    (scope.propertyIds === undefined || scope.propertyIds.includes(property.id)) &&
    (scope.purposes ?? []).includes('guarantee') &&
    // Amendment 4: "named" is not enough — the booking as it is now (every stay) must be inside the consent.
    consent.withinConsent
  ) {
    if (!withinAmount()) return tooMuch();
    return {
      usable: true,
      basis: 'mandate',
      card,
      owner,
      ...consent,
      reason: "The cardholder's recorded agreement names this booking.",
    };
  }
  return {
    usable: true,
    basis: null,
    card,
    owner,
    ...consent,
    reason:
      "This card was not supplied by its cardholder for this booking, and no recorded agreement of the cardholder names this booking. Linking a person to a booking does not let staff use that person's saved card: send the guest a card link for this booking, or ask a colleague with payment rights to choose the card.",
  };
}

// ───────────────────────── guest profile merges (review R2-P2-1) ─────────────────────────

/**
 * guests.profile.merged: cards follow the surviving profile (their cardholder is the same person), remembering the
 * previous owner so an unmerge gives them back. Idempotent (a second delivery finds nothing to move).
 */
export async function repointMethodsOnMerge(
  tx: TxContext,
  p: { survivorId?: string; mergedId?: string },
): Promise<number> {
  if (!p.survivorId || !p.mergedId) return 0;
  const moved = await db(tx)
    .updateTable('payments.payment_methods')
    .set((eb) => ({
      owner_id: p.survivorId as string,
      merged_from_owner_id: p.mergedId as string,
      version: eb('version', '+', 1),
    }))
    .where('owner_type', '=', 'guest_profile')
    .where('owner_id', '=', p.mergedId)
    .returning('id')
    .execute();
  for (const m of moved) {
    await tx.audit({
      action: 'payments.method.ownerMerged',
      target: { type: 'payment_method', id: m.id },
      before: { owner: { type: 'guest_profile', id: p.mergedId } },
      after: { owner: { type: 'guest_profile', id: p.survivorId } },
    });
  }
  return moved.length;
}

/** guests.profile.unmerged: cards that came from the restored profile go back to it. */
export async function restoreMethodsOnUnmerge(
  tx: TxContext,
  p: { survivorId?: string; restoredId?: string },
): Promise<number> {
  if (!p.survivorId || !p.restoredId) return 0;
  const moved = await db(tx)
    .updateTable('payments.payment_methods')
    .set((eb) => ({
      owner_id: p.restoredId as string,
      merged_from_owner_id: null,
      version: eb('version', '+', 1),
    }))
    .where('owner_type', '=', 'guest_profile')
    .where('owner_id', '=', p.survivorId)
    .where('merged_from_owner_id', '=', p.restoredId)
    .returning('id')
    .execute();
  for (const m of moved) {
    await tx.audit({
      action: 'payments.method.ownerUnmerged',
      target: { type: 'payment_method', id: m.id },
      before: { owner: { type: 'guest_profile', id: p.survivorId } },
      after: { owner: { type: 'guest_profile', id: p.restoredId } },
    });
  }
  return moved.length;
}

// ───────────────────────── cardholder confirms a card for a booking (ADR-0015 Amendment 3) ─────────────────────────

/**
 * Re-review #4 R4-P1-1: an agreement covers only the bookings it names, as consented. More are added ONLY by the
 * cardholder — here through the guest's own self-service (a guest actor holding the card); a payment link or the
 * terminal are the other channels (they take a new card entry). Staff cannot call this: no relationship staff create
 * extends a cardholder's consent. Evidence: who (the guest), when, and the channel.
 */
export async function confirmCardForBooking(
  d: PaymentsDeps,
  tx: TxContext,
  input: { methodId: string; bookingId: string },
): Promise<PaymentMethod> {
  const actor = tx.actor.kind === 'guest' ? tx.actor : null;
  const m = await db(tx)
    .selectFrom('payments.payment_methods')
    .selectAll()
    .where('id', '=', input.methodId)
    .forUpdate()
    .executeTakeFirst();
  // R5-P3-2: the cardholder the card was saved for — never the owner a profile merge rewrote.
  const own =
    m &&
    actor &&
    ((actor.guestProfileId !== undefined && m.cardholder_ref === `guest_profile:${actor.guestProfileId}`) ||
      (actor.bookingId !== undefined && m.cardholder_ref === `booking:${actor.bookingId}`));
  if (!m || !own) {
    throw new ForbiddenError('payments.card.confirmForBooking', {});
  }
  const mandate = (m.mandate ?? {}) as {
    termsVersion?: string;
    acceptedAt?: string;
    scope?: {
      bookingIds?: string[];
      bookingEvidence?: Record<string, { at: string; channel: string; stayIds?: string[] }>;
    };
  };
  if (!m.mit_agreement || !mandate.scope) {
    throw new ValidationError(
      'mandate_required',
      'This card has no recorded agreement to add a booking to. Save it again with the agreement (terms, scope).',
    );
  }
  const booking = await d.references.describeReference(tx, { type: 'booking', id: input.bookingId });
  if (!booking || booking.propertyId !== m.property_id) {
    throw new NotFoundError('booking', input.bookingId);
  }
  const bookingIds = [...new Set([...(mandate.scope.bookingIds ?? []), input.bookingId])];
  if (bookingIds.length > 20) {
    throw new ValidationError('mandate_too_many_bookings', 'An agreement names at most 20 bookings.');
  }
  // The booking's stays as they are now: a stay added after this consent is not covered by it.
  const evidence = {
    ...(mandate.scope.bookingEvidence ?? {}),
    [input.bookingId]: await bookingConsentEvidence(d, tx, input.bookingId, 'guest_self_service'),
  };
  const row = await db(tx)
    .updateTable('payments.payment_methods')
    .set({
      mandate: JSON.stringify({
        ...mandate,
        scope: { ...mandate.scope, bookingIds, bookingEvidence: evidence },
      }),
      version: m.version + 1,
    })
    .where('id', '=', m.id)
    .returningAll()
    .executeTakeFirstOrThrow();
  await tx.audit({
    action: 'payments.method.bookingConsented',
    target: { type: 'payment_method', id: m.id },
    propertyId: m.property_id,
    after: { bookingId: input.bookingId, channel: 'guest_self_service' },
  });
  return toMethodView(row);
}
