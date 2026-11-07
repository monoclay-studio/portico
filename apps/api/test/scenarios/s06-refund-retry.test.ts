/**
 * S06 — A refund request is retried after an interruption (E06). The refund intent was recorded but the process
 * died before the provider call; the user retries with the same idempotency key over HTTP → the same refund, sent
 * once; webhooks delivered twice are deduplicated; finance shows the payment and ONE linked refund.
 */
import { sql } from '@portico/db';
import { newId } from '@portico/kernel';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  assertGlobalConsistency,
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
    const { payments, finance } = s.c.services;
    const auth = await signIn(s, org);
    const post = (url: string, payload: object, key: string = newId()) =>
      s.app.inject({ method: 'POST', url, headers: { ...auth, 'idempotency-key': key }, payload });
    const card = await cardOnFile(s, org, k.id, k.legalEntityId);
    const folio = await post('/v1/finance/folios', {
      propertyId: k.id,
      owner: { type: 'stay', id: newId() },
      payer: { type: 'guest', name: 'Nadia Rasheed' },
    });
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
    expect(f.balance).toEqual({ amountMinor: -50_000, currency: 'USD' });
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
