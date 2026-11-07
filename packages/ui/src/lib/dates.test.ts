import { describe, expect, it } from 'vitest';
import { addDays, addMonths, dateSeries, diffDays, isLocalDate, monthMatrix } from './dates';
import { formatMoney } from './format';

describe('LocalDate helpers', () => {
  it('validates real calendar dates only', () => {
    expect(isLocalDate('2026-11-07')).toBe(true);
    expect(isLocalDate('2026-02-29')).toBe(false);
    expect(isLocalDate('2028-02-29')).toBe(true);
    expect(isLocalDate('2026-13-01')).toBe(false);
    expect(isLocalDate('7/11/2026')).toBe(false);
  });

  it('does day arithmetic in UTC across month, year and DST-free boundaries', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(diffDays('2026-11-07', '2026-11-12')).toBe(5);
    expect(dateSeries('2026-11-29', 3)).toEqual(['2026-11-29', '2026-11-30', '2026-12-01']);
  });

  it('clamps month arithmetic to the last day of shorter months', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2026-03-31', -1)).toBe('2026-02-28');
    expect(addMonths('2026-11-15', 12)).toBe('2027-11-15');
  });

  it('builds month matrices honouring the configured first day of week', () => {
    const mondayFirst = monthMatrix('2026-11-15', 1);
    expect(mondayFirst[0]?.[0]).toBe('2026-10-26');
    const sundayFirst = monthMatrix('2026-11-15', 0);
    expect(sundayFirst[0]?.[0]).toBe('2026-11-01');
    for (const m of [mondayFirst, sundayFirst]) expect(m.flat()).toContain('2026-11-30');
  });
});

describe('formatMoney', () => {
  it('uses the currency minor-unit digits (integers in, never floats stored)', () => {
    // ISO code by default: "$" is ambiguous in a multi-currency property (USD vs MVR vs AUD …).
    expect(formatMoney({ amountMinor: 123456, currency: 'USD' })).toBe('USD\u00a01,234.56');
    expect(formatMoney({ amountMinor: 1500, currency: 'JPY' })).toBe('JPY\u00a01,500');
    expect(formatMoney({ amountMinor: 1234, currency: 'KWD' })).toMatch(/1\.234/);
    expect(formatMoney({ amountMinor: -500, currency: 'USD' })).toBe('-USD\u00a05.00');
    expect(
      formatMoney({ amountMinor: 500, currency: 'USD' }, 'en', { signDisplay: 'always', display: 'symbol' }),
    ).toBe('+$5.00');
  });
});
