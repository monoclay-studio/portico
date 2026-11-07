/**
 * Regression tests for the steward review of the integration step (docs/orchestration/reviews/
 * review-integration-step.md). Each reviewer PoC (integration-step-poc/*.ts.txt) is turned around: it now asserts that
 * the attack is REFUSED, plus the self-check re-attacks (reverse order, siblings, failure path, griefing).
 */
import { sql } from '@portico/db';
import { financeForReservations } from '@portico/finance';
import { newId, type RequestContext, staticAuthorizer } from '@portico/kernel';
import { platform } from '@portico/platform';
import type { Booking, TermsSnapshot } from '@portico/reservations';
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

describe('P1-3 — a late charge asks the guest for what the folio owes, never more', () => {
  it('a folio still in credit gets no payment request; one that owes gets exactly the debt', async () => {
    const org = await organization(s);
    const k = await kandu(s, org, '2027-03-10');
    const desk = org.staff('front_desk', 'Hassan', [k.id]);
    const { reservations, payments, finance } = s.c.services;
    const { profileId, card } = await guestWithCard(s, org, k);
    const b = applied<Booking>(
      await org.run(desk, (tx) =>
        reservations.createBooking(
          tx,
          bookingInput(
            k,
            { arrival: '2027-03-10', departure: '2027-03-12', unit: '214', guestProfileId: profileId },
            { guarantee: { kind: 'card', paymentMethodId: card.id } },
          ),
        ),
      ),
    );
    const stay = b.stays[0];
    if (!stay) throw new Error('no stay');
    await s.drain();
    await readyUnit(s, org, k.id, k.units['214'] as string);
    await payments.chargeNow(desk, {
      propertyId: k.id,
      methodId: card.id,
      amount: { amountMinor: 50_000, currency: 'USD' },
      ref: { type: 'booking', id: b.id },
      businessKey: `deposit:${b.id}:1`,
    });
    const checkIn = await reservations.performWorkflow(s.t.db, desk, {
      stayId: stay.id,
      kind: 'check_in',
      checkIn: { registration: { identityVerified: true }, access: { kind: 'card', count: 1 } },
    });
    expect(checkIn.run?.status).toBe('completed');
    await org.run(org.setup, (tx) => platform.advanceBusinessDate(tx, k.id, '2027-03-10'));
    await org.run(org.setup, (tx) => platform.advanceBusinessDate(tx, k.id, '2027-03-11'));
    const manager = org.staff('general_manager', 'Duty manager', [k.id]);
    const out = await reservations.performWorkflow(s.t.db, manager, {
      stayId: stay.id,
      kind: 'check_out',
      checkOut: { settle: { leaveOpenReason: 'Deposit credit to be refunded' } },
    });
    expect(out.run?.status).toBe('completed');
    await s.drain();
    const folioOf = async () =>
      (await org.run(desk, (tx) => finance.listFolios(tx, { owner: { type: 'stay', id: stay.id } })))[0];
    const folio = await folioOf();
    expect(folio?.balance.amountMinor).toBe(-50_000);
    const late = (amountMinor: number, what: string) =>
      org.run(desk, (tx) =>
        finance.postCharge(tx, {
          propertyId: k.id,
          target: { type: 'stay', id: stay.id },
          chargeCode: 'MISC',
          amount: { amountMinor, currency: 'USD' },
          description: what,
          serviceDate: '2027-03-12',
          sourceRef: { type: 'pos_check', id: newId() },
          idempotencyKey: `pos:${newId()}`,
        }),
      );
    const requests = async () =>
      (
        await sql<{ amount_minor: number; status: string; payer_type: string }>`
          select amount_minor, status, payer->>'type' as payer_type from payments.payment_requests
           where ref_type = 'folio' and ref_id = ${folio?.id} order by id`.execute(s.t.admin.kysely)
      ).rows;
    // USD 100 minibar: the guest is still in credit → no request, a routine exception says why.
    await late(10_000, 'Minibar');
    expect((await folioOf())?.balance.amountMinor).toBeLessThan(0);
    expect(await requests()).toEqual([]);
    const ex = await sql<{ severity: string; details: { collection: string; amountRequested: number } }>`
      select severity, details from finance.exceptions where kind = 'late_charge' and ref_id = ${folio?.id}`.execute(
      s.t.admin.kysely,
    );
    expect(ex.rows).toEqual([
      {
        severity: 'routine',
        details: expect.objectContaining({ collection: 'covered_by_credit', amountRequested: 0 }),
      },
    ]);
    // A USD 600 dinner: the folio now owes its balance — exactly that is requested, addressed to the guest.
    await late(60_000, 'Dinner at the overwater grill');
    const owed = (await folioOf())?.balance.amountMinor as number;
    expect(owed).toBeGreaterThan(0);
    const reqs = await requests();
    expect(reqs).toHaveLength(1);
    expect(reqs[0]).toMatchObject({ amount_minor: owed, status: 'open', payer_type: 'guest_profile' });
  });
});

