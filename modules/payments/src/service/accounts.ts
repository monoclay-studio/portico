/** Payment accounts (per legal entity = merchant of record), provider health, payment methods (tokens only). */
import { explainVersionMiss, type TxContext } from '@portico/db';
import {
  BusinessRuleError,
  ConflictError,
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
import { loadBreaker } from './operations';
import {
  assertPaymentsWritable,
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
  if (input.provider === 'stripe_connect' && !/^acct_[A-Za-z0-9]+$/.test(input.externalAccountId ?? '')) {
    throw new ValidationError(
      'stripe_account_id_required',
      'A Stripe Connect account needs the connected account id (acct_…) of the hotel’s legal entity.',
    );
  }
  const id = newId(tx.now.getTime());
  const externalAccountId =
    input.provider === 'simulator' ? `sim_acct_${id.replace(/-/g, '')}` : (input.externalAccountId ?? null);
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
            ? 'in_progress'
            : input.provider === 'external_terminal'
              ? 'not_applicable'
              : 'complete',
        country_code: input.countryCode ?? le.countryCode,
        currencies: input.currencies,
        statement_descriptor: input.statementDescriptor ?? null,
        // Stripe accounts start pending until onboarding is confirmed by the provider (account.updated webhook or
        // an administrator who verified it); simulator and own-terminal accounts are usable immediately.
        status: input.provider === 'stripe_connect' ? 'pending' : 'active',
        status_reason:
          input.provider === 'stripe_connect' ? 'Waiting for provider onboarding to complete.' : null,
        application_fee_bps: input.provider === 'stripe_connect' ? (input.applicationFeeBps ?? null) : null,
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
      throw new ConflictError(
        'payment_account_exists',
        'This provider account is already connected in this organization.',
      );
    }
    throw err;
  }
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
  const row = await db(tx)
    .updateTable('payments.accounts')
    .set({
      ...(patch.displayName !== undefined ? { display_name: patch.displayName } : {}),
      ...(patch.status !== undefined ? { status: patch.status } : {}),
      ...(patch.statusReason !== undefined ? { status_reason: patch.statusReason } : {}),
      ...(patch.onboardingStatus !== undefined ? { onboarding_status: patch.onboardingStatus } : {}),
      ...(patch.currencies !== undefined ? { currencies: patch.currencies } : {}),
      ...(patch.statementDescriptor !== undefined ? { statement_descriptor: patch.statementDescriptor } : {}),
      ...(patch.applicationFeeBps !== undefined ? { application_fee_bps: patch.applicationFeeBps } : {}),
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
  input: z.infer<typeof paymentMethodInput>,
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
  const id = newId(tx.now.getTime());
  try {
    const row = await db(tx)
      .insertInto('payments.payment_methods')
      .values({
        id,
        tenant_id: tx.tenantId,
        account_id: account.id,
        property_id: input.propertyId,
        kind: input.kind,
        provider_token: input.providerToken,
        provider_customer_ref: input.providerCustomerRef ?? null,
        brand: input.brand ?? null,
        last4: input.last4 ?? null,
        exp_month: input.expMonth ?? null,
        exp_year: input.expYear ?? null,
        holder_name: input.holderName ?? null,
        owner_type: input.owner.type,
        owner_id: input.owner.id,
        mit_agreement: input.mitAgreement,
        mandate: JSON.stringify(input.mandate ?? {}),
        token_portability:
          input.tokenPortability ?? (input.kind === 'virtual_card' ? 'vault_portable' : 'provider_bound'),
        portability_note: input.portabilityNote ?? null,
        status: 'active',
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    // Audit without the token itself (tokens are not card data, but they are credentials to charge).
    await tx.audit({
      action: 'payments.method.create',
      target: { type: 'payment_method', id },
      propertyId: input.propertyId,
      after: { ...toMethodView(row) },
    });
    return toMethodView(row);
  } catch (err) {
    if (uniqueViolation(err)) {
      const existing = await db(tx)
        .selectFrom('payments.payment_methods')
        .selectAll()
        .where('account_id', '=', account.id)
        .where('provider_token', '=', input.providerToken)
        .executeTakeFirstOrThrow();
      return toMethodView(existing);
    }
    throw err;
  }
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
