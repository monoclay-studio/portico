/**
 * Focused re-review R2 (review-guests-erasure-fix.md): the erasure safety net must hit exactly the person's copies
 * and nothing else (R2-P2-1), and writes racing an erasure must never leave personal data behind (R2-P2-2).
 * The reviewer's PoCs are inverted here: each asserts the attack is refused.
 */
import { runIdempotent, sql } from '@portico/db';
import { newId } from '@portico/kernel';
import type { TestDatabase } from '@portico/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { guestsReplayPlans } from '../src/replay';
import { auditRows, makeService, platformPort, setupOrg, startDb, type TestOrg } from './helpers';

let t: TestDatabase;
beforeAll(async () => {
  t = await startDb();
});
afterAll(async () => t?.drop());

async function newGuest(
  org: TestOrg,
  contacts: Array<{ kind: 'email' | 'phone' | 'address'; value: string }>,
  names: { givenName: string; familyName: string } = { givenName: 'Quilla', familyName: 'Erasemeplease' },
) {
  const r = await org.sys((tx) =>
    org.svc.createProfile(tx, {
      propertyId: org.properties[0] as string,
      ...names,
      dateOfBirth: '1981-02-03',
      matchStrategy: 'create_new',
      contactPoints: contacts,
    }),
  );
  return r.profile.id;
}

/** Another module's endpoint that stores its response as-is (no replay plan). */
const otherModule = (org: TestOrg, key: string, body: unknown) =>
  runIdempotent(t.db, org.admin, { scope: 'POST /other/thing', key, request: { key } }, async () => ({
    status: 201,
    body,
  }));
const replayStatus = (org: TestOrg, key: string) =>
  otherModule(org, key, {}).then(
    (r) => (r.replayed ? 'kept' : 'missing'),
    (e: { status?: number }) => (e.status === 410 ? 'erased' : `error ${e.status}`),
  );
const erase = (org: TestOrg, profileId: string) =>
  org.sys((tx) => org.svc.eraseProfile(tx, { kind: 'erasure', profileId, reason: 'Erasure request' }));

