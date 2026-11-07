/**
 * Operational proof scenario 15 (brief §17): "A profile is merged incorrectly and needs correction."
 * Two different guests named Ahmed Ali are merged by mistake. Other modules re-point their references. The
 * mistake is investigated and reversed: both profiles and every child record are restored exactly, records
 * created after the merge are reviewed and assigned, other modules receive the exact references to restore, and
 * the audit trail shows both the merge and the unmerge.
 */
import { drainOutbox, type TxContext, type TxEventSubscription } from '@portico/db';
import { addDays, newId, systemContext } from '@portico/kernel';
import type { TestDatabase } from '@portico/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type ProfileSnapshot, snapshotProfile } from '../src/service/merge';
import { auditRows, makeService, outboxRows, setupOrg, startDb, type TestOrg } from './helpers';

let t: TestDatabase;
beforeAll(async () => {
  t = await startDb();
});
afterAll(async () => t?.drop());

/** A stand-in for the reservations module's references to guest profiles (booking → booker profile). */
class FakeReservations {
  readonly refs = new Map<string, string>(); // bookingId → profileId
  constructor(private readonly org: TestOrg) {}
  subscription(): TxEventSubscription {
    return {
      consumer: `reservations.test.${newId()}`,
      types: ['guests.profile.merged', 'guests.profile.unmerged'],
      handle: async (tx: TxContext, event) => {
        if (event.tenantId !== this.org.tenantId) return;
        const p = event.payload as Record<string, unknown>;
        if (event.type === 'guests.profile.merged') {
          const moved: Array<{ type: string; id: string; field: string }> = [];
          for (const [booking, profile] of this.refs) {
            if (profile === p.mergedId) {
              this.refs.set(booking, String(p.survivorId));
              moved.push({ type: 'booking', id: booking, field: 'bookerProfileId' });
            }
          }
          if (moved.length) {
            await this.org.svc.recordReferenceRepoints(tx, {
              mergeId: String(p.mergeId),
              module: 'reservations',
              references: moved,
            });
          }
        } else {
          const restore = (p.referencesToRestore as Record<string, Array<{ id: string }>>).reservations ?? [];
          for (const r of restore) this.refs.set(r.id, String(p.restoredId));
          for (const r of p.reassigned as Array<{ type: string; id: string }>) {
            if (r.type === 'stay') this.refs.set(`stay:${r.id}`, String(p.restoredId));
          }
        }
      },
    };
  }
}

/** Internal snapshot (test-only; not part of the public service). */
const snap = (org: TestOrg, id: string) => org.sys((tx) => snapshotProfile(tx, id));

const drain = (sub: TxEventSubscription) =>
  drainOutbox(t.db, { subscriptions: [sub], environmentOf: async () => 'live' });

/** Comparable snapshot: drop bookkeeping columns that legitimately change (version, updated_at). */
function comparable(s: ProfileSnapshot, excludeIds: readonly string[] = []) {
  // retain_until is recomputed from each guest's own stays, so new stays legitimately extend it.
  const strip = (r: Record<string, unknown>) => {
    const { version: _v, updated_at: _u, retain_until: _r, ...rest } = r;
    return rest;
  };
  return {
    profile: strip(s.profile),
    children: Object.fromEntries(
      Object.entries(s.children).map(([k, rows]) => [
        k,
        rows.filter((r) => !excludeIds.includes(String(r.id ?? r.property_id))).map(strip),
      ]),
    ),
  };
}

