/**
 * Cross-module port bindings through the REAL composition root (integration step, ADR-0003 / ADR-0015). Each
 * binding is proven end to end with real providers, plus a refusal (wrong property or external system of record).
 */
import { sql } from '@portico/db';
import { newId } from '@portico/kernel';
import { paymentsCollectionsForFinance } from '@portico/payments';
import { platform } from '@portico/platform';
import type { Booking } from '@portico/reservations';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  applied,
  assertGlobalConsistency,
  bookingInput,
  cardOnFile,
  guestWithCard,
  hiyani,
  kandu,
  makeExternal,
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

describe('reservations → rates (ratesPortFrom)', () => {
  it('quotes, books on sealed agreed terms stored verbatim, re-prices an extension and evaluates penalties', async () => {
    const org = await organization(s);
    const k = await kandu(s, org);
    const agent = org.staff('reservations_agent', 'Aishath', [k.id]);
    const { reservations, rates } = s.c.services;
    const quote = await org.run(agent, (tx) =>
      reservations.quote(tx, {
        propertyId: k.id,
        arrival: '2027-03-10',
        departure: '2027-03-13',
        occupancy: { adults: 2, childrenAges: [] },
        unitTypeIds: [k.types.BV as string],
      }),
    );
    const bar = quote.find((o) => o.ratePlanId === k.plans.BAR);
    // High season BAR for a Beach Villa: USD 900 per night for two (rates seed), plus the Maldives taxes.
    expect(bar).toMatchObject({ available: 3, bookable: true });
    expect(bar?.totals.net.amountMinor).toBeGreaterThan(0);
    expect(bar?.totals.gross.amountMinor).toBe(
      (bar?.totals.net.amountMinor ?? 0) +
        (bar?.totals.taxes.amountMinor ?? 0) +
        (bar?.totals.fees.amountMinor ?? 0),
    );

    const booking = applied<Booking>(
      await org.run(agent, (tx) =>
        reservations.createBooking(tx, bookingInput(k, { arrival: '2027-03-10', departure: '2027-03-13' })),
      ),
    );
    expect(booking.status.booking).toBe('confirmed');
    const stayId = booking.stays[0]?.id as string;

    // The sealed rates document is stored verbatim and still verifies with the server key.
    const stored = await sql<{
      document: { providerDocument: unknown; totals: { gross: { amountMinor: number } } };
    }>`
      select document from reservations.terms_snapshots where stay_id = ${stayId}`.execute(s.t.admin.kysely);
    const doc = stored.rows[0]?.document;
    expect(rates.verifyTerms(doc?.providerDocument)).toBe(true);
    expect(doc?.totals.gross.amountMinor).toBe(bar?.totals.gross.amountMinor);

    // Extension: agreed nights keep their agreed price; the new night is priced by rates.priceChange.
    const preview = await org.run(agent, (tx) =>
      reservations.previewChange(tx, {
        kind: 'dates',
        stayId,
        arrival: '2027-03-10',
        departure: '2027-03-14',
      }),
    );
    const nights = preview.stays[0]?.nights ?? [];
    expect(nights.filter((n) => n.status === 'added').map((n) => n.date)).toEqual(['2027-03-13']);
    const committed = await org.run(agent, (tx) =>
      reservations.commitChange(tx, { previewToken: preview.token }),
    );
    expect(committed).toBeTruthy();
    const snaps = await sql<{ document: { providerDocument: { supersedesSeal: string | null } } }>`
      select document from reservations.terms_snapshots where stay_id = ${stayId} order by supersedes_id nulls first, id`.execute(
      s.t.admin.kysely,
    );
    expect(snaps.rows).toHaveLength(2);
    expect(snaps.rows[1]?.document.providerDocument.supersedesSeal).toBeTruthy();
    for (const r of snaps.rows) expect(rates.verifyTerms(r.document.providerDocument)).toBe(true);

    // Cancellation 10 days out under FLEX21 (3 nights from 21 days before arrival) — evaluated by rates.
    const cancel = await org.run(agent, (tx) =>
      reservations.previewChange(tx, {
        kind: 'cancel_booking',
        bookingId: booking.id,
        reason: 'Guest request',
      }),
    );
    expect(cancel.penalties[0]?.amount.amountMinor).toBeGreaterThan(0);
    await assertGlobalConsistency(s, org, { auditActions: ['reservations.booking.create'] });
  });

  it('refuses quotes and bookings while an external system is authoritative for rates', async () => {
    const org = await organization(s);
    const k = await kandu(s, org);
    await makeExternal(s, org, k.id, 'rates');
    const agent = org.staff('reservations_agent', 'Hassan', [k.id]);
    await expect(
      org.run(agent, (tx) =>
        s.c.services.reservations.createBooking(
          tx,
          bookingInput(k, { arrival: '2027-03-10', departure: '2027-03-12' }),
        ),
      ),
    ).rejects.toMatchObject({ code: 'rates_managed_externally' });
  });
});

