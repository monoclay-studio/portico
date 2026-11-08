/**
 * Regression tests for re-review #7 (docs/orchestration/reviews/review-integration-step-7.md; ADR-0015 Amendment 6:
 * one balance per obligation; moved credits keep their counterpart's owner). Helpers as in the round-6 file, whose
 * header follows:
 *
 * Regression tests for re-review #6 (docs/orchestration/reviews/review-integration-step-6.md; ADR-0015 Amendment 5):
 * the purpose is judged where money lands; every posting has an owner; a no-show fee rests on the ledger penalty.
 * Helpers as in the round-5 file. Original header of the round-5 file:
 *
 * Regression tests for re-review #5 (docs/orchestration/reviews/review-integration-step-5.md; ADR-0015 Amendment 4).
 * Every FINDING PoC of integration-step-poc/r5-fix-attacks.test.ts.txt is flipped to assert the refusal; the class is
 * closed, not the path — each rule has a test per entry point that moves card money or the debt it may pay, the reverse
 * orders included, and the lock guards are proven with the competing writer INSIDE the holder's window.
 */
import { sql } from '@portico/db';
import { financeForReservations } from '@portico/finance';
import { newId, type RequestContext } from '@portico/kernel';
import type { Booking } from '@portico/reservations';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  applied,
  bookingInput,
  cardholderConfirms,
  guestWithCard,
  kandu,
  organization,
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
const _sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
type K = Awaited<ReturnType<typeof kandu>>;
const usd = (amountMinor: number) => ({ amountMinor, currency: 'USD' });
function _gate() {
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
const _requestsOn = async (refId: string) =>
  (
    await sql<{ id: string; amount_minor: number; paid_minor: number; status: string; version: number }>`
      select id, amount_minor::int, paid_minor::int, status, version from payments.payment_requests
       where ref_id = ${refId} order by created_at`.execute(s.t.admin.kysely)
  ).rows;
const _paymentsOn = async (refId: string) =>
  (
    await sql<{ amount_minor: number; status: string; purpose: string }>`
      select amount_minor::int, status, purpose from payments.payments where ref_id = ${refId}
       order by created_at`.execute(s.t.admin.kysely)
  ).rows;
const _linkStates = async (refId: string) =>
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
const _payExceptions = async (org: ScenarioOrg) =>
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
async function _addStay(
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
const _paidDepositLink = async (
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

const penaltyPostingOf = async (stayId: string) =>
  (
    await sql<{ id: string; folio_id: string; amount_minor: number }>`
      select p.id, p.folio_id, p.amount_minor::int from finance.postings p
        join finance.journal_entries e on e.id = p.entry_id
       where e.idempotency_key in (${`penalty:no_show:${stayId}`}, ${`penalty:cancellation:${stayId}`})
         and p.kind = 'charge'`.execute(s.t.admin.kysely)
  ).rows[0];
const forfeitOf = (org: ScenarioOrg, ctx: RequestContext, bookingId: string, amountMinor: number) =>
  settle(
    org.run(ctx, (tx) =>
      s.c.services.finance.forfeitDeposit(tx, {
        bookingId,
        chargeCode: 'CXL',
        amountMinor,
        reason: 'Cancellation penalty',
        idempotencyKey: newId(),
      }),
    ),
  );
const heldOn = async (org: ScenarioOrg, bookingId: string) =>
  org.run(org.setup, (tx) => s.c.services.finance.depositHeldMinor(tx, bookingId));
const cardPaidOn = async (methodId: string) =>
  Number(
    (
      await sql<{
        n: string;
      }>`select coalesce(sum(amount_minor - refunded_minor), 0) as n from payments.payments
        where method_id = ${methodId} and status in ('processing', 'pending_verification', 'succeeded')`.execute(
        s.t.admin.kysely,
      )
    ).rows[0]?.n,
  );
async function cancelledWithCardDeposit(org: ScenarioOrg, k: K) {
  const { reservations } = s.c.services;
  const desk = org.staff('front_desk', 'Hassan', [k.id]);
  const gm = org.staff('general_manager', 'GM', [k.id]);
  const { profileId, card } = await guestWithCard(s, org, k);
  const b = await bookFor(org, k, desk, profileId, '2027-03-20', '2027-03-22');
  const stayId = b.stays[0]?.id as string;
  const folioId = await folioOfStay(org, k, stayId, profileId);
  await cardholderConfirms(s, org, card.id, b.id);
  expect(codeOf(await cardCharge(desk, k, card.id, { type: 'booking', id: b.id }, 10_000))).toBe('accepted');
  await s.drain();
  const preview = await org.run(gm, (tx) =>
    reservations.previewChange(tx, { kind: 'cancel_stay', stayId } as never),
  );
  await reservations.commitChangeSafely(s.t.db, gm, { previewToken: preview.token });
  await s.drain();
  const pen = await penaltyPostingOf(stayId);
  return { desk, gm, card, b, stayId, folioId, penaltyPostingId: pen?.id as string };
}

describe('R7-P1-1 — a penalty is one balance: forfeit, card and credit all draw it down', () => {
  it('PoC R7-F1 flipped: the deposit forfeited for the penalty settles part of it; the card then pays only the rest', async () => {
    const org = await organization(s);
    const k = await kandu(s, org, '2027-03-10');
    const x = await cancelledWithCardDeposit(org, k);
    const penalty = await balanceOf(org, x.folioId);
    expect(penalty).toBeGreaterThanOrEqual(10_000);
    expect(codeOf(await forfeitOf(org, x.gm, x.b.id, 10_000))).toBe('accepted');
    expect(await heldOn(org, x.b.id)).toBe(0);
    expect(await balanceOf(org, x.folioId)).toBe(penalty - 10_000); // the forfeit settled that much of the penalty
    const folio = { type: 'folio' as const, id: x.folioId };
    expect(codeOf(await cardCharge(x.desk, k, x.card.id, folio, penalty, 'no_show'))).toBe(
      'no_show_penalty_exceeded',
    );
    expect(codeOf(await cardCharge(x.desk, k, x.card.id, folio, penalty - 10_000, 'no_show'))).toBe(
      'accepted',
    );
    expect(await cardPaidOn(x.card.id)).toBe(penalty); // one penalty, paid once
  });

  it('PoC R7-F2 flipped (reverse order): the penalty charged to the card first; a forfeit then keeps only what is still owed', async () => {
    const org = await organization(s);
    const k = await kandu(s, org, '2027-03-10');
    const x = await cancelledWithCardDeposit(org, k);
    const penalty = await balanceOf(org, x.folioId);
    const left = penalty - (await heldOn(org, x.b.id));
    const folio = { type: 'folio' as const, id: x.folioId };
    expect(codeOf(await cardCharge(x.desk, k, x.card.id, folio, left, 'no_show'))).toBe('accepted');
    await s.drain();
    expect(codeOf(await forfeitOf(org, x.gm, x.b.id, 10_001))).toBe('forfeit_exceeds_penalty_owed');
    expect(codeOf(await forfeitOf(org, x.gm, x.b.id, 10_000))).toBe('accepted');
    expect(await balanceOf(org, x.folioId)).toBe(0);
    expect(await cardPaidOn(x.card.id)).toBe(penalty);
    // A second forfeit for the same penalty finds nothing owed.
    expect(codeOf(await forfeitOf(org, x.gm, x.b.id, 1))).not.toBe('accepted');
  });

  it('PoC R7-F3 flipped: the penalty credited off in full — the card-funded deposit is not forfeited', async () => {
    const org = await organization(s);
    const k = await kandu(s, org, '2027-03-10');
    const x = await cancelledWithCardDeposit(org, k);
    await org.run(x.gm, (tx) =>
      s.c.services.finance.adjustPosting(tx, {
        postingId: x.penaltyPostingId,
        reasonCode: 'goodwill',
        note: 'Penalty waived as goodwill',
        idempotencyKey: newId(),
      }),
    );
    expect(await balanceOf(org, x.folioId)).toBe(0);
    expect(codeOf(await forfeitOf(org, x.gm, x.b.id, 10_000))).toBe('forfeit_not_covered_by_card_consent');
    expect(await heldOn(org, x.b.id)).toBe(10_000);
  });
});

describe('R7-P2-1 / R7-P2-2 — the no-show limit is the penalty still owed on the ledger, net of every method', () => {
  async function noShowFolio(org: ScenarioOrg, k: K) {
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
    const noShow = await org.run(auditor, (tx) =>
      reservations.markNoShow(tx, { stayId, idempotencyKey: newId() }),
    );
    await s.drain();
    return {
      desk,
      b,
      stayId,
      folioId,
      card,
      profileId,
      penaltyPostingId: noShow.penaltyPostingIds[0] as string,
    };
  }

  it('PoC R7-N1 flipped: a penalty partly paid by cheque leaves only the rest; fully paid, an ordinary bill is not taken as no_show', async () => {
    const org = await organization(s);
    const k = await kandu(s, org, '2027-03-10');
    const x = await noShowFolio(org, k);
    const penalty = await balanceOf(org, x.folioId);
    const cheque = (amountMinor: number) =>
      org.run(x.desk, (tx) =>
        s.c.services.finance.collectPayment(tx, {
          folioId: x.folioId,
          tenders: [{ method: 'cheque', amount: usd(amountMinor), reference: `CHQ-${newId().slice(-6)}` }],
          idempotencyKey: newId(),
        }),
      );
    const half = Math.floor(penalty / 2);
    await cheque(half);
    const folio = { type: 'folio' as const, id: x.folioId };
    expect(codeOf(await cardCharge(x.desk, k, x.card.id, folio, penalty - half + 1, 'no_show'))).toBe(
      'no_show_penalty_exceeded',
    );
    await cheque(penalty - half);
    await owe(org, k, x.desk, x.stayId, penalty, 'Minibar and laundry');
    expect(codeOf(await cardCharge(x.desk, k, x.card.id, folio, penalty, 'no_show'))).toBe(
      'no_show_penalty_exceeded',
    );
    expect(codeOf(await cardCharge(x.desk, k, x.card.id, folio, 100, 'no_show'))).toBe(
      'no_show_penalty_exceeded',
    );
  });

  it('CLEAN R7-N2 adopted (kills M7): the penalty moved to the master folio no longer justifies a no_show on the stay folio — and counts where it went', async () => {
    const org = await organization(s);
    const k = await kandu(s, org, '2027-03-10');
    const { finance } = s.c.services;
    const gm = org.staff('general_manager', 'GM', [k.id]);
    const x = await noShowFolio(org, k);
    const penalty = await balanceOf(org, x.folioId);
    const master = (
      await org.run(org.setup, (tx) =>
        financeForReservations(finance).openFolio(tx, {
          propertyId: k.id,
          owner: { type: 'booking', id: x.b.id },
          payer: { type: 'profile', id: x.profileId },
        }),
      )
    ).folioId;
    const t = await settle(
      org.run(gm, (tx) =>
        finance.transferPostings(tx, {
          fromFolioId: x.folioId,
          toFolioId: master,
          items: [{ postingId: x.penaltyPostingId }],
          reason: 'Company pays the no-show',
          idempotencyKey: newId(),
        }),
      ),
    );
    expect(codeOf(t)).toBe('accepted');
    await owe(org, k, x.desk, x.stayId, penalty, 'Minibar and laundry');
    expect(
      codeOf(await cardCharge(x.desk, k, x.card.id, { type: 'folio', id: x.folioId }, penalty, 'no_show')),
    ).toBe('no_show_penalty_exceeded');
    // Mirror: on the folio it moved to, the penalty is owed (the booking-level master folio of the named booking).
    const onMaster = await balanceOf(org, master);
    expect(onMaster).toBeGreaterThan(0);
  });
});

describe('R7-P1-2 — a credit moved off a folio leaves a debit owned by whoever it now benefits', () => {
  async function chequeOnOtto(org: ScenarioOrg, k: K, sameBooking = false) {
    const { finance, reservations } = s.c.services;
    const desk = org.staff('front_desk', 'Hassan', [k.id]);
    const gm = org.staff('general_manager', 'GM', [k.id]);
    const { profileId: vera } = await guestWithCard(s, org, k, { firstName: 'Vera', lastName: 'Visitor' });
    const { profileId: otto, card } = await guestWithCard(
      s,
      org,
      k,
      { firstName: 'Otto', lastName: 'Owner' },
      'pm_card_mastercard',
    );
    const y = await bookFor(org, k, desk, otto, '2027-06-10', '2027-06-12');
    let otherStay: string;
    if (sameBooking) {
      const extra = bookingInput(k, {
        arrival: '2027-06-10',
        departure: '2027-06-12',
        type: 'WV',
        guestProfileId: vera,
      }).stays[0];
      const preview = await org.run(desk, (tx) =>
        reservations.previewChange(tx, { kind: 'add_stay', bookingId: y.id, stay: extra } as never),
      );
      await reservations.commitChangeSafely(s.t.db, desk, { previewToken: preview.token });
      const now = await org.run(desk, (tx) => reservations.getBooking(tx, y.id));
      otherStay = now.stays.find((x) => x.id !== y.stays[0]?.id)?.id as string;
    } else {
      const v = await bookFor(org, k, desk, vera, '2027-06-10', '2027-06-12');
      otherStay = v.stays[0]?.id as string;
    }
    await cardholderConfirms(s, org, card.id, y.id); // covers every stay of Otto's booking as it is now
    const fv = await folioOfStay(org, k, otherStay, vera);
    const fy = await folioOfStay(org, k, y.stays[0]?.id as string, otto);
    await owe(org, k, desk, otherStay, 30_000, 'Vera minibar');
    await owe(org, k, desk, y.stays[0]?.id as string, 30_000, 'Otto spa');
    await org.run(desk, (tx) =>
      finance.collectPayment(tx, {
        folioId: fy,
        tenders: [{ method: 'cheque', amount: usd(30_000), reference: `CHQ-${newId().slice(-6)}` }],
        idempotencyKey: newId(),
      }),
    );
    const cheque = (
      await sql<{
        id: string;
      }>`select id from finance.postings where folio_id = ${fy} and kind = 'payment'`.execute(
        s.t.admin.kysely,
      )
    ).rows[0]?.id as string;
    const move = (from: string, to: string, postingId: string) =>
      settle(
        org.run(gm, (tx) =>
          finance.transferPostings(tx, {
            fromFolioId: from,
            toFolioId: to,
            items: [{ postingId }],
            reason: 'Posted to the wrong folio',
            idempotencyKey: newId(),
          }),
        ),
      );
    return { desk, card, fv, fy, cheque, move };
  }

  it('PoC R7-M1 flipped (move first): Otto’s cheque moved to Vera — Otto’s card does not refill it', async () => {
    const org = await organization(s);
    const k = await kandu(s, org, '2027-03-10');
    const x = await chequeOnOtto(org, k);
    expect(codeOf(await x.move(x.fy, x.fv, x.cheque))).toBe('accepted');
    expect(await balanceOf(org, x.fy)).toBe(30_000);
    const r = await cardCharge(x.desk, k, x.card.id, { type: 'folio', id: x.fy }, 30_000, 'balance');
    expect(codeOf(r)).toBe('mandate_reference_not_covered'); // flipped FINDING
  });

  it('sibling (card first): with Otto’s card money on his folio, his cheque is not moved off to Vera', async () => {
    const org = await organization(s);
    const k = await kandu(s, org, '2027-03-10');
    const x = await chequeOnOtto(org, k);
    await owe(
      org,
      k,
      x.desk,
      (
        await sql<{ owner_id: string }>`select owner_id from finance.folios where id = ${x.fy}`.execute(
          s.t.admin.kysely,
        )
      ).rows[0]?.owner_id as string,
      20_000,
      'Otto dinner',
    );
    expect(
      codeOf(await cardCharge(x.desk, k, x.card.id, { type: 'folio', id: x.fy }, 20_000, 'balance')),
    ).toBe('accepted');
    await s.drain();
    expect(codeOf(await x.move(x.fy, x.fv, x.cheque))).toBe('transfer_not_covered_by_card_consent');
  });

  it('boundaries: a cheque moved to a folio of the same covered booking is fine; moved off and back nets out', async () => {
    const org = await organization(s);
    const k = await kandu(s, org, '2027-03-10');
    const same = await chequeOnOtto(org, k, true);
    expect(codeOf(await same.move(same.fy, same.fv, same.cheque))).toBe('accepted');
    expect(
      codeOf(await cardCharge(same.desk, k, same.card.id, { type: 'folio', id: same.fy }, 30_000, 'balance')),
    ).toBe('accepted');
    const org2 = await organization(s);
    const k2 = await kandu(s, org2, '2027-03-10');
    const back = await chequeOnOtto(org2, k2);
    expect(codeOf(await back.move(back.fy, back.fv, back.cheque))).toBe('accepted');
    const arrived = (
      await sql<{
        id: string;
      }>`select id from finance.postings where folio_id = ${back.fv} and kind = 'transfer_in'`.execute(
        s.t.admin.kysely,
      )
    ).rows[0]?.id as string;
    expect(codeOf(await back.move(back.fv, back.fy, arrived))).toBe('accepted');
    await owe(
      org2,
      k2,
      back.desk,
      (
        await sql<{ owner_id: string }>`select owner_id from finance.folios where id = ${back.fy}`.execute(
          s.t.admin.kysely,
        )
      ).rows[0]?.owner_id as string,
      10_000,
      'Otto bar',
    );
    expect(
      codeOf(
        await cardCharge(back.desk, k2, back.card.id, { type: 'folio', id: back.fy }, 10_000, 'balance'),
      ),
    ).toBe('accepted');
  });
});