describe('P2-1 — FD-15: housekeeping cannot tell paid from unpaid arrivals nor read booking money', () => {
  it('the payment check, totals, deposit requirement, payment status and folio links are withheld', async () => {
    const org = await organization(s);
    const k = await kandu(s, org, '2027-03-10');
    const { reservations, payments } = s.c.services;
    const desk = org.staff('front_desk', 'Hassan', [k.id]);
    const book = async (lastName: string) =>
      applied<Booking>(
        await org.run(desk, (tx) =>
          reservations.createBooking(
            tx,
            bookingInput(k, {
              arrival: '2027-03-10',
              departure: '2027-03-12',
              guest: { firstName: 'G', lastName },
            }),
          ),
        ),
      );
    const paid = await book('Paid');
    const unpaid = await book('Unpaid');
    const card = await cardOnFile(s, org, k.id, k.legalEntityId);
    await payments.chargeNow(desk, {
      propertyId: k.id,
      methodId: card.id,
      amount: { amountMinor: 90_000, currency: 'USD' },
      ref: { type: 'booking', id: paid.id },
      businessKey: `dep:${newId()}`,
    });
    const hk = org.staff('housekeeping_supervisor', 'Mariyam', [k.id]);
    const board = await org.run(hk, (tx) => reservations.listArrivals(tx, { propertyId: k.id }));
    const pay = (bookingId: string) =>
      board.items
        .find((r) => r.bookingId === bookingId)
        ?.readiness?.checks.find((c) => c.key === 'payment_secured');
    expect(board.items.every((r) => r.redacted === true)).toBe(true);
    expect(pay(paid.id)).toEqual(pay(unpaid.id));
    expect(pay(paid.id)).toMatchObject({
      status: 'unknown',
      message: 'Payment detail is not shown for your role.',
    });
    expect(board.items.every((r) => r.readiness?.blockingReason?.key !== 'payment_secured')).toBe(true);
    const rec = await org.run(hk, (tx) => reservations.getBooking(tx, paid.id));
    expect(rec).toMatchObject({ totals: null, depositRequirement: null, moneyRedacted: true });
    expect(rec.status.payment).toBeUndefined();
    expect(rec.stays.every((st) => st.totals === null && st.status.payment === undefined)).toBe(true);
    expect(rec.stays.flatMap((st) => st.links).some((l) => l.type === 'folio')).toBe(false);
    // The desk (money role) still sees everything.
    const deskRec = await org.run(desk, (tx) => reservations.getBooking(tx, paid.id));
    expect(deskRec.totals?.gross.amountMinor).toBeGreaterThan(0);
    expect(deskRec.status.payment).toBeDefined();
    const deskBoard = await org.run(desk, (tx) => reservations.listArrivals(tx, { propertyId: k.id }));
    expect(
      deskBoard.items
        .find((r) => r.bookingId === paid.id)
        ?.readiness?.checks.find((c) => c.key === 'payment_secured')?.status,
    ).toBe('ok');
  });
});

