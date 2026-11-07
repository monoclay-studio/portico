import { describe, expect, it } from 'vitest';
import { makeSnapshot, usd } from '../../test/fixtures/terms';
import { nightlyGross, rangeTotals, requiredDeposit, snapshotHash } from './terms';

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
});
