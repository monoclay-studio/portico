/**
 * Consent and data-subject requests (GUE-R06, R17, R18; readiness brief §12): consent is not the basis for
 * operations; withdrawal never deletes legally retained financial references; export is complete and audited;
 * erasure anonymizes personal data, keeps pseudonymous financial references and is blocked by legal hold.
 */
import { runIdempotent, sql } from '@portico/db';
import type { TestDatabase } from '@portico/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { guestsReplayPlans } from '../src/replay';
import { auditRows, makeService, outboxRows, setupOrg, startDb, type TestOrg } from './helpers';

let t: TestDatabase;
beforeAll(async () => {
  t = await startDb();
});
afterAll(async () => t?.drop());

async function returningGuest(org: TestOrg) {
  const [A] = org.properties as [string];
  const { profileId } = await org.sys((tx) =>
    org.svc.resolveProfile(
      tx,
      {
        propertyId: A,
        givenName: 'Priya',
        familyName: 'Sharma',
        nationality: 'IN',
        dateOfBirth: '1989-01-26',
        contactPoints: [
          { kind: 'email', value: 'priya.sharma@guest.example', verified: true },
          { kind: 'phone', value: '+91 98765 43210' },
        ],
      },
      { matchStrategy: 'create_new' },
    ),
  );
  const stayId = crypto.randomUUID();
  const bookingId = crypto.randomUUID();
  await org.sys(async (tx) => {
    await org.svc.recordStayHistory(tx, {
      profileId,
      stayRef: { type: 'stay', id: stayId },
      bookingId,
      propertyId: A,
      arrival: '2026-02-01',
      departure: '2026-02-08',
      status: 'departed',
      revenue: { amountMinor: 1_234_500, currency: 'USD' },
    });
    await org.svc.addPreference(tx, profileId, { category: 'dietary', value: 'Jain vegetarian' });
    await org.svc.addNote(tx, profileId, { visibility: 'shared', body: 'Prefers a quiet villa' });
    await org.svc.addDocument(tx, profileId, {
      propertyId: A,
      type: 'passport',
      issuingCountry: 'IN',
      number: 'Z1234567',
    });
    await org.svc.recordConsent(tx, profileId, {
      propertyId: A,
      purpose: 'marketing_email',
      state: 'granted',
      source: 'booking_engine',
      evidence: { textVersion: 'mkt-v2', channel: 'booking_engine', reference: 'ip 203.0.113.9' },
    });
  });
  return { profileId, stayId, bookingId, A };
}

describe('staff-typed reasons (append-only audit log)', () => {
  it('a reason never carries the subject’s own name, contact or date of birth into the audit log', async () => {
    const org = await setupOrg(t);
    const { profileId } = await returningGuest(org);
    await org.sys((tx) =>
      org.svc.setLegalHold(tx, profileId, {
        hold: true,
        reason: 'Priya SHARMA (priya.sharma@guest.example, born 1989-01-26) disputes a charge',
      }),
    );
    const audit = await auditRows(t, org.tenantId, { action: 'guests.legalHold.set' });
    expect(audit[0]?.reason).toBe('[guest] [guest] ([guest], born [guest]) disputes a charge');
  });
});

