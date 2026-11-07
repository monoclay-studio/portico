/**
 * Regressions for the fix sweep (docs/orchestration/reviews/review-fix-sweep.md, SW-PAY-1…4) and the payments parts of
 * the integration-step re-review (review-integration-step-2.md: R2-P1-1 card guarantee, R2-P1-2 balance requests,
 * R2-P2-1 card ownership, R2-P2-3 reference allow-list). Each reviewer PoC is flipped to assert the refusal, and every
 * SIBLING entry point of the same state change has its own test (self-check v3 §3 (b)).
 */
import { sql, withTenantTx } from '@portico/db';
import { newId } from '@portico/kernel';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ALL_PURPOSES,
  addMethod,
  DEFAULT_CHANNEL_CONNECTION,
  drain,
  type Harness,
  type Org,
  postings,
  setupOrg,
  startHarness,
  stripeAccount,
} from './harness';

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(async () => h?.close());

const usd = (amountMinor: number) => ({ amountMinor, currency: 'USD' });
const mandate = (extra: Record<string, unknown> = {}) => ({
  termsVersion: 'T-2026-1',
  acceptedAt: '2026-11-07T08:00:00.000Z',
  channel: 'front_desk',
  ...extra,
});

async function paidDepositLink(org: Org, booking: { type: 'booking'; id: string }, amountMinor = 50_000) {
  const svc = h.module.service;
  const req = await org.tx((tx) =>
    svc.tx.createPaymentRequest(tx, {
      propertyId: org.propertyId,
      payer: { type: 'other', name: 'Guest' },
      amount: usd(amountMinor),
      purpose: 'deposit',
      ref: booking,
      expiresAt: new Date(h.clock.now().getTime() + 86_400_000).toISOString(),
      businessKey: newId(),
    }),
  );
  await svc.ensurePaymentLink(org.ctx, req.id);
  await svc.simulateRequestPayment(org.ctx, req.id);
  await svc.deliverSimulatorWebhooks(org.ctx, org.simAccountId);
  expect(await postings(h, org, 'deposit')).toHaveLength(1);
  return req.id;
}

const audits = async (org: Org, action: string) =>
  Number(
    (
      await sql<{ n: number }>`select count(*)::int as n from core.audit_log
        where tenant_id = ${org.tenantId} and action = ${action}`.execute(h.t.admin.kysely)
    ).rows[0]?.n ?? 0,
  );

