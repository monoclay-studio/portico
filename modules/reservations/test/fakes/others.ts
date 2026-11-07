import type { TxContext } from '@portico/db';
import {
  assertExternalEffectAllowed,
  BusinessRuleError,
  DomainError,
  type EntityRef,
  type Money,
  NotFoundError,
  newId,
  systemAuthorizer,
} from '@portico/kernel';
import { platform } from '@portico/platform';
import type {
  AccessPort,
  AuthorizationView,
  GuestProfileInput,
  GuestsPort,
  KeyOperationResult,
  OperationsPort,
  PaymentStatusView,
  PaymentsPort,
  PlatformPort,
  UnitCondition,
} from '../../src/ports';

/**
 * Fake guests (GuestsPort) with the guests provider's shapes: ProfileInput carries propertyId and contact points;
 * exact match on a non-channel email only (channel proxy addresses are never match keys); never merges silently.
 * Records reference re-points per merge like guests does (refuses for a merge that is no longer active).
 */
export class FakeGuests implements GuestsPort {
  profiles = new Map<string, GuestProfileInput & { id: string }>();
  history: Array<{
    profileId: string;
    stayRef: EntityRef;
    status: string;
    role?: string;
    bookingId?: string | null;
  }> = [];
  merges = new Map<
    string,
    {
      status: 'active' | 'reverted';
      repoints: Array<{ module: string; type: string; id: string; field?: string | null }>;
    }
  >();
  async resolveProfile(_tx: TxContext, input: GuestProfileInput) {
    if (!input.propertyId) throw new Error('guests.resolveProfile requires propertyId');
    const email = input.contactPoints?.find((c) => c.kind === 'email' && c.source !== 'channel')?.value;
    const match = email
      ? [...this.profiles.values()].find((p) =>
          p.contactPoints?.some((c) => c.kind === 'email' && c.value === email),
        )
      : undefined;
    if (match) return { profileId: match.id, created: false, possibleDuplicates: [] };
    const id = newId();
    this.profiles.set(id, { ...input, id });
    return { profileId: id, created: true, possibleDuplicates: [] };
  }
  async recordStayHistory(
    _tx: TxContext,
    input: {
      profileId: string;
      stayRef: EntityRef;
      status: string;
      role?: string;
      bookingId?: string | null;
    },
  ) {
    this.history.push({
      profileId: input.profileId,
      stayRef: input.stayRef,
      status: input.status,
      role: input.role,
      bookingId: input.bookingId ?? null,
    });
  }
  async recordReferenceRepoints(
    _tx: TxContext,
    input: { mergeId: string; module: string; references: Array<EntityRef & { field?: string | null }> },
  ) {
    const merge = this.merges.get(input.mergeId);
    if (!merge) throw new NotFoundError('merge', input.mergeId);
    if (merge.status !== 'active') {
      throw new BusinessRuleError('merge_not_active', `Merge ${input.mergeId} is ${merge.status}.`);
    }
    for (const r of input.references) merge.repoints.push({ module: input.module, ...r });
    return { recorded: input.references.length };
  }
  /** Test helper: what an unmerge would send back to this module. */
  referencesToRestore(mergeId: string): Record<string, Array<EntityRef & { field?: string | null }>> {
    const out: Record<string, Array<EntityRef & { field?: string | null }>> = {};
    for (const r of this.merges.get(mergeId)?.repoints ?? []) {
      const list = out[r.module] ?? [];
      list.push({ type: r.type, id: r.id, field: r.field ?? null });
      out[r.module] = list;
    }
    return out;
  }
}

type ProviderOutcome = 'authorized' | 'failed' | 'timeout';

interface FakeAuthorization extends AuthorizationView {
  key: string;
  requestHash: string;
  propertyId: string;
}

/**
 * Fake payments, TWO-PHASE and strict like the payments module (R-11):
 *  - `authorize` inside the caller's transaction records the intent and returns `processing`; the provider answers
 *    only after commit (tx.afterCommit) with the next scripted outcome: `authorized`, `failed` (a decline with
 *    payments' explanation) or `timeout` (no answer → `pending_verification`). A rollback leaves nothing behind.
 *  - the same idempotency key returns the same authorization; the same key with a different request is refused;
 *    a second authorization while one is in flight on the same reference is refused (one in flight per ref);
 *  - methods must be registered for the property; environment safety is honored (`payment.charge`).
 *  - `resolve` = reconciliation settling a pending verification. `crashNextAuthorize` simulates the process dying
 *    inside the transaction (nothing recorded).
 */
