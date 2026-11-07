import type { LocalDate } from '@portico/kernel';

export const CHARGE_GROUPS = [
  'room',
  'package',
  'food',
  'beverage',
  'spa',
  'activity',
  'transfer',
  'retail',
  'minibar',
  'fee',
  'penalty',
  'misc',
  'allowance',
  'gratuity',
] as const;
export type ChargeGroup = (typeof CHARGE_GROUPS)[number];

export const OWNER_TYPES = ['stay', 'booking', 'group', 'company', 'house'] as const;
export type FolioOwnerType = (typeof OWNER_TYPES)[number];
export type RuleOwnerType = 'stay' | 'booking' | 'group';

export const PAYER_TYPES = ['guest', 'company', 'agency', 'house'] as const;
export type PayerType = (typeof PAYER_TYPES)[number];

export type FolioStatus = 'open' | 'settled' | 'closed' | 'voided';

export type PostingKind =
  | 'charge'
  | 'tax'
  | 'allowance_usage'
  | 'payment'
  | 'refund'
  | 'deposit_application'
  | 'transfer_in'
  | 'transfer_out'
  | 'adjustment'
  | 'write_off'
  | 'paid_out'
  | 'receivables_transfer'
  | 'allowance_return'
  | 'opening_balance';

export type EntryType =
  | 'charge'
  | 'payment'
  | 'refund'
  | 'deposit'
  | 'deposit_application'
  | 'deposit_refund'
  | 'deposit_forfeit'
  | 'transfer'
  | 'adjustment'
  | 'allowance_grant'
  | 'allowance_close'
  | 'payout'
  | 'fx_settlement'
  | 'cash_variance'
  | 'paid_out'
  | 'receivables_transfer'
  | 'receivables_payment'
  | 'write_off'
  | 'opening_balance';

export const PAYMENT_METHODS = [
  'card',
  'virtual_card',
  'wallet',
  'cash',
  'bank_transfer',
  'cheque',
  'other',
] as const;
export type PaymentMethodKind = (typeof PAYMENT_METHODS)[number];

/** Which charges a billing rule selects. Empty code and group lists = every charge. */
export interface RuleSelector {
  chargeCodes?: readonly string[];
  chargeGroups?: readonly ChargeGroup[];
  /** Inclusive start of service dates. */
  serviceDateFrom?: LocalDate;
  /** Exclusive end of service dates. */
  serviceDateTo?: LocalDate;
  /** 0 = Sunday … 6 = Saturday. Empty/absent = every day. */
  daysOfWeek?: readonly number[];
}

/**
 * Optional limit on what the rule's destination folio pays. Amounts apply to the charge total including taxes
 * (gross). Whatever exceeds the limit goes to the owner's default folio.
 */
export type RuleCap =
  | { kind: 'per_night'; amountMinor: number; currency: string }
  | { kind: 'per_stay'; amountMinor: number; currency: string }
  | { kind: 'percent'; percent: string };