describe('SW-PAY-1 — every collection path respects a link that owns the collection', () => {
  it('PoC flipped: hold then capture on a booking whose deposit link is paid is refused (no second deposit)', async () => {
    const org = await setupOrg(h);
    const svc = h.module.service;
    const booking = { type: 'booking' as const, id: newId() };
    await paidDepositLink(org, booking);
    const methodId = await addMethod(h, org);
    await expect(
      svc.chargeNow(org.ctx, {
        propertyId: org.propertyId,
        methodId,
        amount: usd(50_000),
        ref: booking,
        businessKey: newId(),
      }),
    ).rejects.toMatchObject({ code: 'collection_owned_by_payment_request' });
    // Sibling: the hold (first half of hold-then-capture) is refused early, nothing is recorded.
    await expect(
      org.tx((tx) =>
        svc.tx.authorize(tx, {
          propertyId: org.propertyId,
          methodId,
          amount: usd(50_000),
          ref: booking,
          businessKey: newId(),
        }),
      ),
    ).rejects.toMatchObject({ code: 'collection_owned_by_payment_request' });
    const holds = await sql<{ n: number }>`select count(*)::int as n from payments.authorizations
      where ref_id = ${booking.id}`.execute(h.t.admin.kysely);
    expect(holds.rows[0]?.n).toBe(0);
    expect(await postings(h, org, 'deposit')).toHaveLength(1);
  });

  it('sibling: a hold taken BEFORE the link was paid cannot be captured — on the booking or moved to a folio', async () => {
    const org = await setupOrg(h);
    const svc = h.module.service;
    const booking = { type: 'booking' as const, id: newId() };
    const methodId = await addMethod(h, org);
    const a = await org.tx((tx) =>
      svc.tx.authorize(tx, {
        propertyId: org.propertyId,
        methodId,
        amount: usd(50_000),
        ref: booking,
        businessKey: newId(),
      }),
    );
    await svc.settle(org.ctx, { type: 'authorization', id: a.id });
    await paidDepositLink(org, booking);
    const capture = (ledgerRef?: { type: 'folio' | 'booking'; id: string }, reason?: string) =>
      org.tx((tx) =>
        svc.tx.capture(tx, {
          authorizationId: a.id,
          businessKey: newId(),
          ...(ledgerRef ? { ledgerRef } : {}),
          ...(reason ? { separateCollection: { reason } } : {}),
        }),
      );
    await expect(capture()).rejects.toMatchObject({ code: 'collection_owned_by_payment_request' });
    // "Attack on the fix": capture the booking's hold onto a folio (purpose balance) while its deposit link is paid.
    await expect(capture({ type: 'folio', id: newId() })).rejects.toMatchObject({
      code: 'collection_owned_by_payment_request',
    });
    expect(await postings(h, org, 'deposit')).toHaveLength(1);
    expect(await postings(h, org, 'payment')).toHaveLength(0);
    // With a stated reason it is an explicit, audited separate collection.
    const before = await audits(org, 'payments.collection.ownershipOverride');
    const c = await capture(undefined, 'Guest asked to pay the second room separately');
    await svc.settle(org.ctx, { type: 'payment', id: c.id });
    expect(await audits(org, 'payments.collection.ownershipOverride')).toBeGreaterThan(before);
  });

  it('sibling: a recorded (terminal) payment of a deposit a paid link owns is refused without a reason', async () => {
    const org = await setupOrg(h);
    const svc = h.module.service;
    const booking = { type: 'booking' as const, id: newId() };
    await paidDepositLink(org, booking);
    await expect(
      org.tx((tx) =>
        svc.tx.recordPayment(tx, {
          propertyId: org.propertyId,
          method: 'cash',
          amount: usd(50_000),
          ref: booking,
          reference: `R-${newId().slice(-8)}`,
          receivedAt: h.clock.now().toISOString(),
          businessKey: newId(),
        }),
      ),
    ).rejects.toMatchObject({ code: 'collection_owned_by_payment_request' });
  });

  it('(e) atomic: ten concurrent deposit links for one booking — exactly one is created', async () => {
    const org = await setupOrg(h);
    const svc = h.module.service;
    const booking = { type: 'booking' as const, id: newId() };
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () =>
        org.tx((tx) =>
          svc.tx.createPaymentRequest(tx, {
            propertyId: org.propertyId,
            payer: { type: 'other', name: 'Guest' },
            amount: usd(50_000),
            purpose: 'deposit',
            ref: booking,
            expiresAt: new Date(h.clock.now().getTime() + 86_400_000).toISOString(),
            businessKey: newId(),
          }),
        ),
      ),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rows = await sql<{ n: number }>`select count(*)::int as n from payments.payment_requests
      where ref_id = ${booking.id}`.execute(h.t.admin.kysely);
    expect(rows.rows[0]?.n).toBe(1);
  });

  it('(e) atomic: ten concurrent desk deposit charges against a fresh link race — the guard never lets two through', async () => {
    const org = await setupOrg(h);
    const svc = h.module.service;
    const booking = { type: 'booking' as const, id: newId() };
    const methodId = await addMethod(h, org);
    // Link created first (open); then 10 desk charges at once: each must see the link under the lock.
    await org.tx((tx) =>
      svc.tx.createPaymentRequest(tx, {
        propertyId: org.propertyId,
        payer: { type: 'other', name: 'Guest' },
        amount: usd(50_000),
        purpose: 'deposit',
        ref: booking,
        expiresAt: new Date(h.clock.now().getTime() + 86_400_000).toISOString(),
        businessKey: newId(),
      }),
    );
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () =>
        org.tx((tx) =>
          svc.tx.charge(tx, {
            propertyId: org.propertyId,
            methodId,
            amount: usd(50_000),
            ref: booking,
            businessKey: newId(),
          }),
        ),
      ),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(0);
  });
});

