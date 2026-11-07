/**
 * Decline and failure explanations. Staff must always learn (1) what happened in plain language and (2) what
 * to do next. Codes follow the common issuer/PSP vocabulary (Stripe decline codes are a superset most PSPs map
 * to). Messages never accuse the guest of fraud: "fraud-suspected" declines say the card cannot be used.
 */

export type DeclineCategory =
  | 'soft' // temporary; the same card may work later
  | 'hard' // do not retry this card
  | 'authentication_required' // the guest must authenticate (3-D Secure) on their own device
  | 'fraud_suspected' // issuer blocked; ask for another method, never retry
  | 'funding_delay' // virtual card not yet funded; retry on schedule
  | 'configuration'; // the hotel's account/method setup needs attention

export interface DeclineExplanation {
  code: string;
  category: DeclineCategory;
  /** What happened, in plain language. */
  message: string;
  /** What staff can do now. */
  recovery: string;
  /** Whether retrying the SAME method later may succeed. */
  retryable: boolean;
}

const ALTERNATIVES = 'take another card, accept cash, or send the guest a payment link';

const TABLE: Record<string, Omit<DeclineExplanation, 'code'>> = {
  insufficient_funds: {
    category: 'soft',
    message: 'Card declined — insufficient funds.',
    recovery: `Ask the guest for another card or a smaller amount; you can also ${ALTERNATIVES}.`,
    retryable: true,
  },
  card_velocity_exceeded: {
    category: 'soft',
    message: 'Card declined — the card has reached its spending limit for now.',
    recovery: `Ask the guest to contact their bank, or ${ALTERNATIVES}.`,
    retryable: true,
  },
  withdrawal_count_limit_exceeded: {
    category: 'soft',
    message: 'Card declined — too many transactions on this card today.',
    recovery: `Ask the guest to contact their bank, or ${ALTERNATIVES}.`,
    retryable: true,
  },
  try_again_later: {
    category: 'soft',
    message: 'The card network could not process the payment right now.',
    recovery: 'Wait a few minutes and try once more with a NEW attempt, or use another payment method.',
    retryable: true,
  },
  processing_error: {
    category: 'soft',
    message: 'The card network reported a temporary processing error.',
    recovery: 'Wait a few minutes and try once more with a NEW attempt, or use another payment method.',
    retryable: true,
  },
  issuer_not_available: {
    category: 'soft',
    message: "The guest's bank could not be reached.",
    recovery: `Try again in a few minutes, or ${ALTERNATIVES}.`,
    retryable: true,
  },
  do_not_honor: {
    category: 'hard',
    message: "Card declined by the guest's bank without a reason.",
    recovery: `Ask the guest to contact their bank; meanwhile ${ALTERNATIVES}.`,
    retryable: false,
  },
  generic_decline: {
    category: 'hard',
    message: "Card declined by the guest's bank without a reason.",
    recovery: `Ask the guest to contact their bank; meanwhile ${ALTERNATIVES}.`,
    retryable: false,
  },
  expired_card: {
    category: 'hard',
    message: 'Card declined — the card has expired.',
    recovery: `Ask the guest for a current card, or ${ALTERNATIVES}.`,
    retryable: false,
  },
  card_not_supported: {
    category: 'hard',
    message: 'This type of card cannot be used for this payment.',
    recovery: `Ask the guest for another card, or ${ALTERNATIVES}.`,
    retryable: false,
  },
  currency_not_supported: {
    category: 'configuration',
    message: 'The card or the hotel account does not support this currency.',
    recovery: 'Charge in a supported currency or use another payment method; finance can review the account currencies.',
    retryable: false,
  },
  invalid_account: {
    category: 'hard',
    message: 'The card account is no longer valid.',
    recovery: `Ask the guest for another card, or ${ALTERNATIVES}.`,
    retryable: false,
  },
  lost_card: {
    category: 'fraud_suspected',
    message: 'This card cannot be used.',
    recovery: `Do not retry this card. Politely ask for another payment method: ${ALTERNATIVES}.`,
    retryable: false,
  },
  stolen_card: {
    category: 'fraud_suspected',
    message: 'This card cannot be used.',
    recovery: `Do not retry this card. Politely ask for another payment method: ${ALTERNATIVES}.`,
    retryable: false,
  },
  pickup_card: {
    category: 'fraud_suspected',
    message: 'This card cannot be used.',
    recovery: `Do not retry this card. Politely ask for another payment method: ${ALTERNATIVES}.`,
    retryable: false,
  },
  fraudulent: {
    category: 'fraud_suspected',
    message: 'The payment was blocked by the card network.',
    recovery: `Do not retry this card. Politely ask for another payment method: ${ALTERNATIVES}.`,
    retryable: false,
  },
  authentication_required: {
    category: 'authentication_required',
    message: "The guest's bank requires the guest to confirm this payment (3-D Secure).",
    recovery:
      'Send the guest a payment link so they can confirm on their own device, or take the card on the terminal with the guest present.',
    retryable: false,
  },
  vcc_not_funded: {
    category: 'funding_delay',
    message: 'The virtual card has not been funded by the booking channel yet.',
    recovery:
      'Nothing to do now: Portico retries automatically on schedule. If it still fails, contact the channel about the virtual card.',
    retryable: true,
  },
  provider_unavailable: {
    category: 'soft',
    message: 'Card payments are unavailable right now: the payment provider cannot be reached. Nothing was charged.',
    recovery:
      'Accept cash, send a payment link to use later, or take the card on your own terminal and record it in Portico (manual authorization or recorded payment).',
    retryable: true,
  },
  provider_not_configured: {
    category: 'configuration',
    message: 'This payment account is not connected to its provider yet. Nothing was charged.',
    recovery: 'Use another payment method; an administrator must complete the payment account setup.',
    retryable: false,
  },
  account_restricted: {
    category: 'configuration',
    message: "The hotel's payment account is restricted by the provider. Nothing was charged.",
    recovery: 'Use cash, a payment link from another account, or your own terminal; finance must resolve the account.',
    retryable: false,
  },
  not_received_by_provider: {
    category: 'soft',
    message: 'The payment provider confirmed it never received this payment. Nothing was charged.',
    recovery: 'Start a new payment if the guest still owes this amount.',
    retryable: true,
  },
  expired_before_sending: {
    category: 'soft',
    message: 'The request was not sent to the provider in time and was cancelled. Nothing was charged.',
    recovery: 'Start the payment again if the guest still owes this amount.',
    retryable: true,
  },
  invalid_state: {
    category: 'configuration',
    message: 'The provider says this transaction can no longer be changed this way. Nothing was charged.',
    recovery: 'Refresh the record to see its current state, then choose another action.',
    retryable: false,
  },
  resource_missing: {
    category: 'configuration',
    message: 'The provider does not know the original transaction. Nothing was charged.',
    recovery: 'Check the transaction in the provider dashboard; contact support with the reference.',
    retryable: false,
  },
  amount_too_large: {
    category: 'configuration',
    message: 'The amount is more than the provider allows for this transaction. Nothing was charged.',
    recovery: 'Use a smaller amount, or take the difference as a separate payment.',
    retryable: false,
  },
  environment_mismatch: {
    category: 'configuration',
    message: 'The provider answered in a different mode (live/test) than this environment allows.',
    recovery: 'Contact support: the provider credentials for this environment are misconfigured.',
    retryable: false,
  },
  idempotency_conflict: {
    category: 'configuration',
    message: 'The provider saw this request reference with different details and refused it. Nothing was charged.',
    recovery: 'Start a new payment; contact support with the reference if it happens again.',
    retryable: false,
  },
  charge_already_refunded: {
    category: 'hard',
    message: 'The provider says this payment was already refunded.',
    recovery: 'Check the payment’s refunds; no further refund is possible.',
    retryable: false,
  },
  refund_failed: {
    category: 'hard',
    message: 'The provider could not return the money to the card.',
    recovery: 'Refund the guest another way (bank transfer or cash) and record it.',
    retryable: false,
  },
  invalid_request: {
    category: 'configuration',
    message: 'The payment provider rejected the request as invalid. Nothing was charged.',
    recovery: 'Check the amount, currency and payment method; contact support with the reference if it persists.',
    retryable: false,
  },
};

const FALLBACK: Omit<DeclineExplanation, 'code'> = {
  category: 'hard',
  message: "Card declined by the guest's bank.",
  recovery: `Ask the guest for another card or ${ALTERNATIVES}.`,
  retryable: false,
};

export function explainDecline(code: string | undefined | null): DeclineExplanation {
  const normalized = (code ?? 'generic_decline').trim().toLowerCase();
  const entry = TABLE[normalized] ?? FALLBACK;
  return { code: normalized, ...entry };
}

export function isKnownDeclineCode(code: string): boolean {
  return code in TABLE;
}
