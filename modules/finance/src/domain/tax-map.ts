import type { Money } from '@portico/kernel';
import type { RatesTaxLine } from '../ports';

/**
 * A tax as finance posts it. `kind` is the INVOICE treatment:
 *  - 'tax'            GST-type tax charged (e.g. TGST) — the "tax charged" total;
 *  - 'service_charge' a percentage fee inside the GST base (e.g. the 10% service charge);
 *  - 'fee'            a quantity-based levy stated separately and outside the GST base (e.g. Green Tax).
 */
export interface PostingTax {
  lineId: string;
  ruleId: string;
  ruleVersionId: string;
  name: string;
  kind: 'tax' | 'fee' | 'service_charge';
  /** Finance ledger key (account `tax:<key>`), e.g. 'tgst', 'green_tax', 'service_charge'. */
  accountKey: string;
  rate?: string;
  amount: Money;
  units?: number;
  exemptUnits?: number;
  rateCategory?: string;
  statutory: boolean;
  valueBased: boolean;
}

const QUANTITY_BASED = new Set(['per_person_night', 'per_unit_night', 'per_stay', 'fixed_per_charge']);

/** Rates' `ledgerMappingKey` ('tax.tgst', 'fee.service_charge') → finance tax account key ('tgst', 'service_charge'). */
export function normalizeLedgerKey(key: string): string {
  return key
    .replace(/^(tax|fee|levy)[.:]/i, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_');
}

/**
 * Map one rates tax line to finance's posting treatment. Rates' `category` is a reporting split (tax vs fee) and
 * does not say how an invoice must state the line: in the Maldives pack service charge is a `fee` inside the GST
 * base and Green Tax a `tax` levied per person-night outside it. The basis decides.
 */
export function fromRatesTaxLine(t: RatesTaxLine): PostingTax {
  const valueBased = !QUANTITY_BASED.has(t.basis);
  const kind: PostingTax['kind'] = !valueBased ? 'fee' : t.category === 'fee' ? 'service_charge' : 'tax';
  const q = t.quantity;
  const units = q
    ? t.basis === 'per_person_night'
      ? q.persons * q.nights
      : t.basis === 'per_unit_night'
        ? q.units * q.nights
        : q.units
    : undefined;
  const exemptUnits = q && t.basis === 'per_person_night' ? q.exemptPersons * q.nights : undefined;
  const rate = t.ratePercent
    ? `${t.ratePercent}%`
    : t.fixedAmount
      ? `${t.fixedAmount.currency} ${t.fixedAmount.value}`
      : undefined;
  return {
    lineId: t.lineId,
    ruleId: t.ruleId,
    ruleVersionId: t.ruleVersionId,
    name: t.ruleName,
    kind,
    accountKey: normalizeLedgerKey(t.ledgerMappingKey),
    ...(rate ? { rate } : {}),
    amount: t.amount,
    ...(units !== undefined ? { units } : {}),
    ...(exemptUnits !== undefined ? { exemptUnits } : {}),
    rateCategory: t.ruleCode,
    statutory: t.nature === 'statutory',
    valueBased,
  };
}
