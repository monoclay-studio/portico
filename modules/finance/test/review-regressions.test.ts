import { newId } from '@portico/kernel';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { financeForReservations } from '../src';
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

describe('F-04: re-applying billing instructions is a merge (X10, ADR-0016 §2)', () => {
  it('keeps limit usage, keeps staff rules, and previews the changes', async () => {
    const org = await setupOrg(h);
    const { stayId, guestFolioId, companyFolioId } = await openStay(h, org, { company: 'Corp' });
    const owner = { type: 'stay' as const, id: stayId };
    const port = financeForReservations(h.finance);
    const rules = [
      {
        destinationFolioId: companyFolioId as string,
        chargeCodeGroups: ['spa'],
        cap: { kind: 'per_stay' as const, amount: usd(30000) },
        source: 'company_default' as const,
      },
    ];
    await org.run((tx) => port.setBillingRules(tx, { owner, rules }));
    // A staff member adds a manual rule (never touched by re-applied defaults).
    await org.run((tx) =>
      h.finance.createBillingRule(tx, {
        propertyId: org.propertyId,
        owner,
        destinationFolioId: companyFolioId as string,
        label: 'Staff: company pays minibar',
        selector: { chargeCodes: ['MINIBAR'] },
      }),
    );
    const post = (i: number, code = 'SPA') =>
      org.run((tx) =>
        h.finance.postCharge(tx, {
          propertyId: org.propertyId,
          target: owner,
          chargeCode: code,
          amount: usd(20000),
          serviceDate: '2026-11-07',
          description: `${code} ${i}`,
          sourceRef: { type: 't', id: String(i) },
          idempotencyKey: `x10-${i}:${org.tenantId}`,
        }),
      );
    await post(1);
    // Same instructions re-applied (e.g. after a stay change): nothing changes, usage kept.
    const same = await org.run((tx) => port.setBillingRules(tx, { owner, rules }));
    expect(same.ruleIds).toHaveLength(2);
    // A new limit: the successor inherits what the predecessor already paid.
    const preview = await org.run((tx) =>
      h.finance.mergeBillingRules(tx, {
        owner,
        preview: true,
        rules: [
          {
            destinationFolioId: companyFolioId as string,
            label: 'company default: spa',
            selector: { chargeGroups: ['spa'] },
            cap: { kind: 'per_stay', amountMinor: 35000, currency: 'USD' },
            source: 'company_default',
          },
        ],
      }),
    );
    expect(preview.changes).toMatchObject({
      superseded: [expect.objectContaining({ change: 'limit' })],
      untouched: [expect.objectContaining({ label: 'Staff: company pays minibar' })],
      added: [],
      deactivated: [],
    });
    await org.run((tx) =>
      h.finance.mergeBillingRules(tx, {
        owner,
        rules: [
          {
            destinationFolioId: companyFolioId as string,
            label: 'company default: spa',
            selector: { chargeGroups: ['spa'] },
            cap: { kind: 'per_stay', amountMinor: 35000, currency: 'USD' },
            source: 'company_default',
          },
        ],
      }),
    );
    await post(2);
    await post(3, 'MINIBAR');
    const company = await org.run((tx) => h.finance.getFolio(tx, companyFolioId as string));
    const guest = await org.run((tx) => h.finance.getFolio(tx, guestFolioId));
    // spa 257.40 each: company pays up to 350.00 of spa over the stay (usage carried to the successor rule), and
    // the staff minibar rule (257.40) still applies.
    expect(company.balance).toEqual(usd(35000 + 25740));
    expect(guest.balance).toEqual(usd(2 * 25740 - 35000));
  });
});

