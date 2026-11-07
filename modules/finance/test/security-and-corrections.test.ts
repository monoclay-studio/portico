import { newId } from '@portico/kernel';
import { platform } from '@portico/platform';
import { testContext } from '@portico/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { financeSearch } from '../src';
import {
  advanceBusinessDate,
  assertLedgerIntegrity,
  type Harness,
  openStay,
  setupOrg,
  startHarness,
  usd,
} from './helpers';

let h: Harness;
const summarize = financeSearch.summarize as NonNullable<typeof financeSearch.summarize>;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(async () => h?.t.drop());

const charge = (org: Awaited<ReturnType<typeof setupOrg>>, folioId: string, key: string, amount = 10000) =>
  org.run((tx) =>
    h.finance.postCharge(tx, {
      propertyId: org.propertyId,
      folioId,
      chargeCode: 'FOOD',
      amount: usd(amount),
      serviceDate: '2026-11-07',
      description: 'Dinner',
      sourceRef: { type: 't', id: key },
      idempotencyKey: key,
    }),
  );

describe('tenant isolation (S17) and permissions', () => {
  it('another organization cannot read, post to or find a folio, even with its id', async () => {
    const victim = await setupOrg(h);
    const s = await openStay(h, victim, { guest: 'Private Guest' });
    await charge(victim, s.guestFolioId, `iso:${s.stayId}`);
    const attacker = await setupOrg(h);
    await expect(attacker.run((tx) => h.finance.getFolio(tx, s.guestFolioId))).rejects.toThrow(/not found/);
    await expect(charge(attacker, s.guestFolioId, 'steal')).rejects.toThrow(/not found/);
    await expect(
      attacker.run((tx) =>
        h.finance.recordPayment(tx, {
          folioId: s.guestFolioId,
          amount: usd(1),
          paymentRef: { type: 'p', id: 'x' },
          method: 'card',
          idempotencyKey: 'x',
        }),
      ),
    ).rejects.toThrow(/not found/);
    const hits = await attacker.run((tx) => financeSearch.search(tx, 'Private Guest', { limit: 10 }));
    expect(hits).toEqual([]);
    expect(await attacker.run((tx) => summarize(tx, 'folio', s.guestFolioId))).toBeNull();
    // The victim still sees it, via search too.
    const own = await victim.run((tx) => financeSearch.search(tx, 'Private Guest', { limit: 10 }));
    expect(own.map((x) => x.id)).toContain(s.guestFolioId);
  });

  it('refuses users without the permission or outside their property scope', async () => {
    const org = await setupOrg(h);
    const s = await openStay(h, org);
    const reader = org.as(['finance.folio.read']);
    await expect(org.run((tx) => h.finance.getFolio(tx, s.guestFolioId), reader)).resolves.toBeDefined();
    await expect(
      org.run(
        (tx) =>
          h.finance.postCharge(tx, {
            propertyId: org.propertyId,
            folioId: s.guestFolioId,
            chargeCode: 'FOOD',
            amount: usd(100),
            serviceDate: '2026-11-07',
            description: 'x',
            sourceRef: { type: 't', id: 'x' },
            idempotencyKey: 'nope',
          }),
        reader,
      ),
    ).rejects.toThrow(/finance\.posting\.create/);
    const otherProperty = org.as(['finance.folio.read', 'finance.posting.create'], [newId()]);
    await expect(org.run((tx) => h.finance.getFolio(tx, s.guestFolioId), otherProperty)).rejects.toThrow(
      /permission/,
    );
    const desk = org.as(['finance.folio.read', 'finance.posting.create']);
    const detail = await org.run((tx) => h.finance.getFolio(tx, s.guestFolioId), desk);
    expect(detail.allowedActions.find((a) => a.action === 'correctPosting')).toMatchObject({
      enabled: false,
      reason: expect.stringContaining('finance.posting.correct'),
    });
    // Corrections are sensitive.
    const res = await charge(org, s.guestFolioId, `c:${s.stayId}`);
    await expect(
      org.run(
        (tx) =>
          h.finance.adjustPosting(tx, {
            postingId: res.postingIds[0] as string,
            reasonCode: 'x',
            note: 'x',
            idempotencyKey: 'a',
          }),
        desk,
      ),
    ).rejects.toThrow(/finance\.posting\.correct/);
  });

  it('respects data authority: no postings when charges are kept in another system', async () => {
    const org = await setupOrg(h);
    const s = await openStay(h, org);
    await org.run((tx) =>
      platform.setDataAuthority(tx, {
        propertyId: org.propertyId,
        domain: 'charges',
        authority: 'external',
        connectionId: newId(),
        systemName: 'Legacy PMS',
        writeMode: 'read_only',
        reason: 'connect-alongside evaluation',
      }),
    );
    await expect(charge(org, s.guestFolioId, 'da1')).rejects.toThrow(/Legacy PMS is the system of record/);
    await org.run((tx) =>
      platform.setDataAuthority(tx, {
        propertyId: org.propertyId,
        domain: 'charges',
        authority: 'external',
        connectionId: newId(),
        systemName: 'Legacy PMS',
        writeMode: 'forward',
        reason: 'forwarding',
      }),
    );
    await expect(charge(org, s.guestFolioId, 'da2')).rejects.toThrow(/Forwarding charges/);
  });
});

