/**
 * Guest profiles and companies on a real database: names across scripts, child records, versioning, notes
 * history, stay history + recognition, roles (booker / occupant / payer) and connected mode (data authority).
 */
import { platform } from '@portico/platform';
import type { TestDatabase } from '@portico/testing';
import { testContext } from '@portico/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { deskGrants, makeService, outboxRows, setupOrg, startDb, type TestOrg } from './helpers';

let t: TestDatabase;
beforeAll(async () => {
  t = await startDb();
});
afterAll(async () => t?.drop());

const create = (org: TestOrg, input: Record<string, unknown>, propertyId?: string) =>
  org.sys((tx) =>
    org.svc.createProfile(tx, {
      propertyId: propertyId ?? (org.properties[0] as string),
      matchStrategy: 'create_new',
      ...input,
    } as Parameters<typeof org.svc.createProfile>[1]),
  );

describe('names across scripts', () => {
  it('stores Cyrillic natively and derives the ICAO passport transliteration', async () => {
    const org = await setupOrg(t);
    const { profile } = await create(org, {
      nativeGivenName: 'Юлия',
      nativeFamilyName: 'Щербакова',
      language: 'ru',
    });
    expect(profile).toMatchObject({
      givenName: 'Iuliia',
      familyName: 'Shcherbakova',
      nativeGivenName: 'Юлия',
      nativeFamilyName: 'Щербакова',
      nativeScript: 'Cyrl',
      displayName: 'Iuliia Shcherbakova',
    });
  });

  it('requires the passport (Latin) name for Han script and keeps both', async () => {
    const org = await setupOrg(t);
    await expect(create(org, { nativeGivenName: '伟', nativeFamilyName: '王' })).rejects.toMatchObject({
      code: 'latin_name_required',
    });
    // Han characters typed into the Latin fields are recognized as native script — the Latin name is still needed.
    await expect(create(org, { familyName: '王', givenName: '伟' })).rejects.toMatchObject({
      code: 'latin_name_required',
    });
    const ok = await create(org, {
      nativeGivenName: '伟',
      nativeFamilyName: '王',
      givenName: 'Wei',
      familyName: 'Wang',
    });
    expect(ok.profile).toMatchObject({ givenName: 'Wei', familyName: 'Wang', nativeScript: 'Hani' });
    const found = await org.sys((tx) => org.svc.searchProfiles(tx, { q: '王伟', kind: 'auto', limit: 5 }));
    expect(found.items.map((i) => i.profileId)).toContain(ok.profile.id);
  });

  it('search is accent-insensitive and typo-tolerant, and finds by phone in national format', async () => {
    const org = await setupOrg(t);
    const { profile } = await create(org, {
      givenName: 'Zoë',
      familyName: 'Müller-Lüdenscheidt',
      contactPoints: [{ kind: 'phone', value: '+960 777 1234' }],
    });
    for (const q of ['zoe muller', 'Muller-Ludenscheid', 'Mueller Ludenscheidt']) {
      const r = await org.sys((tx) => org.svc.searchProfiles(tx, { q, kind: 'auto', limit: 5 }));
      expect(r.items.map((i) => i.profileId)).toContain(profile.id);
    }
    const byPhone = await org.sys((tx) =>
      org.svc.searchProfiles(tx, { q: '777 1234', kind: 'phone', propertyId: org.properties[0], limit: 5 }),
    );
    expect(byPhone.items.map((i) => i.profileId)).toEqual([profile.id]);
  });
});

