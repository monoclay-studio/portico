import { describe, expect, it } from 'vitest';
import { canTransitionCompany, validateCommission, validateIataCode } from './company';
import { mayProcess, purposeBasis, validateEvidence } from './consent';
import {
  documentHashInput,
  documentLast4Input,
  isExpired,
  normalizeDocumentNumber,
  retentionDate,
} from './documents';
import { anonymizedName, ERASURE_PLAN } from './privacy';

describe('consent bases (readiness brief §12)', () => {
  it('marketing and profiling need an explicit grant', () => {
    for (const p of ['marketing_email', 'marketing_sms', 'marketing_whatsapp', 'profiling'] as const) {
      const b = purposeBasis(p);
      expect(b.basis).toBe('consent');
      expect(mayProcess(b, 'unknown')).toBe(false);
      expect(mayProcess(b, 'granted')).toBe(true);
      expect(mayProcess(b, 'withdrawn')).toBe(false);
    }
  });
  it('cross-property sharing defaults to legitimate interests; policy can require consent', () => {
    const li = purposeBasis('cross_property_sharing');
    expect(li).toMatchObject({ basis: 'legitimate_interests', gate: 'blocked_if_withdrawn' });
    expect(mayProcess(li, 'unknown')).toBe(true);
    expect(mayProcess(li, 'withdrawn')).toBe(false);
    expect(
      mayProcess(purposeBasis('cross_property_sharing', { sharingRequiresConsent: true }), 'unknown'),
    ).toBe(false);
  });
  it('a grant needs evidence; a withdrawal does not', () => {
    expect(validateEvidence('granted', {})).toMatch(/textVersion/);
    expect(validateEvidence('granted', { textVersion: 'v1', channel: 'web' })).toBeNull();
    expect(validateEvidence('withdrawn', {})).toBeNull();
  });
});

describe('companies', () => {
  it('validates IATA check digits', () => {
    expect(validateIataCode('96200016').ok).toBe(true);
    expect(validateIataCode('96200017').ok).toBe(false);
    expect(validateIataCode('9620001').ok).toBe(false);
    expect(validateIataCode('abcdefgh').ok).toBe(false);
  });
  it('validates commission in integer basis points', () => {
    expect(validateCommission({ model: 'percent_of_room', basisPoints: 1000 })).toBeNull();
    expect(validateCommission({ model: 'percent_of_room', basisPoints: 10.5 })).toMatch(/whole number/);
    expect(validateCommission({ model: 'percent_of_total' })).toMatch(/basisPoints/);
    expect(validateCommission({ model: 'percent_of_room', basisPoints: 5001 })).toMatch(/between/);
    expect(validateCommission({ model: 'net_rate', basisPoints: 100 })).toMatch(/Only percentage/);
    expect(validateCommission({ model: 'none' })).toBeNull();
  });
  it('status transitions', () => {
    expect(canTransitionCompany('active', 'on_hold')).toBe(true);
    expect(canTransitionCompany('inactive', 'on_hold')).toBe(false);
    expect(canTransitionCompany('inactive', 'active')).toBe(true);
  });
});

describe('identity documents', () => {
  it('normalizes numbers for keyed hashing regardless of formatting', () => {
    expect(normalizeDocumentNumber(' ab 12-345<67 ')).toBe('AB1234567');
    expect(documentHashInput('ab 1234567', 'gb')).toBe(documentHashInput('AB1234567', 'GB'));
    expect(documentHashInput('AB1234567', 'GB')).not.toBe(documentHashInput('AB1234567', 'IE'));
    expect(documentLast4Input('X9K4471203')).toBe('doc4:1203');
  });
  it('masks, expires and retains', () => {
    expect(isExpired('2026-01-01', '2026-01-02')).toBe(true);
    expect(isExpired('2026-01-02', '2026-01-02')).toBe(false);
    expect(isExpired(null, '2026-01-02')).toBe(false);
    expect(retentionDate('2026-12-27', 365)).toBe('2027-12-27');
    expect(retentionDate('2026-01-01', 365, '2030-01-01')).toBe('2030-01-01');
    expect(retentionDate('2028-02-29', 365)).toBe('2029-02-28');
  });
});

describe('erasure plan', () => {
  it('keeps financial references pseudonymously and never keeps direct identifiers', () => {
    const by = Object.fromEntries(ERASURE_PLAN.map((p) => [p.category, p.action]));
    expect(by.stayHistory).toBe('retain_pseudonymous');
    expect(by.contactPoints).toBe('delete');
    expect(by.identityDocuments).toBe('delete');
    expect(by['profile.names']).toBe('anonymize');
    expect(anonymizedName('01a1b50c-2197-7c05-9849-a06fb3e01495')).toBe('Anonymized guest b3e01495');
  });
});
