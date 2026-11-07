/**
 * Regression tests for the focused re-review (docs/orchestration/reviews/review-integration-step-2.md). Every PoC in
 * integration-step-poc/r2-fix-attacks.test.ts.txt is flipped to assert the REFUSAL (or the corrected state), and each
 * fixed finding gets a test per SIBLING entry point (self-check v3 § 3 (b)) and per invariant writer (v4 § 5).
 */
import { sql } from '@portico/db';
import { financeForReservations } from '@portico/finance';
import { newId, type RequestContext, staticAuthorizer } from '@portico/kernel';
import { platform } from '@portico/platform';
import type { Booking } from '@portico/reservations';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  applied,
  bookingInput,
  bookWithCard,
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
    (e: unknown) => ({ ok: false as const, e }),
  );
const nightRole = (tenantId: string, environment: RequestContext['environment'], propertyId: string) => {
  const perms = [
    'platform.property.read',
    'reservations.booking.read',
    'reservations.stay.checkIn',
    'guests.profile.read',
    'guests.profile.update',
    'operations.unit.read',
    'inventory.unit.read',
  ];
  return {
    tenantId,
    environment,
    actor: { kind: 'user' as const, userId: newId(), displayName: 'Night receptionist' },
    authz: staticAuthorizer(perms.map((permission) => ({ permission, propertyIds: [propertyId] }))),
    correlationId: newId(),
  } satisfies RequestContext;
};
const holdsOn = async (refId: string) =>
  (
    await sql<{ method_id: string; amount_minor: number; status: string }>`
      select method_id, amount_minor::int, status from payments.authorizations where ref_id = ${refId}`.execute(
      s.t.admin.kysely,
    )
  ).rows;

/** The victim: a returning guest whose card is on file from their own earlier booking. */
async function victimWithCard(org: ScenarioOrg, k: Awaited<ReturnType<typeof kandu>>) {
  const desk = org.staff('front_desk', 'Hassan', [k.id]);
  const { profileId: victim, card } = await guestWithCard(s, org, k, {
    firstName: 'Vera',
    lastName: 'Victim',
  });
  const own = await bookWithCard(
    s,
    org,
    desk,
    bookingInput(
      k,
      {
        arrival: '2027-05-01',
        departure: '2027-05-03',
        guestProfileId: victim,
        guest: { firstName: 'Vera', lastName: 'Victim' },
      },
      { guarantee: { kind: 'card', paymentMethodId: card.id } },
    ),
  );
  return { victim, card, own };
}

