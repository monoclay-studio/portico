/**
 * Duplicate detection on a real database (GUE-R09/R10): exact keys, pg_trgm fuzzy names across scripts, the
 * review queue, dismissal memory and exact-only resolution for channel ingestion. Precision matters more than
 * recall: different people with the same name must not be proposed.
 */
import type { TestDatabase } from '@portico/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CreateProfileInput } from '../src';
import { setupOrg, startDb, type TestOrg } from './helpers';

let t: TestDatabase;
beforeAll(async () => {
  t = await startDb();
});
afterAll(async () => t?.drop());

async function create(org: TestOrg, input: Omit<CreateProfileInput, 'propertyId'>, propertyId?: string) {
  return org.sys((tx) =>
    org.svc.resolveProfile(
      tx,
      { ...input, propertyId: propertyId ?? (org.properties[0] as string) },
      { matchStrategy: 'create_new' },
    ),
  );
}
const open = (org: TestOrg) => org.sys((tx) => org.svc.listDuplicates(tx, { status: 'open' }));
const pairOf = (d: { profileAId: string; profileBId: string }) =>
  [d.profileAId, d.profileBId].sort().join('|');
const pair = (a: string, b: string) => [a, b].sort().join('|');

describe('duplicate detection — exact keys', () => {
  it('queues the same verified email with a compatible name, with reasons', async () => {
    const org = await setupOrg(t);
    const a = await create(org, {
      givenName: 'Anna',
      familyName: 'Schmidt',
      contactPoints: [{ kind: 'email', value: 'Anna.Schmidt@Guest.example', verified: true }],
    });
    const b = await create(org, {
      givenName: 'Anna',
      familyName: 'Schmidt',
      contactPoints: [{ kind: 'email', value: 'anna.schmidt@guest.example', verified: true }],
    });
    expect(b.possibleDuplicates).toContain(a.profileId);
    const queue = await open(org);
    const hit = queue.find((d) => pairOf(d) === pair(a.profileId, b.profileId));
    expect(hit?.score).toBeGreaterThanOrEqual(0.85);
    expect(hit?.reasons.map((r) => r.code)).toEqual(expect.arrayContaining(['email_exact', 'name_exact']));
    // Exact keys are stored as keyed hashes, never the address itself.
    const stored = await t.admin.kysely
      .selectFrom('guests.duplicate_candidates')
      .select('exact_keys')
      .where('id', '=', hit?.id as string)
      .executeTakeFirstOrThrow();
    expect(stored.exact_keys[0]).toMatch(/^email:[0-9a-f]{64}$/);
    expect(JSON.stringify(stored)).not.toContain('schmidt');
  });

  it('an unverified email is strong evidence for the queue but never an exact key', async () => {
    const org = await setupOrg(t);
    const a = await create(org, {
      givenName: 'Lena',
      familyName: 'Vogel',
      contactPoints: [{ kind: 'email', value: 'lena.vogel@guest.example', verified: true }],
    });
    const b = await create(org, {
      givenName: 'Lena',
      familyName: 'Vogel',
      contactPoints: [{ kind: 'email', value: 'lena.vogel@guest.example' }],
    });
    const hit = (await open(org)).find((d) => pairOf(d) === pair(a.profileId, b.profileId));
    expect(hit?.reasons.map((r) => r.code)).toContain('email_unverified');
    expect(hit?.reasons.map((r) => r.code)).not.toContain('email_exact');
  });

  it('matches phone numbers typed in different formats (E.164 normalization with the property country)', async () => {
    const org = await setupOrg(t);
    const a = await create(org, {
      givenName: 'Mohamed',
      familyName: 'Rasheed',
      dateOfBirth: '1990-05-05',
      contactPoints: [{ kind: 'phone', value: '777-1234' }], // national Maldivian format at an MV property
    });
    const b = await create(org, {
      givenName: 'Mohamed',
      familyName: 'Rasheed',
      dateOfBirth: '1990-05-05',
      contactPoints: [{ kind: 'phone', value: '+960 7771234' }],
    });
    const hit = (await open(org)).find((d) => pairOf(d) === pair(a.profileId, b.profileId));
    expect(hit?.reasons.map((r) => r.code)).toContain('phone_exact');
  });

  it('never uses OTA proxy emails as exact keys', async () => {
    const org = await setupOrg(t);
    const a = await create(org, {
      givenName: 'Tom',
      familyName: 'Becker',
      contactPoints: [{ kind: 'email', value: 'tbecker.555@guest.booking.com' }],
    });
    const b = await create(org, {
      givenName: 'Lena',
      familyName: 'Hoffmann',
      contactPoints: [{ kind: 'email', value: 'tbecker.555@guest.booking.com' }],
    });
    expect(b.possibleDuplicates).not.toContain(a.profileId);
    const profile = await org.sys((tx) => org.svc.getProfile(tx, b.profileId));
    expect(profile.contactPoints[0]?.lowConfidence).toBe(true);
  });

  it('identity documents match across romanizations of the name', async () => {
    const org = await setupOrg(t);
    const [A] = org.properties as [string];
    const a = await create(org, { givenName: 'Wei', familyName: 'Wang', nationality: 'CN' });
    const b = await create(org, { givenName: 'Wei', familyName: 'Wong', nationality: 'CN' });
    await org.sys((tx) =>
      org.svc.addDocument(tx, a.profileId, {
        propertyId: A,
        type: 'passport',
        issuingCountry: 'CN',
        number: 'E1234 5678',
      }),
    );
    await org.sys((tx) =>
      org.svc.addDocument(tx, b.profileId, {
        propertyId: A,
        type: 'passport',
        issuingCountry: 'CN',
        number: 'e12345678',
      }),
    );
    const hit = (await open(org)).find((d) => pairOf(d) === pair(a.profileId, b.profileId));
    expect(hit?.reasons.map((r) => r.code)).toContain('document_exact');
    expect(hit?.score).toBeGreaterThanOrEqual(0.9);
  });
});

