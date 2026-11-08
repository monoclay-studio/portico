/**
 * Regression tests for re-review #4 (docs/orchestration/reviews/review-integration-step-4.md). Every FINDING PoC of
 * integration-step-poc/r4-fix-attacks.test.ts.txt is flipped to assert the refusal (or the corrected state); its clean
 * tests and probe stay; each fixed finding has a test per sibling entry point; and E-114 gets a lock-window test whose
 * competing writer starts INSIDE the window of the other (a held transaction), so removing the lock fails it.
 */
import { sql } from '@portico/db';
import { financeForReservations } from '@portico/finance';
import { newId, type RequestContext } from '@portico/kernel';
import { SimulatorProvider } from '@portico/payments';
import { platform } from '@portico/platform';
import type { Booking } from '@portico/reservations';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  applied,
  bookingInput,
  bookWithCard,
  cardholderConfirms,
  guestWithCard,
  kandu,
  organization,
  readyUnit,
  type Scenario,
  type ScenarioOrg,
  signIn,
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
const codeOf = (r: { ok: boolean; e?: { code?: string } }) => (r.ok ? 'accepted' : (r.e?.code as string));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
type K = Awaited<ReturnType<typeof kandu>>;
const usd = (amountMinor: number) => ({ amountMinor, currency: 'USD' });

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
    await sql<{ severity: string; status: string; message: string }>`
      select severity, status, message from finance.exceptions
       where kind = 'late_charge' and ref_id = ${folioId} order by created_at`.execute(s.t.admin.kysely)
  ).rows;
const linkStates = async (refId: string) =>
  (
    await sql<{
      id: string;
      status: string;
      link_status: string;
      amount_minor: number;
      link_url: string | null;
    }>`
      select id, status, link_status, amount_minor::int, link_url from payments.payment_requests
       where ref_id = ${refId} order by created_at`.execute(s.t.admin.kysely)
  ).rows;
const payExceptions = async (org: ScenarioOrg) =>
  (
    await sql<{
      kind: string;
      severity: string;
      status: string;
      owner_role: string | null;
      next_step: string;
      business_impact: string;
      ref_id: string;
    }>`select kind, severity, status, owner_role, next_step, business_impact, ref_id from payments.exceptions
       where tenant_id = ${org.tenantId} order by created_at`.execute(s.t.admin.kysely)
  ).rows;
const methodFor = async (
  org: ScenarioOrg,
  k: K,
  owner: { type: 'guest_profile' | 'booking'; id: string },
  scope: Record<string, unknown>,
  token = 'pm_card_amex',
) =>
  org.run(org.setup, async (tx) =>
    s.c.services.payments.tx.createMethod(tx, {
      accountId: await simAccount(org, k.legalEntityId),
      propertyId: k.id,
      kind: 'card',
      providerToken: token,
      brand: 'amex',
      last4: '8431',
      owner,
      mitAgreement: true,
      mandate: {
        termsVersion: 'card-on-file-2027-01',
        acceptedAt: s.clock.now().toISOString(),
        channel: 'front_desk',
        // Amendment 4 rule 3: an agreement staff record states its limit (a test may set a smaller one).
        scope: { legalEntityId: k.legalEntityId, maxAmount: usd(5_000_000), ...scope } as never,
      },
    }),
  );
const bookFor = async (
  org: ScenarioOrg,
  k: K,
  ctx: RequestContext,
  profileId: string,
  arrival = '2027-03-20',
  departure = '2027-03-22',
  type = 'BV',
) =>
  applied<Booking>(
    await org.run(ctx, (tx) =>
      s.c.services.reservations.createBooking(
        tx,
        bookingInput(k, { arrival, departure, guestProfileId: profileId, type }),
      ),
    ),
  );
const folioOfStay = async (org: ScenarioOrg, k: K, stayId: string, payer: string) =>
  (
    await org.run(org.setup, (tx) =>
      financeForReservations(s.c.services.finance).openFolio(tx, {
        propertyId: k.id,
        owner: { type: 'stay', id: stayId },
        payer: { type: 'profile', id: payer },
      }),
    )
  ).folioId;
const holdOn = async (
  org: ScenarioOrg,
  k: K,
  ctx: RequestContext,
  methodId: string,
  ref: object,
  amountMinor: number,
) => {
  const { payments } = s.c.services;
  const r = await settle(
    org.run(ctx, (tx) =>
      payments.tx.authorize(tx, {
        propertyId: k.id,
        methodId,
        amount: usd(amountMinor),
        ref: ref as { type: 'stay'; id: string },
        businessKey: newId(),
      }),
    ),
  );
  if (r.ok) await payments.settle(ctx, { type: 'authorization', id: r.v.id });
  return r;
};

/** A checked-out stay (balance left open), its folio helpers and a late-charge poster (R2-D/E setup). */
async function departed(org: ScenarioOrg, k: K) {
  const desk = org.staff('front_desk', 'Hassan', [k.id]);
  const { reservations, finance } = s.c.services;
  const { profileId, card } = await guestWithCard(s, org, k);
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
        amount: usd(amountMinor),
        description: what,
        serviceDate: '2027-03-12',
        sourceRef: { type: 'pos_check', id: newId() },
        idempotencyKey: `pos:${newId()}`,
      }),
    );
  return { b, stay, desk, manager, card, profileId, folioOf, late };
}

// ───────────────────────── R4-P1-1: the agreement covers only the bookings it names ─────────────────────────

