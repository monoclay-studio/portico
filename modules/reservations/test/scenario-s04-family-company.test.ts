import { newId } from '@portico/kernel';
import type { TestDatabase } from '@portico/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Booking } from '../src/contracts';
import { BUSINESS_DATE, created, setupOrg, startDb } from './helpers';

/** S04 — a family books several rooms; a company pays accommodation and the guests pay incidentals. */
let t: TestDatabase;
beforeAll(async () => {
  t = await startDb();
});
afterAll(async () => t?.drop());

describe('S04: family multi-room booking with company-paid accommodation', () => {
  it('one booking, three stays, children ages drive price and Green Tax, billing instructions passed to finance', async () => {
    const org = await setupOrg(t);
    const companyId = newId();
    const guest = (first: string, last = 'Raman') => ({
      profile: { firstName: first, lastName: last, email: `${first.toLowerCase()}-${newId()}@raman.example` },
      kind: 'adult' as const,
      primary: true,
    });
    const b = created<Booking>(
      await org.run((tx) =>
        org.svc.createBooking(
          tx,
          org.booking({
            booker: { kind: 'company', companyId, name: 'Raman Industries' },
            companyId,
            marketSegment: 'corporate',
            guarantee: { kind: 'company' },
            billing: {
              accommodationPayer: { type: 'company', id: companyId },
              incidentalsPayer: 'occupants',
            },
            stays: [
              org.stay({ occupancy: { adults: 2, childrenAges: [] }, occupants: [guest('Priya')] }),
              org.stay({
                occupancy: { adults: 1, childrenAges: [8, 1] },
                occupants: [
                  guest('Anil'),
                  { kind: 'child', ageAtArrival: 8, primary: false },
                  { kind: 'child', ageAtArrival: 1, primary: false },
                ],
              }),
              org.stay({
                unitTypeId: org.types.overwater,
                occupancy: { adults: 2, childrenAges: [] },
                occupants: [guest('Lakshmi')],
              }),
            ],
          }),
        ),
      ),
    );
    expect(b.stays).toHaveLength(3);
    expect(new Set(b.stays.map((s) => s.status.stay))).toEqual(new Set(['expected']));
    // Children: age 8 adds the child supplement and pays Green Tax; the infant (1) pays neither.
    const kids = b.stays[1];
    expect(kids?.totals?.net.amountMinor).toBe(3 * (30_000 + 4_000));
    expect(kids?.totals?.fees.amountMinor).toBe(3 * 2 * 1_200);
    expect(kids?.occupants.map((o) => [o.kind, o.ageAtArrival])).toEqual([
      ['adult', null],
      ['child', 8],
      ['child', 1],
    ]);
    // Each stay keeps its own agreed terms.
    expect(new Set(b.stays.map((s) => s.segments[0]?.termsSnapshotId)).size).toBe(3);
    // Booking totals aggregate stays.
    expect(b.totals?.gross.amountMinor).toBe(
      b.stays.reduce((n, s) => n + (s.totals?.gross.amountMinor ?? 0), 0),
    );

    // Billing instructions → finance: per stay an incidentals folio (default, the occupant) and an accommodation
    // folio (the company) with a rule routing room & package charges.
    for (const s of b.stays) {
      const folios = await org.run((tx) =>
        org.fakes.finance.listFolios(tx, { owner: { type: 'stay', id: s.id } }),
      );
      expect(folios.map((f) => [f.label, f.payer.type, f.isDefault])).toEqual([
        ['Incidentals', 'profile', true],
        ['Accommodation', 'company', false],
      ]);
    }
    const stayA = b.stays[0]?.id as string;
    const room = await org.run((tx) =>
      org.fakes.finance.postCharge(tx, {
        propertyId: org.propertyId,
        target: { type: 'stay', id: stayA },
        chargeCode: 'ROOM',
        amount: { amountMinor: 30_000, currency: 'USD' },
        serviceDate: BUSINESS_DATE,
        description: 'Room',
        sourceRef: { type: 'stay', id: stayA },
        idempotencyKey: `room:${stayA}:${BUSINESS_DATE}`,
      }),
    );
    const minibar = await org.run((tx) =>
      org.fakes.finance.postCharge(tx, {
        propertyId: org.propertyId,
        target: { type: 'stay', id: stayA },
        chargeCode: 'MINIBAR',
        amount: { amountMinor: 1_800, currency: 'USD' },
        serviceDate: BUSINESS_DATE,
        description: 'Minibar',
        sourceRef: { type: 'stay', id: stayA },
        idempotencyKey: `pos:bar:1:${stayA}`,
      }),
    );
    const folios = await org.run((tx) =>
      org.fakes.finance.listFolios(tx, { owner: { type: 'stay', id: stayA } }),
    );
    expect(folios.find((f) => f.folioId === room.folioId)?.label).toBe('Accommodation');
    expect(folios.find((f) => f.folioId === minibar.folioId)?.label).toBe('Incidentals');
    // The guarantee is the company: the payment readiness check is satisfied without a card.
    const arrivals = await org.run((tx) => org.svc.listArrivals(tx, { propertyId: org.propertyId }));
    expect(
      arrivals.items.every(
        (r) => r.readiness?.checks.find((c) => c.key === 'payment_secured')?.status === 'ok',
      ),
    ).toBe(true);
  });

  it('adds a stay to the family booking with one previewed change and per-booking totals', async () => {
    const org = await setupOrg(t);
    const b = created<Booking>(await org.run((tx) => org.svc.createBooking(tx, org.booking())));
    const preview = await org.run((tx) =>
      org.svc.previewChange(tx, {
        kind: 'add_stay',
        bookingId: b.id,
        stay: org.stay({ unitTypeId: org.types.family, occupancy: { adults: 2, childrenAges: [5, 9] } }),
      }),
    );
    expect(preview.feasible).toBe(true);
    expect(preview.totals?.before.amountMinor).toBe(b.totals?.gross.amountMinor);
    const newStay = preview.stays.find((s) => s.stayId === null);
    expect(newStay?.totals?.after.net.amountMinor).toBe(3 * (70_000 + 2 * 4_000));
    const res = created(await org.svc.commitChangeSafely(t.db, org.ctx, { previewToken: preview.token }));
    expect(res.booking.stays).toHaveLength(2);
    expect(res.booking.totals?.gross.amountMinor).toBe(preview.totals?.after.amountMinor);
  });
});
