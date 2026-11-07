import type { GuaranteeKind, PaymentStatusValue, UnitCondition } from '../ports';

/**
 * Arrival readiness (brief §6, vision "07:30 arrivals rush"): composed from DISTINCT facts — assignment
 * (reservations/inventory), unit condition (operations), payment status (payments), registration and requests —
 * never merged into one status field. Exactly one blocking reason is surfaced per arrival: the first in the order
 * the desk has to clear them.
 */
export type ReadinessKey = 'unit_assigned' | 'unit_ready' | 'payment_secured' | 'registration' | 'requests';

export interface ReadinessCheck {
  key: ReadinessKey;
  status: 'ok' | 'blocking' | 'unknown';
  message: string;
}

export interface ReadinessInput {
  assignedUnitId: string | null;
  unitName?: string | null;
  /** null = not applicable (no unit), 'unknown' = operations could not tell us. */
  unitCondition: UnitCondition | 'unknown' | null;
  requiredCondition: UnitCondition;
  guaranteeKind: GuaranteeKind;
  /** Whether the agreed terms require a card/deposit guarantee before arrival. */
  guaranteeRequired: boolean;
  paymentStatus: PaymentStatusValue | 'unknown';
  /**
   * UX FD-15 (review P2-1): the viewer may not see payment state. The payment check is shown as `unknown` with a
   * plain message and does not count towards `ready` / `blockingReason` (housekeeping must not infer who has paid).
   */
  paymentRedacted?: string;
  registrationComplete: boolean;
  openRequests: number;
}

export interface Readiness {
  ready: boolean;
  checks: ReadinessCheck[];
  blockingReason: { key: ReadinessKey; message: string } | null;
}

const CONDITION_RANK: Record<UnitCondition, number> = {
  failed_inspection: 0,
  dirty: 1,
  cleaning: 2,
  clean: 3,
  inspected: 4,
};

/** Does `actual` meet the required condition (inspected ≥ clean ≥ cleaning ≥ dirty; failed never meets)? */
export function conditionMeets(actual: UnitCondition, required: UnitCondition): boolean {
  if (actual === 'failed_inspection') return false;
  return CONDITION_RANK[actual] >= CONDITION_RANK[required];
}

const CONTRACT_GUARANTEES: readonly GuaranteeKind[] = ['company', 'agency', 'prepaid_channel'];

export function paymentSecured(input: {
  guaranteeKind: GuaranteeKind;
  guaranteeRequired: boolean;
  paymentStatus: PaymentStatusValue | 'unknown';
}): ReadinessCheck {
  const { guaranteeKind, guaranteeRequired, paymentStatus } = input;
  if (CONTRACT_GUARANTEES.includes(guaranteeKind)) {
    return {
      key: 'payment_secured',
      status: 'ok',
      message: `Guaranteed by ${guaranteeKind.replace('_', ' ')}.`,
    };
  }
  switch (paymentStatus) {
    case 'authorized':
      return { key: 'payment_secured', status: 'ok', message: 'Card authorized (not yet charged).' };
    case 'paid':
      return { key: 'payment_secured', status: 'ok', message: 'Payment received.' };
    case 'partially_paid':
      return {
        key: 'payment_secured',
        status: 'ok',
        message: 'Part payment received and a card authorization is held.',
      };
    case 'pending_verification':
      return {
        key: 'payment_secured',
        status: 'blocking',
        message:
          'Payment outcome is pending verification — do not take payment again; reconciliation will resolve it.',
      };
    case 'failed':
      return {
        key: 'payment_secured',
        status: 'blocking',
        message: 'The last card authorization was declined. Ask for another card or payment method.',
      };
    case 'refunded':
      return guaranteeRequired
        ? {
            key: 'payment_secured',
            status: 'blocking',
            message: 'The payment was refunded; no guarantee is held now.',
          }
        : { key: 'payment_secured', status: 'ok', message: 'No guarantee required.' };
    case 'unknown':
      return {
        key: 'payment_secured',
        status: 'unknown',
        message: 'Payment status is unavailable right now.',
      };
    case 'none':
      return guaranteeRequired
        ? { key: 'payment_secured', status: 'blocking', message: 'No card authorization or deposit yet.' }
        : { key: 'payment_secured', status: 'ok', message: 'No guarantee required by the agreed terms.' };
  }
}

export function composeReadiness(input: ReadinessInput): Readiness {
  const checks: ReadinessCheck[] = [];
  if (!input.assignedUnitId) {
    checks.push({ key: 'unit_assigned', status: 'blocking', message: 'No unit assigned yet.' });
    checks.push({ key: 'unit_ready', status: 'blocking', message: 'Assign a unit to see its condition.' });
  } else {
    const label = input.unitName ?? 'The unit';
    checks.push({ key: 'unit_assigned', status: 'ok', message: `${label} assigned.` });
    const c = input.unitCondition;
    if (c === null || c === 'unknown') {
      checks.push({
        key: 'unit_ready',
        status: 'unknown',
        message: `${label}: condition unavailable — check with housekeeping.`,
      });
    } else if (conditionMeets(c, input.requiredCondition)) {
      checks.push({ key: 'unit_ready', status: 'ok', message: `${label} is ${c.replace('_', ' ')}.` });
    } else {
      checks.push({
        key: 'unit_ready',
        status: 'blocking',
        message:
          c === 'failed_inspection'
            ? `${label} failed inspection — choose another ready unit or re-task housekeeping.`
            : `${label} is ${c} (needs to be ${input.requiredCondition}).`,
      });
    }
  }
  checks.push(
    input.paymentRedacted
      ? { key: 'payment_secured', status: 'unknown', message: input.paymentRedacted }
      : paymentSecured(input),
  );
  checks.push(
    input.registrationComplete
      ? { key: 'registration', status: 'ok', message: 'Required guest details are complete.' }
      : { key: 'registration', status: 'blocking', message: 'Required guest details are missing.' },
  );
  checks.push(
    input.openRequests === 0
      ? { key: 'requests', status: 'ok', message: 'No open requests.' }
      : {
          key: 'requests',
          status: 'blocking',
          message: `${input.openRequests} request${input.openRequests === 1 ? '' : 's'} not yet prepared.`,
        },
  );
  const blocking =
    checks.find((c) => c.status !== 'ok' && !(input.paymentRedacted && c.key === 'payment_secured')) ?? null;
  return {
    ready: blocking === null,
    checks,
    blockingReason: blocking ? { key: blocking.key, message: blocking.message } : null,
  };
}