describe("P2-2 — finance never delegates organization-wide on reservations' port", () => {
  it("a Kandu-only agent cannot read Hiyani's folio, scoped or not", async () => {
    const org = await organization(s);
    const k = await kandu(s, org);
    const h = await hiyani(s, org);
    const port = financeForReservations(s.c.services.finance);
    const hStay = { type: 'stay', id: newId() };
    const { folioId } = await org.run(org.setup, (tx) =>
      port.openFolio(tx, { propertyId: h.id, owner: hStay, payer: { type: 'house', id: newId() } }),
    );
    const kAgent = org.staff('reservations_agent', 'Aishath', [k.id]);
    await expect(
      org.run(kAgent, (tx) => port.getFolioBalance(tx, folioId, { propertyId: k.id })),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      org.run(kAgent, (tx) => port.listFolios(tx, { propertyId: k.id, owner: hStay })),
    ).rejects.toMatchObject({ status: 403 });
    // The scope is required by the type; a caller that omits it anyway is refused at run time (no widening).
    const unscoped = port as unknown as {
      getFolioBalance(tx: unknown, folioId: string): Promise<unknown>;
      listFolios(tx: unknown, input: { owner: unknown }): Promise<unknown>;
    };
    await expect(org.run(kAgent, (tx) => unscoped.getFolioBalance(tx, folioId))).rejects.toThrow(/scope/);
    await expect(org.run(kAgent, (tx) => unscoped.listFolios(tx, { owner: hStay }))).rejects.toThrow(/scope/);
  });
});

describe('P2-3 — the rates adapter verifies the seal before evaluating stored terms', () => {
  it('penalties, deposits and complimentary terms refuse an altered document; honest terms still evaluate', async () => {
    const org = await organization(s);
    const k = await kandu(s, org);
    const { reservations, rates } = s.c.services;
    const agent = org.staff('reservations_agent', 'Aishath', [k.id]);
    const offers = await org.run(agent, (tx) =>
      reservations.deps.ports.rates.quote(tx, {
        propertyId: k.id,
        nights: { from: '2027-03-15', to: '2027-03-18' },
        occupancy: { adults: 2, childrenAges: [] },
        unitTypeIds: [k.types.BV as string],
        ratePlanIds: [k.plans.BAR as string],
      }),
    );
    const view = offers[0]?.terms as TermsSnapshot;
    const port = reservations.deps.ports.rates;
    const at = new Date('2027-03-10T09:00:00+05:00');
    const nights = ['2027-03-15', '2027-03-16', '2027-03-17'];
    expect(
      port.evaluateCancellationPenalty(view, at, { event: 'cancellation', nights }).amount.amountMinor,
    ).toBeGreaterThan(0);
    expect(port.instantiatePaymentSchedule(view).length).toBeGreaterThan(0);
    const doc = structuredClone(view.providerDocument) as {
      policies: { cancellation: unknown; deposit: unknown };
    };
    doc.policies.cancellation = null;
    doc.policies.deposit = null;
    const forged: TermsSnapshot = { ...view, providerDocument: doc };
    expect(rates.verifyTerms(doc)).toBe(false);
    expect(() => port.evaluateCancellationPenalty(forged, at, { event: 'cancellation', nights })).toThrow(
      expect.objectContaining({ code: 'terms_seal_invalid' }),
    );
    expect(() => port.instantiatePaymentSchedule(forged)).toThrow(
      expect.objectContaining({ code: 'terms_seal_invalid' }),
    );
    await expect(
      org.run(org.setup, (tx) =>
        port.complimentaryTerms(tx, { terms: forged, kind: 'complimentary', reason: 'x' }),
      ),
    ).rejects.toMatchObject({ code: 'terms_seal_invalid' });
  });
});
