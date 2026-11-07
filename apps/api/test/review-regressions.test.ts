/**
 * Regression tests for the steward review of the integration step (docs/orchestration/reviews/
 * review-integration-step.md). Each reviewer PoC (integration-step-poc/*.ts.txt) is turned around: it now asserts that
 * the attack is REFUSED, plus the self-check re-attacks (reverse order, siblings, failure path, griefing).
 */
import { sql } from '@portico/db';
import { newId, type RequestContext, staticAuthorizer } from '@portico/kernel';
import type { Booking } from '@portico/reservations';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  applied,
  bookingInput,
  cardOnFile,
  guestWithCard,
  hiyani,
  kandu,
  organization,
  readyUnit,
  type Scenario,
  startScenario,
} from './scenarios/harness';

let s: Scenario;
beforeAll(async () => {
  s = await startScenario();
});
afterAll(async () => s?.close());

const count = async (text: ReturnType<typeof sql<{ n: number }>>) =>
  (await text.execute(s.t.admin.kysely)).rows[0]?.n ?? -1;

describe('P1-1 — a deposit is checked against the property that owns the booking', () => {
  it("a desk user at Hiyani cannot take a deposit for Kandu's booking; nothing is charged or posted", async () => {
    const org = await organization(s);
    const k = await kandu(s, org, '2027-03-10');
    const h = await hiyani(s, org, '2027-03-10');
    const { reservations, payments } = s.c.services;
    const kAgent = org.staff('reservations_agent', 'Aishath', [k.id]);
    const b = applied<Booking>(
      await org.run(kAgent, (tx) =>
        reservations.createBooking(
          tx,
          bookingInput(k, { arrival: '2027-03-10', departure: '2027-03-12', unit: '214' }),
        ),
      ),
    );
    const hDesk = org.staff('front_desk', 'Hiyani desk', [h.id]);
    const hCard = await cardOnFile(s, org, h.id, h.legalEntityId);
    const before = await count(sql<{ n: number }>`select count(*)::int as n from payments.payments`);
    const attempt = await payments
      .chargeNow(hDesk, {
        propertyId: h.id,
        methodId: hCard.id,
        amount: { amountMinor: 50_000, currency: 'USD' },
        ref: { type: 'booking', id: b.id },
        businessKey: `deposit:${newId()}`,
      })
      .then(
        () => null,
        (e: unknown) => e,
      );
    expect(attempt).toMatchObject({ code: 'ledger_target_other_property' });
    // (c) failure path: no payment, no provider operation, no deposit account.
    expect(await count(sql<{ n: number }>`select count(*)::int as n from payments.payments`)).toBe(before);
    expect(
      await count(
        sql<{
          n: number;
        }>`select count(*)::int as n from finance.deposit_accounts where booking_id = ${b.id}`,
      ),
    ).toBe(0);
    // (b) siblings: a payment request and finance's own deposit route at Hiyani are refused the same way.
    const request = await org
      .run(hDesk, (tx) =>
        payments.provider.createPaymentRequest(tx, {
          propertyId: h.id,
          payer: { type: 'other', name: 'Guest' },
          amount: { amountMinor: 1_000, currency: 'USD' },
          purpose: 'deposit',
          ref: { type: 'booking', id: b.id },
          expiresAt: '2027-03-09T00:00:00Z',
          idempotencyKey: `r:${newId()}`,
        }),
      )
      .then(
        () => null,
        (e: unknown) => e,
      );
    expect(request).toMatchObject({ code: 'ledger_target_other_property' });
    const viaFinance = await org
      .run(hDesk, (tx) =>
        reservations.deps.ports.finance.recordDeposit(tx, {
          propertyId: h.id,
          bookingId: b.id,
          amount: { amountMinor: 1_000, currency: 'USD' },
          paymentRef: { type: 'payment', id: newId() },
          idempotencyKey: `d:${newId()}`,
        }),
      )
      .then(
        () => null,
        (e: unknown) => e,
      );
    expect(viaFinance).toMatchObject({ code: 'scope_mismatch' });
    // (d) the legitimate owner is unaffected: Kandu takes the deposit and checks in its own guest.
    const kDesk = org.staff('front_desk', 'Kandu desk', [k.id]);
    const kCard = await cardOnFile(s, org, k.id, k.legalEntityId);
    const ok = await payments.chargeNow(kDesk, {
      propertyId: k.id,
      methodId: kCard.id,
      amount: { amountMinor: 50_000, currency: 'USD' },
      ref: { type: 'booking', id: b.id },
      businessKey: `deposit:${b.id}:1`,
    });
    expect(ok.status).toMatchObject({ payment: 'succeeded', ledger: 'posted' });
    const acct = await sql<{ property_id: string; legal_entity_id: string }>`
      select property_id, legal_entity_id from finance.deposit_accounts where booking_id = ${b.id}`.execute(
      s.t.admin.kysely,
    );
    expect(acct.rows).toEqual([{ property_id: k.id, legal_entity_id: k.legalEntityId }]);
    await s.drain();
    await readyUnit(s, org, k.id, k.units['214'] as string);
    const checkIn = await reservations.performWorkflow(s.t.db, kDesk, {
      stayId: b.stays[0]?.id as string,
      kind: 'check_in',
      checkIn: { registration: { identityVerified: true }, access: { kind: 'card', count: 1 } },
    });
    expect(checkIn.run?.status).toBe('completed');
  });

  it('a deposit for a booking that exists nowhere is refused before any money moves', async () => {
    const org = await organization(s);
    const h = await hiyani(s, org, '2027-03-10');
    const hDesk = org.staff('front_desk', 'Hiyani desk', [h.id]);
    const hCard = await cardOnFile(s, org, h.id, h.legalEntityId);
    const ghost = newId();
    const attempt = await s.c.services.payments
      .chargeNow(hDesk, {
        propertyId: h.id,
        methodId: hCard.id,
        amount: { amountMinor: 12_345, currency: 'USD' },
        ref: { type: 'booking', id: ghost },
        businessKey: `deposit:${newId()}`,
      })
      .then(
        () => null,
        (e: unknown) => e,
      );
    expect(attempt).toMatchObject({ code: 'ledger_target_unknown' });
    expect(
      await count(
        sql<{
          n: number;
        }>`select count(*)::int as n from finance.deposit_accounts where booking_id = ${ghost}`,
      ),
    ).toBe(0);
    expect(
      await count(
        sql<{ n: number }>`select count(*)::int as n from payments.payments where ref_id = ${ghost}`,
      ),
    ).toBe(0);
  });
});