describe('R2-P2-1: the safety net hits only the person’s exact identifiers', () => {
  it('an address contact never redacts an unrelated record (time-zone collision)', async () => {
    const org = await setupOrg(t);
    const k = newId();
    await otherModule(org, k, { id: newId(), name: 'Property 0', timezone: 'Indian/Maldives' });
    const pid = await newGuest(org, [{ kind: 'address', value: 'Maldives' }]);
    await erase(org, pid);
    expect(await replayStatus(org, k)).toBe('kept');
  });

  it('a local phone number as typed never redacts an amount that contains its digits', async () => {
    const org = await setupOrg(t);
    const k = newId();
    await otherModule(org, k, { postingId: newId(), amount: { amountMinor: 17771234, currency: 'USD' } });
    const k2 = newId();
    await otherModule(org, k2, { reference: 'INV-17771234' });
    const pid = await newGuest(org, [{ kind: 'phone', value: '7771234' }]); // normalized +9607771234 at an MV property
    await erase(org, pid);
    expect(await replayStatus(org, k)).toBe('kept');
    expect(await replayStatus(org, k2)).toBe('kept');
  });

  it('a shared email never redacts the records of another guest on legal hold', async () => {
    const org = await setupOrg(t);
    const shared = 'family.bookings@guest.example';
    const erased = await newGuest(org, [{ kind: 'email', value: shared }]);
    const held = await newGuest(org, [{ kind: 'email', value: shared }], {
      givenName: 'Other',
      familyName: 'Person',
    });
    await org.sys((tx) => org.svc.setLegalHold(tx, held, { hold: true, reason: 'Litigation hold on file' }));
    const kHeldById = newId();
    await otherModule(org, kHeldById, {
      payer: { type: 'guest_profile', id: held, email: shared },
      amountMinor: 5000,
    });
    const kHeldByEmail = newId();
    await otherModule(org, kHeldByEmail, { contact: shared });
    const kErased = newId();
    await otherModule(org, kErased, { bookerProfileId: erased });
    await erase(org, erased);
    expect(await replayStatus(org, kHeldById)).toBe('kept');
    expect(await replayStatus(org, kHeldByEmail)).toBe('kept'); // the shared value is not used while a holder is held
    expect(await replayStatus(org, kErased)).toBe('erased'); // the person's own id still is
  });

  it('a planted contact value cannot deny replays of unrelated records (griefing)', async () => {
    const org = await setupOrg(t);
    const paymentId = `pay_${newId()}`;
    const kPayment = newId();
    await otherModule(org, kPayment, { paymentId, status: 'captured' });
    const kText = newId();
    await otherModule(org, kText, { note: 'Contact grief@guest.example for details' });
    // A dummy guest whose "address" and "phone" are the target values, plus an email that appears only inside text.
    const dummy = await newGuest(
      org,
      [
        { kind: 'address', value: paymentId },
        { kind: 'phone', value: paymentId },
        { kind: 'email', value: 'grief@guest.example' },
      ],
      { givenName: 'Dummy', familyName: 'Guest' },
    );
    await erase(org, dummy);
    expect(await replayStatus(org, kPayment)).toBe('kept');
    expect(await replayStatus(org, kText)).toBe('kept');
  });

  it('re-attack — real copies are still found: mixed-case email, E.164 phone, merged-in id, nested values', async () => {
    const org = await setupOrg(t);
    const pid = await newGuest(org, [
      { kind: 'email', value: 'quilla.erasemeplease@guest.example' },
      { kind: 'phone', value: '+960 777 1234' },
    ]);
    const dup = await newGuest(org, [], { givenName: 'Quilla', familyName: 'Erasemeplease' });
    await org.sys((tx) =>
      org.svc.mergeProfiles(tx, { survivorId: pid, mergedId: dup, reason: 'Same guest' }),
    );
    const keys = {
      mixedCase: newId(),
      e164: newId(),
      mergedId: newId(),
      nested: newId(),
    };
    await otherModule(org, keys.mixedCase, { payer: { email: 'Quilla.Erasemeplease@Guest.Example' } });
    await otherModule(org, keys.e164, { contact: '+9607771234' });
    await otherModule(org, keys.mergedId, { bookerProfileId: dup });
    await otherModule(org, keys.nested, { stays: [{ occupants: [{ profileId: pid }] }] });
    await erase(org, pid);
    for (const [name, key] of Object.entries(keys)) expect(await replayStatus(org, key), name).toBe('erased');
  });

  it('re-attack — near misses stay: longer email, longer phone, same digits as a number, other tenant', async () => {
    const org = await setupOrg(t);
    const other = await setupOrg(t);
    const pid = await newGuest(org, [
      { kind: 'email', value: 'qe@guest.example' },
      { kind: 'phone', value: '+960 777 1234' },
    ]);
    const keys = { longerEmail: newId(), longerPhone: newId(), numeric: newId() };
    await otherModule(org, keys.longerEmail, { email: 'aqe@guest.example' });
    await otherModule(org, keys.longerPhone, { contact: '+96077712345' });
    await otherModule(org, keys.numeric, { amountMinor: 9607771234 });
    const kOther = newId();
    await otherModule(other, kOther, { email: 'qe@guest.example', profileId: pid });
    await erase(org, pid);
    for (const [name, key] of Object.entries(keys)) expect(await replayStatus(org, key), name).toBe('kept');
    expect(await replayStatus(other, kOther)).toBe('kept');
  });

  it('erasure counts only the records it really redacted', async () => {
    const org = await setupOrg(t);
    const pid = await newGuest(org, [{ kind: 'email', value: 'count.me@guest.example' }]);
    await otherModule(org, newId(), { profileId: pid });
    await otherModule(org, newId(), { timezone: 'Indian/Maldives' });
    const res = await erase(org, pid);
    expect((res.result as { counts: { idempotencyResponses: number } }).counts.idempotencyResponses).toBe(1);
  });
});

