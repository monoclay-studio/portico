/**
 * Regression tests for focused re-review #3 (docs/orchestration/reviews/review-integration-step-3.md). Every PoC in
 * integration-step-poc/r3-fix-attacks.test.ts.txt is flipped to assert the refusal or the corrected state, with a test
 * per sibling writer and one "one step beyond" each (self-check v4 § 5).
 */
import { sql } from '@portico/db';
import { financeForReservations } from '@portico/finance';
import { newId, type RequestContext } from '@portico/kernel';
import { platform } from '@portico/platform';
import type { Booking } from '@portico/reservations';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  applied,
  bookingInput,
  bookWithCard,
  cardholderConfirms,
  cardOnFile,
  guestWithCard,
  hiyani,
  kandu,
  organization,
  readyUnit,
  type Scenario,
  type ScenarioOrg,
  startScenario,
} from './scenarios/harness';

let s: Scenario;
beforeAll(async () => {
  s = await startScenario();
});
afterAll(async () => s?.close());

const settle = <T>(p: Promise<T>) =>
  p.then(
    (v) => ({ ok: true as const, v }),
    (e: unknown) => ({ ok: false as const, e: e as { code?: string; message?: string } }),
  );
type K = Awaited<ReturnType<typeof kandu>>;

const simAccount = async (org: ScenarioOrg, legalEntityId: string) =>
  org.run(org.setup, async (tx) => {
    const a = (await s.c.services.payments.tx.listAccounts(tx, legalEntityId)).find(
      (x) => x.provider === 'simulator',
    );
    if (!a) throw new Error('no simulator account');
    return a.id;
  });
const requestsOn = async (refId: string) =>
  (
    await sql<{ id: string; amount_minor: number; paid_minor: number; status: string; purpose: string }>`
      select id, amount_minor::int, paid_minor::int, status, purpose from payments.payment_requests
       where ref_id = ${refId} order by created_at`.execute(s.t.admin.kysely)
  ).rows;
const paymentsOn = async (refId: string) =>
  (
    await sql<{ amount_minor: number; status: string; method_id: string | null }>`
      select amount_minor::int, status, method_id from payments.payments where ref_id = ${refId}
       order by created_at`.execute(s.t.admin.kysely)
  ).rows;
const lateItems = async (folioId: string) =>
  (
    await sql<{ severity: string; status: string; message: string; details: Record<string, unknown> }>`
      select severity, status, message, details from finance.exceptions
       where kind = 'late_charge' and ref_id = ${folioId} order by created_at`.execute(s.t.admin.kysely)
  ).rows;

/** A checked-out stay (balance left open), its folio helpers and a late-charge poster (R2-D/E setup). */
async function departed(org: ScenarioOrg, k: K, token = 'pm_card_visa', inHouseChargeMinor = 0) {
  const desk = org.staff('front_desk', 'Hassan', [k.id]);
  const { reservations, finance } = s.c.services;
  const { profileId, card } = await guestWithCard(s, org, k, undefined, token);
  const b = await bookWithCard(
    s,
    org,
    desk,
    bookingInput(
      k,
      { arrival: '2027-03-10', departure: '2027-03-12', unit: '214', guestProfileId: profileId },
      { guarantee: { kind: 'card', paymentMethodId: card.id } },
    ),
  );
  const stay = b.stays[0];
  if (!stay) throw new Error('no stay');
  await s.drain();
  await readyUnit(s, org, k.id, k.units['214'] as string);
  const checkIn = await reservations.performWorkflow(s.t.db, desk, {
    stayId: stay.id,
    kind: 'check_in',
    checkIn: { registration: { identityVerified: true }, access: { kind: 'card', count: 1 } },
  });
  expect(checkIn.run?.status).toBe('completed');
  await org.run(org.setup, (tx) => platform.advanceBusinessDate(tx, k.id, '2027-03-10'));
  if (inHouseChargeMinor > 0) {
    await org.run(desk, (tx) =>
      finance.postCharge(tx, {
        propertyId: k.id,
        target: { type: 'stay', id: stay.id },
        chargeCode: 'MISC',
        amount: { amountMinor: inHouseChargeMinor, currency: 'USD' },
        description: 'Boat transfer',
        serviceDate: '2027-03-11',
        sourceRef: { type: 'pos_check', id: newId() },
        idempotencyKey: `pos:${newId()}`,
      }),
    );
  }
  await org.run(org.setup, (tx) => platform.advanceBusinessDate(tx, k.id, '2027-03-11'));
  const manager = org.staff('general_manager', 'Duty manager', [k.id]);
  await reservations.performWorkflow(s.t.db, manager, {
    stayId: stay.id,
    kind: 'check_out',
    checkOut: { settle: { leaveOpenReason: 'Guest left early; settle by link' } },
  });
  await s.drain();
  const folioOf = async () =>
    (await org.run(desk, (tx) => finance.listFolios(tx, { owner: { type: 'stay', id: stay.id } })))[0];
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
  return { b, stay, desk, manager, card, profileId, folioOf, late };
}

