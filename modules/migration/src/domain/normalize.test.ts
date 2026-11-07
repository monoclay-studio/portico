import { describe, expect, it } from 'vitest';
import { detectDateOrder, excelSerialToDate, normalizeStatus, parseBool, parseDate, parseMoney } from './normalize';

describe('dates', () => {
  it('reads ISO, named months, date-times and Excel serials (spreadsheets only)', () => {
    expect(parseDate('2026-12-05')).toEqual({ ok: true, date: '2026-12-05' });
    expect(parseDate('2026/12/5 14:00')).toEqual({ ok: true, date: '2026-12-05' });
    expect(parseDate('05-Dec-2026')).toEqual({ ok: true, date: '2026-12-05' });
    expect(parseDate('5 December 2026')).toEqual({ ok: true, date: '2026-12-05' });
    expect(parseDate('46361', { spreadsheet: true })).toEqual({ ok: true, date: '2026-12-05' });
    expect(parseDate('46361')).toEqual({ ok: false, reason: 'invalid' });
    expect(excelSerialToDate(46361)).toBe('2026-12-05');
    expect(excelSerialToDate(1)).toBeNull();
  });
  it('never guesses an ambiguous day/month order', () => {
    expect(parseDate('03/04/2027')).toEqual({ ok: false, reason: 'ambiguous' });
    expect(parseDate('03/04/2027', { order: 'dmy' })).toEqual({ ok: true, date: '2027-04-03' });
    expect(parseDate('03/04/2027', { order: 'mdy' })).toEqual({ ok: true, date: '2027-03-04' });
    expect(parseDate('25/04/2027')).toEqual({ ok: true, date: '2027-04-25' });
    expect(parseDate('04/25/2027')).toEqual({ ok: true, date: '2027-04-25' });
    expect(parseDate('31/02/2027', { order: 'dmy' })).toEqual({ ok: false, reason: 'invalid' });
    expect(parseDate('')).toEqual({ ok: false, reason: 'empty' });
  });
  it('detects a column’s order from any unambiguous value', () => {
    expect(detectDateOrder(['01/02/2027', '13/02/2027'])).toBe('dmy');
    expect(detectDateOrder(['01/02/2027', '02/13/2027'])).toBe('mdy');
    expect(detectDateOrder(['01/02/2027', '03/04/2027'])).toBeNull();
    expect(detectDateOrder(['2027-01-02'])).toBe('ymd');
  });
});

describe('money: integer minor units, never rounded or guessed', () => {
  const ok = (raw: string, cur = 'USD') => {
    const p = parseMoney(raw, cur);
    if (!p.ok) throw new Error(`${raw}: ${p.reason}`);
    return p.minor;
  };
  it('reads common formats', () => {
    expect(ok('1250')).toBe(125000);
    expect(ok('1,250.00')).toBe(125000);
    expect(ok('1.250,00')).toBe(125000);
    expect(ok('1 250,50')).toBe(125050);
    expect(ok('12.5')).toBe(1250);
    expect(ok('1,25')).toBe(125);
    expect(ok('USD 99.99')).toBe(9999);
    expect(ok('$0.01')).toBe(1);
    expect(ok('1,250,000')).toBe(125000000);
    expect(ok('0')).toBe(0);
  });
  it('reads negatives in their accounting forms', () => {
    expect(ok('-5.00')).toBe(-500);
    expect(ok('(12.00)')).toBe(-1200);
    expect(ok('7.50-')).toBe(-750);
  });
  it('respects the currency exponent (JPY 0, KWD 3) and refuses extra precision', () => {
    expect(ok('1500', 'JPY')).toBe(1500);
    expect(parseMoney('1500.5', 'JPY')).toEqual({ ok: false, reason: 'too_precise' });
    expect(ok('1,250.500', 'KWD')).toBe(1250500);
    expect(parseMoney('1.500', 'KWD')).toEqual({ ok: false, reason: 'ambiguous_separator' });
    expect(parseMoney('12.345', 'USD')).toEqual({ ok: false, reason: 'ambiguous_separator' });
    expect(parseMoney('0.125', 'USD')).toEqual({ ok: false, reason: 'too_precise' });
    expect(ok('12.3400', 'USD')).toBe(1234);
    expect(parseMoney('12.340', 'USD')).toEqual({ ok: false, reason: 'ambiguous_separator' });
  });
  it('refuses ambiguous separators and non-amounts', () => {
    expect(parseMoney('1.250', 'USD')).toEqual({ ok: false, reason: 'ambiguous_separator' });
    expect(parseMoney('1,250', 'KWD')).toEqual({ ok: false, reason: 'ambiguous_separator' });
    expect(parseMoney('abc', 'USD')).toEqual({ ok: false, reason: 'invalid' });
    expect(parseMoney('1,2,3', 'USD')).toEqual({ ok: false, reason: 'invalid' });
    expect(parseMoney('', 'USD')).toEqual({ ok: false, reason: 'empty' });
  });
});

describe('vocabularies', () => {
  it('maps the status words exports use (OPERA §8.2 style) and leaves unknown words for a person', () => {
    expect(normalizeStatus('Checked In')).toBe('in_house');
    expect(normalizeStatus('CHECKED_OUT')).toBe('departed');
    expect(normalizeStatus('No-Show')).toBe('no_show');
    expect(normalizeStatus('CXL')).toBe('cancelled');
    expect(normalizeStatus('Unconfirmed')).toBe('tentative');
    expect(normalizeStatus('Waitlisted')).toBeNull();
    expect(normalizeStatus('Requested')).toBeNull();
  });
  it('booleans: only clear words', () => {
    expect(parseBool('yes')).toBe(true);
    expect(parseBool('Opted out')).toBe(false);
    expect(parseBool('maybe')).toBeNull();
  });
});