describe("SW-PAY-2 — purpose 'custom' is not a way around the guard", () => {
  it('PoC flipped: a custom desk charge on a booking with a paid deposit link is refused; another label needs a reason', async () => {
    const org = await setupOrg(h);
    const svc = h.module.service;
    const booking = { type: 'booking' as const, id: newId() };
    await paidDepositLink(org, booking);
    const methodId = await addMethod(h, org);
    const charge = (purpose: 'custom' | 'incidentals', reason?: string) =>
      svc.chargeNow(org.ctx, {
        propertyId: org.propertyId,
        methodId,
        amount: usd(50_000),
        ref: booking,
        purpose,
        businessKey: newId(),
        ...(reason ? { separateCollection: { reason } } : {}),
      });
    // `custom` is never inside a cardholder's agreement (R3-P1-2) — with or without a reason.
    await expect(charge('custom')).rejects.toMatchObject({ code: 'mandate_purpose_not_covered' });
    await expect(charge('custom', 'separate')).rejects.toMatchObject({ code: 'mandate_purpose_not_covered' });
    // Any other label for the same money needs the stated reason (R3-P2-1), audited.
    await expect(charge('incidentals')).rejects.toMatchObject({
      code: 'collection_owned_by_payment_request',
    });
    expect(await postings(h, org, 'deposit')).toHaveLength(1);
    const before = await audits(org, 'payments.collection.ownershipOverride');
    await charge('incidentals', 'Minibar for the other room, paid separately');
    expect(await audits(org, 'payments.collection.ownershipOverride')).toBe(before + 1);
  });

  it('sibling: a channel virtual-card charge (purpose custom) is not run over a guest link on the same booking', async () => {
    const org = await setupOrg(h);
    const svc = h.module.service;
    const booking = { type: 'booking' as const, id: newId() };
    await paidDepositLink(org, booking);
    const vcc = await org.tx((tx) =>
      svc.tx.registerVirtualCard(tx, {
        propertyId: org.propertyId,
        accountId: org.simAccountId,
        vaultToken: 'pm_card_visa',
        bookingId: booking.id,
        channel: 'booking_com',
        channelReference: `BDC-${newId().slice(-8)}`,
        amount: usd(50_000),
        activationDate: '2026-11-07',
      }),
    );
    const run = await svc.runDueVirtualCards(org.ctx, { propertyId: org.propertyId });
    expect(run.started).toBe(0);
    expect(run.skipped.find((x) => x.id === vcc.id)?.reason).toMatch(/payment link/);
    expect(await postings(h, org, 'deposit')).toHaveLength(1);
  });
});

describe('SW-PAY-3 — a card is a parameter only at the property it was saved at', () => {
  const cardAtB = async (org: Org) =>
    org.tx((tx) =>
      h.module.service.tx.createMethod(tx, {
        accountId: org.simAccountId,
        propertyId: org.otherPropertyId,
        kind: 'card',
        providerToken: 'pm_card_visa',
        brand: 'visa',
        last4: '4242',
        owner: { type: 'guest_profile', id: org.payerId },
        mitAgreement: true,
        mandate: mandate({ scope: { legalEntityId: org.legalEntityId, purposes: [...ALL_PURPOSES] } }),
      }),
    );

  it('PoC flipped: a desk user of A can neither read nor charge a card saved at B', async () => {
    const org = await setupOrg(h);
    const svc = h.module.service;
    const m = await cardAtB(org);
    const deskA = org.as(['payments.payment.collect', 'payments.payment.read']);
    await expect(withTenantTx(h.db, deskA, (tx) => svc.tx.getMethod(tx, m.id))).rejects.toThrow(/not found/i);
    await expect(
      svc.chargeNow(deskA, {
        propertyId: org.propertyId,
        methodId: m.id,
        amount: usd(250_000),
        ref: { type: 'folio', id: newId() },
        businessKey: newId(),
      }),
    ).rejects.toMatchObject({ code: 'payment_method_not_found' });
    expect(await postings(h, org, 'payment')).toHaveLength(0);
  });

  it('sibling: authorize refuses it the same way; the explicit cross-property use (collect at both) is audited', async () => {
    const org = await setupOrg(h);
    const svc = h.module.service;
    const m = await cardAtB(org);
    const deskA = org.as(['payments.payment.collect', 'payments.payment.read']);
    await expect(
      withTenantTx(h.db, deskA, (tx) =>
        svc.tx.authorize(tx, {
          propertyId: org.propertyId,
          methodId: m.id,
          amount: usd(10_000),
          ref: { type: 'folio', id: newId() },
          businessKey: newId(),
        }),
      ),
    ).rejects.toMatchObject({ code: 'payment_method_not_found' });
    const both = org.as(
      ['payments.payment.collect', 'payments.payment.read'],
      [org.propertyId, org.otherPropertyId],
    );
    const before = await audits(org, 'payments.method.crossPropertyUse');
    await withTenantTx(h.db, both, (tx) =>
      svc.tx.authorize(tx, {
        propertyId: org.propertyId,
        methodId: m.id,
        amount: usd(10_000),
        ref: { type: 'folio', id: newId() },
        businessKey: newId(),
      }),
    );
    expect(await audits(org, 'payments.method.crossPropertyUse')).toBe(before + 1);
  });

  it("sibling: a mandate scoped to another property's hotel is not used here", async () => {
    const org = await setupOrg(h);
    const svc = h.module.service;
    const m = await org.tx((tx) =>
      svc.tx.createMethod(tx, {
        accountId: org.simAccountId,
        propertyId: org.propertyId,
        kind: 'card',
        providerToken: 'pm_card_visa',
        owner: { type: 'guest_profile', id: newId() },
        mitAgreement: true,
        mandate: mandate({
          scope: {
            legalEntityId: org.legalEntityId,
            propertyIds: [org.otherPropertyId],
            purposes: ['balance'],
          },
        }),
      }),
    );
    await expect(
      svc.chargeNow(org.ctx, {
        propertyId: org.propertyId,
        methodId: m.id,
        amount: usd(1_000),
        ref: { type: 'folio', id: newId() },
        businessKey: newId(),
      }),
    ).rejects.toMatchObject({ code: 'mandate_out_of_scope' });
  });
});

