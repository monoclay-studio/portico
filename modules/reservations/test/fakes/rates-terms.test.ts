import { describe, expect, it } from 'vitest';
import type { TaxLine } from '../../src/ports';
import { makeSnapshot, usd } from '../fixtures/terms';
import { complimentary, evaluatePenalty, penaltyAmount, quantityBased } from './rates-terms';

/**
 * Fidelity of the fake rates' penalty and complimentary rules (they live in rates, not reservations — R-02/R-03):
 * reservations' scenario tests rely on these semantics matching rates' canonical contract.
 */
const nights = [usd(30_000), usd(32_000), usd(35_000)];

describe('penalty kinds', () => {
  it('computes each penalty kind on the nightly basis', () => {
    expect(penaltyAmount({ kind: 'none' }, nights, 'USD')).toEqual(usd(0));
    expect(penaltyAmount({ kind: 'first_night' }, nights, 'USD')).toEqual(usd(30_000));
    expect(penaltyAmount({ kind: 'nights', nights: 2 }, nights, 'USD')).toEqual(usd(62_000));
    expect(penaltyAmount({ kind: 'nights', nights: 9 }, nights, 'USD')).toEqual(usd(97_000));
    expect(penaltyAmount({ kind: 'percent_of_stay', percent: 50 }, nights, 'USD')).toEqual(usd(48_500));
    expect(penaltyAmount({ kind: 'amount', amount: usd(10_000) }, nights, 'USD')).toEqual(usd(10_000));
  });

  it('rounds percentages once, half-up, and never charges more than the stay', () => {
    expect(penaltyAmount({ kind: 'percent_of_stay', percent: 33 }, [usd(1001)], 'USD')).toEqual(usd(330));
    expect(penaltyAmount({ kind: 'percent_of_stay', percent: 50 }, [usd(1)], 'USD')).toEqual(usd(1));
    expect(penaltyAmount({ kind: 'amount', amount: usd(999_999) }, nights, 'USD')).toEqual(usd(97_000));
    expect(() => penaltyAmount({ kind: 'percent_of_stay', percent: 120 }, nights, 'USD')).toThrow(
      /between 0 and 100/,
    );
  });
});

describe('evaluateCancellationPenalty: tiers in the property time zone (RES-R20)', () => {
  const terms = makeSnapshot({
    from: '2026-12-20',
    to: '2026-12-23',
    net: (d) => ({ '2026-12-20': 30_000, '2026-12-21': 32_000, '2026-12-22': 35_000 })[d] ?? 0,
    taxBp: 1700,
    feePerPersonNight: 600,
    cancellation: {
      tiers: [
        { deadline: { daysBeforeArrival: 14, time: '23:59' }, penalty: { kind: 'nights', nights: 1 } },
        {
          deadline: { daysBeforeArrival: 3, time: '14:00' },
          penalty: { kind: 'percent_of_stay', percent: 100 },
        },
      ],
      noShow: { kind: 'percent_of_stay', percent: 100 },
    },
  });
  const all = ['2026-12-20', '2026-12-21', '2026-12-22'];
  const at = (iso: string) => evaluatePenalty(terms, new Date(iso), { event: 'cancellation', nights: all });

  it('is free before the first deadline and says until when', () => {
    const r = at('2026-12-06T18:58:59Z'); // 23:58:59 Malé on Dec 6
    expect(r.amount).toEqual(usd(0));
    expect(r.tier).toBeNull();
    expect(r.description).toContain('2026-12-06T18:59:00.000Z');
  });

  it('applies the tier exactly at the local deadline; the most recent passed tier wins', () => {
    expect(at('2026-12-06T18:59:00Z').amount).toEqual(usd(30_000));
    expect(at('2026-12-17T08:59:59Z').amount).toEqual(usd(30_000));
    const late = at('2026-12-17T09:00:00Z'); // 14:00 Malé, 3 days before
    expect(late.tier?.fromInstant).toBe('2026-12-17T09:00:00.000Z');
    // Basis `gross` (rates' default) = night price + value-based hotel fees: no TGST, no Green Tax.
    expect(late.amount).toEqual(usd(97_000));
  });

  it('non-refundable rates charge from booking; no-show uses its own penalty', () => {
    const nr = makeSnapshot({
      from: '2026-12-20',
      to: '2026-12-22',
      net: 30_000,
      cancellation: { tiers: [], nonRefundable: true, noShow: { kind: 'first_night' } },
    });
    const opts = { event: 'cancellation' as const, nights: ['2026-12-20', '2026-12-21'] };
    expect(evaluatePenalty(nr, new Date('2026-01-01T00:00:00Z'), opts).amount).toEqual(usd(60_000));
    expect(
      evaluatePenalty(nr, new Date('2026-12-21T00:00:00Z'), { ...opts, event: 'no_show' }).amount,
    ).toEqual(usd(30_000));
  });
});

describe('complimentaryTerms', () => {
  const snap = makeSnapshot({
    from: '2026-12-20',
    to: '2026-12-23',
    net: 30_000,
    taxBp: 1700,
    feePerPersonNight: 600,
    adults: 2,
    childrenAges: [8, 1],
  });

  it('zeroes the room and value-based taxes but keeps Green Tax (MIRA: comp stays still pay)', () => {
    const comp = complimentary(snap, {
      kind: 'complimentary',
      reason: 'travel agent fam trip',
      by: 'GM',
      at: '2026-12-01T00:00:00.000Z',
    });
    expect(comp.totals.net).toEqual(usd(0));
    expect(comp.totals.taxes).toEqual(usd(0)); // TGST follows the zero value
    expect(comp.totals.fees).toEqual(usd(3 * 3 * 600)); // 2 adults + child 8 per night; the infant is exempt
    expect(comp.nights[0]?.taxes.map((t) => t.code)).toEqual(['GREEN']);
    expect(comp.priceSource).toBe('complimentary');
    expect(comp.priceOverride).toMatchObject({ kind: 'complimentary', original: { totals: snap.totals } });
  });

  it('decides by the rule basis, which rates always states', () => {
    const line = (basis: TaxLine['basis']): TaxLine => ({
      code: 'X',
      name: 'X',
      kind: 'fee',
      amount: usd(100),
      ...(basis ? { basis } : {}),
    });
    expect(quantityBased(line('per_person_night'))).toBe(true);
    expect(quantityBased(line('percentage'))).toBe(false); // e.g. a 10% service charge
    expect(() => quantityBased(line(undefined))).toThrow(/basis/);
  });
});
