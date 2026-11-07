/**
 * Cross-property profile sharing (brief §7, GUE-R16, GUE-I05, Q46): organization-wide profiles, visible at other
 * properties only with `guests.profile.readShared`, the `portfolio.crossPropertyProfiles` entitlement, the
 * organization's sharing policy, and no objection from the guest. Property-private data never leaves its
 * property. Switching sharing off hides shared data and deletes nothing; switching it on again restores it.
 */
import { platform } from '@portico/platform';
import type { TestDatabase } from '@portico/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupOrg, startDb, type TestOrg } from './helpers';

let t: TestDatabase;
beforeAll(async () => {
  t = await startDb();
});
afterAll(async () => t?.drop());

async function guestKnownAtA(org: TestOrg) {
  const [A] = org.properties as [string, string];
  const res = await org.sys((tx) =>
    org.svc.resolveProfile(
      tx,
      {
        propertyId: A,
        givenName: 'Lukas',
        familyName: 'Müller',
        nationality: 'DE',
        contactPoints: [{ kind: 'email', value: 'lukas.mueller@guest.example', verified: true }],
      },
      { matchStrategy: 'create_new' },
    ),
  );
  const id = res.profileId;
  await org.sys(async (tx) => {
    await org.svc.addNote(tx, id, {
      propertyId: A,
      visibility: 'property_private',
      body: 'Complained about the jetty noise',
    });
    await org.svc.addNote(tx, id, { propertyId: A, visibility: 'shared', body: 'Loves the house reef' });
    await org.svc.addAlert(tx, id, {
      propertyId: A,
      severity: 'info',
      text: 'Resort-only alert',
      visibility: 'property_private',
    });
    await org.svc.addAlert(tx, id, {
      propertyId: A,
      severity: 'important',
      text: 'Travels with a drone',
      visibility: 'shared',
    });
    await org.svc.addPreference(tx, id, { category: 'villa', value: 'Sunset side', scopePropertyId: A });
    await org.svc.addPreference(tx, id, { category: 'pillow', value: 'Feather-free' });
    await org.svc.addDocument(tx, id, {
      propertyId: A,
      type: 'passport',
      issuingCountry: 'DE',
      number: 'C01X00T47',
    });
    await org.svc.recordStayHistory(tx, {
      profileId: id,
      stayRef: { type: 'stay', id: crypto.randomUUID() },
      propertyId: A,
      arrival: '2026-01-05',
      departure: '2026-01-12',
      status: 'departed',
    });
  });
  return id;
}

const setSharing = (
  org: TestOrg,
  value: { enabled: boolean; requireConsent?: boolean },
  propertyId?: string,
) =>
  org.sys((tx) =>
    platform.setPolicy(tx, {
      key: 'guests.crossPropertySharing',
      scopeType: propertyId ? 'property' : 'organization',
      scopeId: propertyId ?? org.tenantId,
      value: { requireConsent: false, ...value },
      reason: 'test',
    }),
  );