describe('profile editing', () => {
  it('uses optimistic concurrency and records changed field names (never values) in audit and events', async () => {
    const org = await setupOrg(t);
    const { profile } = await create(org, { givenName: 'Emily', familyName: 'Clarke' });
    const desk = org.user(deskGrants(org.properties));
    const v2 = await org.run(desk, (tx) =>
      org.svc.updateProfile(tx, profile.id, profile.version, { vipLevel: 'vip2' }),
    );
    expect(v2.vipLevel).toBe('vip2');
    await expect(
      org.run(desk, (tx) => org.svc.updateProfile(tx, profile.id, profile.version, { language: 'en-GB' })),
    ).rejects.toMatchObject({ code: 'version_conflict', details: { currentVersion: v2.version } });
    const ev = await outboxRows(t, org.tenantId, 'guests.profile.updated');
    expect(ev.at(-1)?.payload).toEqual({ profileId: profile.id, changedFields: ['vipLevel'] });
  });

  it('refuses edits without permission and at properties where the guest is not visible', async () => {
    const org = await setupOrg(t);
    const [A, B] = org.properties as [string, string];
    const { profile } = await create(org, { givenName: 'Kai', familyName: 'Lehmann' }, A);
    const readOnly = org.user([{ permission: 'guests.profile.read', propertyIds: [A] }]);
    await expect(
      org.run(readOnly, (tx) => org.svc.addPreference(tx, profile.id, { category: 'bed', value: 'Twin' })),
    ).rejects.toMatchObject({ code: 'forbidden' });
    const deskB = org.user(deskGrants([B]));
    await expect(
      org.run(deskB, (tx) => org.svc.addPreference(tx, profile.id, { category: 'bed', value: 'Twin' })),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('notes are never edited in place: revisions supersede, and the database refuses in-place edits', async () => {
    const org = await setupOrg(t);
    const { profile } = await create(org, { givenName: 'Noor', familyName: 'Al Kuwari' });
    const { noteId } = await org.sys((tx) =>
      org.svc.addNote(tx, profile.id, { visibility: 'shared', body: 'Allergic to cats' }),
    );
    const { noteId: v2 } = await org.sys((tx) =>
      org.svc.reviseNote(tx, noteId, { body: 'Allergic to cats and dogs' }),
    );
    const p = await org.sys((tx) => org.svc.getProfile(tx, profile.id));
    expect(p.notes.map((n) => [n.body, n.superseded, n.supersedesId])).toEqual([
      ['Allergic to cats', true, null],
      ['Allergic to cats and dogs', false, noteId],
    ]);
    await expect(org.sys((tx) => org.svc.reviseNote(tx, noteId, { body: 'again' }))).rejects.toMatchObject({
      code: 'note_superseded',
    });
    await expect(
      org.sys((tx) =>
        tx.db.updateTable('guests.notes').set({ body: 'tampered' }).where('id', '=', v2).execute(),
      ),
    ).rejects.toThrow(/body can only change by erasure/);
    await expect(
      org.sys((tx) => tx.db.deleteFrom('guests.notes').where('id', '=', v2).execute()),
    ).rejects.toThrow(/permission denied|cannot be deleted/);
  });

  it('preferences and alerts: versioned updates, resolution, critical alert event', async () => {
    const org = await setupOrg(t);
    const [A] = org.properties as [string];
    const { profile } = await create(org, { givenName: 'Michael', familyName: 'Johnson' });
    const withPref = await org.sys((tx) =>
      org.svc.addPreference(tx, profile.id, { category: 'pillow', value: 'Firm' }),
    );
    const pref = withPref.preferences[0];
    const updated = await org.sys((tx) =>
      org.svc.updatePreference(tx, pref?.id as string, pref?.version as number, { value: 'Soft' }),
    );
    expect(updated.preferences[0]?.value).toBe('Soft');
    await expect(
      org.sys((tx) =>
        org.svc.updatePreference(tx, pref?.id as string, pref?.version as number, { value: 'Medium' }),
      ),
    ).rejects.toMatchObject({ code: 'version_conflict' });
    const { alertId, profile: p2 } = await org.sys((tx) =>
      org.svc.addAlert(tx, profile.id, {
        propertyId: A,
        severity: 'critical',
        text: 'Shellfish allergy',
        visibility: 'shared',
      }),
    );
    const alert = p2.alerts.find((a) => a.id === alertId);
    const resolved = await org.sys((tx) =>
      org.svc.resolveAlert(tx, alertId, alert?.version as number, { reason: 'Guest corrected' }),
    );
    expect(resolved.alerts.find((a) => a.id === alertId)?.status).toBe('resolved');
    expect((await outboxRows(t, org.tenantId, 'guests.alert.raised'))[0]?.payload).toMatchObject({
      severity: 'critical',
    });
  });
});

describe('alert active periods (R03)', () => {
  it('an alert outside its active dates is not critical on arrival screens or as an issue', async () => {
    const org = await setupOrg(t);
    const [A] = org.properties as [string];
    const { profile } = await create(org, { givenName: 'Old', familyName: 'Alert' });
    await org.sys(async (tx) => {
      await org.svc.addAlert(tx, profile.id, {
        propertyId: A,
        severity: 'critical',
        text: 'Expired alert',
        visibility: 'shared',
        activeFrom: '2020-01-01',
        activeTo: '2020-01-31',
      });
      await org.svc.addAlert(tx, profile.id, {
        propertyId: A,
        severity: 'critical',
        text: 'Current alert',
        visibility: 'shared',
        activeFrom: '2026-11-01',
      });
    });
    const r = await org.sys((tx) =>
      org.svc.getRecognitionSummary(tx, { profileId: profile.id, propertyId: A }),
    );
    expect(r.criticalAlerts.map((a) => a.text)).toEqual(['Current alert']);
    const p = await org.sys((tx) => org.svc.getProfile(tx, profile.id, { propertyId: A }));
    expect(p.issues.filter((i) => i.code === 'critical_alert').map((i) => i.message)).toEqual([
      'Current alert',
    ]);
    expect(p.alerts.map((a) => [a.text, a.activeNow])).toEqual([
      ['Expired alert', false],
      ['Current alert', true],
    ]);
  });
});

describe('stay history, recognition and roles (S04)', () => {
  it('booker, occupants and payer are roles on stays and companies — not profile types', async () => {
    const org = await setupOrg(t);
    const [A] = org.properties as [string];
    const corp = await org.sys((tx) =>
      org.svc.createCompany(tx, {
        kind: 'company',
        legalName: 'Meridian Offshore Energy Ltd (fictitious)',
        taxId: 'GB-123',
      }),
    );
    const assistant = (await create(org, { givenName: 'Isla', familyName: 'Fraser' })).profile.id;
    const father = (await create(org, { givenName: 'Daniel', familyName: 'Okafor' })).profile.id;
    const child = (await create(org, { givenName: 'Ada', familyName: 'Okafor', dateOfBirth: '2018-04-01' }))
      .profile.id;
    await org.sys((tx) => org.svc.addCompanyContact(tx, corp.id, { profileId: assistant, role: 'booker' }));
    await org.sys((tx) => org.svc.addRelationship(tx, child, { relatedProfileId: father, kind: 'parent' }));
    const stay = crypto.randomUUID();
    const booking = crypto.randomUUID();
    await org.sys(async (tx) => {
      const base = {
        stayRef: { type: 'stay', id: stay },
        bookingId: booking,
        propertyId: A,
        arrival: '2026-12-20',
        departure: '2026-12-27',
        status: 'expected',
      };
      await org.svc.recordStayHistory(tx, {
        ...base,
        profileId: assistant,
        role: 'booker',
        companyId: corp.id,
      });
      await org.svc.recordStayHistory(tx, {
        ...base,
        profileId: father,
        role: 'occupant',
        companyId: corp.id,
      });
      await org.svc.recordStayHistory(tx, { ...base, profileId: child, role: 'occupant' });
      await org.svc.recordStayHistory(tx, { ...base, profileId: father, role: 'payer' }); // incidentals
      // Idempotent: the same stay recorded again updates, never duplicates.
      await org.svc.recordStayHistory(tx, {
        ...base,
        profileId: father,
        role: 'occupant',
        status: 'in_house',
      });
    });
    const fh = await org.sys((tx) => org.svc.getStayHistory(tx, father));
    expect(fh.items.map((i) => [i.role, i.status]).sort()).toEqual([
      ['occupant', 'in_house'],
      ['payer', 'expected'],
    ]);
    expect(fh.summary.stays).toBe(1);
    const company = await org.sys((tx) => org.svc.getCompany(tx, corp.id));
    expect(company.contacts).toEqual([expect.objectContaining({ profileId: assistant, role: 'booker' })]);
  });

  it('recognition summary for the arrivals screen', async () => {
    const org = await setupOrg(t);
    const [A, B] = org.properties as [string, string];
    const { profile } = await create(org, {
      givenName: 'Ivan',
      familyName: 'Petrov',
      vipLevel: 'vip1',
      importantDates: [{ kind: 'anniversary', date: '2012-06-30' }],
    });
    await org.sys(async (tx) => {
      for (const [p, arr, dep] of [
        [A, '2025-02-10', '2025-02-20'],
        [B, '2026-03-01', '2026-03-03'],
      ] as const) {
        await org.svc.recordStayHistory(tx, {
          profileId: profile.id,
          stayRef: { type: 'stay', id: crypto.randomUUID() },
          propertyId: p,
          arrival: arr,
          departure: dep,
          status: 'departed',
          revenue: { amountMinor: 100_000, currency: 'USD' },
        });
      }
      await org.svc.addAlert(tx, profile.id, {
        propertyId: A,
        severity: 'critical',
        text: 'Diabetic',
        visibility: 'shared',
      });
      await org.svc.addPreference(tx, profile.id, { category: 'diving', value: 'Early boat' });
    });
    const r = await org.sys((tx) =>
      org.svc.getRecognitionSummary(tx, { profileId: profile.id, propertyId: A }),
    );
    expect(r).toMatchObject({
      returningGuest: true,
      staysAtProperty: 1,
      staysInOrganization: 2,
      vipLevel: 'vip1',
      criticalAlerts: [{ text: 'Diabetic', severity: 'critical' }],
      keyPreferences: [{ category: 'diving', value: 'Early boat' }],
    });
    const h = await org.sys((tx) => org.svc.getStayHistory(tx, profile.id));
    expect(h.summary).toMatchObject({
      stays: 2,
      nights: 12,
      spend: [{ currency: 'USD', amountMinor: 200_000 }],
    });
  });

  it('rejects malformed stay history input', async () => {
    const org = await setupOrg(t);
    const { profile } = await create(org, { familyName: 'Tanaka' });
    await expect(
      org.sys((tx) =>
        org.svc.recordStayHistory(tx, {
          profileId: profile.id,
          stayRef: { type: 'stay', id: crypto.randomUUID() },
          propertyId: org.properties[0] as string,
          arrival: '2026-01-05',
          departure: '2026-01-05',
          status: 'expected',
        }),
      ),
    ).rejects.toMatchObject({ code: 'invalid_date_range' });
  });
});

describe('connected mode (data authority guestProfiles = external)', () => {
  async function connected(org: TestOrg, writeMode: 'read_only' | 'forward') {
    const [A] = org.properties as [string];
    await org.sys((tx) =>
      platform.setDataAuthority(tx, {
        propertyId: A,
        domain: 'guestProfiles',
        authority: 'external',
        connectionId: crypto.randomUUID(),
        systemName: 'Legacy PMS (simulated)',
        writeMode,
        reason: 'connect alongside',
      }),
    );
    return A;
  }

  it('mirrors profiles read-only; Portico extension data stays editable; merge happens in the system of record', async () => {
    const org = await setupOrg(t);
    const A = await connected(org, 'read_only');
    await expect(create(org, { familyName: 'Direct' }, A)).rejects.toMatchObject({
      code: 'external_system_of_record',
    });
    const connectionId = crypto.randomUUID();
    const mirror = (given: string) =>
      org.sys((tx) =>
        org.svc.upsertMirroredProfile(tx, {
          connectionId,
          systemName: 'Legacy PMS (simulated)',
          externalId: 'G-1001',
          propertyId: A,
          syncedAt: new Date('2026-11-07T06:00:00Z'),
          profile: { givenName: given, familyName: 'Hassan', nationality: 'MV' },
          contactPoints: [{ kind: 'phone', value: '7771234' }],
        }),
      );
    const first = await mirror('Aishath');
    expect(first.created).toBe(true);
    const p = await org.sys((tx) => org.svc.getProfile(tx, first.profileId));
    expect(p).toMatchObject({ provenance: 'external', external: { systemName: 'Legacy PMS (simulated)' } });
    expect(p.issues.map((i) => i.code)).toContain('mirrored_profile');
    expect(p.allowedActions.find((a) => a.action === 'edit')).toMatchObject({
      enabled: false,
      reason: expect.stringMatching(/mastered in Legacy PMS/),
    });
    expect(p.contactPoints[0]?.normalized).toBe('+9607771234');
    await expect(
      org.sys((tx) => org.svc.updateProfile(tx, first.profileId, p.version, { givenName: 'Aisha' })),
    ).rejects.toMatchObject({ code: 'external_system_of_record' });
    await org.sys((tx) =>
      org.svc.addPreference(tx, first.profileId, { category: 'transfer', value: 'Speedboat only' }),
    );
    const again = await mirror('Aishath M.');
    expect(again).toEqual({ profileId: first.profileId, created: false });
    const p2 = await org.sys((tx) => org.svc.getProfile(tx, first.profileId));
    expect(p2.givenName).toBe('Aishath M.');
    expect(p2.preferences.map((x) => x.value)).toEqual(['Speedboat only']);
    const other = await create(org, { givenName: 'Aishath', familyName: 'Hassan' }, org.properties[1]);
    await expect(
      org.sys((tx) =>
        org.svc.mergeProfiles(tx, { survivorId: other.profile.id, mergedId: first.profileId, reason: 'dup' }),
      ),
    ).rejects.toMatchObject({ code: 'merge_in_system_of_record' });
  });

  it('forward mode is honest: forwarding is not available yet, nothing is written', async () => {
    const org = await setupOrg(t);
    const A = await connected(org, 'forward');
    await expect(create(org, { familyName: 'Forwarded' }, A)).rejects.toMatchObject({
      code: 'forwarding_not_available',
    });
  });

  it('trial organizations label profiles as copied', async () => {
    const org = await setupOrg(t);
    const trial = { ...org.admin, environment: 'trial' as const };
    const p = await org.run(trial, (tx) =>
      org.svc.createProfile(tx, {
        propertyId: org.properties[0] as string,
        familyName: 'Copied',
        matchStrategy: 'create_new',
      }),
    );
    expect(p.profile.provenance).toBe('copied');
  });
});

describe('companies and travel agents', () => {
  it('validates IATA codes, commission and hierarchy; enforces business identity', async () => {
    const org = await setupOrg(t);
    const agency = await org.sys((tx) =>
      org.svc.createCompany(tx, {
        kind: 'agency',
        legalName: 'Lagoon Trails DMC Pvt Ltd (fictitious)',
        iataCode: '96200016',
        commission: { model: 'percent_of_room', basisPoints: 1000, reference: '2027 contract' },
      }),
    );
    expect(agency).toMatchObject({
      kind: 'agency',
      status: { company: 'active' },
      commission: { basisPoints: 1000 },
    });
    await expect(
      org.sys((tx) => org.svc.createCompany(tx, { kind: 'agency', legalName: 'Bad', iataCode: '96200017' })),
    ).rejects.toMatchObject({ code: 'invalid_iata_code' });
    await expect(
      org.sys((tx) =>
        org.svc.createCompany(tx, { kind: 'company', legalName: 'Corp', iataCode: '96200016' }),
      ),
    ).rejects.toMatchObject({ code: 'iata_for_agency_only' });
    await expect(
      org.sys((tx) =>
        org.svc.createCompany(tx, {
          kind: 'agency',
          legalName: 'Greedy',
          commission: { model: 'percent_of_room', basisPoints: 9000 },
        }),
      ),
    ).rejects.toMatchObject({ code: 'invalid_commission' });
    await expect(
      org.sys((tx) =>
        org.svc.createCompany(tx, { kind: 'agency', legalName: 'Same code', iataCode: '96200016' }),
      ),
    ).rejects.toMatchObject({ code: 'company_exists' });

    const parent = await org.sys((tx) =>
      org.svc.createCompany(tx, { kind: 'company', legalName: 'Holding plc' }),
    );
    const sub = await org.sys((tx) =>
      org.svc.createCompany(tx, { kind: 'company', legalName: 'Subsidiary Ltd', parentCompanyId: parent.id }),
    );
    await expect(
      org.sys((tx) => org.svc.updateCompany(tx, parent.id, parent.version, { parentCompanyId: sub.id })),
    ).rejects.toMatchObject({ code: 'company_hierarchy_cycle' });
  });

  it('status changes are versioned, validated and evented; AR linkage is a reference', async () => {
    const org = await setupOrg(t);
    const c = await org.sys((tx) =>
      org.svc.createCompany(tx, { kind: 'company', legalName: 'Coral Air (fictitious)' }),
    );
    const ar = crypto.randomUUID();
    const held = await org.sys((tx) =>
      org.svc.updateCompany(tx, c.id, c.version, { status: 'on_hold', arAccountRef: ar }),
    );
    expect(held).toMatchObject({ status: { company: 'on_hold' }, arAccountRef: ar });
    expect(held.issues.map((i) => i.code)).toContain('company_on_hold');
    expect(held.links).toContainEqual({ rel: 'receivables', type: 'ar_account', id: ar });
    expect(held.allowedActions.find((a) => a.action === 'putOnHold')).toMatchObject({ enabled: false });
    await expect(
      org.sys((tx) => org.svc.updateCompany(tx, c.id, c.version, { notes: 'stale' })),
    ).rejects.toMatchObject({
      code: 'version_conflict',
    });
    const inactive = await org.sys((tx) =>
      org.svc.updateCompany(tx, c.id, held.version, { status: 'inactive' }),
    );
    await expect(
      org.sys((tx) => org.svc.updateCompany(tx, c.id, inactive.version, { status: 'on_hold' })),
    ).rejects.toMatchObject({ code: 'invalid_status_change' });
    const ev = await outboxRows(t, org.tenantId, 'guests.company.statusChanged');
    expect(ev.map((e) => (e.payload as { to: string }).to)).toEqual(['on_hold', 'inactive']);
    const found = await org.sys((tx) => org.svc.listCompanies(tx, { q: 'coral air' }));
    expect(found.map((x) => x.id)).toEqual([c.id]);
  });

  it('company reads need a guests permission; management needs guests.company.manage', async () => {
    const org = await setupOrg(t);
    const c = await org.sys((tx) =>
      org.svc.createCompany(tx, { kind: 'company', legalName: 'Reef Divers Co' }),
    );
    const desk = org.user([
      { permission: 'guests.profile.read', propertyIds: [org.properties[0] as string] },
    ]);
    expect((await org.run(desk, (tx) => org.svc.getCompany(tx, c.id))).id).toBe(c.id);
    await expect(
      org.run(desk, (tx) => org.svc.createCompany(tx, { kind: 'company', legalName: 'Nope' })),
    ).rejects.toMatchObject({ code: 'forbidden' });
    const nobody = testContext({ tenantId: org.tenantId, grants: [] });
    await expect(org.run(nobody, (tx) => org.svc.getCompany(tx, c.id))).rejects.toMatchObject({
      code: 'forbidden',
    });
  });
});

describe('booking-code search (R20)', () => {
  it('finds the guests of a booking through the reservations index port, permission-filtered', async () => {
    const bookingIndex = new Map<string, string[]>();
    const org = await setupOrg(t, {
      svc: makeService({
        bookingLookup: {
          findProfileIdsByConfirmationCode: async (_tx, code) => bookingIndex.get(code) ?? [],
        },
      }),
    });
    const [A, B] = org.properties as [string, string];
    const { profile } = await create(org, { givenName: 'Kofi', familyName: 'Mensah' }, A);
    bookingIndex.set('AZR-7Q2X9K', [profile.id]);
    const deskA = org.user(deskGrants([A]));
    const found = await org.run(deskA, (tx) =>
      org.svc.searchProfiles(tx, { q: 'azr-7q2x9k', kind: 'auto', limit: 5 }),
    );
    expect(found.items).toEqual([expect.objectContaining({ profileId: profile.id, matchedOn: 'booking' })]);
    const deskB = org.user(deskGrants([B]));
    const hidden = await org.run(deskB, (tx) =>
      org.svc.searchProfiles(tx, { q: 'AZR-7Q2X9K', kind: 'auto', limit: 5 }),
    );
    expect(hidden.items).toHaveLength(0);
  });
});

describe('universal record contract and global search provider', () => {
  it('profiles expose status families, allowed actions with reasons, issues and links', async () => {
    const org = await setupOrg(t);
    const [A] = org.properties as [string];
    const corp = await org.sys((tx) =>
      org.svc.createCompany(tx, { kind: 'company', legalName: 'Atoll Telecom (fictitious)' }),
    );
    const { profile } = await create(org, {
      givenName: 'Hana',
      familyName: 'Ibrahim',
      dateOfBirth: '1990-01-01',
      nationality: 'MV',
      contactPoints: [{ kind: 'email', value: 'hana@guest.example' }],
    });
    await create(org, {
      givenName: 'Hana',
      familyName: 'Ibrahim',
      dateOfBirth: '1990-01-01',
      nationality: 'MV',
    });
    await org.sys((tx) => org.svc.addCompanyContact(tx, corp.id, { profileId: profile.id, role: 'booker' }));
    await org.sys((tx) =>
      org.svc.addDocument(tx, profile.id, {
        propertyId: A,
        type: 'passport',
        issuingCountry: 'MV',
        number: 'LA0000001',
        expiryDate: '2020-01-01',
      }),
    );
    const desk = org.user(deskGrants([A]));
    const p = await org.run(desk, (tx) => org.svc.getProfile(tx, profile.id));
    expect(p.status).toEqual({ profile: 'active', privacy: 'normal' });
    const act = Object.fromEntries(p.allowedActions.map((a) => [a.action, a]));
    expect(act.edit?.enabled).toBe(true);
    expect(act.merge).toMatchObject({
      enabled: false,
      previewRequired: true,
      label: 'Review possible duplicate',
    });
    expect(act.merge?.reason).toMatch(/guests\.profile\.merge/);
    expect(act.revealDocument).toMatchObject({
      enabled: false,
      reason: expect.stringMatching(/guests\.document\.read/),
    });
    expect(act.unmerge).toMatchObject({
      enabled: false,
      reason: 'No profile has been merged into this one.',
    });
    expect(p.issues.map((i) => i.code).sort()).toEqual([
      'document_expired',
      'no_verified_contact',
      'possible_duplicate',
    ]);
    expect(p.links).toContainEqual({ rel: 'company:booker', type: 'company', id: corp.id });
  });

  it('global search finds guests by name, transliteration, email, phone and company — permission-aware', async () => {
    const org = await setupOrg(t);
    const [A, B] = org.properties as [string, string];
    const { guestsSearchProvider } = await import('../src');
    const provider = guestsSearchProvider(org.svc);
    const { profile: ivan } = await create(org, {
      nativeGivenName: 'Иван',
      nativeFamilyName: 'Петров',
      contactPoints: [
        { kind: 'email', value: 'ivan.petrov@guest.example' },
        { kind: 'phone', value: '+7 916 123 45 67' },
      ],
    });
    const corp = await org.sys((tx) =>
      org.svc.createCompany(tx, { kind: 'agency', legalName: 'Coral Routes Travel (fictitious)' }),
    );
    await org.sys((tx) => org.svc.addCompanyContact(tx, corp.id, { profileId: ivan.id, role: 'booker' }));
    const deskA = org.user(deskGrants([A]));
    const find = async (q: string, ctx = deskA) =>
      org.run(ctx, (tx) => provider.search(tx, q, { limit: 10 }));
    for (const q of [
      'Ivan Petrov',
      'Иван Петров',
      'Петров',
      'ivan.petrov@guest.example',
      '8 916 123 45 67',
      'Coral Routes',
    ]) {
      const hits = await find(q);
      expect(
        hits.map((h) => h.id),
        q,
      ).toContain(ivan.id);
    }
    expect((await find('Coral Routes')).map((h) => h.type)).toContain('company');
    // Staff at another property without sharing rights find nothing.
    const deskB = org.user(deskGrants([B]));
    expect((await find('Ivan Petrov', deskB)).filter((h) => h.type === 'guest_profile')).toHaveLength(0);
    const summarize = provider.summarize;
    if (!summarize) throw new Error('summarize missing');
    expect(await org.run(deskB, (tx) => summarize(tx, 'guest_profile', ivan.id))).toBeNull();
    const summary = await org.run(deskA, (tx) => summarize(tx, 'guest_profile', ivan.id));
    expect(summary).toMatchObject({ title: 'Ivan Petrov', subtitle: expect.stringContaining('Иван Петров') });
  });
});
