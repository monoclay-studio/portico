import { describe, expect, it } from 'vitest';
import { CARD_ISSUERS, cardIssuer, containsPan, findPan, isCardNumber, luhnValid, PAN_LENGTHS } from './pan';

/** Appends the Luhn check digit to a body of digits. */
function complete(body: string): string {
  for (let d = 0; d <= 9; d++) if (luhnValid(`${body}${d}`)) return `${body}${d}`;
  throw new Error('unreachable');
}

/** A Luhn-valid number of `length` digits starting with `prefix`, middle filled deterministically. */
function pan(prefix: string, length: number): string {
  let body = prefix;
  let i = 0;
  while (body.length < length - 1) body += String((i++ * 7 + 3) % 10);
  return complete(body);
}

const VISA = '4111111111111111';
const fullWidth = (s: string) => s.replace(/\d/g, (d) => String.fromCharCode(0xff10 + Number(d)));
const shiftDigits = (s: string, zero: number) =>
  [...s].map((c) => (/\d/.test(c) ? String.fromCodePoint(zero + Number(c)) : c)).join('');

describe('luhnValid / cardIssuer / isCardNumber', () => {
  it('checks Luhn on ASCII digits only', () => {
    expect(luhnValid(VISA)).toBe(true);
    expect(luhnValid('4111111111111112')).toBe(false);
    expect(luhnValid('')).toBe(false);
    expect(luhnValid('4111 1111 1111 1111')).toBe(false);
  });

  it('names the issuer by prefix and length', () => {
    expect(cardIssuer(VISA)).toBe('visa');
    expect(cardIssuer('5555555555554444')).toBe('mastercard');
    expect(cardIssuer('2223003122003222')).toBe('mastercard');
    expect(cardIssuer('378282246310005')).toBe('amex');
    expect(cardIssuer('6011111111111117')).toBe('discover');
    expect(cardIssuer('3530111333300000')).toBe('jcb');
    expect(cardIssuer('30569309025904')).toBe('diners');
    expect(cardIssuer('7000000000000002')).toBeNull();
    expect(cardIssuer('41111111111111')).toBeNull(); // 14-digit 4… is no Visa length
    expect(cardIssuer('abc')).toBeNull();
  });

  it('isCardNumber needs Luhn and (issuer mode) an issuer', () => {
    expect(isCardNumber(VISA)).toBe(true);
    expect(isCardNumber('4111111111111112')).toBe(false);
    expect(isCardNumber(pan('7', 16))).toBe(false);
    expect(isCardNumber(pan('7', 16), { mode: 'luhn' })).toBe(true);
    expect(isCardNumber('4111 1111 1111 1111')).toBe(false);
  });

  it('every issuer rule detects a Luhn-valid number at each of its lengths', () => {
    for (const rule of CARD_ISSUERS) {
      for (const length of rule.lengths) {
        for (const prefix of new Set([rule.from, rule.to])) {
          const n = pan(prefix, length);
          expect(findPan(`x ${n} y`), `${rule.scheme} ${prefix} ${length}`).not.toBeNull();
          expect(isCardNumber(n), `${rule.scheme} ${prefix} ${length}`).toBe(true);
        }
      }
    }
  });
});

describe('findPan — every spelling from the review (R-P0-1) is found', () => {
  const found = (text: string) => findPan(text) !== null;

  it.each([
    ['plain', VISA],
    ['single spaces', '4111 1111 1111 1111'],
    ['single dashes', '4111-1111-1111-1111'],
    ['followed by the expiry', '4111 1111 1111 1111 12/27'],
    ['followed by expiry without slash and a note', 'Visa 4111111111111111 1227 cvv in safe'],
    ['preceded by a room number', 'room 12 4111111111111111'],
    ['preceded by a digit, dashed', '2 4111-1111-1111-1111'],
    ['double spaces', '4111  1111  1111  1111'],
    ['dots', '4111.1111.1111.1111'],
    ['no-break spaces U+00A0', '4111 1111 1111 1111'],
    ['figure spaces U+2007', '4111 1111 1111 1111'],
    ['narrow no-break spaces U+202F', '4111 1111 1111 1111'],
    ['spaced dashes', '4111 - 1111 - 1111 - 1111'],
    ['full-width digits', fullWidth(VISA)],
    ['full-width digits with ideographic spaces', fullWidth('4111　1111　1111　1111')],
  ])('%s', (_label, text) => {
    expect(found(text)).toBe(true);
  });
});

