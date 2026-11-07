import { describe, expect, it } from 'vitest';
import {
  base32Decode,
  base32Encode,
  generateTotpSecret,
  hotp,
  provisioningUri,
  totp,
  verifyTotp,
} from './totp';

// RFC 6238 Appendix B test secrets (ASCII "1234567890" repeated to the hash length).
const SHA1_SECRET = Buffer.from('12345678901234567890');
const SHA256_SECRET = Buffer.from('12345678901234567890123456789012');
const SHA512_SECRET = Buffer.from('1234567890123456789012345678901234567890123456789012345678901234');

describe('HOTP (RFC 4226 Appendix D)', () => {
  it('matches the published test values', () => {
    const expected = ['755224', '287082', '359152', '969429', '338314', '254676', '287922', '162583'];
    expected.forEach((v, counter) => {
      expect(hotp(SHA1_SECRET, counter)).toBe(v);
    });
  });

  it('rejects negative or fractional counters', () => {
    expect(() => hotp(SHA1_SECRET, -1)).toThrow();
    expect(() => hotp(SHA1_SECRET, 1.5)).toThrow();
  });
});

describe('TOTP (RFC 6238 Appendix B)', () => {
  const vectors: Array<[number, string, string, string]> = [
    [59, '94287082', '46119246', '90693936'],
    [1111111109, '07081804', '68084774', '25091201'],
    [1111111111, '14050471', '67062674', '99943326'],
    [1234567890, '89005924', '91819424', '93441116'],
    [2000000000, '69279037', '90698825', '38618901'],
    [20000000000, '65353130', '77737706', '47863826'],
  ];
  for (const [seconds, sha1, sha256, sha512] of vectors) {
    it(`T=${seconds}`, () => {
      const at = new Date(seconds * 1000);
      expect(totp(SHA1_SECRET, at, { digits: 8, periodSeconds: 30, algorithm: 'sha1' })).toBe(sha1);
      expect(totp(SHA256_SECRET, at, { digits: 8, periodSeconds: 30, algorithm: 'sha256' })).toBe(sha256);
      expect(totp(SHA512_SECRET, at, { digits: 8, periodSeconds: 30, algorithm: 'sha512' })).toBe(sha512);
    });
  }
});

describe('verifyTotp', () => {
  const at = new Date('2026-11-07T10:00:15Z');
  const step = Math.floor(at.getTime() / 30_000);

  it('accepts the current code and returns its time step', () => {
    expect(verifyTotp(SHA1_SECRET, totp(SHA1_SECRET, at), at)).toBe(step);
  });

  it('tolerates one step of clock drift either way, but not two', () => {
    const prev = totp(SHA1_SECRET, new Date(at.getTime() - 30_000));
    const next = totp(SHA1_SECRET, new Date(at.getTime() + 30_000));
    const old = totp(SHA1_SECRET, new Date(at.getTime() - 60_000));
    expect(verifyTotp(SHA1_SECRET, prev, at)).toBe(step - 1);
    expect(verifyTotp(SHA1_SECRET, next, at)).toBe(step + 1);
    expect(verifyTotp(SHA1_SECRET, old, at)).toBeNull();
  });

  it('refuses replay of a used step and of any older step', () => {
    const code = totp(SHA1_SECRET, at);
    expect(verifyTotp(SHA1_SECRET, code, at, { lastUsedStep: step })).toBeNull();
    const prev = totp(SHA1_SECRET, new Date(at.getTime() - 30_000));
    expect(verifyTotp(SHA1_SECRET, prev, at, { lastUsedStep: step })).toBeNull();
    expect(verifyTotp(SHA1_SECRET, code, at, { lastUsedStep: step - 1 })).toBe(step);
  });

  it('rejects malformed codes and accepts codes typed with spaces', () => {
    const code = totp(SHA1_SECRET, at);
    expect(verifyTotp(SHA1_SECRET, '12345', at)).toBeNull();
    expect(verifyTotp(SHA1_SECRET, 'abcdef', at)).toBeNull();
    expect(verifyTotp(SHA1_SECRET, `${code.slice(0, 3)} ${code.slice(3)}`, at)).toBe(step);
  });
});

describe('base32 and provisioning', () => {
  it('round-trips arbitrary bytes and decodes the RFC 4648 vectors', () => {
    expect(base32Encode(Buffer.from('foobar'))).toBe('MZXW6YTBOI');
    expect(base32Decode('MZXW6YTBOI').toString()).toBe('foobar');
    expect(base32Decode('mzxw 6ytb-oi======').toString()).toBe('foobar');
    const secret = generateTotpSecret();
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(base32Encode(base32Decode(secret))).toBe(secret);
    expect(() => base32Decode('0189')).toThrow();
  });

  it('builds an otpauth URI that authenticator apps accept', () => {
    const uri = provisioningUri({
      secret: 'JBSWY3DPEHPK3PXP',
      accountName: 'aisha@lagoon.mv',
      issuer: 'Portico',
    });
    expect(uri).toBe(
      'otpauth://totp/Portico:aisha%40lagoon.mv?secret=JBSWY3DPEHPK3PXP&issuer=Portico&algorithm=SHA1&digits=6&period=30',
    );
  });
});
