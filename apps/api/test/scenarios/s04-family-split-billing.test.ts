/**
 * S04 — A family books several rooms; a company pays accommodation, guests pay incidentals. One booking with three
 * stays (child ages drive price and Green Tax via rates), billing instructions sent to finance (company folio +
 * routing rules per stay), a "who pays for what" preview, and postings routed exactly as previewed.
 */
import type { Booking } from '@portico/reservations';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  applied,
  assertGlobalConsistency,
  bookingInput,
  kandu,
  organization,
  type Scenario,
  startScenario,
} from './harness';

let s: Scenario;
beforeAll(async () => {
  s = await startScenario();
});
afterAll(async () => s?.close());

describe('S04 — family, company pays accommodation', () => {
  it('three stays priced by occupancy; the company folio receives room charges, incidentals stay with the guests', async () => {
    const org = await organization(s);
    const k = await kandu(s, org, '2027-03-10');
    const { reservations, guests, finance } = s.c.services;
    const company = await org.run(org.setup, (tx) =>
      guests.createCompany(tx, {
        kind: 'company',
        legalName: 'Seabridge Engineering Pvt Ltd',
        taxId: 'GST-SEA-1',
      }),
    );
    const assistant = org.staff('reservations_agent', 'Company assistant (via reservations)', [k.id]);
    const stay = (lastName: string, childrenAges: number[], type = 'BV') => {
      const one = bookingInput(k, {
        arrival: '2027-03-10',
        departure: '2027-03-13',
        type,
        adults: childrenAges.length ? 1 : 2,
        childrenAges,
        guest: { firstName: 'Family', lastName },
      }).stays[0];
      if (!one) throw new Error('no stay');
      return one;
    };
    const b = applied<Booking>(
      await org.run(assistant, (tx) =>
        reservations.createBooking(tx, {
          ...bookingInput(k, { arrival: '2027-03-10', departure: '2027-03-13' }),
          booker: { kind: 'company', companyId: company.id, name: 'Seabridge Engineering' },
          companyId: company.id,
          marketSegment: 'corporate',
          billing: { accommodationPayer: { type: 'company', id: company.id }, incidentalsPayer: 'occupants' },
          stays: [stay('Parents', []), stay('Grandparents', []), stay('Aunt', [6, 12], 'WV')],
        }),
      ),
    );
    expect(b.stays).toHaveLength(3);
    // Child ages drive the price: the stay with two children costs more than a 2-adult stay of the cheaper type.
    const [p1, , p3] = b.stays.map((st) => st.totals.gross.amountMinor);
    expect(p3).toBeGreaterThan(p1 as number);

    // finance holds the instructions: per stay a company folio for accommodation and the guest's default folio.
    const desk = org.staff('front_desk', 'Hassan', [k.id]);
    for (const st of b.stays) {
      const folios = await org.run(desk, (tx) =>
        finance.listFolios(tx, { owner: { type: 'stay', id: st.id } }),
      );
      expect(folios.map((f) => f.payer.type).sort()).toEqual(['company', 'guest']);
    }
    const first = b.stays[0]?.id as string;
    const preview = await org.run(desk, (tx) =>
      finance.previewRouting(tx, {
        propertyId: k.id,
        owner: { type: 'stay', id: first },
        charges: [
          { chargeCode: 'ROOM', serviceDate: '2027-03-10', amount: { amountMinor: 90_000, currency: 'USD' } },
          { chargeCode: 'SPA', serviceDate: '2027-03-10', amount: { amountMinor: 12_000, currency: 'USD' } },
        ],
      }),
    );
    // The company is named on its folio (payer directory → guests companies, bound at the integration step).
    expect(preview.totalsByFolio.map((t) => [t.folioName, t.total.amountMinor])).toEqual([
      ['Seabridge Engineering Pvt Ltd — Accommodation', 90_000],
      ['Family Parents — Incidentals', 12_000],
    ]);

    // Postings routed exactly as previewed (room: company; spa: guest).
    const night = await org.run(org.setup, (tx) =>
      finance.postCharge(tx, {
        propertyId: k.id,
        target: { type: 'stay', id: first },
        chargeCode: 'ROOM',
        amount: { amountMinor: 90_000, currency: 'USD' },
        serviceDate: '2027-03-10',
        description: 'Room night (manual posting; Day Close not built)',
        sourceRef: { type: 'stay', id: first },
        idempotencyKey: `room:${first}:2027-03-10`,
        occupancy: { adults: 2, childrenAges: [] },
      }),
    );
    const spa = await org.run(desk, (tx) =>
      finance.postCharge(tx, {
        propertyId: k.id,
        target: { type: 'stay', id: first },
        chargeCode: 'SPA',
        amount: { amountMinor: 12_000, currency: 'USD' },
        serviceDate: '2027-03-10',
        description: 'Couples massage',
        sourceRef: { type: 'spa_booking', id: first },
        idempotencyKey: `spa:${first}:1`,
      }),
    );
    const folios = await org.run(desk, (tx) =>
      finance.listFolios(tx, { owner: { type: 'stay', id: first } }),
    );
    const companyFolio = folios.find((f) => f.payer.type === 'company');
    const guestFolio = folios.find((f) => f.payer.type === 'guest');
    expect(night.folioIds).toEqual([companyFolio?.id]);
    expect(spa.folioIds).toEqual([guestFolio?.id]);
    expect(preview.totalsByFolio.map((t) => t.folioId)).toEqual([companyFolio?.id, guestFolio?.id]);
    await assertGlobalConsistency(s, org, {
      auditActions: ['reservations.booking.create', 'finance.posting.charge'],
    });
  });

  it.todo('room nights posted by Day Close per agreed terms (day-close module, wave 2)');
  it.todo(
    'company folio settled to receivables with one invoice per payer at check-out (receivables flow from check-out not wired)',
  );
  it.todo(
    'an incidental routed to the company by mistake is transferred back with a preview (FIN-R11 transfer preview not built)',
  );
});
