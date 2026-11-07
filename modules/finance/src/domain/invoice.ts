/**
 * Pure invoice composition (tax invoice particulars). Categories follow the Maldives rules recorded in
 * docs/readiness/maldives-tax-rules.md, expressed generically:
 *  - value: goods/services before tax; service charge is INSIDE the GST base (value before tax);
 *  - tax: GST-type taxes charged;
 *  - levy: per-person levies such as Green Tax, stated as their own lines and outside the GST base;
 *  - outside: gratuities and disbursements (paid-outs), outside the tax base;
 *  - prepayment: an untaxed allowance credit bought with a package (ADR-0016 §5 `prepayment` treatment) — owed by
 *    the guest but not a supply, so outside value before tax;
 *  - settlement: payments, deposits applied, refunds, prepaid-credit usage, receivables transfers.
 * With the default `taxed_at_grant` treatment the allowance is part of the package's value (taxed once) and
 * consumption covered by it appears with negative value/tax lines ("covered by the package"), never twice.
 */
export type InvoiceCategory =
  | 'value'
  | 'service_charge'
  | 'tax'
  | 'levy'
  | 'outside'
  | 'prepayment'
  | 'settlement';

export interface InvoiceItem {
  postingId: string;
  category: InvoiceCategory;
  description: string;
  chargeCode: string | null;
  date: string | null;
  quantity: string | null;
  amountMinor: number;
  taxName: string | null;
  taxRate: string | null;
  taxRuleId: string | null;
}

export interface InvoiceTotals {
  valueBeforeTaxMinor: number;
  serviceChargeMinor: number;
  taxChargedMinor: number;
  leviesMinor: number;
  outsideTaxBaseMinor: number;
  totalMinor: number;
  /** Untaxed prepaid credits sold with a package (owed, not a supply). */
  prepaymentsMinor: number;
  settlementsMinor: number;
  balanceDueMinor: number;
}

export function categorize(input: {
  kind: string;
  effectiveKind: string;
  taxKind: string | null;
  chargeGroup: string | null;
}): InvoiceCategory {
  const k = input.effectiveKind;
  if (k === 'prepayment') return 'prepayment';
  if (
    [
      'payment',
      'refund',
      'deposit_application',
      'allowance_usage',
      'allowance_return',
      'receivables_transfer',
      'write_off',
    ].includes(k)
  ) {
    return 'settlement';
  }
  if (k === 'tax') {
    if (input.taxKind === 'fee') return 'levy';
    if (input.taxKind === 'service_charge') return 'service_charge';
    return 'tax';
  }
  if (k === 'paid_out' || input.chargeGroup === 'gratuity') return 'outside';
  return 'value';
}

export function invoiceTotals(items: readonly InvoiceItem[]): InvoiceTotals {
  const sum = (c: InvoiceCategory) =>
    items.filter((i) => i.category === c).reduce((s, i) => s + i.amountMinor, 0);
  const value = sum('value');
  const sc = sum('service_charge');
  const tax = sum('tax');
  const levy = sum('levy');
  const outside = sum('outside');
  const settlements = sum('settlement');
  const prepayments = sum('prepayment');
  const total = value + sc + tax + levy + outside;
  return {
    valueBeforeTaxMinor: value + sc,
    serviceChargeMinor: sc,
    taxChargedMinor: tax,
    leviesMinor: levy,
    outsideTaxBaseMinor: outside,
    totalMinor: total,
    prepaymentsMinor: prepayments,
    settlementsMinor: settlements,
    balanceDueMinor: total + prepayments + settlements,
  };
}

export interface TaxSummaryLine {
  name: string;
  category: 'tax' | 'levy' | 'service_charge';
  rate: string | null;
  amountMinor: number;
}

export function taxSummary(items: readonly InvoiceItem[]): TaxSummaryLine[] {
  const map = new Map<string, TaxSummaryLine>();
  for (const i of items) {
    if (i.category !== 'tax' && i.category !== 'levy' && i.category !== 'service_charge') continue;
    const key = `${i.category}|${i.taxName}|${i.taxRate}`;
    const cur = map.get(key) ?? {
      name: i.taxName ?? i.description,
      category: i.category,
      rate: i.taxRate,
      amountMinor: 0,
    };
    cur.amountMinor += i.amountMinor;
    map.set(key, cur);
  }
  return [...map.values()].sort(
    (a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name),
  );
}
