/**
 * Re-review #3 R3-P1-1(iii) / ADR-0015 Amendment 2: a payment request is a state machine with the provider as an
 * EXTERNAL writer — a link can be paid at the provider until the provider confirms it is deactivated. Every transition
 * is tested, including the provider-side payment of a superseded link.
 *
 *   open(link pending) ──link created──▶ open(created)
 *   open(created) ──replace──▶ cancelled(deactivating) ──provider confirms──▶ cancelled(deactivated)
 *                    └▶ new open(pending) ── created only after the confirmation
 *   open(created) ──close at 0──▶ cancelled | paid(at what was paid) (deactivating → deactivated)
 *   open(created) ──staff cancel──▶ cancelled (deactivating → deactivated)
 *   cancelled(deactivating) ──provider takes a payment──▶ credited + URGENT refund item
 */
import { sql } from '@portico/db';
import { newId } from '@portico/kernel';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { deliverWebhooks, type Harness, type Org, setControls, setupOrg, startHarness } from './harness';

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(async () => h?.close());

const usd = (amountMinor: number) => ({ amountMinor, currency: 'USD' });
const sync = (org: Org, folioId: string, amountMinor: number) =>
  org.tx((tx) =>
    h.module.service.provider.syncBalanceRequest(tx, {
      propertyId: org.propertyId,
      folioId,
      outstanding: usd(amountMinor),
      payer: { type: 'other', name: 'Guest' },
      reason: 'test',
    }),
  );
const requests = async (folioId: string) =>
  (
    await sql<{ id: string; amount_minor: number; paid_minor: number; status: string; link_status: string }>`
      select id, amount_minor::int, paid_minor::int, status, link_status from payments.payment_requests
       where ref_id = ${folioId} order by created_at`.execute(h.t.admin.kysely)
  ).rows;
const urgentRefunds = async (org: Org) =>
  (
    await sql<{ severity: string; ref_id: string }>`select severity, ref_id from payments.exceptions
      where tenant_id = ${org.tenantId} and kind = 'payment_request_overpaid'`.execute(h.t.admin.kysely)
  ).rows;

describe('payment request lifecycle (provider as an external writer)', () => {
  it('replace: the old link is deactivated at the provider BEFORE the new one is sent; the old link takes no money', async () => {
    const org = await setupOrg(h);
    const svc = h.module.service;
    const folio = newId();
    await sync(org, folio, 23_400);
    const [first] = await requests(folio);
    expect(first).toMatchObject({ status: 'open', link_status: 'created' });
    expect(await sync(org, folio, 35_100)).toMatchObject({ status: 'reissued', openMinor: 35_100 });
    const all = await requests(folio);
    expect(all).toEqual([
      expect.objectContaining({ id: first?.id, status: 'cancelled', link_status: 'deactivated' }),
      expect.objectContaining({ status: 'open', amount_minor: 35_100, link_status: 'created' }),
    ]);
    // The guest opens the first email: the provider refuses.
    await expect(svc.simulateRequestPayment(org.ctx, first?.id as string)).rejects.toThrow(
      /no longer active/,
    );
    await svc.simulateRequestPayment(org.ctx, all[1]?.id as string);
    await deliverWebhooks(h, org);
    expect((await requests(folio))[1]).toMatchObject({ status: 'paid', paid_minor: 35_100 });
    expect(await urgentRefunds(org)).toEqual([]);
  });

  it('provider down while deactivating: the old link counts as payable, no replacement is sent, a payment on it is an URGENT refund; reconciliation finishes', async () => {
    const org = await setupOrg(h);
    const svc = h.module.service;
    const folio = newId();
    await sync(org, folio, 23_400);
    const [first] = await requests(folio);
    await setControls(h, org, { outage: 'refuse' });
    await sync(org, folio, 35_100);
    let all = await requests(folio);
    expect(all).toEqual([
      expect.objectContaining({ status: 'cancelled', link_status: 'deactivating' }),
      expect.objectContaining({ status: 'open', link_status: 'pending' }), // waits for the confirmation
    ]);
    // The guest pays the old link before the provider confirmed (an external write) — on top of what the folio owed,
    // so the folio ends in credit (the fake ledger's balance after posting).
    await setControls(h, org, { outage: null });
    h.ledger.balances.set(folio, -23_400);
    await svc.simulateRequestPayment(org.ctx, first?.id as string);
    await deliverWebhooks(h, org);
    expect(await urgentRefunds(org)).toEqual([{ severity: 'urgent', ref_id: first?.id }]);
    // Reconciliation completes the deactivation, then sends the replacement link.
    await svc.runReconciliation(org.ctx, { propertyId: org.propertyId });
    all = await requests(folio);
    expect(all[0]).toMatchObject({ status: 'cancelled', link_status: 'deactivated', paid_minor: 23_400 });
    expect(all[1]).toMatchObject({ status: 'open', link_status: 'created' });
  });

  it('close at zero: a partly paid request closes at what was paid; its link stops taking money', async () => {
    const org = await setupOrg(h);
    const svc = h.module.service;
    const folio = newId();
    await sync(org, folio, 10_000);
    const [first] = await requests(folio);
    await svc.simulateRequestPayment(org.ctx, first?.id as string, 4_000);
    await deliverWebhooks(h, org);
    expect(await sync(org, folio, 0)).toMatchObject({ status: 'cancelled', openMinor: 0 });
    expect((await requests(folio))[0]).toMatchObject({
      status: 'paid',
      amount_minor: 4_000,
      paid_minor: 4_000,
      link_status: 'deactivated',
    });
    await expect(svc.simulateRequestPayment(org.ctx, first?.id as string, 1_000)).rejects.toThrow(
      /no longer active/,
    );
  });

  it('staff cancel: the link is deactivated at the provider too', async () => {
    const org = await setupOrg(h);
    const svc = h.module.service;
    const folio = newId();
    await sync(org, folio, 10_000);
    const [first] = await requests(folio);
    const view = await org.tx((tx) => svc.tx.getPaymentRequest(tx, first?.id as string));
    await org.tx((tx) =>
      svc.tx.cancelPaymentRequest(tx, first?.id as string, view.version, 'Guest paid at the desk'),
    );
    expect((await requests(folio))[0]).toMatchObject({ status: 'cancelled', link_status: 'deactivated' });
    await expect(svc.simulateRequestPayment(org.ctx, first?.id as string)).rejects.toThrow(
      /no longer active/,
    );
  });

  it('applied three times, then inverted: one open request equal to the debt at every step', async () => {
    const org = await setupOrg(h);
    const folio = newId();
    for (const owed of [10_000, 25_000, 40_000, 25_000, 0]) {
      await sync(org, folio, owed);
      const open = (await requests(folio)).filter((r) => r.status === 'open');
      expect(open.map((r) => r.amount_minor)).toEqual(owed ? [owed] : []);
      expect(
        (await requests(folio)).filter((r) => r.link_status === 'created' && r.status !== 'open'),
      ).toEqual([]);
    }
  });
});