describe('reservations → inventory (ADR-0015 port surface)', () => {
  it('a reservations agent without inventory keys books and assigns; a unit of another property is refused', async () => {
    const org = await organization(s);
    const k = await kandu(s, org);
    const h = await hiyani(s, org);
    const agent = org.staff('reservations_agent', 'Aishath', [k.id]);
    const b = applied<Booking>(
      await org.run(agent, (tx) =>
        s.c.services.reservations.createBooking(
          tx,
          bookingInput(k, { arrival: '2027-03-10', departure: '2027-03-12', unit: '214' }),
        ),
      ),
    );
    expect(b.stays[0]?.unitId).toBe(k.units['214']);
    await expect(
      org.run(org.setup, (tx) =>
        s.c.services.reservations.createBooking(tx, {
          ...bookingInput(k, { arrival: '2027-03-10', departure: '2027-03-12' }),
          stays: [
            {
              ...bookingInput(k, { arrival: '2027-03-10', departure: '2027-03-12' }).stays[0],
              unitId: h.units['101'] as string,
            } as never,
          ],
        }),
      ),
    ).rejects.toMatchObject({ code: 'scope_mismatch' });
    await assertGlobalConsistency(s, org);
  });
});

describe('reservations → guests, payments, finance, operations (check-in and check-out)', () => {
  it('runs the whole stay through the real providers', async () => {
    const org = await organization(s);
    const k = await kandu(s, org, '2027-03-10');
    const desk = org.staff('front_desk', 'Hassan', [k.id]);
    const { reservations, payments, finance, guests, operations } = s.c.services;
    const { profileId: guestId, card } = await guestWithCard(s, org, k);
    const b = applied<Booking>(
      await org.run(desk, (tx) =>
        reservations.createBooking(
          tx,
          bookingInput(
            k,
            { arrival: '2027-03-10', departure: '2027-03-12', unit: '214', guestProfileId: guestId },
            { guarantee: { kind: 'card', paymentMethodId: card.id } },
          ),
        ),
      ),
    );
    const stay = b.stays[0];
    if (!stay) throw new Error('no stay');
    await s.drain(); // v2 booking events → operations mirrors the arrival on villa 214
    await readyUnit(s, org, k.id, k.units['214'] as string);

    // Deposit by card on the booking (payments → finance: a deposit liability, never revenue).
    const deposit = await payments.chargeNow(desk, {
      propertyId: k.id,
      methodId: card.id,
      amount: { amountMinor: 50_000, currency: 'USD' },
      ref: { type: 'booking', id: b.id },
      businessKey: `deposit:${b.id}:1`,
    });
    expect(deposit.status).toMatchObject({ payment: 'succeeded', ledger: 'posted' });

    const checkIn = await reservations.performWorkflow(s.t.db, desk, {
      stayId: stay.id,
      kind: 'check_in',
      checkIn: { registration: { identityVerified: true }, access: { kind: 'card', count: 2 } },
    });
    expect(checkIn.interrupted).toBeNull();
    const steps = Object.fromEntries((checkIn.run?.steps ?? []).map((st) => [st.key, st.status]));
    expect(steps).toMatchObject({ registration: 'done', unit: 'done', guarantee: 'done', deposits: 'done' });
    expect(checkIn.run?.status).toBe('completed');

    // payments: the confirmed deposit secures the guarantee (read from payments, never assumed).
    expect(checkIn.run?.steps.find((st) => st.key === 'guarantee')?.message).toMatch(/confirmed by payments/);
    const pay = await org.run(desk, (tx) =>
      payments.provider.getPaymentStatus(tx, { type: 'booking', id: b.id }, { propertyId: k.id }),
    );
    expect(pay.capturedMinor).toBe(50_000);

    const chen = await guestWithCard(s, org, k, { firstName: 'Wei', lastName: 'Chen' }, 'pm_card_mastercard');
    // A second arrival without a deposit: the guarantee step authorizes the card (two-phase: `processing` inside
    // the step, settled by payments after commit, read back) — exactly once.
    const b2 = applied<Booking>(
      await org.run(desk, (tx) =>
        reservations.createBooking(
          tx,
          bookingInput(
            k,
            {
              arrival: '2027-03-10',
              departure: '2027-03-11',
              unit: '216',
              guest: { firstName: 'Wei', lastName: 'Chen' },
              guestProfileId: chen.profileId,
            },
            { guarantee: { kind: 'card', paymentMethodId: chen.card.id } },
          ),
        ),
      ),
    );
    const stay2 = b2.stays[0]?.id as string;
    await readyUnit(s, org, k.id, k.units['216'] as string);
    const checkIn2 = await reservations.performWorkflow(s.t.db, desk, {
      stayId: stay2,
      kind: 'check_in',
      checkIn: { registration: { identityVerified: true }, access: { kind: 'card', count: 1 } },
    });
    expect(checkIn2.run?.status).toBe('completed');
    const auth = await org.run(desk, (tx) =>
      payments.provider.getPaymentStatus(tx, { type: 'stay', id: stay2 }, { propertyId: k.id }),
    );
    expect(auth.authorizations).toHaveLength(1);
    expect(auth.authorizations[0]?.status.authorization).toBe('authorized');
    // Payments' own journal: one provider operation, sent once.
    const ops = await sql<{ attempts: number }>`
      select attempts from payments.provider_operations where authorization_id = ${auth.authorizations[0]?.id}`.execute(
      s.t.admin.kysely,
    );
    expect(ops.rows.map((r) => r.attempts)).toEqual([1]);
    // finance: the stay folio holds the applied deposit; the booking's deposit account is empty again.
    const folios = await org.run(desk, (tx) =>
      finance.listFolios(tx, { owner: { type: 'stay', id: stay.id } }),
    );
    expect(folios).toHaveLength(1);
    expect(folios[0]?.balance).toEqual({ amountMinor: -50_000, currency: 'USD' });
    // guests: the occupant's profile carries the stay.
    const profileId = stay.occupants[0]?.profileId as string;
    const history = await org.run(org.setup, (tx) =>
      guests.getStayHistory(tx, profileId, { propertyId: k.id }),
    );
    expect(history.items.map((i) => i.stayId)).toContain(stay.id);
    // operations: the v2 stay event marks the villa occupied.
    await s.drain();
    const villa = await org.run(org.setup, (tx) => operations.getUnitCondition(tx, k.units['214'] as string));
    expect(villa.occupancy).toBe('occupied');

    // Check-out on the departure business date; the deposit credit stays on the folio until refunded or charged.
    await org.run(org.setup, (tx) => platform.advanceBusinessDate(tx, k.id, '2027-03-10'));
    await org.run(org.setup, (tx) => platform.advanceBusinessDate(tx, k.id, '2027-03-11'));
    // Leaving a balance open is a sensitive decision (reservations.stay.checkoutWithBalance): the duty manager.
    const manager = org.staff('general_manager', 'Duty manager', [k.id]);
    const out = await reservations.performWorkflow(s.t.db, manager, {
      stayId: stay.id,
      kind: 'check_out',
      checkOut: { settle: { leaveOpenReason: 'Room nights are posted by Day Close (not yet built)' } },
    });
    expect(out.run?.status).toBe('completed');
    await s.drain(); // finance records the departure; operations marks the villa dirty

    // finance → payments: a late spa charge after departure becomes a payment request (intent only).
    const late = await org.run(desk, (tx) =>
      finance.postCharge(tx, {
        propertyId: k.id,
        target: { type: 'stay', id: stay.id },
        chargeCode: 'MISC',
        amount: { amountMinor: 64_000, currency: 'USD' },
        description: 'Lunch at the Reef Restaurant',
        serviceDate: '2027-03-12',
        sourceRef: { type: 'pos_check', id: newId() },
        idempotencyKey: `pos:${newId()}`,
      }),
    );
    expect(late.postingIds.length).toBeGreaterThan(0);
    const requests = await sql<{ id: string; purpose: string; status: string; amount_minor: number }>`
      select id, purpose, status, amount_minor from payments.payment_requests where ref_type = 'folio' and ref_id = ${folios[0]?.id}`.execute(
      s.t.admin.kysely,
    );
    // Review P1-3: exactly what the folio owes after the late charge (the applied deposit credit is netted).
    const owed = (
      await org.run(desk, (tx) => finance.listFolios(tx, { owner: { type: 'stay', id: stay.id } }))
    )[0]?.balance.amountMinor as number;
    expect(owed).toBeGreaterThan(0);
    expect(requests.rows).toMatchObject([{ purpose: 'balance', status: 'open', amount_minor: owed }]);
    await assertGlobalConsistency(s, org, {
      auditActions: ['reservations.booking.create', 'finance.posting.charge'],
    });
  });

  it('each bound port refuses records of another property (ADR-0015)', async () => {
    const org = await organization(s);
    const k = await kandu(s, org);
    const h = await hiyani(s, org);
    const desk = org.staff('front_desk', 'Hassan', [k.id, h.id]);
    const b = applied<Booking>(
      await org.run(desk, (tx) =>
        s.c.services.reservations.createBooking(
          tx,
          bookingInput(k, { arrival: '2027-03-10', departure: '2027-03-12', unit: '216' }),
        ),
      ),
    );
    const stayRef = { type: 'stay', id: b.stays[0]?.id as string };
    const ports = s.c.services.reservations.deps.ports;
    await expect(
      org.run(desk, (tx) => ports.inventory.getUnit(tx, k.units['216'] as string, { propertyId: h.id })),
    ).rejects.toMatchObject({ code: 'scope_mismatch' });
    await expect(
      org.run(desk, (tx) => ports.inventory.release(tx, { propertyId: h.id, ref: stayRef })),
    ).rejects.toMatchObject({ code: 'scope_mismatch' });
    const card = await cardOnFile(s, org, k.id, k.legalEntityId);
    await org.run(desk, (tx) =>
      ports.payments.authorize(tx, {
        propertyId: k.id,
        methodId: card.id,
        amount: { amountMinor: 10_000, currency: 'USD' },
        ref: stayRef,
        idempotencyKey: `test:${newId()}`,
      }),
    );
    await expect(
      org.run(desk, (tx) => ports.payments.getPaymentStatus(tx, stayRef, { propertyId: h.id })),
    ).rejects.toMatchObject({ code: 'scope_mismatch' });
    await expect(
      org.run(desk, (tx) =>
        ports.operations.createTask(tx, {
          propertyId: h.id,
          kind: 'guest_commitment',
          title: 'Champagne on arrival',
          ref: { type: 'unit', id: k.units['216'] as string },
          priority: 'normal',
        }),
      ),
    ).rejects.toMatchObject({ code: 'unit_property_mismatch' });
    const { folioId } = await org.run(desk, (tx) =>
      ports.finance.openFolio(tx, {
        propertyId: k.id,
        owner: stayRef,
        payer: { type: 'house', id: newId() },
      }),
    );
    await expect(
      org.run(org.staff('front_desk', 'Aminath', [h.id]), (tx) =>
        ports.finance.getFolioBalance(tx, folioId, { propertyId: h.id }),
      ),
    ).rejects.toMatchObject({ status: 403 });
    // finance → payments: a collection request for a folio of another property is refused before any intent is
    // recorded and reported as not possible (finance then lists the late charge for manual collection).
    const collection = await org.run(desk, (tx) =>
      paymentsCollectionsForFinance(s.c.services.payments).requestCollection(tx, {
        propertyId: h.id,
        folioId,
        amount: { amountMinor: 6_400, currency: 'USD' },
        reason: 'late_charge',
        ref: { type: 'journal_entry', id: newId() },
        idempotencyKey: `late:${newId()}`,
      }),
    );
    expect(collection).toMatchObject({ status: 'not_possible' });
    const none = await sql<{ n: number }>`
      select count(*)::int as n from payments.payment_requests where ref_id = ${folioId}`.execute(
      s.t.admin.kysely,
    );
    expect(none.rows[0]?.n).toBe(0);
    // The task is accepted for the right property without operations' own key (reservations agent has none).
    const agent = org.staff('reservations_agent', 'Aishath', [k.id]);
    const task = await org.run(agent, (tx) =>
      ports.operations.createTask(tx, {
        propertyId: k.id,
        kind: 'guest_commitment',
        title: 'Champagne on arrival',
        ref: { type: 'unit', id: k.units['216'] as string },
        priority: 'normal',
      }),
    );
    expect(task.taskId).toBeTruthy();
  });

  it('refuses through each provider while an external system is the system of record', async () => {
    const org = await organization(s);
    const k = await kandu(s, org);
    const desk = org.staff('front_desk', 'Hassan', [k.id]);
    const { reservations } = s.c.services;
    await makeExternal(s, org, k.id, 'guestProfiles');
    await expect(
      org.run(desk, (tx) =>
        reservations.createBooking(tx, bookingInput(k, { arrival: '2027-03-10', departure: '2027-03-12' })),
      ),
    ).rejects.toMatchObject({ code: 'external_system_of_record' });
    const org2 = await organization(s);
    const k2 = await kandu(s, org2);
    await makeExternal(s, org2, k2.id, 'payments');
    const desk2 = org2.staff('front_desk', 'Hassan', [k2.id]);
    const card = await cardOnFile(s, org2, k2.id, k2.legalEntityId).catch((e: unknown) => e);
    expect(card).toMatchObject({ code: 'external_system_of_record' });
    await expect(
      org2.run(desk2, (tx) =>
        reservations.deps.ports.payments.createPaymentRequest(tx, {
          propertyId: k2.id,
          payer: { type: 'other', name: 'Guest' },
          amount: { amountMinor: 1000, currency: 'USD' },
          purpose: 'deposit',
          ref: { type: 'booking', id: newId() },
          expiresAt: '2027-03-09T00:00:00Z',
          idempotencyKey: `k:${newId()}`,
        }),
      ),
    ).rejects.toMatchObject({ code: 'external_system_of_record' });
    await makeExternal(s, org2, k2.id, 'charges');
    await expect(
      org2.run(desk2, (tx) =>
        reservations.deps.ports.finance.openFolio(tx, {
          propertyId: k2.id,
          owner: { type: 'stay', id: newId() },
          payer: { type: 'house', id: newId() },
        }),
      ),
    ).rejects.toMatchObject({ code: 'external_system_of_record' });
  });
});
