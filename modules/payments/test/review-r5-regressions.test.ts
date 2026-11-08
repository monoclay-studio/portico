/**
 * Re-review #5 (docs/orchestration/reviews/review-integration-step-5.md), payments-module parts — ADR-0015 Amendment 4:
 *  - rule 1: purposes are facts (a no-show fee only on a recorded penalty, a deposit up to the agreed schedule, a balance
 *    up to what the folio owes); evidence time and channel are the server's; guest ownership on the stable
 *    `cardholder_ref`, never an owner a merge rewrote (R5-P1-1, R5-P3-1, R5-P3-2);
 *  - rule 2: a folio whose debt comes from an uncovered stay is not covered (R5-P1-2);
 *  - rule 3: staff-recorded agreements carry an amount limit;
 *  - R5-P3-4: the card-row lock (M6) proven deterministically — the competing use starts inside the holder's window.
 * The API-level PoC flips are in apps/api/test/review-regressions-r5.test.ts.
 */
import { sql, withTenantTx } from '@portico/db';
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
    (e: unknown) => ({ ok: false as const, e: e as { code?: string; message?: string } }),
  );
const codeOf = (r: { ok: boolean; e?: { code?: string } }) => (r.ok ? 'accepted' : r.e?.code);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function gate() {
  let open: () => void = () => undefined;
  const p = new Promise<void>((r) => {
    open = r;
  });
  return { p, open };
}

const mandate = (org: Org, scope: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  termsVersion: 'T-2026-1',
  acceptedAt: h.clock.now().toISOString(),
  channel: 'front_desk',
  scope: { legalEntityId: org.legalEntityId, purposes: [...ALL_PURPOSES], ...scope },
  ...extra,
});
const saveCard = (
  org: Org,
  ctx: Org['ctx'],
  scope: Record<string, unknown>,
  extra: Record<string, unknown> = {},
) =>
  settle(
    withTenantTx(h.db, ctx, (tx) =>
      h.module.service.tx.createMethod(tx, {
        accountId: org.simAccountId,
        propertyId: org.propertyId,
        kind: 'card',
        providerToken: 'pm_card_visa',
        owner: { type: 'guest_profile', id: org.payerId },
        mitAgreement: true,
        mandate: mandate(org, scope, extra) as never,
      }),
    ),
  );
const charge = (
  org: Org,
  methodId: string,
  ref: { type: 'folio' | 'booking'; id: string },
  amountMinor: number,
  purpose?: string,
) =>
  settle(
    h.module.service.chargeNow(org.ctx, {
      propertyId: org.propertyId,
      methodId,
      amount: usd(amountMinor),
      ref,
      ...(purpose ? { purpose: purpose as 'no_show' } : {}),
      businessKey: newId(),
    }),
  );

