import { allocate, BusinessRuleError, convert, type Decimal, type LocalDate, money } from '@portico/kernel';

export type SubLedgerType = 'folio' | 'booking_deposit' | 'receivables_account' | 'cashier_session' | 'allowance';

/** A journal line before persistence. Amounts are signed: positive = debit, negative = credit. */
export interface LineDraft {
  accountKey: string;
  amountMinor: number;
  currency: string;
  /** Set explicitly for multi-currency entries (FX); otherwise derived by `functionalize`. */
  functionalAmountMinor?: number;
  fxRateId?: string | null;
  subLedger?: { type: SubLedgerType; id: string } | null;
  /** Index into the entry's posting drafts this line mirrors (guest-ledger lines only). */
  postingIndex?: number;
  chargeCode?: string | null;
  serviceDate?: LocalDate | null;
  revenueDate?: LocalDate | null;
  memo?: string | null;
}

export interface FunctionalLine extends LineDraft {
  functionalAmountMinor: number;
}

export interface RateQuote {
  rate: Decimal.Value;
  rateId: string;
}

/**
 * Fill in functional amounts for lines in a foreign transaction currency. Per currency, the debit total is
 * converted once and allocated across debit lines (largest remainder), and the same for credits, so the
 * functional side balances exactly whenever the transaction side balances.
 */
export function functionalize(
  lines: readonly LineDraft[],
  functionalCurrency: string,
  rateFor: (currency: string) => RateQuote,
): FunctionalLine[] {
  const out: FunctionalLine[] = lines.map((l) => ({
    ...l,
    functionalAmountMinor:
      l.functionalAmountMinor ?? (l.currency === functionalCurrency ? l.amountMinor : Number.NaN),
  }));
  const pending = new Map<string, number[]>();
  out.forEach((l, i) => {
    if (Number.isNaN(l.functionalAmountMinor)) {
      const list = pending.get(l.currency) ?? [];
      list.push(i);
      pending.set(l.currency, list);
    }
  });
  for (const [currency, idx] of pending) {
    const q = rateFor(currency);
    for (const sign of [1, -1] as const) {
      const side = idx.filter((i) => Math.sign(out[i]?.amountMinor ?? 0) === sign);
      if (side.length === 0) continue;
      const total = side.reduce((s, i) => s + Math.abs(out[i]?.amountMinor ?? 0), 0);
      const converted = convert(money(total, currency), functionalCurrency, q.rate);
      const parts = allocate(
        converted,
        side.map((i) => Math.abs(out[i]?.amountMinor ?? 0)),
      );
      side.forEach((i, k) => {
        const line = out[i];
        if (!line) return;
        line.functionalAmountMinor = sign * (parts[k]?.amountMinor ?? 0);
        line.fxRateId = line.fxRateId ?? q.rateId;
      });
    }
    for (const i of idx.filter((j) => (out[j]?.amountMinor ?? 0) === 0)) {
      const line = out[i];
      if (line) line.functionalAmountMinor = 0;
    }
  }
  return out;
}

/** Imbalances per transaction currency and in functional currency (empty = balanced). */
export function imbalances(lines: readonly FunctionalLine[]): Array<{ currency: string; difference: number }> {
  const byCurrency = new Map<string, number>();
  let functional = 0;
  for (const l of lines) {
    byCurrency.set(l.currency, (byCurrency.get(l.currency) ?? 0) + l.amountMinor);
    functional += l.functionalAmountMinor;
  }
  const out = [...byCurrency.entries()]
    .filter(([, v]) => v !== 0)
    .map(([currency, difference]) => ({ currency, difference }));
  if (functional !== 0) out.push({ currency: 'functional', difference: functional });
  return out;
}

/** Defense in depth before hitting the database's deferred balance trigger. */
export function assertBalanced(lines: readonly FunctionalLine[], description: string): void {
  if (lines.length < 2) {
    throw new BusinessRuleError(
      'unbalanced_entry',
      `The journal entry for "${description}" needs at least two lines. Nothing was posted.`,
    );
  }
  const diff = imbalances(lines);
  if (diff.length > 0) {
    throw new BusinessRuleError(
      'unbalanced_entry',
      `The journal entry for "${description}" does not balance (${diff
        .map((d) => `${d.currency}: ${d.difference}`)
        .join(', ')}). Nothing was posted; report this to support.`,
      { imbalances: diff },
    );
  }
}

/** Mirror of a set of lines: every amount negated (full reversal). */
export function reverseLines<T extends LineDraft>(lines: readonly T[]): T[] {
  return lines.map((l) => ({
    ...l,
    amountMinor: -l.amountMinor,
    ...(l.functionalAmountMinor !== undefined ? { functionalAmountMinor: -l.functionalAmountMinor } : {}),
  }));
}