async function twoAhmedAlis(org: TestOrg) {
  const [A, B] = org.properties as [string, string];
  const svc = org.svc;
  const company = await org.sys((tx) =>
    svc.createCompany(tx, {
      kind: 'company',
      legalName: 'Gulf Pearl Trading LLC (fictitious)',
      taxId: `T-${newId()}`,
    }),
  );
  const spouse = await org.sys((tx) =>
    svc.resolveProfile(
      tx,
      { propertyId: A, givenName: 'Mariam', familyName: 'Ali', nationality: 'AE' },
      { matchStrategy: 'create_new' },
    ),
  );
  // Guest 1 — Ahmed Ali from the UAE, a returning resort guest.
  const one = await org.sys((tx) =>
    svc.resolveProfile(
      tx,
      {
        propertyId: A,
        givenName: 'Ahmed',
        familyName: 'Ali',
        nativeGivenName: 'أحمد',
        nativeFamilyName: 'علي',
        nationality: 'AE',
        dateOfBirth: '1980-03-01',
        language: 'ar',
        vipLevel: 'vip1',
        contactPoints: [
          { kind: 'email', value: 'ahmed.ali@guest.example', verified: true },
          { kind: 'phone', value: '+971 50 123 4567' },
        ],
      },
      { matchStrategy: 'create_new' },
    ),
  );
  // Guest 2 — a different Ahmed Ali from Saudi Arabia, staying at the city hotel.
  const two = await org.sys((tx) =>
    svc.resolveProfile(
      tx,
      {
        propertyId: B,
        givenName: 'Ahmed',
        familyName: 'Ali',
        nationality: 'SA',
        dateOfBirth: '1992-11-20',
        contactPoints: [
          { kind: 'email', value: 'a.ali.riyadh@guest.example' },
          { kind: 'phone', value: '+966 50 765 4321', verified: true },
        ],
      },
      { matchStrategy: 'create_new' },
    ),
  );
  const p1 = one.profileId;
  const p2 = two.profileId;
  await org.sys(async (tx) => {
    await svc.addPreference(tx, p1, { category: 'pillow', value: 'Firm pillow', propertyId: A });
    await svc.addPreference(tx, p2, { category: 'dietary', value: 'Halal only', propertyId: B });
    await svc.addAlert(tx, p1, {
      propertyId: A,
      severity: 'important',
      text: 'Prefers Arabic-speaking butler',
      visibility: 'shared',
    });
    await svc.addNote(tx, p1, {
      propertyId: A,
      visibility: 'property_private',
      body: 'Celebrated 10th anniversary in 2025',
    });
    await svc.addNote(tx, p2, { visibility: 'shared', body: 'Business traveller, late checkout requests' });
    await svc.addRelationship(tx, p1, { relatedProfileId: spouse.profileId, kind: 'spouse' });
    await svc.addCompanyContact(tx, company.id, { profileId: p2, role: 'booker' });
    await svc.recordConsent(tx, p1, {
      legalEntityId: org.legalEntityId,
      purpose: 'marketing_email',
      state: 'granted',
      source: 'booking_engine',
      evidence: { textVersion: 'mkt-v3', channel: 'booking_engine' },
    });
    await svc.addDocument(tx, p1, {
      propertyId: A,
      type: 'passport',
      issuingCountry: 'AE',
      number: 'P1234567',
    });
    await svc.addDocument(tx, p2, {
      propertyId: B,
      type: 'passport',
      issuingCountry: 'SA',
      number: 'R7654321',
    });
    await svc.recordStayHistory(tx, {
      profileId: p1,
      stayRef: { type: 'stay', id: newId() },
      propertyId: A,
      arrival: '2025-10-01',
      departure: '2025-10-08',
      status: 'departed',
      revenue: { amountMinor: 840_000, currency: 'USD' },
    });
    await svc.recordStayHistory(tx, {
      profileId: p2,
      stayRef: { type: 'stay', id: newId() },
      propertyId: B,
      arrival: '2026-06-10',
      departure: '2026-06-12',
      status: 'departed',
      revenue: { amountMinor: 52_000, currency: 'USD' },
    });
  });
  // Guest 2 withdrew marketing consent later than guest 1 granted it.
  await new Promise((r) => setTimeout(r, 5));
  await org.sys((tx) =>
    svc.recordConsent(tx, p2, {
      legalEntityId: org.legalEntityId,
      purpose: 'marketing_email',
      state: 'withdrawn',
      source: 'front_desk',
      evidence: { channel: 'front_desk' },
    }),
  );
  return { p1, p2, A, B, company, spouse: spouse.profileId };
}

