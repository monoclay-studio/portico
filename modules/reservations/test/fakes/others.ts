import type { TxContext } from '@portico/db';
import {
  assertExternalEffectAllowed,
  BusinessRuleError,
  type EntityRef,
  ExternalServiceError,
  type Money,
  NotFoundError,
  newId,
  systemAuthorizer,
} from '@portico/kernel';
import { platform } from '@portico/platform';
import type {
  AccessPort,
  GuestProfileInput,
  GuestsPort,
  KeyOperationResult,
  OperationsPort,
  PaymentAttempt,
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
    for (const r of this.merges.get(mergeId)?.repoints ?? [])
      (out[r.module] ??= []).push({ type: r.type, id: r.id, field: r.field ?? null });
    return out;
  }
}

type Outcome = PaymentAttempt['status'] | 'timeout';

/**
 * Fake payments: provider operations are journaled by idempotency key (a retry returns the SAME attempt), outcomes
 * are scripted per test, and `timeout` simulates the screen timing out after the provider received the request:
 * the attempt is journaled as pending_verification and the call throws (S05-style). `resolve` = reconciliation.
 */
export class FakePayments implements PaymentsPort {
  script: Outcome[] = [];
  attempts = new Map<string, PaymentAttempt & { ref: EntityRef }>();
  authorizeCalls = 0;
  requests: Array<{ amount: Money; ref: EntityRef }> = [];
  async authorize(
    _tx: TxContext,
    input: { methodId: string; amount: Money; ref: EntityRef; idempotencyKey: string },
  ) {
    this.authorizeCalls++;
    const existing = this.attempts.get(input.idempotencyKey);
    if (existing) return existing;
    const outcome = this.script.shift() ?? 'authorized';
    const attempt = {
      id: newId(),
      status: outcome === 'timeout' ? 'pending_verification' : outcome,
      amount: input.amount,
      ref: input.ref,
      ...(outcome === 'failed' ? { failureReason: 'card declined' } : {}),
    } as PaymentAttempt & { ref: EntityRef };
    this.attempts.set(input.idempotencyKey, attempt);
    if (outcome === 'timeout')
      throw new ExternalServiceError('payments', 'The payment provider did not answer in time.');
    return attempt;
  }
  resolve(ref: EntityRef, status: 'authorized' | 'failed' | 'succeeded') {
    for (const a of this.attempts.values())
      if (a.ref.type === ref.type && a.ref.id === ref.id && a.status === 'pending_verification')
        a.status = status;
  }
  async getPaymentStatus(_tx: TxContext, ref: EntityRef): Promise<PaymentStatusView> {
    const mine = [...this.attempts.values()].filter((a) => a.ref.type === ref.type && a.ref.id === ref.id);
    const pick = (s: string) => mine.find((a) => a.status === s);
    const a =
      pick('succeeded') ??
      pick('authorized') ??
      pick('pending_verification') ??
      pick('requires_action') ??
      pick('failed');
    return {
      ref,
      status: a
        ? (a.status as PaymentStatusView['status'])
        : this.requests.some((r) => r.ref.id === ref.id)
          ? 'requested'
          : 'none',
      authorized: a?.status === 'authorized' ? a.amount : null,
      captured: a?.status === 'succeeded' ? a.amount : null,
      pendingVerification: a?.status === 'pending_verification' ? a.amount : null,
    };
  }
  async createPaymentRequest(_tx: TxContext, input: { amount: Money; ref: EntityRef }) {
    this.requests.push({ amount: input.amount, ref: input.ref });
    return { id: newId(), status: 'sent' };
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
 * Fake access module (door locks / mobile keys). Honors environment safety like a real adapter, journals by
 * idempotency key, and can be switched to `unavailable` (lock system down) or `pending`.
 */
export class FakeAccess implements AccessPort {
  mode: 'issued' | 'unavailable' | 'pending' = 'issued';
  calls: Array<{ op: string; input: Record<string, unknown> }> = [];
  private journal = new Map<string, KeyOperationResult>();
  private run(
    tx: TxContext,
    op: string,
    input: { idempotencyKey: string } & Record<string, unknown>,
    ok: KeyOperationResult['status'],
  ) {
    this.calls.push({ op, input });
    const mode = assertExternalEffectAllowed(tx, 'access.key');
    const prior = this.journal.get(input.idempotencyKey);
    if (prior && prior.status !== 'unavailable' && prior.status !== 'pending') return prior;
    const result: KeyOperationResult =
      mode === 'simulate'
        ? { status: 'simulated', keyRefs: [`sim-${op}`] }
        : this.mode === 'issued'
          ? { status: ok, keyRefs: ok === 'cancelled' ? [] : [`key-${newId().slice(-6)}`] }
          : {
              status: this.mode,
              keyRefs: [],
              message: this.mode === 'unavailable' ? 'Lock server offline' : 'Encoder busy',
            };
    this.journal.set(input.idempotencyKey, result);
    return result;
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
