import type { ChargeGroup, PaymentMethodKind } from './types';

export type AccountType = 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';

export interface AccountTemplate {
  code: string;
  name: string;
  type: AccountType;
  systemKey: string;
}

/**
 * Default hospitality chart of accounts (USALI-inspired: rooms, F&B, other operated departments, balance-sheet
 * counterparts). Seeded per legal entity; hotels may add accounts and remap charge codes. Account codes are
 * suggestions — the system keys are what posting logic relies on.
 */
export const DEFAULT_CHART: readonly AccountTemplate[] = [
  // Assets
  { code: '1000', name: 'Cash drawers', type: 'asset', systemKey: 'cash' },
  { code: '1010', name: 'Bank', type: 'asset', systemKey: 'bank' },
  { code: '1100', name: 'Guest ledger (folio receivables)', type: 'asset', systemKey: 'guest_ledger' },
  { code: '1200', name: 'City ledger (receivables accounts)', type: 'asset', systemKey: 'receivables' },
  { code: '1300', name: 'Card clearing', type: 'asset', systemKey: 'card_clearing' },
  { code: '1350', name: 'Payout clearing (in transit to bank)', type: 'asset', systemKey: 'payout_clearing' },
  { code: '1360', name: 'Other payment clearing', type: 'asset', systemKey: 'payment_clearing' },
  {
    code: '1370',
    name: 'Disputed card funds (withheld by provider)',
    type: 'asset',
    systemKey: 'disputed_funds',
  },
  { code: '1900', name: 'Currency position (FX trading)', type: 'asset', systemKey: 'fx_position' },
  // Tax already declared on deposits at receipt (time of supply); released when the deposit is applied,
  // refunded or forfeited so that no supply is taxed twice.
  { code: '1950', name: 'Tax declared on deposits', type: 'asset', systemKey: 'deposit_tax_declared' },
  // Liabilities
  { code: '2100', name: 'Deposits held (advance deposits)', type: 'liability', systemKey: 'deposits_held' },
  { code: '2200', name: 'TGST payable', type: 'liability', systemKey: 'tax:tgst' },
  { code: '2210', name: 'Green tax payable', type: 'liability', systemKey: 'tax:green_tax' },
  { code: '2220', name: 'Service charge payable', type: 'liability', systemKey: 'tax:service_charge' },
  { code: '2290', name: 'Taxes payable (unmapped — review)', type: 'liability', systemKey: 'tax:unmapped' },
  { code: '2300', name: 'Allowance clearing', type: 'liability', systemKey: 'allowance_clearing' },
  { code: '2400', name: 'Commissions payable', type: 'liability', systemKey: 'commissions_payable' },
  {
    code: '2450',
    name: 'Gratuities payable to staff (outside the tax base)',
    type: 'liability',
    systemKey: 'gratuities_payable',
  },
  { code: '2900', name: 'Migration suspense', type: 'liability', systemKey: 'migration_suspense' },
  { code: '2950', name: 'Suspense', type: 'liability', systemKey: 'suspense' },
  // Equity
  { code: '3000', name: 'Opening balance equity', type: 'equity', systemKey: 'opening_balance_equity' },
  // Revenue
  { code: '4000', name: 'Room revenue', type: 'revenue', systemKey: 'revenue:room' },
  { code: '4050', name: 'Package revenue (unallocated)', type: 'revenue', systemKey: 'revenue:package' },
  { code: '4100', name: 'Food revenue', type: 'revenue', systemKey: 'revenue:food' },
  { code: '4150', name: 'Beverage revenue', type: 'revenue', systemKey: 'revenue:beverage' },
  { code: '4200', name: 'Spa revenue', type: 'revenue', systemKey: 'revenue:spa' },
  { code: '4300', name: 'Activities revenue', type: 'revenue', systemKey: 'revenue:activity' },
  { code: '4400', name: 'Transfers revenue', type: 'revenue', systemKey: 'revenue:transfer' },
  { code: '4500', name: 'Retail revenue', type: 'revenue', systemKey: 'revenue:retail' },
  { code: '4550', name: 'Minibar revenue', type: 'revenue', systemKey: 'revenue:minibar' },
  { code: '4600', name: 'Other operated departments', type: 'revenue', systemKey: 'revenue:misc' },
  { code: '4700', name: 'Fees revenue', type: 'revenue', systemKey: 'revenue:fee' },
  { code: '4800', name: 'Cancellation and no-show revenue', type: 'revenue', systemKey: 'revenue:penalty' },
  { code: '4900', name: 'Allowance breakage', type: 'revenue', systemKey: 'revenue:breakage' },
  // Expenses
  { code: '6000', name: 'Payment processing fees', type: 'expense', systemKey: 'payment_fees' },
  { code: '6100', name: 'Foreign exchange gains and losses', type: 'expense', systemKey: 'fx_gain_loss' },
  { code: '6200', name: 'Rounding differences', type: 'expense', systemKey: 'rounding' },
  { code: '6300', name: 'Bad debt', type: 'expense', systemKey: 'bad_debt' },
  { code: '6400', name: 'Cash over and short', type: 'expense', systemKey: 'cash_over_short' },
];

/** Default revenue account for a charge group (allowance-group codes credit allowance clearing, not revenue). */
export function revenueKeyForGroup(group: ChargeGroup): string {
  if (group === 'allowance') return 'allowance_clearing';
  if (group === 'gratuity') return 'gratuities_payable';
  return `revenue:${group}`;
}

/** Ledger account (system key) that receives money for a payment method. Card clearing is per provider. */
export function clearingKeyForMethod(method: PaymentMethodKind, provider?: string | null): string {
  switch (method) {
    case 'card':
    case 'virtual_card':
    case 'payment_link':
    case 'external_terminal':
    case 'wallet':
      return provider ? `card_clearing:${normalizeKeyPart(provider)}` : 'card_clearing';
    case 'cash':
      return 'cash';
    case 'bank_transfer':
    case 'cheque':
      return 'bank';
    case 'other':
      return 'payment_clearing';
  }
}

/** Tax account key from the tax engine's ledger mapping key. */
export function taxAccountKey(mappingKey: string | null | undefined): string {
  return mappingKey ? `tax:${normalizeKeyPart(mappingKey)}` : 'tax:unmapped';
}

export function normalizeKeyPart(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_');
}

/** Template for a derived account created on demand (e.g. card clearing per provider). */
export function derivedAccountTemplate(systemKey: string): AccountTemplate | null {
  const [base, part] = systemKey.split(':');
  if (base === 'card_clearing' && part) {
    return { code: `1300-${part}`.slice(0, 40), name: `Card clearing — ${part}`, type: 'asset', systemKey };
  }
  if (base === 'tax' && part) {
    return {
      code: `2200-${part}`.slice(0, 40),
      name: `Tax payable — ${part.replace(/_/g, ' ')}`,
      type: 'liability',
      systemKey,
    };
  }
  return null;
}