describe('R4-P1-1 — a card-on-file agreement covers only the bookings it names (Amendment 3)', () => {
  it('PoC R4-A flipped: Vera named booker of Otto’s new booking — her card is refused for it, by every role', async () => {
    const org = await organization(s);
    const k = await kandu(s, org, '2027-03-10');
    const { payments, reservations } = s.c.services;
    const desk = org.staff('front_desk', 'Hassan', [k.id]);
    const { profileId: vera, card } = await guestWithCard(s, org, k, {
      firstName: 'Vera',
      lastName: 'Victim',
    });
    const { profileId: otto } = await guestWithCard(
      s,
      org,
      k,
      { firstName: 'Otto', lastName: 'Other' },
      'pm_card_mastercard',
    );
    const charge = (bookingId: string) =>
      settle(
        payments.chargeNow(desk, {
          propertyId: k.id,
          methodId: card.id,
          // Within any agreed deposit: the refusals below are about coverage, not the amount.
          amount: usd(10_000),
          ref: { type: 'booking', id: bookingId },
          purpose: 'deposit',
          businessKey: newId(),
        }),
      );
    const y = await bookFor(org, k, desk, otto, '2027-03-10');
    expect(codeOf(await charge(y.id))).toBe('mandate_reference_not_covered');
    const base = bookingInput(k, {
      arrival: '2027-03-24',
      departure: '2027-03-26',
      guest: { firstName: 'Otto', lastName: 'Other' },
      guestProfileId: otto,
    });
    const z = applied<Booking>(
      await org.run(desk, (tx) =>
        reservations.createBooking(tx, {
          ...base,
          booker: {
            kind: 'profile',
            profileId: vera,
            profile: { firstName: 'Vera', lastName: 'Victim', email: `v-${newId()}@example.ru` },
          },
        } as never),
      ),
    );
    // Neither a role without payment rights nor the desk (payment rights) can make it Z's guarantee.
    for (const who of [org.staff('reservations_agent', 'Aishath', [k.id]), desk]) {
      const g = await settle(
        org.run(who, (tx) =>
          reservations.patchBooking(tx, {
            bookingId: z.id,
            expectedVersion: z.version,
            patch: { guarantee: { kind: 'card', paymentMethodId: card.id } },
          }),
        ),
      );
      expect(codeOf(g)).toBe('guarantee_method_not_allowed');
    }
    // Flipped FINDING: the desk (collect) cannot charge Vera's card for Otto's booking.
    const charged = await charge(z.id);
    expect(codeOf(charged)).toBe('mandate_reference_not_covered');
    expect(charged.ok ? '' : charged.e.message).toMatch(/new consent/);
    expect(await paymentsOn(z.id)).toEqual([]);
    // Vera's own booking, once SHE confirms the card for it, is covered.
    const v = await bookFor(org, k, desk, vera, '2027-04-01', '2027-04-03');
    expect(codeOf(await charge(v.id))).toBe('mandate_reference_not_covered');
    await cardholderConfirms(s, org, card.id, v.id);
    expect(codeOf(await charge(v.id))).toBe('accepted');
  });

  it('PoC R4-A2 flipped: add_stay puts Vera on Otto’s booking — her card pays neither Otto’s stay nor the added one', async () => {
    const org = await organization(s);
    const k = await kandu(s, org, '2027-03-10');
    const { payments, reservations } = s.c.services;
    const desk = org.staff('front_desk', 'Hassan', [k.id]);
    const { profileId: vera, card } = await guestWithCard(s, org, k, {
      firstName: 'Vera',
      lastName: 'Victim',
    });
    const { profileId: otto } = await guestWithCard(
      s,
      org,
      k,
      { firstName: 'Otto', lastName: 'Other' },
      'pm_card_mastercard',
    );
    const y = await bookFor(org, k, desk, otto, '2027-06-01', '2027-06-04');
    const folioId = await folioOfStay(org, k, y.stays[0]?.id as string, otto);
    const chargeVera = (ref: { type: 'folio' | 'booking'; id: string }) =>
      settle(
        payments.chargeNow(desk, {
          propertyId: k.id,
          methodId: card.id,
          amount: usd(250_000),
          ref,
          purpose: 'balance',
          businessKey: newId(),
        }),
      );
    expect(codeOf(await chargeVera({ type: 'folio', id: folioId }))).toBe('mandate_reference_not_covered');
    const stay = bookingInput(k, {
      arrival: '2027-06-01',
      departure: '2027-06-02',
      guestProfileId: vera,
      type: 'BV',
    }).stays[0];
    const preview = await org.run(desk, (tx) =>
      reservations.previewChange(tx, { kind: 'add_stay', bookingId: y.id, stay } as never),
    );
    expect(preview.feasible).toBe(true);
    await reservations.commitChangeSafely(s.t.db, desk, { previewToken: preview.token });
    // Flipped FINDING: a link written by staff is not the cardholder's consent.
    expect(codeOf(await chargeVera({ type: 'folio', id: folioId }))).toBe('mandate_reference_not_covered');
    const after = await org.run(desk, (tx) => reservations.getBooking(tx, y.id));
    const added = after.stays.find((x) => x.id !== y.stays[0]?.id);
    expect(added).toBeDefined();
    const addedFolio = await folioOfStay(org, k, added?.id as string, vera);
    expect(codeOf(await chargeVera({ type: 'folio', id: addedFolio }))).toBe('mandate_reference_not_covered');
    expect(codeOf(await chargeVera({ type: 'booking', id: y.id }))).toBe('mandate_reference_not_covered');
    expect((await paymentsOn(folioId)).concat(await paymentsOn(addedFolio))).toEqual([]);
  });

  it('sibling: a stay added to the cardholder’s OWN named booking after her consent is not covered until she confirms again', async () => {
    const org = await organization(s);
    const k = await kandu(s, org, '2027-03-10');
    const { reservations } = s.c.services;
    const desk = org.staff('front_desk', 'Hassan', [k.id]);
    const { profileId: vera, card } = await guestWithCard(s, org, k, {
      firstName: 'Vera',
      lastName: 'Victim',
    });
    const v = await bookFor(org, k, desk, vera, '2027-06-10', '2027-06-12');
    await cardholderConfirms(s, org, card.id, v.id);
    const extra = bookingInput(k, { arrival: '2027-06-10', departure: '2027-06-12', type: 'WV' }).stays[0];
    const preview = await org.run(desk, (tx) =>
      reservations.previewChange(tx, { kind: 'add_stay', bookingId: v.id, stay: extra } as never),
    );
    await reservations.commitChangeSafely(s.t.db, desk, { previewToken: preview.token });
    const now = await org.run(desk, (tx) => reservations.getBooking(tx, v.id));
    const original = v.stays[0]?.id as string;
    const addedId = now.stays.find((x) => x.id !== original)?.id as string;
    expect(addedId).toBeDefined();
    expect(codeOf(await holdOn(org, k, desk, card.id, { type: 'stay', id: original }, 10_000))).toBe(
      'accepted',
    );
    const refused = await holdOn(org, k, desk, card.id, { type: 'stay', id: addedId }, 10_000);
    expect(codeOf(refused)).toBe('mandate_reference_not_covered');
    expect(refused.ok ? '' : refused.e.message).toMatch(/added after that agreement/);
    await cardholderConfirms(s, org, card.id, v.id);
    expect(codeOf(await holdOn(org, k, desk, card.id, { type: 'stay', id: addedId }, 10_000))).toBe(
      'accepted',
    );
  });

  it('sibling: a profile merge (Otto into Vera) does not extend Vera’s agreement to Otto’s booking', async () => {
    const org = await organization(s);
    const k = await kandu(s, org, '2027-03-10');
    const { payments, guests } = s.c.services;
    const desk = org.staff('front_desk', 'Hassan', [k.id]);
    const manager = org.staff('general_manager', 'Guest relations manager', [k.id]);
    const { profileId: vera, card } = await guestWithCard(s, org, k, {
      firstName: 'Vera',
      lastName: 'Victim',
    });
    const { profileId: otto } = await guestWithCard(
      s,
      org,
      k,
      { firstName: 'Otto', lastName: 'Other' },
      'pm_card_mastercard',
    );
    const y = await bookFor(org, k, desk, otto, '2027-06-20', '2027-06-22');
    await org.run(manager, (tx) =>
      guests.mergeProfiles(tx, { survivorId: vera, mergedId: otto, reason: 'Looked like the same guest' }),
    );
    await s.drain();
    const r = await settle(
      payments.chargeNow(desk, {
        propertyId: k.id,
        methodId: card.id,
        amount: usd(100_000),
        ref: { type: 'booking', id: y.id },
        purpose: 'deposit',
        businessKey: newId(),
      }),
    );
    expect(codeOf(r)).toBe('mandate_reference_not_covered');
  });

  it('sibling: naming the cardholder as the PAYER of another guest’s folio does not let staff charge her card for it', async () => {
    const org = await organization(s);
    const k = await kandu(s, org, '2027-03-10');
    const { payments } = s.c.services;
    const desk = org.staff('front_desk', 'Hassan', [k.id]);
    const { profileId: vera, card } = await guestWithCard(s, org, k, {
      firstName: 'Vera',
      lastName: 'Victim',
    });
    const { profileId: otto } = await guestWithCard(
      s,
      org,
      k,
      { firstName: 'Otto', lastName: 'Other' },
      'pm_card_mastercard',
    );
    const y = await bookFor(org, k, desk, otto, '2027-06-24', '2027-06-26');
    // Staff open Otto's stay folio with Vera as its payer.
    const folioId = await folioOfStay(org, k, y.stays[0]?.id as string, vera);
    const r = await settle(
      payments.chargeNow(desk, {
        propertyId: k.id,
        methodId: card.id,
        amount: usd(100_000),
        ref: { type: 'folio', id: folioId },
        purpose: 'balance',
        businessKey: newId(),
      }),
    );
    expect(codeOf(r)).toBe('mandate_reference_not_covered');
    expect(await paymentsOn(folioId)).toEqual([]);
  });

  it('sibling: staff cannot confirm a card for a booking on the cardholder’s behalf', async () => {
    const org = await organization(s);
    const k = await kandu(s, org, '2027-03-10');
    const desk = org.staff('front_desk', 'Hassan', [k.id]);
    const { profileId, card } = await guestWithCard(s, org, k);
    const b = await bookFor(org, k, desk, profileId);
    for (const who of [desk, org.setup]) {
      const r = await settle(
        org.run(who, (tx) =>
          s.c.services.payments.tx.confirmCardForBooking(tx, { methodId: card.id, bookingId: b.id }),
        ),
      );
      expect(r.ok ? 'confirmed' : (r.e as { status?: number }).status).toBe(403);
    }
  });
});

