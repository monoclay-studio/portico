/**
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
const paymentsOn = async (refId: string) =>
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
const _balanceOf = async (org: ScenarioOrg, folioId: string) =>
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

// ───────────────────────── R6-P1-1: the purpose where money lands ─────────────────────────

describe('R6-P1-1 — consent is judged on the purpose of the money where it lands; a hold’s purpose never carries over', () => {
  it('PoC R6-A flipped: a balance refused as a charge is refused as hold + capture too; a no-show fee is captured from the guarantee hold only after the night audit', async () => {
    const org = await organization(s);
    const k = await kandu(s, org, '2027-03-10');
    const { payments, reservations } = s.c.services;
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
    await owe(org, k, desk, stayId, 250_000, 'Ordinary bill');
    const folio = { type: 'folio' as const, id: folioId };
    expect(codeOf(await cardCharge(desk, k, card.id, folio, 250_000, 'balance'))).toBe(
      'mandate_purpose_not_covered',
    );
    const hold = await settle(
      org.run(desk, (tx) =>
        payments.tx.authorize(tx, {
          propertyId: k.id,
          methodId: card.id,
          amount: usd(250_000),
          ref: folio,
          businessKey: newId(),
        }),
      ),
    );
    expect(codeOf(hold)).toBe('accepted'); // a guarantee hold is agreed
    const holdId = hold.ok ? hold.v.id : '';
    await payments.settle(desk, { type: 'authorization', id: holdId });
    const capture = (
      amountMinor?: number,
      purpose?: 'no_show' | 'deposit',
      ledgerRef?: { type: 'folio' | 'booking'; id: string },
    ) =>
      settle(
        org.run(desk, (tx) =>
          payments.tx.capture(tx, {
            authorizationId: holdId,
            ...(amountMinor ? { amount: usd(amountMinor) } : {}),
            ...(purpose ? { purpose } : {}),
            ...(ledgerRef ? { ledgerRef } : {}),
            businessKey: newId(),
          }),
        ),
      );
    expect(codeOf(await capture())).toBe('mandate_purpose_not_covered'); // flipped FINDING: lands as the balance
    expect(codeOf(await capture(10_000, undefined, { type: 'booking', id: b.id }))).toBe(
      'mandate_purpose_not_covered',
    ); // lands as a deposit
    expect(codeOf(await capture(10_000, 'no_show'))).toBe('no_show_not_recorded');
    expect(await paymentsOn(folioId)).toEqual([]);
    // After the night audit records the no-show, a guarantee hold pays the fee — as `no_show`, up to the penalty.
    await org.run(auditor, (tx) => reservations.markNoShow(tx, { stayId, idempotencyKey: newId() }));
    await s.drain();
    const hold2 = await settle(
      org.run(desk, (tx) =>
        payments.tx.authorize(tx, {
          propertyId: k.id,
          methodId: card.id,
          amount: usd(10_000),
          ref: folio,
          businessKey: newId(),
        }),
      ),
    );
    expect(codeOf(hold2)).toBe('accepted');
    await payments.settle(desk, { type: 'authorization', id: hold2.ok ? hold2.v.id : '' });
    const capture2 = (purpose?: 'no_show') =>
      settle(
        org.run(desk, (tx) =>
          payments.tx.capture(tx, {
            authorizationId: hold2.ok ? hold2.v.id : '',
            ...(purpose ? { purpose } : {}),
            businessKey: newId(),
          }),
        ),
      );
    expect(codeOf(await capture2())).toBe('mandate_purpose_not_covered');
    expect(codeOf(await capture2('no_show'))).toBe('accepted');
    expect((await paymentsOn(folioId)).map((p) => p.purpose)).toEqual(['no_show']);
  });
});