describe('SW-PAY-4 — "customer present" is a server fact', () => {
  it('PoC flipped: a card staff saved without a mandate is not charged as customer-initiated (twice refused)', async () => {
    const org = await setupOrg(h);
    const svc = h.module.service;
    const m = await org.tx((tx) =>
      svc.tx.createMethod(tx, {
        accountId: org.simAccountId,
        propertyId: org.propertyId,
        kind: 'card',
        providerToken: 'pm_card_visa',
        brand: 'visa',
        last4: '4242',
        holderName: 'Card holder',
        owner: { type: 'guest_profile', id: newId() },
        mitAgreement: false,
      }),
    );
    const results: string[] = [];
    for (const amountMinor of [90_000, 90_000]) {
      try {
        await svc.chargeNow(org.ctx, {
          propertyId: org.propertyId,
          methodId: m.id,
          amount: usd(amountMinor),
          ref: { type: 'folio', id: newId() },
          businessKey: newId(),
        });
        results.push('charged');
      } catch (err) {
        results.push((err as { code?: string }).code ?? 'error');
      }
    }
    expect(results).toEqual(['mit_not_agreed', 'mit_not_agreed']);
  });

  it('sibling: a client declaring entryChannel hosted_entry or terminal changes nothing; authorize refuses too', async () => {
    const org = await setupOrg(h);
    const svc = h.module.service;
    for (const entryChannel of ['hosted_entry', 'terminal'] as const) {
      const m = await org.tx((tx) =>
        svc.tx.createMethod(tx, {
          accountId: org.simAccountId,
          propertyId: org.propertyId,
          kind: 'card',
          providerToken: 'pm_card_mastercard',
          owner: { type: 'guest_profile', id: newId() },
          entryChannel,
          mitAgreement: false,
        }),
      );
      expect(m.entryChannel).toBe('staff_entry');
      await expect(
        org.tx((tx) =>
          svc.tx.authorize(tx, {
            propertyId: org.propertyId,
            methodId: m.id,
            amount: usd(10_000),
            ref: { type: 'folio', id: newId() },
            businessKey: newId(),
          }),
        ),
      ).rejects.toMatchObject({ code: 'mit_not_agreed' });
    }
  });
});