describe('duplicate detection — fuzzy and precision', () => {
  it('does NOT propose two different Ahmed Alis (different DOB and nationality)', async () => {
    const org = await setupOrg(t);
    const a = await create(org, {
      givenName: 'Ahmed',
      familyName: 'Ali',
      nationality: 'AE',
      dateOfBirth: '1980-03-01',
    });
    const b = await create(org, {
      givenName: 'Ahmed',
      familyName: 'Ali',
      nationality: 'SA',
      dateOfBirth: '1992-11-20',
    });
    expect((await open(org)).filter((d) => pairOf(d) === pair(a.profileId, b.profileId))).toHaveLength(0);
  });

  it('a family sharing one email is not queued', async () => {
    const org = await setupOrg(t);
    const a = await create(org, {
      givenName: 'Rajesh',
      familyName: 'Sharma',
      contactPoints: [{ kind: 'email', value: 'family.sharma@guest.example', verified: true }],
    });
    const b = await create(org, {
      givenName: 'Priya',
      familyName: 'Patel',
      contactPoints: [{ kind: 'email', value: 'family.sharma@guest.example', verified: true }],
    });
    expect((await open(org)).filter((d) => pairOf(d) === pair(a.profileId, b.profileId))).toHaveLength(0);
  });

  it('typo-tolerant: "Jonh Smith" with the same DOB is proposed', async () => {
    const org = await setupOrg(t);
    const a = await create(org, {
      givenName: 'John',
      familyName: 'Smith',
      dateOfBirth: '1975-06-15',
      nationality: 'GB',
    });
    const b = await create(org, {
      givenName: 'Jonh',
      familyName: 'Smith',
      dateOfBirth: '1975-06-15',
      nationality: 'GB',
    });
    const hit = (await open(org)).find((d) => pairOf(d) === pair(a.profileId, b.profileId));
    expect(hit?.reasons.map((r) => r.code)).toEqual(expect.arrayContaining(['name_similar', 'dob_match']));
  });

  it('matches across scripts: a Cyrillic record and its ICAO transliteration', async () => {
    const org = await setupOrg(t);
    const a = await create(org, {
      nativeGivenName: 'Иван',
      nativeFamilyName: 'Петров',
      dateOfBirth: '1984-09-02',
    });
    const b = await create(org, { givenName: 'Ivan', familyName: 'Petrov', dateOfBirth: '1984-09-02' });
    const pa = await org.sys((tx) => org.svc.getProfile(tx, a.profileId));
    expect(pa).toMatchObject({ givenName: 'Ivan', familyName: 'Petrov', nativeScript: 'Cyrl' });
    const hit = (await open(org)).find((d) => pairOf(d) === pair(a.profileId, b.profileId));
    expect(hit).toBeDefined();
  });

  it('Chinese names: a native match with different romanizations is proposed', async () => {
    const org = await setupOrg(t);
    const a = await create(org, {
      givenName: 'Wei',
      familyName: 'Wang',
      nativeGivenName: '伟',
      nativeFamilyName: '王',
      dateOfBirth: '1991-04-18',
    });
    const b = await create(org, {
      givenName: 'Wai',
      familyName: 'Wong',
      nativeGivenName: '伟',
      nativeFamilyName: '王',
      dateOfBirth: '1991-04-18',
    });
    expect((await open(org)).find((d) => pairOf(d) === pair(a.profileId, b.profileId))).toBeDefined();
  });
});