const urgentRefunds = async (org: ScenarioOrg) =>
  (
    await sql<{ severity: string }>`select severity from payments.exceptions
      where tenant_id = ${org.tenantId} and kind = 'payment_request_overpaid'`.execute(s.t.admin.kysely)
  ).rows;
const linkStates = async (refId: string) =>
  (
    await sql<{ status: string; link_status: string; amount_minor: number }>`
      select status, link_status, amount_minor::int from payments.payment_requests where ref_id = ${refId}
       order by created_at`.execute(s.t.admin.kysely)
  ).rows;

// ───────────────────────── invariant (b): the departed folio's balance request ─────────────────────────

describe('R3-P1-1 (i) — settling the departed folio to receivables closes the guest link', () => {
  it('PoC R3-B1 flipped: after the direct bill no guest link is open, the item is closed, the old link takes no money', async () => {
    const org = await organization(s);
    const k = await kandu(s, org, '2027-03-10');
    const { finance, payments } = s.c.services;
    const { folioOf, late, manager } = await departed(org, k);
    await late(20_000, 'Spa after departure');
    await s.drain();
    const folio = await folioOf();
    const owed = folio?.balance.amountMinor as number;
    const [link] = (await requestsOn(folio?.id as string)).filter((r) => r.status === 'open');
    expect(link?.amount_minor).toBe(owed);
    const ar = await org.run(manager, (tx) =>
      finance.createReceivablesAccount(tx, {
        legalEntityId: k.legalEntityId,
        companyId: newId(),
        kind: 'company',
        name: 'Atoll Ventures Ltd',
        currency: 'USD',
        termsDays: 30,
        creditLimitMinor: 10_000_000,
      }),
    );
    await org.run(manager, (tx) =>
      finance.transferToReceivables(tx, {
        folioId: folio?.id as string,
        receivablesAccountId: ar.id,
        idempotencyKey: `ar:${newId()}`,
      }),
    );
    await s.drain();
    expect((await folioOf())?.balance.amountMinor).toBe(0);
    expect((await requestsOn(folio?.id as string)).filter((r) => r.status === 'open')).toEqual([]);
    expect((await lateItems(folio?.id as string)).filter((i) => i.status === 'open')).toEqual([]);
    expect(await linkStates(folio?.id as string)).toEqual([
      expect.objectContaining({ status: 'cancelled', link_status: 'deactivated' }),
    ]);
    const paid = await settle(payments.simulateRequestPayment(manager, link?.id as string));
    expect(paid.ok).toBe(false); // the provider refuses: the link is deactivated
    expect((await paymentsOn(folio?.id as string)).filter((p) => p.status === 'succeeded')).toEqual([]);
  });
});