describe("P1-2 — check-in holds only the guest's card, for the agreed amount, unless payments allows otherwise", () => {
  it("a night receptionist without payments keys cannot choose a card or amount; a stranger's card is refused", async () => {
    const org = await organization(s);
    const k = await kandu(s, org, '2027-03-10');
    const { reservations } = s.c.services;
    const agent = org.staff('reservations_agent', 'Aishath', [k.id]);
    const b = applied<Booking>(
      await org.run(agent, (tx) =>
        reservations.createBooking(
          tx,
          bookingInput(k, { arrival: '2027-03-10', departure: '2027-03-11', unit: '214' }),
        ),
      ),
    );
    const stayId = b.stays[0]?.id as string;
    await s.drain();
    await readyUnit(s, org, k.id, k.units['214'] as string);
    const strangersCard = await cardOnFile(s, org, k.id, k.legalEntityId);
    const perms = [
      'platform.property.read',
      'reservations.booking.read',
      'reservations.stay.checkIn',
      'guests.profile.read',
      'guests.profile.update',
      'operations.unit.read',
      'inventory.unit.read',
    ];
    const night: RequestContext = {
      tenantId: org.tenantId,
      environment: org.environment,
      actor: { kind: 'user', userId: newId(), displayName: 'Night receptionist' },
      authz: staticAuthorizer(perms.map((permission) => ({ permission, propertyIds: [k.id] }))),
      correlationId: newId(),
    };
    const authorizations = () =>
      count(
        sql<{ n: number }>`select count(*)::int as n from payments.authorizations where ref_id = ${stayId}`,
      );
    await expect(
      reservations.performWorkflow(s.t.db, night, {
        stayId,
        kind: 'check_in',
        checkIn: {
          registration: { identityVerified: true },
          guarantee: {
            paymentMethodId: strangersCard.id,
            amount: { amountMinor: 2_500_000, currency: 'USD' },
          },
        },
      }),
    ).rejects.toMatchObject({ status: 403 });
    expect(await authorizations()).toBe(0);
    // (b) sibling: the amount alone is also a payments decision.
    await expect(
      reservations.performWorkflow(s.t.db, night, {
        stayId,
        kind: 'check_in',
        checkIn: { guarantee: { amount: { amountMinor: 2_500_000, currency: 'USD' } } },
      }),
    ).rejects.toMatchObject({ status: 403 });
    // With the payments capability (front desk), a stranger's card is still refused and nothing is held.
    const desk = org.staff('front_desk', 'Hassan', [k.id]);
    const stranger = await reservations.performWorkflow(s.t.db, desk, {
      stayId,
      kind: 'check_in',
      checkIn: { registration: { identityVerified: true }, guarantee: { paymentMethodId: strangersCard.id } },
    });
    expect(stranger.run?.steps.find((x) => x.key === 'guarantee')).toMatchObject({
      status: 'failed',
      message: expect.stringMatching(/not a guest, booker or payer/),
    });
    // ...and an amount above the agreed stay total × the policy cap (150 %) is refused.
    const guestCard = await cardOnFile(s, org, k.id, k.legalEntityId, 'pm_card_mastercard', {
      type: 'guest_profile',
      id: b.stays[0]?.occupants[0]?.profileId as string,
    });
    const huge = await reservations.performWorkflow(s.t.db, desk, {
      stayId,
      kind: 'check_in',
      checkIn: {
        guarantee: { paymentMethodId: guestCard.id, amount: { amountMinor: 2_500_000, currency: 'USD' } },
      },
    });
    expect(huge.run?.steps.find((x) => x.key === 'guarantee')?.message).toMatch(/at most/);
    expect(await authorizations()).toBe(0);
    // (b) sibling: a booking cannot record a stranger's card as its guarantee (refused, nothing created).
    const bookingsBefore = await count(
      sql<{ n: number }>`select count(*)::int as n from reservations.bookings`,
    );
    await expect(
      org.run(agent, (tx) =>
        reservations.createBooking(
          tx,
          bookingInput(
            k,
            { arrival: '2027-03-12', departure: '2027-03-13' },
            { guarantee: { kind: 'card', paymentMethodId: strangersCard.id } },
          ),
        ),
      ),
    ).rejects.toMatchObject({ code: 'guarantee_method_not_allowed' });
    expect(await count(sql<{ n: number }>`select count(*)::int as n from reservations.bookings`)).toBe(
      bookingsBefore,
    );
    // The guest's own card for the agreed amount is authorized by the desk.
    const ok = await reservations.performWorkflow(s.t.db, desk, {
      stayId,
      kind: 'check_in',
      checkIn: { guarantee: { paymentMethodId: guestCard.id }, access: { kind: 'card', count: 1 } },
    });
    expect(ok.run?.steps.find((x) => x.key === 'guarantee')?.status).toBe('done');
    expect(await authorizations()).toBe(1);
  });

  it('(b) sibling: payments refuses a hold for a stay of another property or a stay that exists nowhere', async () => {
    const org = await organization(s);
    const k = await kandu(s, org, '2027-03-10');
    const h = await hiyani(s, org, '2027-03-10');
    const { reservations, payments } = s.c.services;
    const b = applied<Booking>(
      await org.run(org.staff('reservations_agent', 'Aishath', [k.id]), (tx) =>
        reservations.createBooking(tx, bookingInput(k, { arrival: '2027-03-10', departure: '2027-03-11' })),
      ),
    );
    const { card } = await guestWithCard(s, org, h);
    const hDesk = org.staff('front_desk', 'Hiyani desk', [h.id]);
    for (const [ref, code] of [
      [{ type: 'stay', id: b.stays[0]?.id as string }, 'reference_other_property'],
      [{ type: 'stay', id: newId() }, 'reference_unknown'],
    ] as const) {
      await expect(
        org.run(hDesk, (tx) =>
          payments.tx.authorize(tx, {
            propertyId: h.id,
            methodId: card.id,
            amount: { amountMinor: 10_000, currency: 'USD' },
            ref,
            businessKey: `a:${newId()}`,
          }),
        ),
      ).rejects.toMatchObject({ code });
    }
  });
});
