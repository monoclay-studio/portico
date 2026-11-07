/**
 * Tenant isolation (scenario S17 / E09) and deny-by-default permissions. Another organization can never read,
 * search, merge or modify a guest — even with the ids — and Row Level Security hides the rows even from a
 * buggy query.
 */
import { sql } from '@portico/db';
import type { TestDatabase } from '@portico/testing';
import { testContext } from '@portico/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupOrg, startDb } from './helpers';

let t: TestDatabase;
beforeAll(async () => {
  t = await startDb();
});
afterAll(async () => t?.drop());

describe('tenant isolation', () => {
  it('another organization cannot read, search, edit, merge, reveal or erase by id', async () => {
    const victim = await setupOrg(t);
    const attacker = await setupOrg(t);
    const [A] = victim.properties as [string];
    const g1 = await victim.sys((tx) =>
      victim.svc.resolveProfile(
        tx,
        {
          propertyId: A,
          givenName: 'Victoria',
          familyName: 'Stone',
          contactPoints: [{ kind: 'email', value: 'v.stone@guest.example', verified: true }],
        },
        { matchStrategy: 'create_new' },
      ),
    );
    const g2 = await victim.sys((tx) =>
      victim.svc.resolveProfile(
        tx,
        { propertyId: A, givenName: 'Victoria', familyName: 'Stone' },
        { matchStrategy: 'create_new' },
      ),
    );
    const { documentId } = await victim.sys((tx) =>
      victim.svc.addDocument(tx, g1.profileId, {
        propertyId: A,
        type: 'passport',
        issuingCountry: 'GB',
        number: '533380006',
      }),
    );
    const company = await victim.sys((tx) =>
      victim.svc.createCompany(tx, { kind: 'company', legalName: 'Victim Corp' }),
    );
    const { mergeId } = await victim.sys((tx) =>
      victim.svc.mergeProfiles(tx, { survivorId: g1.profileId, mergedId: g2.profileId, reason: 'dup' }),
    );

    // The attacker is an all-powerful admin of THEIR organization.
    const as = attacker.sys;
    await expect(as((tx) => attacker.svc.getProfile(tx, g1.profileId))).rejects.toMatchObject({
      status: 404,
    });
    await expect(as((tx) => attacker.svc.getStayHistory(tx, g1.profileId))).rejects.toMatchObject({
      status: 404,
    });
    await expect(
      as((tx) => attacker.svc.updateProfile(tx, g1.profileId, 1, { vipLevel: 'vvip' })),
    ).rejects.toMatchObject({
      status: 404,
    });
    await expect(
      as((tx) => attacker.svc.addNote(tx, g1.profileId, { visibility: 'shared', body: 'pwned' })),
    ).rejects.toMatchObject({ status: 404 });
    await expect(as((tx) => attacker.svc.revealDocument(tx, documentId, 'curious'))).rejects.toMatchObject({
      status: 404,
    });
    await expect(as((tx) => attacker.svc.getCompany(tx, company.id))).rejects.toMatchObject({ status: 404 });
    await expect(as((tx) => attacker.svc.getMerge(tx, mergeId))).rejects.toMatchObject({ status: 404 });
    await expect(
      as((tx) => attacker.svc.unmergeProfiles(tx, { mergeId, reason: 'evil' })),
    ).rejects.toMatchObject({
      status: 404,
    });
    await expect(
      as((tx) => attacker.svc.eraseProfile(tx, { kind: 'erasure', profileId: g1.profileId, reason: 'evil' })),
    ).rejects.toMatchObject({ status: 404 });
    // Cross-tenant merge (one profile from each organization) is impossible.
    const own = await as((tx) =>
      attacker.svc.resolveProfile(
        tx,
        { propertyId: attacker.properties[0] as string, givenName: 'Victoria', familyName: 'Stone' },
        { matchStrategy: 'create_new' },
      ),
    );
    await expect(
      as((tx) =>
        attacker.svc.mergeProfiles(tx, {
          survivorId: own.profileId,
          mergedId: g1.profileId,
          reason: 'steal',
        }),
      ),
    ).rejects.toMatchObject({ status: 404 });
    // Search and duplicate detection never cross organizations.
    const found = await as((tx) =>
      attacker.svc.searchProfiles(tx, { q: 'v.stone@guest.example', kind: 'auto', limit: 10 }),
    );
    expect(found.items).toHaveLength(0);
    const dups = await as((tx) => attacker.svc.listDuplicates(tx, { status: 'open' }));
    expect(dups.some((d) => [d.profileAId, d.profileBId].includes(g1.profileId))).toBe(false);
    // Recording repoints against another tenant's merge is impossible.
    await expect(
      as((tx) => attacker.svc.recordReferenceRepoints(tx, { mergeId, module: 'x', references: [] })),
    ).rejects.toMatchObject({ status: 404 });

    // Victim data unchanged.
    const p = await victim.sys((tx) => victim.svc.getProfile(tx, g1.profileId));
    expect(p.vipLevel).toBeNull();
    expect(p.notes).toHaveLength(0);
  });

  it('RLS hides every guests table from a query that forgets the tenant filter', async () => {
    const a = await setupOrg(t);
    const b = await setupOrg(t);
    await a.sys((tx) =>
      a.svc.resolveProfile(
        tx,
        { propertyId: a.properties[0] as string, familyName: 'Secret' },
        { matchStrategy: 'create_new' },
      ),
    );
    const { rows } = await b.sys((tx) =>
      sql<{ n: number }>`select count(*)::int as n from guests.profiles where family_name = 'Secret'`.execute(
        tx.db,
      ),
    );
    expect(rows[0]?.n).toBe(0);
    // Inserting a row for another tenant is rejected by the policy's WITH CHECK.
    await expect(
      b.sys((tx) =>
        sql`insert into guests.profile_properties (tenant_id, profile_id, property_id, first_seen_at, source)
            values (${a.tenantId}, ${crypto.randomUUID()}, ${crypto.randomUUID()}, now(), 'manual')`.execute(
          tx.db,
        ),
      ),
    ).rejects.toThrow(/row-level security|violates/);
  });
});

