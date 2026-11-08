/**
 * S06 — A refund request is retried after an interruption (E06). The refund intent was recorded but the process
 * died before the provider call; the user retries with the same idempotency key over HTTP → the same refund, sent
 * once; webhooks delivered twice are deduplicated; finance shows the payment and ONE linked refund.
 */
import { sql } from '@portico/db';
import { newId } from '@portico/kernel';
import type { Booking } from '@portico/reservations';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  applied,
  assertGlobalConsistency,
  bookingInput,
  cardOnFile,
  kandu,
  organization,
  type Scenario,
  signIn,
  startScenario,
} from './harness';

let s: Scenario;
beforeAll(async () => {
  s = await startScenario();
});
afterAll(async () => s?.close());

describe('S06 — refund retried after an interruption', () => {
  it('one refund, one refund posting, original payment unchanged; duplicate webhooks harmless', async () => {
    const org = await organization(s);
    const k = await kandu(s, org);
    const { payments, finance, reservations } = s.c.services;
    const auth = await signIn(s, org);
    const post = (url: string, payload: object, key: string = newId()) =>
      s.app.inject({ method: 'POST', url, headers: { ...auth, 'idempotency-key': key }, payload });
    // The guest's own card pays the folio of the guest's own booking: the card's agreement names that booking
    // (ADR-0015 Amendments 2 and 3).
    const b = applied<Booking>(
      await org.run(org.setup, (tx) =>
        reservations.createBooking(
          tx,
          bookingInput(k, {
            arrival: '2027-03-08',
            departure: '2027-03-10',
            guest: { firstName: 'Nadia', lastName: 'Rasheed' },
          }),
        ),
      ),
    );
    await s.drain();
    const guest = b.stays[0]?.occupants[0]?.profileId as string;
    const card = await cardOnFile(
      s,
      org,
      k.id,
      k.legalEntityId,
      'pm_card_visa',
      { type: 'guest_profile', id: guest },
      { mandateFor: [b.id] },
    );
    const folio = await post('/v1/finance/folios', {
      propertyId: k.id,
      owner: { type: 'stay', id: b.stays[0]?.id as string },
      payer: { type: 'guest', id: guest, name: 'Nadia Rasheed' },
    });
    // The stay's bill: the card on file pays what the folio owes (ADR-0015 Amendment 4).
    await org.run(org.setup, (tx) =>
      finance.postCharge(tx, {
        propertyId: k.id,
        target: { type: 'stay', id: b.stays[0]?.id as string },
        chargeCode: 'MISC',
        amount: { amountMinor: 80_000, currency: 'USD' },
        priceMode: 'inclusive',
        description: 'Stay charges',
        serviceDate: '2027-03-08',
        sourceRef: { type: 'pos_check', id: newId() },
        idempotencyKey: `pos:${newId()}`,
      }),
    );
    const paid = await post('/v1/payments/charges', {
      propertyId: k.id,
      methodId: card.id,
      amount: { amountMinor: 80_000, currency: 'USD' },
      ref: { type: 'folio', id: folio.json().id },
    });
    expect(paid.json().status).toMatchObject({ payment: 'succeeded', ledger: 'posted' });
    const paymentId = paid.json().id as string;
    // The approved refund is recorded, then the process dies before the provider call.
    const key = newId();
    const manager = org.staff('general_manager', 'Finance manager', [k.id]);
    await org.run(manager, (tx) =>
      payments.tx.refund(tx, {
        paymentId,
        amount: { amountMinor: 30_000, currency: 'USD' },
        reason: 'Spa treatment cancelled',
        businessKey: key,
      }),
    );
    // The user retries with the same key: the same refund is completed, once.
    const retry = await post(
      '/v1/payments/refunds',
      { paymentId, amount: { amountMinor: 30_000, currency: 'USD' }, reason: 'Spa treatment cancelled' },
      key,
    );
    expect(retry.statusCode).toBe(201);
    expect(retry.json().status).toMatchObject({ refund: 'succeeded', ledger: 'posted' });
    const retry2 = await post(
      '/v1/payments/refunds',
      { paymentId, amount: { amountMinor: 30_000, currency: 'USD' }, reason: 'Spa treatment cancelled' },
      key,
    );
    expect(retry2.json().id).toBe(retry.json().id);
    const account = await org.run(org.setup, async (tx) =>
      (await payments.tx.listAccounts(tx, k.legalEntityId)).find((a) => a.provider === 'simulator'),
    );
    await payments.deliverSimulatorWebhooks(org.setup, account?.id as string);
    await payments.deliverSimulatorWebhooks(org.setup, account?.id as string);
    const refunds = await sql<{ id: string; status: string }>`
      select id, status from payments.refunds where payment_id = ${paymentId}`.execute(s.t.admin.kysely);
    expect(refunds.rows).toEqual([{ id: retry.json().id, status: 'succeeded' }]);
    const ops = await sql<{ attempts: number }>`
      select attempts from payments.provider_operations where target_type = 'refund'`.execute(
      s.t.admin.kysely,
    );
    expect(ops.rows.every((r) => r.attempts === 1)).toBe(true);
    const f = await org.run(manager, (tx) => finance.getFolio(tx, folio.json().id));
    // The bill (80,000) was paid by the card (80,000); the 30,000 refunded is owed again.
    expect(f.balance).toEqual({ amountMinor: 30_000, currency: 'USD' });
    const original = await s.app.inject({
      method: 'GET',
      url: `/v1/payments/transactions/${paymentId}`,
      headers: auth,
    });
    expect(original.json()).toMatchObject({
      amount: { amountMinor: 80_000 },
      status: { payment: 'succeeded' },
    });
    await assertGlobalConsistency(s, org);
  });
});