describe('F-05: tax invoices state value and tax correctly (X11, X12)', () => {
  it('a charge moved twice keeps its taxes as taxes on the invoice', async () => {
    const org = await setupOrg(h);
    const { stayId, guestFolioId, companyFolioId } = await openStay(h, org, { company: 'Corp' });
    const g2 = await org.run((tx) =>
      h.finance.openFolio(tx, {
        propertyId: org.propertyId,
        owner: { type: 'stay', id: stayId },
        payer: { type: 'guest', id: newId(), name: 'Second guest' },
      }),
    );
    const c = await spa(org, guestFolioId, `x11:${org.tenantId}`);
    await org.run((tx) =>
      h.finance.transferPostings(tx, {
        fromFolioId: guestFolioId,
        toFolioId: g2.folioId,
        items: [{ postingId: c.postingIds[0] as string }],
        reason: 'to companion',
        idempotencyKey: `x11-t1:${org.tenantId}`,
      }),
    );
    const g2f = await org.run((tx) => h.finance.getFolio(tx, g2.folioId));
    await org.run((tx) =>
      h.finance.transferPostings(tx, {
        fromFolioId: g2.folioId,
        toFolioId: companyFolioId as string,
        items: g2f.postings.filter((p) => p.kind === 'transfer_in').map((p) => ({ postingId: p.id })),
        reason: 'company pays',
        idempotencyKey: `x11-t2:${org.tenantId}`,
      }),
    );
    const inv = await org.run((tx) =>
      h.finance.issueInvoice(tx, {
        folioId: companyFolioId as string,
        idempotencyKey: `x11-inv:${org.tenantId}`,
      }),
    );
    expect(inv.snapshot.totals).toMatchObject({
      valueBeforeTaxMinor: 11000,
      serviceChargeMinor: 1000,
      taxChargedMinor: 1870,
      totalMinor: 12870,
    });
  });

  it('a deposit taxed at 16% applied after a rise to 17%: the invoice shows the declared rate and the right tax', async () => {
    const org = await setupOrg(h);
    const bookingId = newId();
    const folioId = (
      await org.run((tx) =>
        h.finance.openFolio(tx, {
          propertyId: org.propertyId,
          owner: { type: 'booking', id: bookingId },
          payer: { type: 'guest', id: newId(), name: 'Deposit guest' },
        }),
      )
    ).folioId;
    h.tax.tgstRate = () => '16';
    try {
      await org.run((tx) =>
        h.finance.recordDeposit(tx, {
          bookingId,
          amount: usd(127600),
          paymentRef: { type: 'payment', id: newId() },
          idempotencyKey: `x12-dep:${org.tenantId}`,
        }),
      );
    } finally {
      h.tax.tgstRate = () => '17';
    }
    await org.run((tx) => h.finance.applyDeposits(tx, { bookingId, toFolioId: folioId }));
    await org.run((tx) =>
      h.finance.postCharge(tx, {
        propertyId: org.propertyId,
        folioId,
        chargeCode: 'ROOM',
        amount: usd(100000),
        serviceDate: '2026-11-07',
        description: 'Room',
        sourceRef: { type: 't', id: '1' },
        idempotencyKey: `x12-room:${org.tenantId}`,
      }),
    );
    const inv = await org.run((tx) =>
      h.finance.issueInvoice(tx, { folioId, idempotencyKey: `x12-inv:${org.tenantId}` }),
    );
    const s = inv.snapshot as {
      totals: Record<string, number>;
      depositTaxCredits: Array<{ name: string; rate: string | null }>;
      lines: Array<{ category: string; amountMinor: number }>;
    };
    expect(s.depositTaxCredits).toEqual([expect.objectContaining({ name: 'TGST 16%', rate: '16%' })]);
    // Room 1,000 + SC 100 at 17% = 187.00 TGST; the prepaid part keeps 16%: the difference is a TAX line.
    expect(s.lines.filter((l) => l.category === 'value').reduce((x, l) => x + l.amountMinor, 0)).toBe(100000);
    const tb = await org.run((tx) => h.finance.trialBalance(tx, { legalEntityId: org.legalEntityId }));
    expect(s.totals.taxChargedMinor).toBe(
      -(tb.accounts.find((a) => a.systemKey === 'tax:tgst')?.balanceMinor ?? 0),
    );
  });

  it('prepayment-treated allowances are shown outside value before tax', async () => {
    const org = await setupOrg(h);
    const { stayId, guestFolioId } = await openStay(h, org);
    await org.run((tx) =>
      h.finance.grantAllowance(tx, {
        propertyId: org.propertyId,
        stayId,
        folioId: guestFolioId,
        definitionRef: 'credit',
        label: 'Spa credit',
        period: { night: '2026-11-07' },
        amount: usd(5000),
        chargeCode: 'ALLOW',
        eligibleGroups: ['spa'],
        unusedPolicy: 'forfeit',
        taxTreatment: 'prepayment',
        idempotencyKey: `pp:${stayId}`,
      }),
    );
    await org.run((tx) =>
      h.finance.postCharge(tx, {
        propertyId: org.propertyId,
        target: { type: 'stay', id: stayId },
        chargeCode: 'SPA',
        amount: usd(10000),
        serviceDate: '2026-11-07',
        description: 'Massage',
        sourceRef: { type: 't', id: 's' },
        idempotencyKey: `pps:${stayId}`,
        allowanceRef: 'auto',
      }),
    );
    const inv = await org.run((tx) =>
      h.finance.issueInvoice(tx, { folioId: guestFolioId, idempotencyKey: `ppi:${stayId}` }),
    );
    expect(inv.snapshot.totals).toMatchObject({
      valueBeforeTaxMinor: 11000,
      taxChargedMinor: 1870,
      totalMinor: 12870,
      prepaymentsMinor: 5000,
      settlementsMinor: -5000,
      balanceDueMinor: 12870,
    });
  });
});