export class FakePayments implements PaymentsPort {
  script: ProviderOutcome[] = [];
  crashNextAuthorize = false;
  /** Registered tokenized payment methods → property. */
  methods = new Map<string, string>();
  /** Committed authorizations by idempotency key, in creation order. */
  authorizations = new Map<string, FakeAuthorization>();
  authorizeCalls = 0;
  /** Calls that actually reached the "provider" (after commit). */
  providerCalls = 0;
  requests: Array<{ amount: Money; ref: EntityRef; key: string }> = [];

  addMethod(propertyId: string): string {
    const id = newId();
    this.methods.set(id, propertyId);
    return id;
  }

  private view(a: FakeAuthorization): AuthorizationView {
    return {
      id: a.id,
      methodId: a.methodId,
      ref: { ...a.ref },
      amount: { ...a.amount },
      status: { ...a.status },
      mode: a.mode,
      decline: a.decline ? { ...a.decline } : null,
    };
  }

  async authorize(
    tx: TxContext,
    input: {
      propertyId: string;
      methodId: string;
      amount: { amountMinor: number; currency: string };
      ref: { type: string; id: string };
      idempotencyKey: string;
    },
  ): Promise<AuthorizationView> {
    this.authorizeCalls++;
    const hash = JSON.stringify([input.propertyId, input.methodId, input.amount, input.ref]);
    const existing = this.authorizations.get(input.idempotencyKey);
    if (existing) {
      if (existing.requestHash !== hash)
        throw new DomainError(
          'idempotency_key_reused',
          'This idempotency key was already used for a different authorization.',
          { status: 422 },
        );
      return this.view(existing);
    }
    if (this.crashNextAuthorize) {
      this.crashNextAuthorize = false;
      throw new Error('connection reset');
    }
    const mode = assertExternalEffectAllowed(tx, 'payment.charge');
    const owner = this.methods.get(input.methodId);
    if (!owner)
      throw new NotFoundError('payment_method_not_found', `Payment method ${input.methodId} was not found.`);
    if (owner !== input.propertyId)
      throw new BusinessRuleError(
        'payment_method_property_mismatch',
        'This payment method belongs to another property.',
      );
    if (!Number.isInteger(input.amount.amountMinor) || input.amount.amountMinor <= 0)
      throw new BusinessRuleError(
        'invalid_amount',
        'An authorization needs a positive amount in minor units.',
      );
    const inFlight = [...this.authorizations.values()].some(
      (a) =>
        a.ref.type === input.ref.type &&
        a.ref.id === input.ref.id &&
        (a.status.authorization === 'processing' || a.status.authorization === 'pending_verification'),
    );
    if (inFlight)
      throw new DomainError(
        'pending_verification_block',
        'An authorization for this reference is still pending verification. Wait for it to resolve.',
        { status: 409 },
      );
    const auth: FakeAuthorization = {
      id: newId(),
      key: input.idempotencyKey,
      requestHash: hash,
      propertyId: input.propertyId,
      methodId: input.methodId,
      ref: { ...input.ref },
      amount: { ...input.amount },
      status: { authorization: 'processing' },
      mode: mode === 'live' ? 'live' : mode === 'sandbox' ? 'sandbox' : 'simulate',
      decline: null,
    };
    tx.afterCommit(() => {
      this.authorizations.set(auth.key, auth);
      this.providerCalls++;
      const outcome = this.script.shift() ?? 'authorized';
      if (outcome === 'timeout') auth.status = { authorization: 'pending_verification' };
      else if (outcome === 'failed') {
        auth.status = { authorization: 'failed' };
        auth.decline = {
          code: 'do_not_honor',
          category: 'issuer_declined',
          message: 'The card issuer declined the authorization.',
          recovery: 'Ask the guest for another card or to contact their bank.',
          retryable: false,
        };
      } else auth.status = { authorization: 'authorized' };
    });
    return this.view(auth);
  }

  /** Reconciliation settles pending verifications on a reference. */
  resolve(ref: EntityRef, status: 'authorized' | 'failed') {
    for (const a of this.authorizations.values())
      if (a.ref.type === ref.type && a.ref.id === ref.id && a.status.authorization === 'pending_verification')
        a.status = { authorization: status };
  }

  async getPaymentStatus(_tx: TxContext, ref: { type: string; id: string }): Promise<PaymentStatusView> {
    const mine = [...this.authorizations.values()].filter(
      (a) => a.ref.type === ref.type && a.ref.id === ref.id,
    );
    const pending = mine.some(
      (a) => a.status.authorization === 'processing' || a.status.authorization === 'pending_verification',
    );
    const held = mine
      .filter((a) => a.status.authorization === 'authorized')
      .reduce((n, a) => n + a.amount.amountMinor, 0);
    return {
      ref,
      status: pending ? 'pending_verification' : held > 0 ? 'authorized' : 'none',
      pendingVerification: pending,
      authorizedMinor: held,
      capturedMinor: 0,
      authorizations: mine.map((a) => this.view(a)),
    };
  }