describe('R3-P1-1 (ii) — a deferral is never "resolved" and resumes when the in-flight payment ends', () => {
  it('PoC R3-B2 flipped: reversal during an unconfirmed payment keeps an open item; the failed payment re-syncs the link', async () => {
    const org = await organization(s);
    const k = await kandu(s, org, '2027-03-10');
    const { finance, payments } = s.c.services;
    const { b, folioOf, late, desk, profileId } = await departed(org, k);
    const posted = await late(20_000, 'Minibar (wrong room)');
    await s.drain();
    const folio = await folioOf();
    const owedBefore = folio?.balance.amountMinor as number;
    // The guest's own card (their folio, their booking named in the agreement), whose provider answer never arrives.
    const slow = await cardOnFile(
      s,
      org,
      k.id,
      k.legalEntityId,
      'sim_timeout_then_failed',
      { type: 'guest_profile', id: profileId },
      { mandateFor: [b.id] },
    );
    await settle(
      payments.chargeNow(desk, {
        propertyId: k.id,
        methodId: slow.id,
        amount: { amountMinor: 3_400, currency: 'USD' },
        ref: { type: 'folio', id: folio?.id as string },
        separateCollection: { reason: 'Guest paid part on the phone' },
        businessKey: `pay:${newId()}`,
      }),
    );
    const inflight = await paymentsOn(folio?.id as string);
    expect(inflight.some((p) => p.status === 'pending_verification' || p.status === 'processing')).toBe(true);
    const auditor = org.staff('night_auditor', 'Auditor', [k.id]);
    await org.run(auditor, (tx) =>
      finance.reverseEntry(tx, {
        entryId: posted.entryId,
        reasonCode: 'posting_error',
        note: 'Wrong room',
        idempotencyKey: `rev:${newId()}`,
      }),
    );
    // While deferred: the item stays OPEN and says the link still asks for the old amount (never "resolved").
    const items = (await lateItems(folio?.id as string)).filter((i) => i.status === 'open');
    expect(items).toEqual([
      expect.objectContaining({
        severity: 'urgent',
        message: expect.stringMatching(/Deferred.*still asks for/),
      }),
    ]);
    await s.drain();
    // The provider reports the payment failed: the deferral ends and the request is brought in line.
    const pending = (
      await sql<{ id: string }>`select id from payments.payments where ref_id = ${folio?.id}
        and status in ('pending_verification', 'processing')`.execute(s.t.admin.kysely)
    ).rows;
    for (const p of pending) await settle(payments.checkNow(desk, { type: 'payment', id: p.id }));
    await s.drain();
    const owedNow = (await folioOf())?.balance.amountMinor as number;
    const open = (await requestsOn(folio?.id as string)).filter((x) => x.status === 'open');
    if (owedNow > 0) expect(open.map((r) => r.amount_minor)).toEqual([owedNow]);
    else expect(open).toEqual([]);
    expect(open.map((r) => r.amount_minor)).not.toContain(owedBefore);
  });
});

describe('R3-P1-1 (iii) — a replaced request stops taking money before its replacement is sent', () => {
  it('PoC R3-B3 flipped: the guest cannot pay the first link after a re-issue; the debt is collected once', async () => {
    const org = await organization(s);
    const k = await kandu(s, org, '2027-03-10');
    const { payments } = s.c.services;
    const { folioOf, late, manager } = await departed(org, k);
    await late(20_000, 'Dinner');
    await s.drain();
    const folio = await folioOf();
    const [first] = (await requestsOn(folio?.id as string)).filter((r) => r.status === 'open');
    await payments.ensurePaymentLink(manager, first?.id as string);
    await late(10_000, 'Spa');
    await s.drain();
    const all = await requestsOn(folio?.id as string);
    const second = all.find((r) => r.status === 'open');
    expect(all.find((r) => r.id === first?.id)?.status).toBe('cancelled');
    const owed = (await folioOf())?.balance.amountMinor as number;
    const old = await settle(payments.simulateRequestPayment(manager, first?.id as string));
    expect(old.ok).toBe(false);
    await payments.simulateRequestPayment(manager, second?.id as string);
    await payments.deliverSimulatorWebhooks(manager, await simAccount(org, k.legalEntityId));
    await s.drain();
    const taken = (await paymentsOn(folio?.id as string)).filter((p) => p.status === 'succeeded');
    expect(taken.reduce((n, p) => n + p.amount_minor, 0)).toBe(owed);
    expect((await folioOf())?.balance.amountMinor).toBe(0);
  });

  it('one step beyond: the guest pays the old link while the provider has not confirmed — the debt is collected once (R4-P2-1: no refund of money owed)', async () => {
    const org = await organization(s);
    const k = await kandu(s, org, '2027-03-10');
    const { payments } = s.c.services;
    const { folioOf, late, manager } = await departed(org, k);
    await late(20_000, 'Dinner');
    await s.drain();
    const folio = await folioOf();
    const [first] = (await requestsOn(folio?.id as string)).filter((r) => r.status === 'open');
    const account = await simAccount(org, k.legalEntityId);
    await org.run(org.setup, (tx) => payments.tx.setSimulatorControls(tx, account, { outage: 'refuse' }));
    await late(10_000, 'Spa');
    await s.drain();
    expect(await linkStates(folio?.id as string)).toEqual([
      expect.objectContaining({ status: 'cancelled', link_status: 'deactivating' }),
      expect.objectContaining({ status: 'open', link_status: 'pending' }),
    ]);
    await org.run(org.setup, (tx) => payments.tx.setSimulatorControls(tx, account, { outage: null }));
    const owedBefore = (await folioOf())?.balance.amountMinor as number;
    await payments.simulateRequestPayment(manager, first?.id as string);
    await payments.deliverSimulatorWebhooks(manager, account);
    await s.drain();
    // Re-review #4 R4-P2-1: the old link took money the guest owes — nothing over-collected, so no refund item; the
    // replacement asks only for what is still owed.
    expect(await urgentRefunds(org)).toEqual([]);
    const owed = (await folioOf())?.balance.amountMinor as number;
    expect(owed).toBe(owedBefore - (first?.amount_minor as number));
    expect(owed).toBeGreaterThan(0);
    const open = (await requestsOn(folio?.id as string)).filter((r) => r.status === 'open');
    expect(open.map((r) => r.amount_minor)).toEqual([owed]);
  });
});