describe('cross-property sharing', () => {
  it('without readShared, staff at another property see nothing (404) and search returns nothing', async () => {
    const org = await setupOrg(t);
    const [, B] = org.properties as [string, string];
    const id = await guestKnownAtA(org);
    const deskB = org.user([{ permission: 'guests.profile.read', propertyIds: [B] }]);
    await expect(org.run(deskB, (tx) => org.svc.getProfile(tx, id))).rejects.toMatchObject({ status: 404 });
    const found = await org.run(deskB, (tx) =>
      org.svc.searchProfiles(tx, { q: 'Muller', kind: 'auto', limit: 10 }),
    );
    expect(found.items).toHaveLength(0);
    const byEmail = await org.run(deskB, (tx) =>
      org.svc.searchProfiles(tx, { q: 'lukas.mueller@guest.example', kind: 'auto', limit: 10 }),
    );
    expect(byEmail.items).toHaveLength(0);
  });

  it('with readShared + entitlement + policy: shared fields only; private data never crosses', async () => {
    const org = await setupOrg(t);
    const [, B] = org.properties as [string, string];
    const id = await guestKnownAtA(org);
    const deskB = org.user([
      { permission: 'guests.profile.read', propertyIds: [B] },
      { permission: 'guests.profile.readShared', propertyIds: [B] },
      { permission: 'guests.document.read', propertyIds: [B] },
    ]);
    const p = await org.run(deskB, (tx) => org.svc.getProfile(tx, id));
    expect(p.visibility).toBe('shared');
    expect(p.contactPoints).toHaveLength(1);
    expect(p.notes.map((n) => n.body)).toEqual(['Loves the house reef']);
    expect(p.alerts.map((a) => a.text)).toEqual(['Travels with a drone']);
    expect(p.preferences.map((x) => x.value)).toEqual(['Feather-free']);
    expect(p.documents).toHaveLength(0); // identity documents are never shared, even with document.read at B
    const history = await org.run(deskB, (tx) => org.svc.getStayHistory(tx, id));
    expect(history.items).toHaveLength(1);
    const found = await org.run(deskB, (tx) =>
      org.svc.searchProfiles(tx, { q: 'Lukas Muller', kind: 'auto', limit: 10 }),
    );
    expect(found.items.map((i) => [i.profileId, i.visibility])).toEqual([[id, 'shared']]);
  });

  it('the property view narrows to that property (GUE-I05)', async () => {
    const org = await setupOrg(t);
    const [A, B] = org.properties as [string, string];
    const id = await guestKnownAtA(org);
    const gm = org.user([{ permission: 'guests.profile.read', propertyIds: [A, B] }]);
    expect((await org.run(gm, (tx) => org.svc.getProfile(tx, id))).visibility).toBe('full');
    await expect(org.run(gm, (tx) => org.svc.getProfile(tx, id, { propertyId: B }))).rejects.toMatchObject({
      status: 404,
    });
  });

  it('switching sharing off hides shared data, deletes nothing, and is reversible', async () => {
    const org = await setupOrg(t);
    const [, B] = org.properties as [string, string];
    const id = await guestKnownAtA(org);
    const deskB = org.user([
      { permission: 'guests.profile.read', propertyIds: [B] },
      { permission: 'guests.profile.readShared', propertyIds: [B] },
    ]);
    await setSharing(org, { enabled: false });
    await expect(org.run(deskB, (tx) => org.svc.getProfile(tx, id))).rejects.toMatchObject({ status: 404 });
    expect(
      (await org.run(deskB, (tx) => org.svc.searchProfiles(tx, { q: 'Muller', kind: 'auto', limit: 10 })))
        .items,
    ).toHaveLength(0);
    await setSharing(org, { enabled: true });
    const p = await org.run(deskB, (tx) => org.svc.getProfile(tx, id));
    expect(p.notes).toHaveLength(1);
    expect(p.alerts).toHaveLength(1);
  });

  it('a guest known at both properties: other properties’ shared items follow the sharing switch', async () => {
    const org = await setupOrg(t);
    const [, B] = org.properties as [string, string];
    const id = await guestKnownAtA(org);
    // The guest also books at B → known at B (full view there), but A's shared data is governed by sharing.
    await org.sys((tx) =>
      org.svc.recordStayHistory(tx, {
        profileId: id,
        stayRef: { type: 'stay', id: crypto.randomUUID() },
        propertyId: B,
        arrival: '2026-11-20',
        departure: '2026-11-22',
        status: 'expected',
      }),
    );
    const deskB = org.user([{ permission: 'guests.profile.read', propertyIds: [B] }]); // no readShared
    const p = await org.run(deskB, (tx) => org.svc.getProfile(tx, id));
    expect(p.visibility).toBe('full');
    expect(p.notes).toHaveLength(0); // A's shared note is not visible without sharing
    expect(p.contactPoints).toHaveLength(1); // identity/contact are organization-wide
    const history = await org.run(deskB, (tx) => org.svc.getStayHistory(tx, id));
    expect(history.items.map((s) => s.propertyId)).toEqual([B]);
  });

  it('the plan entitlement gates sharing (no portfolio.crossPropertyProfiles → never shared)', async () => {
    const org = await setupOrg(t, { plan: 'professional' });
    const [, B] = org.properties as [string, string];
    const id = await guestKnownAtA(org);
    const deskB = org.user([
      { permission: 'guests.profile.read', propertyIds: [B] },
      { permission: 'guests.profile.readShared', propertyIds: [B] },
    ]);
    await expect(org.run(deskB, (tx) => org.svc.getProfile(tx, id))).rejects.toMatchObject({ status: 404 });
  });

  it('the guest’s objection (withdrawn sharing consent) stops sharing; explicit-consent policy requires a grant', async () => {
    const org = await setupOrg(t);
    const [A, B] = org.properties as [string, string];
    const id = await guestKnownAtA(org);
    const deskB = org.user([
      { permission: 'guests.profile.read', propertyIds: [B] },
      { permission: 'guests.profile.readShared', propertyIds: [B] },
    ]);
    await org.sys((tx) =>
      org.svc.recordConsent(tx, id, {
        propertyId: A,
        purpose: 'cross_property_sharing',
        state: 'withdrawn',
        source: 'front_desk',
        evidence: { channel: 'front_desk' },
      }),
    );
    await expect(org.run(deskB, (tx) => org.svc.getProfile(tx, id))).rejects.toMatchObject({ status: 404 });
    await org.sys((tx) =>
      org.svc.recordConsent(tx, id, {
        propertyId: A,
        purpose: 'cross_property_sharing',
        state: 'unknown',
        source: 'front_desk',
        evidence: { channel: 'front_desk' },
      }),
    );
    expect((await org.run(deskB, (tx) => org.svc.getProfile(tx, id))).visibility).toBe('shared');
    await setSharing(org, { enabled: true, requireConsent: true });
    await expect(org.run(deskB, (tx) => org.svc.getProfile(tx, id))).rejects.toMatchObject({ status: 404 });
    await org.sys((tx) =>
      org.svc.recordConsent(tx, id, {
        propertyId: A,
        purpose: 'cross_property_sharing',
        state: 'granted',
        source: 'guest_portal',
        evidence: { textVersion: 'share-v1', channel: 'guest_portal' },
      }),
    );
    expect((await org.run(deskB, (tx) => org.svc.getProfile(tx, id))).visibility).toBe('shared');
  });

  it('a property can opt out of receiving shared profiles (local policy override)', async () => {
    const org = await setupOrg(t, { properties: 3 });
    const [, B, C] = org.properties as [string, string, string];
    const id = await guestKnownAtA(org);
    await setSharing(org, { enabled: false }, C);
    const shared = (p: string) =>
      org.user([
        { permission: 'guests.profile.read', propertyIds: [p] },
        { permission: 'guests.profile.readShared', propertyIds: [p] },
      ]);
    expect((await org.run(shared(B), (tx) => org.svc.getProfile(tx, id))).visibility).toBe('shared');
    await expect(org.run(shared(C), (tx) => org.svc.getProfile(tx, id))).rejects.toMatchObject({
      status: 404,
    });
  });

  it('department notes are visible to their author and to holders of guests.note.readPrivate', async () => {
    const org = await setupOrg(t);
    const [A] = org.properties as [string, string];
    const id = await guestKnownAtA(org);
    const author = org.user([
      { permission: 'guests.profile.read', propertyIds: [A] },
      { permission: 'guests.profile.update', propertyIds: [A] },
    ]);
    await org.run(author, (tx) =>
      org.svc.addNote(tx, id, {
        propertyId: A,
        visibility: 'department',
        department: 'spa',
        body: 'Prefers female therapist',
      }),
    );
    const colleague = org.user([{ permission: 'guests.profile.read', propertyIds: [A] }]);
    const spaLead = org.user([
      { permission: 'guests.profile.read', propertyIds: [A] },
      { permission: 'guests.note.readPrivate', propertyIds: [A] },
    ]);
    const body = (ctx: typeof author) =>
      org.run(ctx, async (tx) => (await org.svc.getProfile(tx, id)).notes.map((n) => n.body));
    expect(await body(author)).toContain('Prefers female therapist');
    expect(await body(spaLead)).toContain('Prefers female therapist');
    expect(await body(colleague)).not.toContain('Prefers female therapist');
  });
});
