import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  CODE_ALPHABET,
  confirmationCodeFrom,
  isConfirmationCode,
  normalizeConfirmationCode,
} from './confirmation-code';

describe('confirmation codes (RES-R01)', () => {
  it('are 8 characters without ambiguous characters', () => {
    for (let i = 0; i < 500; i++) {
      const code = confirmationCodeFrom((n) => randomBytes(n));
      expect(code).toMatch(/^[2-9A-HJKMNP-TV-Z]{8}$/);
      expect(isConfirmationCode(code)).toBe(true);
    }
    for (const ch of ['0', '1', 'I', 'L', 'O', 'U']) expect(CODE_ALPHABET).not.toContain(ch);
  });

  it('reject bytes that would bias the distribution (rejection sampling)', () => {
    let call = 0;
    const code = confirmationCodeFrom((n) => {
      call++;
      // First batch only contains bytes >= 240 (rejected); second batch maps to '2'.
      return new Uint8Array(n).fill(call === 1 ? 250 : 0);
    });
    expect(code).toBe('22222222');
    expect(call).toBe(2);
  });

  it('normalises typed input', () => {
    expect(normalizeConfirmationCode(' k7p2-m9qx ')).toBe('K7P2M9QX');
    expect(isConfirmationCode('K7P2M9Q')).toBe(false);
    expect(isConfirmationCode('K7P2M9Q0')).toBe(false);
  });
});