describe('R3-B4 — one lock order across finance and payments (probe stays clean)', () => {
  it('concurrent late charges and link payments on one departed folio never deadlock', async () => {
    const org = await organization(s);
    const k = await kandu(s, org, '2027-03-10');
    const { payments } = s.c.services;
    const { folioOf, late, manager } = await departed(org, k);
    const account = await simAccount(org, k.legalEntityId);
    const errors: string[] = [];
    for (let i = 0; i < 6; i++) {
      await late(5_000, `Bar ${i}`);
      await s.drain();
      const folio = await folioOf();
      const open = (await requestsOn(folio?.id as string)).find((r) => r.status === 'open');
      if (!open) continue;
      await payments.ensurePaymentLink(manager, open.id);
      await settle(payments.simulateRequestPayment(manager, open.id, 1_000));
      const rs = await Promise.allSettled([
        payments.deliverSimulatorWebhooks(manager, account),
        late(4_000, `Late ${i}`),
        late(3_000, `Late b ${i}`),
      ]);
      for (const r of rs)
        if (r.status === 'rejected')
          errors.push(String((r.reason as Error)?.message ?? r.reason).slice(0, 160));
    }
    expect(errors).toEqual([]);
  });
});

// ───────────────────────── invariant (d): one collection per family, whatever the label ─────────────────────────