describe('transfers and corrections', () => {
  it('moves a charge with its taxes between folios, traceable on both sides; invoiced postings cannot move', async () => {
    const org = await setupOrg(h);
    const s = await openStay(h, org, { company: 'Reef Diving Co' });
    const res = await charge(org, s.guestFolioId, `t:${s.stayId}`);
    const partial = await org.run((tx) =>
      h.finance.transferPostings(tx, {
        fromFolioId: s.guestFolioId,
        toFolioId: s.companyFolioId as string,
        items: [{ postingId: res.postingIds[0] as string, amountMinor: 6435 }],
        reason: 'Company pays half of the dinner',
        idempotencyKey: `tr:${s.stayId}`,
      }),
    );
    expect(partial.postingIds).toHaveLength(6); // charge + 2 taxes, each out and in
    const guest = await org.run((tx) => h.finance.getFolio(tx, s.guestFolioId));
    const company = await org.run((tx) => h.finance.getFolio(tx, s.companyFolioId as string));
    expect(guest.balance).toEqual(usd(12870 - 6435));
    expect(company.balance).toEqual(usd(6435));
    expect(company.postings.every((p) => p.kind === 'transfer_in' && p.correctsPostingId)).toBe(true);
    await expect(
      org.run((tx) =>
        h.finance.transferPostings(tx, {
          fromFolioId: s.guestFolioId,
          toFolioId: s.companyFolioId as string,
          items: [{ postingId: res.postingIds[0] as string, amountMinor: 7000 }],
          reason: 'too much',
          idempotencyKey: `tr2:${s.stayId}`,
        }),
      ),
    ).rejects.toThrow(/remain on this folio/);
    await org.run((tx) =>
      h.finance.issueInvoice(tx, { folioId: s.guestFolioId, idempotencyKey: `i:${s.stayId}` }),
    );
    await expect(
      org.run((tx) =>
        h.finance.transferPostings(tx, {
          fromFolioId: s.guestFolioId,
          toFolioId: s.companyFolioId as string,
          items: [{ postingId: res.postingIds[0] as string }],
          reason: 'after invoice',
          idempotencyKey: `tr3:${s.stayId}`,
        }),
      ),
    ).rejects.toThrow(/issued invoice/);
    await expect(
      org.run(async (tx) => {
        const other = await setupOrg(h);
        return h.finance.transferPostings(tx, {
          fromFolioId: s.guestFolioId,
          toFolioId: other.propertyId,
          amountMinor: 1,
          reason: 'x',
          idempotencyKey: 'xx',
        });
      }),
    ).rejects.toThrow(/not found/);
    await assertLedgerIntegrity(h, org);
  });

  it('corrects an earlier day’s charge with a linked adjustment reported as a restatement', async () => {
    const org = await setupOrg(h);
    const s = await openStay(h, org);
    const res = await charge(org, s.guestFolioId, `r:${s.stayId}`);
    await advanceBusinessDate(org, '2026-11-07');
    const adj = await org.run((tx) =>
      h.finance.adjustPosting(tx, {
        postingId: res.postingIds[0] as string,
        amountMinor: 12870,
        reasonCode: 'wrong_room',
        note: 'Charged to the wrong villa',
        idempotencyKey: `adj:${s.stayId}`,
      }),
    );
    expect(adj.postingIds).toHaveLength(3);
    const folio = await org.run((tx) => h.finance.getFolio(tx, s.guestFolioId));
    expect(folio.balance).toEqual(usd(0));
    expect(folio.postings.filter((p) => p.kind === 'adjustment').every((p) => p.correctsPostingId)).toBe(
      true,
    );
    const day1 = await org.run((tx) =>
      h.finance.dailyRevenue(tx, { propertyId: org.propertyId, businessDate: '2026-11-07' }),
    );
    expect(day1.totalRevenueMinor).toBe(10000); // the original day is never silently changed
    expect(day1.restatements).toEqual([
      expect.objectContaining({
        entryId: adj.entryId,
        relatesTo: '2026-11-07',
        reason: 'wrong_room',
        amountMinor: -10000,
      }),
    ]);
    await expect(
      org.run((tx) =>
        h.finance.adjustPosting(tx, {
          postingId: res.postingIds[0] as string,
          reasonCode: 'again',
          note: 'again',
          idempotencyKey: `adj2:${s.stayId}`,
        }),
      ),
    ).rejects.toThrow(/already been fully corrected/);
    await assertLedgerIntegrity(h, org);
  });

  it('never lets two concurrent charges both use the same remaining billing-rule limit', async () => {
    const org = await setupOrg(h);
    const s = await openStay(h, org, { company: 'Capped Corp' });
    await org.run((tx) =>
      h.finance.createBillingRule(tx, {
        propertyId: org.propertyId,
        owner: { type: 'stay', id: s.stayId },
        destinationFolioId: s.companyFolioId as string,
        label: 'Company pays meals up to 150.00 a night',
        selector: { chargeGroups: ['food'] },
        cap: { kind: 'per_night', amountMinor: 15000, currency: 'USD' },
      }),
    );
    await Promise.all(
      [1, 2, 3, 4].map((i) =>
        org.run((tx) =>
          h.finance.postCharge(tx, {
            propertyId: org.propertyId,
            target: { type: 'stay', id: s.stayId },
            chargeCode: 'FOOD',
            amount: usd(10000),
            serviceDate: '2026-11-07',
            description: `Meal ${i}`,
            sourceRef: { type: 't', id: String(i) },
            idempotencyKey: `cap:${s.stayId}:${i}`,
          }),
        ),
      ),
    );
    const company = await org.run((tx) => h.finance.getFolio(tx, s.companyFolioId as string));
    const guest = await org.run((tx) => h.finance.getFolio(tx, s.guestFolioId));
    expect(company.balance).toEqual(usd(15000));
    expect(guest.balance).toEqual(usd(4 * 12870 - 15000));
  });

  it('exposes finance record types for search and summaries', async () => {
    const org = await setupOrg(h);
    const s = await openStay(h, org, { guest: 'Searchable Person' });
    await charge(org, s.guestFolioId, `s:${s.stayId}`);
    const inv = await org.run((tx) =>
      h.finance.issueInvoice(tx, { folioId: s.guestFolioId, idempotencyKey: `inv:${s.stayId}` }),
    );
    const hits = await org.run((tx) => financeSearch.search(tx, inv.documentNumber, { limit: 5 }));
    expect(hits[0]).toMatchObject({ type: 'fiscal_document', id: inv.id, title: inv.documentNumber });
    const summary = await org.run((tx) => summarize(tx, 'folio', s.guestFolioId));
    expect(summary).toMatchObject({ title: 'Searchable Person', status: { folio: 'open' } });
    const noPerm = { ...org.ctx, authz: testContext({ grants: [] }).authz };
    expect(await org.run((tx) => financeSearch.search(tx, 'Searchable', { limit: 5 }), noPerm)).toEqual([]);
  });

  it('reverses a whole charge entry exactly once, restoring allowance usage', async () => {
    const org = await setupOrg(h);
    const s = await openStay(h, org);
    await org.run((tx) =>
      h.finance.grantAllowance(tx, {
        propertyId: org.propertyId,
        stayId: s.stayId,
        folioId: s.guestFolioId,
        definitionRef: 'credit',
        label: 'Dining credit',
        period: { night: '2026-11-07' },
        amount: usd(5000),
        chargeCode: 'ALLOW',
        eligibleTags: ['dining'],
        unusedPolicy: 'forfeit',
        idempotencyKey: `g:${s.stayId}`,
      }),
    );
    const res = await org.run((tx) =>
      h.finance.postCharge(tx, {
        propertyId: org.propertyId,
        target: { type: 'stay', id: s.stayId },
        chargeCode: 'FOOD',
        amount: usd(10000),
        serviceDate: '2026-11-07',
        description: 'Dinner on the wrong villa',
        sourceRef: { type: 't', id: 'w' },
        idempotencyKey: `w:${s.stayId}`,
        allowanceRef: 'auto',
      }),
    );
    expect(res.allowanceUsage).toEqual(usd(5000));
    const rev = await org.run((tx) =>
      h.finance.reverseEntry(tx, {
        entryId: res.entryId,
        reasonCode: 'wrong_stay',
        note: 'Posted to the wrong villa',
        idempotencyKey: `rv:${s.stayId}`,
      }),
    );
    expect(rev.postingIds).toHaveLength(res.postingIds.length);
    await expect(
      org.run((tx) =>
        h.finance.reverseEntry(tx, {
          entryId: res.entryId,
          reasonCode: 'again',
          note: 'again',
          idempotencyKey: `rv2:${s.stayId}`,
        }),
      ),
    ).rejects.toThrow(/already reversed/);
    const folio = await org.run((tx) => h.finance.getFolio(tx, s.guestFolioId));
    expect(folio.balance).toEqual(usd(5000)); // only the granted allowance remains
    const [allowance] = await org.run((tx) => h.finance.listAllowances(tx, s.stayId));
    expect(allowance?.remaining).toEqual(usd(5000));
    await assertLedgerIntegrity(h, org);
  });

  it('places legal holds that stop any purge before retention ends', async () => {
    const org = await setupOrg(h);
    const s = await openStay(h, org);
    await charge(org, s.guestFolioId, `lh:${s.stayId}`);
    await org.run((tx) =>
      h.finance.issueInvoice(tx, { folioId: s.guestFolioId, idempotencyKey: `lh:${s.stayId}` }),
    );
    const late = await org.run((tx) =>
      h.finance.retentionStatus(tx, { legalEntityId: org.legalEntityId, asOf: '2032-01-01' }),
    );
    expect(late).toEqual({ activeHolds: 0, earliestRetainUntil: '2031-12-31', purgeableDocuments: 1 });
    const hold = await org.run((tx) =>
      h.finance.placeLegalHold(tx, { legalEntityId: org.legalEntityId, reason: 'MIRA audit 2031' }),
    );
    expect(
      (
        await org.run((tx) =>
          h.finance.retentionStatus(tx, { legalEntityId: org.legalEntityId, asOf: '2032-01-01' }),
        )
      ).purgeableDocuments,
    ).toBe(0);
    await org.run((tx) => h.finance.releaseLegalHold(tx, { holdId: hold.id, reason: 'Audit closed' }));
    expect(
      (
        await org.run((tx) =>
          h.finance.retentionStatus(tx, { legalEntityId: org.legalEntityId, asOf: '2026-12-01' }),
        )
      ).purgeableDocuments,
    ).toBe(0);
  });
});