describe('R2-P2-2: a write racing an erasure never leaves personal data behind', () => {
  it('writer first: the erasure waits for it, then erases what it wrote', async () => {
    let arm = false;
    let reached: () => void = () => {};
    const atGate = new Promise<void>((r) => {
      reached = r;
    });
    let open: () => void = () => {};
    const gate = new Promise<void>((r) => {
      open = r;
    });
    const base = platformPort();
    const svc = makeService({
      platform: {
        ...base,
        assertWritable: async (tx, propertyId, domain) => {
          if (arm) {
            arm = false;
            reached();
            await gate; // the writer holds the profile lock here
          }
          return base.assertWritable(tx, propertyId, domain);
        },
      },
    });
    const org = await setupOrg(t, { svc });
    const pid = await newGuest(org, [{ kind: 'email', value: 'first@guest.example' }]);
    arm = true;
    const writer = org.sys((tx) =>
      org.svc.addContactPoint(tx, pid, { kind: 'email', value: 'late@guest.example' }),
    );
    await atGate;
    let erased = false;
    const erasure = erase(org, pid).then((r) => {
      erased = true;
      return r;
    });
    await new Promise((r) => setTimeout(r, 300));
    expect(erased).toBe(false); // blocked on the writer's profile lock
    open();
    await writer;
    await erasure;
    const { rows } = await sql<{ n: number }>`
      select count(*)::int as n from guests.contact_points where profile_id = ${pid}`.execute(t.admin.kysely);
    expect(rows[0]?.n).toBe(0);
  });

  it('erasure first: every sibling writer is refused and writes nothing', async () => {
    const org = await setupOrg(t);
    const [A] = org.properties as [string];
    const pid = await newGuest(org, [{ kind: 'email', value: 'siblings@guest.example' }]);
    const other = await newGuest(org, [], { givenName: 'Some', familyName: 'Relative' });
    const company = await org.sys((tx) =>
      org.svc.createCompany(tx, { kind: 'company', legalName: 'Race Co' }),
    );
    const profile = await org.sys((tx) => org.svc.getProfile(tx, pid));
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    let erasedNow: () => void = () => {};
    const didErase = new Promise<void>((r) => {
      erasedNow = r;
    });
    const erasure = org.sys(async (tx) => {
      await org.svc.eraseProfile(tx, { kind: 'erasure', profileId: pid, reason: 'race' });
      erasedNow();
      await gate;
    });
    await didErase;
    const writers: Record<string, () => Promise<unknown>> = {
      contact: () =>
        org.sys((tx) => org.svc.addContactPoint(tx, pid, { kind: 'email', value: 'x@guest.example' })),
      preference: () =>
        org.sys((tx) => org.svc.addPreference(tx, pid, { category: 'pillow', value: 'Soft' })),
      alert: () =>
        org.sys((tx) =>
          org.svc.addAlert(tx, pid, {
            propertyId: A,
            severity: 'info',
            text: 'Late alert',
            visibility: 'shared',
          }),
        ),
      note: () => org.sys((tx) => org.svc.addNote(tx, pid, { visibility: 'shared', body: 'Late note' })),
      relationship: () =>
        org.sys((tx) => org.svc.addRelationship(tx, other, { relatedProfileId: pid, kind: 'spouse' })),
      consent: () =>
        org.sys((tx) =>
          org.svc.recordConsent(tx, pid, {
            propertyId: A,
            purpose: 'marketing_sms',
            state: 'withdrawn',
            source: 'desk',
            evidence: {},
          }),
        ),
      document: () =>
        org.sys((tx) =>
          org.svc.addDocument(tx, pid, {
            propertyId: A,
            type: 'passport',
            issuingCountry: 'MV',
            number: 'RACE12345',
          }),
        ),
      specialNeed: () =>
        org.sys((tx) =>
          org.svc.addSpecialNeed(tx, pid, { propertyId: A, category: 'medical', detail: 'Late detail' }),
        ),
      legalHold: () => org.sys((tx) => org.svc.setLegalHold(tx, pid, { hold: true, reason: 'late hold' })),
      update: () => org.sys((tx) => org.svc.updateProfile(tx, pid, profile.version, { vipLevel: 'vip1' })),
      companyContact: () =>
        org.sys((tx) => org.svc.addCompanyContact(tx, company.id, { profileId: pid, role: 'booker' })),
    };
    const pending = Object.entries(writers).map(([name, run]) =>
      run().then(
        () => [name, 'committed'] as const,
        (e: { code?: string; status?: number }) => [name, e.code ?? String(e.status)] as const,
      ),
    );
    await new Promise((r) => setTimeout(r, 300));
    release();
    await erasure;
    const results = Object.fromEntries(await Promise.all(pending));
    for (const [name, outcome] of Object.entries(results)) {
      expect(
        ['profile_anonymized', 'version_conflict', 'guest_profile_not_found'],
        `${name}: ${outcome}`,
      ).toContain(outcome);
    }
    const counts = await sql<{ t: string; n: number }>`
      select 'contacts' as t, count(*)::int as n from guests.contact_points where profile_id = ${pid}
      union all select 'prefs', count(*)::int from guests.preferences where profile_id = ${pid}
      union all select 'alerts', count(*)::int from guests.alerts where profile_id = ${pid}
      union all select 'docs', count(*)::int from guests.identity_documents where profile_id = ${pid}
      union all select 'needs', count(*)::int from guests.special_needs where profile_id = ${pid}
      union all select 'rels', count(*)::int from guests.relationships where related_profile_id = ${pid}
      union all select 'company', count(*)::int from guests.company_contacts where profile_id = ${pid}
      union all select 'consents', count(*)::int from guests.consents where profile_id = ${pid}
      union all select 'notes', count(*)::int from guests.notes where profile_id = ${pid} and redacted_at is null`.execute(
      t.admin.kysely,
    );
    expect(Object.fromEntries(counts.rows.map((r) => [r.t, r.n]))).toEqual({
      contacts: 0,
      prefs: 0,
      alerts: 0,
      docs: 0,
      needs: 0,
      rels: 0,
      company: 0,
      consents: 0,
      notes: 0,
    });
    const p = await t.admin.kysely
      .selectFrom('guests.profiles')
      .select(['status', 'legal_hold', 'vip_level'])
      .where('id', '=', pid)
      .executeTakeFirstOrThrow();
    expect(p).toEqual({ status: 'anonymized', legal_hold: false, vip_level: null });
  });

  it('a mirror sync racing an erasure never writes the person back', async () => {
    const org = await setupOrg(t);
    const [A] = org.properties as [string];
    const connectionId = newId();
    const mirror = (given: string) =>
      org.sys((tx) =>
        org.svc.upsertMirroredProfile(tx, {
          connectionId,
          systemName: 'Legacy PMS (simulated)',
          externalId: 'G-RACE',
          propertyId: A,
          syncedAt: new Date('2026-11-07T06:00:00Z'),
          profile: { givenName: given, familyName: 'Mirrorrace' },
        }),
      );
    const { profileId } = await mirror('Quilla');
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    let erasedNow: () => void = () => {};
    const didErase = new Promise<void>((r) => {
      erasedNow = r;
    });
    // Hold the erasure open after it erased, but BEFORE it removed the mirror mapping is impossible to separate,
    // so race the sync's profile write instead: the sync found the mapping before the erasure committed.
    const erasure = org.sys(async (tx) => {
      await org.svc.eraseProfile(tx, { kind: 'erasure', profileId, reason: 'race' });
      erasedNow();
      await gate;
    });
    await didErase;
    const sync = mirror('Quilla').then(
      (r) => r,
      (e: { code?: string }) => e.code,
    );
    await new Promise((r) => setTimeout(r, 200));
    release();
    await erasure;
    await sync;
    const row = await t.admin.kysely
      .selectFrom('guests.profiles')
      .select(['given_name', 'family_name', 'status'])
      .where('id', '=', profileId)
      .executeTakeFirstOrThrow();
    expect(row.status).toBe('anonymized');
    expect(row.given_name).toBeNull();
    expect(row.family_name).not.toBe('Mirrorrace');
  });

  it('a channel booking racing an erasure never reuses the erased profile', async () => {
    const org = await setupOrg(t);
    const [A] = org.properties as [string];
    const pid = await newGuest(org, [{ kind: 'phone', value: '+9607771111' }]);
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    let erasedNow: () => void = () => {};
    const didErase = new Promise<void>((r) => {
      erasedNow = r;
    });
    const erasure = org.sys(async (tx) => {
      await org.svc.eraseProfile(tx, { kind: 'erasure', profileId: pid, reason: 'race' });
      erasedNow();
      await gate;
    });
    await didErase;
    const booking = org.sys((tx) =>
      org.svc.resolveProfile(tx, {
        propertyId: A,
        givenName: 'Quilla',
        familyName: 'Erasemeplease',
        contactPoints: [{ kind: 'phone', value: '+9607771111' }],
      }),
    );
    await new Promise((r) => setTimeout(r, 200));
    release();
    await erasure;
    const res = await booking;
    expect(res.profileId).not.toBe(pid);
    const { rows } = await sql<{ n: number }>`
      select count(*)::int as n from guests.contact_points where profile_id = ${pid}`.execute(t.admin.kysely);
    expect(rows[0]?.n).toBe(0);
  });
});

