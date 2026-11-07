import { describe, expect, it } from 'vitest';
import { makeSnapshot, usd } from '../../test/fixtures/terms';
import {
  cancellationPenalty,
  complimentarySnapshot,
  nightlyGross,
  penaltyAmount,
  rangeTotals,
  requiredDeposit,
  snapshotHash,
} from './terms';

const nights = [usd(30_000), usd(32_000), usd(35_000)];

describe('penalties from agreed terms', () => {
  it('computes each penalty kind on net nightly prices', () => {
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
    expect(() =>
      penaltyAmount({ kind: 'amount', amount: { amountMinor: 1, currency: 'EUR' } }, nights, 'USD'),
    ).toThrow(/EUR/);
  });
});

describe('cancellation tiers evaluated in the property time zone (RES-R20)', () => {
  const policy = {
    tiers: [
      { deadline: { daysBeforeArrival: 14, time: '23:59' }, penalty: { kind: 'nights' as const, nights: 1 } },
      {
        deadline: { daysBeforeArrival: 3, time: '14:00' },
        penalty: { kind: 'percent_of_stay' as const, percent: 100 },
      },
    ],
    noShow: { kind: 'percent_of_stay' as const, percent: 100 },
  };
  const at = (iso: string) =>
    cancellationPenalty({
      policy,
      arrival: '2026-12-20',
      timeZone: 'Indian/Maldives',
      at: new Date(iso),
      nightlyNet: nights,
      currency: 'USD',
    });

  it('is free before the first deadline and says until when', () => {
    const r = at('2026-12-06T18:58:59Z'); // 23:58:59 Malé on Dec 6
    expect(r.amount).toEqual(usd(0));
    expect(r.tier).toBeNull();
    expect(r.freeUntil).toBe('2026-12-06T18:59:00.000Z');
  });

  it('applies the tier exactly at the local deadline (not the UTC date)', () => {
    expect(at('2026-12-06T18:59:00Z').amount).toEqual(usd(30_000));
    // 21:00 UTC Dec 6 is already Dec 7 in Malé but the 14-day tier is the only one passed.
    expect(at('2026-12-06T21:00:00Z').tier).toBe(0);
  });

  it('applies the most recently passed tier', () => {
    expect(at('2026-12-17T08:59:59Z').amount).toEqual(usd(30_000));
    const late = at('2026-12-17T09:00:00Z'); // 14:00 Malé, 3 days before
    expect(late.tier).toBe(1);
    expect(late.amount).toEqual(usd(97_000));
    expect(late.appliedSince).toBe('2026-12-17T09:00:00.000Z');
  });

  it('non-refundable rates charge from booking', () => {
    const r = cancellationPenalty({
      policy: { ...policy, nonRefundable: true },
      arrival: '2026-12-20',
      timeZone: 'Indian/Maldives',
      at: new Date('2026-01-01T00:00:00Z'),
      nightlyNet: nights,
      currency: 'USD',
    });
    expect(r.tier).toBe('non_refundable');
    expect(r.amount).toEqual(usd(97_000));
  });
});

describe('totals, deposits and snapshots', () => {
  const snap = makeSnapshot({
    from: '2026-12-20',
    to: '2026-12-23',
    net: 30_000,
    taxBp: 1700,
    feePerPersonNight: 600,
    adults: 2,
    childrenAges: [8, 1],
  });

  it('sums a sub-range of nights exactly (split segments)', () => {
    const all = rangeTotals(snap, { from: '2026-12-20', to: '2026-12-23' });
    const first = rangeTotals(snap, { from: '2026-12-20', to: '2026-12-21' });
    const rest = rangeTotals(snap, { from: '2026-12-21', to: '2026-12-23' });
    expect(first.net.amountMinor + rest.net.amountMinor).toBe(all.net.amountMinor);
    // Green Tax: 2 adults + 1 child aged 8 (the infant is exempt in this test rule) = 3 × 600 per night.
    expect(first.fees).toEqual(usd(1_800));
    expect(first.taxes).toEqual(usd(5_100));
    expect(first.gross).toEqual(usd(36_900));
  });

  it('refuses to total nights the terms do not price', () => {
    expect(() => rangeTotals(snap, { from: '2026-12-22', to: '2026-12-24' })).toThrow(
      /do not price 2026-12-23/,
    );
  });

  it('computes required deposits from the agreed deposit policy', () => {
    const totals = rangeTotals(snap, { from: '2026-12-20', to: '2026-12-23' });
    const gross = nightlyGross(snap, { from: '2026-12-20', to: '2026-12-23' });
    expect(requiredDeposit([{ kind: 'deposit', basis: 'percent', value: 30 }], totals, gross)).toEqual(
      usd(33_210),
    );
    expect(requiredDeposit([{ kind: 'deposit', basis: 'nights', value: 1 }], totals, gross)).toEqual(
      usd(36_900),
    );
    expect(
      requiredDeposit([{ kind: 'preauthorization', basis: 'percent', value: 100 }], totals, gross),
    ).toEqual(usd(0));
    expect(requiredDeposit([{ kind: 'deposit', basis: 'remaining' }], totals, gross)).toEqual(totals.gross);
  });

  it('hashes content deterministically (immutability check, RES-I04)', () => {
    const copy = JSON.parse(JSON.stringify(snap));
    expect(snapshotHash(copy)).toBe(snapshotHash(snap));
    expect(snapshotHash({ ...snap, hash: 'ignored' } as typeof snap)).toBe(snapshotHash(snap));
    expect(snapshotHash({ ...snap, ratePlanId: 'other' })).not.toBe(snapshotHash(snap));
  });

  it('complimentary snapshots price zero and keep the original totals for reporting', () => {
    const comp = complimentarySnapshot(snap, {
      kind: 'complimentary',
      reason: 'travel agent fam trip',
      approvedBy: 'GM',
    });
    expect(comp.totals.gross).toEqual(usd(0));
    expect(comp.priceSource).toBe('override');
    expect(comp.originalTotals).toEqual(snap.totals);
    expect(rangeTotals(comp, { from: '2026-12-20', to: '2026-12-23' }).gross).toEqual(usd(0));
  });
});