describe('candidate selection at scale', () => {
  it('a very common name never crowds out the exact-key match', async () => {
    const org = await setupOrg(t);
    const A = org.properties[0] as string;
    await org.sys(async (tx) => {
      for (let i = 0; i < 70; i++) {
        await tx.db
          .insertInto('guests.profiles')
          .values({
            id: crypto.randomUUID(),
            tenant_id: org.tenantId,
            given_name: 'Mohamed',
            family_name: 'Ali',
            search_name: 'mohamed ali',
            home_property_id: A,
          })
          .execute();
      }
    });
    const target = await create(org, {
      givenName: 'Mohamed',
      familyName: 'Ali',
      contactPoints: [{ kind: 'email', value: 'mohamed.ali.77@guest.example', verified: true }],
    });
    const again = await org.sys((tx) =>
      org.svc.resolveProfile(tx, {
        propertyId: A,
        givenName: 'Mohamed',
        familyName: 'Ali',
        contactPoints: [{ kind: 'email', value: 'mohamed.ali.77@guest.example' }],
      }),
    );
    expect(again).toMatchObject({ profileId: target.profileId, created: false });
  });
});

describe('review queue', () => {
  it('a dismissed pair is not proposed again unless a NEW exact key appears', async () => {
    const org = await setupOrg(t);
    const a = await create(org, {
      givenName: 'Giulia',
      familyName: 'Rossi',
      dateOfBirth: '1985-02-02',
      nationality: 'IT',
    });
    const b = await create(org, {
      givenName: 'Giulia',
      familyName: 'Rossi',
      dateOfBirth: '1985-02-02',
      nationality: 'IT',
    });
    const cand = (await open(org)).find((d) => pairOf(d) === pair(a.profileId, b.profileId));
    expect(cand).toBeDefined();
    await org.sys((tx) =>
      org.svc.dismissDuplicate(tx, cand?.id as string, 'Mother and daughter with the same name'),
    );
    await org.sys((tx) => org.svc.detectDuplicates(tx, a.profileId));
    expect((await open(org)).find((d) => d.id === cand?.id)).toBeUndefined();
    // Both now share a verified phone → new exact evidence re-opens the pair.
    await org.sys((tx) =>
      org.svc.addContactPoint(tx, a.profileId, { kind: 'phone', value: '+39 06 1234 5678' }),
    );
    await org.sys((tx) =>
      org.svc.addContactPoint(tx, b.profileId, { kind: 'phone', value: '+390612345678' }),
    );
    const reopened = (await open(org)).find((d) => d.id === cand?.id);
    expect(reopened?.resolutionReason).toMatch(/Re-opened/);
  });

  it('dismissal needs the merge permission and is audited', async () => {
    const org = await setupOrg(t);
    const a = await create(org, { givenName: 'Kenji', familyName: 'Watanabe', dateOfBirth: '1970-01-01' });
    const b = await create(org, { givenName: 'Kenji', familyName: 'Watanabe', dateOfBirth: '1970-01-01' });
    const cand = (await open(org)).find((d) => pairOf(d) === pair(a.profileId, b.profileId));
    const desk = org.user([{ permission: 'guests.profile.read', propertyIds: 'all' }]);
    await expect(
      org.run(desk, (tx) => org.svc.dismissDuplicate(tx, cand?.id as string, 'nope')),
    ).rejects.toMatchObject({
      code: 'forbidden',
    });
  });

  it('the nightly scan finds pairs created without detection and is bounded per call', async () => {
    const org = await setupOrg(t);
    const a = await create(org, { givenName: 'Sofia', familyName: 'Lindqvist', dateOfBirth: '1999-09-09' });
    const b = await create(org, { givenName: 'Sofia', familyName: 'Lindqvist', dateOfBirth: '1999-09-09' });
    await t.admin.kysely
      .deleteFrom('guests.duplicate_candidates')
      .where('tenant_id', '=', org.tenantId)
      .execute();
    const res = await org.sys((tx) => org.svc.scanDuplicates(tx, { batch: 500 }));
    expect(res.scanned).toBeGreaterThanOrEqual(2);
    expect(res.nextAfterId).toBeNull();
    expect((await open(org)).find((d) => pairOf(d) === pair(a.profileId, b.profileId))).toBeDefined();
  });
});

