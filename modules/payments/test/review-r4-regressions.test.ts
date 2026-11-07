/**
 * Re-review #4 (docs/orchestration/reviews/review-integration-step-4.md), payments-module parts:
 *  - R4-P1-1 (Amendment 3): a booking's consent covers the stays it had when the cardholder consented, never one added
 *    later; a folio is covered only when the agreement names it (or its booking);
 *  - R4-P1-2 / R4-P3-1: the running total counts every open hold, under the card-row lock;
 *  - R4-P3-6: a guest acting for themselves uses only a card they entered; a customer hold is captured only inside its
 *    own booking family.
 * The API-level PoC flips are in apps/api/test/review-regressions-r4.test.ts.
 */
import { withTenantTx } from '@portico/db';
import { newId } from '@portico/kernel';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ALL_PURPOSES, type Harness, type Org, setupOrg, startHarness } from './harness';

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

/** A staff-recorded card-on-file agreement naming `bookingIds` (and optionally folios), accepted now. */
async function agreementCard(
  org: Org,
  scope: Record<string, unknown>,
  owner: { type: 'guest_profile' | 'booking'; id: string } = { type: 'guest_profile', id: org.payerId },
  token = 'pm_card_visa',
): Promise<string> {
  const m = await org.tx((tx) =>
    h.module.service.tx.createMethod(tx, {
      accountId: org.simAccountId,
      propertyId: org.propertyId,
      kind: 'card',
      providerToken: token,
      owner,
      mitAgreement: true,
      mandate: {
        termsVersion: 'T-2026-1',
        acceptedAt: h.clock.now().toISOString(),
        channel: 'front_desk',
        scope: { legalEntityId: org.legalEntityId, purposes: [...ALL_PURPOSES], ...scope },
      },
    }),
  );
  return m.id;
}

const hold = (org: Org, methodId: string, ref: { type: string; id: string }, amountMinor = 10_000) =>
  settle(
    org.tx((tx) =>
      h.module.service.tx.authorize(tx, {
        propertyId: org.propertyId,
        methodId,
        amount: usd(amountMinor),
        ref,
        businessKey: newId(),
      }),
    ),
  );