describe('findPan — further spellings', () => {
  const found = (text: string) => findPan(text) !== null;

  it.each([
    ['slashes', '4111/1111/1111/1111'],
    ['underscores', '4111_1111_1111_1111'],
    ['commas', '4111,1111,1111,1111'],
    ['tabs', '4111\t1111\t1111\t1111'],
    ['line breaks inside one cell', '4111\n1111\r\n1111\n1111'],
    ['zero-width spaces', '4111​1111​1111​1111'],
    ['soft hyphens', '4111­1111­1111­1111'],
    ['word joiners and BOM', '4111⁠1111﻿1111⁠1111'],
    ['em dashes', '4111—1111—1111—1111'],
    ['parentheses and colon', 'card: (4111) 1111 1111 1111'],
    ['mixed separators', '4111 .- 1111 ··· 1111 / 1111'],
    ['many spaces', '4111      1111      1111      1111'],
    ['quoted', '"4111111111111111"'],
    ['combining marks over digits', '4́111111111111111'],
    ['Arabic-Indic digits', shiftDigits(VISA, 0x0660)],
    ['Extended Arabic-Indic digits', shiftDigits(VISA, 0x06f0)],
    ['Devanagari digits', shiftDigits(VISA, 0x0966)],
    ['Thai digits', shiftDigits(VISA, 0x0e50)],
    ['mathematical bold digits (astral)', shiftDigits(VISA, 0x1d7ce)],
    ['mathematical monospace digits (astral)', shiftDigits(VISA, 0x1d7f6)],
    ['circled digits', '④①①①①①①①①①①①①①①①'],
    ['mixed scripts', `4111 ${fullWidth('1111')} ${shiftDigits('1111', 0x0660)} 1111`],
    ['PAN between other numbers', '2026-12-03 4111111111111111 99'],
    ['PAN glued to expiry', '41111111111111111227'],
    ['leading zero then PAN', '04111111111111111'],
    ['negative sign', '-4111111111111111'],
    ['exponent form (spreadsheet)', '4.111111111111111E15'],
    ['exponent form with sign', '4.111111111111111e+15'],
    ['full-width exponent form', `${fullWidth('4.111111111111111')}Ｅ${fullWidth('15')}`],
    ['19-digit Visa', pan('4', 19)],
    ['Amex grouped 4-6-5', '3782 822463 10005'],
    ['Mastercard', '5555 5555 5555 4444'],
    ['Mastercard 2-series', '2223 0031 2200 3222'],
    ['Discover', '6011 1111 1111 1117'],
    ['JCB', '3530 1113 3330 0000'],
    ['Diners 14', '3056 930902 5904'],
    ['UnionPay 19', pan('62', 19)],
    ['Mir', pan('2200', 16)],
    ['RuPay', pan('508', 16)],
    ['Troy', pan('9792', 16)],
  ])('%s', (_label, text) => {
    expect(found(text)).toBe(true);
  });

  it('spreadsheet precision loss: 15 significant digits + zero is still a card (Luhn not required)', () => {
    expect(luhnValid('4111111111111110')).toBe(false);
    expect(findPan('4111111111111110')).toMatchObject({ form: 'precision_loss', scheme: 'visa', length: 16 });
    expect(findPan(' 4111111111111110.0 ')).toMatchObject({ form: 'precision_loss' });
    expect(findPan('4.11111111111111E+15')).toMatchObject({ form: 'precision_loss', length: 16 });
    expect(findPan('5.55555555555544E+15')).toMatchObject({ form: 'precision_loss', scheme: 'mastercard' });
  });

  it('reports form, scheme, length and offsets — never the digits', () => {
    expect(findPan(VISA)).toEqual({ scheme: 'visa', length: 16, form: 'contiguous', start: 0, end: 16 });
    const text = 'room 12 card 4111 1111 1111 1111 12/27';
    const f = findPan(text);
    expect(f).toMatchObject({ scheme: 'visa', length: 16, form: 'separated' });
    expect(text.slice(f?.start, f?.end)).toBe('4111 1111 1111 1111');
    const g = findPan('room 12 4111111111111111');
    expect(g).toMatchObject({ start: 8, end: 24, form: 'contiguous' });
    const astral = `x ${shiftDigits(VISA, 0x1d7ce)}`;
    const h = findPan(astral);
    expect(h).toMatchObject({ start: 2, end: astral.length });
    // A card number ending in 0 written in exponent form: the mantissa digits alone are no card number.
    let zeroEnding = '';
    for (let i = 0; !zeroEnding; i++) {
      const candidate = pan(`41${String(i).padStart(4, '0')}`, 16);
      if (candidate.endsWith('0')) zeroEnding = candidate;
    }
    const exp = `${zeroEnding[0]}.${zeroEnding.slice(1, 15)}E15`;
    expect(findPan(exp)).toMatchObject({ form: 'exponent', start: 0, end: exp.length, length: 16 });
    expect(JSON.stringify(findPan(text))).not.toContain('1111');
  });

  it('finds the PAN at any offset inside a long digit run', () => {
    for (let k = 0; k <= 10; k++) {
      const before = '9'.repeat(k);
      expect(findPan(`${before}${VISA}`), `offset ${k}`).not.toBeNull();
      expect(findPan(`${VISA}${'8'.repeat(k)}`), `suffix ${k}`).not.toBeNull();
    }
  });

  it('every separator × every position of a 4-4-4-4 grouping is found', () => {
    const seps = [' ', '  ', '-', ' - ', '.', '/', ' ', ' ', ' ', '\t', '​', '_', ', '];
    for (const s of seps) {
      const text = `${VISA.slice(0, 4)}${s}${VISA.slice(4, 8)}${s}${VISA.slice(8, 12)}${s}${VISA.slice(12)}`;
      expect(findPan(`ref 7 ${text} 12/27`), JSON.stringify(s)).not.toBeNull();
    }
  });
});