describe('R5-P1-1 — purposes are facts, never labels', () => {
  it('no_show rests on a recorded penalty for the folio’s stay, and only up to what it still owes', async () => {
    const org = await setupOrg(h);
    const stay = newId();
    h.ledger.stays.set(stay, org.bookingId);
    const folio = newId();
    h.ledger.folioOwners.set(folio, { type: 'stay', id: stay });
    const saved = await saveCard(org, org.ctx, {
      purposes: ['guarantee', 'no_show'],
      maxAmount: usd(1_000_000),
      bookingIds: [org.bookingId],
    });
    const card = saved.ok ? saved.v.id : '';
    // No penalty recorded: the label gives nothing — the same money as a balance is not agreed either.
    expect(codeOf(await charge(org, card, { type: 'folio', id: folio }, 250_000, 'no_show'))).toBe(
      'no_show_not_recorded',
    );
    expect(codeOf(await charge(org, card, { type: 'folio', id: folio }, 250_000))).toBe(
      'mandate_purpose_not_covered',
    );
    // Not on the booking either: a no-show fee is collected on the stay's folio.
    expect(codeOf(await charge(org, card, { type: 'booking', id: org.bookingId }, 1_000, 'no_show'))).toBe(
      'no_show_not_recorded',
    );
    // The night audit records the no-show (reservations is the only writer of the fact).
    h.ledger.penalties.set(stay, [{ kind: 'no_show', amount: usd(40_000) }]);
    expect(codeOf(await charge(org, card, { type: 'folio', id: folio }, 40_001, 'no_show'))).toBe(
      'no_show_penalty_exceeded',
    );
    expect(codeOf(await charge(org, card, { type: 'folio', id: folio }, 30_000, 'no_show'))).toBe('accepted');
    expect(codeOf(await charge(org, card, { type: 'folio', id: folio }, 10_001, 'no_show'))).toBe(
      'no_show_penalty_exceeded',
    );
    expect(codeOf(await charge(org, card, { type: 'folio', id: folio }, 10_000, 'no_show'))).toBe('accepted');
    const stored = (
      await sql<{
        purpose: string;
        purpose_basis: string | null;
      }>`select purpose, purpose_basis from payments.payments
        where ref_id = ${folio} and status = 'succeeded'`.execute(h.t.admin.kysely)
    ).rows;
    expect(stored).toEqual([
      { purpose: 'no_show', purpose_basis: `penalty:${stay}` },
      { purpose: 'no_show', purpose_basis: `penalty:${stay}` },
    ]);
  });

  it('a deposit is taken only up to the agreed schedule; a balance only up to what the folio owes', async () => {
    const org = await setupOrg(h);
    const booking = newId();
    h.ledger.depositDue.set(booking, 30_000);
    const folio = newId();
    h.ledger.bookingOf.set(folio, booking);
    h.ledger.balances.set(folio, 20_000);
    const saved = await saveCard(org, org.ctx, { maxAmount: usd(1_000_000), bookingIds: [booking] });
    const card = saved.ok ? saved.v.id : '';
    // `custom` is display text: on a booking the money is its deposit, bounded by the schedule.
    expect(codeOf(await charge(org, card, { type: 'booking', id: booking }, 30_001, 'custom'))).toBe(
      'deposit_not_due',
    );
    expect(codeOf(await charge(org, card, { type: 'booking', id: booking }, 30_000, 'custom'))).toBe(
      'accepted',
    );
    expect(codeOf(await charge(org, card, { type: 'booking', id: booking }, 1))).toBe('deposit_not_due');
    expect(codeOf(await charge(org, card, { type: 'folio', id: folio }, 20_001, 'incidentals'))).toBe(
      'balance_not_owed',
    );
    expect(codeOf(await charge(org, card, { type: 'folio', id: folio }, 20_000, 'deposit'))).toBe('accepted');
    // The stored purposes are the derived ones, whatever the labels said.
    const rows = (
      await sql<{
        purpose: string;
      }>`select purpose from payments.payments where ref_id in (${booking}, ${folio})
        and status = 'succeeded' order by created_at`.execute(h.t.admin.kysely)
    ).rows;
    expect(rows.map((r) => r.purpose)).toEqual(['deposit', 'balance']);
  });

  it('a recorded payment labelled no_show without a recorded penalty is refused', async () => {
    const org = await setupOrg(h);
    const r = await settle(
      org.tx((tx) =>
        h.module.service.tx.recordPayment(tx, {
          propertyId: org.propertyId,
          method: 'cash',
          amount: usd(5_000),
          ref: { type: 'folio', id: newId() },
          reference: `R-${newId().slice(-6)}`,
          receivedAt: h.clock.now().toISOString(),
          purpose: 'no_show',
          businessKey: newId(),
        }),
      ),
    );
    expect(codeOf(r)).toBe('no_show_not_recorded');
  });
});

