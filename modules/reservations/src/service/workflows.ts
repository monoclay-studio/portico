import { type PorticoDatabase, sql, type TxContext, withTenantTx } from '@portico/db';
import {
  BusinessRuleError,
  DomainError,
  type EntityRef,
  eachNight,
  type Money,
  NotFoundError,
  newId,
  type RequestContext,
  requirePermission,
  ValidationError,
} from '@portico/kernel';
import type { CheckInInputs, CheckOutInputs, KeyStepInput, WorkflowRun } from '../contracts';
import { conditionMeets } from '../domain/readiness';
import {
  assertStayTransition,
  type BookingStatus,
  bookingShouldComplete,
  type StayStatus,
} from '../domain/status';
import {
  blockingSteps,
  canConfirm,
  getStep,
  initialSteps,
  recordStep,
  type StepKey,
  type StepState,
  stepLabel,
  summarize,
  type WorkflowKind,
} from '../domain/workflow';
import { RESERVATIONS_EVENTS as E } from '../events';
import { RESERVATIONS_PERMISSIONS as P } from '../manifest';
import {
  type AuthorizationState,
  type AuthorizationView,
  authorizationState,
  type GuaranteeKind,
  type KeyKind,
  type KeyOperationResult,
  type PaymentStatusView,
  type UnitCondition,
} from '../ports';
import { type ForwardedResult, guardAuthority, isForwarded } from './authority';
import {
  actorKey,
  actorName,
  chargeCodes,
  type Deps,
  db,
  isModuleUnavailable,
  json,
  policy,
} from './context';
import { emitReservationEvent } from './event-payload';
import { checkGuaranteeMethod, guaranteeCap, PAYMENT_COLLECT } from './guarantee';
import { resolveGuest } from './guests';
import { raiseIssue } from './issues';
import { agreedPenalty } from './penalties';
import {
  bumpBooking,
  currentUnit,
  loadBooking,
  loadSnapshots,
  loadStay,
  lockBooking,
  replaceSegments,
  type StayRecord,
  snapshotOf,
  stayTotals,
  updateStay,
} from './repo';

interface RunRow {
  id: string;
  stay_id: string;
  property_id: string;
  kind: string;
  status: string;
  steps: unknown;
  started_at: Date;
  updated_at: Date;
  version: number;
}