describe('findPan — what is not reported', () => {
  it.each([
    ['empty', ''],
    ['Luhn-invalid', '4111111111111112'],
    ['masked middle (first six, last four)', '4111 11** **** 1111'],
    ['masked with X', '411111XXXXXX1111'],
    ['interleaved with letters', '4111x1111x1111x1111'],
    ['short phone number', '+960 777 0101'],
    ['booking reference 13 digits, no issuer', '7234567890123'],
    ['dates and times', '2026-12-03 14:30 to 2026-12-05 11:00'],
    ['amounts', 'USD 1,234.56 paid, 89.00 due'],
    ['rounded big number', '4.1E+15'],
    ['zeros only', '0000000000000000'],
    ['issuer prefix with zeros (too few significant digits)', '4000000000000000'],
    ['non-issuer prefix', pan('7', 16)],
    ['14-digit 4… (no Visa length)', pan('4', 14)],
  ])('%s', (_label, text) => {
    expect(findPan(text)).toBeNull();
  });

  it('a `+` starts a phone number: international numbers are not joined with what follows', () => {
    expect(findPan('4111 1111 1111 1111')).not.toBeNull();
    expect(findPan('4111 1111 +1111 1111')).toBeNull();
    const mobile = pan('49151', 13); // a Luhn-valid 13-digit +49 mobile
    expect(findPan(`+${mobile.slice(0, 2)} ${mobile.slice(2)}`)).toBeNull();
    expect(findPan(`+49 151 2345678, +${mobile}`)).toBeNull();
  });

  it('legacy 13-digit lengths are reported only in luhn mode (documented false negative of issuer mode)', () => {
    const visa13 = '4222222222222';
    expect(luhnValid(visa13)).toBe(true);
    expect(findPan(visa13)).toBeNull();
    expect(findPan(visa13, { mode: 'luhn' })).not.toBeNull();
    expect(PAN_LENGTHS.issuer.min).toBe(14);
  });

  it('a 13-digit mobile number stored without its + is not reported in issuer mode', () => {
    for (const prefix of ['4915', '4917', '4366', '6281']) {
      expect(findPan(pan(prefix, 13)), prefix).toBeNull();
    }
  });
});

describe('findPan — documented false positives (accepted: the position is named and the person removes it)', () => {
  it('two numbers separated only by separators join into one digit run', () => {
    // Two 8-digit references in one text: read as one 16-digit number that happens to pass Luhn.
    expect(findPan('ref 4111 1111 / 1111 1111')).not.toBeNull();
  });

  it('a long reference with an issuer prefix that passes Luhn is reported', () => {
    expect(findPan(`OTA ${pan('6', 18)}`)).not.toBeNull();
  });
});

describe('findPan — luhn mode', () => {
  it('reports any Luhn-valid 12–19-digit number not starting with 0', () => {
    expect(findPan(pan('7', 12), { mode: 'luhn' })).toMatchObject({ length: 12, scheme: null });
    expect(findPan(pan('7', 11), { mode: 'luhn' })).toBeNull();
    expect(findPan(VISA, { mode: 'luhn' })).toMatchObject({ scheme: 'visa' });
    expect(containsPan('4111 1111 1111 1111', { mode: 'luhn' })).toBe(true);
  });
});

describe('findPan — cost stays linear', () => {
  it('a 10,000-digit run with no card number is scanned quickly', () => {
    const t0 = Date.now();
    expect(findPan('4'.repeat(10_000))).toBeNull();
    expect(findPan('1'.repeat(10_000), { mode: 'luhn' })).toBeNull();
    expect(Date.now() - t0).toBeLessThan(1000);
  });

  it('a megabyte of mixed text is scanned in well under a second', () => {
    const chunk = 'Guest arrives 14:30, room 12, paid 450.00 USD. ';
    const text = chunk.repeat(Math.ceil(1_000_000 / chunk.length));
    const t0 = Date.now();
    findPan(text);
    expect(Date.now() - t0).toBeLessThan(1500);
  });
});