describe('permissions (deny by default)', () => {
  it('a user without any guests permission is refused (403), not shown an empty profile', async () => {
    const org = await setupOrg(t);
    const g = await org.sys((tx) =>
      org.svc.resolveProfile(
        tx,
        { propertyId: org.properties[0] as string, familyName: 'Lopez' },
        { matchStrategy: 'create_new' },
      ),
    );
    const housekeeping = testContext({
      tenantId: org.tenantId,
      grants: [{ permission: 'operations.housekeeping.update', propertyIds: 'all' }],
    });
    await expect(org.run(housekeeping, (tx) => org.svc.getProfile(tx, g.profileId))).rejects.toMatchObject({
      code: 'forbidden',
    });
    await expect(
      org.run(housekeeping, (tx) => org.svc.searchProfiles(tx, { q: 'Lopez', kind: 'auto', limit: 5 })),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      org.run(housekeeping, (tx) =>
        org.svc.resolveProfile(tx, { propertyId: org.properties[0] as string, familyName: 'X' }),
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('property scope is enforced: a desk agent at one property cannot create profiles at another', async () => {
    const org = await setupOrg(t);
    const [A, B] = org.properties as [string, string];
    const deskA = org.user([
      { permission: 'guests.profile.read', propertyIds: [A] },
      { permission: 'guests.profile.update', propertyIds: [A] },
    ]);
    await expect(
      org.run(deskA, (tx) =>
        org.svc.createProfile(tx, { propertyId: B, familyName: 'Elsewhere', matchStrategy: 'create_new' }),
      ),
    ).rejects.toMatchObject({ code: 'forbidden', details: { scope: { propertyId: B } } });
    const ok = await org.run(deskA, (tx) =>
      org.svc.createProfile(tx, { propertyId: A, familyName: 'Here', matchStrategy: 'create_new' }),
    );
    expect(ok.profile.knownAtPropertyIds).toEqual([A]);
  });
});
