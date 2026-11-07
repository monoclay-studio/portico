import type { PermissionDefinition } from '@portico/kernel';
import { staticAuthorizer } from '@portico/kernel';
import { describe, expect, it } from 'vitest';
import {
  describeRolePermissions,
  diffRolePermissions,
  entryCovers,
  groupCatalog,
  indexCatalog,
  isReadPermission,
  validateRolePermissions,
} from './permissions';
import { stepUpAuthorizer, stepUpDenial } from './step-up';

const CATALOG: PermissionDefinition[] = [
  { key: 'finance.folio.read', description: 'Read folios', scope: 'property' },
  { key: 'finance.posting.create', description: 'Post', scope: 'property' },
  { key: 'finance.posting.correct', description: 'Correct', scope: 'property', sensitive: true },
  { key: 'identity.user.read', description: 'Read users', scope: 'organization' },
  { key: 'identity.user.manage', description: 'Manage users', scope: 'organization', sensitive: true },
];
const cat = indexCatalog(CATALOG);

describe('catalog matching', () => {
  it('wildcards cover keys by prefix only at segment boundaries', () => {
    expect(entryCovers('*', 'finance.folio.read')).toBe(true);
    expect(entryCovers('finance.*', 'finance.folio.read')).toBe(true);
    expect(entryCovers('finance.posting.*', 'finance.folio.read')).toBe(false);
    expect(entryCovers('fin.*', 'finance.folio.read')).toBe(false);
    expect(entryCovers('finance.folio.read', 'finance.folio.read')).toBe(true);
  });

  it('flags sensitivity for exact keys and for wildcards covering a sensitive key', () => {
    expect(cat.isSensitive('finance.posting.correct')).toBe(true);
    expect(cat.isSensitive('finance.posting.create')).toBe(false);
    expect(cat.isSensitive('finance.*')).toBe(true);
    expect(cat.isSensitive('finance.folio.*')).toBe(false);
    expect(cat.isSensitive('*')).toBe(true);
    expect(cat.isSensitive('unknown.thing.do')).toBe(false);
  });

  it('validates role entries against registered permissions', () => {
    expect(validateRolePermissions(['finance.folio.read', 'identity.*'], cat)).toEqual([]);
    expect(
      validateRolePermissions(
        ['finanse.*', 'finance.folio.write', 'Bad Key', 'finance.folio.read', 'finance.folio.read'],
        cat,
      ),
    ).toEqual([
      { entry: 'finanse.*', problem: 'wildcard_matches_nothing' },
      { entry: 'finance.folio.write', problem: 'unknown_permission' },
      { entry: 'Bad Key', problem: 'malformed' },
      { entry: 'finance.folio.read', problem: 'duplicate' },
    ]);
  });

  it('describes and diffs roles in expanded terms', () => {
    expect(describeRolePermissions(['finance.*'], cat)).toEqual({
      effective: ['finance.folio.read', 'finance.posting.correct', 'finance.posting.create'],
      sensitive: ['finance.posting.correct'],
    });
    expect(
      diffRolePermissions(['finance.folio.read'], ['finance.folio.*', 'finance.posting.*'], cat),
    ).toEqual({
      added: ['finance.posting.correct', 'finance.posting.create'],
      removed: [],
      addedSensitive: ['finance.posting.correct'],
    });
  });

  it('groups the catalog by module for role editors and recognises read permissions', () => {
    const g = groupCatalog(CATALOG);
    expect(g.map((m) => m.module)).toEqual(['finance', 'identity']);
    expect(g[0]?.wildcard).toBe('finance.*');
    expect(isReadPermission('finance.folio.read')).toBe(true);
    expect(isReadPermission('finance.folio.readAll')).toBe(false);
  });
});

describe('MFA step-up policy', () => {
  const now = new Date('2026-11-07T10:00:00Z');
  const base = {
    now,
    mfaEnrolled: true,
    mfaVerifiedAt: new Date(now.getTime() - 5 * 60_000),
    enrolmentGraceEndsAt: null,
    stepUpWindowMinutes: 15,
    requireMfaForAll: false,
  };

  it('allows sensitive permissions within the step-up window, including exactly at its end', () => {
    expect(stepUpDenial(true, base)).toBeNull();
    expect(stepUpDenial(true, { ...base, mfaVerifiedAt: new Date(now.getTime() - 15 * 60_000) })).toBeNull();
    expect(stepUpDenial(true, { ...base, mfaVerifiedAt: new Date(now.getTime() - 15 * 60_000 - 1) })).toBe(
      'mfa_required',
    );
    expect(stepUpDenial(true, { ...base, mfaVerifiedAt: null })).toBe('mfa_required');
  });

  it('never requires step-up for non-sensitive permissions of enrolled members', () => {
    expect(stepUpDenial(false, { ...base, mfaVerifiedAt: null })).toBeNull();
  });

  it('never lets sensitive permissions work without MFA, even inside the enrolment grace (ADR-0017 §8)', () => {
    const unenrolled = { ...base, mfaEnrolled: false, mfaVerifiedAt: null };
    const inGrace = { ...unenrolled, enrolmentGraceEndsAt: new Date(now.getTime() + 3600_000) };
    expect(stepUpDenial(true, inGrace)).toBe('mfa_enrollment_required');
    expect(stepUpDenial(true, unenrolled)).toBe('mfa_enrollment_required');
    expect(stepUpDenial(false, inGrace)).toBeNull();
    expect(stepUpDenial(false, unenrolled)).toBeNull();
    // requireMfaForAll: the grace keeps non-sensitive work possible while the member enrols, then stops it.
    expect(stepUpDenial(false, { ...inGrace, requireMfaForAll: true })).toBeNull();
    expect(stepUpDenial(false, { ...unenrolled, requireMfaForAll: true, enrolmentGraceEndsAt: now })).toBe(
      'mfa_enrollment_required',
    );
  });

  it('wraps an authorizer: can() stays boolean, scope fails closed, denials are explained', () => {
    const grants = staticAuthorizer([{ permission: '*', propertyIds: 'all' }]);
    const authz = stepUpAuthorizer(grants, (k) => cat.isSensitive(k), { ...base, mfaVerifiedAt: null });
    expect(authz.can('finance.posting.create', { propertyId: 'p' })).toBe(true);
    expect(authz.can('finance.posting.correct', { propertyId: 'p' })).toBe(false);
    expect(authz.propertyScope('finance.posting.correct')).toEqual([]);
    expect(authz.propertyScope('finance.posting.create')).toBe('all');
    expect(authz.explainDenial('finance.posting.correct')).toBe('mfa_required');
    expect(authz.explainDenial('finance.posting.create')).toBeNull();
    const none = stepUpAuthorizer(staticAuthorizer([]), (k) => cat.isSensitive(k), base);
    expect(none.explainDenial('finance.posting.correct')).toBeNull(); // not granted at all → plain 403
  });
});

describe('role templates', () => {
  it('general manager gets an explicit guest permission list without documents, health data, export or erasure', async () => {
    const { ROLE_TEMPLATES } = await import('./role-templates');
    const gm = ROLE_TEMPLATES.find((r) => r.key === 'general_manager');
    expect(gm?.permissions).not.toContain('guests.*');
    for (const k of [
      'guests.document.read',
      'guests.document.manage',
      'guests.sensitive.read',
      'guests.privacy.export',
      'guests.privacy.erase',
    ])
      expect(gm?.permissions.some((p) => entryCovers(p, k))).toBe(false);
    expect(gm?.permissions).toContain('guests.profile.update');
  });
});