describe('scenario S15 — a mistaken merge is investigated and corrected', () => {
  it('restores both profiles, every child record and every external reference; audit shows both', async () => {
    const org = await setupOrg(t);
    const { p1, p2, A, B } = await twoAhmedAlis(org);
    const svc = org.svc;
    const reservations = new FakeReservations(org);
    const sub = reservations.subscription();
    const bookingOfOne = newId();
    const bookingOfTwo = newId();
    reservations.refs.set(bookingOfOne, p1);
    reservations.refs.set(bookingOfTwo, p2);
    await drain(sub); // settle earlier events

    const before1 = await snap(org, p1);
    const before2 = await snap(org, p2);

    // A duty manager with merge rights at both properties merges the two "Ahmed Ali" profiles by mistake.
    const manager = org.user(
      [
        ...[
          'guests.profile.read',
          'guests.profile.update',
          'guests.profile.merge',
          'guests.profile.unmerge',
        ].map((permission) => ({
          permission,
          propertyIds: [A, B],
        })),
      ],
      newId(),
    );
    const preview = await org.run(manager, (tx) => svc.previewMerge(tx, { survivorId: p1, mergedId: p2 }));
    expect(preview.warnings.join(' ')).toMatch(/different dates of birth/);
    expect(preview.children.stay_history).toEqual({ move: 1, keepOnMerged: 0 });

    const { mergeId } = await org.run(manager, (tx) =>
      svc.mergeProfiles(tx, { survivorId: p1, mergedId: p2, reason: 'Same name — assumed same guest' }),
    );
    await drain(sub);

    // After the merge: one survivor holding the union; the merged id resolves to it; references re-pointed.
    const merged = await org.run(manager, (tx) => svc.getProfile(tx, p2));
    expect(merged.id).toBe(p1);
    expect(merged.resolvedFrom).toEqual([p2]);
    expect(merged.contactPoints).toHaveLength(4);
    expect(merged.preferences.map((p) => p.category).sort()).toEqual(['dietary', 'pillow']);
    expect(merged.consents.find((c) => c.purpose === 'marketing_email')?.state).toBe('withdrawn'); // newer statement wins
    const history = await org.run(manager, (tx) => svc.getStayHistory(tx, p1));
    expect(history.items).toHaveLength(2);
    expect(reservations.refs.get(bookingOfTwo)).toBe(p1);
    const mergeView = await org.run(manager, (tx) => svc.getMerge(tx, mergeId));
    expect(mergeView.referencesRepointed).toEqual({ reservations: 1 });

    // Life goes on: reservations still holding the old id books a new stay for "guest 2"; guest 1 books too.
    const lateStayOfTwo = newId();
    const lateStayOfOne = newId();
    await org.sys(async (tx) => {
      await svc.recordStayHistory(tx, {
        profileId: p2, // old id — resolves to the survivor
        stayRef: { type: 'stay', id: lateStayOfTwo },
        propertyId: B,
        arrival: '2026-12-01',
        departure: '2026-12-03',
        status: 'expected',
      });
      await svc.recordStayHistory(tx, {
        profileId: p1,
        stayRef: { type: 'stay', id: lateStayOfOne },
        propertyId: A,
        arrival: '2026-12-20',
        departure: '2026-12-27',
        status: 'expected',
      });
    });
    reservations.refs.set(`stay:${lateStayOfTwo}`, p1);
    const { noteId: lateNote } = await org.run(manager, (tx) =>
      svc.addNote(tx, p1, {
        visibility: 'shared',
        body: 'Asked about the Riyadh office address — wrong guest?',
      }),
    );

    // Investigation: the unmerge preview lists what was added after the merge, with suggested owners.
    const up = await org.run(manager, (tx) => svc.previewUnmerge(tx, mergeId));
    expect(up.canUnmerge).toBe(true);
    expect(up.referencesToRestore).toEqual({ reservations: 1 });
    const byKind = Object.fromEntries(
      up.postMergeItems.map((i) => [`${i.kind}:${i.summary.split(' ')[1]}`, i]),
    );
    const lateTwo = up.postMergeItems.find(
      (i) => i.kind === 'stay_history' && i.summary.includes(lateStayOfTwo),
    );
    const lateOne = up.postMergeItems.find(
      (i) => i.kind === 'stay_history' && i.summary.includes(lateStayOfOne),
    );
    expect(lateTwo?.suggestedOwner).toBe('restored');
    expect(lateOne?.suggestedOwner).toBe('survivor');
    expect(up.postMergeItems.find((i) => i.kind === 'notes')?.id).toBe(lateNote);
    expect(Object.keys(byKind).length).toBe(3);

    // The manager confirms: the late stay belongs to guest 2, and so does the note.
    await org.run(manager, (tx) =>
      svc.unmergeProfiles(tx, {
        mergeId,
        reason: 'Different guests: different nationality, date of birth and passport',
        assignments: [
          { kind: 'stay_history', id: lateTwo?.id as string, owner: 'restored' },
          { kind: 'stay_history', id: lateOne?.id as string, owner: 'survivor' },
          { kind: 'notes', id: lateNote, owner: 'restored' },
        ],
      }),
    );
    await drain(sub);

    // Both profiles are restored field-for-field and record-for-record (apart from post-merge items).
    const after1 = await snap(org, p1);
    const after2 = await snap(org, p2);
    const postMerge = up.postMergeItems.map((i) => i.id);
    expect(comparable(after1, postMerge)).toEqual(comparable(before1));
    expect(comparable(after2, postMerge)).toEqual(comparable(before2));
    expect(after2.children.stay_history?.map((s) => s.stay_id)).toContain(lateStayOfTwo);
    expect(after1.children.stay_history?.map((s) => s.stay_id)).toContain(lateStayOfOne);
    expect(after2.children.notes?.map((n) => n.id)).toContain(lateNote);
    // Document retention follows each guest's OWN stays again (guest 1's December stay no longer keeps guest 2's
    // passport alive).
    const today = new Date().toISOString().slice(0, 10);
    const retention = (lastDeparture: string) => addDays(lastDeparture > today ? lastDeparture : today, 365);
    expect(after2.children.identity_documents?.[0]?.retain_until).toBe(retention('2026-12-03'));
    expect(after1.children.identity_documents?.[0]?.retain_until).toBe(retention('2026-12-27'));

    // The guest-facing views are separate again.
    const g2 = await org.run(manager, (tx) => svc.getProfile(tx, p2));
    expect(g2.id).toBe(p2);
    expect(g2.resolvedFrom).toBeUndefined();
    expect(g2.nationality).toBe('SA');
    expect(g2.consents.find((c) => c.purpose === 'marketing_email')?.state).toBe('withdrawn');
    const g1 = await org.run(manager, (tx) => svc.getProfile(tx, p1));
    expect(g1.consents.find((c) => c.purpose === 'marketing_email')?.state).toBe('granted');

    // Other modules got exactly their references back, plus the reassigned post-merge stay.
    expect(reservations.refs.get(bookingOfOne)).toBe(p1);
    expect(reservations.refs.get(bookingOfTwo)).toBe(p2);
    expect(reservations.refs.get(`stay:${lateStayOfTwo}`)).toBe(p2);
    const unmerged = await outboxRows(t, org.tenantId, 'guests.profile.unmerged');
    expect(unmerged).toHaveLength(1);
    expect(unmerged[0]?.payload).toMatchObject({
      mergeId,
      restoredId: p2,
      survivorId: p1,
      referencesToRestore: {
        reservations: [{ type: 'booking', id: bookingOfTwo, field: 'bookerProfileId' }],
      },
      reassigned: [{ type: 'stay', id: lateStayOfTwo }],
    });
    // No personal values in the event payloads.
    expect(JSON.stringify(unmerged[0]?.payload)).not.toMatch(/Ahmed|guest\.example|P1234567/);

    // The audit trail shows both events, on both profiles, with reasons and the acting user.
    for (const target of [p1, p2]) {
      const actions = (await auditRows(t, org.tenantId, { targetId: target })).map((a) => a.action);
      expect(actions).toEqual(expect.arrayContaining(['guests.profile.merge', 'guests.profile.unmerge']));
      expect(actions.indexOf('guests.profile.merge')).toBeLessThan(actions.indexOf('guests.profile.unmerge'));
    }
    const unmergeAudit = await auditRows(t, org.tenantId, { action: 'guests.profile.unmerge', targetId: p2 });
    expect(unmergeAudit[0]?.reason).toMatch(/Different guests/);
    expect(unmergeAudit[0]?.actor_key).toBe(`user:${(manager.actor as { userId: string }).userId}`);
    const record = await org.run(manager, (tx) => svc.getMerge(tx, mergeId));
    expect(record).toMatchObject({
      status: 'reversed',
      reverseReason: expect.stringMatching(/Different guests/),
    });

    // The pair is remembered as "not a duplicate" and is not proposed again.
    await org.sys((tx) => svc.detectDuplicates(tx, p2));
    const open = await org.run(manager, (tx) => svc.listDuplicates(tx, { status: 'open' }));
    expect(open.filter((d) => [d.profileAId, d.profileBId].includes(p2))).toHaveLength(0);

    // A reversed merge cannot be reversed twice.
    await expect(
      org.run(manager, (tx) => svc.unmergeProfiles(tx, { mergeId, reason: 'again please' })),
    ).rejects.toMatchObject({ code: 'unmerge_not_possible' });
  });
});