describe('R5-P1-2 — a folio carrying another stay’s debt is not covered', () => {
  it('charges moved or routed onto a named folio from an uncovered stay make it uncovered; covered origins do not', async () => {
    const org = await setupOrg(h);
    const mine = newId();
    h.ledger.stays.set(mine, org.bookingId);
    const saved = await saveCard(org, org.ctx, { maxAmount: usd(1_000_000), bookingIds: [org.bookingId] });
    const card = saved.ok ? saved.v.id : '';
    const folio = newId();
    h.ledger.debtOrigins.set(folio, [{ type: 'stay', id: mine }]);
    expect(codeOf(await charge(org, card, { type: 'folio', id: folio }, 1_000))).toBe('accepted');
    const stranger = newId();
    h.ledger.stays.set(stranger, newId());
    h.ledger.debtOrigins.set(folio, [
      { type: 'stay', id: mine },
      { type: 'stay', id: stranger },
    ]);
    const refused = await charge(org, card, { type: 'folio', id: folio }, 1_000);
    expect(codeOf(refused)).toBe('mandate_reference_not_covered');
    expect(refused.ok ? '' : refused.e.message).toMatch(/charges of another stay/);
    // The finance port asks the same question before it moves anything.
    const ask = (owners: Array<{ type: string; id: string }>) =>
      org.tx((tx) =>
        h.module.service.provider.cardMoneyMayMeet(tx, { sources: { folioIds: [folio] }, owners }),
      );
    expect((await ask([{ type: 'stay', id: mine }])).covered).toBe(true);
    expect((await ask([{ type: 'stay', id: stranger }])).covered).toBe(false);
  });
});

describe('Amendment 4 rule 3 and R5-P3-1 — staff agreements are capped; evidence is the server’s', () => {
  it('staff must state maxAmount and cannot claim the cardholder chose no limit; the cardholder can, explicitly', async () => {
    const org = await setupOrg(h);
    expect(codeOf(await saveCard(org, org.ctx, { bookingIds: [org.bookingId] }))).toBe(
      'mandate_limit_required',
    );
    expect(
      codeOf(await saveCard(org, org.ctx, { bookingIds: [org.bookingId], noLimitChosenByCardholder: true })),
    ).toBe('mandate_limit_required');
    expect(
      codeOf(
        await saveCard(org, org.ctx, {
          maxAmount: usd(10_000),
          bookingIds: [org.bookingId],
          noLimitChosenByCardholder: true,
        }),
      ),
    ).toBe('mandate_no_limit_cardholder_only');
    const guest = {
      ...org.as(['payments.method.manage']),
      actor: { kind: 'guest' as const, guestProfileId: org.payerId },
    };
    expect(codeOf(await saveCard(org, guest, { bookingIds: [org.bookingId] }))).toBe(
      'mandate_limit_required',
    );
    const chosen = await saveCard(org, guest, {
      bookingIds: [org.bookingId],
      noLimitChosenByCardholder: true,
    });
    expect(codeOf(chosen)).toBe('accepted');
    const row = (
      await sql<{ mandate: Record<string, unknown> }>`select mandate from payments.payment_methods
        where id = ${chosen.ok ? chosen.v.id : ''}`.execute(h.t.admin.kysely)
    ).rows[0];
    expect(row?.mandate).toMatchObject({
      recordedBy: 'cardholder',
      scope: { noLimitChosenByCardholder: true },
    });
    expect((row?.mandate.scope as { noLimitChosenAt?: string }).noLimitChosenAt).toBe(
      h.clock.now().toISOString(),
    );
  });

  it('an agreement staff saved without a limit (before rule 3) is not used', async () => {
    const org = await setupOrg(h);
    const saved = await saveCard(org, org.ctx, { maxAmount: usd(10_000), bookingIds: [org.bookingId] });
    const card = saved.ok ? saved.v.id : '';
    await sql`update payments.payment_methods set mandate = jsonb_set(mandate, '{scope}', (mandate->'scope') - 'maxAmount')
      where id = ${card}`.execute(h.t.admin.kysely);
    expect(codeOf(await charge(org, card, { type: 'booking', id: org.bookingId }, 1_000))).toBe(
      'mandate_limit_missing',
    );
  });

  it('evidence time and channel are set by the server; the client’s channel is kept only as declared', async () => {
    const org = await setupOrg(h);
    const saved = await saveCard(
      org,
      org.ctx,
      { maxAmount: usd(10_000), bookingIds: [org.bookingId] },
      { channel: 'guest_self_service', acceptedAt: '2031-01-01T00:00:00.000Z' },
    );
    expect(codeOf(saved)).toBe('accepted');
    const row = (
      await sql<{ mandate: { scope: { bookingEvidence: Record<string, unknown> } } }>`select mandate
        from payments.payment_methods where id = ${saved.ok ? saved.v.id : ''}`.execute(h.t.admin.kysely)
    ).rows[0];
    expect(row?.mandate.scope.bookingEvidence[org.bookingId]).toEqual({
      at: h.clock.now().toISOString(),
      channel: 'staff_recorded',
      declaredChannel: 'guest_self_service',
      stayIds: [],
    });
  });
});

