/**
 * Consent and data-subject requests (GUE-R06, R17, R18; readiness brief §12): consent is not the basis for
 * operations; withdrawal never deletes legally retained financial references; export is complete and audited;
 * erasure anonymizes personal data, keeps pseudonymous financial references and is blocked by legal hold.
 */
import type { TestDatabase } from '@portico/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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

describe('data-subject erasure with retention', () => {
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
      status: 'anonymized',
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
    const dump = JSON.stringify(
      await Promise.all(
        [
          'guests.profiles',
          'guests.contact_points',
          'guests.notes',
          'guests.consents',
          'guests.preferences',
        ].map((tbl) =>
          t.admin.kysely.selectFrom(tbl).selectAll().where('tenant_id', '=', org.tenantId).execute(),
        ),
      ),
    );
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
    await org.sys((tx) =>
      org.svc.setLegalHold(tx, profileId, { hold: true, reason: 'Chargeback dispute pending' }),
    );
    const { requestId } = await org.sys((tx) =>
      org.svc.eraseProfile(tx, { kind: 'erasure', profileId, reason: 'Erasure request' }),
    );
    const req = await org.sys((tx) => org.svc.getPrivacyRequest(tx, requestId));
    expect(req).toMatchObject({ status: 'on_hold', rejectionReason: 'Legal hold' });
    const p = await org.sys((tx) => org.svc.getProfile(tx, profileId));
    expect(p.status).toBe('active');
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