describe('R2-P2-1 — a saved card belongs to one cardholder at one property', () => {
  it('simulator: a second guest saving the shared test token gets their own card, also at another property', async () => {
    const org = await setupOrg(h);
    const svc = h.module.service;
    const save = (owner: string, propertyId = org.propertyId) =>
      org.tx((tx) =>
        svc.tx.createMethod(tx, {
          accountId: org.simAccountId,
          propertyId,
          kind: 'card',
          providerToken: 'pm_card_visa',
          owner: { type: 'guest_profile', id: owner },
        }),
      );
    const ana = newId();
    const ben = newId();
    const a = await save(ana);
    const b = await save(ben);
    expect(b.id).not.toBe(a.id);
    expect(b.owner.id).toBe(ben);
    expect((await save(ana)).id).toBe(a.id); // idempotent for the same cardholder
    const atB = await save(ana, org.otherPropertyId);
    expect(atB.id).not.toBe(a.id);
    expect(atB.propertyId).toBe(org.otherPropertyId);
  });

  it('real provider: a token already saved for another cardholder is refused, never handed over', async () => {
    const org = await setupOrg(h, 'sandbox');
    const svc = h.module.service;
    const accountId = await stripeAccount(h, org, `acct_${newId().replace(/-/g, '').slice(0, 16)}`);
    const save = (owner: string) =>
      org.tx((tx) =>
        svc.tx.createMethod(tx, {
          accountId,
          propertyId: org.propertyId,
          kind: 'card',
          providerToken: 'pm_1RealLooking0Token',
          owner: { type: 'guest_profile', id: owner },
        }),
      );
    const ana = newId();
    const a = await save(ana);
    expect((await save(ana)).id).toBe(a.id);
    await expect(save(newId())).rejects.toMatchObject({ code: 'payment_method_token_in_use' });
  });

  it('a guest-profile merge moves the cards to the survivor; an unmerge gives them back', async () => {
    const org = await setupOrg(h);
    const svc = h.module.service;
    const survivor = newId();
    const merged = newId();
    const m = await addMethod(h, org, 'pm_card_visa', true, merged);
    const consumer = (name: string) => {
      const sub = h.module.subscriptions.find((x) => x.consumer === name);
      if (!sub) throw new Error(`no consumer ${name}`);
      return sub;
    };
    const deliver = (name: string, type: string, payload: Record<string, unknown>) =>
      org.tx((tx) =>
        consumer(name).handle(tx, {
          id: newId(),
          type,
          tenantId: org.tenantId,
          payload,
          occurredAt: h.clock.now(),
        } as never),
      );
    await deliver('payments.profile-merged', 'guests.profile.merged', {
      mergeId: newId(),
      survivorId: survivor,
      mergedId: merged,
    });
    expect((await org.tx((tx) => svc.tx.getMethod(tx, m))).owner.id).toBe(survivor);
    await deliver('payments.profile-unmerged', 'guests.profile.unmerged', {
      mergeId: newId(),
      survivorId: survivor,
      restoredId: merged,
      referencesToRestore: {},
      reassigned: [],
    });
    expect((await org.tx((tx) => svc.tx.getMethod(tx, m))).owner.id).toBe(merged);
  });
});

describe('R2-P2-3 — payments verifies every reference type it accepts (allow-list)', () => {
  it('a hold for a folio of another property, or under an unknown reference type, is refused', async () => {
    const org = await setupOrg(h);
    const svc = h.module.service;
    const methodId = await addMethod(h, org);
    const foreignFolio = newId();
    h.ledger.owners.set(foreignFolio, { propertyId: org.otherPropertyId, legalEntityId: org.legalEntityId });
    const hold = (ref: { type: string; id: string }) =>
      org.tx((tx) =>
        svc.tx.authorize(tx, {
          propertyId: org.propertyId,
          methodId,
          amount: usd(10_000),
          ref,
          businessKey: newId(),
        }),
      );
    await expect(hold({ type: 'folio', id: foreignFolio })).rejects.toMatchObject({
      code: 'ledger_target_other_property',
    });
    for (const type of ['Stay', 'folio_x', 'reservation']) {
      await expect(hold({ type, id: newId() })).rejects.toMatchObject({
        code: 'reference_type_not_supported',
      });
    }
    const n = await sql<{ n: number }>`select count(*)::int as n from payments.authorizations
      where tenant_id = ${org.tenantId}`.execute(h.t.admin.kysely);
    expect(n.rows[0]?.n).toBe(0);
  });

  it('sibling: a recorded (terminal) authorization is checked the same way', async () => {
    const org = await setupOrg(h);
    const svc = h.module.service;
    await expect(
      org.tx((tx) =>
        svc.tx.recordAuthorization(tx, {
          propertyId: org.propertyId,
          accountId: org.terminalAccountId,
          amount: usd(10_000),
          ref: { type: 'Folio', id: newId() },
          approvalCode: 'A1B2C3',
          businessKey: newId(),
        }),
      ),
    ).rejects.toMatchObject({ code: 'reference_type_not_supported' });
  });
});