describe('R5-P3-2 — guest ownership is judged on the stable cardholder, not on an owner a merge rewrote', () => {
  it('after a profile merge rewrites the owner, the merged-in guest can neither confirm nor use the card', async () => {
    const org = await setupOrg(h);
    const svc = h.module.service;
    const guestP = {
      ...org.as(['payments.method.manage', 'payments.payment.collect']),
      actor: { kind: 'guest' as const, guestProfileId: org.payerId },
    };
    const own = await withTenantTx(h.db, guestP, (tx) =>
      svc.tx.createMethod(tx, {
        accountId: org.simAccountId,
        propertyId: org.propertyId,
        kind: 'card',
        providerToken: 'pm_card_visa',
        owner: { type: 'guest_profile', id: org.payerId },
        mitAgreement: true,
        mandate: mandate(org, { maxAmount: usd(10_000) }) as never,
      }),
    );
    const other = newId();
    // A staff merge (wrongly) makes the other profile the survivor: the card's owner is rewritten.
    await sql`update payments.payment_methods set owner_id = ${other} where id = ${own.id}`.execute(
      h.t.admin.kysely,
    );
    const guestQ = { ...guestP, actor: { kind: 'guest' as const, guestProfileId: other } };
    const confirm = await settle(
      withTenantTx(h.db, guestQ, (tx) =>
        svc.tx.confirmCardForBooking(tx, { methodId: own.id, bookingId: newId() }),
      ),
    );
    expect(confirm.ok ? 'confirmed' : (confirm.e as { status?: number }).status).toBe(403);
    const pay = await settle(
      svc.chargeNow(guestQ, {
        propertyId: org.propertyId,
        methodId: own.id,
        amount: usd(1_000),
        ref: { type: 'booking', id: org.bookingId },
        businessKey: newId(),
      }),
    );
    expect(codeOf(pay)).toBe('card_not_yours');
    // The cardholder who saved it still can.
    const mine = await settle(
      svc.chargeNow(guestP, {
        propertyId: org.propertyId,
        methodId: own.id,
        amount: usd(1_000),
        ref: { type: 'booking', id: org.bookingId },
        businessKey: newId(),
      }),
    );
    expect(codeOf(mine)).toBe('accepted');
  });
});

describe('R5-P3-4 — the card-row lock, proven with the competitor inside the holder’s window (M6)', () => {
  it('a second use of the card waits for the first to commit, then sees its total and is refused', async () => {
    const org = await setupOrg(h);
    const svc = h.module.service;
    const [b1, b2] = [newId(), newId()];
    const saved = await saveCard(org, org.ctx, { maxAmount: usd(10_000), bookingIds: [b1, b2] });
    const card = saved.ok ? saved.v.id : '';
    const entered = gate();
    const release = gate();
    const holder = org.tx(async (tx) => {
      const started = await svc.tx.charge(tx, {
        propertyId: org.propertyId,
        methodId: card,
        amount: usd(10_000),
        ref: { type: 'booking', id: b1 },
        businessKey: newId(),
      });
      entered.open();
      await release.p;
      return started;
    });
    await entered.p;
    let done = false;
    const competitor = charge(org, card, { type: 'booking', id: b2 }, 10_000).then((r) => {
      done = true;
      return r;
    });
    await sleep(400);
    const waited = !done;
    release.open();
    await holder;
    expect({ waited, outcome: codeOf(await competitor) }).toEqual({
      waited: true,
      outcome: 'mandate_amount_exceeded',
    });
  });
});