// ───────────────────────── R4-P1-2 / R4-P3-1: the running total under the card lock ─────────────────────────

describe('R4-P1-2 — the running total is read under the card-row lock; open holds count', () => {
  it('PoC R4-B flipped: five concurrent USD 100 charges on a USD 100 agreement — one taken, four refused', async () => {
    const org = await organization(s);
    const k = await kandu(s, org, '2027-03-10');
    const { payments } = s.c.services;
    const desk = org.staff('front_desk', 'Hassan', [k.id]);
    const { profileId } = await guestWithCard(s, org, k);
    const bookings = [];
    for (let i = 0; i < 5; i++)
      bookings.push(
        await bookFor(
          org,
          k,
          desk,
          profileId,
          `2027-04-${String(10 + i * 3)}`,
          `2027-04-${String(11 + i * 3)}`,
        ),
      );
    const capped = await methodFor(
      org,
      k,
      { type: 'guest_profile', id: profileId },
      { purposes: ['deposit'], maxAmount: usd(10_000), bookingIds: bookings.map((b) => b.id) },
    );
    const rs = await Promise.all(
      bookings.map((b) =>
        settle(
          payments.chargeNow(desk, {
            propertyId: k.id,
            methodId: capped.id,
            amount: usd(10_000),
            ref: { type: 'booking', id: b.id },
            purpose: 'deposit',
            businessKey: newId(),
          }),
        ),
      ),
    );
    const taken = (
      await sql<{ n: number }>`select coalesce(sum(amount_minor), 0)::int as n from payments.payments
        where method_id = ${capped.id} and status = 'succeeded'`.execute(s.t.admin.kysely)
    ).rows[0]?.n;
    expect(taken).toBe(10_000);
    expect(rs.map(codeOf).sort()).toEqual([
      'accepted',
      'mandate_amount_exceeded',
      'mandate_amount_exceeded',
      'mandate_amount_exceeded',
      'mandate_amount_exceeded',
    ]);
  });

  it('PoC R4-C flipped: a second USD 100 hold is refused while the first stands; the capture of the first fits', async () => {
    const org = await organization(s);
    const k = await kandu(s, org, '2027-03-10');
    const { payments } = s.c.services;
    const desk = org.staff('front_desk', 'Hassan', [k.id]);
    const { profileId } = await guestWithCard(s, org, k);
    const a = await bookFor(org, k, desk, profileId, '2027-03-10', '2027-03-12');
    const capped = await methodFor(
      org,
      k,
      { type: 'guest_profile', id: profileId },
      { purposes: ['guarantee'], maxAmount: usd(10_000), bookingIds: [a.id] },
    );
    const h1 = await holdOn(org, k, desk, capped.id, { type: 'stay', id: a.stays[0]?.id as string }, 10_000);
    const h2 = await holdOn(org, k, desk, capped.id, { type: 'booking', id: a.id }, 10_000);
    expect([codeOf(h1), codeOf(h2)]).toEqual(['accepted', 'mandate_amount_exceeded']);
    const held = (
      await sql<{ n: number }>`select coalesce(sum(amount_minor), 0)::int as n from payments.authorizations
        where method_id = ${capped.id} and status = 'authorized'`.execute(s.t.admin.kysely)
    ).rows[0]?.n;
    expect(held).toBe(10_000);
    // Sibling (increase): the open hold is the whole total — no increase beyond it.
    const inc = await settle(
      org.run(desk, (tx) =>
        payments.tx.increment(tx, { authorizationId: h1.ok ? h1.v.id : '', additionalAmount: usd(100) }),
      ),
    );
    expect(codeOf(inc)).toBe('mandate_amount_exceeded');
    // Sibling (capture): the hold's own open amount is counted once — its capture fits the total.
    const cap = await settle(
      org.run(desk, (tx) =>
        payments.tx.capture(tx, {
          authorizationId: h1.ok ? h1.v.id : '',
          ledgerRef: { type: 'booking', id: a.id },
          businessKey: newId(),
        }),
      ),
    );
    expect(codeOf(cap)).toBe('accepted');
  });

  it('sibling: three concurrent holds on three named bookings of a USD 100 agreement — one stands', async () => {
    const org = await organization(s);
    const k = await kandu(s, org, '2027-03-10');
    const desk = org.staff('front_desk', 'Hassan', [k.id]);
    const { profileId } = await guestWithCard(s, org, k);
    const bs = [];
    for (let i = 0; i < 3; i++)
      bs.push(
        await bookFor(
          org,
          k,
          desk,
          profileId,
          `2027-05-${String(10 + i * 3)}`,
          `2027-05-${String(11 + i * 3)}`,
        ),
      );
    const capped = await methodFor(
      org,
      k,
      { type: 'guest_profile', id: profileId },
      { purposes: ['guarantee'], maxAmount: usd(10_000), bookingIds: bs.map((b) => b.id) },
    );
    const rs = await Promise.all(
      bs.map((b) => holdOn(org, k, desk, capped.id, { type: 'booking', id: b.id }, 10_000)),
    );
    expect(rs.map(codeOf).sort()).toEqual(['accepted', 'mandate_amount_exceeded', 'mandate_amount_exceeded']);
  });
});

