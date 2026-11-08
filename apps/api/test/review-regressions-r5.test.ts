/**
 * Regression tests for re-review #5 (docs/orchestration/reviews/review-integration-step-5.md; ADR-0015 Amendment 4).
 * Every FINDING PoC of integration-step-poc/r5-fix-attacks.test.ts.txt is flipped to assert the refusal; the class is
 * closed, not the path — each rule has a test per entry point that moves card money or the debt it may pay, the reverse
 * orders included, and the lock guards are proven with the competing writer INSIDE the holder's window.
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
  guestWithCard,
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
    (e: unknown) => ({
      ok: false as const,
      e: e as { code?: string; message?: string; status?: number; details?: Record<string, unknown> },
    }),
  );
const codeOf = (r: { ok: boolean; e?: { code?: string } }) => (r.ok ? 'accepted' : (r.e?.code as string));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
type K = Awaited<ReturnType<typeof kandu>>;
const usd = (amountMinor: number) => ({ amountMinor, currency: 'USD' });
function gate() {
  let open: () => void = () => undefined;
  const p = new Promise<void>((r) => {
    open = r;
  });
  return { p, open };
}

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
    await sql<{ id: string; amount_minor: number; paid_minor: number; status: string; version: number }>`
      select id, amount_minor::int, paid_minor::int, status, version from payments.payment_requests
       where ref_id = ${refId} order by created_at`.execute(s.t.admin.kysely)
  ).rows;
const paymentsOn = async (refId: string) =>
  (
    await sql<{ amount_minor: number; status: string; purpose: string }>`
      select amount_minor::int, status, purpose from payments.payments where ref_id = ${refId}
       order by created_at`.execute(s.t.admin.kysely)
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
    await sql<{ kind: string; status: string }>`select kind, status from payments.exceptions
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
        scope: { legalEntityId: k.legalEntityId, maxAmount: usd(5_000_000), ...scope } as never,
      },
    }),
  );
const bookFor = async (
  org: ScenarioOrg,
  k: K,
  ctx: RequestContext,
  profileId: string,
  arrival: string,
  departure: string,
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
const owe = (
  org: ScenarioOrg,
  k: K,
  ctx: RequestContext,
  stayId: string,
  amountMinor: number,
  what = 'Dinner',
) =>
  org.run(ctx, (tx) =>
    s.c.services.finance.postCharge(tx, {
      propertyId: k.id,
      target: { type: 'stay', id: stayId },
      chargeCode: 'MISC',
      amount: usd(amountMinor),
      priceMode: 'inclusive',
      description: what,
      serviceDate: '2027-03-10',
      sourceRef: { type: 'pos_check', id: newId() },
      idempotencyKey: `pos:${newId()}`,
    }),
  );
const balanceOf = async (org: ScenarioOrg, folioId: string) =>
  (await org.run(org.setup, (tx) => s.c.services.finance.getFolio(tx, folioId))).balance.amountMinor;
const cardCharge = (
  ctx: RequestContext,
  k: K,
  methodId: string,
  ref: { type: 'folio' | 'booking'; id: string },
  amountMinor: number,
  purpose?: 'balance' | 'deposit' | 'no_show' | 'custom' | 'incidentals',
) =>
  settle(
    s.c.services.payments.chargeNow(ctx, {
      propertyId: k.id,
      methodId,
      amount: usd(amountMinor),
      ref,
      ...(purpose ? { purpose } : {}),
      businessKey: newId(),
    }),
  );
async function addStay(
  org: ScenarioOrg,
  k: K,
  ctx: RequestContext,
  booking: Booking,
  guestProfileId: string,
) {
  const { reservations } = s.c.services;
  const extra = bookingInput(k, {
    arrival: booking.stays[0]?.arrival as string,
    departure: booking.stays[0]?.departure as string,
    type: 'WV',
    guestProfileId,
  }).stays[0];
  const preview = await org.run(ctx, (tx) =>
    reservations.previewChange(tx, { kind: 'add_stay', bookingId: booking.id, stay: extra } as never),
  );
  await reservations.commitChangeSafely(s.t.db, ctx, { previewToken: preview.token });
  const now = await org.run(ctx, (tx) => reservations.getBooking(tx, booking.id));
  return now.stays.find((x) => x.id !== booking.stays[0]?.id)?.id as string;
}
const paidDepositLink = async (
  org: ScenarioOrg,
  k: K,
  bookingId: string,
  profileId: string,
  amountMinor: number,
) => {
  const { payments } = s.c.services;
  const desk = org.staff('front_desk', 'Hassan', [k.id]);
  const gm = org.staff('general_manager', 'GM', [k.id]);
  const req = await org.run(desk, (tx) =>
    payments.tx.createPaymentRequest(tx, {
      propertyId: k.id,
      payer: { type: 'guest_profile', id: profileId, name: 'Guest' },
      amount: usd(amountMinor),
      purpose: 'deposit',
      ref: { type: 'booking', id: bookingId },
      expiresAt: new Date(s.clock.now().getTime() + 86_400_000).toISOString(),
      businessKey: newId(),
    }),
  );
  await payments.ensurePaymentLink(gm, req.id);
  await payments.simulateRequestPayment(gm, req.id);
  await payments.deliverSimulatorWebhooks(gm, await simAccount(org, k.legalEntityId));
  await s.drain();
};

// ───────────────────────── R5-P1-1: purposes are facts ─────────────────────────

describe('R5-P1-1 — a purpose rests on the record that justifies it, never on the desk’s label', () => {
  it('PoC R5-A1 flipped: USD 2,500 labelled no_show on an ordinary stay is refused; after the night audit records the no-show, the fee is taken up to the recorded penalty', async () => {
    const org = await organization(s);
    const k = await kandu(s, org, '2027-03-10');
    const { reservations } = s.c.services;
    const desk = org.staff('front_desk', 'Hassan', [k.id]);
    const auditor = org.staff('night_auditor', 'Night audit', [k.id]);
    const { profileId } = await guestWithCard(s, org, k);
    const b = await bookFor(org, k, desk, profileId, '2027-03-10', '2027-03-14');
    const stayId = b.stays[0]?.id as string;
    const folioId = await folioOfStay(org, k, stayId, profileId);
    const card = await methodFor(
      org,
      k,
      { type: 'guest_profile', id: profileId },
      { purposes: ['guarantee', 'no_show'], bookingIds: [b.id] },
    );
    const folio = { type: 'folio' as const, id: folioId };
    expect(codeOf(await cardCharge(desk, k, card.id, folio, 250_000, 'balance'))).toBe(
      'mandate_purpose_not_covered',
    );
    const r = await cardCharge(desk, k, card.id, folio, 250_000, 'no_show');
    expect(codeOf(r)).toBe('no_show_not_recorded'); // flipped FINDING
    // The fact has one writer: the night audit's `reservations.stay.noShow` (the desk cannot create it).
    const byDesk = await settle(
      org.run(desk, (tx) => reservations.markNoShow(tx, { stayId, idempotencyKey: newId() })),
    );
    expect(byDesk.ok ? 'recorded' : byDesk.e.status).toBe(403);
    const noShow = await org.run(auditor, (tx) =>
      reservations.markNoShow(tx, { stayId, idempotencyKey: newId() }),
    );
    const penalty = noShow.penalty.amountMinor;
    expect(penalty).toBeGreaterThan(0);
    await s.drain();
    expect(codeOf(await cardCharge(desk, k, card.id, folio, penalty + 1, 'no_show'))).toBe(
      'no_show_penalty_exceeded',
    );
    expect(codeOf(await cardCharge(desk, k, card.id, folio, penalty, 'no_show'))).toBe('accepted');
    expect(codeOf(await cardCharge(desk, k, card.id, folio, 100, 'no_show'))).toBe(
      'no_show_penalty_exceeded',
    );
    expect((await paymentsOn(folioId)).filter((p) => p.status === 'succeeded')).toEqual([
      { amount_minor: penalty, status: 'succeeded', purpose: 'no_show' },
    ]);
  });

  it('PoC R5-A2 flipped: with a paid deposit not yet applied, `no_show` collects nothing twice', async () => {
    const org = await organization(s);
    const k = await kandu(s, org, '2027-03-10');
    const { reservations } = s.c.services;
    const desk = org.staff('front_desk', 'Hassan', [k.id]);
    const auditor = org.staff('night_auditor', 'Night audit', [k.id]);
    const { profileId, card } = await guestWithCard(s, org, k);
    const b = await bookFor(org, k, desk, profileId, '2027-03-10', '2027-03-12');
    await cardholderConfirms(s, org, card.id, b.id);
    const stayId = b.stays[0]?.id as string;
    const folioId = await folioOfStay(org, k, stayId, profileId);
    const folio = { type: 'folio' as const, id: folioId };
    await paidDepositLink(org, k, b.id, profileId, 30_000);
    expect(codeOf(await cardCharge(desk, k, card.id, folio, 30_000, 'balance'))).toBe(
      'collection_owned_by_payment_request',
    );
    expect(codeOf(await cardCharge(desk, k, card.id, folio, 30_000, 'no_show'))).toBe('no_show_not_recorded'); // flipped
    // Once the no-show is recorded, the fee is the folio's money like its balance: only what the held deposit does not
    // already pay is free; beyond it the link owns it.
    await org.run(auditor, (tx) => reservations.markNoShow(tx, { stayId, idempotencyKey: newId() }));
    await s.drain();
    const owed = (await balanceOf(org, folioId)) - 30_000;
    expect(owed).toBeGreaterThan(0);
    expect(codeOf(await cardCharge(desk, k, card.id, folio, owed + 30_000, 'no_show'))).toBe(
      'collection_owned_by_payment_request',
    );
    expect(codeOf(await cardCharge(desk, k, card.id, folio, owed, 'no_show'))).toBe('accepted');
  });

  it('sibling: a cancellation penalty recorded on the cancelled stay is the fact; a waived one is not', async () => {
    const org = await organization(s);
    const k = await kandu(s, org, '2027-03-10');
    const { reservations } = s.c.services;
    const desk = org.staff('front_desk', 'Hassan', [k.id]);
    const gm = org.staff('general_manager', 'GM', [k.id]);
    const { profileId } = await guestWithCard(s, org, k);
    const cancelled = async (waive: boolean) => {
      // Arrives within the flexible plan's 21 days: cancelling costs a penalty.
      const b = await bookFor(org, k, desk, profileId, '2027-03-20', '2027-03-22');
      const stayId = b.stays[0]?.id as string;
      const folioId = await folioOfStay(org, k, stayId, profileId);
      const preview = await org.run(gm, (tx) =>
        reservations.previewChange(tx, {
          kind: 'cancel_stay',
          stayId,
          ...(waive ? { waive: { reason: 'Medical emergency, goodwill' } } : {}),
        } as never),
      );
      await reservations.commitChangeSafely(s.t.db, gm, { previewToken: preview.token });
      await s.drain();
      return { b, folioId };
    };
    const charged = await cancelled(false);
    const card = await methodFor(
      org,
      k,
      { type: 'guest_profile', id: profileId },
      { purposes: ['guarantee', 'no_show'], bookingIds: [charged.b.id] },
    );
    const owed = await balanceOf(org, charged.folioId);
    expect(owed).toBeGreaterThan(0);
    expect(
      codeOf(await cardCharge(desk, k, card.id, { type: 'folio', id: charged.folioId }, owed, 'no_show')),
    ).toBe('accepted');
    const waived = await cancelled(true);
    const card2 = await methodFor(
      org,
      k,
      { type: 'guest_profile', id: profileId },
      { purposes: ['guarantee', 'no_show'], bookingIds: [waived.b.id] },
      'pm_card_mastercard',
    );
    expect(
      codeOf(await cardCharge(desk, k, card2.id, { type: 'folio', id: waived.folioId }, 1_000, 'no_show')),
    ).toBe('no_show_not_recorded');
  });

  it('sibling: a deposit is taken up to the agreed schedule, a balance up to what the folio owes — whatever the label', async () => {
    const org = await organization(s);
    const k = await kandu(s, org, '2027-03-10');
    const desk = org.staff('front_desk', 'Hassan', [k.id]);
    const { profileId, card } = await guestWithCard(s, org, k);
    const b = await bookFor(org, k, desk, profileId, '2027-04-10', '2027-04-12');
    await cardholderConfirms(s, org, card.id, b.id);
    const booking = { type: 'booking' as const, id: b.id };
    const tooMuch = await cardCharge(desk, k, card.id, booking, 4_000_000, 'custom');
    expect(codeOf(tooMuch)).toBe('deposit_not_due');
    const due = tooMuch.ok ? 0 : (tooMuch.e.details?.dueMinor as number);
    expect(due).toBeGreaterThan(0);
    expect(codeOf(await cardCharge(desk, k, card.id, booking, due, 'incidentals'))).toBe('accepted');
    expect(codeOf(await cardCharge(desk, k, card.id, booking, 100))).toBe('deposit_not_due');
    expect((await paymentsOn(b.id)).map((p) => p.purpose)).toEqual(['deposit']);
    const folioId = await folioOfStay(org, k, b.stays[0]?.id as string, profileId);
    const folio = { type: 'folio' as const, id: folioId };
    expect(codeOf(await cardCharge(desk, k, card.id, folio, 1_000, 'custom'))).toBe('balance_not_owed');
    await owe(org, k, desk, b.stays[0]?.id as string, due + 50_000);
    // The deposit held for the booking will pay part of it: the card takes what it does not.
    const owedNow = (await balanceOf(org, folioId)) - due;
    expect(owedNow).toBe(50_000);
    expect(codeOf(await cardCharge(desk, k, card.id, folio, owedNow + 1, 'deposit'))).toBe(
      'balance_not_owed',
    );
    expect(codeOf(await cardCharge(desk, k, card.id, folio, owedNow, 'deposit'))).toBe('accepted');
    expect((await paymentsOn(folioId)).map((p) => p.purpose)).toEqual(['balance']);
  });
});

// ───────────────────────── R5-P1-2: coverage where money lands ─────────────────────────

describe('R5-P1-2 — card money keeps its agreement’s coverage wherever it is applied or moved', () => {
  it('PoC R5-D flipped (both orders): after add_stay, the booking-level deposit is refused; a deposit taken before is never applied to the added stay', async () => {
    const org = await organization(s);
    const k = await kandu(s, org, '2027-03-10');
    const { finance } = s.c.services;
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
    const v = await bookFor(org, k, desk, vera, '2027-06-10', '2027-06-12');
    await cardholderConfirms(s, org, card.id, v.id);
    // Reverse order: the deposit is taken while the booking has only Vera's stay (covered) ...
    expect(codeOf(await cardCharge(desk, k, card.id, { type: 'booking', id: v.id }, 10_000))).toBe(
      'accepted',
    );
    await s.drain();
    const ottoStay = await addStay(org, k, desk, v, otto);
    const ottoFolio = await folioOfStay(org, k, ottoStay, otto);
    const veraFolio = await folioOfStay(org, k, v.stays[0]?.id as string, vera);
    // ... flipped FINDING: once the booking changed, the booking-level reference is not covered.
    const viaBooking = await cardCharge(desk, k, card.id, { type: 'booking', id: v.id }, 10_000);
    expect(codeOf(viaBooking)).toBe('mandate_reference_not_covered');
    expect(viaBooking.ok ? '' : viaBooking.e.message).toMatch(/changed since/);
    // ... and the deposit taken before is not applied to Otto's added stay (nothing moves); Vera's own folio, yes.
    const toOtto = await settle(
      org.run(desk, (tx) =>
        finance.applyDeposits(tx, { bookingId: v.id, toFolioId: ottoFolio, idempotencyKey: newId() }),
      ),
    );
    expect(codeOf(toOtto)).toBe('deposit_not_covered_by_card_consent');
    expect(await balanceOf(org, ottoFolio)).toBe(0);
    const toVera = await org.run(desk, (tx) =>
      finance.applyDeposits(tx, { bookingId: v.id, toFolioId: veraFolio, idempotencyKey: newId() }),
    );
    expect(toVera.applied.amountMinor).toBe(10_000);
    // Vera confirms the booking as it is now: the booking-level reference is covered again.
    await cardholderConfirms(s, org, card.id, v.id);
    expect(codeOf(await cardCharge(desk, k, card.id, { type: 'booking', id: v.id }, 1_000))).toBe('accepted');
  });

  it('sibling (folio transfer, both orders): card money is not moved onto another guest’s folio, nor another guest’s charges onto it; moved first, the card is refused', async () => {
    const org = await organization(s);
    const k = await kandu(s, org, '2027-03-10');
    const { finance } = s.c.services;
    const desk = org.staff('front_desk', 'Hassan', [k.id]);
    const gm = org.staff('general_manager', 'GM', [k.id]);
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
    const v1 = await bookFor(org, k, desk, vera, '2027-06-10', '2027-06-12');
    const v2 = await bookFor(org, k, desk, vera, '2027-06-20', '2027-06-22');
    const y = await bookFor(org, k, desk, otto, '2027-06-10', '2027-06-12');
    await cardholderConfirms(s, org, card.id, v1.id);
    await cardholderConfirms(s, org, card.id, v2.id);
    const f1 = await folioOfStay(org, k, v1.stays[0]?.id as string, vera);
    const f2 = await folioOfStay(org, k, v2.stays[0]?.id as string, vera);
    const fy = await folioOfStay(org, k, y.stays[0]?.id as string, otto);
    await owe(org, k, desk, v1.stays[0]?.id as string, 50_000, 'Vera dinner');
    await owe(org, k, desk, y.stays[0]?.id as string, 40_000, 'Otto spa');
    await owe(org, k, desk, y.stays[0]?.id as string, 30_000, 'Otto boat');
    expect(codeOf(await cardCharge(desk, k, card.id, { type: 'folio', id: f1 }, 50_000))).toBe('accepted');
    await s.drain();
    const postingOf = async (folioId: string, kind: string, description?: string) =>
      (
        await sql<{
          id: string;
        }>`select id from finance.postings where folio_id = ${folioId} and kind = ${kind}
          ${description ? sql`and description = ${description}` : sql``} order by created_at`.execute(
          s.t.admin.kysely,
        )
      ).rows[0]?.id as string;
    const transfer = (from: string, to: string, postingId: string) =>
      settle(
        org.run(gm, (tx) =>
          finance.transferPostings(tx, {
            fromFolioId: from,
            toFolioId: to,
            items: [{ postingId }],
            reason: 'Guest asked',
            idempotencyKey: newId(),
          }),
        ),
      );
    // Money onto an uncovered folio: Vera's card payment moved to Otto's folio — refused.
    expect(codeOf(await transfer(f1, fy, await postingOf(f1, 'payment')))).toBe(
      'transfer_not_covered_by_card_consent',
    );
    // Debt onto a folio holding card money: Otto's charge moved to Vera's paid folio — refused.
    expect(codeOf(await transfer(fy, f1, await postingOf(fy, 'charge', 'Otto spa')))).toBe(
      'transfer_not_covered_by_card_consent',
    );
    // Reverse order: Otto's charge moved first onto Vera's other folio (no card money there yet) ...
    expect(codeOf(await transfer(fy, f2, await postingOf(fy, 'charge', 'Otto boat')))).toBe('accepted');
    // ... then Vera's card is refused for that folio: it carries another stay's charges.
    const after = await cardCharge(desk, k, card.id, { type: 'folio', id: f2 }, 1_000);
    expect(codeOf(after)).toBe('mandate_reference_not_covered');
    expect(after.ok ? '' : after.e.message).toMatch(/charges of another stay/);
    // A charge of Vera's own covered stay moved onto her other folio is fine.
    await owe(org, k, desk, v1.stays[0]?.id as string, 20_000, 'Vera bar');
    expect(codeOf(await transfer(f1, f2, await postingOf(f1, 'charge', 'Vera bar')))).toBe('accepted');
  });

  it('sibling (routing, both orders): a rule routing another stay to a folio with card money is refused; routed first, the card is refused', async () => {
    const org = await organization(s);
    const k = await kandu(s, org, '2027-03-10');
    const { finance } = s.c.services;
    const desk = org.staff('front_desk', 'Hassan', [k.id]);
    const gm = org.staff('general_manager', 'GM', [k.id]);
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
    const v1 = await bookFor(org, k, desk, vera, '2027-06-10', '2027-06-12');
    const v2 = await bookFor(org, k, desk, vera, '2027-06-20', '2027-06-22');
    const y = await bookFor(org, k, desk, otto, '2027-06-10', '2027-06-12');
    await cardholderConfirms(s, org, card.id, v1.id);
    await cardholderConfirms(s, org, card.id, v2.id);
    await folioOfStay(org, k, y.stays[0]?.id as string, otto);
    const f1 = await folioOfStay(org, k, v1.stays[0]?.id as string, vera);
    const f2 = await folioOfStay(org, k, v2.stays[0]?.id as string, vera);
    await owe(org, k, desk, v1.stays[0]?.id as string, 50_000);
    expect(codeOf(await cardCharge(desk, k, card.id, { type: 'folio', id: f1 }, 50_000))).toBe('accepted');
    await s.drain();
    const route = (destinationFolioId: string) =>
      settle(
        org.run(gm, (tx) =>
          finance.createBillingRule(tx, {
            propertyId: k.id,
            owner: { type: 'stay', id: y.stays[0]?.id as string },
            destinationFolioId,
            label: 'Otto’s extras to Vera',
            selector: { chargeGroups: ['misc'] },
          }),
        ),
      );
    expect(codeOf(await route(f1))).toBe('routing_not_covered_by_card_consent');
    expect(codeOf(await route(f2))).toBe('accepted');
    await owe(org, k, desk, v2.stays[0]?.id as string, 10_000, 'Vera minibar');
    expect(codeOf(await cardCharge(desk, k, card.id, { type: 'folio', id: f2 }, 1_000))).toBe(
      'mandate_reference_not_covered',
    );
  });

  it('the post-lock re-check: a transfer of another stay’s charges that commits while the card charge waits for the lock is seen', async () => {
    const org = await organization(s);
    const k = await kandu(s, org, '2027-03-10');
    const { finance } = s.c.services;
    const desk = org.staff('front_desk', 'Hassan', [k.id]);
    const gm = org.staff('general_manager', 'GM', [k.id]);
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
    const v = await bookFor(org, k, desk, vera, '2027-06-10', '2027-06-12');
    const y = await bookFor(org, k, desk, otto, '2027-06-10', '2027-06-12');
    await cardholderConfirms(s, org, card.id, v.id);
    const fv = await folioOfStay(org, k, v.stays[0]?.id as string, vera);
    const fy = await folioOfStay(org, k, y.stays[0]?.id as string, otto);
    await owe(org, k, desk, v.stays[0]?.id as string, 50_000, 'Vera dinner');
    await owe(org, k, desk, y.stays[0]?.id as string, 40_000, 'Otto spa');
    const ottoCharge = (
      await sql<{
        id: string;
      }>`select id from finance.postings where folio_id = ${fy} and kind = 'charge'`.execute(s.t.admin.kysely)
    ).rows[0]?.id as string;
    const entered = gate();
    const release = gate();
    const holder = org.run(gm, async (tx) => {
      await finance.transferPostings(tx, {
        fromFolioId: fy,
        toFolioId: fv,
        items: [{ postingId: ottoCharge }],
        reason: 'Guest asked',
        idempotencyKey: newId(),
      });
      entered.open();
      await release.p;
    });
    await entered.p;
    let done = false;
    const competitor = cardCharge(desk, k, card.id, { type: 'folio', id: fv }, 30_000).then((r) => {
      done = true;
      return r;
    });
    await sleep(400);
    const waited = !done;
    release.open();
    await holder;
    expect({ waited, outcome: codeOf(await competitor) }).toEqual({
      waited: true,
      outcome: 'mandate_reference_not_covered',
    });
    expect(await paymentsOn(fv)).toEqual([]);
  });
});

// ───────────────────────── R5-P2-1 / R5-P2-2 ─────────────────────────

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
  await reservations.performWorkflow(s.t.db, desk, {
    stayId: stay.id,
    kind: 'check_in',
    checkIn: { registration: { identityVerified: true }, access: { kind: 'card', count: 1 } },
  });
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
  return { desk, manager, folioOf, late };
}

describe('R5-P2-1 — staff never clear a link the provider reported as paid; finance confirms a dead link only when due', () => {
  it('PoC R5-C flipped: neither the desk nor finance can mark a `completed` link stopped; the replacement waits for the payment, the guest pays once', async () => {
    const org = await organization(s);
    const k = await kandu(s, org, '2027-03-10');
    const { payments } = s.c.services;
    const { folioOf, late, manager, desk } = await departed(org, k);
    await late(20_000, 'Dinner');
    await s.drain();
    const folio = await folioOf();
    const [first] = await requestsOn(folio?.id as string);
    await payments.ensurePaymentLink(manager, first?.id as string);
    await payments.simulateRequestPayment(manager, first?.id as string); // paid at the provider, webhook not yet here
    await late(10_000, 'Spa');
    await s.drain();
    const waiting = await linkStates(folio?.id as string);
    expect(waiting.find((r) => r.id === first?.id)?.link_status).toBe('completed');
    const version = (await requestsOn(folio?.id as string)).find((r) => r.id === first?.id)
      ?.version as number;
    const confirm = (ctx: RequestContext) =>
      settle(
        org.run(ctx, (tx) =>
          payments.tx.confirmLinkStopped(tx, {
            requestId: first?.id as string,
            reason: 'Stopped it',
            expectedVersion: version,
          }),
        ),
      );
    const byDesk = await confirm(desk);
    expect(byDesk.ok ? 'confirmed' : byDesk.e.status).toBe(403);
    const finance = org.staff('finance', 'Accounts', [k.id]);
    expect(codeOf(await confirm(finance))).toBe('link_reported_paid');
    expect((await linkStates(folio?.id as string)).find((r) => r.status === 'open')).toMatchObject({
      link_status: 'pending',
      link_url: null,
    });
    // The provider's payment arrives: recorded, the old link accounted for, the replacement asks only for the rest.
    await payments.deliverSimulatorWebhooks(manager, await simAccount(org, k.legalEntityId));
    await s.drain();
    const owed = (await folioOf())?.balance.amountMinor as number;
    const open = (await linkStates(folio?.id as string)).find((r) => r.status === 'open');
    expect(open?.amount_minor).toBe(owed);
    await payments.simulateRequestPayment(manager, open?.id as string);
    await payments.deliverSimulatorWebhooks(manager, await simAccount(org, k.legalEntityId));
    await s.drain();
    expect((await folioOf())?.balance.amountMinor).toBe(0);
    expect((await payExceptions(org)).filter((e) => e.kind === 'payment_request_overpaid')).toEqual([]);
  });

  it('sibling: a deactivating link is confirmed only once its exception is open, and only at the version seen', async () => {
    const org = await organization(s);
    const k = await kandu(s, org, '2027-03-10');
    const { payments } = s.c.services;
    const { folioOf, late, manager } = await departed(org, k);
    await late(20_000, 'Dinner');
    await s.drain();
    const folio = await folioOf();
    const [first] = await requestsOn(folio?.id as string);
    await payments.ensurePaymentLink(manager, first?.id as string);
    const account = await simAccount(org, k.legalEntityId);
    await org.run(org.setup, (tx) => payments.tx.setSimulatorControls(tx, account, { outage: 'timeout' }));
    await late(10_000, 'Spa');
    await s.drain();
    const finance = org.staff('finance', 'Accounts', [k.id]);
    const now = () => requestsOn(folio?.id as string).then((rs) => rs.find((r) => r.id === first?.id));
    const confirm = async (expectedVersion: number) =>
      settle(
        org.run(finance, (tx) =>
          payments.tx.confirmLinkStopped(tx, {
            requestId: first?.id as string,
            reason: 'Stopped it',
            expectedVersion,
          }),
        ),
      );
    expect((await linkStates(folio?.id as string)).find((r) => r.id === first?.id)?.link_status).toBe(
      'deactivating',
    );
    expect(codeOf(await confirm((await now())?.version as number))).toBe('link_stop_not_due');
    const t0 = s.clock.now();
    try {
      s.clock.advance(40 * 60_000);
      await payments.runReconciliation(org.setup, { propertyId: k.id });
      expect(codeOf(await confirm(((await now())?.version as number) - 1))).toBe('version_conflict');
      expect(codeOf(await confirm((await now())?.version as number))).toBe('accepted');
    } finally {
      s.clock.set(t0);
      await org.run(org.setup, (tx) => payments.tx.setSimulatorControls(tx, account, { outage: null }));
    }
  });
});

describe('R5-P2-2 — an uncertain charge or hold counts against the agreement (reviewer mutant: drop pending_verification)', () => {
  it('CLEAN R5-M (taken): a charge whose outcome is unknown still counts', async () => {
    const org = await organization(s);
    const k = await kandu(s, org, '2027-03-10');
    const desk = org.staff('front_desk', 'Hassan', [k.id]);
    const { profileId } = await guestWithCard(s, org, k);
    const b1 = await bookFor(org, k, desk, profileId, '2027-04-10', '2027-04-11');
    const b2 = await bookFor(org, k, desk, profileId, '2027-04-20', '2027-04-21');
    const card = await methodFor(
      org,
      k,
      { type: 'guest_profile', id: profileId },
      { purposes: ['deposit'], maxAmount: usd(10_000), bookingIds: [b1.id, b2.id] },
      'sim_timeout_then_succeeded',
    );
    const first = await cardCharge(desk, k, card.id, { type: 'booking', id: b1.id }, 10_000, 'deposit');
    expect(first.ok).toBe(true);
    expect((await paymentsOn(b1.id)).map((p) => p.status)).toEqual(['pending_verification']);
    expect(
      codeOf(await cardCharge(desk, k, card.id, { type: 'booking', id: b2.id }, 10_000, 'deposit')),
    ).toBe('mandate_amount_exceeded');
  });

  it('sibling (held): a hold whose outcome is unknown still counts', async () => {
    const org = await organization(s);
    const k = await kandu(s, org, '2027-03-10');
    const { payments } = s.c.services;
    const desk = org.staff('front_desk', 'Hassan', [k.id]);
    const { profileId } = await guestWithCard(s, org, k);
    const b1 = await bookFor(org, k, desk, profileId, '2027-04-10', '2027-04-11');
    const b2 = await bookFor(org, k, desk, profileId, '2027-04-20', '2027-04-21');
    const card = await methodFor(
      org,
      k,
      { type: 'guest_profile', id: profileId },
      { purposes: ['guarantee'], maxAmount: usd(10_000), bookingIds: [b1.id, b2.id] },
      'sim_timeout_then_succeeded',
    );
    const hold = (bookingId: string) =>
      settle(
        org.run(desk, (tx) =>
          payments.tx.authorize(tx, {
            propertyId: k.id,
            methodId: card.id,
            amount: usd(10_000),
            ref: { type: 'booking', id: bookingId },
            businessKey: newId(),
          }),
        ),
      );
    const h1 = await hold(b1.id);
    expect(h1.ok).toBe(true);
    await payments.settle(desk, { type: 'authorization', id: h1.ok ? h1.v.id : '' });
    const status = (
      await sql<{
        status: string;
      }>`select status from payments.authorizations where id = ${h1.ok ? h1.v.id : ''}`.execute(
        s.t.admin.kysely,
      )
    ).rows[0]?.status;
    expect(status).toBe('pending_verification');
    expect(codeOf(await hold(b2.id))).toBe('mandate_amount_exceeded');
  });
});

// ───────────────────────── R5-P3-3 / R5-P3-4 ─────────────────────────

describe('R5-P3-3 — a partial payment before "already paid" is not the payment the provider reported', () => {
  it('the replacement waits until the link’s whole amount is recorded, then asks only for the rest', async () => {
    const org = await organization(s);
    const k = await kandu(s, org, '2027-03-10');
    const { payments } = s.c.services;
    const { folioOf, late, manager } = await departed(org, k);
    await late(20_000, 'Dinner');
    await s.drain();
    const folio = await folioOf();
    const [first] = await requestsOn(folio?.id as string);
    await payments.ensurePaymentLink(manager, first?.id as string);
    const account = await simAccount(org, k.legalEntityId);
    // A part is paid and recorded; the rest is paid at the provider (the link completes), its webhook not yet here.
    await payments.simulateRequestPayment(manager, first?.id as string, 5_000);
    await payments.deliverSimulatorWebhooks(manager, account);
    await s.drain();
    await payments.simulateRequestPayment(manager, first?.id as string);
    await late(10_000, 'Spa');
    await s.drain();
    const states = await linkStates(folio?.id as string);
    expect(states.find((r) => r.id === first?.id)?.link_status).toBe('completed');
    expect(states.find((r) => r.status === 'open')).toMatchObject({ link_status: 'pending', link_url: null });
    await payments.deliverSimulatorWebhooks(manager, account);
    await s.drain();
    const owed = (await folioOf())?.balance.amountMinor as number;
    const after = await linkStates(folio?.id as string);
    expect(after.find((r) => r.id === first?.id)?.link_status).toBe('deactivated');
    expect(after.filter((r) => r.status === 'open').map((r) => r.amount_minor)).toEqual([owed]);
  });
});

describe('R5-P3-4 — applyDeposits takes the collection lock BEFORE the deposit account (deterministic)', () => {
  it('while another transaction holds the collection lock, applyDeposits waits without holding the deposit account', async () => {
    const org = await organization(s);
    const k = await kandu(s, org, '2027-03-10');
    const { finance, payments } = s.c.services;
    const desk = org.staff('front_desk', 'Hassan', [k.id]);
    const { profileId } = await guestWithCard(s, org, k);
    const b = await bookFor(org, k, desk, profileId, '2027-05-01', '2027-05-03');
    const folioId = await folioOfStay(org, k, b.stays[0]?.id as string, profileId);
    await paidDepositLink(org, k, b.id, profileId, 10_000);
    const entered = gate();
    const release = gate();
    const holder = org.run(org.setup, async (tx) => {
      await payments.provider.lockCollections(tx, [{ type: 'folio', id: folioId }]);
      entered.open();
      await release.p;
    });
    await entered.p;
    let done = false;
    const applying = settle(
      org.run(desk, (tx) =>
        finance.applyDeposits(tx, { bookingId: b.id, toFolioId: folioId, idempotencyKey: newId() }),
      ),
    ).then((r) => {
      done = true;
      return r;
    });
    await sleep(400);
    // The deposit account row is free: applyDeposits is waiting on the collection lock, not holding the account.
    const probe = await settle(
      org.run(org.setup, (tx) =>
        sql`select id from finance.deposit_accounts where booking_id = ${b.id} for update nowait`.execute(
          tx.db,
        ),
      ),
    );
    const waited = !done;
    release.open();
    await holder;
    const applied = await applying;
    expect({ waited, probe: probe.ok ? 'free' : 'locked', applied: codeOf(applied) }).toEqual({
      waited: true,
      probe: 'free',
      applied: 'accepted',
    });
  });
});
