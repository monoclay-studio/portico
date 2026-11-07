/**
 * How statuses are shown to staff. The rule (CLAUDE.md §5, brief §9): never "paid" unless the authoritative
 * system confirmed it; pending verification looks pending; recorded-but-unverified looks recorded; simulated
 * and sandbox results say so.
 */
import type { AuthorizationStatus, PaymentRequestStatus, PaymentStatus } from './states';

export type Tone = 'success' | 'pending' | 'failure' | 'neutral' | 'recorded';
export type RecordMode = 'live' | 'sandbox' | 'simulate' | 'recorded';

export interface Presentation {
  label: string;
  tone: Tone;
  explanation: string;
  confirmed: boolean;
}

function modeSuffix(mode: RecordMode): string {
  if (mode === 'simulate') return ' (simulated — no real money)';
  if (mode === 'sandbox') return ' (provider sandbox — test money)';
  return '';
}

export function presentPayment(status: PaymentStatus, mode: RecordMode, method: string): Presentation {
  const s = modeSuffix(mode);
  switch (status) {
    case 'processing':
      return {
        label: `Sending to the provider${s}`,
        tone: 'pending',
        explanation: 'The request has been recorded and is being sent. Do not charge again.',
        confirmed: false,
      };
    case 'pending_verification':
      return {
        label: `Pending verification${s}`,
        tone: 'pending',
        explanation:
          'We did not get a definite answer from the payment provider. Portico is checking with the provider and will update this automatically. Do NOT charge again — the guest may already have paid.',
        confirmed: false,
      };
    case 'succeeded':
      return {
        label: `Paid${s}`,
        tone: 'success',
        explanation: 'The payment provider confirmed the money was collected.',
        confirmed: true,
      };
    case 'failed':
      return {
        label: `Not paid${s}`,
        tone: 'failure',
        explanation: 'The payment did not go through. Nothing was collected.',
        confirmed: true,
      };
    case 'recorded_unverified':
      return {
        label: 'Recorded — not yet verified',
        tone: 'recorded',
        explanation:
          method === 'cash'
            ? 'Recorded by staff. It is verified when matched to the cash deposit or cashier count.'
            : method === 'bank_transfer'
              ? 'Recorded by staff from the bank reference. It is verified when matched to the bank statement.'
              : "Recorded by staff from the hotel's own terminal. It is verified when matched to the acquirer's settlement statement.",
        confirmed: false,
      };
    case 'recorded_verified':
      return {
        label: 'Recorded — verified against statement',
        tone: 'success',
        explanation: 'Matched to a settlement or bank statement line.',
        confirmed: true,
      };
  }
}

export function presentRefund(status: PaymentStatus, mode: RecordMode): Presentation {
  const p = presentPayment(status, mode, 'card');
  if (status === 'succeeded')
    return { ...p, label: `Refunded${modeSuffix(mode)}`, explanation: 'The provider confirmed the refund.' };
  if (status === 'failed') {
    return {
      ...p,
      label: `Refund failed${modeSuffix(mode)}`,
      explanation: 'The refund did not go through. No money left the hotel.',
    };
  }
  if (status === 'pending_verification') {
    return {
      ...p,
      explanation:
        'We did not get a definite answer from the provider. Portico is checking. Do NOT refund again — the guest may already have been refunded.',
    };
  }
  return p;
}

export function presentAuthorization(status: AuthorizationStatus, mode: RecordMode): Presentation {
  const s = modeSuffix(mode);
  const hold = 'An authorization is a hold on the card, not a payment.';
  switch (status) {
    case 'processing':
      return { label: `Requesting hold${s}`, tone: 'pending', explanation: hold, confirmed: false };
    case 'pending_verification':
      return {
        label: `Hold pending verification${s}`,
        tone: 'pending',
        explanation: `${hold} We are confirming the outcome with the provider; do not request another hold.`,
        confirmed: false,
      };
    case 'authorized':
      return {
        label: mode === 'recorded' ? 'Hold recorded (own terminal)' : `Hold active${s}`,
        tone: mode === 'recorded' ? 'recorded' : 'neutral',
        explanation: hold,
        confirmed: mode !== 'recorded',
      };
    case 'partially_captured':
      return {
        label: `Partly collected; remaining hold active${s}`,
        tone: 'neutral',
        explanation: hold,
        confirmed: true,
      };
    case 'captured':
      return {
        label: `Collected${s}`,
        tone: 'success',
        explanation: 'The held funds were collected.',
        confirmed: true,
      };
    case 'voided':
      return {
        label: `Hold released${s}`,
        tone: 'neutral',
        explanation: 'The hold was released.',
        confirmed: true,
      };
    case 'expired':
      return {
        label: 'Hold expired',
        tone: 'failure',
        explanation:
          'The hold has expired and no longer guarantees payment. Take a new authorization or payment.',
        confirmed: true,
      };
    case 'failed':
      return {
        label: `Hold declined${s}`,
        tone: 'failure',
        explanation: 'No funds are held.',
        confirmed: true,
      };
  }
}

export function presentRequest(status: PaymentRequestStatus, paidMinor: number): Presentation {
  switch (status) {
    case 'open':
      return {
        label: 'Waiting for the guest',
        tone: 'pending',
        explanation: 'Sent or ready to send. Nothing has been paid yet.',
        confirmed: false,
      };
    case 'partially_paid':
      return {
        label: 'Partly paid',
        tone: 'pending',
        explanation: `Provider-confirmed payments so far: ${paidMinor} (minor units).`,
        confirmed: true,
      };
    case 'paid':
      return {
        label: 'Paid',
        tone: 'success',
        explanation: 'The provider confirmed the payment.',
        confirmed: true,
      };
    case 'expired':
      return {
        label: 'Expired',
        tone: 'failure',
        explanation: 'The link expired before it was paid.',
        confirmed: true,
      };
    case 'cancelled':
      return { label: 'Cancelled', tone: 'neutral', explanation: 'Cancelled by staff.', confirmed: true };
  }
}
