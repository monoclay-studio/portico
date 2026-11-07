import { describe, expect, it } from 'vitest';
import {
  generateRecoveryCodes,
  hashRecoveryCode,
  normalizeRecoveryCode,
  RECOVERY_CODE_COUNT,
} from './recovery-codes';

describe('recovery codes', () => {
  it('generates distinct, well-formed codes', () => {
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(RECOVERY_CODE_COUNT);
    expect(new Set(codes).size).toBe(RECOVERY_CODE_COUNT);
    for (const c of codes) expect(c).toMatch(/^[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$/);
  });

  it('normalizes what people type and hashes equivalently', () => {
    expect(normalizeRecoveryCode(' abcde-fgh0k ')).toBe('ABCDEFGH0K');
    expect(normalizeRecoveryCode('ABCDE FGHOK')).toBe('ABCDEFGH0K');
    expect(hashRecoveryCode('abcde-fghok')).toBe(hashRecoveryCode('ABCDEFGH0K'));
    expect(normalizeRecoveryCode('short')).toBeNull();
    expect(normalizeRecoveryCode('ABCDE-FGHU1')).toBeNull(); // U is not in the alphabet
    expect(hashRecoveryCode('nope')).toBeNull();
  });
});
