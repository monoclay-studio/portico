import { sql } from '@portico/db';
import { newId } from '@portico/kernel';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  assertLedgerIntegrity,
  type Harness,
  type Org,
  openStay,
  setupOrg,
  startHarness,
  usd,
} from './helpers';

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(async () => h?.t.drop());

async function folioWithCharge(org: Org, amount = 10000) {
  const s = await openStay(h, org, { guest: 'Kenji Sato' });
  await org.run((tx) =>
    h.finance.postCharge(tx, {
      propertyId: org.propertyId,
      folioId: s.guestFolioId,
      chargeCode: 'SPA',
      amount: usd(amount),
      serviceDate: '2026-11-07',
      description: 'Spa ritual',
      sourceRef: { type: 't', id: s.stayId },
      idempotencyKey: `spa:${s.stayId}`,
    }),
  );
  return s;
}

describe('fiscal documents', () => {
  it('numbers invoices gaplessly under concurrency, hash-chains them and replays retries', async () => {
    const org = await setupOrg(h);
    const folios: Array<Awaited<ReturnType<typeof folioWithCharge>>> = [];
    for (let i = 0; i < 12; i++) folios.push(await folioWithCharge(org, 1000 + i));
    // Every request issued twice concurrently (a retry racing the original) plus one doomed request.
    const attempts = folios
      .flatMap((f) => [f, f])
      .map((f) =>
        org.run((tx) =>
          h.finance.issueInvoice(tx, { folioId: f.guestFolioId, idempotencyKey: `inv:${f.stayId}` }),
        ),
      );
    const results = await Promise.all(attempts);
    const numbers = [...new Set(results.map((d) => d.number))].sort((a, b) => a - b);
    expect(numbers).toEqual(Array.from({ length: 12 }, (_, i) => i + 1));
    expect(new Set(results.map((d) => d.id)).size).toBe(12);
    // A failing issuance (nothing to invoice) consumes no number.
    await expect(
      org.run((tx) =>
        h.finance.issueInvoice(tx, {
          folioId: (folios[0] as (typeof folios)[number]).guestFolioId,
          idempotencyKey: 'again',
        }),
      ),
    ).rejects.toThrow(/no charges/);
    const next = await folioWithCharge(org);
    const doc = await org.run((tx) =>
      h.finance.issueInvoice(tx, { folioId: next.guestFolioId, idempotencyKey: 'next' }),
    );
    expect(doc.number).toBe(13);
    expect(doc.documentNumber).toBe('INV-000013');
    const verify = await org.run((tx) => h.finance.verifyFiscalLedger(tx, org.legalEntityId));
    expect(verify).toMatchObject({ ok: true, documents: 13, gaps: [] });
    // Documents are immutable, even for the database owner.
    await expect(
      sql`update finance.fiscal_documents set total_minor = 1`.execute(h.t.admin.kysely),
    ).rejects.toThrow(/append-only/);
  });

  it('carries the mandatory tax-invoice particulars and renders a reproducible PDF', async () => {
    const org = await setupOrg(h);
    const s = await folioWithCharge(org);
    const inv = await org.run((tx) =>
      h.finance.issueInvoice(tx, {
        folioId: s.guestFolioId,
        payerDetails: { address: 'Tokyo' },
        idempotencyKey: 'i1',
      }),
    );
    expect(inv.snapshot).toMatchObject({
      title: 'Tax Invoice',
      supplier: { legalName: 'Azure Isles Private Limited', taxId: '1000123GST501' },
      buyer: { name: 'Kenji Sato' },
      totals: { valueBeforeTaxMinor: 11000, taxChargedMinor: 1870, leviesMinor: 0, totalMinor: 12870 },
      sample: false,
      retainUntil: '2031-12-31',
    });
    expect(inv.allowedActions.find((a) => a.action === 'issueCreditNote')?.enabled).toBe(true);
    const a = await org.run((tx) => h.finance.renderDocumentPdf(tx, inv.id));
    const b = await org.run((tx) => h.finance.renderDocumentPdf(tx, inv.id));
    expect(a.pdf.subarray(0, 8).toString()).toBe('%PDF-1.4');
    expect(a.pdf.equals(b.pdf)).toBe(true);
    expect(a.pdf.toString('latin1')).toContain('TAX INVOICE');
  });

  it('blocks live issuance with unverified tax rules or missing supplier particulars; demo issues labelled samples', async () => {
    const org = await setupOrg(h);
    const s = await folioWithCharge(org);
    h.tax.verified = false;
    try {
      await expect(
        org.run((tx) => h.finance.issueInvoice(tx, { folioId: s.guestFolioId, idempotencyKey: 'x' })),
      ).rejects.toThrow(/tax rules are unverified/);
      const demo = await setupOrg(h, { environment: 'demo' });
      const d = await folioWithCharge(demo);
      const sample = await demo.run((tx) =>
        h.finance.issueInvoice(tx, { folioId: d.guestFolioId, idempotencyKey: 'x' }),
      );
      expect(sample.snapshot).toMatchObject({ sample: true, taxRulePack: { verified: false } });
      expect(sample.issues.map((i) => i.code)).toEqual(
        expect.arrayContaining(['sample_document', 'unverified_tax_rules']),
      );
    } finally {
      h.tax.verified = true;
    }
  });

  it('validates the USD conversion of a non-USD Maldives invoice against the MMA rate (±2%)', async () => {
    const mvrInvoice = async (hotelRate: string) => {
      const org = await setupOrg(h);
      const s = await openStay(h, org);
      const mvr = await org.run((tx) =>
        h.finance.openFolio(tx, {
          propertyId: org.propertyId,
          owner: { type: 'stay', id: s.stayId },
          payer: { type: 'guest', name: 'Local guest' },
          currency: 'MVR',
        }),
      );
      await org.run((tx) =>
        h.finance.recordFxRate(tx, {
          legalEntityId: org.legalEntityId,
          businessDate: '2026-11-07',
          fromCurrency: 'MVR',
          toCurrency: 'USD',
          rate: hotelRate,
          source: 'Hotel board rate',
        }),
      );
      await org.run((tx) =>
        h.finance.postCharge(tx, {
          propertyId: org.propertyId,
          folioId: mvr.folioId,
          chargeCode: 'RETAIL',
          amount: { amountMinor: 154200, currency: 'MVR' },
          serviceDate: '2026-11-07',
          description: 'Boutique',
          sourceRef: { type: 't', id: 'b' },
          idempotencyKey: `mvr:${s.stayId}`,
        }),
      );
      await expect(
        org.run((tx) => h.finance.issueInvoice(tx, { folioId: mvr.folioId, idempotencyKey: 'm1' })),
      ).rejects.toThrow(/Maldives Monetary Authority/);
      await org.run((tx) =>
        h.finance.recordFxRate(tx, {
          legalEntityId: org.legalEntityId,
          businessDate: '2026-11-07',
          fromCurrency: 'MVR',
          toCurrency: 'USD',
          rate: '0.0648',
          source: 'MMA published rate',
        }),
      );
      return org.run((tx) => h.finance.issueInvoice(tx, { folioId: mvr.folioId, idempotencyKey: 'm2' }));
    };
    const ok = await mvrInvoice('0.0650');
    expect(ok.snapshot.usdConversion).toMatchObject({
      rate: '0.065',
      rateSource: 'Hotel board rate',
      mmaRate: '0.0648',
      deviationPercent: '0.3086',
    });
    await expect(mvrInvoice('0.0700')).rejects.toThrow(/more than ±2%/);
  });

  it('credit notes: cancelling re-opens the postings for a corrected invoice; adjusting corrects charges', async () => {
    const org = await setupOrg(h);
    const s = await folioWithCharge(org);
    const inv = await org.run((tx) =>
      h.finance.issueInvoice(tx, { folioId: s.guestFolioId, idempotencyKey: 'a' }),
    );
    // Invoiced postings cannot be corrected or moved directly.
    const charge = (await org.run((tx) => h.finance.getFolio(tx, s.guestFolioId))).postings.find(
      (p) => p.kind === 'charge',
    );
    await expect(
      org.run((tx) =>
        h.finance.adjustPosting(tx, {
          postingId: charge?.id as string,
          reasonCode: 'x',
          note: 'x',
          idempotencyKey: 'adj',
        }),
      ),
    ).rejects.toThrow(/issued invoice/);
    const cancel = await org.run((tx) =>
      h.finance.issueCreditNote(tx, {
        invoiceId: inv.id,
        mode: 'cancel',
        reason: 'Wrong company name',
        idempotencyKey: 'cn1',
      }),
    );
    expect(cancel).toMatchObject({
      kind: 'credit_note',
      documentNumber: 'CN-000001',
      total: usd(-12870),
      originalDocumentId: inv.id,
    });
    expect((await org.run((tx) => h.finance.getDocument(tx, inv.id))).status).toEqual({
      document: 'credited',
    });
    const reissued = await org.run((tx) =>
      h.finance.issueInvoice(tx, {
        folioId: s.guestFolioId,
        payerDetails: { taxId: 'NEW-TIN' },
        idempotencyKey: 'b',
      }),
    );
    expect(reissued.number).toBe(2);
    // Partial financial credit: 30.00 off the spa charge (taxes follow proportionally).
    const cn = await org.run((tx) =>
      h.finance.issueCreditNote(tx, {
        invoiceId: reissued.id,
        mode: 'adjust',
        reason: 'Treatment shortened',
        lines: [{ postingId: charge?.id as string, amountMinor: 3000 }],
        idempotencyKey: 'cn2',
      }),
    );
    expect(cn.total.amountMinor).toBe(-3000);
    expect((await org.run((tx) => h.finance.getDocument(tx, reissued.id))).status).toEqual({
      document: 'partially_credited',
    });
    const folio = await org.run((tx) => h.finance.getFolio(tx, s.guestFolioId));
    expect(folio.balance.amountMinor).toBe(12870 - 3000);
    expect((await org.run((tx) => h.finance.verifyFiscalLedger(tx, org.legalEntityId))).ok).toBe(true);
    await assertLedgerIntegrity(h, org);
  });

  it('needs the invoice permission for the property', async () => {
    const org = await setupOrg(h);
    const s = await folioWithCharge(org);
    await expect(
      org.run(
        (tx) => h.finance.issueInvoice(tx, { folioId: s.guestFolioId, idempotencyKey: newId() }),
        org.as(['finance.folio.read']),
      ),
    ).rejects.toThrow(/finance\.invoice\.issue/);
  });
});