function toView(row: RunRow): WorkflowRun {
  const steps = row.steps as StepState[];
  return {
    id: row.id,
    stayId: row.stay_id,
    kind: row.kind as WorkflowKind,
    status: row.status as WorkflowRun['status'],
    steps: steps.map((s) => ({
      key: s.key,
      label: stepLabel(s.key),
      status: s.status,
      mandatory: s.mandatory,
      external: s.external,
      attempts: s.attempts,
      message: s.message,
      result: s.result,
      updatedAt: s.updatedAt,
    })),
    summary: summarize(steps),
    version: row.version,
    startedAt: row.started_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

/** The earlier of two local dates (ISO strings compare lexicographically). */
const earlier = (a: string, b: string): string => [a, b].sort()[0] as string;

const permissionFor = (kind: WorkflowKind) => (kind === 'check_in' ? P.stayCheckIn : P.stayCheckOut);

async function activeRun(
  tx: TxContext,
  stayId: string,
  kind: WorkflowKind,
  forUpdate = false,
): Promise<RunRow | null> {
  let q = db(tx)
    .selectFrom('reservations.workflow_runs')
    .selectAll()
    .where('stay_id', '=', stayId)
    .where('kind', '=', kind)
    .where('status', '=', 'in_progress');
  if (forUpdate) q = q.forUpdate();
  return ((await q.executeTakeFirst()) as RunRow | undefined) ?? null;
}

/** Start (or resume) the check-in / check-out run for a stay. Returns the persisted run. */
export async function startWorkflow(
  deps: Deps,
  tx: TxContext,
  input: { stayId: string; kind: WorkflowKind },
): Promise<WorkflowRun | ForwardedResult> {
  const stay = await loadStay(tx, input.stayId);
  requirePermission(tx, permissionFor(input.kind), { propertyId: stay.row.property_id });
  // Data authority is decided BEFORE any step with an external effect (card authorization, keys) — R-08:
  // read_only refuses here; forward records ONE pending check-in/out for the system of record and runs nothing.
  const forwarded = await guardAuthority(deps, tx, {
    propertyId: stay.row.property_id,
    kind: input.kind,
    payload: { stayId: stay.row.id },
    bookingId: stay.row.booking_id,
    stayId: stay.row.id,
  });
  if (forwarded) return forwarded;
  const existing = await activeRun(tx, stay.row.id, input.kind);
  if (existing) return toView(existing);
  const booking = await loadBooking(tx, stay.row.booking_id);
  const businessDate = await deps.ports.platform.getBusinessDate(tx, stay.row.property_id);
  if (input.kind === 'check_in') {
    assertStayTransition(stay.row.status as StayStatus, 'in_house');
    if (!['confirmed', 'tentative'].includes(booking.row.status)) {
      throw new BusinessRuleError(
        'booking_not_confirmed',
        `Booking ${booking.row.code} is ${booking.row.status}; confirm it before checking the guest in.`,
      );
    }
    if (stay.row.arrival > businessDate) {
      throw new BusinessRuleError(
        'arrival_in_future',
        `This stay arrives on ${stay.row.arrival} (business date is ${businessDate}). To check in today, preview an earlier arrival date first.`,
        { arrival: stay.row.arrival, businessDate },
      );
    }
  } else {
    assertStayTransition(stay.row.status as StayStatus, 'departed');
  }
  const optional = await policy<StepKey[]>(
    deps,
    tx,
    stay.row.property_id,
    input.kind === 'check_in' ? 'reservations.checkIn.optionalSteps' : 'reservations.checkOut.optionalSteps',
    [],
  );
  const id = newId(tx.now.getTime());
  const row = {
    id,
    tenant_id: tx.tenantId,
    property_id: stay.row.property_id,
    stay_id: stay.row.id,
    kind: input.kind,
    status: 'in_progress',
    steps: json(initialSteps(input.kind, optional)),
    started_by: actorKey(tx),
    started_at: tx.now,
    updated_at: tx.now,
  };
  await db(tx).insertInto('reservations.workflow_runs').values(row).execute();
  await tx.audit({
    action: `reservations.${input.kind === 'check_in' ? 'checkIn' : 'checkOut'}.start`,
    target: { type: 'stay', id: stay.row.id },
    propertyId: stay.row.property_id,
    after: { runId: id },
  });
  return getWorkflow(deps, tx, { stayId: stay.row.id, kind: input.kind });
}

export async function getWorkflow(
  _deps: Deps,
  tx: TxContext,
  input: { stayId: string; kind: WorkflowKind },
): Promise<WorkflowRun> {
  const stay = await loadStay(tx, input.stayId);
  requirePermission(tx, P.bookingRead, { propertyId: stay.row.property_id });
  const row = await db(tx)
    .selectFrom('reservations.workflow_runs')
    .selectAll()
    .where('stay_id', '=', input.stayId)
    .where('kind', '=', input.kind)
    .orderBy('started_at', 'desc')
    .executeTakeFirst();
  if (!row) throw new NotFoundError(input.kind === 'check_in' ? 'check_in' : 'check_out', input.stayId);
  return toView(row as RunRow);
}

async function saveSteps(
  tx: TxContext,
  run: RunRow,
  steps: StepState[],
  status?: 'completed',
): Promise<RunRow> {
  const row = await db(tx)
    .updateTable('reservations.workflow_runs')
    .set({
      steps: json(steps),
      updated_at: tx.now,
      version: sql`version + 1`,
      ...(status ? { status, completed_at: tx.now } : {}),
    })
    .where('id', '=', run.id)
    .returningAll()
    .executeTakeFirstOrThrow();
  return row as RunRow;
}

type Outcome = {
  status: 'done' | 'failed' | 'pending';
  message: string;
  result?: Record<string, unknown>;
  idempotencyKey?: string;
};

// ───────────────────────────── check-in steps ─────────────────────────────

async function stepRegistration(
  deps: Deps,
  tx: TxContext,
  stay: StayRecord,
  input: CheckInInputs['registration'],
): Promise<Outcome> {
  if (input?.primaryOccupant) {
    const profileId = await resolveGuest(
      deps,
      tx,
      stay.row.property_id,
      input.primaryOccupant,
      { kind: 'registration', ref: stay.row.id },
      'suggest',
    );
    const name = [input.primaryOccupant.firstName, input.primaryOccupant.lastName].filter(Boolean).join(' ');
    const primary = stay.occupants.find((o) => o.is_primary);
    if (primary) {
      await db(tx)
        .updateTable('reservations.occupants')
        .set({ profile_id: profileId, name })
        .where('id', '=', primary.id)
        .execute();
    } else {
      await db(tx)
        .insertInto('reservations.occupants')
        .values({
          id: newId(tx.now.getTime()),
          tenant_id: tx.tenantId,
          stay_id: stay.row.id,
          position: -1,
          profile_id: profileId,
          name,
          kind: 'adult',
          age_at_arrival: null,
          is_primary: true,
        })
        .execute();
    }
  }
  const fresh = await loadStay(tx, stay.row.id);
  const primary = fresh.occupants.find((o) => o.is_primary);
  const missing: string[] = [];
  if (!primary?.name) missing.push('primary guest name');
  if (!primary?.profile_id) missing.push('primary guest profile');
  if (!input?.identityVerified) missing.push('identity verification');
  if (missing.length) {
    return { status: 'failed', message: `Missing: ${missing.join(', ')}.` };
  }
  return {
    status: 'done',
    message: 'Identity verified and required details complete.',
    result: { profileId: primary?.profile_id ?? null, documentRecorded: Boolean(input?.documentReference) },
  };
}

async function stepUnit(
  deps: Deps,
  tx: TxContext,
  stay: StayRecord,
  businessDate: string,
  input: CheckInInputs['unit'],
): Promise<Outcome> {
  let unitId = currentUnit(stay, businessDate);
  if (input?.unitId && input.unitId !== unitId) {
    const unit = await deps.ports.inventory.getUnit(tx, input.unitId, { propertyId: stay.row.property_id });
    const night = stay.row.arrival;
    const seg = stay.segments.find((s) => night >= s.from && night < s.to);
    if (!seg || seg.unitTypeId !== unit.unitTypeId) {
      return {
        status: 'failed',
        message: `${unit.name} is a different unit type; use a room move preview for an upgrade or downgrade.`,
      };
    }
    const ref: EntityRef = { type: 'stay', id: stay.row.id };
    const nights = { from: stay.row.arrival, to: stay.row.departure };
    if (stay.segments.some((s) => s.unitId))
      await deps.ports.inventory.unassignUnit(tx, { propertyId: stay.row.property_id, ref, nights });
    await deps.ports.inventory.assignUnit(tx, {
      propertyId: stay.row.property_id,
      unitId: unit.id,
      ref,
      nights,
    });
    await replaceSegments(
      tx,
      stay.row.id,
      stay.segments.map((s) => ({ ...s, unitId: unit.id })),
    );
    unitId = unit.id;
  }
  if (!unitId)
    return { status: 'failed', message: 'No unit is assigned. Assign a unit of the booked type first.' };
  const required = await policy<UnitCondition>(
    deps,
    tx,
    stay.row.property_id,
    'reservations.checkIn.requiredCondition',
    'inspected',
  );
  let condition: UnitCondition | 'unknown';
  try {
    condition = (await deps.ports.operations.getUnitCondition(tx, unitId)).condition;
  } catch (err) {
    if (!isModuleUnavailable(err)) throw err;
    condition = 'unknown';
  }
  if (condition !== 'unknown' && conditionMeets(condition, required)) {
    return { status: 'done', message: `Unit is ${condition}.`, result: { unitId, condition } };
  }
  if (input?.overrideConditionReason) {
    requirePermission(tx, P.staySkipCheckInStep, { propertyId: stay.row.property_id });
    return {
      status: 'done',
      message: `Checked in to a unit that is ${condition} (required: ${required}) — override: ${input.overrideConditionReason}.`,
      result: { unitId, condition, override: input.overrideConditionReason, by: actorName(tx) },
    };
  }
  return {
    status: 'failed',
    message:
      condition === 'unknown'
        ? 'The unit condition is unavailable from housekeeping; confirm readiness or override with a reason.'
        : condition === 'failed_inspection'
          ? 'The unit failed inspection. Choose another ready unit or wait for housekeeping.'
          : `The unit is ${condition}; it must be ${required} before check-in.`,
    result: { unitId, condition },
  };
}

const CONTRACT_GUARANTEES: readonly GuaranteeKind[] = ['company', 'agency', 'prepaid_channel'];

async function stepGuarantee(
  deps: Deps,
  tx: TxContext,
  stay: StayRecord,
  run: RunRow,
  step: StepState,
  input: CheckInInputs['guarantee'],
): Promise<Outcome> {
  const booking = await loadBooking(tx, stay.row.booking_id);
  const guarantee = (booking.row.guarantee ?? { kind: 'none' }) as {
    kind: GuaranteeKind;
    paymentMethodId?: string;
  };
  if (stay.row.commercial_type !== 'standard') {
    return {
      status: 'done',
      message: `No guarantee needed for a ${stay.row.commercial_type.replace('_', '-')} stay.`,
    };
  }
  if (CONTRACT_GUARANTEES.includes(guarantee.kind)) {
    return {
      status: 'done',
      message: `Guaranteed by ${guarantee.kind.replace('_', ' ')}.`,
      result: { guarantee: guarantee.kind },
    };
  }
  const payments = deps.ports.payments;
  const stayRef: EntityRef = { type: 'stay', id: stay.row.id };
  // ALWAYS read the authoritative status first (RES-I09, S05, R-11). Payments is two-phase: an authorization we
  // requested may still be `processing` (provider call after commit) or `pending_verification` (no answer). Never
  // authorize again while one is processing, pending or held — wait and read again.
  // Payment records of this stay or booking held at another property (data repair, review P1-1/P2-7) are not
  // usable here: a failed step that says so and names the recovery, never a bare 403.
  const readStatus = async (ref: EntityRef) => {
    try {
      return await payments.getPaymentStatus(tx, ref, { propertyId: stay.row.property_id });
    } catch (err) {
      if (err instanceof DomainError && err.code === 'scope_mismatch') return null;
      throw err;
    }
  };
  const elsewhere: Outcome = {
    status: 'failed',
    message:
      'A payment for this booking was recorded at another property, so it cannot secure this check-in. Finance must move it to this property; meanwhile take the guarantee here with a card of the guest.',
  };
  const status = await readStatus(stayRef);
  if (!status) return elsewhere;
  const auths = status.authorizations;
  const declined = auths.filter((a) => authorizationState(a) === 'failed');
  // A NEW key only after the provider DECLINED an attempt (counted from payments' own records, so a lost step
  // record cannot cause a second authorization); an interrupted attempt keeps its key.
  const keyFor = (n: number) => `checkin:${run.id}:guarantee:${n}`;
  const held = auths.find((a) => HELD.includes(authorizationState(a)));
  if (
    held ||
    status.status === 'authorized' ||
    status.status === 'paid' ||
    status.status === 'partially_paid'
  ) {
    return {
      status: 'done',
      message: held
        ? `Card authorized${modeLabel(held)} (confirmed by payments).`
        : `Payment ${status.status.replace('_', ' ')} (confirmed by payments).`,
      result: guaranteeResult(status, held, declined.length),
      idempotencyKey: step.idempotencyKey ?? keyFor(declined.length),
    };
  }
  const inFlight = auths.find((a) => IN_FLIGHT.includes(authorizationState(a)));
  if (inFlight || status.pendingVerification) {
    return {
      status: 'pending',
      message:
        inFlight && authorizationState(inFlight) === 'processing'
          ? 'Card authorization sent to the payment provider; waiting for its answer. Do not take payment again.'
          : 'The payment outcome is pending verification. Do not take payment again — reconciliation will resolve it.',
      result: guaranteeResult(status, inFlight, declined.length),
      idempotencyKey: step.idempotencyKey ?? keyFor(declined.length),
    };
  }
  // We were waiting for an answer and the provider declined (or the hold lapsed): report it. A retry — ideally
  // with another card — makes a new attempt.
  const awaitedId = typeof step.result?.authorizationId === 'string' ? step.result.authorizationId : null;
  const awaited = awaitedId ? auths.find((a) => a.id === awaitedId) : undefined;
  if (step.status === 'pending' && awaited) {
    return {
      status: 'failed',
      message: declineMessage(awaited),
      result: guaranteeResult(status, awaited, declined.length),
      idempotencyKey: step.idempotencyKey ?? keyFor(declined.length),
    };
  }
  const bookingStatus = await readStatus({ type: 'booking', id: booking.row.id });
  if (!bookingStatus) return elsewhere;
  if (
    bookingStatus.status === 'paid' ||
    bookingStatus.status === 'partially_paid' ||
    bookingStatus.status === 'authorized'
  ) {
    return {
      status: 'done',
      message: `Booking payment ${bookingStatus.status.replace('_', ' ')} (confirmed by payments).`,
      result: guaranteeResult(bookingStatus, undefined, declined.length),
    };
  }
  if (bookingStatus.pendingVerification) {
    return {
      status: 'pending',
      message:
        'A booking payment is pending verification. Do not take payment again — reconciliation will resolve it.',
      result: guaranteeResult(bookingStatus, undefined, declined.length),
    };
  }
  // Review P1-2: another card or amount than the booking's agreed guarantee is an explicit payments capability
  // (ADR-0015 §5) — the check-in permission secures the stay with ITS guarantee, not any card for any amount.
  const overridesCard =
    input?.paymentMethodId !== undefined && input.paymentMethodId !== guarantee.paymentMethodId;
  if (overridesCard || input?.amount !== undefined) {
    requirePermission(tx, PAYMENT_COLLECT, { propertyId: stay.row.property_id });
  }
  const methodId = input?.paymentMethodId ?? guarantee.paymentMethodId;
  if (!methodId) {
    const snaps = await loadSnapshots(
      tx,
      stay.segments.map((s) => s.termsSnapshotId),
    );
    const first = snapshotOf(snaps, (stay.segments[0] as { termsSnapshotId: string }).termsSnapshotId);
    const required = first.policies.guarantee.required.filter((k) => k !== 'none');
    if (required.length === 0 && guarantee.kind === 'none') {
      return { status: 'done', message: 'The agreed terms require no guarantee.' };
    }
    return {
      status: 'failed',
      message: 'A card authorization or payment is needed. Add a payment method (card token) and retry.',
    };
  }
  // Do not send the same card again after a decline the provider marked not retryable.
  const last = auths[auths.length - 1];
  if (
    last &&
    authorizationState(last) === 'failed' &&
    last.methodId === methodId &&
    !last.decline?.retryable
  ) {
    return {
      status: 'failed',
      message: `${declineMessage(last)} This card cannot be retried; use another card or payment method.`,
      result: guaranteeResult(status, last, declined.length),
    };
  }
  // The card must belong to the booking's guest, booker or payer (also for the booking's own recorded card).
  const notAllowed = await checkGuaranteeMethod(deps, tx, {
    bookingId: booking.row.id,
    propertyId: stay.row.property_id,
    methodId,
  });
  if (notAllowed) return { status: 'failed', message: notAllowed };
  const agreed = stayTotals(
    stay,
    await loadSnapshots(
      tx,
      stay.segments.map((s) => s.termsSnapshotId),
    ),
    booking.row.currency,
  ).gross;
  const amount: Money = input?.amount ?? agreed;
  const cap = await guaranteeCap(deps, tx, stay.row.property_id, agreed);
  if (
    amount.currency !== agreed.currency ||
    amount.amountMinor > cap.amountMinor ||
    amount.amountMinor <= 0
  ) {
    return {
      status: 'failed',
      message: `The amount to hold must be in ${agreed.currency}, positive and at most ${cap.amountMinor} minor units (the agreed stay total with the property's guarantee cap). Adjust the amount.`,
    };
  }
  const idempotencyKey = keyFor(declined.length);
  const auth = await payments.authorize(tx, {
    propertyId: stay.row.property_id,
    methodId,
    amount,
    ref: stayRef,
    idempotencyKey,
  });
  const state = authorizationState(auth);
  const result = { ...guaranteeResult(status, auth, declined.length), amount: auth.amount };
  if (HELD.includes(state)) {
    return { status: 'done', message: `Card authorized${modeLabel(auth)}.`, result, idempotencyKey };
  }
  if (state === 'failed' || state === 'voided' || state === 'expired') {
    return { status: 'failed', message: declineMessage(auth), result, idempotencyKey };
  }
  // processing / pending_verification / unknown: the outcome arrives after commit — the workflow reads it again.
  return {
    status: 'pending',
    message:
      'Card authorization sent to the payment provider; waiting for its answer. Do not take payment again.',
    result,
    idempotencyKey,
  };
}

const HELD: ReadonlyArray<AuthorizationState | 'unknown'> = ['authorized', 'partially_captured', 'captured'];
const IN_FLIGHT: ReadonlyArray<AuthorizationState | 'unknown'> = ['processing', 'pending_verification'];

function modeLabel(a: AuthorizationView): string {
  return a.mode === 'simulate' ? ' (simulated — no real money)' : a.mode === 'sandbox' ? ' (sandbox)' : '';
}

function declineMessage(a: AuthorizationView): string {
  const state = authorizationState(a);
  if (state === 'expired') return 'The card authorization expired before check-in. Authorize the card again.';
  if (state === 'voided') return 'The card authorization was released. Authorize the card again.';
  return a.decline
    ? `Card declined: ${a.decline.message} ${a.decline.recovery}`
    : 'Card declined by the payment provider. Try another card or payment method.';
}

function guaranteeResult(
  status: PaymentStatusView,
  auth: AuthorizationView | undefined,
  declinedAttempts: number,
): Record<string, unknown> {
  return {
    paymentStatus: status.status,
    authorizationId: auth?.id ?? null,
    authorizationStatus: auth ? authorizationState(auth) : null,
    mode: auth?.mode ?? null,
    declinedAttempts,
  };
}

async function stayFolio(deps: Deps, tx: TxContext, stay: StayRecord): Promise<string> {
  const owner: EntityRef = { type: 'stay', id: stay.row.id };
  const folios = await deps.ports.finance.listFolios(tx, { propertyId: stay.row.property_id, owner });
  const def = folios.find((f) => f.isDefault) ?? folios[0];
  if (def) return def.folioId;
  const booking = await loadBooking(tx, stay.row.booking_id);
  const primary =
    stay.occupants.find((o) => o.is_primary && o.profile_id)?.profile_id ?? booking.row.booker_profile_id;
  if (!primary) {
    throw new BusinessRuleError(
      'payer_required',
      'This stay has no guest profile to open a folio for. Complete registration first.',
    );
  }
  return (
    await deps.ports.finance.openFolio(tx, {
      propertyId: stay.row.property_id,
      owner,
      payer: { type: 'profile', id: primary },
    })
  ).folioId;
}

async function stepDeposits(deps: Deps, tx: TxContext, stay: StayRecord): Promise<Outcome> {
  const folioId = await stayFolio(deps, tx, stay);
  const applied = await deps.ports.finance.applyDeposits(tx, {
    propertyId: stay.row.property_id,
    bookingId: stay.row.booking_id,
    toFolioId: folioId,
  });
  return {
    status: 'done',
    message:
      applied && applied.applied.amountMinor > 0
        ? 'Deposits applied to the folio.'
        : 'No deposits held for this booking.',
    result: { folioId, applied: applied?.applied ?? null },
  };
}

async function stepAccess(
  deps: Deps,
  tx: TxContext,
  stay: StayRecord,
  run: RunRow,
  step: StepState,
  businessDate: string,
  input: KeyStepInput | undefined,
  mode: 'issue' | 'cancel',
): Promise<Outcome> {
  const idempotencyKey = `${run.kind === 'check_in' ? 'checkin' : 'checkout'}:${run.id}:keys`;
  // Manual fallback confirmed by staff (lock system was unavailable): recorded, attributed, never implicit.
  if (input?.manualFallback && step.status !== 'pending') {
    return {
      status: 'done',
      message: `Keys ${mode === 'issue' ? 'issued' : 'deactivated'} manually on the lock console (confirmed by ${actorName(tx)}): ${input.manualFallback.note}.`,
      result: {
        manualFallback: true,
        note: input.manualFallback.note,
        confirmedBy: actorName(tx),
        previous: step.result,
      },
      idempotencyKey,
    };
  }
  let result: KeyOperationResult;
  try {
    if (mode === 'issue') {
      const unitId = currentUnit(stay, businessDate);
      if (!unitId) return { status: 'failed', message: 'Assign a unit before issuing keys.' };
      const kind =
        input?.kind ??
        (await policy<KeyKind>(deps, tx, stay.row.property_id, 'reservations.keys.defaultKind', 'card'));
      const adults = stay.segments[0]?.occupancy.adults ?? 1;
      result = await deps.ports.access.issueKeys(tx, {
        stayId: stay.row.id,
        unitId,
        validFrom: stay.row.arrival,
        validTo: stay.row.departure,
        count: input?.count ?? adults,
        kind,
        idempotencyKey,
      });
    } else {
      result = await deps.ports.access.cancelKeys(tx, {
        stayId: stay.row.id,
        reason: 'check_out',
        idempotencyKey,
      });
    }
  } catch (err) {
    if (!isModuleUnavailable(err)) throw err;
    result = { status: 'unavailable', keyRefs: [], message: 'The key system is not available.' };
  }
  const verb = mode === 'issue' ? 'issued' : 'deactivated';
  switch (result.status) {
    case 'issued':
    case 'cancelled':
      return {
        status: 'done',
        message: `Keys ${verb} (${result.keyRefs.length}).`,
        result: { ...result },
        idempotencyKey,
      };
    case 'simulated':
      return {
        status: 'done',
        message: `Keys ${verb} — simulated, nothing real happened (${tx.environment} environment).`,
        result: { ...result },
        idempotencyKey,
      };
    case 'pending':
      return {
        status: 'pending',
        message:
          'The key request is recorded and is sent to the lock system once this step is saved; resume to confirm it.',
        result: { ...result },
        idempotencyKey,
      };
    case 'unavailable':
      return {
        status: 'failed',
        message: `The key system is unavailable${result.message ? ` (${result.message})` : ''}. ${mode === 'issue' ? 'Issue keys' : 'Deactivate the keys'} on the lock console, then confirm the manual fallback here.`,
        result: { ...result },
        idempotencyKey,
      };
  }
}

// ───────────────────────────── check-out steps ─────────────────────────────

async function stepCharges(deps: Deps, tx: TxContext, stay: StayRecord): Promise<Outcome> {
  const folios = await deps.ports.finance.listFolios(tx, {
    propertyId: stay.row.property_id,
    owner: { type: 'stay', id: stay.row.id },
  });
  return {
    status: 'done',
    message: `Reviewed ${folios.length} folio${folios.length === 1 ? '' : 's'}. Outlet charges arriving after departure are accepted as late charges.`,
    result: {
      folios: folios.map((f) => ({ folioId: f.folioId, label: f.label ?? null, balance: f.balance })),
    },
  };
}

async function stepSettle(
  deps: Deps,
  tx: TxContext,
  stay: StayRecord,
  input: CheckOutInputs['settle'],
): Promise<Outcome> {
  const folios = await deps.ports.finance.listFolios(tx, {
    propertyId: stay.row.property_id,
    owner: { type: 'stay', id: stay.row.id },
  });
  const open = folios.filter((f) => f.balance.amountMinor !== 0);
  if (open.length === 0)
    return { status: 'done', message: 'All folios are settled.', result: { folios: folios.length } };
  const detail = open
    .map((f) => `${f.label ?? 'folio'} ${f.balance.amountMinor} ${f.balance.currency} (minor units)`)
    .join(', ');
  if (input?.leaveOpenReason) {
    requirePermission(tx, P.stayCheckoutWithBalance, { propertyId: stay.row.property_id });
    await raiseIssue(tx, {
      propertyId: stay.row.property_id,
      kind: 'departed_with_balance',
      severity: 'routine',
      bookingId: stay.row.booking_id,
      stayId: stay.row.id,
      dedupeKey: `departed_balance:${stay.row.id}`,
      message: `Guest departed with an open balance: ${detail}. Reason: ${input.leaveOpenReason}.`,
      ownerId: tx.actor.kind === 'user' ? tx.actor.userId : null,
      details: { folios: open.map((f) => ({ folioId: f.folioId, balance: f.balance })) },
    });
    return {
      status: 'done',
      message: `Left open with permission: ${detail}.`,
      result: { leftOpen: open.map((f) => f.folioId), reason: input.leaveOpenReason },
    };
  }
  return {
    status: 'failed',
    message: `Open balance: ${detail}. Settle by payment, transfer to a receivables account or another folio, or leave open with permission.`,
    result: { open: open.map((f) => ({ folioId: f.folioId, balance: f.balance })) },
  };
}

// ───────────────────────────── confirm ─────────────────────────────

/** Post an approved early check-in / late check-out fee when the service happens (service date = business date). */
async function postTimeRequestFee(
  deps: Deps,
  tx: TxContext,
  stay: StayRecord,
  kind: 'early_check_in' | 'late_check_out',
  bookingCode: string,
): Promise<void> {
  const approved = (kind === 'early_check_in' ? stay.row.early_check_in : stay.row.late_check_out) as {
    time?: string;
    fee?: Money | null;
  } | null;
  if (!approved?.fee || approved.fee.amountMinor <= 0 || stay.row.commercial_type !== 'standard') return;
  const codes = await chargeCodes(deps, tx, stay.row.property_id);
  const businessDate = await deps.ports.platform.getBusinessDate(tx, stay.row.property_id);
  const ref: EntityRef = { type: 'stay', id: stay.row.id };
  await deps.ports.finance.postCharge(tx, {
    propertyId: stay.row.property_id,
    target: ref,
    chargeCode: kind === 'early_check_in' ? codes.earlyCheckIn : codes.lateCheckOut,
    amount: approved.fee,
    serviceDate: businessDate,
    description: `${kind === 'early_check_in' ? 'Early check-in' : 'Late check-out'} at ${approved.time ?? ''} (booking ${bookingCode})`,
    sourceRef: ref,
    idempotencyKey: `fee:${stay.row.id}:${kind}`,
    taxMode: 'compute',
  });
}

async function confirmCheckIn(
  deps: Deps,
  tx: TxContext,
  stay: StayRecord,
  run: RunRow,
  steps: StepState[],
): Promise<Outcome> {
  const allowPending = await policy(
    deps,
    tx,
    stay.row.property_id,
    'reservations.checkIn.allowPendingPayment',
    false,
  );
  const blocking = blockingSteps(steps).filter(
    (s) => !(allowPending && s.key === 'guarantee' && s.status === 'pending' && s.idempotencyKey),
  );
  if (blocking.length) {
    return {
      status: 'failed',
      message: `Not yet complete: ${blocking.map((s) => stepLabel(s.key)).join(', ')}.`,
    };
  }
  const forwarded = await guardAuthority(deps, tx, {
    propertyId: stay.row.property_id,
    kind: 'check_in',
    payload: { stayId: stay.row.id, runId: run.id },
    bookingId: stay.row.booking_id,
    stayId: stay.row.id,
  });
  if (forwarded) {
    return {
      status: 'pending',
      message: forwarded.message,
      result: { forwardedChangeId: forwarded.forwardedChange.id },
    };
  }
  const booking = await lockBooking(tx, stay.row.booking_id, null);
  const fresh = await loadStay(tx, stay.row.id);
  assertStayTransition(fresh.row.status as StayStatus, 'in_house');
  if (getStep(steps, 'guarantee').status === 'pending') {
    await raiseIssue(tx, {
      propertyId: stay.row.property_id,
      kind: 'payment_follow_up',
      severity: 'urgent',
      bookingId: stay.row.booking_id,
      stayId: stay.row.id,
      dedupeKey: `payment_follow_up:${stay.row.id}`,
      message: `Checked in with the payment pending verification (booking ${booking.code}). Follow up when reconciliation resolves it.`,
      ownerId: tx.actor.kind === 'user' ? tx.actor.userId : null,
    });
  }
  await postTimeRequestFee(deps, tx, fresh, 'early_check_in', booking.code);
  await updateStay(tx, stay.row.id, { status: 'in_house', checked_in_at: tx.now });
  await bumpBooking(tx, booking.id, 'check_in');
  const primary = fresh.occupants.find((o) => o.is_primary && o.profile_id);
  const seg = fresh.segments[0];
  if (primary?.profile_id && seg) {
    await deps.ports.guests.recordStayHistory(tx, {
      profileId: primary.profile_id,
      stayRef: { type: 'stay', id: stay.row.id },
      propertyId: stay.row.property_id,
      bookingId: stay.row.booking_id,
      role: 'occupant',
      arrival: fresh.row.arrival,
      departure: fresh.row.departure,
      unitTypeId: seg.unitTypeId,
      ratePlanId: seg.ratePlanId,
      status: 'in_house',
    });
  }
  const businessDate = await deps.ports.platform.getBusinessDate(tx, stay.row.property_id);
  const unitId = currentUnit(fresh, businessDate);
  await tx.audit({
    action: 'reservations.stay.checkIn',
    target: { type: 'stay', id: stay.row.id },
    propertyId: stay.row.property_id,
    before: { status: 'expected' },
    after: { status: 'in_house', unitId, runId: run.id },
  });
  await emitReservationEvent(tx, {
    type: E.stayCheckedIn,
    propertyId: stay.row.property_id,
    aggregate: { type: 'stay', id: stay.row.id },
    payload: { stayId: stay.row.id, bookingId: booking.id, unitId, businessDate, runId: run.id },
  });
  return { status: 'done', message: 'Guest checked in.', result: { unitId } };
}

async function confirmCheckOut(
  deps: Deps,
  tx: TxContext,
  stay: StayRecord,
  run: RunRow,
  steps: StepState[],
): Promise<Outcome> {
  if (!canConfirm(steps)) {
    return {
      status: 'failed',
      message: `Not yet complete: ${blockingSteps(steps)
        .map((s) => stepLabel(s.key))
        .join(', ')}.`,
    };
  }
  const forwarded = await guardAuthority(deps, tx, {
    propertyId: stay.row.property_id,
    kind: 'check_out',
    payload: { stayId: stay.row.id, runId: run.id },
    bookingId: stay.row.booking_id,
    stayId: stay.row.id,
  });
  if (forwarded)
    return {
      status: 'pending',
      message: forwarded.message,
      result: { forwardedChangeId: forwarded.forwardedChange.id },
    };
  const booking = await lockBooking(tx, stay.row.booking_id, null);
  const fresh = await loadStay(tx, stay.row.id);
  assertStayTransition(fresh.row.status as StayStatus, 'departed');
  const businessDate = await deps.ports.platform.getBusinessDate(tx, stay.row.property_id);
  const ref: EntityRef = { type: 'stay', id: stay.row.id };
  let early: { releasedFrom: string; penalty: Money | null } | null = null;
  // Early departure: release nights from the business date (they were never posted) and apply agreed penalty.
  if (businessDate < fresh.row.departure && businessDate > fresh.row.arrival) {
    const releasedFrom = businessDate;
    await deps.ports.inventory.release(tx, {
      propertyId: stay.row.property_id,
      ref,
      nights: { from: releasedFrom, to: fresh.row.departure },
    });
    if (fresh.segments.some((s) => s.unitId && s.to > releasedFrom)) {
      await deps.ports.inventory.unassignUnit(tx, {
        propertyId: stay.row.property_id,
        ref,
        nights: { from: releasedFrom, to: fresh.row.departure },
      });
    }
    const snaps = await loadSnapshots(
      tx,
      fresh.segments.map((s) => s.termsSnapshotId),
    );
    // The agreed early-departure charge for the nights not stayed, evaluated by rates (R-03).
    const notStayed = eachNight({ from: releasedFrom, to: fresh.row.departure });
    const { amount: penalty } = agreedPenalty(deps, {
      event: 'early_departure',
      at: tx.now,
      currency: booking.currency,
      parts: fresh.segments.map((s) => ({
        terms: snapshotOf(snaps, s.termsSnapshotId),
        nights: notStayed.filter((d) => d >= s.from && d < s.to),
      })),
    });
    if (penalty.amountMinor > 0 && fresh.row.commercial_type === 'standard') {
      await deps.ports.finance.postCharge(tx, {
        propertyId: stay.row.property_id,
        target: ref,
        chargeCode: (await chargeCodes(deps, tx, stay.row.property_id)).earlyDeparture,
        amount: penalty,
        serviceDate: businessDate,
        description: `Early departure charge per agreed terms (booking ${booking.code})`,
        sourceRef: ref,
        idempotencyKey: `penalty:early_departure:${stay.row.id}:${releasedFrom}`,
        taxMode: 'compute',
        reason: `Early departure on business date ${businessDate}`,
      });
    }
    const trimmed = fresh.segments
      .filter((s) => s.from < releasedFrom)
      .map((s) => ({ ...s, to: earlier(s.to, releasedFrom) }));
    await replaceSegments(tx, stay.row.id, trimmed);
    await updateStay(tx, stay.row.id, { departure: releasedFrom });
    // Plan sales mirror inventory (R-15): the nights not stayed stop counting against sales limits.
    await deps.ports.rates.releasePlanSale(tx, {
      ref,
      nights: { from: releasedFrom, to: fresh.row.departure },
    });
    early = { releasedFrom, penalty: penalty.amountMinor > 0 ? penalty : null };
  }
  await postTimeRequestFee(deps, tx, fresh, 'late_check_out', booking.code);
  await updateStay(tx, stay.row.id, { status: 'departed', checked_out_at: tx.now });
  const after = await loadBooking(tx, booking.id);
  const complete = bookingShouldComplete(
    booking.status as BookingStatus,
    after.stays.map((s) => s.row.status as StayStatus),
  );
  await bumpBooking(tx, booking.id, 'check_out', complete ? { status: 'completed' } : {});
  const primary = fresh.occupants.find((o) => o.is_primary && o.profile_id);
  const seg = fresh.segments[0];
  if (primary?.profile_id && seg) {
    await deps.ports.guests.recordStayHistory(tx, {
      profileId: primary.profile_id,
      stayRef: ref,
      propertyId: stay.row.property_id,
      bookingId: stay.row.booking_id,
      role: 'occupant',
      arrival: fresh.row.arrival,
      departure: early?.releasedFrom ?? fresh.row.departure,
      unitTypeId: seg.unitTypeId,
      ratePlanId: seg.ratePlanId,
      status: 'departed',
    });
  }
  const unitId = currentUnit(fresh, businessDate);
  await tx.audit({
    action: 'reservations.stay.checkOut',
    target: { type: 'stay', id: stay.row.id },
    propertyId: stay.row.property_id,
    before: { status: 'in_house', departure: fresh.row.departure },
    after: { status: 'departed', earlyDeparture: early, runId: run.id },
  });
  await emitReservationEvent(tx, {
    type: E.stayCheckedOut,
    propertyId: stay.row.property_id,
    aggregate: { type: 'stay', id: stay.row.id },
    payload: { stayId: stay.row.id, bookingId: booking.id, unitId, businessDate, earlyDeparture: early },
  });
  if (early) {
    await emitReservationEvent(tx, {
      type: E.stayShortened,
      propertyId: stay.row.property_id,
      aggregate: { type: 'stay', id: stay.row.id },
      payload: {
        stayId: stay.row.id,
        bookingId: booking.id,
        from: { departure: fresh.row.departure },
        to: { departure: early.releasedFrom },
      },
    });
  }
  return { status: 'done', message: 'Guest checked out.', result: { unitId, earlyDeparture: early } };
}

// ───────────────────────────── step execution ─────────────────────────────

/**
 * Execute ONE step in the current transaction and persist its outcome. Expected failures (unit not ready,
 * payment declined) are recorded as `failed` and committed; the run stays resumable.
 */
export async function runStep(
  deps: Deps,
  tx: TxContext,
  input: {
    stayId: string;
    kind: WorkflowKind;
    step: StepKey;
    checkIn?: CheckInInputs;
    checkOut?: CheckOutInputs;
  },
): Promise<WorkflowRun> {
  const stay = await loadStay(tx, input.stayId);
  requirePermission(tx, permissionFor(input.kind), { propertyId: stay.row.property_id });
  const run = await activeRun(tx, stay.row.id, input.kind, true);
  if (!run) {
    throw new BusinessRuleError(
      'workflow_not_started',
      `No ${input.kind === 'check_in' ? 'check-in' : 'check-out'} is in progress for this stay. Start it first.`,
    );
  }
  const steps = run.steps as StepState[];
  const step = getStep(steps, input.step);
  if (step.status === 'done' || step.status === 'skipped') return toView(run);
  const businessDate = await deps.ports.platform.getBusinessDate(tx, stay.row.property_id);
  let outcome: Outcome;
  switch (input.step) {
    case 'registration':
      outcome = await stepRegistration(deps, tx, stay, input.checkIn?.registration);
      break;
    case 'unit':
      outcome = await stepUnit(deps, tx, stay, businessDate, input.checkIn?.unit);
      break;
    case 'guarantee':
      outcome = await stepGuarantee(deps, tx, stay, run, step, input.checkIn?.guarantee);
      break;
    case 'deposits':
      outcome = await stepDeposits(deps, tx, stay);
      break;
    case 'access':
      outcome = await stepAccess(
        deps,
        tx,
        await loadStay(tx, stay.row.id),
        run,
        step,
        businessDate,
        input.kind === 'check_in' ? input.checkIn?.access : input.checkOut?.access,
        input.kind === 'check_in' ? 'issue' : 'cancel',
      );
      break;
    case 'charges':
      outcome = await stepCharges(deps, tx, stay);
      break;
    case 'settle':
      outcome = await stepSettle(deps, tx, stay, input.checkOut?.settle);
      break;
    case 'confirm':
      outcome =
        input.kind === 'check_in'
          ? await confirmCheckIn(deps, tx, stay, run, steps)
          : await confirmCheckOut(deps, tx, stay, run, steps);
      break;
  }
  const next = recordStep(steps, input.step, {
    status: outcome.status,
    message: outcome.message,
    result: outcome.result ?? null,
    idempotencyKey: outcome.idempotencyKey ?? null,
    at: tx.now.toISOString(),
  });
  const completed = input.step === 'confirm' && outcome.status === 'done';
  const saved = await saveSteps(tx, run, next, completed ? 'completed' : undefined);
  if (outcome.status === 'failed') {
    await emitReservationEvent(tx, {
      type: E.checkInStepFailed,
      propertyId: stay.row.property_id,
      aggregate: { type: 'stay', id: stay.row.id },
      payload: {
        stayId: stay.row.id,
        runId: run.id,
        kind: input.kind,
        step: input.step,
        message: outcome.message,
      },
    });
  }
  return toView(saved);
}

/** Skip a step with a reason: optional steps freely; mandatory steps need `reservations.stay.skipCheckInStep`. */
export async function skipStep(
  deps: Deps,
  tx: TxContext,
  input: { stayId: string; kind: WorkflowKind; step: StepKey; reason: string },
): Promise<WorkflowRun> {
  void deps;
  const stay = await loadStay(tx, input.stayId);
  requirePermission(tx, permissionFor(input.kind), { propertyId: stay.row.property_id });
  if (input.step === 'confirm')
    throw new ValidationError('cannot_skip_confirm', 'The confirm step cannot be skipped.');
  const run = await activeRun(tx, stay.row.id, input.kind, true);
  if (!run) throw new BusinessRuleError('workflow_not_started', 'Start the workflow before skipping steps.');
  const steps = run.steps as StepState[];
  const step = getStep(steps, input.step);
  if (step.mandatory) requirePermission(tx, P.staySkipCheckInStep, { propertyId: stay.row.property_id });
  const next = recordStep(steps, input.step, {
    status: 'skipped',
    message: `Skipped: ${input.reason}`,
    skipped: { by: actorName(tx), reason: input.reason },
    at: tx.now.toISOString(),
  });
  await tx.audit({
    action: `reservations.${input.kind === 'check_in' ? 'checkIn' : 'checkOut'}.skipStep`,
    target: { type: 'stay', id: stay.row.id },
    propertyId: stay.row.property_id,
    reason: input.reason,
    after: { step: input.step, mandatory: step.mandatory },
  });
  return toView(await saveSteps(tx, run, next));
}

/**
 * Run the workflow as far as it can go, ONE TRANSACTION PER STEP, so an interruption leaves a precise record of
 * which steps succeeded and which remain (brief §6). Stops at the first step that is not done. Unexpected errors
 * (crash, provider outage) roll back only the current step; they are recorded on the step and the run is
 * returned with `interrupted` set, ready to resume.
 */
export async function performWorkflow(
  deps: Deps,
  database: PorticoDatabase,
  ctx: RequestContext,
  input: { stayId: string; kind: WorkflowKind; checkIn?: CheckInInputs; checkOut?: CheckOutInputs },
): Promise<{
  run: WorkflowRun | null;
  interrupted: { step: StepKey; error: { code: string; message: string } } | null;
  forwarded: ForwardedResult | null;
}> {
  const started = await withTenantTx(database, ctx, (tx) =>
    startWorkflow(deps, tx, { stayId: input.stayId, kind: input.kind }),
  );
  if (isForwarded(started)) return { run: null, interrupted: null, forwarded: started };
  let run: WorkflowRun = started;
  const polled = new Set<StepKey>();
  for (;;) {
    const next = run.steps.find((s) => s.status === 'pending' || s.status === 'failed');
    if (!next || run.status !== 'in_progress') break;
    const key = next.key as StepKey;
    const before = next.status;
    const attemptsBefore = next.attempts;
    try {
      run = await withTenantTx(database, ctx, (tx) => runStep(deps, tx, { ...input, step: key }));
    } catch (err) {
      const error =
        err instanceof DomainError
          ? { code: err.code, message: err.message }
          : { code: 'interrupted', message: 'The step was interrupted before it finished.' };
      if (err instanceof DomainError && err.status === 403) throw err;
      run = await withTenantTx(database, ctx, async (tx) => {
        const row = await activeRun(tx, input.stayId, input.kind, true);
        if (!row) return getWorkflow(deps, tx, { stayId: input.stayId, kind: input.kind });
        const steps = (row.steps as StepState[]).map((s) =>
          s.key === key
            ? {
                ...s,
                status: 'failed' as const,
                attempts: s.attempts + 1,
                message: `Interrupted: ${error.message}`,
                updatedAt: tx.now.toISOString(),
              }
            : s,
        );
        return toView(await saveSteps(tx, row, steps));
      });
      return { run, interrupted: { step: key, error }, forwarded: null };
    }
    const after = run.steps.find((s) => s.key === key);
    // Two-phase external steps (payments, keys) settle after their transaction commits: poll each once (R-09/R-11).
    if (after?.status === 'pending' && after.external && !polled.has(key)) {
      polled.add(key);
      continue;
    }
    if (after?.status !== 'done') break;
    if (after.status === before && after.attempts === attemptsBefore) break;
  }
  return { run, interrupted: null, forwarded: null };
}