describe('R3-P2-1 — the guard treats a booking and its folios as one family; labels do not bypass it', () => {
  async function paidLink(
    org: ScenarioOrg,
    k: K,
    ref: { type: 'folio' | 'booking'; id: string },
    purpose: 'balance' | 'deposit',
    profileId: string,
  ) {
    const { payments } = s.c.services;
    const desk = org.staff('front_desk', 'Hassan', [k.id]);
    const req = await org.run(desk, (tx) =>
      payments.tx.createPaymentRequest(tx, {
        propertyId: k.id,
        payer: { type: 'guest_profile', id: profileId, name: 'Elena Ivanova' },
        amount: { amountMinor: 30_000, currency: 'USD' },
        purpose,
        ref,
        expiresAt: new Date(s.clock.now().getTime() + 86_400_000).toISOString(),
        businessKey: newId(),
      }),
    );
    const gm = org.staff('general_manager', 'GM', [k.id]);
    await payments.ensurePaymentLink(gm, req.id);
    await payments.simulateRequestPayment(gm, req.id);
    await payments.deliverSimulatorWebhooks(gm, await simAccount(org, k.legalEntityId));
  }
  async function bookingWithFolio(org: ScenarioOrg, k: K) {
    const { reservations, finance } = s.c.services;
    const desk = org.staff('front_desk', 'Hassan', [k.id]);
    const { profileId, card } = await guestWithCard(s, org, k);
    const b = applied<Booking>(
      await org.run(desk, (tx) =>
        reservations.createBooking(
          tx,
          bookingInput(k, {
            arrival: '2027-03-10',
            departure: '2027-03-12',
            unit: '214',
            guestProfileId: profileId,
          }),
        ),
      ),
    );
    // R4-P1-1: the guest confirms their saved card for this booking (the agreement names it).
    await cardholderConfirms(s, org, card.id, b.id);
    const { folioId } = await org.run(org.setup, (tx) =>
      financeForReservations(finance).openFolio(tx, {
        propertyId: k.id,
        owner: { type: 'stay', id: b.stays[0]?.id as string },
        payer: { type: 'profile', id: profileId },
      }),
    );
    return { b, folioId, card, profileId, desk };
  }
  const charge = (
    desk: RequestContext,
    k: K,
    methodId: string,
    ref: { type: 'folio' | 'booking'; id: string },
    purpose?: 'balance' | 'deposit' | 'incidentals' | 'custom',
    reason?: string,
  ) =>
    settle(
      s.c.services.payments.chargeNow(desk, {
        propertyId: k.id,
        methodId,
        amount: { amountMinor: 30_000, currency: 'USD' },
        ref,
        ...(purpose ? { purpose } : {}),
        ...(reason ? { separateCollection: { reason } } : {}),
        businessKey: newId(),
      }),
    );

  it("PoC R3-D1 flipped: after a paid balance link, the same money labelled 'incidentals' or 'deposit' needs a reason", async () => {
    const org = await organization(s);
    const k = await kandu(s, org, '2027-03-10');
    const { b, folioId, card, profileId, desk } = await bookingWithFolio(org, k);
    const folio = { type: 'folio' as const, id: folioId };
    await paidLink(org, k, folio, 'balance', profileId);
    for (const purpose of [undefined, 'incidentals', 'deposit'] as const) {
      const r = await charge(desk, k, card.id, folio, purpose);
      expect(r.ok ? 'charged' : r.e.code).toBe('collection_owned_by_payment_request');
    }
    expect((await charge(desk, k, card.id, folio, 'custom')).ok ? 'charged' : 'refused').toBe('refused');
    expect(
      (await paymentsOn(folioId)).filter((p) => p.status === 'succeeded').map((p) => p.amount_minor),
    ).toEqual([30_000]);
    // R5-P1-1: whatever the label, a card on file pays only what the folio owes — a second bill, once posted, is paid
    // with the stated reason (audited).
    await org.run(desk, (tx) =>
      s.c.services.finance.postCharge(tx, {
        propertyId: k.id,
        target: { type: 'stay', id: b.stays[0]?.id as string },
        chargeCode: 'MISC',
        amount: { amountMinor: 60_000, currency: 'USD' },
        description: 'Room service',
        serviceDate: '2027-03-10',
        sourceRef: { type: 'pos_check', id: newId() },
        idempotencyKey: `pos:${newId()}`,
      }),
    );
    const ok = await charge(desk, k, card.id, folio, 'incidentals', 'Second room service bill, separate');
    expect(ok.ok).toBe(true);
  });

  it("PoC R3-D1 flipped (family): a paid deposit link on the booking, then 'custom' or 'deposit' on its stay folio — refused", async () => {
    const org = await organization(s);
    const k = await kandu(s, org, '2027-03-10');
    const { b, folioId, card, profileId, desk } = await bookingWithFolio(org, k);
    await paidLink(org, k, { type: 'booking', id: b.id }, 'deposit', profileId);
    const folio = { type: 'folio' as const, id: folioId };
    expect((await charge(desk, k, card.id, folio, 'custom')).ok).toBe(false);
    const dep = await charge(desk, k, card.id, folio, 'deposit');
    expect(dep.ok ? 'charged' : dep.e.code).toBe('collection_owned_by_payment_request');
    const inc = await charge(desk, k, card.id, folio, 'incidentals');
    expect(inc.ok ? 'charged' : inc.e.code).toBe('collection_owned_by_payment_request');
    // R4-P3-3: before the deposit is applied, a "balance" charge would collect the deposit again — the reason is asked.
    const early = await charge(desk, k, card.id, folio, 'balance');
    expect(early.ok ? 'charged' : early.e.code).toBe('collection_owned_by_payment_request');
    // The normal flow stays free: the folio's charges, the deposit applied to it, then the balance still owed.
    const { finance } = s.c.services;
    await org.run(desk, (tx) =>
      finance.postCharge(tx, {
        propertyId: k.id,
        target: { type: 'stay', id: b.stays[0]?.id as string },
        chargeCode: 'MISC',
        amount: { amountMinor: 60_000, currency: 'USD' },
        description: 'Dinner and excursions',
        serviceDate: '2027-03-10',
        sourceRef: { type: 'pos_check', id: newId() },
        idempotencyKey: `pos:${newId()}`,
      }),
    );
    await org.run(org.setup, (tx) => finance.applyDeposits(tx, { bookingId: b.id, toFolioId: folioId }));
    expect((await charge(desk, k, card.id, folio, 'balance')).ok).toBe(true);
  });
});

