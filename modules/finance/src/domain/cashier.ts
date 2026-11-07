/** Amounts per currency in minor units, e.g. { USD: 25000, MVR: 154200 }. */
export type CurrencyAmounts = Record<string, number>;

export function addAmounts(a: CurrencyAmounts, b: CurrencyAmounts): CurrencyAmounts {
  const out: CurrencyAmounts = { ...a };
  for (const [c, v] of Object.entries(b)) out[c] = (out[c] ?? 0) + v;
  return out;
}

/**
 * Expected drawer content = opening float + Σ cash movements, per currency. Variance = counted − expected
 * (positive = over, negative = short). Currencies counted but never expected (or vice versa) are included.
 */
export function cashVariance(
  openingFloats: CurrencyAmounts,
  movements: ReadonlyArray<{ currency: string; amountMinor: number }>,
  counted: CurrencyAmounts,
): { expected: CurrencyAmounts; variance: CurrencyAmounts } {
  let expected: CurrencyAmounts = { ...openingFloats };
  for (const m of movements) expected = addAmounts(expected, { [m.currency]: m.amountMinor });
  const currencies = new Set([...Object.keys(expected), ...Object.keys(counted)]);
  const variance: CurrencyAmounts = {};
  for (const c of [...currencies].sort()) {
    variance[c] = (counted[c] ?? 0) - (expected[c] ?? 0);
    expected[c] = expected[c] ?? 0;
  }
  return { expected, variance };
}