describe('R2-P1-1 (payments side) — what makes a card the agreed guarantee', () => {
  const assess = (org: Org, methodId: string, bookingId: string, amountMinor?: number) =>
    org.tx((tx) =>
      h.module.service.provider.assessGuaranteeCard(tx, {
        propertyId: org.propertyId,
        methodId,
        bookingId,
        ...(amountMinor ? { amount: usd(amountMinor) } : {}),
      }),
    );

  it("a guest profile's card (even with a standing mandate) is not any booking's agreed guarantee", async () => {
    const org = await setupOrg(h);
    const m = await addMethod(h, org); // guest_profile owner, mandate without a booking
    const r = await assess(org, m, newId());
    expect(r).toMatchObject({ usable: true, basis: null });
    expect(r.reason).toMatch(/Linking a person to a booking/);
  });

  it('a card staff saved "for the booking" is not cardholder-supplied; a mandate naming the booking is', async () => {
    const org = await setupOrg(h);
    const svc = h.module.service;
    const booking = newId();
    const staffSaved = await org.tx((tx) =>
      svc.tx.createMethod(tx, {
        accountId: org.simAccountId,
        propertyId: org.propertyId,
        kind: 'card',
        providerToken: 'pm_card_visa',
        owner: { type: 'booking', id: booking },
        entryChannel: 'hosted_entry',
      }),
    );
    expect((await assess(org, staffSaved.id, booking)).basis).toBeNull();
    const named = await org.tx((tx) =>
      svc.tx.createMethod(tx, {
        accountId: org.simAccountId,
        propertyId: org.propertyId,
        kind: 'card',
        providerToken: 'pm_card_mastercard',
        owner: { type: 'guest_profile', id: newId() },
        mitAgreement: true,
        mandate: mandate({
          scope: {
            legalEntityId: org.legalEntityId,
            purposes: ['guarantee'],
            maxAmount: usd(100_000),
            bookingIds: [booking],
          },
        }),
      }),
    );
    expect((await assess(org, named.id, booking, 100_000)).basis).toBe('mandate');
    expect((await assess(org, named.id, booking, 100_001)).basis).toBeNull();
    expect((await assess(org, named.id, newId(), 1_000)).basis).toBeNull();
  });

  it('a guest saving their own card for their booking is cardholder-supplied', async () => {
    const org = await setupOrg(h);
    const booking = newId();
    const guest = {
      ...org.as(['payments.method.manage']),
      actor: { kind: 'guest' as const, bookingId: booking },
    };
    const m = await withTenantTx(h.db, guest, (tx) =>
      h.module.service.tx.createMethod(tx, {
        accountId: org.simAccountId,
        propertyId: org.propertyId,
        kind: 'card',
        providerToken: 'pm_card_visa',
        owner: { type: 'booking', id: booking },
      }),
    );
    expect(m.entryChannel).toBe('hosted_entry');
    expect((await assess(org, m.id, booking)).basis).toBe('cardholder_supplied');
    // …and a guest cannot save a card for someone else's booking.
    await expect(
      withTenantTx(h.db, guest, (tx) =>
        h.module.service.tx.createMethod(tx, {
          accountId: org.simAccountId,
          propertyId: org.propertyId,
          kind: 'card',
          providerToken: 'pm_card_visa',
          owner: { type: 'booking', id: newId() },
        }),
      ),
    ).rejects.toMatchObject({ code: 'card_owner_not_self' });
  });

  it('a channel virtual card guarantees only its own channel booking; none is registered for a direct booking', async () => {
    const org = await setupOrg(h);
    const svc = h.module.service;
    const booking = newId();
    const vcc = await org.tx((tx) =>
      svc.tx.registerVirtualCard(tx, {
        propertyId: org.propertyId,
        accountId: org.simAccountId,
        vaultToken: 'pm_card_visa',
        bookingId: booking,
        channel: 'booking_com',
        channelReference: `BDC-${newId().slice(-8)}`,
        amount: usd(80_000),
        activationDate: '2026-11-20',
      }),
    );
    expect((await assess(org, vcc.methodId, booking, 80_000)).basis).toBe('channel_card');
    expect((await assess(org, vcc.methodId, booking, 80_001)).basis).toBeNull();
    expect((await assess(org, vcc.methodId, newId(), 1_000)).basis).toBeNull();
    void DEFAULT_CHANNEL_CONNECTION;
    const direct = newId();
    h.ledger.directBookings.add(direct);
    await expect(
      org.tx((tx) =>
        svc.tx.registerVirtualCard(tx, {
          propertyId: org.propertyId,
          accountId: org.simAccountId,
          vaultToken: 'pm_card_visa',
          bookingId: direct,
          channel: 'booking_com',
          channelReference: `BDC-${newId().slice(-8)}`,
          amount: usd(80_000),
          activationDate: '2026-11-20',
        }),
      ),
    ).rejects.toMatchObject({ code: 'vcc_booking_not_from_channel' });
  });
});