describe('invariant closure: repeat and inverse operations', () => {
  it('inverse (unmerge): erasing the survivor after an unmerge never redacts the restored person’s records', async () => {
    const org = await setupOrg(t);
    const survivor = await newGuest(org, [{ kind: 'email', value: 'survivor.person@guest.example' }]);
    const restored = await newGuest(org, [{ kind: 'email', value: 'restored.person@guest.example' }], {
      givenName: 'Restored',
      familyName: 'Person',
    });
    const { mergeId } = await org.sys((tx) =>
      org.svc.mergeProfiles(tx, { survivorId: survivor, mergedId: restored, reason: 'mistake' }),
    );
    await org.sys((tx) => org.svc.unmergeProfiles(tx, { mergeId, reason: 'Different people' }));
    const kRestoredId = newId();
    await otherModule(org, kRestoredId, { bookerProfileId: restored });
    const kRestoredEmail = newId();
    await otherModule(org, kRestoredEmail, { email: 'restored.person@guest.example' });
    const kSurvivor = newId();
    await otherModule(org, kSurvivor, { email: 'survivor.person@guest.example' });
    await erase(org, survivor);
    expect(await replayStatus(org, kRestoredId)).toBe('kept');
    expect(await replayStatus(org, kRestoredEmail)).toBe('kept');
    expect(await replayStatus(org, kSurvivor)).toBe('erased');
  });

  it('repeat: a second erasure (another subject) never touches erased markers; erasing twice is refused', async () => {
    const org = await setupOrg(t);
    const a = await newGuest(org, [{ kind: 'email', value: 'first.subject@guest.example' }]);
    const b = await newGuest(org, [{ kind: 'email', value: 'second.subject@guest.example' }], {
      givenName: 'Second',
      familyName: 'Subject',
    });
    const kA = newId();
    await otherModule(org, kA, { profileId: a });
    const first = await erase(org, a);
    expect((first.result as { counts: { idempotencyResponses: number } }).counts.idempotencyResponses).toBe(
      1,
    );
    const marker = await t.admin.kysely
      .selectFrom('core.idempotency_keys')
      .select(['response_body', 'request_hash'])
      .where('key', '=', kA)
      .executeTakeFirstOrThrow();
    expect(marker).toEqual({ response_body: { $erased: true }, request_hash: 'erased' });
    const second = await erase(org, b);
    expect((second.result as { counts: { idempotencyResponses: number } }).counts.idempotencyResponses).toBe(
      0,
    );
    await expect(erase(org, a)).rejects.toMatchObject({ code: 'already_anonymized' });
    expect(await replayStatus(org, kA)).toBe('erased');
  });

  it('inverse (hold released): once the held guest is released, the shared email identifies the erased person again', async () => {
    const org = await setupOrg(t);
    const shared = 'family.release@guest.example';
    const held = await newGuest(org, [{ kind: 'email', value: shared }], {
      givenName: 'Held',
      familyName: 'Member',
    });
    const erased = await newGuest(org, [{ kind: 'email', value: shared }]);
    await org.sys((tx) => org.svc.setLegalHold(tx, held, { hold: true, reason: 'Litigation hold on file' }));
    await org.sys((tx) => org.svc.setLegalHold(tx, held, { hold: false, reason: 'Litigation closed' }));
    const k = newId();
    await otherModule(org, k, { contact: shared });
    await erase(org, erased);
    expect(await replayStatus(org, k)).toBe('erased');
  });
});