// ───────────────────────── invariants (e)/(f): the cardholder's consent ─────────────────────────

describe('R3-P1-2 — the cardholder consent bounds every money movement, whoever acts', () => {
  async function narrowCard(org: ScenarioOrg, k: K) {
    const { payments, reservations } = s.c.services;
    const desk = org.staff('front_desk', 'Hassan', [k.id]);
    const { profileId: victim } = await guestWithCard(s, org, k, { firstName: 'Vera', lastName: 'Victim' });
    const a = applied<Booking>(
      await org.run(desk, (tx) =>
        reservations.createBooking(
          tx,
          bookingInput(k, {
            arrival: '2027-03-10',
            departure: '2027-03-12',
            unit: '214',
            guestProfileId: victim,
          }),
        ),
      ),
    );
    const narrow = await org.run(org.setup, async (tx) =>
      payments.tx.createMethod(tx, {
        accountId: await simAccount(org, k.legalEntityId),
        propertyId: k.id,
        kind: 'card',
        providerToken: 'pm_card_amex',
        brand: 'amex',
        last4: '8431',
        owner: { type: 'guest_profile', id: victim },
        mitAgreement: true,
        mandate: {
          termsVersion: 'card-on-file-2027-01',
          acceptedAt: s.clock.now().toISOString(),
          channel: 'front_desk',
          scope: {
            legalEntityId: k.legalEntityId,
            purposes: ['guarantee'],
            maxAmount: { amountMinor: 10_000, currency: 'USD' },
            bookingIds: [a.id],
          },
        },
      }),
    );
    return { desk, victim, a, narrow };
  }

  it("PoC R3-F1 flipped: USD 5,000 on another guest's folio and a USD 9,000 hold on their stay are refused", async () => {
    const org = await organization(s);
    const k = await kandu(s, org, '2027-03-10');
    const { payments, reservations, finance } = s.c.services;
    const { desk, narrow } = await narrowCard(org, k);
    const { profileId: other } = await guestWithCard(s, org, k, { firstName: 'Otto', lastName: 'Other' });
    const y = applied<Booking>(
      await org.run(desk, (tx) =>
        reservations.createBooking(
          tx,
          bookingInput(k, {
            arrival: '2027-03-10',
            departure: '2027-03-12',
            unit: '216',
            guestProfileId: other,
          }),
        ),
      ),
    );
    const { folioId } = await org.run(org.setup, (tx) =>
      financeForReservations(finance).openFolio(tx, {
        propertyId: k.id,
        owner: { type: 'stay', id: y.stays[0]?.id as string },
        payer: { type: 'profile', id: other },
      }),
    );
    const charged = await settle(
      payments.chargeNow(desk, {
        propertyId: k.id,
        methodId: narrow.id,
        amount: { amountMinor: 500_000, currency: 'USD' },
        ref: { type: 'folio', id: folioId },
        businessKey: newId(),
      }),
    );
    const held = await settle(
      org.run(desk, (tx) =>
        payments.tx.authorize(tx, {
          propertyId: k.id,
          methodId: narrow.id,
          amount: { amountMinor: 900_000, currency: 'USD' },
          ref: { type: 'stay', id: y.stays[0]?.id as string },
          businessKey: newId(),
        }),
      ),
    );
    expect(charged.ok ? 'charged' : charged.e.code).toBe('mandate_purpose_not_covered');
    expect(held.ok ? 'held' : held.e.code).toBe('mandate_reference_not_covered');
    expect(await paymentsOn(folioId)).toEqual([]);
  });

  it('siblings: amount above the agreement, hold increase, split holds, capture to an uncovered bill, designation', async () => {
    const org = await organization(s);
    const k = await kandu(s, org, '2027-03-10');
    const { payments, reservations } = s.c.services;
    const { desk, a, narrow } = await narrowCard(org, k);
    const stayRef = { type: 'stay', id: a.stays[0]?.id as string };
    const hold = (amountMinor: number) =>
      settle(
        org.run(desk, (tx) =>
          payments.tx.authorize(tx, {
            propertyId: k.id,
            methodId: narrow.id,
            amount: { amountMinor, currency: 'USD' },
            ref: stayRef,
            businessKey: newId(),
          }),
        ),
      );
    const over = await hold(10_001);
    expect(over.ok ? 'held' : over.e.code).toBe('mandate_amount_exceeded');
    const ok = await hold(10_000);
    expect(ok.ok).toBe(true);
    const authId = (ok.ok ? ok.v.id : '') as string;
    await payments.settle(desk, { type: 'authorization', id: authId });
    const more = await settle(
      org.run(desk, (tx) =>
        payments.tx.increment(tx, {
          authorizationId: authId,
          additionalAmount: { amountMinor: 1, currency: 'USD' },
        }),
      ),
    );
    expect(more.ok ? 'increased' : more.e.code).toBe('mandate_amount_exceeded');
    // A charge on the booking itself is not a covered purpose (guarantee only), however small.
    const small = await settle(
      payments.chargeNow(desk, {
        propertyId: k.id,
        methodId: narrow.id,
        amount: { amountMinor: 100, currency: 'USD' },
        ref: { type: 'booking', id: a.id },
        businessKey: newId(),
      }),
    );
    expect(small.ok ? 'charged' : small.e.code).toBe('mandate_purpose_not_covered');
    // Capturing the hold onto a bill of ANOTHER booking is outside the agreement.
    const { profileId: other } = await guestWithCard(s, org, k, { firstName: 'Otto', lastName: 'Other' });
    const y = applied<Booking>(
      await org.run(desk, (tx) =>
        reservations.createBooking(
          tx,
          bookingInput(k, { arrival: '2027-03-20', departure: '2027-03-22', guestProfileId: other }),
        ),
      ),
    );
    const cap = await settle(
      org.run(desk, (tx) =>
        payments.tx.capture(tx, {
          authorizationId: authId,
          ledgerRef: { type: 'booking', id: y.id },
          businessKey: newId(),
        }),
      ),
    );
    expect(cap.ok ? 'captured' : cap.e.code).toBe('mandate_reference_not_covered');
    // A payment user cannot designate the card as the guarantee of another booking either.
    const designated = await settle(
      org.run(desk, (tx) =>
        reservations.patchBooking(tx, {
          bookingId: y.id,
          expectedVersion: y.version,
          patch: { guarantee: { kind: 'card', paymentMethodId: narrow.id } },
        }),
      ),
    );
    expect(designated.ok ? 'designated' : designated.e.code).toBe('guarantee_method_not_allowed');
  });

  it('one step beyond: five charges of 100 cannot pass a 100 limit (the limit is a total)', async () => {
    const org = await organization(s);
    const k = await kandu(s, org, '2027-03-10');
    const { payments, reservations } = s.c.services;
    const desk = org.staff('front_desk', 'Hassan', [k.id]);
    const { profileId } = await guestWithCard(s, org, k);
    const b = applied<Booking>(
      await org.run(desk, (tx) =>
        reservations.createBooking(
          tx,
          bookingInput(k, { arrival: '2027-03-10', departure: '2027-03-12', guestProfileId: profileId }),
        ),
      ),
    );
    const capped = await cardOnFile(
      s,
      org,
      k.id,
      k.legalEntityId,
      'pm_card_mastercard',
      {
        type: 'guest_profile',
        id: profileId,
      },
      { mandateFor: [b.id] },
    );
    // Re-save with a 100 limit: the harness agreement has no limit, so create a capped one directly.
    const limited = await org.run(org.setup, async (tx) =>
      payments.tx.createMethod(tx, {
        accountId: await simAccount(org, k.legalEntityId),
        propertyId: k.id,
        kind: 'card',
        providerToken: 'pm_card_amex',
        owner: { type: 'guest_profile', id: profileId },
        mitAgreement: true,
        mandate: {
          termsVersion: 'card-on-file-2027-01',
          acceptedAt: s.clock.now().toISOString(),
          channel: 'front_desk',
          scope: {
            legalEntityId: k.legalEntityId,
            purposes: ['deposit'],
            maxAmount: { amountMinor: 10_000, currency: 'USD' },
            bookingIds: [b.id],
          },
        },
      }),
    );
    void capped;
    const results: string[] = [];
    for (let i = 0; i < 5; i++) {
      const r = await settle(
        payments.chargeNow(desk, {
          propertyId: k.id,
          methodId: limited.id,
          amount: { amountMinor: 3_000, currency: 'USD' },
          ref: { type: 'booking', id: b.id },
          businessKey: newId(),
          ...(i > 0 ? { separateCollection: { reason: 'split' } } : {}),
        }),
      );
      results.push(r.ok ? 'charged' : (r.e.code as string));
    }
    expect(results).toEqual([
      'charged',
      'charged',
      'charged',
      'mandate_amount_exceeded',
      'mandate_amount_exceeded',
    ]);
  });
});