  async createPaymentRequest(
    _tx: TxContext,
    input: Parameters<PaymentsPort['createPaymentRequest']>[1],
  ): Promise<{ id: string; status: Record<string, string> }> {
    this.requests.push({ amount: input.amount, ref: input.ref, key: input.idempotencyKey });
    return { id: newId(), status: { request: 'open' } };
  }
}

export class FakeOperations implements OperationsPort {
  conditions = new Map<string, UnitCondition>();
  tasks: Array<{ title: string; kind: string }> = [];
  async getUnitCondition(_tx: TxContext, unitId: string) {
    return { condition: this.conditions.get(unitId) ?? 'inspected' };
  }
  async createTask(_tx: TxContext, input: { title: string; kind: string }) {
    this.tasks.push({ title: input.title, kind: input.kind });
    return { taskId: newId() };
  }
}

/**
 * Fake access module (door locks / mobile keys), TWO-PHASE like the real contract: a call inside the caller's
 * transaction records the operation and returns `pending`; the "lock system" acts only after commit (tx.afterCommit),
 * so a rollback leaves no key changed. A repeated idempotency key returns the settled result. Honors environment
 * safety; `mode` simulates an unavailable lock system.
 */
export class FakeAccess implements AccessPort {
  mode: 'issued' | 'unavailable' = 'issued';
  calls: Array<{ op: string; input: Record<string, unknown> }> = [];
  /** Operations the lock system actually performed (after commit). */
  executed: Array<{ op: string; stayId: string; idempotencyKey: string }> = [];
  private journal = new Map<string, KeyOperationResult>();
  private run(
    tx: TxContext,
    op: string,
    input: { idempotencyKey: string; stayId: string } & Record<string, unknown>,
    ok: KeyOperationResult['status'],
  ): KeyOperationResult {
    this.calls.push({ op, input });
    const mode = assertExternalEffectAllowed(tx, 'access.key');
    const settled = this.journal.get(input.idempotencyKey);
    if (
      settled &&
      settled.status !== 'pending' &&
      !(settled.status === 'unavailable' && this.mode !== 'unavailable')
    ) {
      return settled;
    }
    const pending: KeyOperationResult = { status: 'pending', keyRefs: [] };
    this.journal.set(input.idempotencyKey, pending);
    tx.afterCommit(() => {
      const result: KeyOperationResult =
        mode === 'simulate'
          ? { status: 'simulated', keyRefs: ok === 'cancelled' ? [] : [`sim-${op}`] }
          : this.mode === 'issued'
            ? { status: ok, keyRefs: ok === 'cancelled' ? [] : [`key-${newId().slice(-6)}`] }
            : { status: 'unavailable', keyRefs: [], message: 'Lock server offline' };
      this.journal.set(input.idempotencyKey, result);
      if (result.status !== 'unavailable')
        this.executed.push({ op, stayId: input.stayId, idempotencyKey: input.idempotencyKey });
    });
    return pending;
  }
  async issueKeys(tx: TxContext, input: Parameters<AccessPort['issueKeys']>[1]) {
    return this.run(tx, 'issue', input, 'issued');
  }
  async extendKeys(tx: TxContext, input: Parameters<AccessPort['extendKeys']>[1]) {
    return this.run(tx, 'extend', input, 'issued');
  }
  async moveKeys(tx: TxContext, input: Parameters<AccessPort['moveKeys']>[1]) {
    return this.run(tx, 'move', input, 'issued');
  }
  async cancelKeys(tx: TxContext, input: Parameters<AccessPort['cancelKeys']>[1]) {
    return this.run(tx, 'cancel', input, 'cancelled');
  }
}

/**
 * PlatformPort bound to the REAL platform module (it exists on main). Property facts are read with a system
 * authorizer: reservations needs the time zone/currency to compute, whatever the caller may see of the property.
 * The same binding is used in the composition root.
 */
export function realPlatformPort(): PlatformPort {
  return {
    async getProperty(tx, propertyId) {
      const p = await platform.getProperty({ ...tx, authz: systemAuthorizer }, propertyId);
      return {
        id: p.id,
        name: p.name,
        timezone: p.timezone,
        baseCurrency: p.baseCurrency,
        legalEntityId: p.legalEntityId,
        businessDate: p.businessDate,
        checkInTime: p.checkInTime,
        checkOutTime: p.checkOutTime,
      };
    },
    getBusinessDate: (tx, propertyId) => platform.getBusinessDate(tx, propertyId),
    assertWritable: (tx, propertyId, domain) => platform.assertWritable(tx, propertyId, domain),
    getDataAuthority: (tx, propertyId, domain) => platform.getDataAuthority(tx, propertyId, domain),
    resolvePolicy: (tx, propertyId, key, def) => platform.resolvePolicy(tx, propertyId, key, def),
  };
}