describe('R4-P1-1 — a booking consent covers its stays at the time of consent (Amendment 3)', () => {
  it('a stay created after the agreement is not covered; one created before is; another booking never is', async () => {
    const org = await setupOrg(h);
    const booking = newId();
    const before = newId();
    const after = newId();
    h.ledger.bookingOf.set(before, booking);
    h.ledger.bookingOf.set(after, booking);
    h.ledger.stayCreatedAt.set(before, new Date(h.clock.now().getTime() - 60_000).toISOString());
    const card = await agreementCard(org, { bookingIds: [booking] });
    // The stay staff add to the booking once the cardholder has consented (an add-stay): created after the agreement.
    h.ledger.stayCreatedAt.set(after, new Date(h.clock.now().getTime() + 60_000).toISOString());
    expect(codeOf(await hold(org, card, { type: 'stay', id: before }))).toBe('accepted');
    expect(codeOf(await hold(org, card, { type: 'stay', id: after }))).toBe('mandate_reference_not_covered');
    // A stay created at the same moment as the consent is not "before" it either (no tie in its favour).
    const tie = newId();
    h.ledger.bookingOf.set(tie, booking);
    h.ledger.stayCreatedAt.set(tie, h.clock.now().toISOString());
    const card2 = await agreementCard(org, { bookingIds: [booking] }, undefined, 'pm_card_mastercard');
    expect(codeOf(await hold(org, card2, { type: 'stay', id: tie }))).toBe('mandate_reference_not_covered');
    // Another booking (even one of the same payer, same family default) is never covered.
    const other = newId();
    expect(codeOf(await hold(org, card, { type: 'booking', id: other }))).toBe(
      'mandate_reference_not_covered',
    );
  });

  it('a folio is covered when the agreement names it — and only that folio', async () => {
    const org = await setupOrg(h);
    const named = newId();
    const card = await agreementCard(org, { folioIds: [named] });
    expect(codeOf(await hold(org, card, { type: 'folio', id: named }))).toBe('accepted');
    // Another folio of the same payer (the fake world: same default booking, which the agreement does not name).
    expect(codeOf(await hold(org, card, { type: 'folio', id: newId() }))).toBe(
      'mandate_reference_not_covered',
    );
  });

  it('a booking or folio of another hotel company cannot be named in an agreement', async () => {
    const org = await setupOrg(h);
    const elsewhere = newId();
    h.ledger.owners.set(elsewhere, { propertyId: org.propertyId, legalEntityId: newId() });
    await expect(agreementCard(org, { folioIds: [elsewhere] })).rejects.toMatchObject({
      code: 'mandate_folio_unknown',
    });
    const unknown = newId();
    h.ledger.unknown.add(unknown);
    await expect(agreementCard(org, { bookingIds: [unknown] })).rejects.toMatchObject({
      code: 'mandate_booking_unknown',
    });
  });

  it('only the cardholder adds a booking to their agreement — staff cannot', async () => {
    const org = await setupOrg(h);
    const card = await agreementCard(org, { bookingIds: [org.bookingId] });
    const next = newId();
    await expect(
      org.tx((tx) => h.module.service.tx.confirmCardForBooking(tx, { methodId: card, bookingId: next })),
    ).rejects.toMatchObject({ status: 403 });
    const otherGuest = { ...org.as([]), actor: { kind: 'guest' as const, guestProfileId: newId() } };
    await expect(
      withTenantTx(h.db, otherGuest, (tx) =>
        h.module.service.tx.confirmCardForBooking(tx, { methodId: card, bookingId: next }),
      ),
    ).rejects.toMatchObject({ status: 403 });
    expect(codeOf(await hold(org, card, { type: 'booking', id: next }))).toBe(
      'mandate_reference_not_covered',
    );
    const cardholder = { ...org.as([]), actor: { kind: 'guest' as const, guestProfileId: org.payerId } };
    await withTenantTx(h.db, cardholder, (tx) =>
      h.module.service.tx.confirmCardForBooking(tx, { methodId: card, bookingId: next }),
    );
    expect(codeOf(await hold(org, card, { type: 'booking', id: next }))).toBe('accepted');
  });
});

describe('R4-P1-2 / R4-P3-1 — open holds count against the agreement total, under the card lock', () => {
  it('concurrent holds on a USD 100 agreement: one stands, the others are refused', async () => {
    const org = await setupOrg(h);
    const card = await agreementCard(org, { bookingIds: [org.bookingId], maxAmount: usd(10_000) });
    // Four stays of the named booking (created before the consent), held at the same moment.
    const stays = [newId(), newId(), newId(), newId()];
    for (const st of stays) h.ledger.bookingOf.set(st, org.bookingId);
    const rs = await Promise.all(stays.map((id) => hold(org, card, { type: 'stay', id }, 10_000)));
    expect(rs.map(codeOf).sort()).toEqual([
      'accepted',
      'mandate_amount_exceeded',
      'mandate_amount_exceeded',
      'mandate_amount_exceeded',
    ]);
  });
});

describe('R4-P1-2 — a hold increase in flight counts against the total', () => {
  it('an increase sent but not confirmed, then a charge: the charge is refused if both would pass the limit', async () => {
    const org = await setupOrg(h);
    const svc = h.module.service;
    const card = await agreementCard(org, { bookingIds: [org.bookingId], maxAmount: usd(10_000) });
    const stay = newId();
    h.ledger.bookingOf.set(stay, org.bookingId);
    const held = await hold(org, card, { type: 'stay', id: stay }, 5_000);
    expect(codeOf(held)).toBe('accepted');
    const holdId = held.ok ? held.v.id : '';
    await svc.settle(org.ctx, { type: 'authorization', id: holdId });
    // The increase is recorded (intent committed) and not yet confirmed by the provider.
    await org.tx((tx) => svc.tx.increment(tx, { authorizationId: holdId, additionalAmount: usd(5_000) }));
    const folio = newId();
    const charge = await settle(
      svc.chargeNow(org.ctx, {
        propertyId: org.propertyId,
        methodId: card,
        amount: usd(5_000),
        ref: { type: 'folio', id: folio },
        purpose: 'balance',
        businessKey: newId(),
      }),
    );
    expect(codeOf(charge)).toBe('mandate_amount_exceeded');
  });
});