describe('R2-P1-2 (payments side) — one balance request per departed folio, equal to what it owes', () => {
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
      await sql<{ amount_minor: number; paid_minor: number; status: string }>`
        select amount_minor::int, paid_minor::int, status from payments.payment_requests
         where ref_id = ${folioId} order by created_at`.execute(h.t.admin.kysely)
    ).rows;

  it('creates, re-issues when a link exists, and cancels at zero — never two open requests', async () => {
    const org = await setupOrg(h);
    const folio = newId();
    expect(await sync(org, folio, 0)).toMatchObject({ status: 'none', openMinor: 0 });
    expect(await sync(org, folio, 31_900)).toMatchObject({ status: 'requested', openMinor: 31_900 });
    await drain(h);
    // The link was created after commit: a provider link cannot change its amount, so it is re-issued.
    expect(await sync(org, folio, 72_850)).toMatchObject({ status: 'reissued', openMinor: 72_850 });
    expect(await sync(org, folio, 72_850)).toMatchObject({ status: 'unchanged' });
    let rows = await requests(folio);
    expect(rows.filter((r) => r.status === 'open')).toEqual([
      expect.objectContaining({ amount_minor: 72_850 }),
    ]);
    expect(await sync(org, folio, 0)).toMatchObject({ status: 'cancelled', openMinor: 0 });
    rows = await requests(folio);
    expect(rows.filter((r) => r.status === 'open')).toEqual([]);
  });

  it('a paid part is never asked again or undercut; a closed request stops taking money at the provider', async () => {
    const org = await setupOrg(h);
    const svc = h.module.service;
    const folio = newId();
    expect(await sync(org, folio, 10_000)).toMatchObject({ status: 'requested', openMinor: 10_000 });
    const firstId = (
      await sql<{ id: string }>`select id from payments.payment_requests where ref_id = ${folio}`.execute(
        h.t.admin.kysely,
      )
    ).rows[0]?.id as string;
    // The guest pays 5,000 of it through the link…
    await svc.ensurePaymentLink(org.ctx, firstId);
    await svc.simulateRequestPayment(org.ctx, firstId, 5_000);
    await svc.deliverSimulatorWebhooks(org.ctx, org.simAccountId);
    // …then the folio is corrected to owe nothing: the request closes at what was paid, never below it…
    expect(await sync(org, folio, 0)).toMatchObject({ status: 'cancelled', openMinor: 0 });
    expect((await requests(folio))[0]).toMatchObject({
      amount_minor: 5_000,
      paid_minor: 5_000,
      status: 'paid',
    });
    // …and its link no longer takes money at the provider (Amendment 2).
    await expect(svc.simulateRequestPayment(org.ctx, firstId, 1_000)).rejects.toThrow(/no longer active/);
  });

  it('a payment still being confirmed on the folio defers the change (never asks twice)', async () => {
    const org = await setupOrg(h);
    const svc = h.module.service;
    const folio = newId();
    const methodId = await addMethod(h, org);
    await org.tx((tx) =>
      svc.tx.charge(tx, {
        propertyId: org.propertyId,
        methodId,
        amount: usd(10_000),
        ref: { type: 'folio', id: folio },
        businessKey: newId(),
      }),
    );
    expect(await sync(org, folio, 10_000)).toMatchObject({ status: 'deferred', openMinor: 0 });
    expect(await requests(folio)).toEqual([]);
  });
});
