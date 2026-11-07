/**
 * Route D (docs/readiness/responsibility-matrix.md) — the likely first Maldives pilot path: the hotel takes cards
 * on its OWN bank terminal/gateway (e.g. BML), cash and bank transfers; Portico RECORDS them (never presented as
 * provider-verified), posts the ledger at record time, and verifies them against settlement / bank statements
 * imported as files. Mismatches become owned exceptions; corrections are linked adjustments, never edits.
 */
import { newId } from '@portico/kernel';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Harness, type Org, postings, setupOrg, startHarness } from './harness';

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(async () => h?.close());

async function recordTerminal(org: Org, amountMinor: number, reference: string, folioId = newId(), last4 = '4242') {
  const s = await org.tx((tx) =>
    h.module.service.tx.recordPayment(tx, {
      propertyId: org.propertyId,
      method: 'external_terminal',
      accountId: org.terminalAccountId,
      amount: { amountMinor, currency: 'USD' },
      ref: { type: 'folio', id: folioId },
      reference,
      terminalId: 'TID-0042',
      cardBrand: 'visa',
      cardLast4: last4,
      receivedAt: h.clock.now().toISOString(),
      businessKey: newId(),
    }),
  );
  return h.module.service.view.payment(org.ctx, s.id);
}

function importCsv(org: Org, csv: string, source: 'acquirer_settlement' | 'bank_statement' | 'cash_deposit' = 'acquirer_settlement') {
  return org.tx((tx) =>
    h.module.service.tx.importStatement(tx, {
      propertyId: org.propertyId,
      ...(source === 'acquirer_settlement' ? { accountId: org.terminalAccountId } : {}),
      source,
      fileName: `bml-settlement-${newId().slice(-6)}.csv`,
      periodFrom: '2026-11-07',
      periodTo: '2026-11-07',
      csv,
    }),
  );
}

