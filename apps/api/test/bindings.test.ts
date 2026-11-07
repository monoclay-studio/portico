/**
 * Cross-module port bindings through the REAL composition root (integration step, ADR-0003 / ADR-0015). Each
 * binding is proven end to end with real providers, plus a refusal (wrong property or external system of record).
 */
import { sql } from '@portico/db';
import { newId } from '@portico/kernel';
import type { Booking } from '@portico/reservations';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  applied,
  assertGlobalConsistency,
  bookingInput,
  hiyani,
  kandu,
  makeExternal,
  organization,
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

describe('reservations-agnostic smoke', () => {
  it('builds the sample organization', async () => {
    const org = await organization(s);
    const k = await kandu(s, org);
    expect(Object.keys(k.plans)).toEqual(expect.arrayContaining(['BAR', 'BAR-NR', 'AI']));
    expect(newId()).toBeTruthy();
  });
});