// ───────────────────────── R4-P2-1 / R4-P2-2: the link lifecycle ─────────────────────────

describe('R4-P2-1 — a payment on a retired link is refunded only for what it over-collected', () => {
  it('PoC R4-D1 flipped: the guest pays the replaced link (money they owe) — no refund item; the replacement asks for the rest', async () => {
    const org = await organization(s);
    const k = await kandu(s, org, '2027-03-10');
    const { payments } = s.c.services;
    const { folioOf, late, manager } = await departed(org, k);
    await late(20_000, 'Dinner');
    await s.drain();
    const folio = await folioOf();
    const [first] = (await requestsOn(folio?.id as string)).filter((r) => r.status === 'open');
    await payments.ensurePaymentLink(manager, first?.id as string);
    const account = await simAccount(org, k.legalEntityId);
    await org.run(org.setup, (tx) => payments.tx.setSimulatorControls(tx, account, { outage: 'refuse' }));
    await late(10_000, 'Spa');
    await s.drain();
    await org.run(org.setup, (tx) => payments.tx.setSimulatorControls(tx, account, { outage: null }));
    const owedBefore = (await folioOf())?.balance.amountMinor as number;
    await payments.simulateRequestPayment(manager, first?.id as string);
    await payments.deliverSimulatorWebhooks(manager, account);
    await s.drain();
    const owedAfter = (await folioOf())?.balance.amountMinor as number;
    expect(owedAfter).toBe(owedBefore - (first?.amount_minor as number));
    expect(owedAfter).toBeGreaterThan(0);
    expect((await payExceptions(org)).filter((e) => e.kind === 'payment_request_overpaid')).toEqual([]);
    const open = (await requestsOn(folio?.id as string)).filter((r) => r.status === 'open');
    expect(open.map((r) => r.amount_minor)).toEqual([owedAfter]);
  });

  it('sibling: when the old link DOES over-collect, the urgent item states exactly paid minus still owed', async () => {
    const org = await organization(s);
    const k = await kandu(s, org, '2027-03-10');
    const { payments } = s.c.services;
    const { folioOf, late, manager, desk } = await departed(org, k);
    await late(20_000, 'Dinner');
    await s.drain();
    const folio = await folioOf();
    const [first] = (await requestsOn(folio?.id as string)).filter((r) => r.status === 'open');
    await payments.ensurePaymentLink(manager, first?.id as string);
    const owed = (await folioOf())?.balance.amountMinor as number;
    expect(first?.amount_minor).toBe(owed);
    const account = await simAccount(org, k.legalEntityId);
    // The guest pays most of it in cash at the desk; the link cannot be stopped (the provider refuses).
    await org.run(org.setup, (tx) => payments.tx.setSimulatorControls(tx, account, { outage: 'refuse' }));
    await org.run(desk, (tx) =>
      payments.tx.recordPayment(tx, {
        propertyId: k.id,
        method: 'cash',
        amount: usd(owed - 5_000),
        ref: { type: 'folio', id: folio?.id as string },
        reference: `R-${newId().slice(-8)}`,
        receivedAt: s.clock.now().toISOString(),
        separateCollection: { reason: 'Guest paid cash at the desk' },
        businessKey: newId(),
      } as never),
    );
    await s.drain();
    await org.run(org.setup, (tx) => payments.tx.setSimulatorControls(tx, account, { outage: null }));
    // …and then pays the old link in full as well.
    await payments.simulateRequestPayment(manager, first?.id as string);
    await payments.deliverSimulatorWebhooks(manager, account);
    await s.drain();
    const balance = (await folioOf())?.balance.amountMinor as number;
    const overpaid = (first?.amount_minor as number) - 5_000;
    expect(balance).toBe(-overpaid);
    const urgent = (await payExceptions(org)).filter((e) => e.kind === 'payment_request_overpaid');
    expect(urgent).toEqual([expect.objectContaining({ severity: 'urgent' })]);
    expect(urgent[0]?.next_step).toContain((overpaid / 100).toFixed(2));
    expect(urgent[0]?.next_step).not.toContain(((first?.amount_minor as number) / 100).toFixed(2));
  });

  it('PoC R4-D2 flipped: an expired balance link is deactivated at the provider; paying it is refused; nothing to refund', async () => {
    const org = await organization(s);
    const k = await kandu(s, org, '2027-03-10');
    const { payments } = s.c.services;
    const { folioOf, late, manager } = await departed(org, k);
    await late(20_000, 'Dinner');
    await s.drain();
    const folio = await folioOf();
    const [first] = (await requestsOn(folio?.id as string)).filter((r) => r.status === 'open');
    await payments.ensurePaymentLink(manager, first?.id as string);
    const t0 = s.clock.now();
    try {
      s.clock.advance(8 * 86_400_000);
      await payments.runReconciliation(org.setup, { propertyId: k.id });
      const st = await linkStates(folio?.id as string);
      expect(st.find((r) => r.id === first?.id)?.link_status).toBe('deactivated');
      const owedBefore = (await folioOf())?.balance.amountMinor as number;
      const paid = await settle(payments.simulateRequestPayment(manager, first?.id as string));
      expect(paid.ok).toBe(false);
      await payments.deliverSimulatorWebhooks(manager, await simAccount(org, k.legalEntityId));
      await s.drain();
      expect((await folioOf())?.balance.amountMinor).toBe(owedBefore);
      expect((await payExceptions(org)).filter((e) => e.kind === 'payment_request_overpaid')).toEqual([]);
    } finally {
      s.clock.set(t0);
    }
  });

  it('sibling: the provider answers "already paid" — the replacement waits until that payment is recorded, then asks only for the rest', async () => {
    const org = await organization(s);
    const k = await kandu(s, org, '2027-03-10');
    const { payments } = s.c.services;
    const { folioOf, late, manager } = await departed(org, k);
    await late(20_000, 'Dinner');
    await s.drain();
    const folio = await folioOf();
    const [first] = (await requestsOn(folio?.id as string)).filter((r) => r.status === 'open');
    await payments.ensurePaymentLink(manager, first?.id as string);
    // The guest pays at the provider; the webhook has not arrived yet.
    await payments.simulateRequestPayment(manager, first?.id as string);
    await late(10_000, 'Spa');
    await s.drain();
    const waiting = await linkStates(folio?.id as string);
    expect(waiting.find((r) => r.id === first?.id)?.link_status).toBe('completed');
    const replacement = waiting.find((r) => r.status === 'open');
    expect(replacement).toMatchObject({ link_status: 'pending', link_url: null });
    const owedBefore = (await folioOf())?.balance.amountMinor as number;
    await payments.deliverSimulatorWebhooks(manager, await simAccount(org, k.legalEntityId));
    await s.drain();
    const owed = (await folioOf())?.balance.amountMinor as number;
    expect(owed).toBe(owedBefore - (first?.amount_minor as number));
    expect(owed).toBeGreaterThan(0);
    const after = await linkStates(folio?.id as string);
    expect(after.find((r) => r.id === first?.id)?.link_status).toBe('deactivated');
    const open = after.filter((r) => r.status === 'open');
    expect(open.map((r) => r.amount_minor)).toEqual([owed]);
    expect((await payExceptions(org)).filter((e) => e.kind === 'payment_request_overpaid')).toEqual([]);
  });
});

