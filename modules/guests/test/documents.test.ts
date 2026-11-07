/**
 * Identity documents and special needs (GUE-R02, GUE-R05, GUE-I04): field-encrypted at rest, masked by default,
 * revealed only with the sensitive permission at the capturing property, every view audited with a reason, the
 * number never present in plaintext anywhere (tables, audit, outbox), retention purge.
 */
import { localFieldCipher } from '@portico/kernel';
import type { TestDatabase } from '@portico/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auditRows, outboxRows, setupOrg, startDb, type TestOrg } from './helpers';

let t: TestDatabase;
beforeAll(async () => {
  t = await startDb();
});
afterAll(async () => t?.drop());

const NUMBER = 'X9K4471203';

async function guestWithPassport(org: TestOrg) {
  const [A] = org.properties as [string];
  const { profileId } = await org.sys((tx) =>
    org.svc.resolveProfile(
      tx,
      { propertyId: A, givenName: 'Giulia', familyName: 'Rossi', nationality: 'IT' },
      { matchStrategy: 'create_new' },
    ),
  );
  const { documentId } = await org.sys((tx) =>
    org.svc.addDocument(tx, profileId, {
      propertyId: A,
      type: 'passport',
      issuingCountry: 'IT',
      number: NUMBER,
      expiryDate: '2031-05-31',
      surname: 'ROSSI',
      givenNames: 'GIULIA',
      dateOfBirth: '1985-02-02',
    }),
  );
  return { profileId, documentId, A };
}

async function tenantDump(org: TestOrg): Promise<string> {
  const tables = [
    'guests.identity_documents',
    'guests.profiles',
    'guests.duplicate_candidates',
    'core.audit_log',
    'core.outbox',
  ];
  const out: string[] = [];
  for (const table of tables) {
    const rows = await t.admin.kysely
      .selectFrom(table)
      .selectAll()
      .where('tenant_id', '=', org.tenantId)
      .execute();
    out.push(JSON.stringify(rows));
  }
  return out.join('\n');
}

describe('identity documents', () => {
  it('are encrypted at rest; the number appears nowhere in plaintext (tables, audit, events)', async () => {
    const org = await setupOrg(t);
    const { documentId } = await guestWithPassport(org);
    const row = await t.admin.kysely
      .selectFrom('guests.identity_documents')
      .selectAll()
      .where('id', '=', documentId)
      .executeTakeFirstOrThrow();
    expect(row.enc_payload).toMatch(/^v1\.local\./);
    expect(await tenantDump(org)).not.toContain(NUMBER);
    // The ciphertext is bound to its row: copied into another row it does not decrypt.
    const cipher = localFieldCipher(Buffer.from('guests-test-field-key-0123456789').toString('base64'));
    expect(() =>
      cipher.decrypt(row.enc_payload, `guests.identity_document:${org.tenantId}:${crypto.randomUUID()}`),
    ).toThrow();
  });

  it('are masked in the profile; reveal needs guests.document.read and every view is audited with its reason', async () => {
    const org = await setupOrg(t);
    const { profileId, documentId, A } = await guestWithPassport(org);
    const desk = org.user([{ permission: 'guests.profile.read', propertyIds: [A] }]);
    const p = await org.run(desk, (tx) => org.svc.getProfile(tx, profileId));
    expect(p.documents).toEqual([
      expect.objectContaining({
        id: documentId,
        type: 'passport',
        issuingCountry: 'IT',
        numberMasked: '••••••',
      }),
    ]);
    expect(JSON.stringify(p)).not.toContain(NUMBER);
    await expect(
      org.run(desk, (tx) => org.svc.revealDocument(tx, documentId, 'check-in')),
    ).rejects.toMatchObject({
      code: 'forbidden',
    });
    expect(await auditRows(t, org.tenantId, { action: 'guests.document.read' })).toHaveLength(0);

    const officer = org.user([
      { permission: 'guests.profile.read', propertyIds: [A] },
      { permission: 'guests.document.read', propertyIds: [A] },
    ]);
    const doc = await org.run(officer, (tx) =>
      org.svc.revealDocument(tx, documentId, 'Police registration form'),
    );
    expect(doc).toMatchObject({ number: NUMBER, surname: 'ROSSI', expiryDate: '2031-05-31' });
    await org.run(officer, (tx) => org.svc.revealDocument(tx, documentId, 'Second look'));
    const reads = await auditRows(t, org.tenantId, { action: 'guests.document.read' });
    expect(reads.map((r) => r.reason)).toEqual(['Police registration form', 'Second look']);
    expect(JSON.stringify(reads)).not.toContain(NUMBER);
  });

  it('cannot be revealed from another property, even with document.read there', async () => {
    const org = await setupOrg(t);
    const { documentId } = await guestWithPassport(org);
    const [, B] = org.properties as [string, string];
    const other = org.user([
      { permission: 'guests.profile.read', propertyIds: [B] },
      { permission: 'guests.profile.readShared', propertyIds: [B] },
      { permission: 'guests.document.read', propertyIds: [B] },
    ]);
    await expect(
      org.run(other, (tx) => org.svc.revealDocument(tx, documentId, 'curious')),
    ).rejects.toMatchObject({
      status: 404,
    });
  });

  it('search by last 4 / full number is permission-gated, scoped and audited', async () => {
    const org = await setupOrg(t);
    const { profileId, A } = await guestWithPassport(org);
    const desk = org.user([{ permission: 'guests.profile.read', propertyIds: [A] }]);
    await expect(
      org.run(desk, (tx) => org.svc.searchProfiles(tx, { q: '1203', kind: 'document', limit: 5 })),
    ).rejects.toMatchObject({ code: 'forbidden' });
    const officer = org.user([
      { permission: 'guests.profile.read', propertyIds: [A] },
      { permission: 'guests.document.read', propertyIds: [A] },
    ]);
    const byLast4 = await org.run(officer, (tx) =>
      org.svc.searchProfiles(tx, { q: '1203', kind: 'document', limit: 5 }),
    );
    expect(byLast4.items.map((i) => i.profileId)).toEqual([profileId]);
    const byFull = await org.run(officer, (tx) =>
      org.svc.searchProfiles(tx, { q: `IT:${NUMBER.toLowerCase()}`, kind: 'auto', limit: 5 }),
    );
    expect(byFull.items.map((i) => i.profileId)).toEqual([profileId]);
    expect(await auditRows(t, org.tenantId, { action: 'guests.document.search' })).toHaveLength(2);
  });

  it('image storage is refused unless the property enables it', async () => {
    const org = await setupOrg(t);
    const { profileId, A } = await guestWithPassport(org);
    await expect(
      org.sys((tx) =>
        org.svc.addDocument(tx, profileId, {
          propertyId: A,
          type: 'national_id',
          issuingCountry: 'IT',
          number: 'CA00000AA',
          imageRef: 's3://bucket/id.jpg',
        }),
      ),
    ).rejects.toMatchObject({ code: 'document_images_disabled' });
  });

  it('retention: documents are purged after their retention date, with an audit record per document', async () => {
    const org = await setupOrg(t);
    const { profileId, documentId } = await guestWithPassport(org);
    const row = await t.admin.kysely
      .selectFrom('guests.identity_documents')
      .select('retain_until')
      .where('id', '=', documentId)
      .executeTakeFirstOrThrow();
    const notYet = await org.sys((tx) => org.svc.purgeExpiredDocuments(tx, { asOf: row.retain_until }));
    expect(notYet.deleted).toBe(0);
    const purged = await org.sys((tx) => org.svc.purgeExpiredDocuments(tx, { asOf: '2099-01-01' }));
    expect(purged.documentIds).toContain(documentId);
    expect((await org.sys((tx) => org.svc.getProfile(tx, profileId))).documents).toHaveLength(0);
    expect(await auditRows(t, org.tenantId, { action: 'guests.document.retentionPurge' })).toHaveLength(1);
  });

  it('a later departure extends retention (Q44 default: one year after the last departure)', async () => {
    const org = await setupOrg(t);
    const { profileId, documentId, A } = await guestWithPassport(org);
    await org.sys((tx) =>
      org.svc.recordStayHistory(tx, {
        profileId,
        stayRef: { type: 'stay', id: crypto.randomUUID() },
        propertyId: A,
        arrival: '2028-03-01',
        departure: '2028-03-09',
        status: 'expected',
      }),
    );
    const row = await t.admin.kysely
      .selectFrom('guests.identity_documents')
      .select('retain_until')
      .where('id', '=', documentId)
      .executeTakeFirstOrThrow();
    expect(row.retain_until).toBe('2029-03-09');
  });
});

