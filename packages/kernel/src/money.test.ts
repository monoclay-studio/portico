import { describe, expect, it } from 'vitest';
import {
  add,
  allocate,
  convert,
  currencyExponent,
  fromMajor,
  money,
  multiply,
  subtract,
  toMajor,
} from './money';

describe('money', () => {
  it('uses ISO exponents', () => {
    expect(currencyExponent('USD')).toBe(2);
    expect(currencyExponent('MVR')).toBe(2);
    expect(currencyExponent('JPY')).toBe(0);
    expect(currencyExponent('KWD')).toBe(3);
  });

  it('rejects fractional minor units and bad currencies', () => {
    expect(() => money(1.5, 'USD')).toThrow(/whole minor units/);
    expect(() => money(1, 'usd')).toThrow(/ISO 4217/);
  });

  it('converts major to minor with a single rounding', () => {
    expect(fromMajor('123.455', 'USD').amountMinor).toBe(12346);
    expect(fromMajor('123.455', 'USD', 'half_even').amountMinor).toBe(12346);
    expect(fromMajor('123.445', 'USD', 'half_even').amountMinor).toBe(12344);
    expect(toMajor(money(12345, 'USD')).toString()).toBe('123.45');
  });

  it('refuses to mix currencies', () => {
    expect(() => add(money(1, 'USD'), money(1, 'MVR'))).toThrow(/explicit exchange rate/);
  });

  it('allocates without losing minor units', () => {
    const parts = allocate(money(1000, 'USD'), [1, 1, 1]);
    expect(parts.map((p) => p.amountMinor)).toEqual([334, 333, 333]);
    const neg = allocate(money(-1000, 'USD'), [1, 1, 1]);
    expect(neg.reduce((s, p) => s + p.amountMinor, 0)).toBe(-1000);
    const weighted = allocate(money(10001, 'USD'), [70, 30]);
    expect(weighted.reduce((s, p) => s + p.amountMinor, 0)).toBe(10001);
  });

  it('multiplies by percentages', () => {
    expect(multiply(money(10000, 'USD'), '0.17').amountMinor).toBe(1700);
    expect(subtract(money(500, 'USD'), money(700, 'USD')).amountMinor).toBe(-200);
  });

  it('converts currencies with explicit rates', () => {
    expect(convert(money(10000, 'USD'), 'MVR', '15.42').amountMinor).toBe(154200);
  });
});