describe('R4-P2-2 — a deactivation the provider never confirms is owned, aged and alarmed', () => {
  it('PoC R4-E flipped: after 30 minutes an urgent finance exception; the late item never says a link is open', async () => {
    const org = await organization(s);
    const k = await kandu(s, org, '2027-03-10');
    const { payments } = s.c.services;
    const { folioOf, late, manager } = await departed(org, k);
    await late(20_000, 'Dinner');
    await s.drain();
    const folio = await folioOf();
    const [first] = (await requestsOn(folio?.id as string)).filter((r) => r.status === 'open');
    await payments.ensurePaymentLink(manager, first?.id as string);
    const account = await simAccount(org, k.legalEntityId);
    await org.run(org.setup, (tx) => payments.tx.setSimulatorControls(tx, account, { outage: 'refuse' }));
    await late(10_000, 'Spa');
    await s.drain();
    const t0 = s.clock.now();
    try {
      // Before the deadline: no alarm yet (the provider may still answer).
      s.clock.advance(10 * 60_000);
      await payments.runReconciliation(org.setup, { propertyId: k.id });
      expect((await payExceptions(org)).filter((e) => e.kind === 'payment_link_not_stopped')).toEqual([]);
      for (let i = 0; i < 3; i++) {
        s.clock.advance(10 * 60_000);
        await payments.runReconciliation(org.setup, { propertyId: k.id });
      }
      const states = await linkStates(folio?.id as string);
      expect(states).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ status: 'cancelled', link_status: 'deactivating' }),
          expect.objectContaining({ status: 'open', link_status: 'pending', link_url: null }),
        ]),
      );
      const stuck = (await payExceptions(org)).filter((e) => e.kind === 'payment_link_not_stopped');
      expect(stuck).toEqual([
        expect.objectContaining({
          severity: 'urgent',
          status: 'open',
          owner_role: 'finance',
          ref_id: first?.id,
        }),
      ]);
      // The late item never claims a link exists to send.
      const items = (await lateItems(folio?.id as string)).filter((i) => i.status === 'open');
      for (const i of items) expect(i.message).not.toMatch(/is open — send it/);
      // Finance stops it in the provider dashboard and confirms it over HTTP (If-Match); the exception closes and the
      // replacement goes out (R5-P2-1: a finance role only — not the desk, which may create links).
      await org.run(org.setup, (tx) => payments.tx.setSimulatorControls(tx, account, { outage: null }));
      const version = (
        await sql<{
          version: number;
        }>`select version from payments.payment_requests where id = ${first?.id}`.execute(s.t.admin.kysely)
      ).rows[0]?.version as number;
      for (const role of ['front_desk', 'housekeeping_supervisor'] as const) {
        const denied = await settle(
          org.run(org.staff(role, 'Not finance', [k.id]), (tx) =>
            payments.tx.confirmLinkStopped(tx, {
              requestId: first?.id as string,
              reason: 'Not mine to say',
              expectedVersion: version,
            }),
          ),
        );
        expect(denied.ok ? 'confirmed' : (denied.e as { status?: number }).status).toBe(403);
      }
      const auth = await signIn(s, org);
      const noMatch = await s.app.inject({
        method: 'POST',
        url: `/v1/payments/requests/${first?.id}/link-stopped`,
        headers: { ...auth, 'idempotency-key': newId() },
        payload: { reason: 'Expired in the dashboard' },
      });
      expect(noMatch.statusCode).toBe(400);
      expect(noMatch.json().code).toBe('if_match_required');
      const confirmed = await s.app.inject({
        method: 'POST',
        url: `/v1/payments/requests/${first?.id}/link-stopped`,
        headers: { ...auth, 'idempotency-key': newId(), 'if-match': `"${version}"` },
        payload: { reason: 'Expired in the dashboard' },
      });
      expect(confirmed.statusCode, confirmed.body).toBe(200);
      expect(confirmed.json()).toMatchObject({ id: first?.id });
      await s.drain();
      const closed = (await payExceptions(org)).filter((e) => e.kind === 'payment_link_not_stopped');
      expect(closed.map((e) => e.status)).toEqual(['resolved']);
      const now = await linkStates(folio?.id as string);
      expect(now.find((r) => r.status === 'open')?.link_status).toBe('created');
    } finally {
      s.clock.set(t0);
    }
  });
});

// ───────────────────────── clean tests of the PoC file (kept) ─────────────────────────