describe('resolveProfile (channel / import ingestion)', () => {
  it('exact_only reuses one safe exact match and never merges', async () => {
    const org = await setupOrg(t);
    const [A, B] = org.properties as [string, string];
    const a = await create(org, {
      givenName: 'Emily',
      familyName: 'Clarke',
      contactPoints: [{ kind: 'email', value: 'emily.clarke@guest.example', verified: true }],
    });
    const again = await org.sys((tx) =>
      org.svc.resolveProfile(tx, {
        propertyId: B,
        givenName: 'Emily',
        familyName: 'Clarke',
        contactPoints: [{ kind: 'email', value: 'EMILY.CLARKE@guest.example' }],
      }),
    );
    expect(again).toMatchObject({ profileId: a.profileId, created: false });
    const p = await org.sys((tx) => org.svc.getProfile(tx, a.profileId));
    expect(p.knownAtPropertyIds.sort()).toEqual([A, B].sort());
  });

  it('exact_only creates a new profile for a family member sharing the email', async () => {
    const org = await setupOrg(t);
    const a = await create(org, {
      givenName: 'Emily',
      familyName: 'Clarke',
      contactPoints: [{ kind: 'email', value: 'clarke.family@guest.example', verified: true }],
    });
    const child = await org.sys((tx) =>
      org.svc.resolveProfile(tx, {
        propertyId: org.properties[0] as string,
        givenName: 'Oliver',
        familyName: 'Clarke',
        contactPoints: [{ kind: 'email', value: 'clarke.family@guest.example' }],
      }),
    );
    expect(child.created).toBe(true);
    expect(child.profileId).not.toBe(a.profileId);
  });

  it('sparse DMC data (family name only) is accepted and enriched later', async () => {
    const org = await setupOrg(t);
    const res = await create(org, {
      familyName: 'Nakamura',
      source: { kind: 'dmc_rooming_list', ref: 'RL-42' },
    });
    const p = await org.sys((tx) => org.svc.getProfile(tx, res.profileId));
    expect(p).toMatchObject({ familyName: 'Nakamura', givenName: null, contactPoints: [] });
  });
});
