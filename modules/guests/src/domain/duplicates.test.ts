import { describe, expect, it } from 'vitest';
import {
  isSafeExactReuse,
  type MatchSubject,
  orderedPair,
  QUEUE_THRESHOLD,
  scoreMatch,
  shouldReopenDismissed,
} from './duplicates';
import { type NameParts, nameKeys } from './names';

let seq = 0;
function subject(name: NameParts, extra: Partial<Omit<MatchSubject, 'id' | 'names'>> = {}): MatchSubject {
  seq++;
  return {
    id: `p${seq}`,
    names: nameKeys(name),
    dateOfBirth: null,
    nationality: null,
    emails: [],
    phones: [],
    documentHashes: [],
    ...extra,
  };
}

const codes = (r: ReturnType<typeof scoreMatch>) => r.reasons.map((x) => x.code);

describe('duplicate scoring — precision cases', () => {
  it('same passport → high, regardless of name romanization', () => {
    const a = subject({ givenName: 'Wei', familyName: 'Wang' }, { documentHashes: ['h1'] });
    const b = subject({ givenName: 'Wei', familyName: 'Wong' }, { documentHashes: ['h1'] });
    const r = scoreMatch(a, b);
    expect(r.band).toBe('high');
    expect(codes(r)).toContain('document_exact');
    expect(r.exactKeys).toEqual(['document:h1']);
  });

  it('same verified email and same name → high', () => {
    const a = subject({ givenName: 'Anna', familyName: 'Schmidt' }, { emails: ['anna@example.de'] });
    const b = subject({ givenName: 'Anna', familyName: 'Schmidt' }, { emails: ['anna@example.de'] });
    const r = scoreMatch(a, b);
    expect(r.score).toBeGreaterThanOrEqual(0.85);
    expect(codes(r)).toEqual(expect.arrayContaining(['email_exact', 'name_exact']));
  });

  it('a family sharing one email is NOT a duplicate', () => {
    const a = subject(
      { givenName: 'Rajesh', familyName: 'Sharma' },
      { emails: ['sharma.family@example.in'] },
    );
    const b = subject({ givenName: 'Priya', familyName: 'Patel' }, { emails: ['sharma.family@example.in'] });
    const r = scoreMatch(a, b);
    expect(r.score).toBeLessThan(QUEUE_THRESHOLD);
    expect(isSafeExactReuse(r)).toBe(false);
  });

  it('spouses sharing a phone and family name but different given names stay below the queue', () => {
    const a = subject({ givenName: 'Giulia', familyName: 'Rossi' }, { phones: ['+390612345678'] });
    const b = subject({ givenName: 'Marco', familyName: 'Rossi' }, { phones: ['+390612345678'] });
    const r = scoreMatch(a, b);
    expect(r.nameSimilarity).toBeLessThan(0.75);
    expect(isSafeExactReuse(r)).toBe(false);
  });

  it('two different "Ahmed Ali" with different dates of birth are different people', () => {
    const a = subject(
      { givenName: 'Ahmed', familyName: 'Ali' },
      { dateOfBirth: '1980-03-01', nationality: 'AE' },
    );
    const b = subject(
      { givenName: 'Ahmed', familyName: 'Ali' },
      { dateOfBirth: '1992-11-20', nationality: 'AE' },
    );
    const r = scoreMatch(a, b);
    expect(r.score).toBeLessThan(QUEUE_THRESHOLD);
    expect(codes(r)).toContain('dob_conflict');
  });

  it('even a shared email cannot override a date-of-birth conflict', () => {
    const a = subject(
      { givenName: 'Ahmed', familyName: 'Ali' },
      { emails: ['a@x.ae'], dateOfBirth: '1980-03-01' },
    );
    const b = subject(
      { givenName: 'Ahmed', familyName: 'Ali' },
      { emails: ['a@x.ae'], dateOfBirth: '1992-11-20' },
    );
    expect(scoreMatch(a, b).score).toBeLessThan(QUEUE_THRESHOLD);
    expect(isSafeExactReuse(scoreMatch(a, b))).toBe(false);
  });

  it('same common name with nothing else is only low evidence', () => {
    const a = subject({ givenName: 'John', familyName: 'Smith' });
    const b = subject({ givenName: 'John', familyName: 'Smith' });
    const r = scoreMatch(a, b);
    expect(r.score).toBeLessThan(QUEUE_THRESHOLD);
    expect(r.band).toBe('low');
  });

  it('a typo in the name with the same date of birth reaches the queue', () => {
    const a = subject(
      { givenName: 'Jonh', familyName: 'Smith' },
      { dateOfBirth: '1975-06-15', nationality: 'GB' },
    );
    const b = subject(
      { givenName: 'John', familyName: 'Smith' },
      { dateOfBirth: '1975-06-15', nationality: 'GB' },
    );
    const r = scoreMatch(a, b);
    expect(r.score).toBeGreaterThanOrEqual(QUEUE_THRESHOLD);
    expect(codes(r)).toEqual(expect.arrayContaining(['name_similar', 'dob_match', 'nationality_match']));
  });

  it('Cyrillic record matches its transliterated twin through the native key + DOB', () => {
    const a = subject(
      { givenName: 'Ivan', familyName: 'Petrov', nativeGivenName: 'Иван', nativeFamilyName: 'Петров' },
      { dateOfBirth: '1988-01-09' },
    );
    const b = subject(
      { givenName: 'Ivan', familyName: 'Petroff', nativeGivenName: 'Иван', nativeFamilyName: 'Петров' },
      { dateOfBirth: '1988-01-09' },
    );
    expect(scoreMatch(a, b).band).toBe('high');
  });

  it('Chinese family-name-first vs Western order still matches', () => {
    const a = subject(
      { givenName: 'Wei', familyName: 'Wang' },
      { dateOfBirth: '1990-02-02', nationality: 'CN' },
    );
    const b = subject(
      { givenName: 'Wang', familyName: 'Wei' },
      { dateOfBirth: '1990-02-02', nationality: 'CN' },
    );
    expect(scoreMatch(a, b).score).toBeGreaterThanOrEqual(0.85);
  });

  it('completely different people score zero', () => {
    const a = subject({ givenName: 'Emily', familyName: 'Clarke' });
    const b = subject({ givenName: 'Kenji', familyName: 'Watanabe' });
    expect(scoreMatch(a, b)).toMatchObject({ score: 0, band: 'none' });
  });

  it('is symmetric', () => {
    const a = subject(
      { givenName: 'Jonh', familyName: 'Smith' },
      { dateOfBirth: '1975-06-15', emails: ['j@x.com'] },
    );
    const b = subject(
      { givenName: 'John', familyName: 'Smith' },
      { dateOfBirth: '1975-06-15', emails: ['j@x.com'] },
    );
    expect(scoreMatch(a, b).score).toBe(scoreMatch(b, a).score);
  });
});