describe('R4-F / R4-G — link creation racing a close (clean, kept)', () => {
  it('R4-F: the request is cancelled while the provider creates its link — the new link is deactivated and refuses payment', async () => {
    const org = await organization(s);
    const k = await kandu(s, org, '2027-03-10');
    const { payments } = s.c.services;
    const desk = org.staff('front_desk', 'Hassan', [k.id]);
    const gm = org.staff('general_manager', 'GM', [k.id]);
    const { profileId } = await guestWithCard(s, org, k);
    const b = await bookFor(org, k, desk, profileId);
    const req = await org.run(desk, (tx) =>
      payments.tx.createPaymentRequest(tx, {
        propertyId: k.id,
        payer: { type: 'guest_profile', id: profileId, name: 'Elena Ivanova' },
        amount: usd(30_000),
        purpose: 'deposit',
        ref: { type: 'booking', id: b.id },
        expiresAt: new Date(s.clock.now().getTime() + 86_400_000).toISOString(),
        businessKey: newId(),
      }),
    );
    const original = SimulatorProvider.prototype.createPaymentLink;
    let fired = false;
    SimulatorProvider.prototype.createPaymentLink = async function (this: SimulatorProvider, ...args) {
      const out = await original.apply(this, args);
      if (!fired) {
        fired = true;
        const v = (
          await sql<{
            version: number;
          }>`select version from payments.payment_requests where id = ${req.id}`.execute(s.t.admin.kysely)
        ).rows[0]?.version as number;
        await org.run(desk, (tx) =>
          payments.tx.cancelPaymentRequest(tx, req.id, v, 'Guest paid at the desk'),
        );
      }
      return out;
    };
    try {
      await payments.ensurePaymentLink(gm, req.id);
    } finally {
      SimulatorProvider.prototype.createPaymentLink = original;
    }
    const [row] = await linkStates(b.id);
    expect(row).toEqual(
      expect.objectContaining({ status: 'cancelled', link_status: 'deactivated', link_url: null }),
    );
    expect((await settle(payments.simulateRequestPayment(gm, req.id))).ok).toBe(false);
  });

  it('R4-G: a manual cancel and a late-charge re-issue race ×10 — one open request ≤ the debt, no deadlock', async () => {
    const org = await organization(s);
    const k = await kandu(s, org, '2027-03-10');
    const { payments } = s.c.services;
    const { folioOf, late, manager, desk } = await departed(org, k);
    const errors: string[] = [];
    for (let i = 0; i < 10; i++) {
      await late(5_000, `Bar ${i}`);
      await s.drain();
      const folio = await folioOf();
      const open = (await requestsOn(folio?.id as string)).find((r) => r.status === 'open');
      if (!open) continue;
      await payments.ensurePaymentLink(manager, open.id);
      const v = (
        await sql<{
          version: number;
        }>`select version from payments.payment_requests where id = ${open.id}`.execute(s.t.admin.kysely)
      ).rows[0]?.version as number;
      const delay = [0, 5, 15, 30, 60, 0, 10, 20, 40, 80][i] ?? 0;
      const rs = await Promise.allSettled([
        sleep(delay).then(() =>
          org.run(desk, (tx) =>
            payments.tx.cancelPaymentRequest(tx, open.id, v, 'Guest will pay by bank transfer'),
          ),
        ),
        late(4_000, `Late ${i}`),
      ]);
      for (const r of rs)
        if (r.status === 'rejected')
          errors.push(String((r.reason as Error)?.message ?? r.reason).slice(0, 120));
      await s.drain();
      const now = await linkStates((await folioOf())?.id as string);
      const openNow = now.filter((x) => x.status === 'open');
      const owedNow = Math.max(0, (await folioOf())?.balance.amountMinor as number);
      if (openNow.length > 1 || openNow.some((x) => x.amount_minor > owedNow))
        errors.push(`round ${i}: open ${JSON.stringify(openNow)} owed ${owedNow}`);
    }
    await payments.runReconciliation(org.setup, { propertyId: k.id });
    const folio = await folioOf();
    const owed = Math.max(0, folio?.balance.amountMinor as number);
    const rows = await linkStates(folio?.id as string);
    expect(errors.filter((e) => /deadlock|round/i.test(e))).toEqual([]);
    expect(rows.filter((r) => r.link_status === 'deactivating')).toEqual([]);
    const openRows = rows.filter((r) => r.status === 'open');
    expect(openRows.length).toBeLessThanOrEqual(1);
    for (const r of openRows) expect(r.amount_minor).toBeLessThanOrEqual(owed);
  });
});

// ───────────────────────── R4-P3-2: one lock order (probe kept) ─────────────────────────

const ROUNDS_H = Number(process.env.R4_ROUNDS_H ?? 12);
describe('R4-P3-2 — applyDeposits takes the collection lock before the deposit account (probe R4-H)', () => {
  it(`a deposit link paid while the desk applies the booking’s deposits — no deadlock (${ROUNDS_H} rounds)`, async () => {
    const org = await organization(s);
    const k = await kandu(s, org, '2027-03-10');
    const { payments, finance } = s.c.services;
    const desk = org.staff('front_desk', 'Hassan', [k.id]);
    const gm = org.staff('general_manager', 'GM', [k.id]);
    const account = await simAccount(org, k.legalEntityId);
    const errors: string[] = [];
    for (let i = 0; i < ROUNDS_H; i++) {
      const { profileId } = await guestWithCard(
        s,
        org,
        k,
        { firstName: 'G', lastName: `Dep${i}` },
        i % 2 ? 'pm_card_visa' : 'pm_card_mastercard',
      );
      const d0 = new Date(Date.UTC(2027, 4, 1 + i)).toISOString().slice(0, 10);
      const d1 = new Date(Date.UTC(2027, 4, 2 + i)).toISOString().slice(0, 10);
      const b = await bookFor(org, k, desk, profileId, d0, d1);
      const folioId = await folioOfStay(org, k, b.stays[0]?.id as string, profileId);
      const link = async (amountMinor: number) => {
        const r = await org.run(desk, (tx) =>
          payments.tx.createPaymentRequest(tx, {
            propertyId: k.id,
            payer: { type: 'guest_profile', id: profileId, name: 'G' },
            amount: usd(amountMinor),
            purpose: 'deposit',
            ref: { type: 'booking', id: b.id },
            expiresAt: new Date(s.clock.now().getTime() + 86_400_000).toISOString(),
            businessKey: newId(),
            separateCollection: { reason: 'second instalment' },
          }),
        );
        await payments.ensurePaymentLink(gm, r.id);
        await payments.simulateRequestPayment(gm, r.id);
      };
      await link(10_000);
      await payments.deliverSimulatorWebhooks(gm, account);
      await link(5_000);
      const rs = await Promise.allSettled([
        payments.deliverSimulatorWebhooks(gm, account),
        org.run(desk, (tx) => finance.applyDeposits(tx, { bookingId: b.id, toFolioId: folioId })),
      ]);
      for (const r of rs)
        if (r.status === 'rejected')
          errors.push(String((r.reason as Error)?.message ?? r.reason).slice(0, 160));
      const ledgerErr = (
        await sql<{ e: string | null }>`select ledger_error as e from payments.payments
          where ref_id = ${b.id} and ledger_error is not null`.execute(s.t.admin.kysely)
      ).rows;
      for (const l of ledgerErr) errors.push(`ledger: ${l.e}`.slice(0, 160));
    }
    expect(errors.filter((e) => /deadlock/i.test(e))).toEqual([]);
  });
});