// ───────────────────────── R3-P2-2: stored money issues ─────────────────────────

describe('R3-P2-2 — stored money issues carry no amounts for roles without money permissions', () => {
  it('PoC R3-G1 flipped: housekeeping sees no balance on the stay record nor in the issue list; finance still does', async () => {
    const org = await organization(s);
    const k = await kandu(s, org, '2027-03-10');
    const { reservations } = s.c.services;
    const { stay } = await departed(org, k, 'pm_card_visa', 15_000);
    const hk = org.staff('housekeeping_supervisor', 'HK', [k.id]);
    const rec = await org.run(hk, (tx) => reservations.getStay(tx, stay.id));
    const list = await org.run(hk, (tx) => reservations.listIssues(tx, { propertyId: k.id }));
    const fromRecord = (rec.issues ?? []).find((i: { code: string }) => i.code === 'departed_with_balance');
    const fromList = (
      list as Array<{ kind: string; message: string; details: Record<string, unknown> }>
    ).find((i) => i.kind === 'departed_with_balance');
    expect(fromRecord?.message).not.toMatch(/\d+ USD|balance:/);
    expect(fromList?.message).not.toMatch(/\d+ USD|balance:/);
    expect(fromList?.details).toEqual({});
    const fin = org.staff('finance', 'Accounts', [k.id]);
    const seen = (await org.run(fin, (tx) => reservations.listIssues(tx, { propertyId: k.id }))) as Array<{
      kind: string;
      message: string;
    }>;
    expect(seen.find((i) => i.kind === 'departed_with_balance')?.message).toMatch(/USD/);
  });
});