describe('Route D: payments taken on the hotel’s own terminal, recorded in Portico', () => {
  it('records as unverified, posts at record time, and never claims provider verification', async () => {
    const org = await setupOrg(h);
    const p = await recordTerminal(org, 84_000, 'AP-100200');
    expect(p).toMatchObject({
      kind: 'recorded',
      method: 'external_terminal',
      mode: 'recorded',
      providerVerified: false,
      provenance: 'external',
      status: { payment: 'recorded_unverified', ledger: 'posted' },
      externalReference: 'AP-100200',
      cardLast4: '4242',
    });
    expect(p.presentation).toMatchObject({ label: 'Recorded — not yet verified', confirmed: false, tone: 'recorded' });
    const ledger = await postings(h, org, 'payment');
    expect(ledger).toHaveLength(1);
    expect(ledger[0]?.extra).toMatchObject({ method: 'external_terminal', verification: 'recorded_unverified' });
    // Recording the same approval code twice is refused (it would double the guest's payment).
    await expect(recordTerminal(org, 84_000, 'AP-100200')).rejects.toThrow(/already recorded/);
  });

  it('matches the acquirer settlement file: verified, mismatches and gaps become owned exceptions', async () => {
    const org = await setupOrg(h);
    const ok = await recordTerminal(org, 84_000, 'AP-1');
    const wrong = await recordTerminal(org, 50_000, 'AP-2');
    const missing = await recordTerminal(org, 12_500, 'AP-3');
    const csv = [
      'date,amount,currency,reference,approval_code,last4,type',
      '2026-11-07,840.00,USD,,AP-1,4242,sale',
      '2026-11-07,500.00,USD,,AP-2,4242,sale'.replace('500.00', '450.00'),
      '2026-11-07,99.00,USD,,AP-9,1111,sale',
    ].join('\n');
    const result = await importCsv(org, csv);
    expect(result).toMatchObject({ provenance: 'file_import', lineCount: 3, matchedCount: 1 });
    expect(result.lines.map((l) => l.matchStatus)).toEqual(['matched', 'amount_mismatch', 'unmatched']);

    expect((await h.module.service.view.payment(org.ctx, ok.id)).status.payment).toBe('recorded_verified');
    expect((await h.module.service.view.payment(org.ctx, ok.id)).presentation.confirmed).toBe(true);
    expect((await h.module.service.view.payment(org.ctx, wrong.id)).status.payment).toBe('recorded_unverified');

    const exceptions = await org.tx((tx) => h.module.service.tx.listExceptions(tx, { propertyId: org.propertyId, status: 'open' }));
    const kinds = exceptions.map((e) => e.kind).sort();
    expect(kinds).toEqual(['settlement_amount_mismatch', 'settlement_missing_in_statement', 'settlement_unrecorded_in_portico']);
    for (const e of exceptions) {
      expect(e.owner).toMatchObject({ kind: 'department', id: 'finance' });
      expect(e.nextStep.length).toBeGreaterThan(10);
    }
    const missingEx = exceptions.find((e) => e.kind === 'settlement_missing_in_statement');
    expect(missingEx?.ref).toEqual({ type: 'payment', id: missing.id });

    // The same file cannot be imported twice.
    await expect(importCsv(org, csv)).rejects.toThrow(/already imported/);

    // Correct the amount mismatch with a linked adjustment (never an edit) — resolves the exception.
    const mismatch = exceptions.find((e) => e.kind === 'settlement_amount_mismatch');
    const adj = await org.tx((tx) =>
      h.module.service.tx.adjustRecordedPayment(tx, {
        paymentId: wrong.id,
        amount: { amountMinor: -5_000, currency: 'USD' },
        reason: 'Terminal receipt shows USD 450.00; recorded 500.00 by mistake',
        exceptionId: mismatch?.id,
        businessKey: newId(),
      }),
    );
    expect(adj.ledger_posting_id).toBeTruthy();
    const original = await h.module.service.view.payment(org.ctx, wrong.id);
    expect(original.amount.amountMinor).toBe(50_000); // the original record is untouched
    // The statement line is now the evidence: the corrected payment is verified.
    expect(original.status.payment).toBe('recorded_verified');
    const adjustments = await postings(h, org, 'adjustment');
    expect(adjustments).toEqual([expect.objectContaining({ amount_minor: -5_000 })]);
    const stillOpen = await org.tx((tx) => h.module.service.tx.listExceptions(tx, { propertyId: org.propertyId, status: 'open' }));
    expect(stillOpen.map((e) => e.kind)).not.toContain('settlement_amount_mismatch');

    // A later statement that contains the missing payment verifies it and auto-resolves its exception.
    const later = await importCsv(org, 'date,amount,currency,approval_code\n2026-11-07,125.00,USD,AP-3\n');
    expect(later.matchedCount).toBe(1);
    const open2 = await org.tx((tx) => h.module.service.tx.listExceptions(tx, { propertyId: org.propertyId, status: 'open' }));
    expect(open2.filter((e) => e.ref?.id === missing.id)).toEqual([]);
  });

  it('records refunds made on the terminal and a manual authorization completed on the terminal', async () => {
    const org = await setupOrg(h);
    const svc = h.module.service;
    const p = await recordTerminal(org, 20_000, 'AP-55');
    // A provider refund is refused for a recorded payment: it must be refunded on the terminal.
    await expect(
      org.tx((tx) => svc.tx.refund(tx, { paymentId: p.id, amount: { amountMinor: 1_000, currency: 'USD' }, reason: 'x', businessKey: newId() })),
    ).rejects.toThrow(/Refund it the same way/);
    const r = await org.tx((tx) =>
      svc.tx.recordRefund(tx, {
        paymentId: p.id,
        amount: { amountMinor: 5_000, currency: 'USD' },
        reason: 'Minibar charge removed',
        reference: 'RF-55',
        businessKey: newId(),
      }),
    );
    const rv = await svc.view.refund(org.ctx, r.id);
    expect(rv).toMatchObject({ status: { refund: 'recorded_unverified', ledger: 'posted' }, providerVerified: false });
    expect(await postings(h, org, 'refund')).toEqual([expect.objectContaining({ amount_minor: -5_000 })]);

    const folioId = newId();
    const auth = await org.tx((tx) =>
      svc.tx.recordAuthorization(tx, {
        propertyId: org.propertyId,
        accountId: org.terminalAccountId,
        amount: { amountMinor: 30_000, currency: 'USD' },
        ref: { type: 'folio', id: folioId },
        approvalCode: 'PRE-9',
        businessKey: newId(),
      }),
    );
    // The hold is completed on the terminal and recorded against the authorization.
    await org.tx((tx) =>
      svc.tx.recordPayment(tx, {
        propertyId: org.propertyId,
        method: 'external_terminal',
        accountId: org.terminalAccountId,
        amount: { amountMinor: 30_000, currency: 'USD' },
        ref: { type: 'folio', id: folioId },
        reference: 'AP-PRE-9',
        receivedAt: h.clock.now().toISOString(),
        authorizationId: auth.id,
        businessKey: newId(),
      }),
    );
    expect((await svc.view.authorization(org.ctx, auth.id)).status.authorization).toBe('captured');
  });

  it('bank transfers and cash are recorded with references and verified against bank / deposit statements', async () => {
    const org = await setupOrg(h);
    const svc = h.module.service;
    const bookingId = newId();
    const bt = await org.tx((tx) =>
      svc.tx.recordPayment(tx, {
        propertyId: org.propertyId,
        method: 'bank_transfer',
        amount: { amountMinor: 250_000, currency: 'USD' },
        ref: { type: 'booking', id: bookingId },
        reference: 'TT-REF-883',
        receivedAt: h.clock.now().toISOString(),
        businessKey: newId(),
      }),
    );
    expect(await postings(h, org, 'deposit')).toEqual([expect.objectContaining({ amount_minor: 250_000, ref_id: bookingId })]);
    const res = await importCsv(org, 'date,amount,currency,reference\n2026-11-07,2500.00,USD,TT-REF-883\n', 'bank_statement');
    expect(res.matchedCount).toBe(1);
    expect((await svc.view.payment(org.ctx, bt.id)).status.payment).toBe('recorded_verified');
    // A terminal account is required for card payments taken on a terminal.
    await expect(
      org.tx((tx) =>
        svc.tx.recordPayment(tx, {
          propertyId: org.propertyId,
          method: 'external_terminal',
          amount: { amountMinor: 1_000, currency: 'USD' },
          ref: { type: 'folio', id: newId() },
          reference: 'AP-X',
          receivedAt: h.clock.now().toISOString(),
          businessKey: newId(),
        }),
      ),
    ).rejects.toThrow(/terminal\/gateway account/);
  });
});