// ───────────────────────── R4-P3-3 / R4-P3-4 / R4-K / R3-D1 ─────────────────────────

describe('R4-P3-3 / R4-P3-4 — balance after a paid deposit link; the no-show purpose', () => {
  async function namedBookingWithFolio(
    org: ScenarioOrg,
    k: K,
    arrival = '2027-07-01',
    departure = '2027-07-03',
  ) {
    const desk = org.staff('front_desk', 'Hassan', [k.id]);
    const { profileId, card } = await guestWithCard(s, org, k);
    const b = await bookFor(org, k, desk, profileId, arrival, departure);
    await cardholderConfirms(s, org, card.id, b.id);
    const folioId = await folioOfStay(org, k, b.stays[0]?.id as string, profileId);
    return { desk, profileId, card, b, folioId };
  }

  it('PoC R4-J flipped: before the deposit is applied, a balance charge needs the separate-collection reason', async () => {
    const org = await organization(s);
    const k = await kandu(s, org, '2027-03-10');
    const { payments, finance } = s.c.services;
    const gm = org.staff('general_manager', 'GM', [k.id]);
    const { desk, profileId, card, b, folioId } = await namedBookingWithFolio(org, k);
    const req = await org.run(desk, (tx) =>
      payments.tx.createPaymentRequest(tx, {
        propertyId: k.id,
        payer: { type: 'guest_profile', id: profileId, name: 'Elena Ivanova' },
        amount: usd(30_000),
        purpose: 'deposit',
        ref: { type: 'booking', id: b.id },
        expiresAt: new Date(s.clock.now().getTime() + 86_400_000).toISOString(),
        businessKey: newId(),
      }),
    );
    await payments.ensurePaymentLink(gm, req.id);
    await payments.simulateRequestPayment(gm, req.id);
    await payments.deliverSimulatorWebhooks(gm, await simAccount(org, k.legalEntityId));
    const balance = (reason?: string) =>
      settle(
        payments.chargeNow(desk, {
          propertyId: k.id,
          methodId: card.id,
          amount: usd(30_000),
          ref: { type: 'folio', id: folioId },
          purpose: 'balance',
          ...(reason ? { separateCollection: { reason } } : {}),
          businessKey: newId(),
        }),
      );
    expect(codeOf(await balance())).toBe('collection_owned_by_payment_request');
    const bal = async () =>
      (
        await org.run(desk, (tx) =>
          finance.listFolios(tx, { owner: { type: 'stay', id: b.stays[0]?.id as string } }),
        )
      ).find((f) => f.id === folioId)?.balance.amountMinor;
    expect(await bal()).toBe(0);
    // R5-P1-1: a reason does not make money owed — the folio owes nothing beyond the deposit held, so the card on file
    // pays nothing as its balance.
    expect(codeOf(await balance('Guest asked to pay the extras now, separately'))).toBe('balance_not_owed');
    // Once the stay's charges are on the folio, the card pays what the held deposit does not: no reason needed.
    await org.run(desk, (tx) =>
      finance.postCharge(tx, {
        propertyId: k.id,
        target: { type: 'stay', id: b.stays[0]?.id as string },
        chargeCode: 'MISC',
        amount: usd(60_000),
        description: 'Dinner and excursions',
        serviceDate: '2027-03-10',
        sourceRef: { type: 'pos_check', id: newId() },
        idempotencyKey: `pos:${newId()}`,
      }),
    );
    expect(codeOf(await balance())).toBe('accepted');
  });

  it('R4-P3-4, corrected by R5-P1-1: `no_show` is not a label — without a recorded penalty it is refused for any card', async () => {
    const org = await organization(s);
    const k = await kandu(s, org, '2027-03-10');
    const { payments } = s.c.services;
    const desk = org.staff('front_desk', 'Hassan', [k.id]);
    const { profileId } = await guestWithCard(s, org, k);
    const b = await bookFor(org, k, desk, profileId, '2027-06-10', '2027-06-12');
    const folioId = await folioOfStay(org, k, b.stays[0]?.id as string, profileId);
    const withNoShow = await methodFor(
      org,
      k,
      { type: 'guest_profile', id: profileId },
      { purposes: ['guarantee', 'no_show'], bookingIds: [b.id] },
    );
    const fee = await settle(
      payments.chargeNow(desk, {
        propertyId: k.id,
        methodId: withNoShow.id,
        amount: usd(40_000),
        ref: { type: 'folio', id: folioId },
        purpose: 'no_show',
        businessKey: newId(),
      }),
    );
    // The booking arrives three months later: no no-show is recorded, so there is no fee to take (the round-4 version
    // of this test asserted `accepted` — the reviewer's evidence for R5-P1-1).
    expect(codeOf(fee)).toBe('no_show_not_recorded');
    expect(await paymentsOn(folioId)).toEqual([]);
  });

  it('R4-K (clean, kept): a legacy agreement without a scope is refused on charge, hold, increase and capture', async () => {
    const org = await organization(s);
    const k = await kandu(s, org, '2027-03-10');
    const { payments } = s.c.services;
    const { desk, card, b } = await namedBookingWithFolio(org, k, '2027-03-10', '2027-03-12');
    const h = await holdOn(org, k, desk, card.id, { type: 'stay', id: b.stays[0]?.id as string }, 10_000);
    expect(codeOf(h)).toBe('accepted');
    await sql`update payments.payment_methods set mandate = mandate - 'scope' where id = ${card.id}`.execute(
      s.t.admin.kysely,
    );
    const hid = h.ok ? h.v.id : '';
    const ch = await settle(
      payments.chargeNow(desk, {
        propertyId: k.id,
        methodId: card.id,
        amount: usd(100),
        ref: { type: 'booking', id: b.id },
        purpose: 'deposit',
        businessKey: newId(),
      }),
    );
    const au = await holdOn(org, k, desk, card.id, { type: 'booking', id: b.id }, 100);
    const inc = await settle(
      org.run(desk, (tx) => payments.tx.increment(tx, { authorizationId: hid, additionalAmount: usd(100) })),
    );
    const cap = await settle(
      org.run(desk, (tx) =>
        payments.tx.capture(tx, {
          authorizationId: hid,
          ledgerRef: { type: 'booking', id: b.id },
          businessKey: newId(),
        }),
      ),
    );
    expect([ch, au, inc, cap].map(codeOf)).toEqual([
      'mandate_scope_missing',
      'mandate_scope_missing',
      'mandate_scope_missing',
      'mandate_scope_missing',
    ]);
  });

  it('R3-D1 inverted (clean, kept): after a paid balance link, the same money relabelled needs the reason', async () => {
    const org = await organization(s);
    const k = await kandu(s, org, '2027-03-10');
    const { payments } = s.c.services;
    const gm = org.staff('general_manager', 'GM', [k.id]);
    const { desk, profileId, card, folioId } = await namedBookingWithFolio(
      org,
      k,
      '2027-06-10',
      '2027-06-12',
    );
    const folio = { type: 'folio' as const, id: folioId };
    const req = await org.run(desk, (tx) =>
      payments.tx.createPaymentRequest(tx, {
        propertyId: k.id,
        payer: { type: 'guest_profile', id: profileId, name: 'Elena Ivanova' },
        amount: usd(30_000),
        purpose: 'balance',
        ref: folio,
        expiresAt: new Date(s.clock.now().getTime() + 86_400_000).toISOString(),
        businessKey: newId(),
      }),
    );
    await payments.ensurePaymentLink(gm, req.id);
    await payments.simulateRequestPayment(gm, req.id);
    await payments.deliverSimulatorWebhooks(gm, await simAccount(org, k.legalEntityId));
    const codes: string[] = [];
    for (const purpose of ['incidentals', 'deposit', 'custom'] as const) {
      const r = await settle(
        payments.chargeNow(desk, {
          propertyId: k.id,
          methodId: card.id,
          amount: usd(30_000),
          ref: folio,
          purpose,
          businessKey: newId(),
        }),
      );
      codes.push(codeOf(r));
    }
    // R5-P1-1: every label is display text — the money is the folio's balance, which the paid link owns.
    expect(codes).toEqual([
      'collection_owned_by_payment_request',
      'collection_owned_by_payment_request',
      'collection_owned_by_payment_request',
    ]);
  });
});