describe('R2-P3: replay and reason details', () => {
  it('replayed duplicate suggestions are re-checked against the caller’s current visibility', async () => {
    const org = await setupOrg(t);
    const [A, B] = org.properties as [string, string];
    const plans = guestsReplayPlans(org.svc);
    const atB = await org.sys((tx) =>
      org.svc.resolveProfile(
        tx,
        {
          propertyId: B,
          givenName: 'Dupe',
          familyName: 'Candidate',
          contactPoints: [{ kind: 'email', value: 'dup.check@guest.example', verified: true }],
        },
        { matchStrategy: 'create_new' },
      ),
    );
    const uid = newId();
    const grants = (shared: boolean) =>
      org.user(
        [
          { permission: 'guests.profile.update', propertyIds: [A] },
          { permission: 'guests.profile.read', propertyIds: [A] },
          ...(shared ? [{ permission: 'guests.profile.readShared', propertyIds: [A] }] : []),
        ],
        uid,
      );
    const input = {
      propertyId: A,
      givenName: 'Dupe',
      familyName: 'Candidate',
      matchStrategy: 'create_new' as const,
      contactPoints: [{ kind: 'email' as const, value: 'dup.check@guest.example' }],
    };
    const key = newId();
    const call = (ctx: ReturnType<typeof grants>) =>
      runIdempotent(
        t.db,
        ctx,
        { scope: 'POST /guests/profiles', key, request: input },
        async (tx) => ({ status: 201, body: await org.svc.createProfile(tx, input) }),
        { replay: plans.createProfile(A) },
      );
    const first = await call(grants(true));
    expect(first.body.possibleDuplicates.map((d) => d.profileId)).toContain(atB.profileId);
    const again = await call(grants(false));
    expect(again.replayed).toBe(true);
    expect(again.body.possibleDuplicates.map((d) => d.profileId)).not.toContain(atB.profileId);
  });

  it('reasons are scrubbed on whole words: two-letter names count, longer words are left alone', async () => {
    const org = await setupOrg(t);
    const pid = await newGuest(org, [], { givenName: 'Ann', familyName: 'Li' });
    await org.sys((tx) =>
      org.svc.setLegalHold(tx, pid, {
        hold: true,
        reason: 'Ann LI is on annual leave; Annual audit by Lisa',
      }),
    );
    const audit = await auditRows(t, org.tenantId, { action: 'guests.legalHold.set' });
    expect(audit[0]?.reason).toBe('[guest] [guest] is on annual leave; Annual audit by Lisa');
  });
});