describe('R4-P3-6 — guest actors and customer holds', () => {
  const guestFor = (org: Org, bookingId: string) => ({
    ...org.as(['payments.payment.collect', 'payments.method.manage']),
    actor: { kind: 'guest' as const, bookingId },
  });
  const guestCharge = (org: Org, bookingId: string, methodId: string) =>
    settle(
      h.module.service.chargeNow(guestFor(org, bookingId), {
        propertyId: org.propertyId,
        methodId,
        amount: usd(5_000),
        ref: { type: 'booking', id: bookingId },
        businessKey: newId(),
      }),
    );

  it('a guest pays only with a card they entered themselves — not one staff keyed in for their booking', async () => {
    const org = await setupOrg(h);
    const booking = newId();
    const staffKeyed = await org.tx((tx) =>
      h.module.service.tx.createMethod(tx, {
        accountId: org.simAccountId,
        propertyId: org.propertyId,
        kind: 'card',
        providerToken: 'pm_card_visa',
        owner: { type: 'booking', id: booking },
      }),
    );
    expect(codeOf(await guestCharge(org, booking, staffKeyed.id))).toBe('card_not_yours');
    const own = await withTenantTx(h.db, guestFor(org, booking), (tx) =>
      h.module.service.tx.createMethod(tx, {
        accountId: org.simAccountId,
        propertyId: org.propertyId,
        kind: 'card',
        providerToken: 'pm_card_mastercard',
        owner: { type: 'booking', id: booking },
      }),
    );
    expect(codeOf(await guestCharge(org, booking, own.id))).toBe('accepted');
    // The guest of ANOTHER booking cannot use it.
    const otherBooking = newId();
    expect(codeOf(await guestCharge(org, otherBooking, own.id))).toBe('card_not_yours');
  });

  it("a customer hold is captured only inside its own booking family, never onto another booking's folio", async () => {
    const org = await setupOrg(h);
    const svc = h.module.service;
    const booking = newId();
    const card = await withTenantTx(h.db, guestFor(org, booking), (tx) =>
      svc.tx.createMethod(tx, {
        accountId: org.simAccountId,
        propertyId: org.propertyId,
        kind: 'card',
        providerToken: 'pm_card_visa',
        owner: { type: 'booking', id: booking },
      }),
    );
    const a = await withTenantTx(h.db, guestFor(org, booking), (tx) =>
      svc.tx.authorize(tx, {
        propertyId: org.propertyId,
        methodId: card.id,
        amount: usd(20_000),
        ref: { type: 'booking', id: booking },
        businessKey: newId(),
      }),
    );
    await svc.settle(org.ctx, { type: 'authorization', id: a.id });
    const ownFolio = newId();
    h.ledger.bookingOf.set(ownFolio, booking);
    const strangerFolio = newId();
    h.ledger.bookingOf.set(strangerFolio, newId());
    const capture = (folioId: string) =>
      settle(
        org.tx((tx) =>
          svc.tx.capture(tx, {
            authorizationId: a.id,
            amount: usd(5_000),
            ledgerRef: { type: 'folio', id: folioId },
            businessKey: newId(),
          }),
        ),
      );
    expect(codeOf(await capture(strangerFolio))).toBe('capture_outside_booking');
    expect(codeOf(await capture(ownFolio))).toBe('accepted');
  });
});