describe('R2-P1-1 — whoever links the cardholder to a booking does not choose the card held at check-in', () => {
  for (const variant of ['booker', 'sharing occupant'] as const) {
    it(`PoC flipped (${variant}): the agent cannot record the victim's card; a plain check-in holds nothing of theirs`, async () => {
      const org = await organization(s);
      const k = await kandu(s, org, '2027-03-10');
      const { reservations } = s.c.services;
      const { victim, card } = await victimWithCard(org, k);
      const agent = org.staff('reservations_agent', 'Insider', [k.id]);
      expect(agent.authz.can('payments.payment.collect', { propertyId: k.id })).toBe(false);
      const base = bookingInput(k, {
        arrival: '2027-03-10',
        departure: '2027-03-17',
        unit: '214',
        guest: { firstName: 'Acc', lastName: 'Omplice' },
      });
      const stay0 = base.stays[0] as (typeof base.stays)[number];
      const linked =
        variant === 'booker'
          ? {
              ...base,
              booker: {
                kind: 'profile' as const,
                profileId: victim,
                profile: { firstName: 'Vera', lastName: 'Victim' },
              },
            }
          : {
              ...base,
              stays: [
                {
                  ...stay0,
                  occupants: [
                    ...stay0.occupants,
                    {
                      profileId: victim,
                      profile: { firstName: 'Vera', lastName: 'Victim' },
                      kind: 'adult' as const,
                      primary: false,
                    },
                  ],
                },
              ],
            };
      // Writer 1: create with the victim's card → refused, nothing kept.
      const before = await sql<{ n: number }>`select count(*)::int as n from reservations.bookings
        where tenant_id = ${org.tenantId}`.execute(s.t.admin.kysely);
      const refused = await settle(
        org.run(agent, (tx) =>
          reservations.createBooking(tx, {
            ...linked,
            guarantee: { kind: 'card', paymentMethodId: card.id },
          }),
        ),
      );
      expect(refused.ok ? null : refused.e).toMatchObject({ code: 'guarantee_method_not_allowed' });
      const after = await sql<{ n: number }>`select count(*)::int as n from reservations.bookings
        where tenant_id = ${org.tenantId}`.execute(s.t.admin.kysely);
      expect(after.rows[0]?.n).toBe(before.rows[0]?.n);
      // Writer 2 (sibling): create without a card, then patch the victim's card on → refused.
      const b = applied<Booking>(await org.run(agent, (tx) => reservations.createBooking(tx, linked)));
      const patched = await settle(
        org.run(agent, (tx) =>
          reservations.patchBooking(tx, {
            bookingId: b.id,
            expectedVersion: b.version,
            patch: { guarantee: { kind: 'card', paymentMethodId: card.id } },
          }),
        ),
      );
      expect(patched.ok ? null : patched.e).toMatchObject({ code: 'guarantee_method_not_allowed' });
      // Writer 3 (sibling): the check-in input by a role without payment rights → 403, nothing held.
      const stayId = b.stays[0]?.id as string;
      await s.drain();
      await readyUnit(s, org, k.id, k.units['214'] as string);
      const night = nightRole(org.tenantId, org.environment, k.id);
      const viaInput = await settle(
        reservations.performWorkflow(s.t.db, night, {
          stayId,
          kind: 'check_in',
          checkIn: { registration: { identityVerified: true }, guarantee: { paymentMethodId: card.id } },
        }),
      );
      expect(viaInput.ok ? null : viaInput.e).toMatchObject({ status: 403 });
      expect(await holdsOn(stayId)).toEqual([]);
    });
  }

  it('one step beyond: a card a payment user attached is not held by a check-in without payment rights', async () => {
    const org = await organization(s);
    const k = await kandu(s, org, '2027-03-10');
    const { reservations } = s.c.services;
    const { profileId } = await guestWithCard(s, org, k);
    const desk = org.staff('front_desk', 'Hassan', [k.id]);
    const created = applied<Booking>(
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
    // The guest's card, its agreement naming this booking for incidentals and the balance — not as a guarantee — so
    // only a payment user's choice (`designated`) makes it the booking's guarantee card.
    const card = await cardOnFile(
      s,
      org,
      k.id,
      k.legalEntityId,
      'pm_card_mastercard',
      { type: 'guest_profile', id: profileId },
      { mandateFor: [created.id], purposes: ['incidentals', 'balance'] },
    );
    const b = applied<Booking>(
      await org.run(desk, (tx) =>
        reservations.patchBooking(tx, {
          bookingId: created.id,
          expectedVersion: created.version,
          patch: { guarantee: { kind: 'card', paymentMethodId: card.id } },
        }),
      ),
    );
    expect(b.guarantee.basis).toBe('designated');
    const stayId = b.stays[0]?.id as string;
    await s.drain();
    await readyUnit(s, org, k.id, k.units['214'] as string);
    const run = await reservations.performWorkflow(s.t.db, nightRole(org.tenantId, org.environment, k.id), {
      stayId,
      kind: 'check_in',
      checkIn: { registration: { identityVerified: true }, access: { kind: 'card', count: 1 } },
    });
    expect(run.run?.steps.find((x) => x.key === 'guarantee')).toMatchObject({
      status: 'failed',
      message: expect.stringMatching(/colleague who handles payments/),
    });
    expect(await holdsOn(stayId)).toEqual([]);
    // The desk (payments role) sees why: the card was not supplied by its cardholder for this booking.
    const seenByDesk = await org.run(desk, (tx) =>
      reservations.getWorkflow(tx, { stayId, kind: 'check_in' }),
    );
    expect(seenByDesk.steps.find((x) => x.key === 'guarantee')?.message).toMatch(
      /not supplied by its cardholder for this booking/,
    );
    // A desk user with payment rights completes it (the explicit capability).
    const done = await reservations.performWorkflow(s.t.db, desk, {
      stayId,
      kind: 'check_in',
      checkIn: { access: { kind: 'card', count: 1 } },
    });
    expect(done.run?.steps.find((x) => x.key === 'guarantee')).toMatchObject({ status: 'done' });
  });

  it('a mandate naming THIS booking lets a role without payment rights hold the card — and only for that booking', async () => {
    const org = await organization(s);
    const k = await kandu(s, org, '2027-03-10');
    const { reservations } = s.c.services;
    const agent = org.staff('reservations_agent', 'Aishath', [k.id]);
    const b = applied<Booking>(
      await org.run(agent, (tx) =>
        reservations.createBooking(
          tx,
          bookingInput(k, { arrival: '2027-03-10', departure: '2027-03-12', unit: '214' }),
        ),
      ),
    );
    const { card } = await guestWithCard(
      s,
      org,
      k,
      { firstName: 'Mia', lastName: 'Mandate' },
      'pm_card_visa',
    );
    // The same person saves their card again, this time with an agreement that names the booking.
    const named = await cardOnFile(s, org, k.id, k.legalEntityId, 'pm_card_mastercard', card.owner as never, {
      mandateFor: [b.id],
    });
    const ok = applied<Booking>(
      await org.run(agent, (tx) =>
        reservations.patchBooking(tx, {
          bookingId: b.id,
          expectedVersion: b.version,
          patch: { guarantee: { kind: 'card', paymentMethodId: named.id } },
        }),
      ),
    );
    expect(ok.guarantee.basis).toBe('mandate');
    const other = applied<Booking>(
      await org.run(agent, (tx) =>
        reservations.createBooking(tx, bookingInput(k, { arrival: '2027-04-10', departure: '2027-04-12' })),
      ),
    );
    await expect(
      org.run(agent, (tx) =>
        reservations.patchBooking(tx, {
          bookingId: other.id,
          expectedVersion: other.version,
          patch: { guarantee: { kind: 'card', paymentMethodId: named.id } },
        }),
      ),
    ).rejects.toMatchObject({ code: 'guarantee_method_not_allowed' });
    await s.drain();
    await readyUnit(s, org, k.id, k.units['214'] as string);
    const stayId = b.stays[0]?.id as string;
    const run = await reservations.performWorkflow(s.t.db, nightRole(org.tenantId, org.environment, k.id), {
      stayId,
      kind: 'check_in',
      checkIn: { registration: { identityVerified: true }, access: { kind: 'card', count: 1 } },
    });
    expect(run.run?.steps.find((x) => x.key === 'guarantee')).toMatchObject({ status: 'done' });
    expect(await holdsOn(stayId)).toEqual([expect.objectContaining({ method_id: named.id })]);
  });
});

describe('R2-P3-1 — the guarantee cap fails closed', () => {
  it('PoC flipped: a non-numeric policy value keeps the default cap (no USD 25,000 hold on one night)', async () => {
    const org = await organization(s);
    const k = await kandu(s, org, '2027-03-10');
    const { reservations } = s.c.services;
    const desk = org.staff('front_desk', 'Hassan', [k.id]);
    const gm = org.staff('general_manager', 'GM', [k.id]);
    await org.run(gm, (tx) =>
      platform.setPolicy(tx, {
        key: 'reservations.checkIn.guaranteeCapPercent',
        scopeType: 'property',
        scopeId: k.id,
        value: 'no cap for VIPs',
        reason: 'typo in the settings screen',
      }),
    );
    const { profileId, card } = await guestWithCard(s, org, k);
    const b = await bookWithCard(
      s,
      org,
      desk,
      bookingInput(
        k,
        { arrival: '2027-03-10', departure: '2027-03-11', unit: '214', guestProfileId: profileId },
        { guarantee: { kind: 'card', paymentMethodId: card.id } },
      ),
    );
    const stayId = b.stays[0]?.id as string;
    await s.drain();
    await readyUnit(s, org, k.id, k.units['214'] as string);
    const run = await reservations.performWorkflow(s.t.db, desk, {
      stayId,
      kind: 'check_in',
      checkIn: {
        registration: { identityVerified: true },
        guarantee: { amount: { amountMinor: 2_500_000, currency: 'USD' } },
        access: { kind: 'card', count: 1 },
      },
    });
    expect(run.run?.steps.find((x) => x.key === 'guarantee')).toMatchObject({
      status: 'failed',
      message: expect.stringMatching(/at most/),
    });
    expect(await holdsOn(stayId)).toEqual([]);
  });
});

describe('R2-P2-1 — card ownership is per cardholder', () => {
  it('PoC flipped: a second guest saving the shared test token gets their own card and can secure their booking', async () => {
    const org = await organization(s);
    const k = await kandu(s, org, '2027-03-10');
    const desk = org.staff('front_desk', 'Hassan', [k.id]);
    const a = await guestWithCard(s, org, k, { firstName: 'Ana', lastName: 'First' });
    const ben = await guestWithCard(s, org, k, { firstName: 'Ben', lastName: 'Second' });
    expect(ben.card.id).not.toBe(a.card.id);
    expect(ben.card.owner.id).toBe(ben.profileId);
    const r = await settle(
      bookWithCard(
        s,
        org,
        desk,
        bookingInput(
          k,
          {
            arrival: '2027-03-10',
            departure: '2027-03-12',
            guestProfileId: ben.profileId,
            guest: { firstName: 'Ben', lastName: 'Second' },
          },
          { guarantee: { kind: 'card', paymentMethodId: ben.card.id } },
        ),
      ),
    );
    expect(r.ok).toBe(true);
  });
});

/** A checked-out stay whose folio is in credit by the 50,000 deposit (the R2-D / R2-E setup). */
async function departedInCredit(org: ScenarioOrg, k: Awaited<ReturnType<typeof kandu>>, deposit = 50_000) {
  const desk = org.staff('front_desk', 'Hassan', [k.id]);
  const { reservations, payments, finance } = s.c.services;
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
  if (deposit > 0) {
    await payments.chargeNow(desk, {
      propertyId: k.id,
      methodId: card.id,
      amount: { amountMinor: deposit, currency: 'USD' },
      ref: { type: 'booking', id: b.id },
      businessKey: `deposit:${b.id}:1`,
    });
  }
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
    checkOut: { settle: { leaveOpenReason: 'Deposit credit to be refunded' } },
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
  return { b, stay, desk, folioOf, late };
}

const openRequests = async (folioId: string) =>
  (
    await sql<{ amount_minor: number; paid_minor: number; status: string }>`
      select amount_minor::int, paid_minor::int, status from payments.payment_requests
       where ref_type = 'folio' and ref_id = ${folioId} and status in ('open', 'partially_paid')`.execute(
      s.t.admin.kysely,
    )
  ).rows;
const lateItems = async (folioId: string) =>
  (
    await sql<{ severity: string; status: string; details: Record<string, unknown> }>`
      select severity, status, details from finance.exceptions where kind = 'late_charge' and ref_id = ${folioId}
       order by created_at`.execute(s.t.admin.kysely)
  ).rows;

describe('R2-P1-2 — the departed folio’s one balance request always equals what it owes', () => {
  for (const sequential of [false, true])
    it(`PoC flipped (${sequential ? 'sequential' : 'concurrent'}): three late charges — one open request for the full debt, urgent`, async () => {
      const org = await organization(s);
      const k = await kandu(s, org, '2027-03-10');
      const { folioOf, late } = await departedInCredit(org, k);
      const folio = await folioOf();
      expect(folio?.balance.amountMinor).toBe(-50_000);
      const results = sequential
        ? [
            { status: 'fulfilled' as const, value: await late(35_000, 'Spa A') },
            { status: 'fulfilled' as const, value: await late(35_000, 'Spa B') },
            { status: 'fulfilled' as const, value: await late(35_000, 'Spa C') },
          ]
        : await Promise.allSettled([late(35_000, 'Spa A'), late(35_000, 'Spa B'), late(35_000, 'Spa C')]);
      await s.drain();
      expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
      const owed = (await folioOf())?.balance.amountMinor as number;
      expect(owed).toBeGreaterThan(0);
      const open = await openRequests(folio?.id as string);
      expect(open).toHaveLength(1);
      expect((open[0]?.amount_minor ?? 0) - (open[0]?.paid_minor ?? 0)).toBe(owed);
      const items = await lateItems(folio?.id as string);
      expect(items.filter((i) => i.status === 'open')).toEqual([
        expect.objectContaining({
          severity: 'urgent',
          details: expect.objectContaining({ owedMinor: owed, amountRequested: owed }),
        }),
      ]);
    });

  it('PoC flipped: reversing the late charge cancels its request (inverse) and closes the item', async () => {
    const org = await organization(s);
    const k = await kandu(s, org, '2027-03-10');
    const { folioOf, late } = await departedInCredit(org, k, 0);
    const before = (await folioOf())?.balance.amountMinor as number;
    const posted = await late(20_000, 'Minibar (wrong room)');
    const folioId = (await folioOf())?.id as string;
    const owedNow = (await folioOf())?.balance.amountMinor as number;
    const openNow = await openRequests(folioId);
    expect(openNow).toHaveLength(1);
    expect((openNow[0]?.amount_minor ?? 0) - (openNow[0]?.paid_minor ?? 0)).toBe(owedNow);
    const auditor = org.staff('night_auditor', 'Auditor', [k.id]);
    await org.run(auditor, (tx) =>
      s.c.services.finance.reverseEntry(tx, {
        entryId: posted.entryId,
        reasonCode: 'posting_error',
        note: 'Charged to the wrong room',
        idempotencyKey: `rev:${newId()}`,
      }),
    );
    await s.drain();
    expect((await folioOf())?.balance.amountMinor).toBe(before);
    const open = await openRequests(folioId);
    if (before <= 0) expect(open).toEqual([]);
    else expect((open[0]?.amount_minor ?? 0) - (open[0]?.paid_minor ?? 0)).toBe(before);
    if (before <= 0) expect((await lateItems(folioId)).filter((i) => i.status === 'open')).toEqual([]);
  });

  it('sibling: a transfer of the late charge to another folio moves the request with the debt', async () => {
    const org = await organization(s);
    const k = await kandu(s, org, '2027-03-10');
    const { stay, folioOf, late } = await departedInCredit(org, k, 0);
    await late(20_000, 'Dinner');
    const guestFolio = (await folioOf())?.id as string;
    const owed = (await folioOf())?.balance.amountMinor as number;
    const { folioId: companyFolio } = await org.run(org.setup, (tx) =>
      financeForReservations(s.c.services.finance).openFolio(tx, {
        propertyId: k.id,
        owner: { type: 'stay', id: stay.id },
        payer: { type: 'house', id: newId() },
      }),
    );
    const manager = org.staff('general_manager', 'Duty manager', [k.id]);
    await org.run(manager, (tx) =>
      s.c.services.finance.transferPostings(tx, {
        fromFolioId: guestFolio,
        toFolioId: companyFolio,
        amountMinor: owed,
        reason: 'The house pays the dinner',
        idempotencyKey: `tr:${newId()}`,
      }),
    );
    await s.drain();
    expect(await openRequests(guestFolio)).toEqual([]);
  });
});

describe('R2-P1-3 — opening deposits ask reservations who owns the booking (one predicate)', () => {
  it("PoC flipped: Hiyani's finance user cannot import a deposit for Kandu's booking; Kandu's deposit is charged AND posted", async () => {
    const org = await organization(s);
    const k = await kandu(s, org, '2027-03-10');
    const h = await hiyani(s, org, '2027-03-10');
    const { reservations, payments, finance } = s.c.services;
    const kAgent = org.staff('reservations_agent', 'Aishath', [k.id]);
    const b = applied<Booking>(
      await org.run(kAgent, (tx) =>
        reservations.createBooking(tx, bookingInput(k, { arrival: '2027-03-12', departure: '2027-03-14' })),
      ),
    );
    const hFinance = org.staff('finance', 'Hiyani accounts', [h.id]);
    const report = await org.run(hFinance, (tx) =>
      finance.importOpeningDeposits(tx, {
        propertyId: h.id,
        importRef: `legacy-${newId()}`,
        currency: 'USD',
        providedClosingMinor: 100,
        items: [{ bookingId: b.id, amountMinor: 100 }],
        idempotencyKey: `imp:${newId()}`,
      }),
    );
    expect(report.importedCount).toBe(0);
    expect(report.rejected).toEqual([
      expect.objectContaining({ reason: expect.stringMatching(/another property/) }),
    ]);
    const acct = await sql<{ n: number }>`select count(*)::int as n from finance.deposit_accounts
      where booking_id = ${b.id}`.execute(s.t.admin.kysely);
    expect(acct.rows[0]?.n).toBe(0);
    const kDesk = org.staff('front_desk', 'Kandu desk', [k.id]);
    const card = await cardOnFile(s, org, k.id, k.legalEntityId, 'pm_card_visa', undefined, {
      mandateFor: [b.id],
    });
    const paid = await payments.chargeNow(kDesk, {
      propertyId: k.id,
      methodId: card.id,
      amount: { amountMinor: 50_000, currency: 'USD' },
      ref: { type: 'booking', id: b.id },
      businessKey: `deposit:${b.id}:k`,
    });
    await s.drain();
    expect(paid.status.payment).toBe('succeeded');
    const pay = await sql<{ ledger_status: string }>`
      select ledger_status from payments.payments where ref_id = ${b.id}`.execute(s.t.admin.kysely);
    expect(pay.rows).toEqual([{ ledger_status: 'posted' }]);
  });

  it('sibling (inverse order): a deposit held at another property blocks the card BEFORE it is charged', async () => {
    const org = await organization(s);
    const k = await kandu(s, org, '2027-03-10');
    const h = await hiyani(s, org, '2027-03-10');
    const { reservations, payments } = s.c.services;
    const b = applied<Booking>(
      await org.run(org.staff('reservations_agent', 'Aishath', [k.id]), (tx) =>
        reservations.createBooking(tx, bookingInput(k, { arrival: '2027-03-12', departure: '2027-03-14' })),
      ),
    );
    // A data repair left a deposit account for this booking at Hiyani (the state R2-F produced before the fix).
    await sql`insert into finance.deposit_accounts (id, tenant_id, legal_entity_id, property_id, booking_id, currency)
      values (${newId()}, ${org.tenantId}, ${h.legalEntityId}, ${h.id}, ${b.id}, 'USD')`.execute(
      s.t.admin.kysely,
    );
    const { card } = await guestWithCard(s, org, k);
    const r = await settle(
      payments.chargeNow(org.staff('front_desk', 'Kandu desk', [k.id]), {
        propertyId: k.id,
        methodId: card.id,
        amount: { amountMinor: 50_000, currency: 'USD' },
        ref: { type: 'booking', id: b.id },
        businessKey: `deposit:${b.id}:k`,
      }),
    );
    expect(r.ok ? null : r.e).toMatchObject({ code: 'deposit_account_conflict' });
    const pays = await sql<{ n: number }>`select count(*)::int as n from payments.payments
      where ref_id = ${b.id}`.execute(s.t.admin.kysely);
    expect(pays.rows[0]?.n).toBe(0);
  });
});

describe('R2-P2-2 — payment state only for roles that handle money', () => {
  it('PoC flipped: housekeeping reads the check-in run and the stay without payment state or card messages', async () => {
    const org = await organization(s);
    const k = await kandu(s, org, '2027-03-10');
    const { reservations } = s.c.services;
    const desk = org.staff('front_desk', 'Hassan', [k.id]);
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
    const stayId = b.stays[0]?.id as string;
    await s.drain();
    await readyUnit(s, org, k.id, k.units['214'] as string);
    // A first attempt with an amount above the cap fails with an amount in its message (seen in the stay issue).
    await reservations.performWorkflow(s.t.db, desk, {
      stayId,
      kind: 'check_in',
      checkIn: {
        registration: { identityVerified: true },
        guarantee: { amount: { amountMinor: 9_999_999, currency: 'USD' } },
      },
    });
    const hk = org.staff('housekeeping_supervisor', 'Mariyam', [k.id]);
    const run = await org.run(hk, (tx) => reservations.getWorkflow(tx, { stayId, kind: 'check_in' }));
    const g = run.steps.find((x) => x.key === 'guarantee');
    expect(g).toMatchObject({
      status: 'failed',
      result: null,
      message:
        'Payment detail is not shown for your role. A colleague who handles payments can complete this step.',
    });
    const stay = await org.run(hk, (tx) => reservations.getStay(tx, stayId));
    const issue = stay.issues.find((i) => i.code === 'check_in_incomplete');
    expect(issue?.message).not.toMatch(/minor units|at most/);
    // The desk (money role) still sees it.
    const deskRun = await org.run(desk, (tx) => reservations.getWorkflow(tx, { stayId, kind: 'check_in' }));
    expect(deskRun.steps.find((x) => x.key === 'guarantee')?.message).toMatch(/at most/);
    // Sibling: performWorkflow's own response to a non-money role.
    const done = await reservations.performWorkflow(s.t.db, desk, {
      stayId,
      kind: 'check_in',
      checkIn: { access: { kind: 'card', count: 1 } },
    });
    expect(done.run?.steps.find((x) => x.key === 'guarantee')?.result).toMatchObject({
      paymentStatus: 'authorized',
    });
    const after = await org.run(hk, (tx) => reservations.getWorkflow(tx, { stayId, kind: 'check_in' }));
    expect(after.steps.find((x) => x.key === 'guarantee')?.result).toBeNull();
  });

  it('R2-P3-5: a revenue manager keeps booking totals; payment state stays hidden', async () => {
    const org = await organization(s);
    const k = await kandu(s, org, '2027-03-10');
    const { reservations } = s.c.services;
    const b = applied<Booking>(
      await org.run(org.staff('reservations_agent', 'Aishath', [k.id]), (tx) =>
        reservations.createBooking(tx, bookingInput(k, { arrival: '2027-03-12', departure: '2027-03-14' })),
      ),
    );
    const rm = org.staff('revenue_manager', 'Revenue', [k.id]);
    const seen = await org.run(rm, (tx) => reservations.getBooking(tx, b.id));
    expect(seen.totals?.gross.amountMinor).toBeGreaterThan(0);
    expect(seen.status.payment).toBeUndefined();
  });
});

describe('R2-P2-3 — payments verifies every reference type (allow-list)', () => {
  it("PoC flipped: Hiyani cannot hold a card 'for' Kandu's folio; Kandu still reads its folio's payment status", async () => {
    const org = await organization(s);
    const k = await kandu(s, org, '2027-03-10');
    const h = await hiyani(s, org, '2027-03-10');
    const { reservations, payments } = s.c.services;
    const desk = org.staff('front_desk', 'Hassan', [k.id]);
    const b = applied<Booking>(
      await org.run(desk, (tx) =>
        reservations.createBooking(
          tx,
          bookingInput(k, { arrival: '2027-03-10', departure: '2027-03-12', unit: '214' }),
        ),
      ),
    );
    const { folioId } = await org.run(org.setup, (tx) =>
      financeForReservations(s.c.services.finance).openFolio(tx, {
        propertyId: k.id,
        owner: { type: 'stay', id: b.stays[0]?.id as string },
        payer: { type: 'house', id: newId() },
      }),
    );
    const { card } = await guestWithCard(s, org, h);
    const hDesk = org.staff('front_desk', 'Hiyani desk', [h.id]);
    for (const ref of [
      { type: 'folio', id: folioId },
      { type: 'Folio', id: folioId },
      { type: 'invoice', id: folioId },
    ]) {
      const r = await settle(
        org.run(hDesk, (tx) =>
          payments.tx.authorize(tx, {
            propertyId: h.id,
            methodId: card.id,
            amount: { amountMinor: 10_000, currency: 'USD' },
            ref,
            businessKey: `a:${newId()}`,
          }),
        ),
      );
      expect(r.ok).toBe(false);
    }
    expect(await holdsOn(folioId)).toEqual([]);
    const status = await org.run(desk, (tx) =>
      payments.tx.getPaymentStatus(tx, { type: 'folio', id: folioId }),
    );
    expect(status.authorizations).toEqual([]);
  });
});
