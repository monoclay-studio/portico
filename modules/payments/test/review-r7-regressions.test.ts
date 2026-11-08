/**
 * Re-review #7 (docs/orchestration/reviews/review-integration-step-7.md), payments-module P3s:
 *  - R7-P3-1: the capture request hash includes the landing label;
 *  - R7-P3-2: a customer-initiated hold's capture gets the fact limits too;
 *  - R7-P3-3: completing a recorded hold checks its property, booking family and remaining amount.
 */
import { withTenantTx } from '@portico/db';
import { newId } from '@portico/kernel';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addMethod, type Harness, type Org, setupOrg, startHarness } from './harness';

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(async () => h?.close());

const usd = (amountMinor: number) => ({ amountMinor, currency: 'USD' });
const settle = <T>(p: Promise<T>) =>
  p.then(
    (v) => ({ ok: true as const, v }),
    (e: unknown) => ({ ok: false as const, e: e as { code?: string } }),
  );
const codeOf = (r: { ok: boolean; e?: { code?: string } }) => (r.ok ? 'accepted' : r.e?.code);

async function heldOn(
  org: Org,
  methodId: string,
  ref: { type: 'folio' | 'booking'; id: string },
  amountMinor: number,
) {
  const svc = h.module.service;
  const a = await org.tx((tx) =>
    svc.tx.authorize(tx, {
      propertyId: org.propertyId,
      methodId,
      amount: usd(amountMinor),
      ref,
      businessKey: newId(),
    }),
  );
  await svc.settle(org.ctx, { type: 'authorization', id: a.id });
  return a.id;
}

describe('R7-P3-1 — the capture request hash includes the landing label', () => {
  it('a retry with the same key and another label is a mismatch, not a silent replay', async () => {
    const org = await setupOrg(h);
    const svc = h.module.service;
    const stay = newId();
    h.ledger.stays.set(stay, org.bookingId);
    const folio = newId();
    h.ledger.folioOwners.set(folio, { type: 'stay', id: stay });
    h.ledger.penalties.set(stay, [{ kind: 'no_show', amount: usd(40_000) }]);
    const methodId = await addMethod(h, org);
    const holdId = await heldOn(org, methodId, { type: 'folio', id: folio }, 20_000);
    const key = newId();
    const capture = (purpose?: 'no_show') =>
      settle(
        org.tx((tx) =>
          svc.tx.capture(tx, {
            authorizationId: holdId,
            amount: usd(10_000),
            ...(purpose ? { purpose } : {}),
            businessKey: key,
          }),
        ),
      );
    expect(codeOf(await capture('no_show'))).toBe('accepted');
    expect(codeOf(await capture())).toBe('idempotency_conflict');
  });
});

describe('R7-P3-2 — a customer-initiated hold is captured within the fact it lands on', () => {
  it('a guest’s hold on their booking is captured as a deposit only up to the agreed schedule', async () => {
    const org = await setupOrg(h);
    const svc = h.module.service;
    const booking = newId();
    h.ledger.depositDue.set(booking, 30_000);
    const guest = {
      ...org.as(['payments.payment.collect', 'payments.method.manage']),
      actor: { kind: 'guest' as const, bookingId: booking },
    };
    const card = await withTenantTx(h.db, guest, (tx) =>
      svc.tx.createMethod(tx, {
        accountId: org.simAccountId,
        propertyId: org.propertyId,
        kind: 'card',
        providerToken: 'pm_card_visa',
        owner: { type: 'booking', id: booking },
      }),
    );
    const a = await withTenantTx(h.db, guest, (tx) =>
      svc.tx.authorize(tx, {
        propertyId: org.propertyId,
        methodId: card.id,
        amount: usd(50_000),
        ref: { type: 'booking', id: booking },
        businessKey: newId(),
      }),
    );
    await svc.settle(org.ctx, { type: 'authorization', id: a.id });
    const capture = (amountMinor: number) =>
      settle(
        org.tx((tx) =>
          svc.tx.capture(tx, { authorizationId: a.id, amount: usd(amountMinor), businessKey: newId() }),
        ),
      );
    expect(codeOf(await capture(30_001))).toBe('deposit_not_due');
    expect(codeOf(await capture(30_000))).toBe('accepted');
  });
});

describe('R7-P3-3 — completing a recorded hold checks its property, booking family and remaining amount', () => {
  it('another property’s or another booking’s hold, or more than it holds, is refused', async () => {
    const org = await setupOrg(h);
    const svc = h.module.service;
    const booking = newId();
    const folio = newId();
    h.ledger.bookingOf.set(folio, booking);
    const hold = await org.tx((tx) =>
      svc.tx.recordAuthorization(tx, {
        propertyId: org.propertyId,
        accountId: org.terminalAccountId,
        amount: usd(20_000),
        ref: { type: 'booking', id: booking },
        approvalCode: `A${newId().slice(-5)}`,
      }),
    );
    const record = (ref: { type: 'folio' | 'booking'; id: string }, amountMinor: number) =>
      settle(
        org.tx((tx) =>
          svc.tx.recordPayment(tx, {
            propertyId: org.propertyId,
            method: 'external_terminal',
            accountId: org.terminalAccountId,
            amount: usd(amountMinor),
            ref,
            reference: `T${newId().slice(-6)}`,
            receivedAt: h.clock.now().toISOString(),
            authorizationId: hold.id,
            businessKey: newId(),
          }),
        ),
      );
    const otherFolio = newId();
    h.ledger.bookingOf.set(otherFolio, newId());
    expect(codeOf(await record({ type: 'folio', id: otherFolio }, 10_000))).toBe(
      'authorization_other_reference',
    );
    expect(codeOf(await record({ type: 'folio', id: folio }, 20_001))).toBe('capture_exceeds_hold');
    expect(codeOf(await record({ type: 'folio', id: folio }, 20_000))).toBe('accepted');
  });
});