describe('merge invariants', () => {
  it('GUE-I02: merge then unmerge with no intervening change restores both profiles exactly', async () => {
    const org = await setupOrg(t);
    const { p1, p2 } = await twoAhmedAlis(org);
    const b1 = await snap(org, p1);
    const b2 = await snap(org, p2);
    const { mergeId } = await org.sys((tx) =>
      org.svc.mergeProfiles(tx, {
        survivorId: p1,
        mergedId: p2,
        reason: 'test',
        fieldChoices: { nationality: 'merged', dateOfBirth: 'merged' },
      }),
    );
    const mid = await org.sys((tx) => org.svc.getProfile(tx, p1));
    expect(mid).toMatchObject({ nationality: 'SA', dateOfBirth: '1992-11-20' });
    await org.sys((tx) => org.svc.unmergeProfiles(tx, { mergeId, reason: 'test reversal' }));
    expect(comparable(await snap(org, p1))).toEqual(comparable(b1));
    expect(comparable(await snap(org, p2))).toEqual(comparable(b2));
  });

  it('GUE-I01/R12: chains resolve to the active survivor; the earlier merge waits for the later one', async () => {
    const org = await setupOrg(t);
    const [A] = org.properties as [string];
    const mk = (given: string) =>
      org.sys((tx) =>
        org.svc.resolveProfile(
          tx,
          { propertyId: A, givenName: given, familyName: 'Hale' },
          { matchStrategy: 'create_new' },
        ),
      );
    const a = (await mk('Robert')).profileId;
    const b = (await mk('Rob')).profileId;
    const c = (await mk('Bob')).profileId;
    const m1 = await org.sys((tx) =>
      org.svc.mergeProfiles(tx, { survivorId: b, mergedId: a, reason: 'dup' }),
    );
    const m2 = await org.sys((tx) =>
      org.svc.mergeProfiles(tx, { survivorId: c, mergedId: b, reason: 'dup' }),
    );
    const viaA = await org.sys((tx) => org.svc.getProfile(tx, a));
    expect(viaA.id).toBe(c);
    expect(viaA.resolvedFrom).toEqual([a, b]);
    const blocked = await org.sys((tx) => org.svc.previewUnmerge(tx, m1.mergeId));
    expect(blocked.canUnmerge).toBe(false);
    expect(blocked.blockedReason).toContain(m2.mergeId);
    await org.sys((tx) => org.svc.unmergeProfiles(tx, { mergeId: m2.mergeId, reason: 'undo later merge' }));
    await org.sys((tx) => org.svc.unmergeProfiles(tx, { mergeId: m1.mergeId, reason: 'undo earlier merge' }));
    expect((await org.sys((tx) => org.svc.getProfile(tx, a))).id).toBe(a);
  });

  it('the merge preview shows reference counts per module (and says when a module cannot answer)', async () => {
    const org = await setupOrg(t, {
      svc: makeService({
        referenceCounters: [
          { module: 'reservations', countReferences: async () => 3 },
          {
            module: 'finance',
            countReferences: async () => {
              throw new Error('finance not connected');
            },
          },
        ],
      }),
    });
    const { p1, p2 } = await twoAhmedAlis(org);
    const preview = await org.sys((tx) => org.svc.previewMerge(tx, { survivorId: p1, mergedId: p2 }));
    expect(preview.references).toEqual([
      { module: 'reservations', count: 3, status: 'counted' },
      { module: 'finance', count: null, status: 'unavailable' },
    ]);
    expect(preview.fields.find((f) => f.field === 'nationality')).toMatchObject({
      chosen: 'survivor',
      changes: false,
    });
  });

  it('recordReferenceRepoints is idempotent (re-delivered events never inflate the reference map)', async () => {
    const org = await setupOrg(t);
    const { p1, p2 } = await twoAhmedAlis(org);
    const { mergeId } = await org.sys((tx) =>
      org.svc.mergeProfiles(tx, { survivorId: p1, mergedId: p2, reason: 'r' }),
    );
    const consumer = systemContext(org.tenantId, 'consumer:reservations', 'live', newId());
    const ref = { type: 'booking', id: newId() };
    const first = await org.run(consumer, (tx) =>
      org.svc.recordReferenceRepoints(tx, { mergeId, module: 'reservations', references: [ref] }),
    );
    const again = await org.run(consumer, (tx) =>
      org.svc.recordReferenceRepoints(tx, { mergeId, module: 'reservations', references: [ref] }),
    );
    expect([first.recorded, again.recorded]).toEqual([1, 0]);
    expect((await org.sys((tx) => org.svc.getMerge(tx, mergeId))).referencesRepointed).toEqual({
      reservations: 1,
    });
  });

  it('refuses invalid merges with explanations', async () => {
    const org = await setupOrg(t);
    const { p1, p2 } = await twoAhmedAlis(org);
    await expect(
      org.sys((tx) => org.svc.mergeProfiles(tx, { survivorId: p1, mergedId: p1, reason: 'self' })),
    ).rejects.toMatchObject({ code: 'same_profile' });
    await org.sys((tx) => org.svc.mergeProfiles(tx, { survivorId: p1, mergedId: p2, reason: 'once' }));
    await expect(
      org.sys((tx) => org.svc.mergeProfiles(tx, { survivorId: p1, mergedId: p2, reason: 'twice' })),
    ).rejects.toMatchObject({ code: 'profile_already_merged' });
  });

  it('concurrent merges of the same profile into two survivors: exactly one wins', async () => {
    const org = await setupOrg(t);
    const [A] = org.properties as [string];
    const mk = (given: string) =>
      org.sys((tx) =>
        org.svc.resolveProfile(
          tx,
          { propertyId: A, givenName: given, familyName: 'Okafor' },
          { matchStrategy: 'create_new' },
        ),
      );
    const x = (await mk('Chidi')).profileId;
    const s1 = (await mk('Chidiebere')).profileId;
    const s2 = (await mk('Chidi E.')).profileId;
    const results = await Promise.allSettled([
      org.sys((tx) => org.svc.mergeProfiles(tx, { survivorId: s1, mergedId: x, reason: 'race 1' })),
      org.sys((tx) => org.svc.mergeProfiles(tx, { survivorId: s2, mergedId: x, reason: 'race 2' })),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const active = await t.admin.kysely
      .selectFrom('guests.merges')
      .select('id')
      .where('merged_id', '=', x)
      .where('status', '=', 'active')
      .execute();
    expect(active).toHaveLength(1);
  });

  it('merge requires the sensitive permission at a property of each profile', async () => {
    const org = await setupOrg(t);
    const { p1, p2, A } = await twoAhmedAlis(org);
    const onlyA = org.user([
      { permission: 'guests.profile.read', propertyIds: [A] },
      { permission: 'guests.profile.merge', propertyIds: [A] },
    ]);
    // p2 is not visible at A → it does not exist for this user.
    await expect(
      org.run(onlyA, (tx) => org.svc.mergeProfiles(tx, { survivorId: p1, mergedId: p2, reason: 'x' })),
    ).rejects.toMatchObject({ status: 404 });
    const noMerge = org.user([{ permission: 'guests.profile.read', propertyIds: 'all' }]);
    await expect(
      org.run(noMerge, (tx) => org.svc.mergeProfiles(tx, { survivorId: p1, mergedId: p2, reason: 'x' })),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });
});
