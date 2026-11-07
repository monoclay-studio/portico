import { describe, expect, it } from 'vitest';
import {
  desiredAssignments,
  emailDomainAllowed,
  groupsFromClaim,
  reconcileMappedAssignments,
} from './role-mapping';
import { interpretGroupPatch, interpretUserPatch, parseScimFilter, scimDisplayName } from './scim';
import { alertDedupeKey, isCredentialStuffing, isMassExport, isNewCountry } from './security-rules';

describe('IdP group → role mapping', () => {
  const mappings = [
    {
      id: 'm1',
      group: 'PMS-FrontDesk',
      roleKey: 'front_desk',
      scopeType: 'property' as const,
      scopeId: 'p1',
    },
    { id: 'm2', group: 'pms-finance', roleKey: 'finance', scopeType: 'organization' as const, scopeId: null },
    {
      id: 'm3',
      group: 'pms-frontdesk',
      roleKey: 'front_desk',
      scopeType: 'property' as const,
      scopeId: 'p1',
    },
  ];

  it('reads groups from arrays and comma-separated strings', () => {
    expect(groupsFromClaim(['a', 'b', 3])).toEqual(['a', 'b']);
    expect(groupsFromClaim('a, b')).toEqual(['a', 'b']);
    expect(groupsFromClaim(undefined)).toEqual([]);
  });

  it('matches groups case-insensitively and de-duplicates identical grants', () => {
    expect(desiredAssignments(['pms-frontdesk'], mappings)).toEqual([
      { roleKey: 'front_desk', scopeType: 'property', scopeId: 'p1', mappingId: 'm1' },
    ]);
    expect(desiredAssignments(['other'], mappings)).toEqual([]);
  });

  it('reconciles: grants missing, revokes no-longer-mapped, keeps unchanged', () => {
    const desired = desiredAssignments(['pms-finance'], mappings);
    const existing = [
      { assignmentId: 'a1', roleKey: 'front_desk', scopeType: 'property' as const, scopeId: 'p1' },
      { assignmentId: 'a2', roleKey: 'finance', scopeType: 'organization' as const, scopeId: null },
    ];
    const r = reconcileMappedAssignments(desired, existing);
    expect(r.grant).toEqual([]);
    expect(r.revoke.map((x) => x.assignmentId)).toEqual(['a1']);
    expect(reconcileMappedAssignments(desired, []).grant).toHaveLength(1);
  });

  it('checks email domains exactly', () => {
    expect(emailDomainAllowed('a@Lagoon.mv', ['lagoon.mv'])).toBe(true);
    expect(emailDomainAllowed('a@evil-lagoon.mv', ['lagoon.mv'])).toBe(false);
    expect(emailDomainAllowed('a@staff.lagoon.mv', ['lagoon.mv'])).toBe(false);
    expect(emailDomainAllowed('not-an-email', ['lagoon.mv'])).toBe(false);
  });
});

describe('SCIM parsing', () => {
  it('parses eq filters IdPs use and rejects others', () => {
    expect(parseScimFilter('userName eq "a@b.mv"')).toEqual({ attribute: 'userName', value: 'a@b.mv' });
    expect(parseScimFilter('externalId eq "x\\"y"')).toEqual({ attribute: 'externalId', value: 'x"y' });
    expect(parseScimFilter('USERNAME EQ "a"')).toEqual({ attribute: 'userName', value: 'a' });
    expect(parseScimFilter('userName sw "a"')).toBeNull();
    expect(parseScimFilter(undefined)).toBeUndefined();
  });

  it('interprets user PATCH operations from Entra ID and Okta styles', () => {
    expect(interpretUserPatch([{ op: 'Replace', path: 'active', value: 'False' }]).changes).toEqual({
      active: false,
    });
    expect(
      interpretUserPatch([{ op: 'replace', value: { active: true, displayName: 'A' } }]).changes,
    ).toEqual({
      active: true,
      displayName: 'A',
    });
    expect(interpretUserPatch([{ op: 'remove', path: 'emails' }]).unsupported).toEqual(['remove:emails']);
    expect(interpretUserPatch([{ op: 'replace', path: 'title', value: 'x' }]).unsupported).toEqual(['title']);
  });

  it('interprets group membership PATCH operations', () => {
    const r = interpretGroupPatch([
      { op: 'add', path: 'members', value: [{ value: 'u1' }, { value: 'u2' }] },
      { op: 'remove', path: 'members[value eq "u3"]' },
      { op: 'replace', path: 'displayName', value: 'Front desk' },
    ]);
    expect(r.changes).toEqual({ addMembers: ['u1', 'u2'], removeMembers: ['u3'], displayName: 'Front desk' });
    expect(
      interpretGroupPatch([{ op: 'replace', path: 'members', value: [{ value: 'u9' }] }]).changes
        .replaceMembers,
    ).toEqual(['u9']);
  });

  it('derives display names', () => {
    expect(scimDisplayName({ userName: 'a@b', name: { givenName: 'Aisha', familyName: 'Mohamed' } })).toBe(
      'Aisha Mohamed',
    );
    expect(scimDisplayName({ userName: 'a@b' })).toBe('a@b');
  });
});

describe('suspicious activity rules', () => {
  it('credential stuffing needs both many failures and many accounts', () => {
    expect(isCredentialStuffing({ failures: 10, distinctAccounts: 3 })).toBe(true);
    expect(isCredentialStuffing({ failures: 50, distinctAccounts: 1 })).toBe(false);
    expect(isCredentialStuffing({ failures: 9, distinctAccounts: 5 })).toBe(false);
  });

  it('new country requires a known baseline', () => {
    expect(isNewCountry('MV', [])).toBe(false);
    expect(isNewCountry('MV', ['MV'])).toBe(false);
    expect(isNewCountry('RU', ['MV'])).toBe(true);
    expect(isNewCountry(null, ['MV'])).toBe(false);
  });

  it('mass export by count or by volume', () => {
    expect(isMassExport({ exports: 5, records: 10 })).toBe(true);
    expect(isMassExport({ exports: 1, records: 10_000 })).toBe(true);
    expect(isMassExport({ exports: 4, records: 9_999 })).toBe(false);
  });

  it('dedupes alerts per time bucket', () => {
    const a = alertDedupeKey('mass_export', 'u1', new Date('2026-11-07T10:01:00Z'), 60);
    const b = alertDedupeKey('mass_export', 'u1', new Date('2026-11-07T10:59:00Z'), 60);
    const c = alertDedupeKey('mass_export', 'u1', new Date('2026-11-07T11:00:00Z'), 60);
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});