describe('special needs (sensitive category)', () => {
  it('stores details encrypted, surfaces only the agreed alert text, audits every sensitive read', async () => {
    const org = await setupOrg(t);
    const { profileId, A } = await guestWithPassport(org);
    const desk = org.user([
      { permission: 'guests.profile.read', propertyIds: [A] },
      { permission: 'guests.profile.update', propertyIds: [A] },
    ]);
    const { specialNeedId, alertId } = await org.run(desk, (tx) =>
      org.svc.addSpecialNeed(tx, profileId, {
        propertyId: A,
        category: 'allergy',
        detail: 'Anaphylaxis to tree nuts; carries two EpiPens',
        guestAgreedAlertText: 'Nut allergy — no nuts in any dish',
        audience: ['fnb'],
      }),
    );
    const p = await org.run(desk, (tx) => org.svc.getProfile(tx, profileId));
    expect(p.alerts.find((a) => a.id === alertId)).toMatchObject({
      severity: 'critical',
      text: 'Nut allergy — no nuts in any dish',
    });
    expect(p.specialNeeds).toEqual([expect.objectContaining({ id: specialNeedId, detailAvailable: false })]);
    expect(JSON.stringify(p)).not.toContain('EpiPen');
    expect(await tenantDump(org)).not.toContain('EpiPen');
    await expect(
      org.run(desk, (tx) => org.svc.readSpecialNeed(tx, specialNeedId, 'menu')),
    ).rejects.toMatchObject({
      code: 'forbidden',
    });
    const nurse = org.user([
      { permission: 'guests.profile.read', propertyIds: [A] },
      { permission: 'guests.sensitive.read', propertyIds: [A] },
    ]);
    const read = await org.run(nurse, (tx) =>
      org.svc.readSpecialNeed(tx, specialNeedId, 'Medical emergency on excursion'),
    );
    expect(read.detail).toContain('EpiPens');
    expect(await auditRows(t, org.tenantId, { action: 'guests.sensitive.read' })).toHaveLength(1);
    const events = await outboxRows(t, org.tenantId, 'guests.alert.raised');
    expect(events.length).toBeGreaterThan(0);
  });
});
