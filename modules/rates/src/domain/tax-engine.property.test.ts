/**
 * Property-based-style tests (deterministic PRNG, thousands of random cases) for the documented rounding rule:
 *  P1  net + Σ taxes = gross, exactly, for every line
 *  P2  inclusive lines: net + Σ included rules = the given amount, exactly
 *  P3  totals equal the sums of their lines; net + taxes + fees = gross
 *  P4  every amount is a safe integer in minor units
 *  P5  exclusive → inclusive round trip recovers the net within the number of rules (minor units)
 *  P6  computations are deterministic (bit-identical) for identical inputs
 *  P7  the inclusive residue never exceeds the number of included rules (minor units)
 */
import { describe, expect, it } from 'vitest';
import type { TaxInclusion } from '../contracts';
import { computeLine, computeTaxesPure, type LoadedTaxRule } from './tax-engine';
import { line, prng, rule } from './test-fixtures';

const CATEGORIES = ['accommodation', 'food_beverage', 'transfer'] as const;

function randomRules(r: ReturnType<typeof prng>): LoadedTaxRule[] {
  const count = r.int(1, 5);
  const rules: LoadedTaxRule[] = [];
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    const code = `R${i}`;
    const fixed = r.next() < 0.25;
    const base = { includeNet: true, includeRuleCodes: codes.filter(() => r.next() < 0.4) };
    const ratePercent = `${r.int(0, 30)}${r.bool() ? `.${r.int(0, 9999).toString().padStart(4, '0')}` : ''}`;
    const def = fixed
      ? {
          kind: r.pick(['per_person_night', 'per_unit_night', 'fixed_per_charge'] as const),
          amount: { value: `${r.int(0, 50)}.${r.int(0, 99).toString().padStart(2, '0')}`, currency: 'USD' },
          appliesTo: { taxCategories: [...CATEGORIES] },
          rounding: { mode: r.pick(['half_up', 'half_even'] as const) },
        }
      : {
          kind: 'percentage' as const,
          ratePercent,
          base,
          appliesTo: { taxCategories: [...CATEGORIES] },
          rounding: { mode: r.pick(['half_up', 'half_even'] as const) },
          ...(r.next() < 0.15
            ? { caps: { maxAmountPerLine: { value: `${r.int(1, 200)}`, currency: 'USD' } } }
            : {}),
        };
    rules.push(rule({ code, category: r.bool() ? 'tax' : 'fee', sequence: i }, [{ def }]));
    codes.push(code);
  }
  return rules;
}

/** An inclusion choice that is always consistent (an included rule's dependencies are included too). */
function randomInclusion(r: ReturnType<typeof prng>, rules: LoadedTaxRule[]): TaxInclusion {
  const choice = r.int(0, 2);
  if (choice === 0) return { mode: 'exclusive' };
  if (choice === 1) return { mode: 'inclusive' };
  const included = new Set<string>();
  for (const x of rules) {
    const deps = x.versions[0]?.definition.base.includeRuleCodes ?? [];
    if (r.bool() && deps.every((d) => included.has(d))) included.add(x.rule.code);
  }
  return included.size === 0 ? { mode: 'exclusive' } : { mode: 'rules', includedRuleCodes: [...included] };
}

describe('tax engine properties over random inputs', () => {
  it('P1–P4, P6, P7 hold for 3,000 random lines and rule sets', () => {
    const r = prng(20261107);
    let checked = 0;
    for (let i = 0; i < 3_000; i++) {
      const rules = randomRules(r);
      const inclusion = randomInclusion(r, rules);
      const lines = Array.from({ length: r.int(1, 6) }, (_, k) =>
        line({
          lineId: `l${k}`,
          amountMinor: r.int(0, 5_000_000),
          taxCategory: r.pick(CATEGORIES),
          quantity: r.int(1, 3),
          units: r.int(1, 2),
          occupancy: {
            adults: r.int(1, 4),
            childrenAges: Array.from({ length: r.int(0, 2) }, () => r.int(0, 17)),
          },
          taxInclusion: inclusion,
        }),
      );
      let result: ReturnType<typeof computeTaxesPure>;
      try {
        result = computeTaxesPure(rules, lines, { classification: {} });
      } catch (e) {
        // Inclusive amounts smaller than included fixed amounts are refused by design; nothing else may throw.
        expect((e as Error).message).toMatch(/smaller than the fixed taxes/);
        continue;
      }
      for (const [k, l] of result.lines.entries()) {
        const sum = l.taxes.reduce((s, t) => s + t.amount.amountMinor, 0);
        expect(l.net.amountMinor + sum).toBe(l.gross.amountMinor); // P1
        const included = l.taxes.filter((t) => t.inclusive);
        if (included.length > 0) {
          const inc = included.reduce((s, t) => s + t.amount.amountMinor, 0);
          expect(l.net.amountMinor + inc).toBe(lines[k]?.amount.amountMinor); // P2
          expect(Math.abs(l.roundingResidueMinor)).toBeLessThanOrEqual(included.length); // P7
        } else {
          expect(l.net.amountMinor).toBe(lines[k]?.amount.amountMinor);
        }
        for (const t of l.taxes) expect(Number.isSafeInteger(t.amount.amountMinor)).toBe(true); // P4
      }
      const t = result.totals;
      expect(t.net.amountMinor).toBe(result.lines.reduce((s, l) => s + l.net.amountMinor, 0)); // P3
      expect(t.gross.amountMinor).toBe(result.lines.reduce((s, l) => s + l.gross.amountMinor, 0));
      expect(t.net.amountMinor + t.taxes.amountMinor + t.fees.amountMinor).toBe(t.gross.amountMinor);
      expect(JSON.stringify(computeTaxesPure(rules, lines, { classification: {} }))).toBe(
        JSON.stringify(result),
      ); // P6
      checked++;
    }
    expect(checked).toBeGreaterThan(2_500);
  });

  it('P5: an exclusive price grossed up and decomposed again recovers its net (±1 minor unit per rule)', () => {
    const r = prng(42);
    for (let i = 0; i < 3_000; i++) {
      const rules = randomRules(r);
      const net = r.int(0, 10_000_000);
      const occupancy = { adults: r.int(1, 3), childrenAges: [] };
      const excl = computeLine(rules, line({ amountMinor: net, occupancy }), { classification: {} });
      const incl = computeLine(
        rules,
        line({
          amountMinor: excl.gross.amountMinor,
          occupancy,
          taxInclusion: { mode: 'rules', includedRuleCodes: rules.map((r) => r.rule.code) },
        }),
        {
          classification: {},
        },
      );
      expect(incl.gross.amountMinor).toBe(excl.gross.amountMinor);
      expect(Math.abs(incl.net.amountMinor - net)).toBeLessThanOrEqual(rules.length);
    }
  });
});