// ───────────────────────── R3-P2-3: concurrent opening imports ─────────────────────────

describe('R3-P2-3 — concurrent opening-deposit imports serialize on the booking', () => {
  it('PoC R3-C1 flipped: two legal entities import the same legacy booking concurrently — one is rejected', async () => {
    const org = await organization(s);
    const k = await kandu(s, org, '2027-03-10');
    const h = await hiyani(s, org, '2027-03-10');
    const { finance } = s.c.services;
    const legacy = newId();
    const imp = (p: K) =>
      org.run(org.staff('finance', 'Finance', [p.id]), (tx) =>
        finance.importOpeningDeposits(tx, {
          propertyId: p.id,
          currency: 'USD',
          providedClosingMinor: 10_000,
          importRef: `legacy-${p.id.slice(-6)}-${newId().slice(-6)}`,
          items: [{ bookingId: legacy, amountMinor: 10_000, legacyNotMigrated: true }],
          idempotencyKey: `imp:${newId()}`,
        }),
      );
    const [a, b] = await Promise.allSettled([imp(k), imp(h)]);
    const counts = [a, b].map((r) => (r.status === 'fulfilled' ? r.value.importedCount : -1));
    expect(counts.sort()).toEqual([0, 1]);
    const accts = (
      await sql<{ property_id: string; balance_minor: number }>`select property_id, balance_minor::int
        from finance.deposit_accounts where booking_id = ${legacy}`.execute(s.t.admin.kysely)
    ).rows;
    expect(accts).toHaveLength(1);
    expect(accts[0]?.balance_minor).toBe(10_000);
  });
});