describe('unverified emails', () => {
  it('are strong evidence for the queue but never an exact key for reuse', () => {
    const a = subject(
      { givenName: 'Anna', familyName: 'Schmidt' },
      { unverifiedEmails: ['anna@example.de'] },
    );
    const b = subject({ givenName: 'Anna', familyName: 'Schmidt' }, { emails: ['anna@example.de'] });
    const r = scoreMatch(a, b);
    expect(r.exactKeys).toEqual([]);
    expect(r.reasons.map((x) => x.code)).toContain('email_unverified');
    expect(r.score).toBeGreaterThanOrEqual(QUEUE_THRESHOLD);
    expect(isSafeExactReuse(r)).toBe(false);
  });
});

describe('queue mechanics', () => {
  it('orders pairs canonically', () => {
    expect(orderedPair('b', 'a')).toEqual(['a', 'b']);
    expect(orderedPair('a', 'b')).toEqual(['a', 'b']);
  });

  it('re-opens a dismissed pair only for a new exact key', () => {
    const a = subject({ givenName: 'Anna', familyName: 'Schmidt' }, { emails: ['anna@example.de'] });
    const b = subject({ givenName: 'Anna', familyName: 'Schmidt' }, { emails: ['anna@example.de'] });
    const r = scoreMatch(a, b);
    expect(shouldReopenDismissed(['email:anna@example.de'], r)).toBe(false);
    expect(shouldReopenDismissed([], r)).toBe(true);
  });

  it('allows safe exact reuse only for compatible names', () => {
    const a = subject({ givenName: 'Anna', familyName: 'Schmidt' }, { emails: ['anna@example.de'] });
    const b = subject({ givenName: 'Anna', familyName: 'Schmidt' }, { emails: ['anna@example.de'] });
    expect(isSafeExactReuse(scoreMatch(a, b))).toBe(true);
    const c = subject({ givenName: 'Anna', familyName: 'Schmidt' });
    expect(isSafeExactReuse(scoreMatch(a, c))).toBe(false);
  });
});
