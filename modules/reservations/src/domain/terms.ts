import {
  add,
  canonicalJson,
  type DateRange,
  Decimal,
  eachNight,
  type Money,
  multiply,
  rangeContains,
  sha256Hex,
  sum,
  ValidationError,
  zero,
} from '@portico/kernel';
import type { CancellationPolicy, DepositItem, Penalty, TermsSnapshot } from '../ports';

/** Content hash of agreed terms (excludes any embedded `hash`). Verifies immutability (RES-I04). */
export function snapshotHash(doc: TermsSnapshot): string {
  const { hash: _ignored, ...rest } = doc as TermsSnapshot & { hash?: unknown };
  return sha256Hex(canonicalJson(rest));
}

export interface RangeTotals {
  net: Money;
  taxes: Money;
  fees: Money;
  gross: Money;
}

/** Nightly lines of a snapshot that fall inside `range` (a segment's nights). */
export function nightlyLines(doc: TermsSnapshot, range: DateRange): TermsSnapshot['nights'] {
  return doc.nights.filter((n) => rangeContains(range, n.date));
}

/** Totals for the nights of `range` priced by `doc`. Every night of the range must be priced. */
export function rangeTotals(doc: TermsSnapshot, range: DateRange): RangeTotals {
  const lines = nightlyLines(doc, range);
  const priced = new Set(lines.map((l) => l.date));
  const missing = eachNight(range).filter((d) => !priced.has(d));
  if (missing.length) {
    throw new ValidationError(
      'terms_missing_nights',
      `The agreed terms do not price ${missing.join(', ')}. Re-price the stay before continuing.`,
      { missing },
    );
  }
  const c = doc.currency;
  const net = sum(
    c,
    lines.map((l) => l.net),
  );
  const taxes = sum(
    c,
    lines.flatMap((l) => l.taxes.filter((t) => t.kind === 'tax').map((t) => t.amount)),
  );
  const fees = sum(
    c,
    lines.flatMap((l) => l.taxes.filter((t) => t.kind === 'fee').map((t) => t.amount)),
  );
  return { net, taxes, fees, gross: add(net, taxes, fees) };
}

export function addTotals(currency: string, items: readonly RangeTotals[]): RangeTotals {
  return {
    net: sum(
      currency,
      items.map((i) => i.net),
    ),
    taxes: sum(
      currency,
      items.map((i) => i.taxes),
    ),
    fees: sum(
      currency,
      items.map((i) => i.fees),
    ),
    gross: sum(
      currency,
      items.map((i) => i.gross),
    ),
  };
}

export const zeroTotals = (currency: string): RangeTotals => ({
  net: zero(currency),
  taxes: zero(currency),
  fees: zero(currency),
  gross: zero(currency),
});

export function describePenalty(penalty: Penalty): string {
  switch (penalty.kind) {
    case 'none':
      return 'no charge';
    case 'nights':
      return `${penalty.nights} night${penalty.nights === 1 ? '' : 's'}`;
    case 'first_night':
      return 'the first night';
    case 'percent_of_stay':
      return `${penalty.percent}% of the stay`;
    case 'amount':
      return `a fixed amount (${penalty.amount.amountMinor} ${penalty.amount.currency} minor units)`;
  }
}

/** Deposit required by the agreed deposit policy (sum of `deposit` items). */
export function requiredDeposit(
  items: readonly DepositItem[],
  totals: { gross: Money },
  nightlyGross: readonly Money[],
): Money {
  const currency = totals.gross.currency;
  let required = zero(currency);
  for (const item of items) {
    if (item.kind !== 'deposit') continue;
    switch (item.basis) {
      case 'percent':
        required = add(required, multiply(totals.gross, new Decimal(item.value ?? 0).div(100)));
        break;
      case 'nights':
        required = add(required, sum(currency, nightlyGross.slice(0, item.value ?? 0)));
        break;
      case 'amount':
        if (item.amount) required = add(required, item.amount);
        break;
      case 'remaining':
        required = totals.gross;
        break;
    }
  }
  return required.amountMinor > totals.gross.amountMinor ? totals.gross : required;
}

/** Nightly gross (net + taxes + fees) for each night of the range, in order. */
export function nightlyGross(doc: TermsSnapshot, range: DateRange): Money[] {
  return nightlyLines(doc, range)
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .map((l) => add(l.net, ...l.taxes.map((t) => t.amount)));
}

/**
 * Digest of agreed terms for preview tokens: the document minus volatile quote metadata (RES-R12, R-04). The
 * provider's own sealed document is excluded too — its quote id, timestamps and seal change on every quote, while
 * everything the guest agrees to (nights, taxes, totals, policies) is in the view.
 */
export function termsDigest(doc: TermsSnapshot): string {
  const {
    hash: _h,
    quotedAt: _q,
    quoteId: _i,
    providerDocument: _p,
    ...rest
  } = doc as TermsSnapshot & { hash?: unknown; quoteId?: unknown };
  return sha256Hex(canonicalJson(rest));
}

/** Plain-language cancellation policy for previews (shown before the guest's agreement is recorded). */
export function describeCancellationPolicy(p: CancellationPolicy): string {
  if (p.text) return p.text;
  if (p.nonRefundable)
    return `Non-refundable: cancelling costs ${describePenalty(p.nonRefundablePenalty ?? { kind: 'percent_of_stay', percent: 100 })}.`;
  if (p.tiers.length === 0) return 'Free cancellation.';
  return p.tiers
    .map(
      (t) =>
        `From ${t.deadline.daysBeforeArrival} day(s) before arrival at ${t.deadline.time}: ${describePenalty(t.penalty)}`,
    )
    .join('; ');
}