// ───────────────────────── E-114: the collection lock, with the competitor INSIDE the window ─────────────────────────

describe('E-114 — the per-reference collection lock: a competing writer inside the other’s window waits, then is refused', () => {
  function gate() {
    let open: () => void = () => undefined;
    const p = new Promise<void>((r) => {
      open = r;
    });
    return { p, open };
  }

  async function setup() {
    const org = await organization(s);
    const k = await kandu(s, org, '2027-03-10');
    const desk = org.staff('front_desk', 'Hassan', [k.id]);
    const gm = org.staff('general_manager', 'GM', [k.id]);
    const { profileId, card } = await guestWithCard(s, org, k);
    const b = await bookFor(org, k, desk, profileId, '2027-06-14', '2027-06-16');
    await cardholderConfirms(s, org, card.id, b.id);
    const folioId = await folioOfStay(org, k, b.stays[0]?.id as string, profileId);
    // The folio owes the stay's charges (a card on file pays what is owed — Amendment 4).
    await org.run(desk, (tx) =>
      s.c.services.finance.postCharge(tx, {
        propertyId: k.id,
        target: { type: 'stay', id: b.stays[0]?.id as string },
        chargeCode: 'MISC',
        amount: usd(60_000),
        description: 'Stay charges',
        serviceDate: '2027-03-10',
        sourceRef: { type: 'pos_check', id: newId() },
        idempotencyKey: `pos:${newId()}`,
      }),
    );
    const requestInput = () => ({
      propertyId: k.id,
      payer: { type: 'guest_profile' as const, id: profileId, name: 'Elena Ivanova' },
      amount: usd(30_000),
      purpose: 'balance' as const,
      ref: { type: 'folio' as const, id: folioId },
      expiresAt: new Date(s.clock.now().getTime() + 86_400_000).toISOString(),
      businessKey: newId(),
    });
    const chargeInput = () => ({
      propertyId: k.id,
      methodId: card.id,
      amount: usd(30_000),
      ref: { type: 'folio' as const, id: folioId },
      purpose: 'balance' as const,
      businessKey: newId(),
    });
    return { org, k, desk, gm, folioId, requestInput, chargeInput };
  }

  it('link creation started while a desk charge holds the lock waits for it, then is refused (the charge is in flight)', async () => {
    const { org, desk, gm, folioId, requestInput, chargeInput } = await setup();
    const { payments } = s.c.services;
    const entered = gate();
    const release = gate();
    // The desk charge: through the guard (lock taken, payment row written), then held open before commit.
    const holder = org.run(desk, async (tx) => {
      const started = await payments.tx.charge(tx, chargeInput());
      entered.open();
      await release.p;
      return started;
    });
    await entered.p;
    let done = false;
    const competitor = settle(org.run(gm, (tx) => payments.tx.createPaymentRequest(tx, requestInput()))).then(
      (r) => {
        done = true;
        return r;
      },
    );
    await sleep(400);
    const waited = !done;
    release.open();
    await holder;
    const r = await competitor;
    expect({ waited, outcome: codeOf(r) }).toEqual({
      waited: true,
      outcome: 'collection_already_in_progress',
    });
    expect(await requestsOn(folioId)).toEqual([]);
  });

  it('a desk charge started while link creation holds the lock waits for it, then is refused (the link owns the money)', async () => {
    const { org, desk, gm, folioId, requestInput, chargeInput } = await setup();
    const { payments } = s.c.services;
    const entered = gate();
    const release = gate();
    const holder = org.run(gm, async (tx) => {
      const req = await payments.tx.createPaymentRequest(tx, requestInput());
      entered.open();
      await release.p;
      return req;
    });
    await entered.p;
    let done = false;
    const competitor = settle(payments.chargeNow(desk, chargeInput())).then((r) => {
      done = true;
      return r;
    });
    await sleep(400);
    const waited = !done;
    release.open();
    await holder;
    const r = await competitor;
    expect({ waited, outcome: codeOf(r) }).toEqual({
      waited: true,
      outcome: 'collection_owned_by_payment_request',
    });
    expect(await paymentsOn(folioId)).toEqual([]);
  });
});