describe('consent', () => {
  it('a grant needs evidence; marketing requires an explicit grant; operations never depend on consent', async () => {
    const org = await setupOrg(t);
    const { profileId, A } = await returningGuest(org);
    await expect(
      org.sys((tx) =>
        org.svc.recordConsent(tx, profileId, {
          propertyId: A,
          purpose: 'marketing_sms',
          state: 'granted',
          source: 'desk',
          evidence: {},
        }),
      ),
    ).rejects.toMatchObject({ code: 'consent_evidence_required' });
    const sms = await org.sys((tx) =>
      org.svc.getConsent(tx, { profileId, legalEntityId: org.legalEntityId, purpose: 'marketing_sms' }),
    );
    expect(sms).toMatchObject({ state: 'unknown', legalBasis: 'consent', mayProcess: false });
    const email = await org.sys((tx) =>
      org.svc.getConsent(tx, { profileId, legalEntityId: org.legalEntityId, purpose: 'marketing_email' }),
    );
    expect(email).toMatchObject({ state: 'granted', mayProcess: true });
    const sharing = await org.sys((tx) =>
      org.svc.getConsent(tx, {
        profileId,
        legalEntityId: org.legalEntityId,
        purpose: 'cross_property_sharing',
      }),
    );
    expect(sharing).toMatchObject({ state: 'unknown', legalBasis: 'legitimate_interests', mayProcess: true });
  });

  it('withdrawal keeps every legally retained financial reference and is recorded as evidence', async () => {
    const org = await setupOrg(t);
    const { profileId, stayId, A } = await returningGuest(org);
    const res = await org.sys((tx) =>
      org.svc.recordConsent(tx, profileId, {
        propertyId: A,
        purpose: 'marketing_email',
        state: 'withdrawn',
        source: 'unsubscribe_link',
        evidence: { channel: 'email' },
      }),
    );
    expect(res).toMatchObject({ state: 'withdrawn', mayProcess: false });
    const history = await org.sys((tx) => org.svc.getStayHistory(tx, profileId));
    expect(history.items).toEqual([
      expect.objectContaining({ stayId, revenue: { amountMinor: 1_234_500, currency: 'USD' } }),
    ]);
    const profile = await org.sys((tx) => org.svc.getProfile(tx, profileId));
    expect(profile.contactPoints).toHaveLength(2);
    expect(profile.documents).toHaveLength(1);
    const evidence = await org.sys((tx) => org.svc.consentHistory(tx, profileId));
    expect(evidence.map((e) => e.state)).toEqual(['granted', 'withdrawn']);
    const events = await outboxRows(t, org.tenantId, 'guests.consent.changed');
    expect(events.at(-1)?.payload).toMatchObject({ purpose: 'marketing_email', state: 'withdrawn' });
  });

  it('refuses a legal entity that is not one of the organization’s', async () => {
    const org = await setupOrg(t);
    const { profileId } = await returningGuest(org);
    await expect(
      org.sys((tx) =>
        org.svc.recordConsent(tx, profileId, {
          legalEntityId: crypto.randomUUID(),
          purpose: 'marketing_sms',
          state: 'withdrawn',
          source: 'desk',
          evidence: {},
        }),
      ),
    ).rejects.toMatchObject({ code: 'unknown_legal_entity' });
  });

  it('a signed-in guest may record their own consent, not someone else’s', async () => {
    const org = await setupOrg(t);
    const { profileId, A } = await returningGuest(org);
    const self = { ...org.user([]), actor: { kind: 'guest' as const, guestProfileId: profileId } };
    const res = await org.run(self, (tx) =>
      org.svc.recordConsent(tx, profileId, {
        propertyId: A,
        purpose: 'marketing_whatsapp',
        state: 'granted',
        source: 'guest_portal',
        evidence: { textVersion: 'wa-v1', channel: 'guest_portal' },
      }),
    );
    expect(res.state).toBe('granted');
    const other = await org.sys((tx) =>
      org.svc.resolveProfile(tx, { propertyId: A, familyName: 'Other' }, { matchStrategy: 'create_new' }),
    );
    await expect(
      org.run(self, (tx) =>
        org.svc.recordConsent(tx, other.profileId, {
          propertyId: A,
          purpose: 'marketing_whatsapp',
          state: 'granted',
          source: 'guest_portal',
          evidence: { textVersion: 'wa-v1', channel: 'guest_portal' },
        }),
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });
});

describe('data-subject export', () => {
  it('a property-scoped requester gets only their property’s private data; the manifest says what was withheld', async () => {
    const org = await setupOrg(t);
    const [A, B] = org.properties as [string, string];
    const { profileId } = await org.sys((tx) =>
      org.svc.resolveProfile(
        tx,
        { propertyId: A, givenName: 'Export', familyName: 'Scope' },
        { matchStrategy: 'create_new' },
      ),
    );
    await org.sys(async (tx) => {
      await org.svc.recordStayHistory(tx, {
        profileId,
        stayRef: { type: 'stay', id: crypto.randomUUID() },
        propertyId: B,
        arrival: '2026-01-05',
        departure: '2026-01-07',
        status: 'departed',
      });
      await org.svc.addDocument(tx, profileId, {
        propertyId: B,
        type: 'passport',
        issuingCountry: 'FR',
        number: 'BPASS9876',
      });
      await org.svc.addDocument(tx, profileId, {
        propertyId: A,
        type: 'national_id',
        issuingCountry: 'FR',
        number: 'APASS1234',
      });
      await org.svc.addSpecialNeed(tx, profileId, {
        propertyId: B,
        category: 'medical',
        detail: 'B-only medical detail',
      });
      await org.svc.addNote(tx, profileId, {
        propertyId: B,
        visibility: 'property_private',
        body: 'B private note',
      });
      await org.svc.addNote(tx, profileId, { visibility: 'shared', body: 'Shared note' });
    });
    const dpoA = org.user([
      { permission: 'guests.profile.read', propertyIds: [A] },
      { permission: 'guests.privacy.export', propertyIds: [A] },
      { permission: 'guests.document.read', propertyIds: [A] },
      { permission: 'guests.sensitive.read', propertyIds: [A] },
    ]);
    const { data } = await org.run(dpoA, (tx) =>
      org.svc.exportProfile(tx, { kind: 'export', profileId, reason: 'Access request' }),
    );
    const text = JSON.stringify(data);
    expect(text).not.toMatch(/BPASS9876|B-only medical detail|B private note/);
    expect(text).toContain('APASS1234'); // own property, with document.read
    expect(text).toContain('Shared note');
    const d = data as { complete: boolean; withheld: Array<{ category: string; count: number }> };
    expect(d.complete).toBe(false);
    expect(d.withheld.map((w) => w.category).sort()).toEqual([
      'identityDocuments',
      'notes',
      'specialNeeds',
      'stays',
    ]);
    // The decrypted document was audited like a reveal.
    const reads = await auditRows(t, org.tenantId, { action: 'guests.document.read' });
    expect(reads).toHaveLength(1);
    expect(reads[0]?.reason).toMatch(/Data-subject export/);
  });

  it('produces a complete machine-readable export with a manifest; document details only with permission', async () => {
    const org = await setupOrg(t, {
      svc: makeService({
        personalDataContributors: [
          { module: 'reservations', collect: async () => ({ bookings: [{ code: 'AZR-7Q2X' }] }) },
          {
            module: 'comms',
            collect: async () => {
              throw new Error('not connected');
            },
          },
        ],
      }),
    });
    const { profileId, A } = await returningGuest(org);
    const dpo = org.user([
      { permission: 'guests.profile.read', propertyIds: [A] },
      { permission: 'guests.privacy.export', propertyIds: [A] },
    ]);
    const { requestId, data } = await org.run(dpo, (tx) =>
      org.svc.exportProfile(tx, { kind: 'export', profileId, reason: 'Guest emailed an access request' }),
    );
    const d = data as Record<string, unknown> & { identityDocuments: Array<{ details: unknown }> };
    expect(d).toMatchObject({
      format: 'portico.guest-export.v1',
      profile: { givenName: 'Priya', familyName: 'Sharma' },
      manifest: [
        { module: 'guests', status: 'included' },
        { module: 'reservations', status: 'included' },
        { module: 'comms', status: 'unavailable' },
      ],
      otherModules: { reservations: { bookings: [{ code: 'AZR-7Q2X' }] } },
    });
    expect((d.contactPoints as unknown[]).length).toBe(2);
    expect(d.identityDocuments[0]?.details).toMatch(/withheld/);
    const request = await org.run(dpo, (tx) => org.svc.getPrivacyRequest(tx, requestId));
    expect(request).toMatchObject({ kind: 'export', status: 'completed' });
    expect(JSON.stringify(request.result)).not.toContain('Priya');
    expect(await auditRows(t, org.tenantId, { action: 'guests.privacy.export' })).toHaveLength(1);
    // Downloading again rebuilds the data and is audited again.
    await org.run(dpo, (tx) => org.svc.downloadExport(tx, requestId));
    expect(await auditRows(t, org.tenantId, { action: 'guests.privacy.exportDownload' })).toHaveLength(1);
  });
});

/** Every table of schema `guests` — a new table must be classified here (and handled by erasure) to pass. */
const GUESTS_TABLES = [
  'alerts',
  'companies',
  'company_contacts',
  'consent_events',
  'consents',
  'contact_points',
  'duplicate_candidates',
  'external_refs',
  'identity_documents',
  'merge_reference_repoints',
  'merges',
  'notes',
  'preferences',
  'privacy_requests',
  'profile_properties',
  'profiles',
  'relationships',
  'special_needs',
  'stay_history',
];

const CORE_TENANT_TABLES = ['audit_log', 'event_deliveries', 'idempotency_keys', 'outbox'];

/** JSON of every row of every guests table (plus the tenant's outbox and audit log) for one organization. */
async function tenantDump(tenantId: string): Promise<string> {
  const { rows } = await sql<{ table_name: string }>`
    select table_name from information_schema.tables
    where table_schema = 'guests' and table_type = 'BASE TABLE' order by table_name`.execute(t.admin.kysely);
  expect(rows.map((r) => r.table_name)).toEqual(GUESTS_TABLES);
  const parts: string[] = [];
  // Every tenant-scoped store in schema `core` too (outbox, deliveries, audit, idempotency responses): a new one
  // must be added here to pass.
  const core = await sql<{ table_name: string }>`
    select table_name from information_schema.columns
    where table_schema = 'core' and column_name = 'tenant_id' order by table_name`.execute(t.admin.kysely);
  expect(core.rows.map((r) => r.table_name)).toEqual(CORE_TENANT_TABLES);
  for (const table of [
    ...GUESTS_TABLES.map((x) => `guests.${x}`),
    ...CORE_TENANT_TABLES.map((x) => `core.${x}`),
  ]) {
    const data = await t.admin.kysely
      .selectFrom(table)
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .execute();
    parts.push(`${table}: ${JSON.stringify(data)}`);
  }
  return parts.join('\n');
}

describe('data-subject erasure with retention', () => {
  it('an erasure racing a replay: the replay waits, then answers 410 — never the erased data', async () => {
    const org = await setupOrg(t);
    const [A] = org.properties as [string];
    const plans = guestsReplayPlans(org.svc);
    const key = crypto.randomUUID();
    const replay = () =>
      runIdempotent(
        t.db,
        org.admin,
        { scope: 'POST /guests/profiles', key, request: { n: 1 } },
        async (tx) => ({
          status: 201,
          body: await org.svc.createProfile(tx, {
            propertyId: A,
            givenName: 'Quilla',
            familyName: 'Racecondition',
            dateOfBirth: '1981-02-03',
            matchStrategy: 'create_new',
          }),
        }),
        { replay: plans.createProfile(A) },
      );
    const created = await replay();
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    let erased: () => void = () => {};
    const didErase = new Promise<void>((r) => {
      erased = r;
    });
    const erasure = org.sys(async (tx) => {
      await org.svc.eraseProfile(tx, { kind: 'erasure', profileId: created.body.profile.id, reason: 'race' });
      erased();
      await gate;
    });
    await didErase;
    let settled = false;
    const racing = replay().finally(() => {
      settled = true;
    });
    await new Promise((r) => setTimeout(r, 300));
    expect(settled).toBe(false);
    release();
    await erasure;
    const err = await racing.catch((e: unknown) => e);
    expect(err).toMatchObject({ status: 410 });
    expect(JSON.stringify(err)).not.toMatch(/Racecondition|1981-02-03/);
  });

  it('GUE-I06: no personal data remains in ANY guests table after erasing a merged, duplicated, consented guest', async () => {
    const org = await setupOrg(t);
    const [A, B] = org.properties as [string, string];
    const svc = org.svc;
    const mk = (input: Record<string, unknown>, at = A) =>
      org.sys((tx) =>
        svc.resolveProfile(tx, { propertyId: at, ...input } as Parameters<typeof svc.resolveProfile>[1], {
          matchStrategy: 'create_new',
        }),
      );
    const p = (
      await mk({
        givenName: 'Zanele',
        familyName: 'Mokoena',
        dateOfBirth: '1977-04-04',
        nationality: 'ZA',
        importantDates: [{ kind: 'anniversary', date: '2003-12-06' }],
        contactPoints: [
          { kind: 'email', value: 'zanele.mokoena@guest.example', verified: true },
          { kind: 'phone', value: '+27 82 987 6543' },
        ],
      })
    ).profileId;
    // A duplicate created by a channel (same verified email → exact key) …
    const dup = (
      await mk(
        {
          givenName: 'Zanelle',
          familyName: 'Mokoena',
          dateOfBirth: '1977-04-04',
          contactPoints: [
            { kind: 'email', value: 'zanele.mokoena@guest.example', verified: true },
            { kind: 'email', value: 'z.mokoena.work@guest.example' },
          ],
        },
        B,
      )
    ).profileId;
    // … a different person merged by mistake and unmerged (reversed merge record with an unmerge result) …
    const other = (await mk({ givenName: 'Thabo', familyName: 'Nkosi', dateOfBirth: '1990-09-09' }))
      .profileId;
    const wrong = await org.sys((tx) =>
      svc.mergeProfiles(tx, { survivorId: p, mergedId: other, reason: 'oops' }),
    );
    await org.sys((tx) => svc.unmergeProfiles(tx, { mergeId: wrong.mergeId, reason: 'Different person' }));
    const spouse = (await mk({ givenName: 'Sipho', familyName: 'Dlamini' })).profileId;
    const corp = await org.sys((tx) =>
      svc.createCompany(tx, { kind: 'company', legalName: 'Karoo Freight (fictitious)' }),
    );
    await org.sys(async (tx) => {
      await svc.addPreference(tx, p, { category: 'bedding', value: 'Hypoallergenic duvet' });
      await svc.addAlert(tx, p, {
        propertyId: A,
        severity: 'important',
        text: 'Bring extra towels to villa',
        visibility: 'shared',
      });
      await svc.addNote(tx, dup, { visibility: 'shared', body: 'Prefers the quiet villa by the lagoon' });
      await svc.addSpecialNeed(tx, p, {
        propertyId: A,
        category: 'medical',
        detail: 'Penicillin anaphylaxis',
        guestAgreedAlertText: 'Medical: penicillin allergy',
      });
      await svc.addDocument(tx, p, {
        propertyId: A,
        type: 'passport',
        issuingCountry: 'ZA',
        number: 'ZM1234567',
      });
      await svc.addRelationship(tx, p, { relatedProfileId: spouse, kind: 'spouse' });
      await svc.addCompanyContact(tx, corp.id, { profileId: dup, role: 'booker' });
      await svc.recordConsent(tx, p, {
        propertyId: A,
        purpose: 'marketing_email',
        state: 'granted',
        source: 'booking_engine',
        evidence: { textVersion: 'v1', channel: 'web', reference: 'ip 198.51.100.77' },
      });
      await svc.recordStayHistory(tx, {
        profileId: dup,
        stayRef: { type: 'stay', id: crypto.randomUUID() },
        propertyId: B,
        arrival: '2026-03-01',
        departure: '2026-03-05',
        status: 'departed',
        revenue: { amountMinor: 250_000, currency: 'USD' },
      });
    });
    await org.sys((tx) => svc.exportProfile(tx, { kind: 'export', profileId: p, reason: 'Access request' }));
    // Stored idempotent responses: guests' own create (replay plan: ids only) and another module's response that
    // embeds the guest (e.g. a booking with its booker) — the store erasure must also reach (SW-GUE-1).
    const plans = guestsReplayPlans(svc);
    const createKey = crypto.randomUUID();
    const replayCreate = () =>
      runIdempotent(
        t.db,
        org.admin,
        { scope: `POST /guests/profiles/${p}/preferences`, key: createKey, request: { n: 'pillow' } },
        async (tx) => ({
          status: 201,
          body: await svc.addPreference(tx, p, { category: 'pillow', value: 'Buckwheat' }),
        }),
        { replay: plans.profile },
      );
    const first = await replayCreate();
    expect(first.body.givenName).toBe('Zanele'); // the response names the guest; the store must not
    const stored = await t.admin.kysely
      .selectFrom('core.idempotency_keys')
      .select(sql<string>`response_body::text`.as('body'))
      .where('key', '=', createKey)
      .executeTakeFirstOrThrow();
    expect(stored.body).not.toMatch(/Zanele|Mokoena|1977/);
    const bookingKey = crypto.randomUUID();
    const foreignResponse = () =>
      runIdempotent(
        t.db,
        org.admin,
        { scope: 'POST /reservations/bookings', key: bookingKey, request: {} },
        async () => ({
          status: 201,
          body: { bookingId: crypto.randomUUID(), booker: { profileId: dup, name: 'Zanelle Mokoena' } },
        }),
      );
    await foreignResponse();
    await org.sys((tx) => svc.mergeProfiles(tx, { survivorId: p, mergedId: dup, reason: 'Same guest' }));
    // A mirrored profile of the same person from the external PMS (connected mode) is erased separately.
    const mirror = await org.sys((tx) =>
      svc.upsertMirroredProfile(tx, {
        connectionId: crypto.randomUUID(),
        systemName: 'Legacy PMS (simulated)',
        externalId: 'PMS-ZM-77',
        propertyId: B,
        syncedAt: new Date('2026-11-07T06:00:00Z'),
        profile: { givenName: 'Zanele', familyName: 'Mokoena' },
      }),
    );

    const pii = [
      'Zanele',
      'Zanelle',
      'Mokoena',
      'mokoena',
      '1977-04-04',
      '2003-12-06',
      '829876543',
      '198.51.100.77',
      'ZM1234567',
      'Penicillin',
      'penicillin',
      'Hypoallergenic',
      'extra towels',
      'quiet villa',
      'PMS-ZM-77',
    ];
    const before = await tenantDump(org.tenantId);
    expect(pii.filter((x) => before.includes(x)).length).toBeGreaterThan(8); // the fixture really holds PII

    await org.sys((tx) => svc.eraseProfile(tx, { kind: 'erasure', profileId: p, reason: 'Erasure request' }));
    await org.sys((tx) =>
      svc.eraseProfile(tx, { kind: 'erasure', profileId: mirror.profileId, reason: 'Erasure request' }),
    );
    const after = await tenantDump(org.tenantId);
    expect(pii.filter((x) => after.includes(x))).toEqual([]);
    // Replaying the stored requests now answers 410 instead of returning the erased person's data.
    await expect(replayCreate()).rejects.toMatchObject({ code: 'idempotent_response_erased', status: 410 });
    await expect(foreignResponse()).rejects.toMatchObject({ code: 'idempotent_response_erased' });
    // The other person (unmerged) keeps their data; the financial reference survives pseudonymously.
    expect(after).toContain('Thabo');
    const history = await org.sys((tx) => svc.getStayHistory(tx, p));
    expect(history.items[0]?.revenue).toEqual({ amountMinor: 250_000, currency: 'USD' });
  });

  it('anonymizes personal data, keeps pseudonymous financial references, and is audited', async () => {
    const org = await setupOrg(t);
    const { profileId, stayId, bookingId, A } = await returningGuest(org);
    const dpo = org.user([
      { permission: 'guests.profile.read', propertyIds: [A] },
      { permission: 'guests.privacy.erase', propertyIds: [A] },
    ]);
    const { requestId, result } = await org.run(dpo, (tx) =>
      org.svc.eraseProfile(tx, { kind: 'erasure', profileId, reason: 'Guest erasure request #881' }),
    );
    expect(result).toMatchObject({
      retained: { pseudonymousProfileId: profileId, stayHistoryRows: 1, stayRowsWithRevenue: 1 },
    });
    const p = await org.sys((tx) => org.svc.getProfile(tx, profileId));
    expect(p).toMatchObject({
      status: { profile: 'anonymized' },
      givenName: null,
      dateOfBirth: null,
      contactPoints: [],
      documents: [],
      preferences: [],
    });
    expect(p.familyName).toMatch(/^Anonymized guest/);
    expect(p.notes.every((n) => n.body === '[redacted]' && n.redacted)).toBe(true);
    expect(p.consents).toEqual([expect.objectContaining({ purpose: 'marketing_email', state: 'granted' })]);
    // Retained as evidence only: nothing may be processed for an anonymized guest.
    const mkt = await org.sys((tx) =>
      org.svc.getConsent(tx, { profileId, legalEntityId: org.legalEntityId, purpose: 'marketing_email' }),
    );
    expect(mkt.mayProcess).toBe(false);
    // Financial references survive under the pseudonymous id (finance keeps fiscal records for their period).
    const history = await org.sys((tx) => org.svc.getStayHistory(tx, profileId));
    expect(history.items).toEqual([
      expect.objectContaining({ stayId, bookingId, revenue: { amountMinor: 1_234_500, currency: 'USD' } }),
    ]);
    // No personal data remains in guests tables for this tenant (GUE-I06), nor in the consent evidence.
    const dump = await tenantDump(org.tenantId);
    expect(dump).not.toMatch(/Priya|Sharma|priya\.sharma|98765|1989-01-26|Jain|203\.0\.113\.9/);
    // Search cannot find the person any more.
    const found = await org.sys((tx) =>
      org.svc.searchProfiles(tx, { q: 'Priya Sharma', kind: 'auto', limit: 5 }),
    );
    expect(found.items).toHaveLength(0);
    // Audit and event.
    const audit = await auditRows(t, org.tenantId, { action: 'guests.privacy.erase' });
    expect(audit[0]?.reason).toBe('Guest erasure request #881');
    expect((await outboxRows(t, org.tenantId, 'guests.profile.anonymized'))[0]?.payload).toMatchObject({
      profileId,
      privacyRequestId: requestId,
    });
    // An anonymized profile cannot be edited.
    await expect(
      org.sys((tx) => org.svc.addNote(tx, profileId, { visibility: 'shared', body: 'x' })),
    ).rejects.toMatchObject({ code: 'profile_anonymized' });
  });

  it('a legal hold puts the request on hold (recorded) and changes nothing', async () => {
    const org = await setupOrg(t);
    const { profileId } = await returningGuest(org);
    const foreign = () =>
      runIdempotent(t.db, org.admin, { scope: 'POST /x', key: 'k-hold', request: {} }, async () => ({
        status: 201,
        body: { profileId },
      }));
    await foreign();
    await org.sys((tx) =>
      org.svc.setLegalHold(tx, profileId, { hold: true, reason: 'Chargeback dispute pending' }),
    );
    const { requestId } = await org.sys((tx) =>
      org.svc.eraseProfile(tx, { kind: 'erasure', profileId, reason: 'Erasure request' }),
    );
    // Failure path: nothing was erased — stored responses included (the replay still answers).
    expect((await foreign()).body).toEqual({ profileId });
    const req = await org.sys((tx) => org.svc.getPrivacyRequest(tx, requestId));
    expect(req).toMatchObject({ status: 'on_hold', rejectionReason: 'Legal hold' });
    const p = await org.sys((tx) => org.svc.getProfile(tx, profileId));
    expect(p.status).toEqual({ profile: 'active', privacy: 'legal_hold' });
    expect(p.allowedActions.find((a) => a.action === 'erase')).toMatchObject({
      enabled: false,
      reason: expect.stringMatching(/legal hold/),
    });
    expect(p.contactPoints).toHaveLength(2);
  });

  it('erasing a survivor anonymizes profiles merged into it and makes the merge irreversible', async () => {
    const org = await setupOrg(t);
    const { profileId } = await returningGuest(org);
    const dup = await org.sys((tx) =>
      org.svc.resolveProfile(
        tx,
        {
          propertyId: org.properties[0] as string,
          givenName: 'Priya',
          familyName: 'Sharma',
          dateOfBirth: '1989-01-26',
        },
        { matchStrategy: 'create_new' },
      ),
    );
    const { mergeId } = await org.sys((tx) =>
      org.svc.mergeProfiles(tx, { survivorId: profileId, mergedId: dup.profileId, reason: 'same guest' }),
    );
    await expect(
      org.sys((tx) => org.svc.eraseProfile(tx, { kind: 'erasure', profileId: dup.profileId, reason: 'r' })),
    ).rejects.toMatchObject({ code: 'profile_merged' });
    await org.sys((tx) =>
      org.svc.eraseProfile(tx, { kind: 'erasure', profileId, reason: 'Erasure request' }),
    );
    const merge = await org.sys((tx) => org.svc.getMerge(tx, mergeId));
    expect(merge.status).toBe('erased');
    const snapshot = await t.admin.kysely
      .selectFrom('guests.merges')
      .select('snapshot')
      .where('id', '=', mergeId)
      .executeTakeFirstOrThrow();
    expect(JSON.stringify(snapshot)).not.toContain('Priya');
    const mergedRow = await t.admin.kysely
      .selectFrom('guests.profiles')
      .selectAll()
      .where('id', '=', dup.profileId)
      .executeTakeFirstOrThrow();
    expect(mergedRow.given_name).toBeNull();
    await expect(
      org.sys((tx) => org.svc.unmergeProfiles(tx, { mergeId, reason: 'too late' })),
    ).rejects.toMatchObject({ code: 'unmerge_not_possible' });
  });

  it('erasure needs the sensitive permission', async () => {
    const org = await setupOrg(t);
    const { profileId, A } = await returningGuest(org);
    const desk = org.user([
      { permission: 'guests.profile.read', propertyIds: [A] },
      { permission: 'guests.profile.update', propertyIds: [A] },
    ]);
    await expect(
      org.run(desk, (tx) => org.svc.eraseProfile(tx, { kind: 'erasure', profileId, reason: 'please' })),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });
});
