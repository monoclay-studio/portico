import { newId } from '@portico/kernel';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assertLedgerIntegrity, type Harness, openStay, setupOrg, startHarness, usd } from './helpers';

/** Regression tests for the steward review (docs/orchestration/reviews/review-finance.md, probes X7–X12). */
let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(async () => h?.t.drop());

const spa = (org: Awaited<ReturnType<typeof setupOrg>>, folioId: string, key: string) =>
  org.run((tx) =>
    h.finance.postCharge(tx, {
      propertyId: org.propertyId,
      folioId,
      chargeCode: 'SPA',
      amount: usd(10000),
      serviceDate: '2026-11-07',
      description: 'Massage',
      sourceRef: { type: 't', id: key },
      idempotencyKey: key,
    }),
  );

describe('F-01: concurrent corrections never exceed the original (X7)', () => {
  it('three concurrent full adjustments with different keys correct the charge exactly once', async () => {
    const org = await setupOrg(h);
    const { guestFolioId } = await openStay(h, org);
    const c = await spa(org, guestFolioId, `x7:${org.tenantId}`);
    const results = await Promise.allSettled(
      [1, 2, 3].map((i) =>
        org.run((tx) =>
          h.finance.adjustPosting(tx, {
            postingId: c.postingIds[0] as string,
            reasonCode: 'goodwill',
            note: 'full correction',
            idempotencyKey: `x7-adj-${i}:${org.tenantId}`,
          }),
        ),
      ),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(
      results.filter((r) => r.status === 'rejected').map((r) => String((r as PromiseRejectedResult).reason)),
    ).toEqual([
      expect.stringMatching(/already been fully corrected/),
      expect.stringMatching(/already been fully corrected/),
    ]);
    expect((await org.run((tx) => h.finance.getFolio(tx, guestFolioId))).balance).toEqual(usd(0));
    const tb = await org.run((tx) => h.finance.trialBalance(tx, { legalEntityId: org.legalEntityId }));
    expect(tb.accounts.find((a) => a.systemKey === 'revenue:spa')?.balanceMinor).toBe(0);
    await assertLedgerIntegrity(h, org);
  });

  it('an adjustment racing a full reversal cannot both succeed', async () => {
    const org = await setupOrg(h);
    const { guestFolioId } = await openStay(h, org);
    const c = await spa(org, guestFolioId, `xr:${org.tenantId}`);
    const results = await Promise.allSettled([
      org.run((tx) =>
        h.finance.reverseEntry(tx, {
          entryId: c.entryId,
          reasonCode: 'wrong',
          note: 'n',
          idempotencyKey: `rv:${org.tenantId}`,
        }),
      ),
      org.run((tx) =>
        h.finance.adjustPosting(tx, {
          postingId: c.postingIds[0] as string,
          reasonCode: 'x',
          note: 'n',
          idempotencyKey: `ad:${org.tenantId}`,
        }),
      ),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect((await org.run((tx) => h.finance.getFolio(tx, guestFolioId))).balance).toEqual(usd(0));
  });

  it('concurrent refunds of one payment never exceed it', async () => {
    const org = await setupOrg(h);
    const { guestFolioId } = await openStay(h, org);
    const paymentRef = { type: 'payment', id: newId() };
    await org.run((tx) =>
      h.finance.recordPayment(tx, {
        folioId: guestFolioId,
        amount: usd(10000),
        paymentRef,
        method: 'card',
        idempotencyKey: `p:${org.tenantId}`,
      }),
    );
    const results = await Promise.allSettled(
      [1, 2, 3].map((i) =>
        org.run((tx) =>
          h.finance.recordRefund(tx, {
            folioId: guestFolioId,
            amount: usd(6000),
            refundRef: { type: 'refund', id: newId() },
            originalPaymentRef: paymentRef,
            idempotencyKey: `r${i}:${org.tenantId}`,
          }),
        ),
      ),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect((await org.run((tx) => h.finance.getFolio(tx, guestFolioId))).balance).toEqual(usd(-4000));
  });
});

describe('F-02: concurrent credit notes never credit an invoice twice (X8)', () => {
  it('two adjusting credit notes for the whole invoice: one is issued, the other refused', async () => {
    const org = await setupOrg(h);
    const { guestFolioId } = await openStay(h, org);
    await spa(org, guestFolioId, `x8:${org.tenantId}`);
    const inv = await org.run((tx) =>
      h.finance.issueInvoice(tx, { folioId: guestFolioId, idempotencyKey: `x8i:${org.tenantId}` }),
    );
    const results = await Promise.allSettled(
      [1, 2].map((i) =>
        org.run((tx) =>
          h.finance.issueCreditNote(tx, {
            invoiceId: inv.id,
            mode: 'adjust',
            reason: 'not provided',
            idempotencyKey: `x8cn${i}:${org.tenantId}`,
          }),
        ),
      ),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(String((results.find((r) => r.status === 'rejected') as PromiseRejectedResult).reason)).toMatch(
      /already fully credited|already been fully corrected/,
    );
    expect((await org.run((tx) => h.finance.getFolio(tx, guestFolioId))).balance).toEqual(usd(0));
    expect((await org.run((tx) => h.finance.verifyFiscalLedger(tx, org.legalEntityId))).ok).toBe(true);
  });
});

describe('F-03: nested rules accepted at save never block posting (X9)', () => {
  it('a multi-code rule nested in a group rule routes by specificity', async () => {
    const org = await setupOrg(h);
    const { stayId, companyFolioId } = await openStay(h, org, { company: 'Maldivian Holidays Ltd' });
    const agency = await org.run((tx) =>
      h.finance.openFolio(tx, {
        propertyId: org.propertyId,
        owner: { type: 'stay', id: stayId },
        payer: { type: 'agency', id: newId(), name: 'Agency' },
      }),
    );
    const owner = { type: 'stay' as const, id: stayId };
    await org.run((tx) =>
      h.finance.createBillingRule(tx, {
        propertyId: org.propertyId,
        owner,
        destinationFolioId: companyFolioId as string,
        label: 'Company: breakfast and restaurant',
        selector: { chargeCodes: ['BRKF', 'FOOD'] },
      }),
    );
    await org.run((tx) =>
      h.finance.createBillingRule(tx, {
        propertyId: org.propertyId,
        owner,
        destinationFolioId: agency.folioId,
        label: 'Agency: all food and beverage',
        selector: { chargeGroups: ['food', 'beverage'] },
      }),
    );
    const post = (code: string) =>
      org.run((tx) =>
        h.finance.postCharge(tx, {
          propertyId: org.propertyId,
          target: owner,
          chargeCode: code,
          amount: usd(2000),
          serviceDate: '2026-11-07',
          description: code,
          sourceRef: { type: 't', id: code },
          idempotencyKey: `x9:${code}:${org.tenantId}`,
        }),
      );
    expect((await post('BRKF')).folioId).toBe(companyFolioId);
    expect((await post('BEV')).folioId).toBe(agency.folioId);
  });
});
