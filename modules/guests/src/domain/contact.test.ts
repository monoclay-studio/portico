import { describe, expect, it } from 'vitest';
import { isProxyEmail, maskContact, normalizeContact, normalizeEmail, normalizePhone } from './contact';

describe('email normalization', () => {
  it('lower-cases and trims, but never rewrites mailboxes', () => {
    expect(normalizeEmail('  Anna.Schmidt@Example.DE ')).toBe('anna.schmidt@example.de');
    expect(normalizeEmail('a.b+tag@gmail.com')).toBe('a.b+tag@gmail.com');
  });
  it('rejects malformed addresses', () => {
    expect(normalizeEmail('no-at-sign')).toBeNull();
    expect(normalizeEmail('a@b')).toBeNull();
    expect(normalizeEmail('a b@c.com')).toBeNull();
  });
  it('recognizes OTA proxy addresses as low confidence', () => {
    expect(isProxyEmail('jsmith.123@guest.booking.com')).toBe(true);
    expect(isProxyEmail('x@m.expediapartnercentral.com')).toBe(true);
    expect(isProxyEmail('john@booking.com.example.org')).toBe(false);
    expect(normalizeContact('email', 'abc@guest.booking.com')).toEqual({
      normalized: 'abc@guest.booking.com',
      lowConfidence: true,
    });
    expect(normalizeContact('email', 'abc@example.com').lowConfidence).toBe(false);
  });
});

describe('phone normalization to E.164', () => {
  it.each([
    ['+960 777-1234', undefined, '+9607771234'],
    ['00960 7771234', undefined, '+9607771234'],
    ['7771234', 'MV', '+9607771234'],
    ['960 7771234', 'MV', '+9607771234'],
    ['+44 20 7946 0958', undefined, '+442079460958'],
    ['020 7946 0958', 'GB', '+442079460958'],
    ['8 (916) 123-45-67', 'RU', '+79161234567'],
    ['+7 916 123 45 67', undefined, '+79161234567'],
    ['06 1234 5678', 'IT', '+390612345678'], // Italy keeps the leading zero
    ['(202) 555-0123', 'US', '+12025550123'],
    ['1-202-555-0123', 'US', '+12025550123'],
    ['138 0013 8000', 'CN', '+8613800138000'],
    ['050 123 4567', 'AE', '+971501234567'],
    ['98765 43210', 'IN', '+919876543210'],
  ])('%s (%s) → %s', (input, country, e164) => {
    expect(normalizePhone(input, country).e164).toBe(e164);
  });

  it('refuses to guess without a country or with impossible lengths', () => {
    expect(normalizePhone('7771234').e164).toBeNull();
    expect(normalizePhone('+1234').e164).toBeNull();
    expect(normalizePhone('+1234567890123456').e164).toBeNull();
    expect(normalizePhone('12', 'MV').e164).toBeNull();
    expect(normalizePhone('7771234', 'ZZ').e164).toBeNull();
  });

  it('marks unnormalizable phones as low confidence', () => {
    expect(normalizeContact('phone', '12345').lowConfidence).toBe(true);
    expect(normalizeContact('whatsapp', '+9607771234')).toEqual({
      normalized: '+9607771234',
      lowConfidence: false,
    });
  });
});

describe('masking', () => {
  it('masks emails and phones for low-privilege display', () => {
    expect(maskContact('email', 'anna@example.com')).toBe('a•••@example.com');
    expect(maskContact('phone', '+9607771234')).toBe('•••1234');
    expect(maskContact('address', '1 Main St')).toBe('•••');
  });
});
